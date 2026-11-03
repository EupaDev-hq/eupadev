/**
 * Startup of the orchestrator and entry point of the requests and messages. Checks the configuration (E10), takes
 * the "a single engine at a time" lock (D23), launches DBOS with patching enabled (constant application version, S1),
 * registers W1/W2 and the task queue (concurrency N, 3 per tool), watches the cycles without a live workflow at
 * startup THEN through a DBOS scheduled task (A6, B2, S2), then offers: new request (creation or evolution) → cycle +
 * workflow; sending a message to the cycle, fully validated and refused if it is invalid, irrelevant in the current
 * state (A5) or if the cycle's workflow is no longer alive (B2).
 */
import { isDeepStrictEqual } from 'node:util';
import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';
import type { Hat } from './auth.ts';
import { readConfig, EXECUTOR_VMID, type Config, type ProcessRole } from './config.ts';
import { Database, type Cycle } from './db.ts';
import { text, type Values } from './i18n.ts';
import type { External } from './external/contracts.ts';
import { STATES, TRANSITIONS, triggerKey, topUpEnvelope, isIncidentDetour, gateOutcomes, type StateId } from './machine/states.ts';
import { eventKey, isHuman, validateMessage, MAILBOX, type Message } from './messages.ts';
import { invisibleCharacter } from './text.ts';
import { ReportValidator } from './agent-engine/report.ts';
import { loadInstructions } from './agent-engine/instructions.ts';
import { createToolCycle, HARDENING_ROLES, type ToolCycle } from './workflows/toolCycle.ts';
import { stopChildren, configureSteps, LAUNCH_PREVIEW_PIPELINE_STEP, requirePilot, CONTROL_QUEUE, TASK_QUEUE, cycleWorkflowId, newGeneration, CANCELLATION_TOPIC, errorText, ALIVE } from './workflows/deps.ts';
import type { Environment } from './external/contracts.ts';
import { createAgentTask } from './workflows/agentTask.ts';

const NATURE = new Map<string, string>(STATES.map((e) => [e.id, e.kind]));
const ALLOWED = new Set(TRANSITIONS.map((t) => `${t.from} ${triggerKey(t.trigger)}`));
/**
 * States reachable from the merge: the requester can no longer abandon by themselves (decision 9). The round trip
 * through the incident gate (D21) leads back to the original state: it opens no new path.
 */
const AFTER_MERGE = (() => {
  const seen = new Set<string>(['merge']);
  const pile = ['merge'];
  for (let e = pile.pop(); e !== undefined; e = pile.pop()) {
    for (const t of TRANSITIONS.filter((t) => t.from === e && !isIncidentDetour(t))) if (!seen.has(t.to)) { seen.add(t.to); pile.push(t.to); }
  }
  return seen;
})();
/** Statuses of a really dead W1: never resumed by DBOS itself. */
const DEAD = ['ERROR', 'CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED'] as const;
/** A cycle just created waits for `newRequest` to launch its workflow: the monitoring gives it this delay. */
const NO_WORKFLOW_GRACE_MS = 60_000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** C: a displayed name (mail subjects…) contains neither a line break nor a control character. */
const CHECK = /[\u0000-\u001f\u007f]/;

/**
 * D23: key of the PostgreSQL advisory lock "a single engine at a time" (per db). Held by a dedicated connection for the
 * whole life of the process.
 */
export const ENGINE_LOCK_KEY = '7362584910244';
/** D23 per role: a single executor of the agent tasks at a time. */
export const EXECUTOR_LOCK_KEY = '7362584910245';
/** Locks taken per role: the all-in-one (`all-in-one`) also runs the agent tasks, it holds both. */
const LOCKS: Record<ProcessRole, readonly string[]> = { 'all-in-one': [ENGINE_LOCK_KEY, EXECUTOR_LOCK_KEY], pilot: [ENGINE_LOCK_KEY], executor: [EXECUTOR_LOCK_KEY] };

/** Result of a send (C): passed on to the workflow, or become irrelevant during the send (the workflow will ignore it). */
export type SendResult = { transmitted: true } | { transmitted: false; reason: string };

/**
 * I0 (ADR-017): who acts — the actor resolved from the verified token (`actors.id`) and their hats (roles of the client
 * `eupadev-api` read from the token, never from the db: revoking a role in Keycloak applies from the next token).
 */
export interface Actor { id: string; roles: readonly Hat[] }

/** Authorisation refusal (missing hat, four eyes): 403 at the API, never an incident. */
export class AuthorizationError extends Error {
  override name = 'AuthorizationError';
}

/**
 * I0: the hat under which `actorId` (canonical, 0010) acts on the cycle's tool — `requester` if they are the tool's
 * requester and wear that hat, else `admin` if they wear it; otherwise refused. One rule for opinions, abandon, messages
 * and reading the cycle.
 */
export function hatOnTool(c: Pick<Cycle, 'requester_id' | 'slug'>, actorId: string, roles: readonly Hat[], what: string): Hat {
  if (actorId === c.requester_id && roles.includes('requester')) return 'requester';
  if (roles.includes('admin')) return 'admin';
  throw new AuthorizationError(`${what} refused: reserved for the requester of tool ${c.slug} (or an admin)`);
}

/** Hat retained and possible exemption, set on the message before it is delivered to W1. */
interface Authorization { hat: Hat; four_eyes_exemption: boolean }

