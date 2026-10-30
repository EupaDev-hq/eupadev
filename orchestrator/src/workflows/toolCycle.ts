/**
 * W1 `toolCycle`: drives the `src/machine/states.ts` machine for one cycle (creation or evolution).
 *
 * Shape: a loop "read the state and the memory from the database → handle this state → transition", each read, write
 * or outside call being a DBOS step (replay without duplicates, automatic retries with growing wait, A3;
 * maximum duration per attempt, B1); the transition is an UPDATE that the database trigger checks. Everything the
 * workflow waits for from humans and the forge arrives through a single DBOS mailbox, each message valid only for the
 * visit to the state in which it was sent (B9). Agent tasks (W2) and outside operations (forge, deployment)
 * are child workflows whose NATIVE end W1 waits for (`DBOS.waitAll`, status and output, S4); an operation has a
 * native timeout (`timeoutMS`, S3). `cancellation` (E15) is handled in every non-final state: while waiting for a
 * message, during a task or a deployment (`send` cancels the children, W1 wakes up and reads the cancellation), and at
 * the start of each state, even a transient one.
 *
 * No volatile memory (D22): the workflow memory (instruction, clarification, pending message, candidate digest,
 * gate reason, scoping counters…) is recorded in the same transaction as each transition and read back at the start
 * of each state; reminders already sent and deadlines are read from the history (date of entry into the state).
 * A dead W1 resumed from the start (`DBOS.rewindWorkflow`, monitoring) therefore resumes exactly where it was.
 *
 * Last-resort error boundary (D21): any exception while handling a state (retries
 * exhausted, unexpected message, bug) is traced, the admin is notified with the exact error and the cycle goes to
 * `gate_incident`; the workflow never dies in ERROR. If even that fails, a new try after a short, growing
 * wait (B4), during which a cancellation is read.
 */
import { randomUUID } from 'node:crypto';
import { DBOS, type WorkflowStatus } from '@dbos-inc/dbos-sdk';
import type pg from 'pg';
import { STATES, topUpEnvelope, gateOutcomes, type StateId, type GateOutcome } from '../machine/states.ts';
import { opengrepDeviations, evaluate, SARIF_CHECK, type Counters as DeviationCounters, type Deviation } from '../hardening/stagnation.ts';
import { FORGE_ACTOR, ORCHESTRATOR_ACTOR, PermanentError, type Database, type Cycle, type DeviationRow, type Memory, type Task } from '../db.ts';
import { CODE_ROLES, REVIEW_ROLES, ownerRole, type Environment, type CoreUpdate, type Role, type RoleCode, type PublishedRole } from '../external/contracts.ts';
import { transmissibleEvidence, type Finding, type Report } from '../agent-engine/report.ts';
import { jargon } from '../agent-engine/jargon.ts';
import type { Config } from '../config.ts';
import { text, type Language, type Values } from '../i18n.ts';
import { MAILBOX, type PipelineCheck, type Message, type OperationResult } from '../messages.ts';
import {
  stopChildren, isDbosEngineError, step, singleStep, requirePilot, CONTROL_QUEUE, TASK_QUEUE, currentGeneration, taskWorkflowId,
  LAUNCH_PREVIEW_PIPELINE_STEP, CANCELLATION_TOPIC, errorText, alive as aliveSince, type Deps,
} from './deps.ts';
import type { TaskArgs, AgentTask } from './agentTask.ts';

/** An end-user text of the dictionaries (`lang/*.json`): its key, which also makes a notification's idempotency key, and its values. */
type Message_ = { key: string; values?: Values };
const NATURE = new Map<string, string>(STATES.map((e) => [e.id, e.kind]));
const DESCRIPTION = new Map<string, string>(STATES.map((e) => [e.id, e.description]));
export const HARDENING_ROLES: readonly Role[] = [...CODE_ROLES, ...REVIEW_ROLES];
/** S5 (note 2026-10-26 acceptance-on-preview §3.5): Preview controls before the requester's opinion. Patch: the step sequence of W1 changed (README, section on updating the code). */
const PATCH_CHECKS_BEFORE_FEEDBACK = 's5-checks-before-feedback';
type ReviewRole = (typeof REVIEW_ROLES)[number];
type Decision = Extract<Message, { type: 'decision' }>;
type Cancellation = Extract<Message, { type: 'cancellation' }>;

/** Outside operation entrusted to a child workflow (`externalOperation`). */
interface ArgsOperation {
  cycle_id: number;
  slug: string;
  /** `core` (decision A) runs on the executor's queue (engine, read badge); `core_publication` commits its result (pilot, forge). */
  operation: 'repo' | 'publication' | 'integration' | 'merge' | 'deployment' | 'core' | 'core_publication';
  iteration?: number;
  update?: CoreUpdate;
  /** `publication`: role whose validated branch goes into main. */
  role?: PublishedRole;
  env?: Environment;
  digest?: string | null;
}

// ── Hardening counters (D15/D20), derived from the tables ───────────────────────────────────────

const toDeviation = (l: DeviationRow): Deviation => ({ rule: l.rule, file: l.file, source: l.source, ...(l.category === null ? {} : { category: l.category }), ...(l.finding_id === null ? {} : { id: l.finding_id }), previous_id: l.previous_id });

/**
 * Code roles to run again for a deviation: the target role written with the deviation (A-R2a: builder finding for tests);
 * otherwise folder → role; otherwise the targeted role (`code:unchanged:<role>`, `report:<role>` — B6 —, source); an
 * invalid report from a reviewer targets no code role; otherwise all of them.
 */
export function deviationRoles(l: DeviationRow): RoleCode[] {
  if (l.target_role) return [l.target_role];
  const byFile = ownerRole(l.file);
  if (byFile !== undefined) return [byFile];
  const targeted = /^(?:code:unchanged|report):(.+)$/.exec(l.rule)?.[1];
  if (targeted !== undefined) return (CODE_ROLES as readonly string[]).includes(targeted) ? [targeted as RoleCode] : [];
  if ((CODE_ROLES as readonly string[]).includes(l.source)) return [l.source as RoleCode];
  return [...CODE_ROLES];
}

/**
 * M4 (D20): tree digests judged at `round` — only the code roles that ran in that round with at least one real deviation
 * to address (`givenDeviations` = deviations of the previous round, as routed by `deviationRoles`; `code:unchanged:*` excluded).
 * A role relaunched with nothing real to fix that changes nothing is not stagnating: otherwise `code:unchanged:<role>`
 * would route itself back to the role and feed itself, and a clean review could never reach `guard:compliant`.
 */
async function judgedTrees(base: Database, cycleId: number, round: number, givenDeviations: readonly DeviationRow[]): Promise<Partial<Record<RoleCode, string[]>>> {
  const trees = await base.treesByRole(cycleId);
  const ran = new Set((await base.roundTasks(cycleId, round, CODE_ROLES)).map((t) => t.role));
  const real = givenDeviations.filter((l) => !l.rule.startsWith('code:unchanged:'));
  for (const role of Object.keys(trees) as RoleCode[]) if (!ran.has(role) || !real.some((l) => deviationRoles(l).includes(role))) delete trees[role];
  return trees;
}

/**
 * A-R2a: findings of a report that the tests role must handle (`owner_role = tests`). An invalid report is stored without
 * top-level `findings`: nothing.
 */
const findingsForTests = (t: Task): Finding[] => ((t.report as Partial<Report> | null)?.findings ?? []).filter((f) => f.owner_role === 'tests');

/** C: reviewers whose invalid report is the ONLY deviation of the round (no deviation targets the code); null otherwise. */
export function reviewersOnly(deviations: readonly DeviationRow[]): ReviewRole[] | null {
  if (deviations.length === 0) return null;
  const roles = new Set<ReviewRole>();
  for (const l of deviations) {
    const r = /^report:(security-reviewer|quality-reviewer)$/.exec(l.rule)?.[1] as ReviewRole | undefined;
    if (r === undefined) return null;
    roles.add(r);
  }
  return REVIEW_ROLES.filter((r) => roles.has(r));
}

export interface HardeningCounters {
  /** Last round played (0 if none) and first round counted since the last reset. */
  lastRound: number;
  since: number;
  deviationCount: number;
  reasons: string[];
  /** Owner roles of the last round's deviations. */
  rolesConcerned: RoleCode[];
  lastRoundDeviations: DeviationRow[];
  /** Counters of each deviation of the last round (fine, category, inherited), as the evaluation computes them (D20). */
  counters: DeviationCounters[];
}

/**
 * Counters derived from the tables: stagnation (D20), rounds cap, duration (D3); order of the reasons §8.13, without
 * duplicates (B8). `evaluatedRound` = round to judge (null: the last one played). Exported: the scenarios read the counters
 * of the engine itself, never a calculation redone on the side. The reasons are end-user texts, in `language`.
 */
