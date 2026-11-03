/** Dependencies shared by the workflows: database, outside world, configuration, report validator. */
import { DBOS } from '@dbos-inc/dbos-sdk';
import { PermanentError, type Database } from '../db.ts';
import type { Config, Retries } from '../config.ts';
import type { External } from '../external/contracts.ts';
import type { ReportValidator } from '../agent-engine/report.ts';
import type { InstructionsByRole } from '../agent-engine/instructions.ts';

export interface Deps {
  base: Database;
  external: External;
  config: Config;
  validator: ReportValidator;
  /** Instructions of each role, read from the engine image at startup (never from the cloned repository). */
  instructions: InstructionsByRole;
}

export const TASK_QUEUE = 'agent-tasks';
/**
 * Queue of ALL the pilot's workflows (W1, operations, API, monitoring, watcher), listened to by the pilot alone. Without it,
 * DBOS puts a resumed workflow back in its internal queue, which any process serves, the executor included. No
 * concurrency limit: a W1 never waits for a slot.
 */
export const CONTROL_QUEUE = 'control';

/**
 * Second-line guard: a pilot workflow taken by the executor (W1 started before the `control` queue, resumed in DBOS's
 * internal queue) fails at once, doing nothing; the pilot's monitoring sees it dead and resumes it on the pilot (incident
 * gate, A6/B2).
 */
export function requirePilot(config: Config, workflow: string): void {
  if (config.role === 'executor') throw new Error(`${workflow}: pilot workflow taken by the executor, refused (the pilot's monitoring will resume it)`);
}
/** W1 workflow of a cycle: always `cycle-<id>`; a dead W1 is resumed under the same id (`DBOS.rewindWorkflow`). */
export const cycleWorkflowId = (cycleId: number) => `cycle-${cycleId}`;
export const taskWorkflowId = (taskId: string) => `task-${taskId}`;
/** DBOS topic where the cancellation is also posted, to be seen at the start of every state, even a transient one (E15). */
export const CANCELLATION_TOPIC = 'cancellation';
/** DBOS statuses of a workflow that is still running (or about to run). */
export const ALIVE = ['PENDING', 'ENQUEUED', 'DELAYED'] as const;

let retries: Retries = { attempts: 5, interval_ms: 1000 };
/** B1: maximum duration of a step attempt (database, service); beyond it, the attempt fails (then retry, then incident). */
let stepTimeoutMs = 10 * 60_000;

/**
 * Generation of the orchestrator in this process: incremented at each start and each stop. A workflow left in
 * memory after `DBOS.shutdown()` (DBOS abandons it without interrupting it) must no longer do anything: without this
 * check, after a new `DBOS.launch()` in the same process, it would act on the new engine with its old
 * id (tests). In production, the process exits after `stop()`: no effect.
 */
let generation = 0;
export const newGeneration = (): number => ++generation;
export const currentGeneration = (): number => generation;
/** Orchestrator stopped (or stopping): the workflow suspends without writing anything; it will resume at the next start. */
export async function alive(own: number): Promise<void> {
  if (own !== generation || !DBOS.isInitialized()) await new Promise<never>(() => {});
}
/** Set at startup from the configuration (A3, B1). */
export function configureSteps(r: Retries, attemptTimeoutMs: number): void {
  retries = r;
  stepTimeoutMs = attemptTimeoutMs;
}

/**
 * S4: stops (DBOS cancellation) the still-alive child workflows of a W1 — tasks (W2) and outside operations.
 * A W1 waiting for the native result of a child wakes up at once (child CANCELLED).
 */
export async function stopChildren(parent: string): Promise<void> {
  const children = await DBOS.listWorkflows({ parentWorkflowID: parent, status: [...ALIVE], loadInput: false, loadOutput: false });
  if (children.length > 0) await DBOS.cancelWorkflows(children.map((w) => w.workflowID));
}

/**
 * Error that replaying will not change: constraint or data refused by PostgreSQL (classes 22, 23, 42, P0 —
 * trigger), or business error marked permanent. Any other error (network, database unavailable, outside
 * service) is retried.
 */
export function isPermanent(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return e instanceof PermanentError || (typeof code === 'string' && /^(22|23|42|P0)/.test(code));
}

/**
 * A named DBOS step: every access to the database or the outside world goes through it (replay without duplicates).
 * Automatic retries with growing wait (A3); each attempt has a maximum duration (B1: a silent service or
 * database never blocks); once retries are exhausted, the error goes up to the workflow, whose error
 * boundary opens the "technical incident" gate (D21).
 */
export const step = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
  DBOS.runStep(fn, {
    name: name,
    retriesAllowed: true,
    maxAttempts: retries.attempts,
    intervalSeconds: retries.interval_ms / 1000,
    backoffRate: 2,
    shouldRetry: (e) => !isPermanent(e),
    timeoutMS: stepTimeoutMs,
  });

/** Step run only once: a call whose contract already carries its own retries (forge, deployer) or that costs money (agent engine). */
export const singleStep = <T>(name: string, fn: () => Promise<T>): Promise<T> => DBOS.runStep(fn, { name: name });

/** E5f: W1 step that starts the Preview pipeline; its output (run id before the start) is read back by the watcher. */
export const LAUNCH_PREVIEW_PIPELINE_STEP = 'launch the Preview pipeline';

/**
 * Error specific to the DBOS engine (workflow cancelled, execution resumed elsewhere, non-determinism, shutdown): it
 * must never be turned into an incident, the workflow must stop there. Recorded step errors
 * (retries exhausted, step timeout) are, for their part, ordinary faults.
 */
export function isDbosEngineError(e: unknown): boolean {
  const code = (e as { dbosErrorCode?: unknown } | null)?.dbosErrorCode;
  return typeof code === 'number' && code !== 23 && code !== 31; // 23: retries exhausted; 31: step timeout
}

/** Exact text of an error, shown to the admin (D21). */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return `${e.name}${typeof code === 'string' ? ` [${code}]` : ''} : ${e.message}`;
  }
  return String(e);
}
