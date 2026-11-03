// Tests against a real PostgreSQL (postgres:18.6-alpine) started in a throwaway container
// on a free port, migrations applied. The container is removed at the end, even on failure.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { STATES, DEFAULT_THRESHOLDS, TRANSITIONS, triggerKey } from '../src/machine/states.ts';
import { FORGE_ACTOR, ORCHESTRATOR_ACTOR, Database, type Cycle } from '../src/db.ts';
import { ADMIN, ADMIN_MAIL, REQUESTER, REQUESTER_MAIL, insertTestActors } from './helpers/bench.ts';
import { TEST_ISSUER } from './helpers/fake-oidc.ts';
import { createDatabase, startPostgres, migrate as migrateTo, urlBase, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';

let postgres: ThrowawayPostgres;
let pool: pg.Pool;
/** Restricted account of the engine (orch_engine, privileges from migrations/0003_grants.sql). */
let engine: pg.Pool;
const migrate = (direction: 'up' | 'down') => migrateTo(postgres.ownerUrl, direction);

before(async () => {
  postgres = await startPostgres();
  pool = new pg.Pool({ connectionString: postgres.urlAdmin });
  engine = new pg.Pool({ connectionString: postgres.engineUrl });
  await insertTestActors(engine);
}, { timeout: 180_000 });

after(async () => {
  await pool?.end();
  await engine?.end();
  postgres?.remove();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
let counter = 0;
async function createTool(): Promise<number> {
  counter += 1;
  const r = await pool.query<{ id: number }>(
    `INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ($1, $2, 'd0000000-0000-4000-8000-000000000001', 'service-test') RETURNING id`,
    [`Tool ${counter}`, `tool-${counter}`],
  );
  return r.rows[0]!.id;
}
async function createCycle(toolId: number, type = 'creation'): Promise<number> {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES ($1, $2, 10, 20, 'd0000000-0000-4000-8000-000000000001') RETURNING id`,
    [toolId, type],
  );
  return r.rows[0]!.id;
}
const transition = (cycleId: number, to: string, trigger: string, actor: string = ORCHESTRATOR_ACTOR) =>
  pool.query(`UPDATE cycles SET state = $2, last_trigger = $3, last_actor_id = $4 WHERE id = $1`, [cycleId, to, trigger, actor]);
// Forces the starting state by bypassing the trigger (tests only); the rest goes through the normal path.
async function forceState(cycleId: number, state: string) {
  await pool.query('ALTER TABLE cycles DISABLE TRIGGER cycles_transition');
  await pool.query(`UPDATE cycles SET state = $2, last_trigger = 'test' WHERE id = $1`, [cycleId, state]);
  await pool.query('ALTER TABLE cycles ENABLE TRIGGER cycles_transition');
}
/** Last history row of the cycle: the "pass" to attach a deployment or a pipeline result to (B8). */
const visit = async (cycleId: number) => (await pool.query<{ id: number }>('SELECT max(id)::int AS id FROM tool_history WHERE cycle_id = $1', [cycleId])).rows[0]!.id;
const archiveLe = async (toolId: number) => (await pool.query<{ archived_at: Date | null }>('SELECT archived_at FROM tools WHERE id = $1', [toolId])).rows[0]!.archived_at;

// ── Tests ─────────────────────────────────────────────────────────────────────

test('allowed_transitions and states are exactly equal to states.ts', async () => {
  const states = await pool.query<{ id: string; phase: string; kind: string }>('SELECT id, phase, kind FROM states ORDER BY id');
  assert.deepEqual(
    states.rows,
    [...STATES].map((e) => ({ id: e.id, phase: e.phase, kind: e.kind })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  const tr = await pool.query<{ from_state: string; trigger: string; to_state: string }>('SELECT from_state, trigger, to_state FROM allowed_transitions ORDER BY from_state, trigger');
  const expected = TRANSITIONS.map((t) => ({ from_state: t.from, trigger: triggerKey(t.trigger), to_state: t.to }))
    .sort((a, b) => a.from_state.localeCompare(b.from_state) || a.trigger.localeCompare(b.trigger));
  assert.deepEqual(tr.rows, expected);
});

test('the database refuses a tool, a cycle or a task without identity', async () => {
  await assert.rejects(pool.query(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ('X', 'x', NULL, 's')`), /check/i);
  await assert.rejects(pool.query(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ('', 'x2', 'd0000000-0000-4000-8000-000000000001', 's')`), /check/i);
  await assert.rejects(pool.query(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES (NULL, 'creation', 10, 20, 'd0000000-0000-4000-8000-000000000001')`), /null/i);
  await assert.rejects(pool.query(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES (999999, 'creation', 10, 20, 'd0000000-0000-4000-8000-000000000001')`), /foreign key/i);
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await assert.rejects(
    pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, NULL, 'scoping', 'scoping', 1)`, [`${tool}-x-1-scoping`, tool]),
    /null/i,
  );
  // A task attached to the cycle of another tool (E1: inconsistent identity).
  const other = await createTool();
  await assert.rejects(
    pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'scoping', 'scoping', 1)`, [`${other}-${cycle}-1-scoping`, other, cycle]),
    /foreign key/i,
  );
});

test('0011 (ADR-021): a `builder` task or deviation is accepted, an unknown role refused, a historical `backend` row stays accepted and readable', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const task = (role: string) => pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_execution', $4, 1)`, [`${tool}-${cycle}-1-${role}`, tool, cycle, role]);
  await task('builder');
  await pool.query(`UPDATE tasks SET tree_hash = $2 WHERE id = $1`, [`${tool}-${cycle}-1-builder`, 'b'.repeat(64)]);
  await task('backend'); // historical row: never rewritten, always accepted
  await assert.rejects(task('devops'), /tasks_role_check/);
  const deviation = (source: string) => pool.query(`INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, source) VALUES ($1, $2, 1, $3, 'api/x.js', $3)`, [tool, cycle, source]);
  await deviation('builder');
  await deviation('frontend');
  await assert.rejects(deviation('devops'), /deviations_source_check/);
  const roles = await pool.query<{ role: string }>('SELECT role FROM tasks WHERE cycle_id = $1 ORDER BY role', [cycle]);
  assert.deepEqual(roles.rows.map((r) => r.role), ['backend', 'builder']);
});

test('0013 (A-R2a): a deviation carries the code role that must fix it (tests or builder), or nothing; another role is refused', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const base = new Database(engine);
  const c = { id: cycle, tool_id: tool } as Cycle;
  const line = { rule: 'tests.md#Execution', category: null, finding_id: 'F-001', previous_id: null, source: 'builder' };
  await base.writeDeviations(c, 1, [{ ...line, file: 'openapi.yaml', target_role: 'tests' }, { ...line, file: 'api/x.js' }]);
  assert.deepEqual((await base.deviationsSince(cycle, 1)).map((l) => `${l.file}:${String(l.target_role)}`), ['openapi.yaml:tests', 'api/x.js:null']);
  await assert.rejects(pool.query(`INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, source, target_role) VALUES ($1, $2, 1, 'r', 'f', 'builder', 'contract')`, [tool, cycle]), /deviations_target_role_check/);
});

test('a duplicate task, or a non-deterministic id, is refused', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const id = `${tool}-${cycle}-1-builder`;
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_execution', 'builder', 1)`, [id, tool, cycle]);
  await assert.rejects(
    pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_execution', 'builder', 1)`, [id, tool, cycle]),
    /duplicate key|unique/i,
  );
  await assert.rejects(
    pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ('free-task', $1, $2, 'hardening_execution', 'tests', 1)`, [tool, cycle]),
    /tasks_deterministic_id/,
  );
  await assert.rejects(
    pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_execution', 'devops', 1)`, [`${tool}-${cycle}-1-devops`, tool, cycle]),
    /check/i,
  );
  // done without a report: refused (fail-closed).
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [id]), /tasks_report_if_finished/);
});

test('a transition outside the machine, or without a trigger, is refused', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await assert.rejects(transition(cycle, 'end_success', 'task:done'), /transition not allowed/);
  await assert.rejects(transition(cycle, 'scoping', 'guard:creation'), /transition not allowed/);
  await assert.rejects(transition(cycle, 'overlap_search', 'gate:approved'), /transition not allowed/);
  await assert.rejects(pool.query(`UPDATE cycles SET state = 'overlap_search' WHERE id = $1`, [cycle]), /without a trigger/);
  await assert.rejects(transition(cycle, 'unknown_state', 'guard:creation'), /transition not allowed|foreign key/i);
  const state = await pool.query<{ state: string }>('SELECT state FROM cycles WHERE id = $1', [cycle]);
  assert.equal(state.rows[0]!.state, 'request_received');
});

