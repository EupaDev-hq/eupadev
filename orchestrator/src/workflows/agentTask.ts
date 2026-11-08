/**
 * W2 `agentTask`: an agent task in the DBOS queue (concurrency N, at most 3 per tool).
 * Starts the task, calls the engine through the fixed contract, validates the report against the schema
 * (fail-closed: invalid → failed) and writes `tasks` (unknown cost = the task's cap). The budget check is
 * done by W1 once per round (D11), never here.
 *
 * B7: each container launch is counted (`tasks.executions`) by the engine's `launched` callback, right before the agent's
 * container starts; an execution cut short by an abrupt stop (replayed by DBOS) after that point never returned its cost: it is
 * charged the role's cap on top of the cost of the one that completes — never forgotten. An execution cut short BEFORE the
 * container started (pause of the executor during the clone, task closed while queued…) costs nothing: no model ran (paid
 * cycle 9: two tasks paused then resumed were charged a cap each for nothing). A failed task whose engine reported its
 * cost is charged that cost; the cap stands in for the cost only when it is unknown, and the record then says so.
 *
 * S4: W1 waits for the NATIVE end of this workflow (DBOS status); no message. If starting or recording fails after
 * the retries, the workflow ends in ERROR and W1 closes the task as failed at the cap (A4). The task timeout is enforced
 * by a race against the timer: an engine that ignores the stop signal no longer blocks the queue. The engine output
 * is bounded (cost, duration, tree digest): an out-of-format value gives a failed task, never an SQL constraint
 * violation.
 *
 * Launcher, step 0: at start, W2 writes the role's model and effort and the sha256 digest of the instructions (computed
 * here, outside the engine), then frozen by the database; the engine receives these values read back from the database
 * and the task's branch. A task closed as done gets `verdict_source = 'agent'` (the CI will switch it to 'ci' with its
 * `ci_green` result, only once: `Database.ciVerdict`).
 */
import { createHash } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { Effort, Role, TaskOutput } from '../external/contracts.ts';
import { CODE_ROLES } from '../external/contracts.ts';
import { taskTimeoutMs } from '../config.ts';
import { step, singleStep, currentGeneration, alive, type Deps } from './deps.ts';

export interface TaskArgs {
  task_id: string;
  tool: string;
  role: Role;
  instructions: string;
  context: Record<string, unknown>;
}

interface Result {
  status: 'done' | 'blocked' | 'failed';
  report: unknown;
  cost_usd: number;
  duration_s: number;
  tree_hash: string | null;
  /** Missing: unknown tokens, the database keeps its value. */
  tokens?: { input: number; output: number } | undefined;
}

/** What the start fixed in the database for the task (read back, so that the engine receives exactly what is recorded). */
interface Launch {
  model: string;
  effort: Effort;
  branch: string | null;
}

const TREE = /^[0-9a-f]{64}$/;

/** What, in the engine output, would violate the `tasks` schema (A4); null if everything is within bounds. */
export function outputOutOfBounds(output: TaskOutput, role: Role): string | null {
  const c = output.cost_usd;
  if (c !== null && (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100_000)) return `invalid declared cost (${String(c)})`;
  const d = output.duration_s;
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 2_147_483_647) return `invalid declared duration (${String(d)})`;
  if ((CODE_ROLES as readonly string[]).includes(role) && output.tree_hash !== null && !(typeof output.tree_hash === 'string' && TREE.test(output.tree_hash))) {
    return `tree digest out of format (${String(output.tree_hash).slice(0, 80)})`;
  }
  const t = output.tokens;
  if (t !== undefined && !(typeof t === 'object' && t !== null && [t.input, t.output].every((n) => Number.isSafeInteger(n) && n >= 0))) {
    return `invalid declared tokens (${JSON.stringify(t)?.slice(0, 80)})`;
  }
  return null;
}

