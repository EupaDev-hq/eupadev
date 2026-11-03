/**
 * Access to the business database (schema `migrations/0001_schema.sql`). Queries are parameterised;
 * a state change always goes through `transition`, in a single UPDATE that the database trigger
 * checks against `allowed_transitions` — never bypassed.
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { HATS, type Hat, type Principal } from './auth.ts';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from './web-session.ts';
import type { StateId } from './machine/states.ts';
import type { Role, RoleCode } from './external/contracts.ts';
import { SCOPING_ROLES, CODE_ROLES, REVIEW_ROLES } from './external/contracts.ts';

export interface ToolCatalogueEntry { slug: string; name: string; owner_service: string; state: string | null; archived: boolean; description: string | null }

export interface Cycle {
  id: number;
  tool_id: number;
  slug: string;
  name: string;
  /**
   * Requester of the tool (`actors.id`, CANONICAL: actor merges are followed on read, migration 0010):
   * judges the mock-up and the Preview, receives the mails; does not approve their own Gate 2.
   */
  requester_id: string;
  type: 'creation' | 'evolution';
  state: StateId;
  last_trigger: string | null;
  scoping_budget_usd: number;
  hardening_budget_usd: number;
  finished_at: Date | null;
  /**
   * Id of the current visit to the state (history row of the FIRST entry, B9): a message only counts for
   * this visit. G5: a round trip through the incident gate (`resume:<state>`) does not start a new visit.
   */
  visit: number;
  /**
   * Date of the first entry into the state for this visit (epoch ms, database clock): deadlines and reminders
   * are counted from it (D22, G5), neither from the workflow nor from a resume after an incident or a replacement.
   */
  entry_ms: number;
}

/**
 * Memory of the W1 workflow (D22): everything a resume must know that the business tables do not say. Written
 * in the same transaction as each transition (`Database.transition`), read back at each state: a new workflow resumes
 * where the old one was.
 */
export interface Memory {
  /** Scoping counters (D17): reset by "continue" / "clarify" at the scoping-blocked gate. */
  scoping: { attempts: number; sameError: number; lastError: string | null };
  /** Text from a human (`correction` gate, feedback…) passed as data to the next task, then cleared. */
  instruction: string | null;
  /** The admin's clarification at the overlap gate, data for the first scoping (scenario 6), then cleared. */
  adminClarification: string | null;
  /** Free message from the requester received during the pause, handled as `correction` feedback after the mock-up (D18). */
  pendingMessage: string | null;
  /** Digest published by the last green CI (candidate for the Preview). */
  candidateDigest: string | null;
  /** Last technical error of the scoping, passed to the next scoping (scenario 16). */
  previousError: string | null;
  /** Reason shown to the admin by the next gate (the agent's reason, errors, counters…). */
  gateReason: string;
  /** Reason of the open gate at the time of an incident, restored on resume (D21). */
  reasonBeforeIncident: string;
  /**
   * C: round where only these reviewers are run again (their report was invalid and no deviation targets the code); set on
   * entering the round, read by integration and review, cleared on leaving review. null = full round.
   */
  reviewOnly: { round: number; roles: ('security-reviewer' | 'quality-reviewer')[] } | null;
}

export const emptyMemory = (): Memory => ({
  scoping: { attempts: 0, sameError: 0, lastError: null },
  instruction: null, adminClarification: null, pendingMessage: null, candidateDigest: null, previousError: null,
  gateReason: '', reasonBeforeIncident: '', reviewOnly: null,
});

export interface Task {
  id: string;
  role: Role;
  iteration: number;
  step: StateId;
  status: 'queued' | 'in_progress' | 'done' | 'blocked' | 'failed';
  report: unknown;
  cost_usd: number;
  duration_s: number;
  tree_hash: string | null;
}

export interface DeviationRow {
  iteration: number;
  rule: string;
  file: string;
  category: string | null;
  finding_id: string | null;
  previous_id: string | null;
  source: string;
  /** A-R2a (0013): code role that must fix, when the deviation says so (builder finding for tests); missing = usual routing. */
  target_role?: RoleCode | null;
}

/** Machine actors (fixed rows of migration 0008): the engine itself, and the forge for CI signals. */
export const ORCHESTRATOR_ACTOR = '00000000-0000-0000-0000-000000000001';
export const FORGE_ACTOR = '00000000-0000-0000-0000-000000000002';