test('an allowed transition is accepted and writes the history; an end closes the cycle', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await transition(cycle, 'overlap_search', 'guard:creation');
  await transition(cycle, 'gate_overlap', 'task:failed');
  await transition(cycle, 'end_refusal', 'gate:refused', ADMIN.id);
  const h = await pool.query<{ previous_state: string | null; state: string; trigger: string; actor: string }>(
    'SELECT previous_state, state, trigger, actor FROM tool_history WHERE cycle_id = $1 ORDER BY id', [cycle]);
  assert.deepEqual(h.rows, [
    { previous_state: null, state: 'request_received', trigger: 'cycle_created', actor: REQUESTER_MAIL },
    { previous_state: 'request_received', state: 'overlap_search', trigger: 'guard:creation', actor: 'orchestrator' },
    { previous_state: 'overlap_search', state: 'gate_overlap', trigger: 'task:failed', actor: 'orchestrator' },
    { previous_state: 'gate_overlap', state: 'end_refusal', trigger: 'gate:refused', actor: 'admin@example.test' },
  ]);
  const o = await pool.query<{ current_state: string; current_cycle_id: number }>('SELECT current_state, current_cycle_id FROM tools WHERE id = $1', [tool]);
  assert.deepEqual(o.rows[0], { current_state: 'end_refusal', current_cycle_id: cycle });
  const c = await pool.query<{ finished_at: Date | null }>('SELECT finished_at FROM cycles WHERE id = $1', [cycle]);
  assert.ok(c.rows[0]!.finished_at instanceof Date);
  // An end state has no way out: nothing goes through any more.
  await assert.rejects(transition(cycle, 'scoping', 'gate:approved'), /transition not allowed/);
  // A refused creation archives the tool: no more cycles on it (decision 1).
  await assert.rejects(createCycle(tool, 'evolution'), /archived/);
  // A successful creation frees the tool for an evolution…
  const delivered = await createTool();
  const creation = await createCycle(delivered);
  await forceState(creation, 'prod_deployment');
  await transition(creation, 'end_success', 'task:done');
  const evolution = await createCycle(delivered, 'evolution');
  await transition(evolution, 'scoping', 'guard:evolution');
  // …but only one cycle in progress per tool (decision 15).
  await assert.rejects(createCycle(delivered, 'evolution'), /cycles_one_in_progress/);
});

test('decisions 1 and 9: creation not completed → tool archived (final, nothing deleted); evolution stopped → tool intact', async () => {
  const paths = [
    ['scoping_pause', 'timeout_exceeded', 'end_abandonment'],
    ['gate_2', 'gate:refused', 'end_refusal'],
    ['waiting_preview_feedback', 'cancellation', 'end_cancellation'],
  ] as const;
  for (const [depart, trigger, end] of paths) {
    const tool = await createTool();
    const cycle = await createCycle(tool);
    assert.equal(await archiveLe(tool), null);
    await forceState(cycle, depart);
    await transition(cycle, end, trigger, ADMIN.id);
    assert.ok((await archiveLe(tool)) instanceof Date, `${end}: creation not archived`);
    await assert.rejects(createCycle(tool, 'evolution'), /archived/);
    // History, cycle and tool still there.
    const n = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM tool_history WHERE tool_id = $1', [tool]);
    assert.ok(n.rows[0]!.n >= 2);
  }
  // An evolution that stops (admin cancellation after the merge) does not touch the tool in production.
  const tool = await createTool();
  const creation = await createCycle(tool);
  await forceState(creation, 'prod_deployment');
  await transition(creation, 'end_success', 'task:done');
  const evolution = await createCycle(tool, 'evolution');
  await forceState(evolution, 'waiting_preview_feedback');
  await transition(evolution, 'end_cancellation', 'cancellation', ADMIN.id);
  assert.equal(await archiveLe(tool), null);
  await createCycle(tool, 'evolution'); // a new cycle remains possible
});

test('decision 2: "scope change" exists only at Gate 1, commented, and leads to the contract', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await forceState(cycle, 'gate_1');
  await assert.rejects(
    pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role) VALUES ($1, $2, 'gate_1', 'scope_change', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle]),
    /approvals_correction_commented/);
  await pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role, comment) VALUES ($1, $2, 'gate_1', 'scope_change', 'a0000000-0000-4000-8000-000000000001', 'admin', 'Add the PDF export')`, [tool, cycle]);
  await forceState(cycle, 'gate_overlap');
  await assert.rejects(
    pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role, comment) VALUES ($1, $2, 'gate_overlap', 'scope_change', 'a0000000-0000-4000-8000-000000000001', 'admin', 'x')`, [tool, cycle]),
    /approvals_gate1_scope/);
  await forceState(cycle, 'gate_1');
  await assert.rejects(transition(cycle, 'scoping', 'gate:scope_change', ADMIN.id), /transition not allowed/);
  await transition(cycle, 'contract', 'gate:scope_change', ADMIN.id);
  await forceState(cycle, 'gate_2');
  await assert.rejects(transition(cycle, 'contract', 'gate:scope_change', ADMIN.id), /transition not allowed/);
});