/** Workflows of the local API's entries (E0). */
interface Api {
  request: (d: ToolRequest, actor: Actor) => Promise<{ tool_id: number; cycle_id: number; workflow_id: string }>;
  message: (cycleId: number, m: Message, roles: readonly Hat[]) => Promise<SendResult>;
}

/** `need`: what the person wants, in free text; first message of the cycle's chat, read by scoping. */
export type ToolRequest =
  | { type: 'creation'; name: string; slug: string; owner_service: string; need: string }
  | { type: 'evolution'; tool_id: number; need: string };

/** E0: the same idempotency key replayed with another content (or for another route): refused. */
export class IdempotencyConflict extends Error {}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Validation of a request before any write (A5); returns the reason for the refusal or null. */
export function validateRequest(d: unknown): string | null {
  if (typeof d !== 'object' || d === null) return 'request: object expected';
  const x = d as Record<string, unknown>;
  if (x['type'] !== 'creation' && x['type'] !== 'evolution') return 'type: creation or evolution expected';
  if (!nonEmpty(x['need'])) return 'need: non-empty expected';
  const invisible = invisibleCharacter(x['need']);
  if (invisible !== null) return `need: invisible character refused (${invisible})`;
  if (x['type'] === 'creation') {
    if (!nonEmpty(x['name'])) return 'name: non-empty expected';
    if (CHECK.test(x['name'])) return 'name: line breaks and control characters forbidden';
    if (typeof x['slug'] !== 'string' || !SLUG.test(x['slug'])) return 'slug: lowercase letters, digits and dashes expected (e.g. car-fleet)';
    if (!nonEmpty(x['owner_service'])) return 'owner_service: non-empty expected';
    return null;
  }
  return Number.isInteger(x['tool_id']) && (x['tool_id'] as number) > 0 ? null : 'tool_id: positive integer expected';
}

export class Orchestrator {
  readonly base: Database;
  readonly config: Config;
  readonly external: External;
  readonly toolCycle: ToolCycle;
  /** A single sweep at a time (the calls follow one another). */
  #sweepQueue: Promise<unknown> = Promise.resolve();
  /** M7: sweep in progress (the scheduled task does not stack another one behind it). */
  #sweepInProgress = false;
  #stopped = false;
  #stopping: Promise<void> | undefined;
  /** D23: connection that holds the "a single engine" lock; losing it stops the process. */
  readonly #lock: pg.Client;
  readonly #onLockLoss: (e: Error) => void;
  readonly #api: Api;

  private constructor(base: Database, config: Config, external: External, toolCycle: ToolCycle, lock: pg.Client, onLockLoss: (e: Error) => void, api: Api) {
    this.base = base;
    this.config = config;
    this.external = external;
    this.toolCycle = toolCycle;
    this.#lock = lock;
    this.#onLockLoss = onLockLoss;
    this.#api = api;
  }