export function createAgentTask(deps: Deps) {
  const { base, external, config, validator } = deps;
  const generation = currentGeneration();

  async function execute(args: TaskArgs, launch: Launch): Promise<Result> {
    // A-R5: caps of the task's role (duration, turns, budget); TASK_TIMEOUT_MS imposes the duration on all (tests, lab).
    const cap = config.thresholds.task[args.role];
    // Launches that never reported a cost: earlier executions cut short (`before`, B7), plus this one once its container
    // started (`launched`). Each is charged the role's cap, and the record says so: a bound, not a measure.
    let before = 0;
    let launched = false;
    const estimated = (reason: string, unknown: number): string =>
      unknown === 0 ? reason : `${reason} (cost unknown: ${unknown} execution(s) cut short without a reported cost, each charged the role's cap of $${cap.budget_usd})`;
    const failure = (reason: string, duration_s = 0, cut = launched): Result => {
      const unknown = before + (cut ? 1 : 0);
      return { status: 'failed', report: { status: 'failed', reason: estimated(reason, unknown) }, cost_usd: unknown * cap.budget_usd, duration_s: duration_s, tree_hash: null };
    };
    const { branch: branch } = launch;
    // typeof: also a resume point from before step 0 (`start` returned a boolean); fail-closed.
    if (typeof branch !== 'string') return failure('task without a branch: the launcher would not know where to push');
    const check = new AbortController();
    const timer = setTimeout(() => check.abort(`task timeout exceeded (${cap.duration_min} min)`), taskTimeoutMs(config.timeouts, cap));
    const cancellation = DBOS.stepStatus?.cancelSignal;
    const onCancellation = () => check.abort('cycle cancellation');
    cancellation?.addEventListener('abort', onCancellation, { once: true });
    // The timeout is enforced (A4): we do not wait for an engine that would ignore the stop signal.
    const abandon = new Promise<never>((_, reject) => check.signal.addEventListener('abort', () => reject(new Error(`interrupted: ${String(check.signal.reason)}`)), { once: true }));
    const start = Date.now();
    const elapsed = () => Math.round((Date.now() - start) / 1000);
    try {
      // B7: launches of earlier executions, cut short before returning their cost (replay): each one at the cap.
      const executions = (await base.pool.query<{ n: number }>(`SELECT executions AS n FROM tasks WHERE id = $1 AND status = 'in_progress'`, [args.task_id])).rows[0]?.n;
      // Task closed in the meantime (cancellation, incident): the engine is not called.
      if (executions === undefined) return failure('task closed before the execution');
      before = executions;
      // Counted BEFORE the container starts (the engine calls it right before): an execution cut short after this point is
      // never forgotten; a task closed meanwhile refuses the launch (the engine does not start the container).
      const launching = async () => {
        const n = (await base.pool.query<{ n: number }>(`UPDATE tasks SET executions = executions + 1 WHERE id = $1 AND status = 'in_progress' RETURNING executions AS n`, [args.task_id])).rows[0]?.n;
        if (n === undefined) throw new Error('task closed before the launch of its container');
        launched = true;
      };
      const output = await Promise.race([external.engine.execute({ ...args, model: launch.model, effort: launch.effort, branch, cap, signal: check.signal, launched: launching }), abandon]);
      const outOfBounds = outputOutOfBounds(output, args.role);
      // The engine returned something: it may have spent (cap), even if it never said it launched.
      if (outOfBounds !== null) return failure(`invalid engine output: ${outOfBounds}`, elapsed(), true);
      const unknown = before + (output.cost_usd === null ? 1 : 0);
      const cost = (output.cost_usd ?? cap.budget_usd) + before * cap.budget_usd;
      const tree = (CODE_ROLES as readonly string[]).includes(args.role) ? output.tree_hash : null;
      if (output.report === null) {
        const reason = estimated(output.error ?? 'no report produced', unknown);
        return { status: 'failed', report: { status: 'failed', reason: reason }, cost_usd: cost, duration_s: output.duration_s, tree_hash: tree, tokens: output.tokens };
      }
      const v = validator.validate(output.report, { role: args.role, task_id: args.task_id });
      if (!v.valid) {
        const reason = `invalid report: ${v.errors}`;
        return { status: 'failed', report: { status: 'failed', reason: reason, received_report: output.report }, cost_usd: cost, duration_s: output.duration_s, tree_hash: tree, tokens: output.tokens };
      }
      const r = v.report;
      if (r.status === 'done') return { status: 'done', report: r, cost_usd: cost, duration_s: output.duration_s, tree_hash: tree, tokens: output.tokens };
      if (r.status === 'blocked') return { status: 'blocked', report: r, cost_usd: cost, duration_s: output.duration_s, tree_hash: tree, tokens: output.tokens };
      return { status: 'failed', report: r, cost_usd: cost, duration_s: output.duration_s, tree_hash: tree, tokens: output.tokens };
    } catch (e) {
      // Thrown or interrupted (timeout, cancellation, infrastructure): the cap only if the container had started.
      return failure(e instanceof Error ? e.message : String(e), elapsed());
    } finally {
      clearTimeout(timer);
      cancellation?.removeEventListener('abort', onCancellation);
    }
  }

  return DBOS.registerWorkflow(async function agentTask(args: TaskArgs): Promise<void> {
    await alive(generation);
    const { model: model, effort } = config.models[args.role];
    const instructions = createHash('sha256').update(args.instructions, 'utf8').digest('hex');
    // coalesce: on replay, the value already written prevails (the database refuses to change it).
    const launch = await step('start', async () =>
      (await base.pool.query<Launch>(
        `UPDATE tasks SET status = 'in_progress', started_at = coalesce(started_at, now()), model = coalesce(model, $2), effort = coalesce(effort, $3),
         instructions_sha256 = coalesce(instructions_sha256, $4) WHERE id = $1 AND status IN ('queued', 'in_progress') RETURNING model, effort, branch`,
        [args.task_id, model, effort, instructions],
      )).rows[0] ?? null);
    if (launch === null) return; // task already closed by W1 (cancellation, incident): nothing to execute
    const r = await singleStep('execute', () => execute(args, launch));
    await step('record', async () => {
      await base.pool.query(
        `UPDATE tasks SET status = $2, report = $3, cost_usd = $4, duration_s = $5, tree_hash = $6, input_tokens = coalesce($7, input_tokens),
         output_tokens = coalesce($8, output_tokens), verdict_source = CASE WHEN $2 = 'done' THEN 'agent' END, ended_at = now() WHERE id = $1 AND status = 'in_progress'`,
        [args.task_id, r.status, JSON.stringify(r.report), r.cost_usd, r.duration_s, r.tree_hash, r.tokens?.input ?? null, r.tokens?.output ?? null],
      );
    });
  }, { name: 'agentTask' });
}

export type AgentTask = ReturnType<typeof createAgentTask>;