test('decisions 7 and 10: a "blocked" task carries its reason; the overlap role exists', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const id = `${tool}-${cycle}-1-overlap`;
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'overlap_search', 'overlap', 1)`, [id, tool, cycle]);
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [id]), /tasks_report_if_finished|tasks_blocked_with_reason/);
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'blocked', report = '{"status":"blocked","blocked_reason":null}' WHERE id = $1`, [id]), /tasks_blocked_with_reason/);
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'blocked', report = '{"status":"blocked","blocked_reason":"  "}' WHERE id = $1`, [id]), /tasks_blocked_with_reason/);
  await pool.query(`UPDATE tasks SET status = 'blocked', report = '{"status":"blocked","blocked_reason":"registry unreachable"}' WHERE id = $1`, [id]);
});

test('decision 11: CI / pipeline results are stored per check and per round; a red one sends back to hardening', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const digest = 'sha256:' + 'b'.repeat(64);
  let passage = await visit(cycle);
  const insert = async (pipeline: string, result: string, emp: string | null, iteration = 3) => {
    passage = await visit(cycle);
    await forceState(cycle, 'gate_1');
    await forceState(cycle, pipeline === 'ci' ? 'waiting_ci' : 'preview_pipeline'); // a fresh pass per result
    return pool.query(`INSERT INTO pipeline_results (tool_id, cycle_id, iteration, pipeline, digest, check_name, result, details, visit) VALUES ($1, $2, $3, $4, $5, 'dast', $6, '{"url":"…"}', $7)`, [tool, cycle, iteration, pipeline, emp, result, await visit(cycle)]);
  };
  await insert('preview', 'red', digest);
  await insert('preview', 'green', digest);
  await insert('ci', 'red', null);
  await assert.rejects(insert('preview', 'red', null), /pipeline_results_digest/);
  await assert.rejects(insert('ci', 'green', null), /pipeline_results_digest/);
  await assert.rejects(insert('sonar', 'red', digest), /check/i);
  await assert.rejects(insert('preview', 'orange', digest), /check/i);
  await assert.rejects(insert('preview', 'red', digest, 0), /check/i);
  const other = await createTool();
  await assert.rejects(
    pool.query(`INSERT INTO pipeline_results (tool_id, cycle_id, iteration, pipeline, digest, check_name, result, visit) VALUES ($1, $2, 1, 'preview', $3, 'dast', 'red', $4)`, [other, cycle, digest, passage]),
    /foreign key/i);
  // B8: the same check is recorded only once per pass (a retried step does not write a duplicate).
  await insert('preview', 'green', digest);
  await assert.rejects(
    pool.query(`INSERT INTO pipeline_results (tool_id, cycle_id, iteration, pipeline, digest, check_name, result, visit) VALUES ($1, $2, 3, 'preview', $3, 'dast', 'red', $4)`, [tool, cycle, digest, await visit(cycle)]),
    /pipeline_results_one_per_pass/);
  // "For how many rounds" is read per cycle and round.
  const red = await pool.query<{ iteration: number; check: string }>(`SELECT iteration, check_name AS "check" FROM pipeline_results WHERE cycle_id = $1 AND pipeline = 'preview' AND result = 'red' ORDER BY iteration`, [cycle]);
  assert.deepEqual(red.rows, [{ iteration: 3, check: 'dast' }]);
  await forceState(cycle, 'preview_pipeline');
  await assert.rejects(transition(cycle, 'gate_2', 'event:preview_pipeline_finished'), /transition not allowed/);
  await transition(cycle, 'hardening_execution', 'event:preview_pipeline_finished:red');
  await forceState(cycle, 'preview_pipeline');
  // S5: green leads to the requester's feedback, never straight to Gate 2; the `satisfied` feedback opens it without going
  // through the pipeline again.
  await assert.rejects(transition(cycle, 'gate_2', 'event:preview_pipeline_finished:green'), /transition not allowed/);
  await transition(cycle, 'waiting_preview_feedback', 'event:preview_pipeline_finished:green');
  await assert.rejects(transition(cycle, 'preview_pipeline', 'event:preview_feedback:satisfied', REQUESTER.id), /transition not allowed/);
  await transition(cycle, 'gate_2', 'event:preview_feedback:satisfied', REQUESTER.id);
  // Arbitration A: out-of-scope diff at the merge → hardening; technical failure → delivery blocked.
  await forceState(cycle, 'merge');
  await transition(cycle, 'hardening_execution', 'guard:diff_out_of_scope');
  await forceState(cycle, 'merge');
  await assert.rejects(transition(cycle, 'hardening_execution', 'task:failed'), /transition not allowed/);
  await transition(cycle, 'gate_delivery_blocked', 'task:failed');
});

test('D20: deviations deduplicated by (rule, file) and per round in the database, append-only; tree digest per code role', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const insert = (iteration: number, rule: string, file: string, source = 'security-reviewer', extra: Record<string, string | null> = {}) =>
    pool.query(
      `INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, source, category, finding_id, previous_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tool, cycle, iteration, rule, file, source, extra['category'] ?? null, extra['finding_id'] ?? null, extra['previous_id'] ?? null]);
  await insert(1, 'SEC-IDOR', 'api/tools.js', 'security-reviewer', { category: 'security.md#Requests', finding_id: 'F-001' });
  // Same (rule, file) in the same round, another source: duplicate refused by the database (a single counter).
  await assert.rejects(insert(1, 'SEC-IDOR', 'api/tools.js', 'quality-reviewer'), /deviations_one_per_digest_and_round/);
  // Same deviation in the next round: accepted (that is what gets counted).
  await insert(2, 'SEC-URL', 'api/tools.js', 'security-reviewer', { category: 'security.md#Requests', finding_id: 'F-001', previous_id: 'F-001' });
  // Deviations from the orchestrator: no category, never a previous_id.
  await insert(2, 'ci:opengrep:abc_0', 'web/app.js', 'orchestrator');
  await insert(2, 'code:unchanged:builder', 'builder', 'orchestrator');
  await insert(2, 'report:quality-reviewer', 'report', 'orchestrator');
  await assert.rejects(insert(2, 'scope:x', 'x', 'orchestrator', { previous_id: 'F-001' }), /deviations_previous_id_reviewer/);
  await assert.rejects(insert(2, '', 'api/tools.js'), /check/i);
  await assert.rejects(insert(0, 'SEC-IDOR', 'api/tools.js'), /check/i);
  await assert.rejects(insert(2, 'SEC-IDOR', 'api/tools.js', 'devops'), /check/i);
  const other = await createTool();
  await assert.rejects(pool.query(`INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, source) VALUES ($1, $2, 1, 'SEC-IDOR', 'a', 'orchestrator')`, [other, cycle]), /foreign key/i);
  await assert.rejects(pool.query(`UPDATE deviations SET rule = 'x' WHERE cycle_id = $1`, [cycle]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM deviations WHERE cycle_id = $1`, [cycle]), /append-only/);
  // The number of deduplicated deviations per round (M3) is read directly.
  const n = await pool.query<{ iteration: number; n: number }>('SELECT iteration, count(*)::int AS n FROM deviations WHERE cycle_id = $1 GROUP BY iteration ORDER BY iteration', [cycle]);
  assert.deepEqual(n.rows, [{ iteration: 1, n: 1 }, { iteration: 2, n: 4 }]);
  // Tree digest: hexadecimal sha256, code roles only.
  const task = (role: string) => `${tool}-${cycle}-1-${role}`;
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_execution', 'builder', 1)`, [task('builder'), tool, cycle]);
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'hardening_review', 'security-reviewer', 1)`, [task('security-reviewer'), tool, cycle]);
  await assert.rejects(pool.query(`UPDATE tasks SET tree_hash = 'abc' WHERE id = $1`, [task('builder')]), /check/i);
  await assert.rejects(pool.query(`UPDATE tasks SET tree_hash = $2 WHERE id = $1`, [task('security-reviewer'), 'a'.repeat(64)]), /tasks_tree_hash_code_role/);
  await pool.query(`UPDATE tasks SET tree_hash = $2 WHERE id = $1`, [task('builder'), 'a'.repeat(64)]);
});

test('the admin cancellation is accepted from every non-final state', async () => {
  for (const e of STATES.filter((e) => e.kind !== 'end' && e.id !== 'request_received')) {
    const tool = await createTool();
    const cycle = await createCycle(tool);
    await forceState(cycle, e.id);
    await transition(cycle, 'end_cancellation', 'cancellation', ADMIN.id);
  }
});

test('history and approvals are append-only', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await assert.rejects(pool.query(`UPDATE tool_history SET actor = 'x' WHERE cycle_id = $1`, [cycle]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM tool_history WHERE cycle_id = $1`, [cycle]), /append-only/);
  await forceState(cycle, 'gate_overlap');
  await pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role) VALUES ($1, $2, 'gate_overlap', 'approved', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle]);
  await assert.rejects(pool.query(`UPDATE approvals SET decision = 'refused' WHERE cycle_id = $1`, [cycle]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM approvals WHERE cycle_id = $1`, [cycle]), /append-only/);
});

test('B7: finished_at and archived_at are set only by the machine; a cycle is born in the initial state', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  // `finished_at`: neither set by hand on an open cycle (it would free the tool for a 2nd cycle), nor removed from a finished cycle.
  await assert.rejects(pool.query(`UPDATE cycles SET finished_at = now() WHERE id = $1`, [cycle]), /finished_at is set by the machine/);
  await transition(cycle, 'overlap_search', 'guard:creation');
  const open = await pool.query<{ finished_at: Date | null }>('SELECT finished_at FROM cycles WHERE id = $1', [cycle]);
  assert.equal(open.rows[0]!.finished_at, null);
  await pool.query(`UPDATE cycles SET state = 'gate_overlap', last_trigger = 'task:failed', last_actor_id = '00000000-0000-0000-0000-000000000001', finished_at = now() WHERE id = $1`, [cycle]);
  assert.equal((await pool.query<{ finished_at: Date | null }>('SELECT finished_at FROM cycles WHERE id = $1', [cycle])).rows[0]!.finished_at, null, 'a transition to a non-final state does not set finished_at');
  await transition(cycle, 'end_refusal', 'gate:refused', ADMIN.id);
  await assert.rejects(pool.query(`UPDATE cycles SET finished_at = NULL WHERE id = $1`, [cycle]), /finished_at is set by the machine/);
  // `archived_at`: set by the cycles trigger (refused creation), never by hand, never removed.
  assert.ok((await archiveLe(tool)) instanceof Date);
  await assert.rejects(pool.query(`UPDATE tools SET archived_at = NULL WHERE id = $1`, [tool]), /archived_at is set by the machine/);
  const other = await createTool();
  await assert.rejects(pool.query(`UPDATE tools SET archived_at = now() WHERE id = $1`, [other]), /archived_at is set by the machine/);
  await assert.rejects(pool.query(`INSERT INTO tools (name, slug, requester_id, owner_service, archived_at) VALUES ('A', 'archived-at-birth', 'd0000000-0000-4000-8000-000000000001', 's', now())`), /born unarchived/);
  await pool.query(`UPDATE tools SET name = 'Renamed' WHERE id = $1`, [other]); // the other columns remain modifiable
  // INSERT: initial state and open cycle only.
  await assert.rejects(pool.query(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id, state) VALUES ($1, 'creation', 10, 20, 'd0000000-0000-4000-8000-000000000001', 'gate_2')`, [other]), /born in state request_received/);
  await assert.rejects(pool.query(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id, finished_at) VALUES ($1, 'creation', 10, 20, 'd0000000-0000-4000-8000-000000000001', now())`, [other]), /born in state request_received/);
});

test('B7: deployments, pipeline results and messages are append-only', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const digest = 'sha256:' + 'c'.repeat(64);
  const v = await visit(cycle);
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, 'op-1-a')`, [tool, cycle, digest, v]);
  // B8 / G3: a single record per deployment operation; a new attempt within the same pass gets its own.
  await assert.rejects(pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, 'op-1-a')`, [tool, cycle, digest, v]), /deployments_one_per_operation/);
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, 'op-1-b')`, [tool, cycle, digest, v]);
  await pool.query(`INSERT INTO pipeline_results (tool_id, cycle_id, iteration, pipeline, digest, check_name, result, visit) VALUES ($1, $2, 1, 'preview', $3, 'dast', 'green', $4)`, [tool, cycle, digest, v]);
  await pool.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'requester', 'd0000000-0000-4000-8000-000000000001', 'hello')`, [tool, cycle]);
  for (const table of ['deployments', 'pipeline_results', 'messages']) {
    await assert.rejects(pool.query(`UPDATE ${table} SET cycle_id = cycle_id WHERE cycle_id = $1`, [cycle]), /append-only/, `${table}: UPDATE`);
    await assert.rejects(pool.query(`DELETE FROM ${table} WHERE cycle_id = $1`, [cycle]), /append-only/, `${table}: DELETE`);
  }
});

test('B9: TRUNCATE refused on the append-only tables, even cascading', async () => {
  for (const table of ['tool_history', 'approvals', 'deviations', 'deployments', 'pipeline_results', 'messages']) {
    await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`), /TRUNCATE refused/, table);
  }
  await assert.rejects(pool.query('TRUNCATE tools CASCADE'), /TRUNCATE refused/);
});