/** Logic or data error: replaying it will change nothing (no automatic retry, A3). */
export class PermanentError extends Error {
  override name = 'PermanentError';
}
const HARDENING_ROLES_SQL = `('contract', 'tests', 'builder', 'security-reviewer', 'quality-reviewer')`;
/** Cookie value: 32 bytes in base64url. Anything else: no query at all. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hashSession = (token: string): Buffer => createHash('sha256').update(token).digest();

export class Database {
  readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * C: runs `fn` on the cycle as it is, HOLDING it in its visit: shared lock on its row, which every
   * transition (UPDATE … FOR UPDATE of this row) waits for. What `fn` observes (state, visit, live workflow) therefore holds
   * for everything it does, e.g. posting a message.
   */
  async retainCycle<T>(id: number, fn: (c: Cycle) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('SELECT 1 FROM cycles WHERE id = $1 FOR SHARE', [id]);
      return fn(await this.readCycle(id, client));
    });
  }

  async transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async readCycle(id: number, client: pg.Pool | pg.PoolClient = this.pool): Promise<Cycle> {
    const r = await client.query(
      `SELECT c.id::int AS id, c.tool_id::int AS tool_id, o.slug, o.name, canonical_actor(o.requester_id) AS requester_id, c.type, c.state, c.last_trigger,
              c.scoping_budget_usd::float8 AS scoping_budget_usd, c.hardening_budget_usd::float8 AS hardening_budget_usd, c.finished_at,
              coalesce(v.id, 0)::int AS visit, coalesce(v.entry_ms, 0)::float8 AS entry_ms
       FROM cycles c JOIN tools o ON o.id = c.tool_id
       LEFT JOIN LATERAL (
         SELECT h.id, extract(epoch FROM h.created_at) * 1000 AS entry_ms FROM tool_history h
         WHERE h.cycle_id = c.id AND h.state = c.state AND h.previous_state IS DISTINCT FROM c.state AND h.trigger NOT LIKE 'resume:%'
         ORDER BY h.id DESC LIMIT 1
       ) v ON true
       WHERE c.id = $1`,
      [id],
    );
    const c = r.rows[0] as Cycle | undefined;
    if (c === undefined) throw new Error(`unknown cycle ${id}`);
    return c;
  }

  /**
   * State transition, idempotent on replay: if the cycle is still in `from`, the UPDATE is done (and the
   * trigger checks it); if it is already in `to` through this trigger, nothing to do; otherwise, error.
   * `extra` writes in the same transaction (approval, results…) and `memory` (D22) is recorded in it, only
   * when the transition is actually applied. An in-place repeat (from === to) writes no state: it traces
   * a history row, which the database checks against allowed_transitions (B9).
   */
  async transition(
    cycleId: number,
    from: StateId,
    trigger: string,
    to: StateId,
    actor = ORCHESTRATOR_ACTOR,
    extra?: (c: pg.PoolClient) => Promise<void>,
    memory?: Memory,
  ): Promise<'applied' | 'already_done'> {
    return this.transaction(async (c) => {
      const current = await c.query<{ state: string; last_trigger: string | null; tool_id: number }>(
        'SELECT state, last_trigger, tool_id FROM cycles WHERE id = $1 FOR UPDATE',
        [cycleId],
      );
      const line = current.rows[0];
      if (line === undefined) throw new Error(`unknown cycle ${cycleId}`);
      if (from !== to && line.state === to && line.last_trigger === trigger) return 'already_done';
      if (line.state !== from) {
        throw new PermanentError(`transition ${from} --[${trigger}]--> ${to} impossible: cycle ${cycleId} is in state ${line.state}`);
      }
      if (extra) await extra(c);
      if (from === to) {
        await c.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, $3, $3, $4, $5)`, [line.tool_id, cycleId, from, trigger, actor]);
      } else {
        await c.query('UPDATE cycles SET state = $2, last_trigger = $3, last_actor_id = $4 WHERE id = $1', [cycleId, to, trigger, actor]);
      }
      if (memory !== undefined) await Database.writeMemory(c, cycleId, memory);
      return 'applied';
    });
  }

  private static async writeMemory(c: pg.PoolClient, cycleId: number, memory: Memory): Promise<void> {
    await c.query(
      `INSERT INTO cycle_memory (cycle_id, memory) VALUES ($1, $2) ON CONFLICT (cycle_id) DO UPDATE SET memory = EXCLUDED.memory, updated_at = now()`,
      [cycleId, JSON.stringify(memory)],
    );
  }

  /** Workflow memory (D22) as recorded at the last transition; empty if none. */
  async readMemory(cycleId: number): Promise<Memory> {
    const r = await this.pool.query<{ memory: Partial<Memory> }>('SELECT memory FROM cycle_memory WHERE cycle_id = $1', [cycleId]);
    return { ...emptyMemory(), ...(r.rows[0]?.memory ?? {}) };
  }

  /**
   * Reminders already sent in the current visit (`timeout_exceeded` traces on this state since the first entry, G5: those
   * from before an incident count) and date of the last one (D22).
   */
  async reminders(cycleId: number, state: StateId, visit: number): Promise<{ count: number; last_ms: number | null }> {
    const r = await this.pool.query<{ count: number; last_ms: number | null }>(
      `SELECT count(*)::int AS count, (extract(epoch FROM max(created_at)) * 1000)::float8 AS last_ms FROM tool_history
       WHERE cycle_id = $1 AND id > $2 AND state = $3 AND previous_state = state AND trigger = 'timeout_exceeded'`,
      [cycleId, visit, state],
    );
    return r.rows[0]!;
  }

  /**
   * M6: trace of reminder no. `already + 1` of the visit, idempotent: if a previous attempt of the step already wrote it
   * (lost response), nothing is rewritten. The database checks that the in-place loop is planned (B9).
   */
  async remind(cycleId: number, state: StateId, visit: number, already: number): Promise<'applied' | 'already_done'> {
    return this.transaction(async (c) => {
      const line = (await c.query<{ state: string; tool_id: number }>('SELECT state, tool_id FROM cycles WHERE id = $1 FOR UPDATE', [cycleId])).rows[0];
      if (line === undefined) throw new Error(`unknown cycle ${cycleId}`);
      if (line.state !== state) throw new PermanentError(`reminder impossible: cycle ${cycleId} is in state ${line.state}, not ${state}`);
      const n = (await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tool_history WHERE cycle_id = $1 AND id > $2 AND state = $3 AND previous_state = state AND trigger = 'timeout_exceeded'`,
        [cycleId, visit, state],
      )).rows[0]!.n;
      if (n > already) return 'already_done';
      await c.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, $3, $3, 'timeout_exceeded', $4)`, [line.tool_id, cycleId, state, ORCHESTRATOR_ACTOR]);
      return 'applied';
    });
  }

  /** Has the cycle already been through this state (e.g. Prod deployment, to remove the Prod of a creation that does not succeed, B6)? */
  async hasPassedThrough(cycleId: number, state: StateId): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM tool_history WHERE cycle_id = $1 AND state = $2 LIMIT 1`, [cycleId, state]);
    return r.rowCount === 1;
  }

  /** Trace outside a transition (budget check D11/E2, cleanup): a history row on the current state, checked by the database (B9). */
  async trace(cycle: Cycle, trigger: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, $3, $3, $4, $5)`,
      [cycle.tool_id, cycle.id, cycle.state, trigger, ORCHESTRATOR_ACTOR],
    );
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────────────────────────

  static taskId(cycle: { tool_id: number; id: number }, iteration: number, role: Role, tentative = 1): string {
    return `${cycle.tool_id}-${cycle.id}-${iteration}-${role}${tentative === 1 ? '' : `-r${tentative}`}`;
  }

  /**
   * Tasks of a round (E4/E5: deterministic id, never a duplicate). For each role, the last attempt is
   * taken again if it finished successfully or is still open; if it failed (incident, cancellation, fault), a
   * new attempt `-r<n>` is created: "retry" really runs the work again, without charging again for what succeeded (B3).
   * Branch of a task: `agent/<tool>/<cycle>/<role>` (L5); a reviewer (ADR-020, read-only) reviews the integrated
   * code of the round, `integration/<cycle>/<round>` of the code roles' last round (its own, or the previous one when only
   * its report is replayed), never main: main does not have the round's work yet.
   */
  async createTasks(cycle: Cycle, step: StateId, iteration: number, roles: readonly Role[]): Promise<string[]> {
    const ids: string[] = [];
    const codeRound = roles.some((r) => (REVIEW_ROLES as readonly Role[]).includes(r)) ? await this.lastIteration(cycle.id, CODE_ROLES) : 0;
    for (const role of roles) {
      const last = (await this.pool.query<{ attempt: number; status: string }>(
        `SELECT attempt, status FROM tasks WHERE cycle_id = $1 AND iteration = $2 AND role = $3 ORDER BY attempt DESC LIMIT 1`,
        [cycle.id, iteration, role],
      )).rows[0];
      const attempt = last === undefined ? 1 : ['done', 'queued', 'in_progress'].includes(last.status) ? last.attempt : last.attempt + 1;
      const id = Database.taskId(cycle, iteration, role, attempt);
      await this.pool.query(
        `INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration, attempt, branch) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        // G4: branch specific to the cycle, so that the end cleanup never touches those of another cycle.
        [id, cycle.tool_id, cycle.id, step, role, iteration, attempt, (REVIEW_ROLES as readonly Role[]).includes(role) ? `integration/${cycle.id}/${codeRound}` : `agent/${cycle.slug}/${cycle.id}/${role}`],
      );
      ids.push(id);
    }
    return ids;
  }

  /** Tasks of a round, only the last attempt of each role (the one that counts, B3). */
  async roundTasks(cycleId: number, iteration: number, roles: readonly Role[]): Promise<Task[]> {
    const r = await this.pool.query(
      `SELECT DISTINCT ON (role) id, role, iteration, step, status, report, cost_usd::float8 AS cost_usd, duration_s, tree_hash FROM tasks
       WHERE cycle_id = $1 AND iteration = $2 AND role = ANY($3) ORDER BY role, attempt DESC`,
      [cycleId, iteration, roles],
    );
    return r.rows as Task[];
  }

  /**
   * The CI of the task's branch has answered, green or red: `verdict_source` goes from 'agent' to 'ci' and `ci_green`
   * receives the result, in the same UPDATE, only once (migrations/0006: the database refuses any other change to a
   * closed task). Returns false if the task did not have the 'agent' verdict (already 'ci', not done).
   */
  async ciVerdict(taskId: string, green: boolean): Promise<boolean> {
    return (await this.pool.query(`UPDATE tasks SET verdict_source = 'ci', ci_green = $2 WHERE id = $1 AND verdict_source = 'agent'`, [taskId, green])).rowCount === 1;
  }

  async readTask(id: string): Promise<Task> {
    const r = await this.pool.query(
      `SELECT id, role, iteration, step, status, report, cost_usd::float8 AS cost_usd, duration_s, tree_hash FROM tasks WHERE id = $1`,
      [id],
    );
    const t = r.rows[0] as Task | undefined;
    if (t === undefined) throw new Error(`unknown task ${id}`);
    return t;
  }

  async cycleTasks(cycleId: number, filter?: { iteration?: number; roles?: readonly Role[] }): Promise<Task[]> {
    const r = await this.pool.query(
      `SELECT id, role, iteration, step, status, report, cost_usd::float8 AS cost_usd, duration_s, tree_hash FROM tasks
       WHERE cycle_id = $1 AND ($2::int IS NULL OR iteration = $2) AND ($3::text[] IS NULL OR role = ANY($3)) ORDER BY created_at, id`,
      [cycleId, filter?.iteration ?? null, filter?.roles ?? null],
    );
    return r.rows as Task[];
  }

  /** Last iteration of a set of roles (0 if no task). */
  async lastIteration(cycleId: number, roles: readonly Role[]): Promise<number> {
    const r = await this.pool.query<{ n: number }>(`SELECT coalesce(max(iteration), 0)::int AS n FROM tasks WHERE cycle_id = $1 AND role = ANY($2)`, [cycleId, roles]);
    return r.rows[0]!.n;
  }

  /** Cumulative cost of an envelope (D2, D16): sum of the actual costs of `tasks`, never a total kept separately. */
  async cumulativeCost(cycleId: number, envelope: 'scoping' | 'hardening'): Promise<number> {
    const r = await this.pool.query<{ total: number }>(
      `SELECT coalesce(sum(cost_usd), 0)::float8 AS total FROM tasks WHERE cycle_id = $1 AND ${envelope === 'scoping' ? 'role = ANY($2)' : 'NOT (role = ANY($2))'}`,
      [cycleId, SCOPING_ROLES],
    );
    return r.rows[0]!.total;
  }

  /**
   * D3: actual working time of the agents (sum of the task durations), in minutes. Counter of a loop:
   * only the tasks created since the last "continue" / "clarify" decision of its gate count
   * ("continue" resets the counters, never the cost).
   */
  async workDurationMin(cycleId: number, loop: 'scoping' | 'hardening'): Promise<number> {
    const since = loop === 'hardening' ? await this.lastReset(cycleId) : await this.lastScopingReset(cycleId);
    // B2: same envelopes as the cost (D16) — scoping = overlap + scoping, hardening = everything else (contract included).
    const r = await this.pool.query<{ s: number }>(
      `SELECT coalesce(sum(duration_s), 0)::float8 AS s FROM tasks WHERE cycle_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2)
       AND ${loop === 'scoping' ? 'role = ANY($3)' : 'NOT (role = ANY($3))'}`,
      [cycleId, since, SCOPING_ROLES],
    );
    return r.rows[0]!.s / 60;
  }

  /** Date of the last reset of the scoping counters: "continue" or "clarify" at the scoping-blocked gate. */
  async lastScopingReset(cycleId: number): Promise<Date | null> {
    const r = await this.pool.query<{ d: Date | null }>(
      `SELECT max(created_at) AS d FROM tool_history WHERE cycle_id = $1 AND previous_state = 'gate_scoping_blocked' AND state = 'repo_creation'`,
      [cycleId],
    );
    return r.rows[0]!.d;
  }

  /**
   * E15 / D21: the cycle's still-open tasks (or only `ids`) are set to failed. Cost: budget cap OF THE task's ROLE
   * (A-R5) per uncounted engine execution (M4, B7: none returned its cost; at least one for a
   * started task — unknown cost, never 0); 0 for a task never started, left in the queue (B3).
   */
  async failOpenTasks(cycleId: number, caps: Readonly<Record<Role, { budget_usd: number }>>, reason: string, ids?: readonly string[]): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      `UPDATE tasks SET status = 'failed', cost_usd = CASE WHEN status = 'in_progress' THEN ($2::jsonb -> role ->> 'budget_usd')::numeric * greatest(executions, 1) ELSE 0 END, ended_at = now(),
              report = coalesce(report, jsonb_build_object('status', 'failed', 'reason', $3::text))
       WHERE cycle_id = $1 AND status IN ('queued', 'in_progress') AND ($4::text[] IS NULL OR id = ANY($4)) RETURNING id`,
      [cycleId, JSON.stringify(caps), reason, ids ?? null],
    );
    return r.rows.map((x) => x.id);
  }

  // ── Hardening: rounds, deviations, counters (D15, D20) ──────────────────────────────────────────

  /** Date of the last reset of the counters: "continue" or "clarify" at the hardening-blocked gate. */
  async lastReset(cycleId: number): Promise<Date | null> {
    const r = await this.pool.query<{ d: Date | null }>(
      `SELECT max(created_at) AS d FROM tool_history WHERE cycle_id = $1 AND previous_state = 'gate_hardening_blocked' AND state = 'hardening_execution'`,
      [cycleId],
    );
    return r.rows[0]!.d;
  }

  /**
   * First round counted since the last reset: 1 + the last round played before "continue" /
   * "clarify" at the hardening-blocked gate (1 if no reset). The counters (D20, cap)
   * only look at the rounds from there on; "continue" resets the counters, never the cost.
   */
  async resumeIteration(cycleId: number): Promise<number> {
    const since = await this.lastReset(cycleId);
    if (since === null) return 1;
    const r = await this.pool.query<{ n: number }>(
      `SELECT coalesce(max(iteration), 0)::int AS n FROM tasks WHERE cycle_id = $1 AND role IN ${HARDENING_ROLES_SQL} AND role <> 'contract' AND created_at <= $2`,
      [cycleId, since],
    );
    return r.rows[0]!.n + 1;
  }

  /** Deviations of the rounds ≥ `since`, in round order. */
  async deviationsSince(cycleId: number, since: number): Promise<DeviationRow[]> {
    const r = await this.pool.query<DeviationRow>(
      `SELECT iteration, rule, file, category, finding_id, previous_id, source, target_role FROM deviations WHERE cycle_id = $1 AND iteration >= $2 ORDER BY iteration, id`,
      [cycleId, since],
    );
    return r.rows;
  }

  /** Tree digests per code role, in round order (D20 M4). */
  async treesByRole(cycleId: number): Promise<Partial<Record<RoleCode, string[]>>> {
    const r = await this.pool.query<{ role: RoleCode; tree_hash: string }>(
      `SELECT role, tree_hash FROM tasks WHERE cycle_id = $1 AND tree_hash IS NOT NULL ORDER BY iteration`,
      [cycleId],
    );
    const trees: Partial<Record<RoleCode, string[]>> = {};
    for (const l of r.rows) (trees[l.role] ??= []).push(l.tree_hash);
    return trees;
  }

  /** Writes the deviations of a round; deduplication by (rule, file) is the UNIQUE constraint (ON CONFLICT DO NOTHING). */
  async writeDeviations(cycle: Cycle, iteration: number, deviations: readonly Omit<DeviationRow, 'iteration'>[], client: pg.Pool | pg.PoolClient = this.pool): Promise<void> {
    for (const e of deviations) {
      await client.query(
        `INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, category, finding_id, previous_id, source, target_role) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ON CONSTRAINT deviations_one_per_digest_and_round DO NOTHING`,
        [cycle.tool_id, cycle.id, iteration, e.rule, e.file, e.category, e.finding_id, e.previous_id, e.source, e.target_role ?? null],
      );
    }
  }

  /**
   * Results of a pipeline and deviations of the round, in one transaction; one result per check and per visit to the state
   * (B8: a step retried after a partial or complete write writes nothing twice).
   */
  async writePipelineResults(
    cycle: Cycle,
    iteration: number,
    pipeline: 'ci' | 'preview',
    digest: string | null,
    checks: readonly { check: string; result: 'green' | 'red'; details?: unknown }[],
    deviations: readonly Omit<DeviationRow, 'iteration'>[] = [],
  ): Promise<void> {
    await this.transaction(async (client) => {
      for (const c of checks) {
        // A green check without a digest (CI red before the build) cannot be stored: constraint pipeline_results_digest.
        if (digest === null && !(pipeline === 'ci' && c.result === 'red')) continue;
        await client.query(
          `INSERT INTO pipeline_results (tool_id, cycle_id, iteration, pipeline, digest, check_name, result, details, visit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT ON CONSTRAINT pipeline_results_one_per_pass DO NOTHING`,
          [cycle.tool_id, cycle.id, iteration, pipeline, digest, c.check, c.result, JSON.stringify(c.details ?? {}), cycle.visit],
        );
      }
      await this.writeDeviations(cycle, iteration, deviations, client);
    });
  }

  async pipelineResults(cycleId: number, pipeline: 'ci' | 'preview', digest: string): Promise<{ check: string; result: string }[]> {
    const r = await this.pool.query<{ check: string; result: string }>(
      `SELECT check_name AS "check", result FROM pipeline_results WHERE cycle_id = $1 AND pipeline = $2 AND digest = $3 ORDER BY id`,
      [cycleId, pipeline, digest],
    );
    return r.rows;
  }

  // ── Chat, approvals, deployments ────────────────────────────────────────────────────────────────

  /** `key`: idempotency key (same key = a single message, even if the write is replayed). The display name is set by the database. */
  async writeMessage(cycle: Cycle, author_type: 'requester' | 'admin' | 'agent' | 'orchestrator', actorId: string, content: string, key?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content, key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING`,
      [cycle.tool_id, cycle.id, author_type, actorId, content, key ?? null],
    );
  }

  async cycleMessages(cycleId: number): Promise<{ author_type: string; author: string; content: string }[]> {
    const r = await this.pool.query<{ author_type: string; author: string; content: string }>(
      `SELECT author_type, author, content FROM messages WHERE cycle_id = $1 ORDER BY id`,
      [cycleId],
    );
    return r.rows;
  }

  /**
   * Chat page (ADR-024): the cycle's messages with an id above `since` (0 = the whole history), in order; the page
   * polling every ~10 s passes back the last `id` it got.
   * ponytail: cursor = identity id; two concurrent inserts can commit out of order (a smaller id visible after a larger
   * one) — switch to a commit-ordered cursor if a message is ever seen missing.
   */
  async messagesSince(cycleId: number, since: number): Promise<{ id: number; author_type: string; author: string; content: string; created_at: Date }[]> {
    const r = await this.pool.query<{ id: number; author_type: string; author: string; content: string; created_at: Date }>(
      `SELECT id::int AS id, author_type, author, content, created_at AS created_at FROM messages WHERE cycle_id = $1 AND id > $2 ORDER BY id`,
      [cycleId, since],
    );
    return r.rows;
  }

  /** "My requests": the cycles of the tools whose requester is `requesterId` (canonical, 0010); `null` = all (admin). Newest first. */
  async requests(requesterId: string | null): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT c.id::int AS cycle_id, c.tool_id::int AS tool_id, o.slug, o.name, c.type, c.state, c.created_at AS created_at, c.finished_at,
              (SELECT max(m.created_at) FROM messages m WHERE m.cycle_id = c.id) AS last_message_at
       FROM cycles c JOIN tools o ON o.id = c.tool_id
       WHERE $1::uuid IS NULL OR canonical_actor(o.requester_id) = $1::uuid
       ORDER BY c.id DESC`,
      [requesterId],
    );
    return r.rows;
  }

  /** The name shown in the page's top bar. */
  async displayName(actorId: string): Promise<string> {
    const r = await this.pool.query<{ display_name: string }>('SELECT display_name FROM actors WHERE id = $1', [actorId]);
    return r.rows[0]?.display_name ?? '';
  }

  async gate1Granted(toolId: number): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM approvals WHERE tool_id = $1 AND gate = 'gate_1' AND decision = 'approved' LIMIT 1`, [toolId]);
    return r.rowCount === 1;
  }

  /**
   * Candidate digest of this cycle: the one of the LAST Preview deployment actually attempted, if it is healthy (G3: one row
   * per operation, the last one says what is served), hence the one the requester and the Preview pipeline judged (B1);
   * null if the last one failed. The only digest a Gate 2 can approve (also checked by the database, M8).
   */
  async candidateDigest(cycleId: number): Promise<string | null> {
    const r = await this.pool.query<{ digest: string | null }>(
      `SELECT CASE WHEN health = 'ok' THEN digest END AS digest FROM deployments WHERE cycle_id = $1 AND environment = 'preview' ORDER BY id DESC LIMIT 1`,
      [cycleId],
    );
    return r.rows[0]?.digest ?? null;
  }

  /** M5: last digest served healthy in Prod for this tool (all cycles), the reference to restore; null if none. */
  async lastHealthyProd(toolId: number): Promise<string | null> {
    const r = await this.pool.query<{ digest: string }>(
      `SELECT digest FROM deployments WHERE tool_id = $1 AND environment = 'prod' AND health = 'ok' ORDER BY id DESC LIMIT 1`,
      [toolId],
    );
    return r.rows[0]?.digest ?? null;
  }

  /** D21: original state of the last incident (the one "retry" goes back to, also checked by the trigger). */
  async incidentOrigin(cycleId: number): Promise<StateId | null> {
    const r = await this.pool.query<{ previous_state: StateId }>(
      `SELECT previous_state FROM tool_history WHERE cycle_id = $1 AND state = 'gate_incident' AND trigger = 'incident' ORDER BY id DESC LIMIT 1`,
      [cycleId],
    );
    return r.rows[0]?.previous_state ?? null;
  }

  /** Open cycles (monitoring, A6/B2); `age_ms`: age of the cycle (a freshly created cycle is waiting for its workflow). */
  async openCycles(): Promise<{ id: number; age_ms: number }[]> {
    const r = await this.pool.query<{ id: number; age_ms: number }>(
      `SELECT id::int AS id, (extract(epoch FROM now() - created_at) * 1000)::float8 AS age_ms FROM cycles WHERE finished_at IS NULL ORDER BY id`,
    );
    return r.rows;
  }

  /** Digest approved at the Gate 2 of this cycle (the most recent), D19. */
  async gate2ApprovedDigest(cycleId: number): Promise<string | null> {
    const r = await this.pool.query<{ digest: string }>(
      `SELECT digest FROM approvals WHERE cycle_id = $1 AND gate = 'gate_2' AND decision = 'approved' ORDER BY id DESC LIMIT 1`,
      [cycleId],
    );
    return r.rows[0]?.digest ?? null;
  }

  /** One record per deployment operation (G3): a retry of the step writes nothing twice (B8). */
  async writeDeployment(cycle: Cycle, env: 'mockup' | 'preview' | 'prod', digest: string, url: string, health: 'ok' | 'failed', operation: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO deployments (tool_id, cycle_id, environment, digest, url, health, visit, operation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT deployments_one_per_operation DO NOTHING`,
      [cycle.tool_id, cycle.id, env, digest, url, health, cycle.visit, operation],
    );
  }

  // ── Monitoring (sweep) ──────────────────────────────────────────────────────────────────────────

  /** True if the cycle is finished (or unknown). */
  async cycleFinished(id: number): Promise<boolean> {
    const r = await this.pool.query<{ finished: boolean }>(`SELECT finished_at IS NOT NULL AS finished FROM cycles WHERE id = $1`, [id]);
    return r.rows[0]?.finished ?? true;
  }

  /**
   * Catalogue of the tools for the overlap search: all the tools except the one of the
   * request, archived ones included (marked), with a short description = comment of the last Gate 1 approval
   * (a human's text, filtered of invisible characters on receipt, truncated to 300 characters), null without approval.
   * Passed to the agent as DATA (task context), never in its instructions.
   */
  async toolCatalogue(exceptToolId: number): Promise<ToolCatalogueEntry[]> {
    return (await this.pool.query<ToolCatalogueEntry>(
      `SELECT o.slug, o.name, o.owner_service, o.current_state AS state, o.archived_at IS NOT NULL AS archived,
              left((SELECT a.comment FROM approvals a WHERE a.tool_id = o.id AND a.gate = 'gate_1' AND a.decision = 'approved' AND a.comment IS NOT NULL
                    ORDER BY a.id DESC LIMIT 1), 300) AS description
       FROM tools o WHERE o.id <> $1 ORDER BY o.id`,
      [exceptToolId],
    )).rows;
  }

  /** Tools and their archiving (monitoring of the environments still served). ponytail: all the tools at each sweep; filter by recent activity if the registry grows. */
  async tools(): Promise<{ id: number; slug: string; archived: boolean }[]> {
    return (await this.pool.query<{ id: number; slug: string; archived: boolean }>(`SELECT id::int AS id, slug, archived_at IS NOT NULL AS archived FROM tools ORDER BY id`)).rows;
  }

  // ── Entry: tools and cycles ─────────────────────────────────────────────────────────────────────

  async createCycle(toolId: number, type: 'creation' | 'evolution', requesterId: string, budgets: { scoping: number; hardening: number }, client: pg.Pool | pg.PoolClient = this.pool): Promise<number> {
    const r = await client.query<{ id: number }>(
      `INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES ($1, $2, $3, $4, $5) RETURNING id::int AS id`,
      [toolId, type, budgets.scoping, budgets.hardening, requesterId],
    );
    return r.rows[0]!.id;
  }

  /**
   * New request: tool (creation) and cycle in a single transaction — never a tool without a cycle (A6). An evolution
   * makes the person who requests it the requester of the tool (they judge the Preview, receive the mails, do not approve their
   * own Gate 2); the UPDATE precedes the cycle INSERT (a tool from before 0008 thus receives its id). The need
   * becomes the first chat message (requester hat), in the same transaction: never a cycle without it, nor twice.
   */
  async createRequest(
    d: { type: 'creation'; name: string; slug: string; owner_service: string; need: string } | { type: 'evolution'; tool_id: number; need: string },
    requesterId: string,
    budgets: { scoping: number; hardening: number },
  ): Promise<{ tool_id: number; cycle_id: number }> {
    return this.transaction(async (client) => {
      let toolId: number;
      if (d.type === 'evolution') {
        const r = await client.query('UPDATE tools SET requester_id = $2 WHERE id = $1', [d.tool_id, requesterId]);
        if (r.rowCount !== 1) throw new PermanentError(`unknown tool ${d.tool_id}`);
        toolId = d.tool_id;
      } else {
        toolId = (await client.query<{ id: number }>(
          `INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ($1, $2, $3, $4) RETURNING id::int AS id`,
          [d.name, d.slug, requesterId, d.owner_service],
        )).rows[0]!.id;
      }
      const cycleId = await this.createCycle(toolId, d.type, requesterId, budgets, client);
      await client.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'requester', $3, $4)`, [toolId, cycleId, requesterId, d.need]);
      return { tool_id: toolId, cycle_id: cycleId };
    });
  }

  // ── Identity (I0, ADR-017) ──────────────────────────────────────────────────────────────────────

  /**
   * Actor of an authenticated principal, by its stable key `(issuer, subject)` (D1): created on first visit, under an advisory
   * lock (two simultaneous first requests create only one); NEVER linked by mail. Mail, name and date of
   * last sign-in are refreshed at each visit (contact attributes, the only columns the engine can modify).
   * Returns the CANONICAL actor (migration 0010): a subject linked to an actor absorbed by a merge acts as the target actor.
   */
  async resolveActor(p: Principal): Promise<string> {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${p.issuer}\n${p.subject}`]);
      const known = (await c.query<{ actor_id: string }>('SELECT canonical_actor(actor_id) AS actor_id FROM actor_identities WHERE issuer = $1 AND subject = $2', [p.issuer, p.subject])).rows[0];
      if (known !== undefined) {
        await c.query('UPDATE actors SET mail = $2, display_name = $3, last_sign_in = now() WHERE id = $1', [known.actor_id, p.mail, p.name]);
        return known.actor_id;
      }
      const id = (await c.query<{ id: string }>(`INSERT INTO actors (type, mail, display_name, last_sign_in) VALUES ('human', $1, $2, now()) RETURNING id`, [p.mail, p.name])).rows[0]!.id;
      await c.query(`INSERT INTO actor_identities (issuer, subject, actor_id, reason) VALUES ($1, $2, $3, 'first sign-in')`, [p.issuer, p.subject, id]);
      return id;
    });
  }

  /** (Canonical) actor already linked to `(issuer, subject)`, without creating anything (four-eyes exemption); null if unknown. */
  async actorByIdentity(issuer: string, subject: string): Promise<string | null> {
    const r = await this.pool.query<{ actor_id: string }>('SELECT canonical_actor(actor_id) AS actor_id FROM actor_identities WHERE issuer = $1 AND subject = $2', [issuer, subject]);
    return r.rows[0]?.actor_id ?? null;
  }

  /** Canonical actor of an id (itself if it was never absorbed); follows merges to the end. */
  async canonicalActor(id: string): Promise<string> {
    return (await this.pool.query<{ id: string }>('SELECT canonical_actor($1) AS id', [id])).rows[0]!.id;
  }

  /** Contact address of a (canonical) actor; null if unknown (token without `email`). */
  async actorMail(id: string): Promise<string | null> {
    const r = await this.pool.query<{ mail: string | null }>('SELECT mail FROM actors WHERE id = canonical_actor($1)', [id]);
    return r.rows[0]?.mail ?? null;
  }

  // ── Browser sessions (migration 0014, web-session.ts) ───────────────────────────────────────────

  /**
   * Opens a session for a signed-in person and renders the cookie value: 32 random bytes, of which only the SHA-256 is
   * stored. Rows past their absolute expiry are swept on the way (ponytail: housekeeping at each sign-in, no timer).
   */
  async createSession(actorId: string, roles: readonly Hat[], now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query('DELETE FROM sessions WHERE absolute_expires_at <= $1', [now]);
    await this.pool.query(
      `INSERT INTO sessions (token_hash, actor_id, roles, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [hashSession(token), actorId, roles, now, new Date(now.getTime() + SESSION_IDLE_MS), new Date(now.getTime() + SESSION_MAX_MS)],
    );
    return token;
  }

  /**
   * The person behind a cookie value, or null (malformed, unknown, expired — the row is then deleted). The idle expiry
   * slides, written at most once a minute; the actor is canonical (0010), the hats are those frozen at sign-in.
   */
  async readSession(token: unknown, now = new Date()): Promise<{ actorId: string; roles: Hat[] } | null> {
    if (typeof token !== 'string' || !SESSION_TOKEN.test(token)) return null;
    const hash = hashSession(token);
    const r = await this.pool.query<{ actor_id: string; roles: string[]; last_seen_at: Date; idle_expires_at: Date; absolute_expires_at: Date }>(
      'SELECT canonical_actor(actor_id) AS actor_id, roles, last_seen_at, idle_expires_at, absolute_expires_at FROM sessions WHERE token_hash = $1', [hash],
    );
    const s = r.rows[0];
    if (s === undefined) return null;
    const t = now.getTime();
    if (s.idle_expires_at.getTime() <= t || s.absolute_expires_at.getTime() <= t) {
      await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
      return null;
    }
    if (s.last_seen_at.getTime() + 60_000 <= t) {
      await this.pool.query('UPDATE sessions SET last_seen_at = $2, idle_expires_at = LEAST($3, absolute_expires_at) WHERE token_hash = $1', [hash, now, new Date(t + SESSION_IDLE_MS)]);
    }
    return { actorId: s.actor_id, roles: HATS.filter((c) => s.roles.includes(c)) };
  }

  /** Sign-out: the row goes, the cookie value is worthless from now on. */
  async destroySession(token: unknown): Promise<void> {
    if (typeof token === 'string' && SESSION_TOKEN.test(token)) await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashSession(token)]);
  }

  /**
   * Actor merge (migration 0010): `absorbed` becomes `target`, decided by the admin `decidedBy` (token identity). Row
   * append-only; the database refuses self-merge, cycle, machine actor and the admin who links their own identity. Idempotent
   * by kind: the same merge requested again returns the existing row (`new: false`); another target for the same
   * absorbed actor is refused (an actor is absorbed only once, the chain is followed through `canonical_actor`).
   */
  async mergeActors(absorbed: string, target: string, reason: string, decidedBy: string): Promise<{ new: boolean; merge: Merge }> {
    const r = await this.pool.query<Merge>(
      `INSERT INTO actor_merges (absorbed_actor, target_actor, reason, decided_by) VALUES ($1, $2, $3, $4) ON CONFLICT (absorbed_actor) DO NOTHING
       RETURNING absorbed_actor, target_actor, since, reason, decided_by`,
      [absorbed, target, reason, decidedBy],
    );
    if (r.rows[0] !== undefined) return { new: true, merge: r.rows[0] };
    const already = (await this.pool.query<Merge>('SELECT absorbed_actor, target_actor, since, reason, decided_by FROM actor_merges WHERE absorbed_actor = $1', [absorbed])).rows[0]!;
    if (already.target_actor !== target) throw new PermanentError(`merge refused: actor ${absorbed} is already absorbed by ${already.target_actor}`);
    return { new: false, merge: already };
  }
}

export interface Merge { absorbed_actor: string; target_actor: string; since: Date; reason: string; decided_by: string }