  /**
   * D23: a single engine at a time, enforced by the db. Advisory lock taken on a dedicated connection, held for the whole
   * life of the process; clear refusal if it is already held (another engine runs on this db).
   */
  static async takeLock(databaseUrl: string, role: ProcessRole = 'all-in-one'): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: databaseUrl, keepAlive: true });
    client.on('error', () => {}); // replaced after startup; an error before must not kill the process
    await client.connect();
    try {
      for (const key of LOCKS[role]) {
        const r = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS ok', [key]);
        if (r.rows[0]?.ok !== true) {
          const who = key === ENGINE_LOCK_KEY ? 'another EupaDev engine' : 'another executor of the agent tasks';
          throw new Error(`startup refused: ${who} already runs on this database (lock ${key} held, role ${role}). One at a time: stop the old one before starting the new one.`);
        }
      }
      return client;
    } catch (e) {
      await client.end().catch(() => {});
      throw e;
    }
  }

  /**
   * Checks the configuration, takes the "a single engine" lock (D23), then starts DBOS; refuses to start if a value is
   * missing (E10) or if another engine holds the lock. `onLockLoss`: called after the engine's clean stop when the lock's
   * connection is lost (default: end of the process, code 1, so that a supervisor restarts it).
   */
  static async start(external: External, env: Record<string, string | undefined> = process.env, options: { onLockLoss?: (e: Error) => void } = {}): Promise<Orchestrator> {
    const config = readConfig(env);
    const lock = await Orchestrator.takeLock(config.databaseUrl, config.role);
    let orchestrator: Orchestrator | undefined;
    try {
      const pool = new pg.Pool({ connectionString: config.databaseUrl });
      const base = new Database(pool);
      const validator = new ReportValidator(config.reportSchemaPath);
      // Fail-closed: a missing, empty or booby-trapped (invisible character) instructions file = no startup.
      const instructions = loadInstructions(config.instructionsPath);
      const deps = { base, external, config, validator, instructions };
      configureSteps(config.retries, config.timeouts.operation_ms);
      newGeneration();
      // Step 6: the engine (orch_engine) neither creates nor modifies the DBOS schema (installed by src/migrate.ts, owner
      // account); DBOS only checks its version at launch and refuses to start if it is missing or behind.
      // S1: DBOS patching — constant application version ("PATCHING_ENABLED"), never computed from the source: a code
      // update resumes the workflows in place; a change of step sequence goes through DBOS.patch (README).
      // Queues listened to according to the role: only the pilot serves `control`, only the executor `agent-tasks` (the
      // all-in-one both). Emergency stop (`PAUSE_AGENTS=1`):
      // `agent-tasks` is no longer listened to, so no agent task starts any more; they stay queued (ENQUEUED) and start
      // again on a restart without pause. The W1s go on (messages, gates). The executor takes the DBOS id reserved for it.
      const files = [...(config.role === 'executor' ? [] : [CONTROL_QUEUE]), ...(config.role === 'pilot' || config.pauseAgents ? [] : [TASK_QUEUE])];
      DBOS.setConfig({ name: 'orchestrator', systemDatabaseUrl: config.databaseUrl, systemDatabaseSchemaName: 'dbos', enablePatching: true, logLevel: env['DBOS_LOG_LEVEL'] ?? 'warn', runMigrations: false, listenQueues: files, ...(config.role === 'executor' ? { executorID: EXECUTOR_VMID } : {}) });
      const agentTask = createAgentTask(deps);
      const toolCycle = createToolCycle(deps, agentTask);
      // S2: periodic monitoring = DBOS scheduled task (durable, one run per due time). M7: a tick stacks nothing behind a
      // sweep in progress.
      const monitoring = DBOS.registerWorkflow(async function monitoring(): Promise<void> {
        requirePilot(config, 'monitoring');
        if (orchestrator !== undefined && !orchestrator.#sweepInProgress) await orchestrator.sweep();
        const o = orchestrator;
        if (o !== undefined) await DBOS.runStep(() => o.purgeScheduled(), { name: 'purge' });
      }, { name: 'monitoring' });
      // E4: CI watcher, DBOS scheduled task; a single step (replayed whole if needed: sending again has no effect, B9).
      const watcher = DBOS.registerWorkflow(async function watcher(): Promise<void> {
        requirePilot(config, 'watcher');
        const o = orchestrator;
        if (o !== undefined) await DBOS.runStep(() => o.watch(), { name: 'watch' });
      }, { name: 'watcher' });
      // E0 (§8.16 M8): entries of the local API, one workflow per idempotency key (see `#byKey`). A workflow resumed at
      // launch waits until the orchestrator is ready.
      let ready!: (o: Orchestrator) => void;
      const orchestratorReady = new Promise<Orchestrator>((r) => { ready = r; });
      const api: Api = {
        request: DBOS.registerWorkflow(async function apiRequest(d: ToolRequest, actor: Actor) {
          requirePilot(config, 'apiRequest');
          return (await orchestratorReady).newRequest(d, actor);
        }, { name: 'apiRequest' }),
        // A single step: replayed whole after a hard stop (at least once); `send` applies a message only once per visit
        // anyway (B9).
        message: DBOS.registerWorkflow(async function apiMessage(cycleId: number, m: Message, roles: readonly Hat[]) {
          requirePilot(config, 'apiMessage');
          const o = await orchestratorReady;
          return DBOS.runStep(() => o.send(cycleId, m, roles), { name: 'send' });
        }, { name: 'apiMessage' }),
      };
      await DBOS.launch();
      // N slots in total, 3 at most for the same tool (partition per tool) — never more than N.
      // Written to the db by the last process started (`always_update`): pilot and executor receive the same value of
      // AGENT_CONCURRENCY (a single deployment variable).
      await DBOS.registerQueue(TASK_QUEUE, { globalConcurrency: config.agentConcurrency, partitionConcurrency: Math.min(3, config.agentConcurrency), minPollingIntervalMs: config.timeouts.polling_ms, onConflict: 'always_update' });
      await DBOS.registerQueue(CONTROL_QUEUE, { minPollingIntervalMs: config.timeouts.polling_ms, onConflict: 'always_update' });
      orchestrator = new Orchestrator(base, config, external, toolCycle, lock, options.onLockLoss ?? (() => process.exit(1)), api);
      ready(orchestrator);
      // The executor only runs agent tasks: neither monitoring of the cycles nor schedules (handled by the pilot).
      if (config.role !== 'executor') {
        await orchestrator.sweep({ atStartup: true });
        await DBOS.applySchedules([{ scheduleName: 'monitoring', workflowFn: monitoring, schedule: config.monitoringCron, queueName: CONTROL_QUEUE }]);
        // Fake forge: no real watcher (the fake watcher of main.ts sends the CI); a schedule left over from a previous startup is removed.
        if (external.forge.ciFinished !== undefined) await DBOS.applySchedules([{ scheduleName: 'watcher', workflowFn: watcher, schedule: config.watcherCron, queueName: CONTROL_QUEUE }]);
        else await DBOS.deleteSchedule('watcher');
      }
    } catch (e) {
      if (orchestrator !== undefined) await orchestrator.stop().catch(() => {});
      else await lock.end().catch(() => {});
      throw e;
    }
    const o = orchestrator;
    const loss = (reason: string) => void o.#lockLoss(reason);
    lock.removeAllListeners('error');
    lock.on('error', (e: Error) => loss(errorText(e)));
    lock.on('end', () => loss('lock connection closed'));
    return o;
  }

  /** D23: without the lock, the engine does not go on: clean stop, then `onLockLoss` (end of the process by default). */
  async #lockLoss(reason: string): Promise<void> {
    if (this.#stopped) return;
    console.error(`"single engine" lock lost (${reason}): stopping the engine`);
    await this.stop().catch((e: unknown) => console.error(`stop after losing the lock: ${errorText(e)}`));
    this.#onLockLoss(new Error(`"single engine" lock lost: ${reason}`));
  }

  stop(): Promise<void> {
    this.#stopping ??= (async () => {
      this.#stopped = true;
      await this.#sweepQueue.catch(() => {});
      newGeneration(); // the workflows still in memory suspend themselves at their next check, without writing anything
      await DBOS.shutdown({ deregister: true });
      await this.base.pool.end();
      // The lock is released last: a new engine starts only once this one is fully stopped.
      await this.#lock.end().catch(() => {});
    })();
    return this.#stopping;
  }

  /** End-user text of the dictionaries (`lang/*.json`), in the deployment's language. */
  #text(key: string, values?: Values): string {
    return text(this.config.language, key, values);
  }

  private async alertAdmin(cycleId: number, subject: string, values: Values, content: string): Promise<void> {
    await this.external.notifications.notify('admin', cycleId, this.#text(subject, values), `${content}\n${this.#text('mail.dashboardLink', { url: `${this.config.dashboardUrl}/cycles/${cycleId}` })}`)
      .catch((e: unknown) => console.error(`admin alert impossible (cycle ${cycleId}, ${subject}): ${errorText(e)}`));
  }

  /**
   * Workflow alive, of this process's application version and, if it is running (PENDING), of this executor: otherwise
   * nobody will ever resume it (DBOS resumes only its own, e.g. after a change of `DBOS__VMID`).
   */
  static isAlive(s: { status: string; applicationVersion?: string; executorId?: string } | null): boolean {
    return s !== null && (ALIVE as readonly string[]).includes(s.status) && s.applicationVersion === DBOS.applicationVersion && (s.status !== 'PENDING' || s.executorId === DBOS.executorID);
  }

  /**
   * A6 / B2: every open cycle must have a live W1. No workflow (stop between the creation of the cycle and the launch) →
   * launched; W1 really dead (ERROR, CANCELLED, MAX_RECOVERY_ATTEMPTS_EXCEEDED, or waiting at an executor that nobody
   * will resume) → its children stopped, tasks closed, cycle at the incident gate, then the W1 is resumed FROM THE
   * START under the same id (`DBOS.rewindWorkflow`, S1): it re-reads the state and the memory from the db (D22); the
   * messages it had not read are lost and will be asked for again (S5). A finished cycle whose W1 died before completing
   * its end is resumed the same way (notification, cleanup). Then the environments still served for a finished cycle or
   * an archived tool (removed, alert). The admin is warned each time. A cycle in error does not hold up the others:
   * alert and go on. A single sweep at a time; it runs only if this process still holds the lock (D23).
   * Returns what was done.
   */
  sweep(options: { atStartup?: boolean; only?: number } = {}): Promise<string[]> {
    const next = this.#sweepQueue.catch(() => {}).then(async () => {
      this.#sweepInProgress = true;
      try {
        return await this.#sweep(options);
      } finally {
        this.#sweepInProgress = false;
      }
    });
    this.#sweepQueue = next;
    return next;
  }

  async #sweep(options: { atStartup?: boolean; only?: number }): Promise<string[]> {
    if (this.#stopped) return [];
    try {
      await this.#lock.query('SELECT 1');
    } catch (e) {
      void this.#lockLoss(`lock connection unreachable (${errorText(e)})`);
      return [];
    }
    const done: string[] = [];
    // Open cycles, plus the finished cycles whose W1 died before completing its end (public DBOS list).
    const ages = new Map((await this.base.openCycles()).map((c) => [c.id, c.age_ms]));
    const dead = await DBOS.listWorkflows({ workflowName: 'toolCycle', status: [...DEAD], loadInput: false, loadOutput: false });
    const cycles = new Set([...ages.keys(), ...dead.map((w) => Number(w.workflowID.slice('cycle-'.length)))]);
    for (const id of [...cycles].sort((a, b) => a - b)) {
      if (this.#stopped) break;
      if (options.only !== undefined && id !== options.only) continue;
      try {
        const action = await this.#sweepCycle(id, ages.get(id) ?? Infinity, options.atStartup === true);
        if (action !== null) done.push(action);
      } catch (e) {
        done.push(`cycle ${id}: sweep error (${errorText(e)})`);
        await this.alertAdmin(id, 'mail.sweepFailed.subject', { cycle: id }, this.#text('mail.sweepFailed.body', { cycle: id, error: errorText(e) }));
      }
    }
    if (options.only !== undefined || this.#stopped) return done;
    try {
      done.push(...(await this.#orphanEnvironments()));
    } catch (e) {
      done.push(`monitoring error (${errorText(e)})`);
      await this.alertAdmin(0, 'mail.monitoringIncomplete.subject', {}, this.#text('mail.monitoringIncomplete.body', { error: errorText(e) }));
    }
    return done;
  }

  /**
   * G1: decides on the REAL state at the time the cycle is handled, never on the snapshot of the list: DBOS status read
   * first, cycle re-read next (a W1 finishes only after the end of its cycle, so `SUCCESS` read first implies a finished
   * cycle). A workflow alive or finished (SUCCESS on a finished cycle): nothing to do, neither end replayed nor alert.
   */
  async #sweepCycle(id: number, age_ms: number, atStartup: boolean): Promise<string | null> {
    const wf = cycleWorkflowId(id);
    const s = await DBOS.getWorkflowStatus(wf);
    if (Orchestrator.isAlive(s)) return null;
    const open = !(await this.base.cycleFinished(id));
    if (!open && (s === null || s.status === 'SUCCESS')) return null; // end done (or DBOS history purged): nothing to resume
    if (s === null) {
      if (!atStartup && age_ms < NO_WORKFLOW_GRACE_MS) return null;
      await DBOS.startWorkflow(this.toolCycle, { workflowID: wf, queueName: CONTROL_QUEUE })(id);
      await this.alertAdmin(id, 'mail.cycleRelaunched.subject', { cycle: id }, this.#text('mail.cycleRelaunched.body', { cycle: id }));
      return `cycle ${id}: launched again (no workflow)`;
    }
    const why = (ALIVE as readonly string[]).includes(s.status)
      ? this.#text('deadWorkflow.waitingElsewhere', { executor: s.executorId ?? '?', version: s.applicationVersion ?? '?' })
      : `${s.status}${s.error === undefined || s.error === null ? '' : ` (${errorText(s.error)})`}`;
    // The W1 (if it still waits elsewhere) and its children are stopped: nothing runs any more for this cycle before the resume.
    if ((ALIVE as readonly string[]).includes(s.status)) await DBOS.cancelWorkflow(wf);
    await stopChildren(wf);
    await this.base.failOpenTasks(id, this.config.thresholds.task, `workflow of the cycle stopped (${s.status})`);
    // State re-read after the stop: a stopped execution may have written a last transition in the meantime.
    let c = await this.base.readCycle(id);
    if (c.finished_at === null && c.state !== 'gate_incident') {
      const memory = await this.base.readMemory(id);
      memory.reasonBeforeIncident = memory.gateReason;
      memory.gateReason = this.#text('gate.incident.deadWorkflow', { state: c.state, why });
      try {
        await this.base.transition(id, c.state, 'incident', 'gate_incident', undefined, undefined, memory);
      } catch (e) {
        // The cycle moved during this handling (last write of the stopped execution): re-read; if it is still open,
        // new attempt at the next sweep (no resume launched on an uncertain state).
        c = await this.base.readCycle(id);
        if (c.finished_at === null) throw e;
      }
    }
    // S1: same id, DBOS history erased, new execution from the start; a stopped execution still in memory can no
    // longer record anything (DBOS ownership token).
    await DBOS.rewindWorkflow(wf, { queueName: CONTROL_QUEUE });
    if (c.finished_at !== null) {
      await this.alertAdmin(id, 'mail.endResumed.subject', { cycle: id, status: s.status }, this.#text('mail.endResumed.body', { cycle: id, state: c.state, why }));
      return `cycle ${id}: end run again (workflow ${s.status})`;
    }
    await this.alertAdmin(id, 'mail.workflowStopped.subject', { cycle: id, status: s.status }, this.#text('mail.workflowStopped.body', { state: c.state, why }));
    return `cycle ${id}: workflow ${s.status} resumed, incident from ${c.state}`;
  }

  /**
   * Point 1 (2nd round, approved): no environment served for a finished cycle (mock-up, Preview) nor a Prod for an archived
   * tool, once the cycle's end is done (W1 finished): removal (per cycle, G4) and admin alert.
   */
  async #orphanEnvironments(): Promise<string[]> {
    const done: string[] = [];
    const endDone = async (cycleId: number): Promise<boolean> => {
      if (!(await this.base.cycleFinished(cycleId))) return false;
      const s = await DBOS.getWorkflowStatus(cycleWorkflowId(cycleId));
      return s === null || s.status === 'SUCCESS';
    };
    for (const o of await this.base.tools()) {
      for (const env of ['mockup', 'preview', 'prod'] as Environment[]) {
        const served = await this.external.deployer.served(env, o.slug);
        if (served === null || (env === 'prod' && !o.archived) || !(await endDone(served.cycleId))) continue;
        await this.external.deployer.remove(env, o.slug, served.cycleId);
        const why = env === 'prod' ? { key: 'orphan.toolArchived', values: { slug: o.slug } } : { key: 'orphan.cycleFinished', values: { cycle: served.cycleId } };
        await this.alertAdmin(served.cycleId, 'mail.stillServed.subject', { env, slug: o.slug }, this.#text('mail.stillServed.body', { env, slug: o.slug, digest: served.digest, why: this.#text(why.key, why.values) }));
        done.push(`${env} of ${o.slug} (cycle ${served.cycleId}) removed: ${env === 'prod' ? `tool ${o.slug} archived` : `cycle ${served.cycleId} finished`}`);
      }
    }
    return done;
  }

  /**
   * E4, watcher (§8.16 M8): for each cycle waiting for CI, asks the forge for the result of the CI of the round's squash and
   * sends it (`ci_finished`); nothing while it runs. No state of its own: sending again has no effect (B9). An error on a
   * cycle is logged and does not stop the others; a CI never read ends at the delivery gate (the state's timeout).
   */
  async watch(): Promise<string[]> {
    const forge = this.external.forge;
    if (forge.ciFinished === undefined || this.#stopped) return [];
    const done: string[] = [];
    for (const { id } of await this.base.openCycles()) {
      try {
        const c = await this.base.readCycle(id);
        if (c.state === 'preview_pipeline') {
          const r = await this.#pipelinePreview(c);
          if (r !== null) done.push(r);
          continue;
        }
        if (c.state !== 'waiting_ci') continue;
        const r = await forge.ciFinished(c.slug, id, await this.base.lastIteration(id, HARDENING_ROLES));
        if (r === null) continue;
        const e = await this.send(id, { type: 'ci_finished', ...r });
        done.push(`cycle ${id}: CI ${r.outcome}${e.transmitted ? '' : ` not passed on (${e.reason})`}`);
      } catch (e) {
        done.push(`cycle ${id}: watcher error (${errorText(e)})`);
        console.error(`watcher, cycle ${id}: ${errorText(e)}`);
      }
    }
    return done;
  }

  /**
   * E5f: Preview pipeline of a cycle in `preview_pipeline`. The run to read is the first above the id W1 recorded when it
   * started the pipeline IN THIS PASSAGE (step output, not older than the entry in the state). Then `served`: the results
   * hold for one digest only (§8.4), so a Preview that no longer serves the candidate digest adds a red `preview_changed`.
   */
  async #pipelinePreview(c: Cycle): Promise<string | null> {
    const forge = this.external.forge;
    if (forge.previewPipelineFinished === undefined) return null;
    const steps = (await DBOS.listWorkflowSteps(cycleWorkflowId(c.id))) ?? [];
    const launched = steps.filter((e) => e.name === LAUNCH_PREVIEW_PIPELINE_STEP && e.error === null && (e.startedAtEpochMs ?? 0) >= c.entry_ms).at(-1);
    if (launched === undefined || typeof launched.output !== 'number') return null;
    const r = await forge.previewPipelineFinished(c.slug, launched.output);
    if (r === null) return null;
    const served = await this.external.deployer.served('preview', c.slug);
    const candidate = await this.base.candidateDigest(c.id);
    const checks = served !== null && served.digest === candidate ? r.checks : [...r.checks, { check: 'preview_changed', result: 'red' as const }];
    const outcome = checks.some((k) => k.result === 'red') ? 'red' : 'green';
    const e = await this.send(c.id, { type: 'preview_pipeline_finished', outcome: outcome, checks: checks });
    return `cycle ${c.id}: Preview pipeline ${outcome}${e.transmitted ? '' : ` not passed on (${e.reason})`}`;
  }

  /**
   * DBOS history of the scheduled tasks (watcher every 30 s ≈ 2,900 runs a day, monitoring): the SUCCESSFUL runs finished
   * more than `keepMs` ago (one day) are deleted, 1,000 at most per call (the monitoring catches up 288,000 a day). Public
   * DBOS functions (`listWorkflows` by `scheduleName`, `deleteWorkflows`), not its global retention (`garbageCollect`,
   * reserved for Conductor): it would also delete the finished W1s and W2s and the API's idempotency keys (`api-<key>`,
   * a replayed key would redo the request). Never a cycle, nor a failed run (diagnosis); the audit log is in the
   * application db (`tool_history`), outside DBOS.
   */
  async purgeScheduled(keepMs = 86_400_000): Promise<number> {
    const old = await DBOS.listWorkflows({ scheduleName: ['watcher', 'monitoring'], status: 'SUCCESS', completedBefore: new Date(Date.now() - keepMs).toISOString(), limit: 1_000, loadInput: false, loadOutput: false });
    if (old.length > 0) await DBOS.deleteWorkflows(old.map((w) => w.workflowID));
    return old.length;
  }

  /**
   * E0 (§8.16 M8): new request or message coming from the local API, idempotent by key AND by person (I0): the key is the
   * id of the DBOS workflow (`api-<actor>-<key>`), which keeps the result (or the error); a replay returns it as is,
   * without redoing anything; Alice's key replayed by Bob is another request. The same key, by the same person, with
   * another content or for another route: `IdempotencyConflict`.
   */
  async requestByKey(key: string, d: ToolRequest, actor: Actor): Promise<{ tool_id: number; cycle_id: number; workflow_id: string }> {
    return this.#byKey(`${actor.id}-${key}`, 'apiRequest', [d, actor], () => DBOS.startWorkflow(this.#api.request, { workflowID: `api-${actor.id}-${key}`, queueName: CONTROL_QUEUE })(d, actor));
  }

  async messageByKey(key: string, cycleId: number, m: Message, actor: Actor): Promise<SendResult> {
    return this.#byKey(`${actor.id}-${key}`, 'apiMessage', [cycleId, m, actor.roles], () => DBOS.startWorkflow(this.#api.message, { workflowID: `api-${actor.id}-${key}`, queueName: CONTROL_QUEUE })(cycleId, m, actor.roles));
  }

  async #byKey<T>(key: string, name: string, input: unknown[], launch: () => Promise<{ getResult(o: { pollingIntervalMs: number }): Promise<T> }>): Promise<T> {
    const id = `api-${key}`;
    const already = await DBOS.getWorkflowStatus(id);
    const conflict = (s: { workflowName: string; input?: unknown[] } | null) => s !== null && (s.workflowName !== name || !isDeepStrictEqual(s.input, input));
    if (conflict(already)) throw new IdempotencyConflict(`idempotency key ${key} already used for another request`);
    const h = await launch();
    // Two simultaneous first sends of the same key: DBOS returns the first one's workflow; its content must be the same.
    if (already === null && conflict(await DBOS.getWorkflowStatus(id))) throw new IdempotencyConflict(`idempotency key ${key} already used for another request`);
    // DBOS polls a queued workflow's result every second by default: without this the API answers up to 1 s late.
    return h.getResult({ pollingIntervalMs: this.config.timeouts.polling_ms });
  }

  /**
   * E0: health for the container's check: null if the engine runs and reaches its db, otherwise the reason. The loss
   * of the lock (D23) stops the engine (`#lockLoss`): it shows here as `engine stopped`.
   */
  async health(): Promise<string | null> {
    if (this.#stopped) return 'engine stopped';
    if (!DBOS.isInitialized()) return 'DBOS not launched';
    try {
      await this.base.pool.query('SELECT 1');
    } catch (e) {
      return `database unreachable (${errorText(e)})`;
    }
    return null;
  }

  /**
   * New request from an authenticated person (hat requester or admin, known e-mail address: they will receive the
   * notifications, E1): tool (creation) + cycle + W1 workflow, budgets per cycle (D2).
   */
  async newRequest(d: ToolRequest, actor: Actor): Promise<{ tool_id: number; cycle_id: number; workflow_id: string }> {
    const invalid = validateRequest(d);
    if (invalid !== null) throw new Error(`request refused: ${invalid}`);
    if (!actor.roles.includes('requester') && !actor.roles.includes('admin')) throw new AuthorizationError('request refused: requester or admin hat required');
    if ((await this.base.actorMail(actor.id)) === null) throw new Error('request refused: no mail address known for you (the token carries no email); the notifications go out by mail');
    // DBOS step when the request comes from the API (workflow `apiRequest`): created only once even if this workflow is resumed.
    const { tool_id: tool_id, cycle_id } = await DBOS.runStep(() => this.base.createRequest(d, actor.id, { scoping: this.config.thresholds.scoping.budget_usd, hardening: this.config.thresholds.hardening.budget_usd }), { name: 'create the request' });
    const workflowId = cycleWorkflowId(cycle_id);
    try {
      await DBOS.startWorkflow(this.toolCycle, { workflowID: workflowId, queueName: CONTROL_QUEUE })(cycle_id);
    } catch (e) {
      // A6: the cycle exists without a workflow; the sweep at the next startup will launch it. The admin and the caller know.
      await this.alertAdmin(cycle_id, 'mail.createdWithoutWorkflow.subject', { cycle: cycle_id }, this.#text('mail.createdWithoutWorkflow.body', { error: errorText(e) }));
      throw new Error(`cycle ${cycle_id} created but its workflow not launched (${errorText(e)}): it will be launched at the next startup`);
    }
    return { tool_id: tool_id, cycle_id, workflow_id: workflowId };
  }

  /**
   * Sends a message to the cycle after fully validating it (A5) then checking it against the machine: refused (error)
   * if it is invalid or irrelevant in the current state. Abandonment after the merge is refused and the admin warned
   * (scenario 15 bis). B2: if the cycle's workflow is no longer alive, it is resumed (incident) and the message is
   * refused with the reason (except cancellation, and a message for the incident gate where the cycle stayed). The message
   * carries the current visit of the state (B9): a double send is applied only once. C: if the cycle changed state
   * during the send, the message is not delivered and the caller knows (check made under lock, at the delivery itself). S4: cancellation also stops the child
   * workflows, which wakes W1 up if it waits for a task or an operation.
   * I0: `roles` = the sender's hats (token); a human message without the required hat is refused
   * (`AuthorizationError`); the hat retained (and the four-eyes exemption) are set on the delivered message.
   */
  async send(cycleId: number, m: Message, roles: readonly Hat[] = []): Promise<SendResult> {
    const invalid = validateMessage(m);
    if (invalid !== null) throw new Error(`message ${String((m as { type?: unknown }).type)} refused: ${invalid}`);
    // Actor merge (0010): the person is their canonical actor, whatever id the caller knows.
    if (isHuman(m)) m = { ...m, actor_id: await this.base.canonicalActor(m.actor_id) };
    const c = await this.base.readCycle(cycleId);
    const authorization = await this.verifier(c, m, roles);
    if (authorization !== undefined) m = { ...m, ...authorization } as Message;
    if (m.type === 'requester_abandonment' && AFTER_MERGE.has(c.state)) {
      await this.external.notifications.notify('admin', c.id, this.#text('mail.abandonAfterMerge.subject', { tool: c.name }), this.#text('mail.abandonAfterMerge.body', { cycle: c.id }));
      throw new Error('After the merge, only the admin can cancel the cycle');
    }
    const wf = cycleWorkflowId(cycleId);
    if (!Orchestrator.isAlive(await DBOS.getWorkflowStatus(wf))) {
      const done = await this.sweep({ only: cycleId });
      // Cancellation holds whatever the state. M3: another message too, if the cycle stayed in the same visit (it was
      // already at this gate, e.g. the incident gate); otherwise it targeted a state the incident has left.
      const after = await this.base.readCycle(cycleId);
      if (m.type !== 'cancellation' && (after.state !== c.state || after.visit !== c.visit)) {
        throw new Error(`workflow of cycle ${cycleId} stopped: message ${m.type} not passed on; ${done.join('; ') || 'restart in progress'}`);
      }
      if (!Orchestrator.isAlive(await DBOS.getWorkflowStatus(wf))) {
        throw new Error(`workflow of cycle ${cycleId} stopped and not resumed yet: message ${m.type} not passed on; ${done.join('; ') || 'new try at the next sweep'}`);
      }
    }
    // C: the cycle is held in its visit during the delivery (no transition goes through). The check is therefore on the
    // moment of delivery, never on what W1 did with the message afterwards: a message consumed at once is not
    // "irrelevant", and a W1 that finished normally before is not taken for dead.
    const repo = await this.base.retainCycle(cycleId, async (after): Promise<string | boolean> => {
      // Cancellation holds in any non-final state; any other message, for the visit in which it was checked.
      if (m.type === 'cancellation' ? after.finished_at !== null : after.state !== c.state || after.visit !== c.visit) {
        return `cycle ${cycleId} went from ${c.state} to ${after.state} during the send: message ${m.type} no longer relevant`;
      }
      if (m.type === 'cancellation') {
        // In the mailbox (seen during any wait), on its topic (seen at the start of each state, even a transient one).
        await DBOS.send(wf, m, MAILBOX);
        await DBOS.send(wf, m, CANCELLATION_TOPIC);
      } else {
        await DBOS.send(wf, { ...m, visit: c.visit }, MAILBOX);
      }
      // M2: `transmitted` only if the message really is at a live workflow.
      return Orchestrator.isAlive(await DBOS.getWorkflowStatus(wf));
    });
    if (typeof repo === 'string') return { transmitted: false, reason: repo };
    // S4: then the children are stopped (outside the lock: W1 must be able to transition); W1, waiting for their end, wakes up and reads the cancellation.
    if (m.type === 'cancellation') await stopChildren(wf);
    // Died between the check and the delivery: it is resumed at once, without its unread messages (S5: asked for again after "retry").
    if (!repo) {
      await this.sweep({ only: cycleId });
      return { transmitted: false, reason: `workflow of cycle ${cycleId} stopped during the send: message ${m.type} not passed on (the cycle is at the incident gate; send it again after "retry")` };
    }
    return { transmitted: true };
  }

  /** True if the message would be accepted by `send` in the cycle's current state. */
  async isExpected(cycleId: number, m: Message): Promise<boolean> {
    try {
      if (validateMessage(m) !== null) return false;
      await this.verifier(await this.base.readCycle(cycleId), m);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * I0: who may do what. Gate decision and cancellation = `admin`; feedback, abandonment, message = the tool's requester
   * (or an admin). Four eyes: the Gate 2 approval is not given by the tool's requester, unless the subject named by
   * `FOUR_EYES_EXEMPTION_SUBJECT` is that person — then recorded. `roles` missing (state check only, `isExpected`):
   * no authorisation checked.
   */
  private async authorize(c: Cycle, m: Extract<Message, { actor_id: string }>, roles: readonly Hat[]): Promise<Authorization> {
    const admin = roles.includes('admin');
    if (m.type === 'decision' || m.type === 'cancellation') {
      if (!admin) throw new AuthorizationError(`${m.type === 'decision' ? `decision at gate ${m.gate}` : 'cancellation'} refused: admin hat required`);
      let exemption = false;
      if (m.type === 'decision' && c.state === 'gate_2' && m.outcome === 'approved' && m.actor_id === c.requester_id) {
        const subject = this.config.fourEyesExemptionSubject;
        const allowed = subject === '' ? null : await this.base.actorByIdentity(this.config.oidc.issuer, subject);
        if (allowed === null || allowed !== m.actor_id) throw new AuthorizationError(`Gate 2 approval refused: four eyes, the requester of tool ${c.slug} does not approve their own delivery`);
        exemption = true;
        DBOS.logger.warn(`cycle ${c.id}: four-eyes exemption used by actor ${m.actor_id} (FOUR_EYES_EXEMPTION_SUBJECT)`);
      }
      return { hat: 'admin', four_eyes_exemption: exemption };
    }
    return { hat: hatOnTool(c, m.actor_id, roles, `message ${m.type}`), four_eyes_exemption: false };
  }

  private async verifier(c: Cycle, m: Message, roles?: readonly Hat[]): Promise<Authorization | undefined> {
    if (NATURE.get(c.state) === 'end') throw new Error(`cycle ${c.id} finished (${c.state}): message ${m.type} refused`);
    const authorization = roles !== undefined && isHuman(m) ? await this.authorize(c, m, roles) : undefined;
    if (m.type === 'cancellation') return authorization;
    if (m.type === 'decision') {
      if (c.state !== m.gate) throw new Error(`no decision expected for ${m.gate}: cycle ${c.id} is in state ${c.state}`);
      if (!gateOutcomes(c.state as StateId).has(m.outcome)) throw new Error(`outcome ${m.outcome} impossible at gate ${m.gate}`);
      if (m.budget_top_up_usd !== undefined && topUpEnvelope(c.state) === null) throw new Error(`top-up meaningless at gate ${m.gate}: only the scoping, contract and hardening gates have a budget`);
      // C: at Gate 2, the admin quotes the digest they approve.
      if (c.state === 'gate_2' && m.outcome === 'approved' && m.digest === undefined) throw new Error('Gate 2 approval refused: the approved digest must be cited');
      if (m.digest !== undefined) {
        if (c.state !== 'gate_2') throw new Error(`digest meaningless at gate ${m.gate}: only Gate 2 approves a digest`);
        // B1: a Gate 2 decision is exactly about the candidate digest (CI + Preview + pipeline).
        const candidate = await this.base.candidateDigest(c.id);
        if (m.digest !== candidate) throw new Error(`digest ${m.digest} refused: the candidate digest of Gate 2 is ${candidate ?? '(none)'}`);
      }
      return authorization;
    }
    if (m.type === 'requester_abandonment' && AFTER_MERGE.has(c.state)) return authorization; // handled (refused) by the caller
    if (!ALLOWED.has(`${c.state} ${eventKey(m)}`)) throw new Error(`message ${m.type} not relevant in state ${c.state} (cycle ${c.id})`);
    return authorization;
  }
}