test('B9: sensitive columns of cycles and tools out of reach, except for the machine', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await assert.rejects(pool.query(`UPDATE cycles SET hardening_budget_usd = 99999999 WHERE id = $1`, [cycle]), /approved top-up/);
  await assert.rejects(pool.query(`UPDATE cycles SET scoping_budget_usd = 1 WHERE id = $1`, [cycle]), /approved top-up/);
  await assert.rejects(pool.query(`UPDATE cycles SET type = 'evolution' WHERE id = $1`, [cycle]), /immutable/);
  await assert.rejects(pool.query(`UPDATE cycles SET last_trigger = 'gate:approved', last_actor_id = 'a0000000-0000-4000-8000-000000000001' WHERE id = $1`, [cycle]), /only change with a transition/);
  await assert.rejects(pool.query(`UPDATE tools SET current_state = 'end_success' WHERE id = $1`, [tool]), /kept by the machine/);
  await assert.rejects(pool.query(`UPDATE tools SET current_cycle_id = NULL WHERE id = $1`, [tool]), /kept by the machine/);
  // The top-up goes through an approval at the gate, which raises the envelope of its phase (D2, B4), with the approval
  // transition in the same transaction (M8); on its own, it is refused.
  await forceState(cycle, 'gate_contract_blocked');
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, budget_top_up_usd, actor_id, role) VALUES ($1, $2, 'gate_contract_blocked', 'approved', 5, 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle]), /top-up refused: only with the "approved" transition/);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, budget_top_up_usd, actor_id, role) VALUES ($1, $2, 'gate_contract_blocked', 'approved', 5, 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle]);
    await client.query(`UPDATE cycles SET state = 'contract', last_trigger = 'gate:approved', last_actor_id = 'a0000000-0000-4000-8000-000000000001' WHERE id = $1`, [cycle]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const b = await pool.query<{ c: string; d: string }>('SELECT scoping_budget_usd::text AS c, hardening_budget_usd::text AS d FROM cycles WHERE id = $1', [cycle]);
  assert.deepEqual(b.rows[0], { c: '10.00', d: '25.00' });
  await forceState(cycle, 'gate_1');
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, budget_top_up_usd, actor_id, role) VALUES ($1, $2, 'gate_1', 'approved', 5, 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle]), /top-up irrelevant/);
});

test('B9: an approval only at the gate where the cycle is; the Prod only from a digest approved at Gate 2', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const e = (c: string) => 'sha256:' + c.repeat(64);
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle, e('a')]), /is not at gate gate_2/);
  await forceState(cycle, 'prod_deployment');
  await assert.rejects(pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'prod', $3, 'ok', $4, 'op-b9-0')`, [tool, cycle, e('b'), await visit(cycle)]), /was not approved at Gate 2/);
  await forceState(cycle, 'gate_2');
  // M8: Gate 2 only approves the candidate digest (last Preview deployment of the cycle, healthy).
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle, e('b')]), /is not the candidate digest/);
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, 'op-b9-1')`, [tool, cycle, e('a'), await visit(cycle)]);
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, 'op-b9-2')`, [tool, cycle, e('b'), await visit(cycle)]);
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle, e('a')]), /is not the candidate digest/);
  await pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', 'a0000000-0000-4000-8000-000000000001', 'admin')`, [tool, cycle, e('b')]);
  await forceState(cycle, 'prod_deployment');
  // M5: a failed row records what was really served, even if not approved; never a healthy row.
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'prod', $3, 'failed', $4, 'op-b9-3')`, [tool, cycle, e('c'), await visit(cycle)]);
  await assert.rejects(pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'prod', $3, 'ok', $4, 'op-b9-4')`, [tool, cycle, e('c'), await visit(cycle)]), /was not approved at Gate 2/);
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'prod', $3, 'ok', $4, 'op-b9-5')`, [tool, cycle, e('b'), await visit(cycle)]);
});

test('B9: a forged history row does not fool the resume check; a repeat in place must be allowed', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await transition(cycle, 'gate_incident', 'incident');
  // Row "incident coming from gate_2" forged by hand, then "retry" towards gate_2: refused.
  await assert.rejects(pool.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, 'gate_2', 'gate_incident', 'incident', 'a0000000-0000-4000-8000-000000000001')`, [tool, cycle]), /is written only by the machine/);
  await assert.rejects(pool.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, 'gate_incident', 'gate_incident', 'incident', 'a0000000-0000-4000-8000-000000000001')`, [tool, cycle]), /repeat in place not allowed/);
  await assert.rejects(transition(cycle, 'gate_2', 'resume:gate_2', ADMIN.id), /resume to gate_2 refused/);
  // Allowed traces: on the current state, check, cleanup, or reminder provided for by the machine.
  await pool.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, 'gate_incident', 'gate_incident', 'timeout_exceeded', '00000000-0000-0000-0000-000000000001')`, [tool, cycle]);
  await pool.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, 'gate_incident', 'gate_incident', 'check:budget:x', '00000000-0000-0000-0000-000000000001')`, [tool, cycle]);
  await assert.rejects(pool.query(`INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id) VALUES ($1, $2, 'scoping', 'scoping', 'timeout_exceeded', '00000000-0000-0000-0000-000000000001')`, [tool, cycle]), /is written only by the machine/);
  await transition(cycle, 'request_received', 'resume:request_received', ADMIN.id);
});

test('C: the name of a tool contains neither a line break nor a control character', async () => {
  await assert.rejects(pool.query(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES (E'Tool\r\nBcc: x@y', 'name-ctrl', 'd0000000-0000-4000-8000-000000000001', 's')`), /check/i);
});

test('D21: "retry" at the incident gate only goes back to the state the incident comes from (checked by the database)', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await transition(cycle, 'overlap_search', 'guard:creation');
  await transition(cycle, 'gate_incident', 'incident');
  // Transition provided for by the machine (`resume:scoping` exists), but the incident comes from `overlap_search`.
  await assert.rejects(transition(cycle, 'scoping', 'resume:scoping', ADMIN.id), /resume to scoping refused/);
  await assert.rejects(transition(cycle, 'scoping', 'resume:overlap_search', ADMIN.id), /transition not allowed/);
  await transition(cycle, 'overlap_search', 'resume:overlap_search', ADMIN.id);
  // Second incident from another state: the LAST incident is the one that counts.
  await transition(cycle, 'gate_overlap', 'task:failed');
  await transition(cycle, 'gate_incident', 'incident');
  await assert.rejects(transition(cycle, 'overlap_search', 'resume:overlap_search', ADMIN.id), /resume to overlap_search refused/);
  await transition(cycle, 'gate_overlap', 'resume:gate_overlap', ADMIN.id);
  // Without any incident in the history (forced state), no resume.
  const other = await createCycle(await createTool());
  await forceState(other, 'gate_incident');
  await assert.rejects(transition(other, 'scoping', 'resume:scoping', ADMIN.id), /resume to scoping refused/);
  await transition(other, 'end_refusal', 'gate:refused', ADMIN.id);
});