export async function hardeningCounters(base: Database, thresholds: Config['thresholds'], cycleId: number, evaluatedRound: number | null, language: Language = 'en'): Promise<HardeningCounters> {
  const lastRound = evaluatedRound ?? (await base.lastIteration(cycleId, HARDENING_ROLES));
  const since = await base.resumeIteration(cycleId);
  const lines = lastRound >= since ? await base.deviationsSince(cycleId, since) : [];
  const turns: DeviationRow[][] = [];
  for (let it = since; it <= lastRound; it += 1) turns.push(lines.filter((l) => l.iteration === it));
  const reasons: string[] = [];
  let deviationCount = 0;
  let counters: DeviationCounters[] = [];
  const last = turns[turns.length - 1] ?? [];
  if (turns.length > 0) {
    const ev = evaluate(turns.slice(0, -1).map((t) => t.map(toDeviation)), last.map(toDeviation), await judgedTrees(base, cycleId, lastRound, turns[turns.length - 2] ?? []), { stagnation: thresholds.hardening.stagnation, patience: thresholds.hardening.patience });
    deviationCount = ev.deviations.length;
    counters = ev.counters;
    // B8: the same deviation is announced only once; a red CI / pipeline check or an invalid report
    // is announced in its telling form (which check, which role) instead of the generic "deviation … present for".
    const meaningful = (rule: string, file: string, n: number): string | null =>
      /^(ci|preview):/.test(rule) && file === 'pipeline' ? text(language, 'stagnation.redCheck', { rule, n })
        : rule.startsWith('report:') ? text(language, 'stagnation.invalidReport', { role: rule.slice('report:'.length), n, rule })
          : null;
    reasons.push(...ev.reasons.map((r) => (r.mechanism === 'M2-fine' ? meaningful(String(r.values['rule']), String(r.values['file']), Number(r.values['n'])) : null) ?? text(language, r.key, r.values)));
    if (lastRound - since + 1 >= thresholds.hardening.rounds_cap) reasons.push(text(language, 'reason.roundsCap', { n: lastRound - since + 1 }));
  }
  const duration = await base.workDurationMin(cycleId, 'hardening');
  if (duration >= thresholds.hardening.agent_work_duration_min) reasons.push(text(language, 'reason.workDuration', { minutes: Math.round(duration) }));
  const roles = new Set<RoleCode>();
  for (const l of last) for (const r of deviationRoles(l)) roles.add(r);
  return { lastRound, since: since, deviationCount, reasons: [...new Set(reasons)], rolesConcerned: [...roles], lastRoundDeviations: last, counters };
}