test('an invalid decision is refused', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const insert = (gate: string, decision: string, extra = '', values: unknown[] = []) =>
    pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role ${extra ? ', ' + extra : ''}) VALUES ($1, $2, $3, $4, 'a0000000-0000-4000-8000-000000000001', 'admin' ${values.map((_, i) => `, $${i + 5}`).join('')})`, [tool, cycle, gate, decision, ...values]);
  await assert.rejects(insert('scoping', 'approved'), /is not a gate/);
  await forceState(cycle, 'gate_1');
  await assert.rejects(insert('gate_1', 'maybe'), /check/i);
  await assert.rejects(insert('gate_1', 'top_up'), /check/i);
  await assert.rejects(insert('gate_1', 'correction'), /approvals_correction_commented/);
  await assert.rejects(insert('gate_1', 'refused', 'budget_top_up_usd', [5]), /approvals_top_up_if_approved/);
  await insert('gate_1', 'correction', 'comment', ['Rename to "PPE tracking"']);
  await forceState(cycle, 'gate_2');
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, $5)`, [tool, cycle, 'sha256:' + 'a'.repeat(64), await visit(cycle), `op-${cycle}-inv`]);
  await assert.rejects(insert('gate_2', 'approved'), /approvals_gate2_digest/);
  await assert.rejects(insert('gate_2', 'approved', 'digest', ['latest']), /check/i);
  await insert('gate_2', 'approved', 'digest', ['sha256:' + 'a'.repeat(64)]);
});

test('M8: a task is never deleted; its cost is set only once, at closing; a closed task no longer changes', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const id = `${tool}-${cycle}-1-scoping`;
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'scoping', 'scoping', 1)`, [id, tool, cycle]);
  await assert.rejects(pool.query(`UPDATE tasks SET cost_usd = 2 WHERE id = $1`, [id]), /set when it closes, not before/);
  await pool.query(`UPDATE tasks SET status = 'in_progress', executions = 1 WHERE id = $1`, [id]);
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'queued' WHERE id = $1`, [id]), /does not go back to the queue/);
  await assert.rejects(pool.query(`UPDATE tasks SET executions = 0 WHERE id = $1`, [id]), /does not decrease/);
  await assert.rejects(pool.query(`UPDATE tasks SET role = 'overlap' WHERE id = $1`, [id]), /is immutable/);
  await pool.query(`UPDATE tasks SET status = 'done', cost_usd = 1.5, report = '{"status":"done"}' WHERE id = $1`, [id]);
  await assert.rejects(pool.query(`UPDATE tasks SET cost_usd = 0 WHERE id = $1`, [id]), /closed \(done\), nothing changes any more/);
  await assert.rejects(pool.query(`UPDATE tasks SET status = 'failed' WHERE id = $1`, [id]), /close/);
  await assert.rejects(pool.query(`DELETE FROM tasks WHERE id = $1`, [id]), /deletion refused/);
  await assert.rejects(pool.query('TRUNCATE tasks CASCADE'), /TRUNCATE refused/);
  assert.equal((await pool.query<{ c: string }>('SELECT cost_usd::text AS c FROM tasks WHERE id = $1', [id])).rows[0]!.c, '1.5000');
});

test('M8: the workflow memory is written only with a transition of the cycle, in the same transaction; never deleted', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await assert.rejects(pool.query(`INSERT INTO cycle_memory (cycle_id, memory) VALUES ($1, '{}')`, [cycle]), /changes only with a transition/);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE cycles SET state = 'overlap_search', last_trigger = 'guard:creation', last_actor_id = '00000000-0000-0000-0000-000000000001' WHERE id = $1`, [cycle]);
    await client.query(`INSERT INTO cycle_memory (cycle_id, memory) VALUES ($1, '{"instruction":"x"}')`, [cycle]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  await assert.rejects(pool.query(`UPDATE cycle_memory SET memory = '{}' WHERE cycle_id = $1`, [cycle]), /changes only with a transition/);
  await assert.rejects(pool.query(`DELETE FROM cycle_memory WHERE cycle_id = $1`, [cycle]), /deletion refused/);
  await assert.rejects(pool.query('TRUNCATE cycle_memory'), /TRUNCATE refused/);
});

test('M8: a single creation cycle per tool; a request on an existing tool is an evolution', async () => {
  const alive = await createTool();
  const c1 = await createCycle(alive);
  await forceState(c1, 'prod_deployment');
  await transition(c1, 'end_success', 'task:done');
  await assert.rejects(createCycle(alive, 'creation'), /a single creation cycle/);
  await createCycle(alive, 'evolution');
});

test('the migrations undo and replay (fresh database: the data is not emptied, TRUNCATE is refused, B9)', async () => {
  await createDatabase(postgres, 'round_trip');
  const url = urlBase(postgres.ownerUrl, 'round_trip');
  const other = new pg.Pool({ connectionString: urlBase(postgres.urlAdmin, 'round_trip') });
  try {
    await migrateTo(url, 'up');
    await migrateTo(url, 'down');
    const tables = await other.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`);
    assert.equal(tables.rows[0]!.n, 0);
    await migrateTo(url, 'up');
    const n = await other.query<{ n: number }>('SELECT count(*)::int AS n FROM allowed_transitions');
    assert.equal(n.rows[0]!.n, TRANSITIONS.length);
  } finally {
    await other.end();
  }
});

// ── Step 6: restricted account of the engine ──────────────────────────────────
/** Refusal by PostgreSQL itself (missing privilege or ownership: SQLSTATE 42501), not by a trigger. */
const refusedToEngine = (sql: string) => assert.rejects(engine.query(sql), { code: '42501' }, sql);
const APPEND_ONLY = ['tool_history', 'approvals', 'deviations', 'deployments', 'pipeline_results', 'messages'];

test('step 6: the engine can neither modify nor empty the append-only tables', async () => {
  for (const t of APPEND_ONLY) {
    await refusedToEngine(`UPDATE ${t} SET tool_id = tool_id`);
    await refusedToEngine(`DELETE FROM ${t}`);
    await refusedToEngine(`TRUNCATE ${t}`);
  }
  // I0: an (issuer, subject) → actor link is neither modified nor deleted; an actor never is.
  await refusedToEngine('UPDATE actor_identities SET actor_id = actor_id');
  await refusedToEngine('DELETE FROM actor_identities');
  await refusedToEngine('TRUNCATE actor_identities');
  await refusedToEngine(`UPDATE actors SET type = type`);
  await refusedToEngine('DELETE FROM actors');
  // 0010: an actor merge is neither modified nor deleted (the engine writes it for the admin API, nothing more).
  await refusedToEngine('UPDATE actor_merges SET reason = reason');
  await refusedToEngine('DELETE FROM actor_merges');
  await refusedToEngine('TRUNCATE actor_merges');
  // E1: deleting or changing the key of a sent notification would send it again.
  await refusedToEngine('UPDATE sent_notifications SET key = key');
  await refusedToEngine('DELETE FROM sent_notifications');
  await refusedToEngine('TRUNCATE sent_notifications');
});

test('step 6: the engine can neither bypass the triggers, nor change the schema, nor the machine, nor delete', async () => {
  await refusedToEngine('ALTER TABLE cycles DISABLE TRIGGER cycles_transition');
  await refusedToEngine('ALTER TABLE tool_history DISABLE TRIGGER ALL');
  await refusedToEngine('DROP TRIGGER tool_history_append_only ON tool_history');
  await refusedToEngine('SET session_replication_role = replica');
  await refusedToEngine('CREATE TABLE intruder (x int)');
  await refusedToEngine('CREATE SCHEMA intruder');
  await refusedToEngine('UPDATE allowed_transitions SET note = note');
  await refusedToEngine('INSERT INTO allowed_transitions SELECT * FROM allowed_transitions LIMIT 0');
  await refusedToEngine('DELETE FROM cycles');
  await refusedToEngine('DELETE FROM tasks');
  await refusedToEngine('SELECT * FROM pgmigrations');
});

test('step 6: the engine makes its normal writes, and the triggers write the history with its rights', async () => {
  const tool = (await engine.query<{ id: number }>(
    `INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ('Engine tool', 'engine-tool', 'd0000000-0000-4000-8000-000000000001', 'service-test') RETURNING id`)).rows[0]!.id;
  const cycle = (await engine.query<{ id: number }>(
    `INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES ($1, 'creation', 10, 20, 'd0000000-0000-4000-8000-000000000001') RETURNING id`, [tool])).rows[0]!.id;
  const client = await engine.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE cycles SET state = 'overlap_search', last_trigger = 'guard:creation', last_actor_id = '00000000-0000-0000-0000-000000000001' WHERE id = $1`, [cycle]);
    await client.query(`INSERT INTO cycle_memory (cycle_id, memory) VALUES ($1, '{"instruction":"x"}')`, [cycle]);
    await client.query(`INSERT INTO events (tool_id, cycle_id, type, payload) VALUES ($1, $2, 'transition', '{}')`, [tool, cycle]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const task = `${tool}-${cycle}-1-overlap`;
  await engine.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'overlap_search', 'overlap', 1)`, [task, tool, cycle]);
  await engine.query(`UPDATE tasks SET status = 'in_progress', executions = 1 WHERE id = $1`, [task]);
  await engine.query(`UPDATE events SET status = 'dispatched', handled_at = now() WHERE cycle_id = $1`, [cycle]);
  await engine.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'orchestrator', '00000000-0000-0000-0000-000000000001', 'hello')`, [tool, cycle]);
  const h = await engine.query('SELECT previous_state, state, trigger FROM tool_history WHERE cycle_id = $1 ORDER BY id', [cycle]);
  assert.deepEqual(h.rows, [
    { previous_state: null, state: 'request_received', trigger: 'cycle_created' },
    { previous_state: 'request_received', state: 'overlap_search', trigger: 'guard:creation' },
  ]);
  const o = await engine.query('SELECT current_state, current_cycle_id::int AS c FROM tools WHERE id = $1', [tool]);
  assert.deepEqual(o.rows[0], { current_state: 'overlap_search', c: Number(cycle) });
});

test('step 6: a future table of the owner is readable and appendable by the engine, never modifiable by default', async () => {
  const owner = new pg.Client({ connectionString: postgres.ownerUrl });
  await owner.connect();
  try {
    await owner.query('CREATE TABLE future (x int)');
    await engine.query('INSERT INTO future VALUES (1)');
    assert.equal((await engine.query('SELECT x FROM future')).rows.length, 1);
    await refusedToEngine('UPDATE future SET x = 2');
    await refusedToEngine('DELETE FROM future');
  } finally {
    await owner.query('DROP TABLE IF EXISTS future');
    await owner.end();
  }
});

// ── I0 (ADR-017): identity of people ──────────────────────────────────────────
const principal = (subject: string, mail: string | null = `${subject}@example.test`, name = subject) => ({ issuer: TEST_ISSUER, subject: subject, mail, name: name, roles: [] as const });

test('I0: a person = (issuer, subject) — two subjects make two actors, a link set by INSERT attaches a new subject to the same actor, the mail never merges', async () => {
  const base = new Database(engine);
  const a = await base.resolveActor(principal('alice', 'alice@example.test', 'Alice'));
  assert.equal(await base.resolveActor(principal('alice', 'alice@example.test', 'Alice Martin')), a, 'same subject: same actor, name refreshed');
  assert.deepEqual((await pool.query('SELECT display_name, mail, type FROM actors WHERE id = $1', [a])).rows[0], { display_name: 'Alice Martin', mail: 'alice@example.test', type: 'human' });
  // Same mail, another subject (account recreated in the directory): ANOTHER actor; never a linking by mail.
  const a2 = await base.resolveActor(principal('alice-recreated', 'alice@example.test', 'Alice'));
  assert.notEqual(a2, a);
  // Same subject at another issuer: another actor too (D2: changing domain = bulk INSERT by the admin).
  assert.notEqual(await base.resolveActor({ ...principal('alice'), issuer: 'https://other.example.test/realms/eupadev' }), a);
  // Linking: an admin INSERTS the link from the new subject to the original actor (traced by the reason); the audit
  // rows already written do not move; the next visit of this subject is the original actor.
  await pool.query(`INSERT INTO actor_identities (issuer, subject, actor_id, reason) VALUES ($1, 'alice-new-sub', $2, 'objectGUID changed after an AD migration, ticket 42')`, [TEST_ISSUER, a]);
  assert.equal(await base.resolveActor(principal('alice-new-sub', 'alice@example.test', 'Alice')), a);
  // Append only: neither UPDATE nor DELETE of a link, even by the owner; the engine does not even have the privilege.
  await assert.rejects(pool.query(`UPDATE actor_identities SET actor_id = $1 WHERE subject = 'alice-recreated'`, [a]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM actor_identities WHERE subject = 'alice-recreated'`), /append-only/);
  await assert.rejects(pool.query('TRUNCATE actor_identities'), /TRUNCATE refused/);
  await refusedToEngine(`UPDATE actor_identities SET reason = reason`);
  // An actor is never deleted; `id` and `type` immutable; the engine only modifies the contact.
  await assert.rejects(pool.query('DELETE FROM actors WHERE id = $1', [a2]), /deletion refused/);
  await assert.rejects(pool.query(`UPDATE actors SET type = 'machine' WHERE id = $1`, [a2]), /immutable/);
  await refusedToEngine(`UPDATE actors SET type = 'human'`);
  await refusedToEngine('DELETE FROM actors');
  await engine.query(`UPDATE actors SET mail = 'a2@example.test', last_sign_in = now() WHERE id = $1`, [a2]);
  // Two simultaneous first visits of the same subject: a single actor (advisory lock).
  const ids = await Promise.all([1, 2, 3].map(() => base.resolveActor(principal('bob'))));
  assert.equal(new Set(ids).size, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM actor_identities WHERE subject = 'bob'`)).rows[0]!.n, 1);
  // Invalid or empty mail refused by the database (the code never writes one); fixed machines present.
  await assert.rejects(pool.query(`INSERT INTO actors (type, mail, display_name) VALUES ('human', 'not an address', 'X')`), /check/i);
  assert.deepEqual((await pool.query('SELECT id, display_name FROM actors WHERE type = $1 ORDER BY id', ['machine'])).rows, [{ id: ORCHESTRATOR_ACTOR, display_name: 'orchestrator' }, { id: FORGE_ACTOR, display_name: 'forge' }]);
});

test('I0: the audit tables carry the actor id and the name at the time of the facts; without an id, refusal', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const h = await pool.query<{ actor_id: string; actor: string }>('SELECT actor_id, actor FROM tool_history WHERE cycle_id = $1', [cycle]);
  assert.deepEqual(h.rows, [{ actor_id: REQUESTER.id, actor: REQUESTER_MAIL }]);
  await pool.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'admin', $3, 'hello')`, [tool, cycle, ADMIN.id]);
  assert.deepEqual((await pool.query('SELECT author FROM messages WHERE cycle_id = $1', [cycle])).rows, [{ author: ADMIN_MAIL }]);
  // The name is a snapshot: renaming the actor does not rewrite the audit.
  await pool.query(`UPDATE actors SET display_name = 'Renamed Admin' WHERE id = $1`, [ADMIN.id]);
  assert.deepEqual((await pool.query('SELECT author FROM messages WHERE cycle_id = $1', [cycle])).rows, [{ author: ADMIN_MAIL }]);
  await pool.query(`UPDATE actors SET display_name = $2 WHERE id = $1`, [ADMIN.id, ADMIN_MAIL]);
  await assert.rejects(pool.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'admin', NULL, 'anonymous')`, [tool, cycle]), /actor_id required/);
  await assert.rejects(pool.query(`INSERT INTO messages (tool_id, cycle_id, author_type, actor_id, content) VALUES ($1, $2, 'admin', 'ffffffff-0000-4000-8000-000000000000', 'unknown')`, [tool, cycle]), /unknown actor|foreign key/i);
  await assert.rejects(pool.query(`UPDATE cycles SET state = 'overlap_search', last_trigger = 'guard:creation', last_actor_id = NULL WHERE id = $1`, [cycle]), /last_actor_id_present|actor_id required/);
  await assert.rejects(pool.query(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ('Sans', 'no-requester', NULL, 's')`), /tools_requester_id_present/);
});