export function createToolCycle(deps: Deps, agentTask: AgentTask) {
  const { base, external: ext, config, instructions } = deps;
  const thresholds = config.thresholds;
  const polling = { pollingIntervalMs: config.timeouts.polling_ms };
  const generation = currentGeneration();
  /** Orchestrator stopped: this workflow suspends, it no longer writes anything (see `deps.alive`). */
  const alive = () => aliveSince(generation);

  // ── Child workflow: an outside operation, cancellable, of bounded duration (B1) ──────────────

  /**
   * No DBOS retry: the contract of the forge and of the deployer carries its own retries; any error becomes a
   * result. Native timeout (`timeoutMS` at launch, S3): beyond it, DBOS cancels the workflow and the signal stops the call.
   */
  const externalOperation = DBOS.registerWorkflow(async function externalOperation(args: ArgsOperation): Promise<OperationResult> {
    if (args.operation !== 'core') requirePilot(config, 'externalOperation'); // `core` is the executor's (queue `agent-tasks`)
    return singleStep(`operation ${args.operation}`, async (): Promise<OperationResult> => {
      const signal = DBOS.stepStatus?.cancelSignal;
      try {
        switch (args.operation) {
          case 'repo':
            await ext.forge.createRepo(args.slug, signal);
            return { type: 'ok' };
          case 'publication':
            await ext.forge.publish(args.slug, args.cycle_id, args.role ?? 'scoping', signal);
            return { type: 'ok' };
          case 'integration': {
            const r = await ext.forge.integrate(args.slug, args.cycle_id, args.iteration ?? 1, signal);
            return r.result === 'ok' ? { type: 'ok' } : { type: 'conflict', files: r.files };
          }
          case 'merge': {
            const r = await ext.forge.merge(args.slug, args.cycle_id, args.iteration ?? 1, signal);
            return r.result === 'ok' ? { type: 'ok' } : { type: 'out_of_scope', files: r.files };
          }
          case 'deployment': {
            const d = await ext.deployer.deploy(args.env ?? 'mockup', args.slug, args.cycle_id, args.digest ?? null, signal);
            return { type: 'deployment', ...d };
          }
          case 'core':
            return { type: 'core', update: ext.engine.coreUpToDate === undefined ? null : await ext.engine.coreUpToDate(args.slug, signal) };
          case 'core_publication':
            if (args.update === undefined) throw new PermanentError('core publication without an update');
            await ext.forge.publishCore(args.slug, args.cycle_id, args.update, signal);
            return { type: 'ok' };
        }
      } catch (e) {
        return { type: 'error', reason: e instanceof Error ? e.message : String(e) };
      }
    });
  }, { name: 'externalOperation' });

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────

  /** M6: trace of reminder no. `already + 1`, idempotent when the step is retried. */
  const remind = (c: Cycle, already: number) => step(`reminder ${already + 1}: ${c.state}`, () => base.remind(c.id, c.state, c.visit, already));

  /** Transition (or in-place repeat), memory recorded in the same transaction (D22). */
  const transition = (c: Cycle, memory: Memory | undefined, trigger: string, to: StateId, actor?: string, extra?: (client: pg.PoolClient) => Promise<void>) =>
    step(`transition ${c.state} --[${trigger}]--> ${to}`, () => base.transition(c.id, c.state, trigger, to, actor, extra, memory));

  /** End-user text of the dictionaries (`lang/*.json`), in the deployment's language (L10). */
  const tr = (key: string, values?: Values): string => text(config.language, key, values);
  const render = (m: Message_): string => tr(m.key, m.values);
  /**
   * M9: idempotency key of an effect = workflow + step + the dictionary key of the subject and its values (identical from one
   * attempt of the same step to the next, and whatever the language, never the rendered text): an attempt that exceeded its
   * timeout but completes in the background, then the retry, make only one send. The key and values tell apart two
   * notifications of a W1 resumed from the start (`rewindWorkflow`: same step numbers).
   */
  const effectKey = (m: Message_): string => `${DBOS.workflowID ?? '?'}#${DBOS.stepID ?? '?'}#${m.key}#${JSON.stringify(m.values ?? {})}`;
  /**
   * G5: key of a reminder = visit + number, independent of the step numbers. The notification goes out before the trace: a
   * W1 resumed from the start between the two sends it again (it is never lost) with the same key, hence a single send.
   */
  const reminderKey = (c: Cycle, n: number): string => `cycle-${c.id}#reminder ${n}#${c.state}#${c.visit}`;
  const dashboardLink = (cycleId: number): string => tr('mail.dashboardLink', { url: `${config.dashboardUrl}/cycles/${cycleId}` });
  const notifyAdmin = (c: { id: number }, subject: Message_, content: string, key?: string) =>
    step('notify admin', () => ext.notifications.notify('admin', c.id, render(subject), `${content}\n${dashboardLink(c.id)}`, key ?? effectKey(subject)));
  /** Message to the requester: written in the chat then notified, in two steps (a retry of the notification does not duplicate the message). */
  async function notifyRequester(c: Cycle, message: Message_, key?: string): Promise<void> {
    const content = render(message);
    await step('write orchestrator message', () => base.writeMessage(c, 'orchestrator', ORCHESTRATOR_ACTOR, content, key));
    await step('notify requester', () => ext.notifications.notify('requester', c.id, tr('mail.requester.subject', { tool: c.name, summary: content.slice(0, 60) }), content, key ?? effectKey(message)));
  }
  /** A human's text in the chat, under the hat chosen when sending (requester of the tool, or admin). */
  const writeHumanMessage = (c: Cycle, m: { actor_id: string; hat?: 'requester' | 'admin' }, content: string) =>
    step('write requester message', () => base.writeMessage(c, m.hat ?? 'requester', m.actor_id, content));

  /** Last-resort alert: never an exception (the database or the mail service may be down), at worst the log. */
  async function alertAdmin(cycleId: number, subject: Message_, content: string): Promise<void> {
    try {
      await notifyAdmin({ id: cycleId }, subject, content);
    } catch (e) {
      await alive();
      if (isDbosEngineError(e)) throw e;
      DBOS.logger.error(`cycle ${cycleId}: admin alert impossible (${errorText(e)}): ${subject.key} — ${content}`);
    }
  }

  /** A message from a human or the forge is only valid for the visit to the state in which it was sent (B9). */
  const validForThisPass = (c: Cycle, m: Message): boolean => m.type === 'cancellation' || m.visit === c.visit;

  /**
   * Waits for the next accepted message (or `cancellation`, always accepted) until the deadline (epoch ms, durable); an
   * irrelevant message or one from a previous visit is traced in the chat and ignored without moving the deadline (S5: a
   * message received at the incident gate is not kept, it is asked for again on resume). `null` = timeout elapsed.
   */
  async function receive(c: Cycle, accepted: (m: Message) => boolean, deadline: number): Promise<Message | null> {
    for (;;) {
      await alive();
      const m = await DBOS.recv<Message>(MAILBOX, { deadlineEpochMS: deadline, ...polling });
      if (m === null) return null;
      if (m.type === 'cancellation' || (validForThisPass(c, m) && accepted(m))) return m;
      const why = tr(validForThisPass(c, m) ? 'chat.ignored.irrelevant' : 'chat.ignored.duplicate');
      await step('trace ignored message', () => base.writeMessage(c, 'orchestrator', ORCHESTRATOR_ACTOR, tr('chat.ignored', { type: m.type, state: c.state, why })));
    }
  }

  const isCancellation = (m: unknown): m is Cancellation => typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'cancellation';

  /**
   * Stops what is running for the cycle: child workflows (W2 tasks, outside operations, read from DBOS and not from
   * a workflow memory, D22) cancelled, open tasks closed (B3: started = cap, queued = $0).
   */
  async function stopRunning(c: Cycle, reason: string): Promise<void> {
    await step('stop running tasks and operations', async () => {
      await stopChildren(DBOS.workflowID!);
      await base.failOpenTasks(c.id, thresholds.task, reason);
    });
  }

  /** E15: cancellation by the admin — children cancelled, open tasks closed, then transition. */
  async function cancel(c: Cycle, memory: Memory, m: Cancellation): Promise<void> {
    await stopRunning(c, 'cancellation');
    await transition(c, memory, 'cancellation', 'end_cancellation', m.actor_id);
  }

  /**
   * Every end: requester notified, cleanup (mock-up, Preview — B6: the Preview is removed whatever the end;
   * no branch deleted, M5); creation without success → tool archived (the database has already set `archived_at`), archiving
   * of the repository requested from the admin (M5) and, if a Prod deployment was attempted, Prod removed and traced (B6). A7: each action is retried on its own; a failure does not stop the next ones and
   * ends in an explicit admin alert. The cycle stays finished whatever happens.
   */
  async function finish(c: Cycle): Promise<void> {
    const label = tr(`end.${c.state}`);
    const failures: string[] = [];
    const action = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await step(name, fn);
      } catch (e) {
        await alive();
        if (isDbosEngineError(e)) throw e;
        failures.push(`${name}: ${errorText(e)}`);
        return undefined;
      }
    };
    const end: Message_ = { key: 'chat.cycleEnd', values: { state: c.state } };
    const content = tr('chat.cycleEnd', { label });
    await action('write orchestrator message', () => base.writeMessage(c, 'orchestrator', ORCHESTRATOR_ACTOR, content));
    await action('notify requester', () => ext.notifications.notify('requester', c.id, tr('mail.requester.subject', { tool: c.name, summary: content.slice(0, 60) }), content, effectKey(end)));
    // G4: only the resources of THIS cycle (cycle id), never the mock-up or the Preview of a following cycle.
    await action('remove the mock-up', () => ext.deployer.remove('mockup', c.slug, c.id));
    await action('remove the Preview', () => ext.deployer.remove('preview', c.slug, c.id));
    const archiving = c.type === 'creation' && c.state !== 'end_success';
    if (archiving) {
      const prodRemoved = await action('remove the Prod', async () => {
        if (!(await base.hasPassedThrough(c.id, 'prod_deployment'))) return false;
        await ext.deployer.remove('prod', c.slug, c.id);
        await base.trace(c, 'cleanup:prod_removed');
        return true;
      });
      // M5: the engine is no longer admin of the repository; archiving (read-only) is done by a human.
      const archived: Message_ = { key: 'mail.archived.subject', values: { slug: c.slug } };
      await action('notify admin', () => ext.notifications.notify('admin', c.id, render(archived), `${tr('mail.archived.body', { label, slug: c.slug, prodRemoved: prodRemoved ? tr('mail.archived.prodRemoved') : '' })}\n${dashboardLink(c.id)}`, effectKey(archived)));
    }
    if (failures.length > 0) {
      await alertAdmin(c.id, { key: 'mail.cleanupIncomplete.subject', values: { slug: c.slug, cycle: c.id } }, tr('mail.cleanupIncomplete.body', { state: c.state, failures: failures.join('\n') }));
    }
  }

  // ── Child workflows: native wait (S4) ───────────────────────────────────────────────────────

  /**
   * S4: waits for the NATIVE end of these child workflows (`DBOS.waitAll`, durable, deterministic on replay) then reads their
   * status and their output. A child stopped without finishing (CANCELLED, ERROR…): if it is the cycle's cancellation (`send`
   * posts the cancellation then cancels the children), it is returned; otherwise the child counts as stopped, for the caller
   * to conclude (failed task, operation in error).
   */
  async function waitForChildren(ids: readonly string[]): Promise<Cancellation | Map<string, WorkflowStatus>> {
    const cancellation = async () => { const a = await DBOS.recv<Message>(CANCELLATION_TOPIC, { timeoutSeconds: 0 }); return isCancellation(a) ? a : null; };
    // `send` posts the cancellation BEFORE cancelling the children: read here, it covers a child started after this cancellation.
    const before = await cancellation();
    if (before !== null) return before;
    await DBOS.waitAll(ids.map((id) => DBOS.retrieveWorkflow(id)), polling);
    const statuses = new Map((await DBOS.listWorkflows({ workflowIDs: [...ids], loadInput: false, loadOutput: true })).map((w) => [w.workflowID, w]));
    if ([...statuses.values()].some((w) => w.status !== 'SUCCESS')) return (await cancellation()) ?? statuses;
    return statuses;
  }

  /** Starts the operation in a child workflow with a native timeout (S3, B1) and returns its result; stopped without a result = error. */
  async function operation(c: Cycle, op: Omit<ArgsOperation, 'cycle_id' | 'slug'>): Promise<Cancellation | (OperationResult & { op: string })> {
    const id = await step(`operation id ${op.operation}`, async () => `op-${c.id}-${op.operation}-${randomUUID().slice(0, 8)}`);
    // `core`: the executor's queue, partitioned by tool like the tasks (a partitioned queue only dequeues keyed workflows).
    const file = op.operation === 'core' ? { queueName: TASK_QUEUE, enqueueOptions: { queuePartitionKey: String(c.tool_id) } } : { queueName: CONTROL_QUEUE };
    await DBOS.startWorkflow(externalOperation, { workflowID: id, timeoutMS: config.timeouts.operation_ms, ...file })({ ...op, cycle_id: c.id, slug: c.slug });
    const end = await waitForChildren([id]);
    if (isCancellation(end)) return end;
    const s = end.get(id);
    if (s?.status === 'SUCCESS') return { ...(s.output as OperationResult), op: id };
    const timeout = s?.deadlineEpochMS !== undefined && s.deadlineEpochMS <= (await DBOS.now());
    return { type: 'error', reason: timeout ? `operation ${op.operation} without an answer after ${Math.round(config.timeouts.operation_ms / 1000)} s` : `operation ${op.operation} stopped without a result (workflow ${s?.status ?? 'missing'})`, op: id };
  }

  /**
   * The validated work of the previous step enters main (forge `publish`, idempotent) before the roles that start from
   * main: scoping at `contract`, contract at `hardening_execution`. A failure is an incident (D21): "retry" comes
   * back to this state and retries the publication before any new task is paid. `DBOS.patch`: a cycle recorded before
   * this step existed replays its old step sequence; a new pass in the state takes the new one.
   */
  async function publish(c: Cycle, role: PublishedRole): Promise<Cancellation | null> {
    if (!(await DBOS.patch(`publication-${role}`))) return null;
    const r = await operation(c, { operation: 'publication', role });
    if (isCancellation(r)) return r;
    if (r.type !== 'ok') throw new PermanentError(`publishing the ${role} work into main failed: ${r.type === 'error' ? r.reason : r.type}`);
    return null;
  }

  /**
   * Decision A (2026-10-27): at the start of an evolution, before any agent, the platform moves the tool to the latest
   * published core version: the engine computes the bump on the executor (registry route, read badge), the forge commits
   * it into main. Never a dead end: already on the latest version → nothing (no empty commit); registry unreachable or
   * commit refused → the cycle goes on with the current version, the requester reads why in the chat, the admin is told.
   * `DBOS.patch`: new steps before the first transition of `request_received`; an evolution recorded before replays its path.
   */
  async function updateCore(c: Cycle): Promise<Cancellation | null> {
    if (!(await DBOS.patch('core-evolution'))) return null;
    const r = await operation(c, { operation: 'core' });
    if (isCancellation(r)) return r;
    const update = r.type === 'core' ? r.update : null;
    let failure = r.type === 'error' ? r.reason : r.type !== 'core' ? `unexpected result: ${r.type}` : null;
    if (update !== null) {
      const p = await operation(c, { operation: 'core_publication', update });
      if (isCancellation(p)) return p;
      if (p.type !== 'ok') failure = p.type === 'error' ? p.reason : p.type;
    }
    if (failure !== null) {
      await step('write orchestrator message', () => base.writeMessage(c, 'orchestrator', ORCHESTRATOR_ACTOR, tr('chat.coreNotUpdated', { failure })));
      await notifyAdmin(c, { key: 'mail.coreNotUpdated.subject', values: { slug: c.slug, cycle: c.id } }, tr('mail.coreNotUpdated.body', { failure }));
    } else if (update !== null) {
      await step('write orchestrator message', () => base.writeMessage(c, 'orchestrator', ORCHESTRATOR_ACTOR, tr('chat.coreUpdated', { from: update.from, to: update.to })));
    }
    return null;
  }

  // ── Agent tasks (W2) ─────────────────────────────────────────────────────────────────────────

  /**
   * Common context of a task, built in a step. B5: the admin's instruction and clarification are read BEFORE the step and
   * cleared AFTER, in the workflow — a replayed step does not re-run its body; the clearing is recorded with the
   * next transition (D22), so a resume of the state before that transition passes them on again.
   */
  async function context(c: Cycle, memory: Memory, name: string, extra: () => Promise<Record<string, unknown>> = async () => ({})): Promise<Record<string, unknown>> {
    const instruction = memory.instruction;
    const precision = memory.adminClarification;
    const ctx = await step(name, async () => ({
      cycle: { id: c.id, type: c.type, tool: c.slug, name: c.name },
      chat: await base.cycleMessages(c.id),
      data: precision === null ? {} : { admin_clarification: precision },
      ...(instruction === null ? {} : { instruction: instruction }),
      ...(await extra()),
    }));
    memory.instruction = null;
    memory.adminClarification = null;
    return ctx;
  }

  /** Creates the tasks (deterministic id, new attempt if the previous one failed, B3) and puts them in the queue. */
  async function launchTasks(c: Cycle, iteration: number, roles: readonly Role[], contexts: (role: Role) => Record<string, unknown>): Promise<string[]> {
    const ids = await step(`create tasks ${roles.join(',')} iteration ${iteration}`, () => base.createTasks(c, c.state, iteration, roles));
    for (const [i, role] of roles.entries()) {
      const args: TaskArgs = { task_id: ids[i]!, tool: c.slug, role, instructions: instructions[role], context: contexts(role) };
      await DBOS.startWorkflow(agentTask, { workflowID: taskWorkflowId(ids[i]!), queueName: TASK_QUEUE, enqueueOptions: { queuePartitionKey: String(c.tool_id) } })(args);
    }
    return ids;
  }

  /**
   * Explicit fan-in (E4): waits for the native end of all the tasks (S4), or a cancellation. A W2 stopped without having
   * recorded its result (ERROR, CANCELLED…) leaves its task open: it is closed as failed at the cap (A4), never
   * left running. The status of each task is read from the database, the only source.
   */
  async function waitForTasks(c: Cycle, ids: readonly string[]): Promise<Cancellation | Map<string, Task['status']>> {
    const ends = await waitForChildren(ids.map(taskWorkflowId));
    if (isCancellation(ends)) return ends;
    return step('close stopped tasks and read their status', async () => {
      const statuses = new Map<string, Task['status']>();
      for (const id of ids) {
        const w = ends.get(taskWorkflowId(id));
        if (w?.status !== 'SUCCESS') {
          const error = w?.error === undefined || w.error === null ? '' : `: ${errorText(w.error)}`;
          await base.failOpenTasks(c.id, thresholds.task, `task stopped without a recorded result (workflow ${w?.status ?? 'missing'}${error})`, [id]);
        }
        statuses.set(id, (await base.readTask(id)).status);
      }
      return statuses;
    });
  }

  /** A single task (overlap, scoping, contract): starts, waits, reads the result. */
  async function singleTask(c: Cycle, role: Role, iteration: number, ctx: Record<string, unknown>): Promise<Cancellation | Task> {
    const [id] = await launchTasks(c, iteration, [role], () => ctx);
    const r = await waitForTasks(c, [id!]);
    if (isCancellation(r)) return r;
    return step(`read task ${id}`, () => base.readTask(id!));
  }

  const reasonOf = (t: Task): string => {
    const r = t.report as { reason?: string; blocked_reason?: string; summary?: string } | null;
    return r?.reason ?? r?.blocked_reason ?? r?.summary ?? `task ${t.status}`;
  };

  // ── Gates (waitForDecision, §8.13) ───────────────────────────────────────────────────────────

  /**
   * Notification, durable wait for a decision for THIS visit to the gate, 3 traced reminders (24/48/72 h) then one
   * reminder per week until the decision (S6, counted from the 3rd: notification only, the machine caps the traces at
   * 3). Reminders already sent and the deadline are read from the history (D22): a resumed W1 neither repeats nor forgets any.
   */
  async function waitForDecision(c: Cycle, reason: string): Promise<Decision | Cancellation> {
    const reasonText = reason.trim() === '' ? DESCRIPTION.get(c.state) ?? c.state : reason;
    const issues = gateOutcomes(c.state);
    const long = config.timeouts.long_reminder_ms;
    await notifyAdmin(c, { key: 'mail.decision.subject', values: { state: c.state, tool: c.name } }, reasonText);
    for (;;) {
      const r = await step('reminders of the pass', () => base.reminders(c.id, c.state, c.visit));
      const last = r.last_ms ?? c.entry_ms;
      const deadline = r.count < thresholds.reminders.count ? last + config.timeouts.reminder_ms : last + (Math.floor(((await DBOS.now()) - last) / long) + 1) * long;
      const m = await receive(c, (x) => x.type === 'decision' && x.gate === c.state && issues.has(x.outcome), deadline);
      if (isCancellation(m)) return m;
      if (m !== null && m.type === 'decision') return m;
      if (r.count < thresholds.reminders.count) {
        // The notification goes out before the trace: a resume between the two sends it again under the same key (G5), never lost nor doubled.
        await notifyAdmin(c, { key: 'mail.decision.reminder.subject', values: { n: r.count + 1, count: thresholds.reminders.count, state: c.state, tool: c.name } }, reasonText, reminderKey(c, r.count + 1));
        await remind(c, r.count);
      } else await notifyAdmin(c, { key: 'mail.decision.weekly.subject', values: { state: c.state, tool: c.name } }, reasonText, `cycle-${c.id}#weekly ${Math.round((deadline - last) / long)}#${c.state}#${c.visit}`);
    }
  }

  /**
   * Applies the decision: approval written in the same transaction as the transition, with the memory (D22); the
   * top-up increases the envelope of the gate's phase (database trigger, B4/B9). B1: at Gate 2, the approval is about
   * the candidate digest and it alone, which the admin cites (C). `before` adjusts the memory before the transition.
   */
  async function decide(c: Cycle, memory: Memory, d: Decision, to: StateId, trigger: string, before?: (m: Memory) => void): Promise<GateOutcome> {
    let digest: string | null = null;
    if (c.state === 'gate_2') {
      digest = await step('candidate digest', () => base.candidateDigest(c.id));
      if (digest === null) throw new PermanentError('Gate 2 without a candidate digest: no healthy Preview deployment in this cycle');
      if (d.outcome === 'approved' && d.digest === undefined) throw new PermanentError('Gate 2 approval without a cited digest');
      if (d.digest !== undefined && d.digest !== digest) throw new PermanentError(`Gate 2 decision on ${d.digest}, different from the candidate digest ${digest}`);
    }
    if (d.budget_top_up_usd !== undefined && topUpEnvelope(c.state) === null) throw new PermanentError(`top-up meaningless at gate ${c.state}`);
    memory.gateReason = ''; // the gate is decided: its reason no longer holds
    if ((d.outcome === 'correction' || d.outcome === 'scope_change') && d.comment) {
      if (c.state === 'gate_overlap') memory.adminClarification = d.comment;
      else memory.instruction = d.comment;
    }
    // I0: the hat is set by `Orchestrator.send` after authorisation; without it, the decision has not gone
    // through access control: refused (incident), never written.
    if (d.hat === undefined) throw new PermanentError(`decision at gate ${c.state} without a hat: message not authorised`);
    before?.(memory);
    await transition(c, memory, trigger, to, d.actor_id, async (client) => {
      await client.query(
        `INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, budget_top_up_usd, actor_id, role, four_eyes_exemption, comment) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.tool_id, c.id, c.state, digest, d.outcome, d.budget_top_up_usd ?? null, d.actor_id, d.hat, d.four_eyes_exemption === true, d.comment ?? null],
      );
    });
    return d.outcome;
  }

  /** Standard gate: wait then decide; `null` if the cycle was cancelled during the wait. */
  async function gate(c: Cycle, memory: Memory, reason: string, targets: { approved: StateId; correction: StateId; scope_change?: StateId }, before?: (m: Memory) => void): Promise<GateOutcome | null> {
    const m = await waitForDecision(c, reason);
    if (isCancellation(m)) {
      await cancel(c, memory, m);
      return null;
    }
    const to: StateId = m.outcome === 'refused' ? 'end_refusal' : m.outcome === 'scope_change' ? targets.scope_change ?? targets.correction : targets[m.outcome];
    return decide(c, memory, m, to, `gate:${m.outcome}`, before);
  }

  /** D21: incident gate — "retry" goes back to the original state (history, checked by the database), "refused" ends. */
  async function gateIncident(c: Cycle, memory: Memory): Promise<void> {
    const origin = await step('incident origin', () => base.incidentOrigin(c.id));
    if (origin === null) throw new PermanentError('incident gate without an original incident in the history');
    const m = await waitForDecision(c, memory.gateReason === '' ? tr('gate.incident.default', { state: origin }) : memory.gateReason);
    if (isCancellation(m)) return cancel(c, memory, m);
    if (m.outcome === 'approved') {
      // A resumed gate shows its own reason again (recorded with the resume transition, D22).
      await decide(c, memory, m, origin, `resume:${origin}`, (x) => { x.gateReason = x.reasonBeforeIncident; x.reasonBeforeIncident = ''; });
    } else await decide(c, memory, m, 'end_refusal', 'gate:refused');
  }

  /** B4: short, growing wait before a new try (1 min, 2, 4… capped at 1 h); a cancellation interrupts it. */
  async function waitAWhile(failures: number): Promise<Cancellation | null> {
    const base_ms = config.timeouts.incident_retry_ms;
    const wait = Math.min(base_ms * 2 ** Math.min(failures, 6), base_ms * 60);
    const a = await DBOS.recv<Message>(CANCELLATION_TOPIC, { timeoutSeconds: wait / 1000, ...polling });
    return isCancellation(a) ? a : null;
  }

  /**
   * Last-resort error boundary (D21): the error is traced, what is running is stopped, the admin is notified
   * with the exact error and the cycle goes to `gate_incident` from the state it is really in, the memory of that
   * state (read back from the database) kept for the resume. If even that fails (database unreachable), or if the fault happens during
   * the incident gate itself, we alert as best we can and retry after a short, growing wait (B4); a
   * cancellation received during that wait is returned to the loop. Never a silent stop.
   */
  async function incident(cycleId: number, e: unknown, failures: number): Promise<Cancellation | null> {
    const error = errorText(e);
    DBOS.logger.error(`cycle ${cycleId}: technical incident: ${error}`);
    try {
      const c = await step('read the cycle after the incident', () => base.readCycle(cycleId));
      if (NATURE.get(c.state) === 'end') return null; // the error followed the arrival in an end: the loop finishes the cycle
      await stopRunning(c, 'technical incident');
      const reason = tr('gate.incident.reason', { state: c.state, error });
      if (c.state === 'gate_incident') {
        // Fault while waiting for the decision: the gate stays open, the admin is warned, the wait resumes soon.
        await alertAdmin(c.id, { key: 'mail.incidentDuringGate.subject', values: { tool: c.name } }, reason);
        return await waitAWhile(failures);
      }
      const memory = await step('read the memory after the incident', () => base.readMemory(cycleId));
      memory.reasonBeforeIncident = memory.gateReason;
      memory.gateReason = reason;
      await transition(c, memory, 'incident', 'gate_incident');
      return null;
    } catch (e2) {
      await alive();
      if (isDbosEngineError(e2)) throw e2;
      DBOS.logger.error(`cycle ${cycleId}: incident could not be recorded (${errorText(e2)}); new try soon`);
      await alertAdmin(cycleId, { key: 'mail.incidentNotRecorded.subject', values: { cycle: cycleId } }, tr('mail.incidentNotRecorded.body', { error, cause: errorText(e2) }));
      return waitAWhile(failures);
    }
  }

  // ── Guard-rails (budget D11, hardening counters D15/D20) ────────────────────────────────────

  /** Budget check of an envelope, traced in the history (E2); true if the cap is reached. */
  async function budgetExceeded(c: Cycle, envelope: 'scoping' | 'hardening'): Promise<{ exceeded: boolean; cost: number; cap: number }> {
    return step(`budget check ${envelope}`, async () => {
      const cost = await base.cumulativeCost(c.id, envelope);
      const cap = envelope === 'scoping' ? c.scoping_budget_usd : c.hardening_budget_usd;
      const exceeded = cost >= cap;
      await base.trace(c, `check:budget:${envelope}:${exceeded ? 'exceeded' : 'ok'}:${cost.toFixed(2)}/${cap.toFixed(2)}`);
      return { exceeded, cost, cap };
    });
  }

  const deviationText = (l: DeviationRow): string => {
    if (l.rule === 'integration:conflict') return `conflict: ${l.file}`;
    if (/^(ci|preview):/.test(l.rule)) return `${l.rule}: red check`;
    if (l.rule.startsWith('scope:')) return `${l.rule}: file outside the role's scope`;
    return `${l.rule} ${l.file}`;
  };

  // ── The states ───────────────────────────────────────────────────────────────────────────────
  // Rule D22: any change to the memory precedes the transition that records it.

  async function requestReceived(c: Cycle, memory: Memory): Promise<void> {
    if (c.type === 'creation') return void (await transition(c, memory, 'guard:creation', 'overlap_search'));
    const a = await updateCore(c);
    if (a !== null) return cancel(c, memory, a);
    await transition(c, memory, 'guard:evolution', 'scoping');
  }

  async function overlapSearch(c: Cycle, memory: Memory): Promise<void> {
    const iteration = (await step('overlap iteration', () => base.lastIteration(c.id, ['overlap']))) + 1;
    // The catalogue of existing tools is DATA of the task (never in the instructions), built in the context
    // step: DBOS records it, the verdict is checked against that very catalogue.
    const ctx = await context(c, memory, 'overlap context', async () => ({ tool_catalogue: await base.toolCatalogue(c.tool_id) }));
    const t = await singleTask(c, 'overlap', iteration, ctx);
    if (isCancellation(t)) return cancel(c, memory, t);
    if (t.status !== 'done') {
      const reason = reasonOf(t);
      if (reason.startsWith('invalid report')) {
        memory.gateReason = tr('gate.overlap.unreadable', { reason });
        return void (await transition(c, memory, 'guard:unreadable_report', 'gate_overlap'));
      }
      memory.gateReason = tr('gate.overlap.failed', { reason });
      return void (await transition(c, memory, 'task:failed', 'gate_overlap'));
    }
    // C1: the verdict is a field of the report (closed list); missing or invalid → "to check" (fail-closed).
    const report = t.report as Report;
    const verdict = report.verdict;
    const summary = (report.summary ?? '').trim();
    if (verdict === 'not_plausible') return void (await transition(c, memory, 'guard:not_plausible', 'repo_creation'));
    if (verdict === 'plausible') {
      // Deterministic check: the designated tool must be in the catalogue passed on; otherwise "to check" (fail-closed),
      // never "not plausible" — an invented slug or a tampered catalogue only open the gate.
      const tool = report.overlapping_tool;
      const slugs = ((ctx['tool_catalogue'] as { slug: string }[] | undefined) ?? []).map((o) => o.slug);
      if (typeof tool !== 'string' || !slugs.includes(tool)) {
        memory.gateReason = tr('gate.overlap.unknownTool', { tool: String(tool ?? tr('gate.overlap.noTool')).slice(0, 100), summary: summary.slice(0, 200) });
        return void (await transition(c, memory, 'guard:unreadable_report', 'gate_overlap'));
      }
      memory.gateReason = tr('gate.overlap.plausible', { tool, summary });
      return void (await transition(c, memory, 'guard:plausible', 'gate_overlap'));
    }
    memory.gateReason = tr('gate.overlap.noVerdict', { summary: summary.slice(0, 200) });
    await transition(c, memory, 'guard:unreadable_report', 'gate_overlap');
  }

  async function repoCreation(c: Cycle, memory: Memory): Promise<void> {
    const r = await operation(c, { operation: 'repo' });
    if (isCancellation(r)) return cancel(c, memory, r);
    if (r.type === 'ok') return void (await transition(c, memory, 'task:done', 'scoping'));
    memory.gateReason = tr('gate.repoRefused', { slug: c.slug, reason: r.type === 'error' ? r.reason : r.type });
    await transition(c, memory, 'task:failed', 'gate_scoping_blocked');
  }

  /** Technical failure of the scoping (task or mock-up): D17 counters (memory recorded with the transition), then retry or escalation. */
  async function scopingFailure(c: Cycle, memory: Memory, reason: string): Promise<void> {
    const k = memory.scoping;
    k.attempts += 1;
    k.sameError = reason === k.lastError ? k.sameError + 1 : 1;
    k.lastError = reason;
    memory.previousError = reason;
    const duration = await step('work duration', () => base.workDurationMin(c.id, 'scoping'));
    const reasons: string[] = [];
    if (k.sameError >= thresholds.scoping.stagnation) reasons.push(tr('reason.sameError', { n: k.sameError }));
    if (k.attempts >= thresholds.scoping.attempts_cap) reasons.push(tr('reason.attemptsCap', { n: k.attempts }));
    if (duration >= thresholds.scoping.agent_work_duration_min) reasons.push(tr('reason.workDuration', { minutes: Math.round(duration) }));
    if (reasons.length > 0) {
      memory.gateReason = tr('gate.scopingBlocked', { reasons: reasons.join(tr('reason.separator')), error: reason });
      return void (await transition(c, memory, 'guard:escalation', 'gate_scoping_blocked'));
    }
    await transition(c, memory, 'guard:technical_failure', 'scoping');
  }

  async function scoping(c: Cycle, memory: Memory): Promise<void> {
    const budget = await budgetExceeded(c, 'scoping');
    if (budget.exceeded) {
      memory.gateReason = tr('gate.scopingBudget', { cost: budget.cost.toFixed(2), cap: budget.cap.toFixed(2) });
      return void (await transition(c, memory, 'guard:budget_exceeded', 'gate_scoping_budget'));
    }
    const iteration = (await step('scoping iteration', () => base.lastIteration(c.id, ['scoping']))) + 1;
    const error = memory.previousError;
    const ctx = await context(c, memory, 'scoping context', async () => (error === null ? {} : { previous_error: error }));
    memory.previousError = null;
    const t = await singleTask(c, 'scoping', iteration, ctx);
    if (isCancellation(t)) return cancel(c, memory, t);
    // A successful scoping does not reset "same error": a following mock-up failure counts with the previous ones (D17); only "continue" at the gate resets it.
    if (t.status === 'done') {
      // C1 (A-R6): the requester reads requester_message; a technical word sends the task back with that reason.
      const word = jargon((t.report as Partial<Report> | null)?.requester_message ?? '');
      if (word !== null) return scopingFailure(c, memory, `jargon shown to the requester: ${word}`);
      return void (await transition(c, memory, 'task:done', 'mockup_deployment'));
    }
    await scopingFailure(c, memory, reasonOf(t));
  }

  /**
   * Result of a (child) deployment written into `deployments` (one per visit, B8); an infrastructure error counts as
   * health `failed`. B5: the digest actually deployed must be the expected one (CI for the Preview, Gate 2 for the Prod);
   * otherwise the deployment has failed, never a success.
   */
  async function deploy(c: Cycle, env: Environment, digest: string | null): Promise<Cancellation | { health: 'ok' | 'failed'; url: string; reason?: string; otherServed?: string }> {
    const r = await operation(c, { operation: 'deployment', env, digest: digest });
    if (isCancellation(r)) return r;
    // G3: one row per operation (child workflow id): a new try in the same visit has its own.
    return step(`record the ${env} deployment`, async () => {
      if (r.type === 'deployment') {
        if (digest !== null && r.digest !== digest) {
          // M5: we record what is ACTUALLY served, as failed (never a healthy reference).
          await base.writeDeployment(c, env, r.digest, r.url, 'failed', r.op);
          return { health: 'failed' as const, url: r.url, reason: `deployed digest ${r.digest} different from the expected digest ${digest}`, otherServed: r.digest };
        }
        await base.writeDeployment(c, env, r.digest, r.url, r.health, r.op);
        return { health: r.health, url: r.url, ...(r.reason === undefined ? {} : { reason: r.reason }) };
      }
      const reason = r.type === 'error' ? r.reason : `unexpected result: ${r.type}`;
      if (digest !== null) await base.writeDeployment(c, env, digest, '', 'failed', r.op);
      return { health: 'failed' as const, url: '', reason: reason };
    });
  }

  /**
   * M5: the Prod serves a digest other than the approved one. Evolution: back to the last healthy digest in Prod
   * (restore deployment, traced); creation (or no reference): Prod removed, traced. Returns the summary
   * for the admin, or the cancellation received during the restore.
   */
  async function restoreProd(c: Cycle, served: string): Promise<Cancellation | string> {
    const reference = c.type === 'evolution' ? await step('last healthy Prod', () => base.lastHealthyProd(c.tool_id)) : null;
    if (reference !== null) {
      const r = await operation(c, { operation: 'deployment', env: 'prod', digest: reference });
      if (isCancellation(r)) return r;
      if (r.type === 'deployment' && r.health === 'ok' && r.digest === reference) {
        await step('trace the Prod restore', () => base.trace(c, 'cleanup:prod_restored'));
        return tr('prod.restored', { digest: reference });
      }
      const why = r.type === 'deployment' ? `${r.health}, digest ${r.digest}` : r.type === 'error' ? r.reason : r.type;
      return tr('prod.restoreFailed', { digest: reference, why, served });
    }
    try {
      await step('remove the served Prod', () => ext.deployer.remove('prod', c.slug, c.id));
      await step('trace the Prod removal', () => base.trace(c, 'cleanup:prod_removed'));
      return tr(c.type === 'creation' ? 'prod.removed.creation' : 'prod.removed.noReference');
    } catch (e) {
      await alive();
      if (isDbosEngineError(e)) throw e;
      return tr('prod.removeFailed', { error: errorText(e), served });
    }
  }

  async function mockupDeployment(c: Cycle, memory: Memory): Promise<void> {
    const r = await deploy(c, 'mockup', null);
    if (isCancellation(r)) return cancel(c, memory, r);
    if (r.health === 'ok') {
      // The link goes out before the transition: if sending fails, the incident resumes the deployment, never feedback awaited without a link.
      // D2 (A-R6): with the last scoping task's requester_message, checked by C1 when that task ended.
      const message = await step('scoping message', async () => {
        const [s] = await base.roundTasks(c.id, await base.lastIteration(c.id, ['scoping']), ['scoping']);
        return (s?.report as Partial<Report> | null | undefined)?.requester_message ?? null;
      });
      await notifyRequester(c, { key: 'chat.mockupAvailable', values: { url: r.url, message: message ? `\n\n${message}` : '' } });
      return void (await transition(c, memory, 'task:done', 'waiting_scoping_feedback'));
    }
    await scopingFailure(c, memory, r.reason ?? 'mock-up health check failed');
  }

  async function waitingScopingFeedback(c: Cycle, memory: Memory): Promise<void> {
    if (memory.pendingMessage !== null) {
      // D18: the free message received during the pause is handled as a correction request.
      memory.instruction = memory.pendingMessage;
      memory.pendingMessage = null;
      return void (await transition(c, memory, 'event:scoping_feedback:correction', 'scoping', c.requester_id));
    }
    for (;;) {
      // Reminders and deadlines read from the history (D22); 24 h after the 3rd reminder: pause (D4).
      const r = await step('reminders of the pass', () => base.reminders(c.id, c.state, c.visit));
      const m = await receive(c, (x) => x.type === 'scoping_feedback' || x.type === 'requester_abandonment', (r.last_ms ?? c.entry_ms) + config.timeouts.reminder_ms);
      if (isCancellation(m)) return cancel(c, memory, m);
      if (m === null) {
        if (r.count < thresholds.reminders.count) {
          await notifyRequester(c, { key: 'chat.reminder.mockup', values: { n: r.count + 1, count: thresholds.reminders.count } }, reminderKey(c, r.count + 1));
          await remind(c, r.count);
          continue;
        }
        return void (await transition(c, memory, 'guard:reminders_exhausted', 'scoping_pause'));
      }
      if (m.type === 'requester_abandonment') return void (await transition(c, memory, 'event:requester_abandonment', 'end_abandonment', m.actor_id));
      if (m.type === 'scoping_feedback') {
        if (m.text) await writeHumanMessage(c, m, m.text);
        if (m.outcome === 'satisfied') return void (await transition(c, memory, 'event:scoping_feedback:satisfied', 'contract', m.actor_id));
        memory.instruction = m.text ?? null;
        return void (await transition(c, memory, 'event:scoping_feedback:correction', 'scoping', m.actor_id));
      }
    }
  }

  async function scopingPause(c: Cycle, memory: Memory): Promise<void> {
    await step('stop the mock-up', () => ext.deployer.stop('mockup', c.slug, c.id));
    await notifyAdmin(c, { key: 'mail.paused.subject', values: { slug: c.slug } }, tr('mail.paused.body', { count: thresholds.reminders.count, days: thresholds.reminders.pause_archive_after_days }));
    // Deadline counted from the entry into the pause (D22): a new workflow does not start another 30 days.
    const m = await receive(c, (x) => x.type === 'requester_message' || x.type === 'requester_abandonment', c.entry_ms + config.timeouts.pause_archive_ms);
    if (isCancellation(m)) return cancel(c, memory, m);
    if (m === null) return void (await transition(c, memory, 'timeout_exceeded', 'end_abandonment'));
    if (m.type === 'requester_abandonment') return void (await transition(c, memory, 'event:requester_abandonment', 'end_abandonment', m.actor_id));
    if (m.type === 'requester_message') {
      await writeHumanMessage(c, m, m.text);
      memory.pendingMessage = m.text;
      await transition(c, memory, 'event:requester_message', 'mockup_deployment', m.actor_id);
    }
  }

  async function contract(c: Cycle, memory: Memory): Promise<void> {
    const budget = await budgetExceeded(c, 'hardening');
    if (budget.exceeded) {
      memory.gateReason = tr('gate.contractBudget', { cost: budget.cost.toFixed(2), cap: budget.cap.toFixed(2) });
      return void (await transition(c, memory, 'guard:budget_exceeded', 'gate_contract_blocked'));
    }
    // The contract starts from the scoping the requester validated (spec, decisions, mock-up), via main.
    const a = await publish(c, 'scoping');
    if (a !== null) return cancel(c, memory, a);
    const iteration = (await step('contract iteration', () => base.lastIteration(c.id, ['contract']))) + 1;
    const t = await singleTask(c, 'contract', iteration, await context(c, memory, 'contract context'));
    if (isCancellation(t)) return cancel(c, memory, t);
    if (t.status === 'done') return void (await transition(c, memory, 'task:done', 'hardening_execution'));
    memory.gateReason = tr('gate.contractFailed', { reason: reasonOf(t) });
    await transition(c, memory, 'task:failed', 'gate_contract_blocked');
  }

  async function hardeningExecution(c: Cycle, memory: Memory): Promise<void> {
    const budget = await budgetExceeded(c, 'hardening');
    if (budget.exceeded) {
      memory.gateReason = tr('gate.hardeningBudget', { cost: budget.cost.toFixed(2), cap: budget.cap.toFixed(2) });
      return void (await transition(c, memory, 'guard:budget_exceeded', 'gate_hardening_blocked'));
    }
    // D15: counters checked on entering the round (repeated red pipeline, red CI, out-of-scope diff).
    const k = await step('counters at round entry', () => hardeningCounters(base, thresholds, c.id, null, config.language));
    if (k.reasons.length > 0) {
      memory.gateReason = k.reasons.join(tr('reason.separator'));
      return void (await transition(c, memory, 'guard:escalation', 'gate_hardening_blocked'));
    }
    const round = k.lastRound + 1;
    // C: only a reviewer's report was invalid (no deviation targets the code) → that reviewer alone is run again; the
    // round has no code task, integration has nothing to do.
    const only = reviewersOnly(k.lastRoundDeviations);
    if (only !== null) {
      memory.reviewOnly = { round, roles: only };
      return void (await transition(c, memory, 'task:done', 'hardening_integration'));
    }
    // Tests and builder start from the contract (OpenAPI, features, on top of the scoping), via main.
    const a = await publish(c, 'contract');
    if (a !== null) return cancel(c, memory, a);
    // Always at least one code role per round: the current round is read from the tasks (integration, review). A-R2a: in
    // the order of CODE_ROLES (tests then builder), never in that of the deviations.
    const roles = k.rolesConcerned.length > 0 ? CODE_ROLES.filter((r) => k.rolesConcerned.includes(r)) : CODE_ROLES;
    const { builder_findings: builderFindings, ...common } = await context(c, memory, 'round context', async () => ({
      previous_reports: (await base.roundTasks(c.id, k.lastRound, REVIEW_ROLES)).filter((t) => t.status === 'done').map((t) => ({ role: t.role, iteration: t.iteration, report: t.report })),
      // A-R2a: what the builder holds against the suite, evidence included; never the rest of its report (tests does not read the code).
      // Like the deviations: nothing from a round before the last reset of the counters (admin's decision).
      builder_findings: (k.lastRound >= k.since ? await base.roundTasks(c.id, k.lastRound, ['builder']) : []).flatMap(findingsForTests).map((f) => ({ rule: f.rule, file: f.file, line: f.line, severity: f.severity, evidence: transmissibleEvidence(f.evidence) })),
    }));
    // A-R2a (ADR-021): explicit wait, not a side effect of the queue — the builder only starts once `tests` is finished (it reads
    // the suite of THIS round); `tests` failed or blocked stops the round, the builder is not started.
    let all = true;
    for (const role of roles) {
      const ids = await launchTasks(c, round, [role], () => ({
        ...common,
        ...(role === 'tests' ? { builder_findings: builderFindings } : {}),
        iteration: round,
        deviations: k.lastRoundDeviations.filter((l) => deviationRoles(l).includes(role)).map((l) => ({ rule: l.rule, file: l.file, category: l.category, text: deviationText(l) })),
      }));
      const r = await waitForTasks(c, ids);
      if (isCancellation(r)) return cancel(c, memory, r);
      all = [...r.values()].every((s) => s === 'done');
      if (!all) break;
    }
    await transition(c, memory, all ? 'task:done' : 'task:failed', all ? 'hardening_integration' : 'hardening_evaluation');
  }

  async function hardeningIntegration(c: Cycle, memory: Memory): Promise<void> {
    if (memory.reviewOnly !== null) return void (await transition(c, memory, 'task:done', 'hardening_review')); // no code role ran
    const round = await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES));
    const r = await operation(c, { operation: 'integration', iteration: round });
    if (isCancellation(r)) return cancel(c, memory, r);
    if (r.type === 'ok') return void (await transition(c, memory, 'task:done', 'hardening_review'));
    await step('integration deviation', () =>
      base.writeDeviations(c, round, (r.type === 'conflict' ? r.files : ['integration']).map((f) => ({ rule: 'integration:conflict', file: f, category: null, finding_id: null, previous_id: null, source: 'orchestrator' }))));
    await transition(c, memory, 'task:failed', 'hardening_evaluation');
  }

  async function hardeningReview(c: Cycle, memory: Memory): Promise<void> {
    const only = memory.reviewOnly;
    const round = only?.round ?? (await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES)));
    const roles: readonly Role[] = only?.roles ?? REVIEW_ROLES;
    const ctx = await context(c, memory, 'review context', async () => {
      const precedents = await base.roundTasks(c.id, round - 1, REVIEW_ROLES);
      const previousDeviations = round > 1 ? (await base.deviationsSince(c.id, round - 1)).filter((l) => l.iteration === round - 1) : [];
      return {
        iteration: round,
        previous_reports: precedents.filter((t) => t.status === 'done').map((t) => ({ role: t.role, iteration: t.iteration, report: t.report })),
        previous_deviations: previousDeviations.map((l) => ({ rule: l.rule, file: l.file, category: l.category, id: l.finding_id })),
      };
    });
    const ids = await launchTasks(c, round, roles, () => ctx);
    const r = await waitForTasks(c, ids);
    if (isCancellation(r)) return cancel(c, memory, r);
    const all = [...r.values()].every((s) => s === 'done');
    memory.reviewOnly = null;
    await transition(c, memory, all ? 'task:done' : 'task:failed', 'hardening_evaluation');
  }

  async function hardeningEvaluation(c: Cycle, memory: Memory): Promise<void> {
    const round = await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES));
    await step('round deviations', async () => {
      const tasks = await base.roundTasks(c.id, round, HARDENING_ROLES);
      const deviations: Omit<DeviationRow, 'iteration'>[] = [];
      const fromBuilder: Omit<DeviationRow, 'iteration'>[] = [];
      for (const t of tasks) {
        if (t.status === 'done' && (REVIEW_ROLES as readonly string[]).includes(t.role)) {
          for (const f of (t.report as Report).findings) deviations.push({ rule: f.rule, file: f.file, category: f.category, finding_id: f.id, previous_id: f.previous_id, source: t.role });
        } else if (t.status !== 'done') {
          // M1: no valid report (invalid, failed, blocked) = deviation report:<role>, which counts like the others.
          deviations.push({ rule: `report:${t.role}`, file: 'report', category: null, finding_id: null, previous_id: null, source: 'orchestrator' });
        }
        // A-R2a: a defect of the suite seen by the builder is a deviation of the tests role, whatever its file; valid
        // report whatever its status (`blocked` is the prescribed form when a test contradicts the contract).
        // previous_id reserved for reviewers (database).
        if (t.role === 'builder') fromBuilder.push(...findingsForTests(t).map((f) => ({ rule: f.rule, file: f.file, category: f.category, finding_id: f.id, previous_id: null, source: 'builder', target_role: 'tests' as const })));
      }
      // Reviewers first: on the same (rule, file), their row (routed by file, with previous_id) prevails.
      await base.writeDeviations(c, round, [...deviations, ...fromBuilder]);
      // M4a: tree of a code role unchanged after ITS round → deviation code:unchanged:<role> (only the roles that ran
      // with a real deviation to address, `judgedTrees`).
      const since = await base.resumeIteration(c.id);
      const lines = await base.deviationsSince(c.id, since);
      const ev = evaluate([], lines.filter((l) => l.iteration === round).map(toDeviation), await judgedTrees(base, c.id, round, lines.filter((l) => l.iteration === round - 1)));
      await base.writeDeviations(c, round, ev.deviations.filter((e) => e.rule.startsWith('code:unchanged:')).map((e) => ({ rule: e.rule, file: e.file, category: null, finding_id: null, previous_id: null, source: 'orchestrator' })));
    });
    const k = await step('evaluate the round', () => hardeningCounters(base, thresholds, c.id, round, config.language));
    const budget = await budgetExceeded(c, 'hardening');
    if (k.deviationCount === 0) return void (await transition(c, memory, 'guard:compliant', 'merge'));
    const reasons = [...k.reasons];
    if (budget.exceeded) reasons.push(tr('reason.hardeningBudget', { cost: budget.cost.toFixed(2), cap: budget.cap.toFixed(2) }));
    if (reasons.length > 0) {
      memory.gateReason = tr('gate.roundNonCompliant', { round, count: k.deviationCount, reasons: [...new Set(reasons)].join(tr('reason.separator')) });
      return void (await transition(c, memory, 'guard:escalation', 'gate_hardening_blocked'));
    }
    await transition(c, memory, 'guard:non_compliant', 'hardening_execution');
  }

  async function merge(c: Cycle, memory: Memory): Promise<void> {
    const round = await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES));
    const r = await operation(c, { operation: 'merge', iteration: round });
    if (isCancellation(r)) return cancel(c, memory, r);
    if (r.type === 'ok') return void (await transition(c, memory, 'task:done', 'waiting_ci'));
    if (r.type === 'out_of_scope') {
      // Arbitration A: round deviation `scope:<file>`, carried by the offending role (source) for routing, not a technical block.
      await step('out-of-scope deviations', () => base.writeDeviations(c, round, r.files.map((f) => ({ rule: `scope:${f.file}`, file: f.file, category: null, finding_id: null, previous_id: null, source: f.role }))));
      return void (await transition(c, memory, 'guard:diff_out_of_scope', 'hardening_execution'));
    }
    memory.gateReason = tr('gate.mergeFailed', { reason: r.type === 'error' ? r.reason : r.type });
    await transition(c, memory, 'task:failed', 'gate_delivery_blocked');
  }

  /**
   * Synthetic deviations of a red pipeline: `ci:<check>` / `preview:<check>` on `pipeline`, Opengrep by matchBasedId
   * (M5); a red check with failing tests read by the watcher (`details.failures`, acceptance) gives one `<pipeline>:<check>:<test>` each.
   */
  const pipelineDeviations = (pipeline: 'ci' | 'preview', checks: readonly PipelineCheck[]): Omit<DeviationRow, 'iteration'>[] => {
    const deviations: Omit<DeviationRow, 'iteration'>[] = [];
    for (const k of checks.filter((x) => x.result === 'red')) {
      const sarif = k.check === SARIF_CHECK ? opengrepDeviations(k.details) : [];
      const failures = (k.details as { failures?: unknown } | undefined)?.failures;
      if (sarif.length > 0) deviations.push(...sarif.map((e) => ({ rule: e.rule, file: e.file, category: null, finding_id: null, previous_id: null, source: 'orchestrator' })));
      else if (Array.isArray(failures) && failures.length > 0) deviations.push(...failures.map((e) => ({ rule: `${pipeline}:${k.check}:${String(e)}`, file: 'pipeline', category: null, finding_id: null, previous_id: null, source: 'orchestrator' })));
      else deviations.push({ rule: `${pipeline}:${k.check}`, file: 'pipeline', category: null, finding_id: null, previous_id: null, source: 'orchestrator' });
    }
    return deviations;
  };

  async function waitingCi(c: Cycle, memory: Memory): Promise<void> {
    const m = await receive(c, (x) => x.type === 'ci_finished', c.entry_ms + config.timeouts.ci_max_ms);
    if (isCancellation(m)) return cancel(c, memory, m);
    if (m === null) {
      // The deadline counts from the merge, not from a resume (G5): after "retry" at the incident gate, it may have passed.
      memory.gateReason = c.last_trigger?.startsWith('resume:')
        ? tr('gate.ciDeadlineAfterResume', { minutes: thresholds.forge.ci_wait_max_min })
        : tr('gate.ciSilent', { minutes: thresholds.forge.ci_wait_max_min });
      return void (await transition(c, memory, 'timeout_exceeded', 'gate_delivery_blocked'));
    }
    if (m.type !== 'ci_finished') return;
    // Guard-rail: never a candidate image without a digest; the admin sees the exact reason at the incident gate (no loop).
    if (m.outcome === 'green' && !m.digest) throw new PermanentError('green CI but image missing from the registry (no digest): check the image job and the registry, run the CI of main again, then "retry"');
    const round = await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES));
    await step('CI results', () => base.writePipelineResults(c, round, 'ci', m.digest ?? null, m.checks, m.outcome === 'red' ? pipelineDeviations('ci', m.checks) : []));
    if (m.outcome === 'green') {
      memory.candidateDigest = m.digest!;
      return void (await transition(c, memory, 'event:ci_finished:green', 'candidate_image', FORGE_ACTOR));
    }
    await transition(c, memory, 'event:ci_finished:red', 'hardening_execution', FORGE_ACTOR);
  }

  async function imageCandidate(c: Cycle, memory: Memory): Promise<void> {
    const granted = c.type === 'evolution' || (await step('Gate 1 already granted?', () => base.gate1Granted(c.tool_id)));
    await transition(c, memory, granted ? 'guard:gate1_already_granted' : 'guard:gate1_required', granted ? 'preview_deployment' : 'gate_1');
  }

  async function deployment(c: Cycle, memory: Memory, env: 'preview' | 'prod'): Promise<void> {
    // D19 / B1: the Prod deploys the digest approved at Gate 2 (read from the database), the Preview the digest of the last green CI (memory read back from the database, D22).
    const digest = env === 'prod' ? await step('digest approved at Gate 2', () => base.gate2ApprovedDigest(c.id)) : memory.candidateDigest;
    if (digest === null) throw new PermanentError(`${env} deployment without ${env === 'prod' ? 'an approved' : 'a candidate'} digest`);
    const r = await deploy(c, env, digest);
    if (isCancellation(r)) return cancel(c, memory, r);
    if (r.health === 'ok') {
      if (env === 'prod') return void (await transition(c, memory, 'task:done', 'end_success'));
      // S5 (note acceptance-on-preview §3.5): the Preview controls run before the requester is told; a cycle recorded
      // before this change replays its old path (link sent at deploy time, then the requester's opinion).
      if (await DBOS.patch(PATCH_CHECKS_BEFORE_FEEDBACK)) return void (await transition(c, memory, 'task:done', 'preview_pipeline'));
      await notifyRequester(c, { key: 'chat.previewAvailable', values: { url: r.url, digest } });
      return void (await transition(c, memory, 'task:done', 'waiting_preview_feedback'));
    }
    let suite = '';
    if (env === 'prod' && r.otherServed !== undefined) {
      const reset = await restoreProd(c, r.otherServed);
      if (isCancellation(reset)) return cancel(c, memory, reset);
      suite = ` ${reset}`;
      await notifyAdmin(c, { key: 'mail.prodOtherDigest.subject', values: { slug: c.slug } }, tr('mail.prodOtherDigest.body', { slug: c.slug, served: r.otherServed, digest, suite }));
    }
    memory.gateReason = tr('gate.deploymentFailed', { env, digest, reason: r.reason ?? 'health check failed', suite });
    await transition(c, memory, 'task:failed', env === 'preview' ? 'gate_delivery_blocked' : 'gate_prod_blocked');
  }

  async function waitingPreviewFeedback(c: Cycle, memory: Memory): Promise<void> {
    for (;;) {
      const r = await step('reminders of the pass', () => base.reminders(c.id, c.state, c.visit));
      const deadline = r.count < thresholds.reminders.count ? (r.last_ms ?? c.entry_ms) + config.timeouts.reminder_ms : (await DBOS.now()) + config.timeouts.long_wait_ms;
      const m = await receive(c, (x) => x.type === 'preview_feedback', deadline);
      if (isCancellation(m)) return cancel(c, memory, m);
      if (m === null) {
        if (r.count < thresholds.reminders.count) {
          await notifyRequester(c, { key: 'chat.reminder.preview', values: { n: r.count + 1, count: thresholds.reminders.count } }, reminderKey(c, r.count + 1));
          await remind(c, r.count);
        }
        continue; // beyond: "waiting > 72 h" on the dashboard, neither pause nor abandonment (decision 9)
      }
      if (m.type !== 'preview_feedback') continue;
      if (m.text) await writeHumanMessage(c, m, m.text);
      // The digest the requester tried already passed the Preview pipeline: Gate 2, without running it again (S5).
      if (m.outcome === 'satisfied') return void (await transition(c, memory, 'event:preview_feedback:satisfied', 'gate_2', m.actor_id));
      memory.instruction = m.text ?? null;
      return void (await transition(c, memory, `event:preview_feedback:${m.outcome}`, m.outcome === 'bug' ? 'hardening_execution' : 'contract', m.actor_id));
    }
  }

  async function pipelinePreview(c: Cycle, memory: Memory): Promise<void> {
    // E5f: the real forge starts the pipeline itself (one step: replay never starts it twice); the watcher reads its result.
    const launch = ext.forge.launchPreviewPipeline;
    const url = `https://${c.slug}.preview.${config.toolDomain}`;
    if (launch !== undefined && await DBOS.patch('e5f-launch-preview-pipeline')) {
      await singleStep(LAUNCH_PREVIEW_PIPELINE_STEP, () => launch.call(ext.forge, c.slug, url));
    }
    const m = await receive(c, (x) => x.type === 'preview_pipeline_finished', c.entry_ms + config.timeouts.ci_max_ms);
    if (isCancellation(m)) return cancel(c, memory, m);
    if (m === null) {
      memory.gateReason = tr('gate.previewSilent', { minutes: thresholds.forge.ci_wait_max_min });
      return void (await transition(c, memory, 'timeout_exceeded', 'gate_delivery_blocked'));
    }
    if (m.type !== 'preview_pipeline_finished') return;
    const digest = await step('candidate digest', () => base.candidateDigest(c.id));
    if (digest === null) throw new PermanentError('Preview pipeline without a candidate digest (no healthy Preview deployment)');
    const round = await step('current round', () => base.lastIteration(c.id, HARDENING_ROLES));
    await step('Preview pipeline results', () => base.writePipelineResults(c, round, 'preview', digest, m.checks, m.outcome === 'red' ? pipelineDeviations('preview', m.checks) : []));
    if (m.outcome === 'red') return void (await transition(c, memory, 'event:preview_pipeline_finished:red', 'hardening_execution', FORGE_ACTOR));
    const results = await step('results for Gate 2', () => base.pipelineResults(c.id, 'preview', digest));
    memory.gateReason = tr('gate.gate2', { digest, results: results.map((r) => tr('gate.gate2.result', { check: r.check, result: r.result })).join('\n') });
    // S5: all green → the requester gets the link now (the Preview was never shown before its controls); the Gate 2
    // reason set above travels in the memory (D22) through the requester's opinion. Old cycles replay their path to Gate 2.
    if (await DBOS.patch(PATCH_CHECKS_BEFORE_FEEDBACK)) {
      await notifyRequester(c, { key: 'chat.previewAvailable', values: { url, digest } });
      return void (await transition(c, memory, 'event:preview_pipeline_finished:green', 'waiting_preview_feedback', FORGE_ACTOR));
    }
    await transition(c, memory, 'event:preview_pipeline_finished:green', 'gate_2', FORGE_ACTOR);
  }

  /** S5: after "retry", a state waiting for a human or the forge asks again for what it is waiting for (the gates notify again by themselves). */
  async function askAgain(c: Cycle): Promise<void> {
    const after = tr('askAgain.incidentResolved');
    if (c.state === 'waiting_scoping_feedback' || c.state === 'scoping_pause') await notifyRequester(c, { key: 'chat.askAgain.mockup', values: { after } });
    else if (c.state === 'waiting_preview_feedback') await notifyRequester(c, { key: 'chat.askAgain.preview', values: { after } });
    else if (c.state === 'waiting_ci' || c.state === 'preview_pipeline') {
      await notifyAdmin(c, { key: 'mail.askAgain.subject', values: { state: c.state, tool: c.name } }, tr(c.state === 'waiting_ci' ? 'mail.askAgain.ci' : 'mail.askAgain.preview', { after }));
    }
  }

  /** Handling of a non-final state. */
  async function handle(c: Cycle, memory: Memory): Promise<void> {
    switch (c.state) {
      case 'request_received': return requestReceived(c, memory);
      case 'overlap_search': return overlapSearch(c, memory);
      case 'gate_overlap': return void (await gate(c, memory, memory.gateReason, { approved: 'repo_creation', correction: 'repo_creation' }));
      case 'repo_creation': return repoCreation(c, memory);
      case 'scoping': return scoping(c, memory);
      case 'gate_scoping_budget': return void (await gate(c, memory, memory.gateReason, { approved: 'scoping', correction: 'scoping' }));
      case 'gate_scoping_blocked':
        // "continue" / "clarify" reset the counters, never the cost; recorded with the transition (D22).
        return void (await gate(c, memory, memory.gateReason, { approved: 'repo_creation', correction: 'repo_creation' }, (m) => { m.scoping = { attempts: 0, sameError: 0, lastError: null }; }));
      case 'mockup_deployment': return mockupDeployment(c, memory);
      case 'waiting_scoping_feedback': return waitingScopingFeedback(c, memory);
      case 'scoping_pause': return scopingPause(c, memory);
      case 'contract': return contract(c, memory);
      case 'gate_contract_blocked': return void (await gate(c, memory, memory.gateReason, { approved: 'contract', correction: 'contract' }));
      case 'hardening_execution': return hardeningExecution(c, memory);
      case 'hardening_integration': return hardeningIntegration(c, memory);
      case 'hardening_review': return hardeningReview(c, memory);
      case 'hardening_evaluation': return hardeningEvaluation(c, memory);
      case 'gate_hardening_blocked': return void (await gate(c, memory, memory.gateReason, { approved: 'hardening_execution', correction: 'hardening_execution' }));
      case 'merge': return merge(c, memory);
      case 'waiting_ci': return waitingCi(c, memory);
      case 'candidate_image': return imageCandidate(c, memory);
      case 'gate_1': return void (await gate(c, memory, tr('gate.gate1', { name: c.name, domain: `${c.slug}.${config.toolDomain}` }), { approved: 'preview_deployment', correction: 'hardening_execution', scope_change: 'contract' }));
      case 'preview_deployment': return deployment(c, memory, 'preview');
      case 'waiting_preview_feedback': return waitingPreviewFeedback(c, memory);
      case 'preview_pipeline': return pipelinePreview(c, memory);
      case 'gate_2': return void (await gate(c, memory, memory.gateReason, { approved: 'prod_deployment', correction: 'hardening_execution' }));
      case 'prod_deployment': return deployment(c, memory, 'prod');
      case 'gate_delivery_blocked': return void (await gate(c, memory, memory.gateReason, { approved: 'merge', correction: 'hardening_execution' }));
      case 'gate_prod_blocked': return void (await gate(c, memory, memory.gateReason, { approved: 'prod_deployment', correction: 'hardening_execution' }));
      case 'gate_incident': return gateIncident(c, memory);
      default: throw new PermanentError(`state without handling: ${String(c.state)}`);
    }
  }

  // ── The workflow ─────────────────────────────────────────────────────────────────────────────

  const toolCycle = DBOS.registerWorkflow(async function toolCycle(cycleId: number): Promise<StateId> {
    requirePilot(config, 'toolCycle');
    /** Cancellation received and not yet applied (the database may have been missing): kept until it goes through. */
    let cancellation: Cancellation | null = null;
    /** Consecutive failures to record an incident: pace of the new tries (B4). */
    let failures = 0;
    for (;;) {
      try {
        await alive();
        // D22: the memory is read back from the database at each state; what was not recorded with a transition does not exist.
        const { c, memory: memory } = await step('read the cycle and its memory', async () => ({ c: await base.readCycle(cycleId), memory: await base.readMemory(cycleId) }));
        if (NATURE.get(c.state) === 'end') {
          await finish(c);
          return c.state;
        }
        // E15: a cancellation posted during handling is seen at the start of the next state, even a transient one.
        if (cancellation === null) {
          const a = await DBOS.recv<Message>(CANCELLATION_TOPIC, { timeoutSeconds: 0 });
          if (isCancellation(a)) cancellation = a;
        }
        if (cancellation !== null) await cancel(c, memory, cancellation);
        else {
          // S5: a message received during the incident was not kept; the resumed state asks again for what it is waiting for.
          if (c.last_trigger?.startsWith('resume:')) await askAgain(c);
          await handle(c, memory);
        }
        failures = 0;
      } catch (e) {
        await alive(); // an error caused by the orchestrator stopping is not an incident
        if (isDbosEngineError(e)) throw e;
        cancellation = (await incident(cycleId, e, failures)) ?? cancellation;
        failures += 1;
      }
    }
  }, { name: 'toolCycle' });

  return toolCycle;
}

export type ToolCycle = ReturnType<typeof createToolCycle>;