test('I0: four eyes — the database refuses the Gate 2 approval by the requester of the tool, except a traced exemption; the role is required', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const emp = 'sha256:' + 'd'.repeat(64);
  await forceState(cycle, 'gate_2');
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, $5)`, [tool, cycle, emp, await visit(cycle), `op-${cycle}-4y`]);
  const approve = (actor: string, exemption = false) =>
    pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role, four_eyes_exemption) VALUES ($1, $2, 'gate_2', $3, 'approved', $4, 'admin', $5)`, [tool, cycle, emp, actor, exemption]);
  await assert.rejects(approve(REQUESTER.id), /four eyes/);
  await assert.rejects(pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id) VALUES ($1, $2, 'gate_2', $3, 'approved', $4)`, [tool, cycle, emp, ADMIN.id]), /approvals_actor_id_present/);
  // A correction or a refusal by the requester is not a self-approval (the engine forbids them through the hat).
  await pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role, comment) VALUES ($1, $2, 'gate_2', $3, 'correction', $4, 'admin', 'to be reworked')`, [tool, cycle, emp, REQUESTER.id]);
  await approve(REQUESTER.id, true);
  await approve(ADMIN.id);
  assert.deepEqual((await pool.query(`SELECT decision, actor, four_eyes_exemption FROM approvals WHERE cycle_id = $1 ORDER BY id`, [cycle])).rows,
    [{ decision: 'correction', actor: REQUESTER_MAIL, four_eyes_exemption: false }, { decision: 'approved', actor: REQUESTER_MAIL, four_eyes_exemption: true }, { decision: 'approved', actor: ADMIN_MAIL, four_eyes_exemption: false }]);
});

// ── Measurement per cycle (migrations/0009) ─────────────────────────────────────────────────
/** Task started (one run) then closed with its measurement; `null` = left in progress. */
async function measuredTask(tool: number, cycle: number, iteration: number, role: Parameters<typeof Database.taskId>[2],
  end: { status: string; cost: number; input: number; output: number; duration: number } | null, tentative = 1): Promise<void> {
  const id = Database.taskId({ tool_id: tool, id: cycle }, iteration, role, tentative);
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration, attempt) VALUES ($1, $2, $3, 'scoping', $4, $5, $6)`, [id, tool, cycle, role, iteration, tentative]);
  await pool.query(`UPDATE tasks SET status = 'in_progress', executions = 1 WHERE id = $1`, [id]);
  if (end === null) return;
  const report = { status: end.status, ...(end.status === 'blocked' ? { blocked_reason: 'ambiguous contract' } : {}) };
  await pool.query(`UPDATE tasks SET status = $2, cost_usd = $3, input_tokens = $4, output_tokens = $5, duration_s = $6, report = $7, ended_at = now() WHERE id = $1`,
    [id, end.status, end.cost, end.input, end.output, end.duration, JSON.stringify(report)]);
}
const measure = async (cycle: number) => (await pool.query(
  `SELECT tool, type, state, finished_at IS NOT NULL AS finished, calendar_duration = finished_at - created_at AS exact_calendar_duration, calendar_duration IS NULL AS null_calendar_duration,
          total_cost_usd::text, scoping_cost_usd::text, hardening_cost_usd::text, input_tokens::int, output_tokens::int, work_duration_min::text,
          tasks, failed_tasks, blocked_tasks, hardening_rounds, first_ci_pass_green, deviations, confirmed_blocking_deviations, debt_deviations, gate_decisions
   FROM cycle_measures WHERE cycle_id = $1`, [cycle])).rows[0];

test('measure: values of a finished cycle — cost per envelope (cap included), tokens, duration, failed and blocked tasks, rounds, first CI, deviations, decisions', async () => {
  const tool = await createTool();
  const slug = `tool-${counter}`;
  const cycle = await createCycle(tool);
  await measuredTask(tool, cycle, 1, 'overlap', { status: 'done', cost: 0.5, input: 1000, output: 200, duration: 60 });
  await measuredTask(tool, cycle, 1, 'scoping', { status: 'failed', cost: 1.25, input: 500, output: 100, duration: 30 });
  await measuredTask(tool, cycle, 1, 'scoping', { status: 'done', cost: 0.75, input: 800, output: 150, duration: 90 }, 2);
  await measuredTask(tool, cycle, 1, 'contract', { status: 'done', cost: 1, input: 2000, output: 300, duration: 120 });
  await measuredTask(tool, cycle, 1, 'builder', { status: 'blocked', cost: 2, input: 3000, output: 400, duration: 180 });
  await measuredTask(tool, cycle, 2, 'builder', { status: 'done', cost: 1.5, input: 2500, output: 350, duration: 150 });
  // Never started, closed as failed at 0 (B3): a real zero, known measurement.
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration) VALUES ($1, $2, $3, 'scoping', 'tests', 2)`, [`${tool}-${cycle}-2-tests`, tool, cycle]);
  await pool.query(`UPDATE tasks SET status = 'failed', ended_at = now() WHERE id = $1`, [`${tool}-${cycle}-2-tests`]);
  await pool.query(`INSERT INTO deviations (tool_id, cycle_id, iteration, rule, file, source) VALUES ($1, $2, 1, 'ci:opengrep:x', 'a.js', 'orchestrator'), ($1, $2, 2, 'ci:opengrep:x', 'a.js', 'orchestrator')`, [tool, cycle]);
  // First CI red, the next one green: the first pass is not green.
  await forceState(cycle, 'waiting_ci');
  await transition(cycle, 'hardening_execution', 'event:ci_finished:red', FORGE_ACTOR);
  await forceState(cycle, 'waiting_ci');
  await transition(cycle, 'candidate_image', 'event:ci_finished:green', FORGE_ACTOR);
  await forceState(cycle, 'gate_1');
  await pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, decision, actor_id, role, comment) VALUES ($1, $2, 'gate_1', 'correction', $3, 'admin', 'plus court')`, [tool, cycle, ADMIN.id]);
  const open = await measure(cycle);
  assert.deepEqual([open!.finished, open!.null_calendar_duration], [false, true], 'open cycle: calendar duration unknown');
  await forceState(cycle, 'prod_deployment');
  await transition(cycle, 'end_success', 'task:done');
  assert.deepEqual(await measure(cycle), {
    tool: slug, type: 'creation', state: 'end_success', finished: true, exact_calendar_duration: true, null_calendar_duration: false,
    total_cost_usd: '7.0000', scoping_cost_usd: '2.5000', hardening_cost_usd: '4.5000', input_tokens: 9800, output_tokens: 1500, work_duration_min: '10.50',
    tasks: 7, failed_tasks: 2, blocked_tasks: 1, hardening_rounds: 2, first_ci_pass_green: false, deviations: 2,
    confirmed_blocking_deviations: null, debt_deviations: null, gate_decisions: 1,
  });
});

test('measure: unknown = NULL, never 0 — task in progress, unknown cost counted at the cap, tokens and duration not reported, no CI', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  const empty = await measure(cycle);
  assert.deepEqual([empty!.total_cost_usd, empty!.input_tokens, empty!.work_duration_min, empty!.tasks, empty!.hardening_rounds], ['0', 0, '0.00', 0, 0], 'no task: real zeros');
  await measuredTask(tool, cycle, 1, 'overlap', null);
  const inProgress = await measure(cycle);
  assert.deepEqual(
    [inProgress!.total_cost_usd, inProgress!.scoping_cost_usd, inProgress!.hardening_cost_usd, inProgress!.input_tokens, inProgress!.output_tokens, inProgress!.work_duration_min],
    [null, null, '0', null, null, null], 'scoping task in progress: scoping cost, tokens and duration unknown; hardening really at 0');
  assert.deepEqual([inProgress!.first_ci_pass_green, inProgress!.null_calendar_duration, inProgress!.confirmed_blocking_deviations, inProgress!.debt_deviations], [null, true, null, null]);
  // Cut off (incident, fault): closed at the cap by the existing rule, with no tokens or duration reported.
  await new Database(engine).failOpenTasks(cycle, caps({ overlap: 3 }), 'incident');
  const cut = await measure(cycle);
  assert.deepEqual([cut!.total_cost_usd, cut!.scoping_cost_usd, cut!.failed_tasks, cut!.input_tokens, cut!.output_tokens, cut!.work_duration_min],
    ['3.0000', '3.0000', 1, null, null, null]);
});

/** Budget caps per role: $99 everywhere except the given ones (a role mistaken for another shows). */
const caps = (p: Partial<Record<keyof typeof DEFAULT_THRESHOLDS.task, number>>) =>
  Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS.task).map((r) => [r, { budget_usd: p[r as keyof typeof p] ?? 99 }])) as Record<keyof typeof DEFAULT_THRESHOLDS.task, { budget_usd: number }>;

test('A-R5: a task closed without a result counts at the budget cap of ITS role, per run; queued: 0', async () => {
  const tool = await createTool();
  const cycle = await createCycle(tool);
  await measuredTask(tool, cycle, 1, 'overlap', null);
  await measuredTask(tool, cycle, 1, 'scoping', null);
  await pool.query(`UPDATE tasks SET executions = 2 WHERE cycle_id = $1 AND role = 'scoping'`, [cycle]);
  await pool.query(`INSERT INTO tasks (id, tool_id, cycle_id, step, role, iteration, attempt) VALUES ($1, $2, $3, 'scoping', 'scoping', 2, 1)`, [Database.taskId({ tool_id: tool, id: cycle }, 2, 'scoping', 1), tool, cycle]);
  await new Database(engine).failOpenTasks(cycle, caps({ overlap: 3, scoping: 7 }), 'incident');
  const costs = (await pool.query(`SELECT role, iteration, status, cost_usd::text AS c FROM tasks WHERE cycle_id = $1 ORDER BY role, iteration`, [cycle])).rows;
  assert.deepEqual(costs, [
    { role: 'overlap', iteration: 1, status: 'failed', c: '3.0000' },
    { role: 'scoping', iteration: 1, status: 'failed', c: '14.0000' },
    { role: 'scoping', iteration: 2, status: 'failed', c: '0.0000' },
  ]);
});

test('measure: the engine reads the view, does not write it; it undoes and replays with the migrations', async () => {
  assert.equal((await engine.query('SELECT count(*)::int AS n FROM cycle_measures')).rows.length, 1);
  const grants = await pool.query(`SELECT has_table_privilege('orch_engine', 'cycle_measures', 'INSERT') AS i, has_table_privilege('orch_engine', 'cycle_measures', 'UPDATE') AS u,
    has_table_privilege('orch_engine', 'cycle_measures', 'DELETE') AS d, has_table_privilege('orch_engine', 'cycle_measures', 'TRUNCATE') AS t`);
  assert.deepEqual(grants.rows[0], { i: false, u: false, d: false, t: false });
  await createDatabase(postgres, 'measure_round_trip');
  const url = urlBase(postgres.ownerUrl, 'measure_round_trip');
  const other = new pg.Pool({ connectionString: urlBase(postgres.urlAdmin, 'measure_round_trip') });
  const seen = async () => (await other.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.views WHERE table_name = 'cycle_measures'`)).rows[0]!.n;
  try {
    await migrateTo(url, 'up');
    assert.equal(await seen(), 1);
    // 0015 (machine, S5), 0014 (sessions), 0013 (target role), 0012 (machine), 0011 (builder role) and 0010 (actor merge)
    // follow 0009: undo the last seven to remove the view.
    await migrateTo(url, 'down', undefined, 7);
    assert.equal(await seen(), 0, 'Down of 0009: view removed');
    assert.equal((await other.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'tasks'`)).rows[0]!.n, 1, 'only 0014 to 0009 undone');
    await migrateTo(url, 'up');
    assert.equal(await seen(), 1);
  } finally {
    await other.end();
  }
});

test('0010: actor merge — append-only, transitive, no self-merge, cycle, machine nor own identity; the audit is not rewritten, the reads and the database four eyes reason on the canonical actor', async () => {
  const base = new Database(engine);
  // Carole logged in three times with three subjects (connector recreated twice) before any linking: three actors.
  const a = await base.resolveActor(principal('carole', 'carole@example.test', 'Carole'));
  const b = await base.resolveActor(principal('carole-sub-2', 'carole@example.test', 'Carole'));
  const c = await base.resolveActor(principal('carole-sub-3', 'carole@example.test', 'Carole'));
  const canonical = async (id: string) => (await pool.query<{ id: string }>('SELECT canonical_actor($1) AS id', [id])).rows[0]!.id;
  assert.equal(await canonical(b), b, 'without a merge, an actor is its own canonical actor');
  const merge = (absorbed: string, target: string, decidedBy = ADMIN.id) =>
    engine.query(`INSERT INTO actor_merges (absorbed_actor, target_actor, reason, decided_by) VALUES ($1, $2, 'sub changed after the AD connector was recreated, ticket 43', $3)`, [absorbed, target, decidedBy]);
  // Refused by the database: self-merge, machine actor, the admin linking their own identity (absorbed or target), empty reason.
  await assert.rejects(merge(b, b), /self-merge/);
  await assert.rejects(merge(b, ORCHESTRATOR_ACTOR), /human actors/);
  await assert.rejects(merge(FORGE_ACTOR, a), /human actors/);
  await assert.rejects(merge(b, a, b), /own identity/);
  await assert.rejects(merge(b, a, a), /own identity/);
  await assert.rejects(engine.query(`INSERT INTO actor_merges (absorbed_actor, target_actor, reason, decided_by) VALUES ($1, $2, '  ', $3)`, [b, a, ADMIN.id]), /check/i);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM actor_merges')).rows[0]!.n, 0);
  // A tool requested as B before the merge, and its history row signed B: they will not move.
  const tool = (await pool.query<{ id: number }>(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ('B tool', 'b-tool', $1, 's') RETURNING id`, [b])).rows[0]!.id;
  const cycle = (await pool.query<{ id: number }>(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES ($1, 'creation', 10, 20, $2) RETURNING id`, [tool, b])).rows[0]!.id;
  // Merge B → A by the admin (engine account: the admin API is what writes), then A → C: the chain is followed, nothing is rewritten.
  await merge(b, a);
  assert.equal(await canonical(b), a);
  await merge(a, c);
  assert.deepEqual([await canonical(b), await canonical(a), await canonical(c)], [c, c, c], 'transitive: B → A → C');
  // Cycle: C (canonical of all) goes back down neither onto B nor onto A; B, already absorbed, is not absorbed a second time.
  await assert.rejects(merge(c, b), /cycle/);
  await assert.rejects(merge(c, a), /cycle/);
  await assert.rejects(merge(b, c), /actor_merges_pkey/);
  // Append only: no UPDATE, no DELETE, no TRUNCATE, even by the owner.
  await assert.rejects(pool.query('UPDATE actor_merges SET target_actor = $1 WHERE absorbed_actor = $2', [b, a]), /append-only/);
  await assert.rejects(pool.query('DELETE FROM actor_merges WHERE absorbed_actor = $1', [b]), /append-only/);
  await assert.rejects(pool.query('TRUNCATE actor_merges'), /append-only/);
  // The tables keep the identifier written at the time of the facts; the engine's reads resolve to the canonical one.
  assert.deepEqual((await pool.query('SELECT requester_id FROM tools WHERE id = $1', [tool])).rows, [{ requester_id: b }]);
  assert.deepEqual((await pool.query('SELECT actor_id FROM tool_history WHERE cycle_id = $1', [cycle])).rows, [{ actor_id: b }]);
  assert.equal((await base.readCycle(cycle)).requester_id, c);
  assert.equal(await base.resolveActor(principal('carole-sub-2', 'carole@example.test', 'Carole')), c, 'the subject of B now acts as C');
  assert.equal(await base.actorByIdentity(TEST_ISSUER, 'carole'), c);
  await engine.query(`UPDATE actors SET mail = 'carole.c@example.test' WHERE id = $1`, [c]);
  assert.equal(await base.actorMail(b), 'carole.c@example.test', 'the requester mail is the canonical actor one');
  // The database's four eyes on the canonical actor: C and A (= B, requester of the tool) do not approve Gate 2 of B's tool.
  const emp = 'sha256:' + 'e'.repeat(64);
  await forceState(cycle, 'gate_2');
  await pool.query(`INSERT INTO deployments (tool_id, cycle_id, environment, digest, health, visit, operation) VALUES ($1, $2, 'preview', $3, 'ok', $4, $5)`, [tool, cycle, emp, await visit(cycle), `op-${cycle}-merge`]);
  const approve = (actor: string) =>
    pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', $4, 'admin')`, [tool, cycle, emp, actor]);
  await assert.rejects(approve(c), /four eyes/);
  await assert.rejects(approve(a), /four eyes/);
  await approve(ADMIN.id);
});
