// The engine for real: DBOS + throwaway PostgreSQL + fakes. Full run of a creation up to
// end_success, then of an evolution; configuration refused at startup (E10).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { readConfig } from '../src/config.ts';
import { createDatabase, startPostgres, migrate, urlBase, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { startBench, ENV_TEST, Pilot, ADMIN, hats, type Bench } from './helpers/bench.ts';
import type { Message } from '../src/messages.ts';

let postgres: ThrowawayPostgres;
let bench: Bench;
let pilot: Pilot;

before(async () => {
  postgres = await startPostgres();
  bench = await startBench(postgres.engineUrl);
  pilot = new Pilot(bench);
}, { timeout: 180_000 });

after(async () => {
  await bench?.orch.stop();
  postgres?.remove();
});

test('E10: the required configuration is checked, the missing variable named', () => {
  assert.throws(() => readConfig({ ...ENV_TEST, ORCH_DATABASE_URL: 'postgres://x' , ADMIN_ESCALATION_ADDRESS: undefined }), /ADMIN_ESCALATION_ADDRESS missing/);
  assert.throws(() => readConfig({}), /ORCH_DATABASE_URL missing/);
  const c = readConfig({ ...ENV_TEST, ORCH_DATABASE_URL: 'postgres://x' });
  assert.equal(c.timeouts.reminder_ms, 400);
  assert.equal(c.agentConcurrency, 1);
});

test('a creation goes from request_received to end_success along the real path, one task per role and per iteration', { timeout: 120_000 }, async () => {
  const cycle = await pilot.createCycle('inventory');
  await pilot.driveUntil(cycle, 'end_success', { timeoutMs: 90_000 });
  assert.equal(await pilot.waitForWorkflowEnd(cycle), 'SUCCESS');
  const h = await pilot.history(cycle);
  assert.deepEqual(h.map((x) => `${x.previous_state ?? '∅'} --[${x.trigger}]--> ${x.state}`).filter((x) => !x.includes('check:budget')), [
    '∅ --[cycle_created]--> request_received',
    'request_received --[guard:creation]--> overlap_search',
    'overlap_search --[guard:not_plausible]--> repo_creation',
    'repo_creation --[task:done]--> scoping',
    'scoping --[task:done]--> mockup_deployment',
    'mockup_deployment --[task:done]--> waiting_scoping_feedback',
    'waiting_scoping_feedback --[event:scoping_feedback:satisfied]--> contract',
    'contract --[task:done]--> hardening_execution',
    'hardening_execution --[task:done]--> hardening_integration',
    'hardening_integration --[task:done]--> hardening_review',
    'hardening_review --[task:done]--> hardening_evaluation',
    'hardening_evaluation --[guard:compliant]--> merge',
    'merge --[task:done]--> waiting_ci',
    'waiting_ci --[event:ci_finished:green]--> candidate_image',
    'candidate_image --[guard:gate1_required]--> gate_1',
    'gate_1 --[gate:approved]--> preview_deployment',
    'preview_deployment --[task:done]--> preview_pipeline',
    'preview_pipeline --[event:preview_pipeline_finished:green]--> waiting_preview_feedback',
    'waiting_preview_feedback --[event:preview_feedback:satisfied]--> gate_2',
    'gate_2 --[gate:approved]--> prod_deployment',
    'prod_deployment --[task:done]--> end_success',
  ]);
  const tasks = await pilot.base.cycleTasks(cycle);
  assert.deepEqual(tasks.map((t) => `${t.iteration}-${t.role}:${t.status}`).sort(), ['1-builder:done', '1-contract:done', '1-overlap:done', '1-quality-reviewer:done', '1-scoping:done', '1-security-reviewer:done', '1-tests:done']);
  for (const t of tasks) assert.equal(bench.engine.calls(t.id).length, 1, `${t.id} called only once`);
  // Measurement (migrations/0009), read as orch_engine: fake at $0.5 and 60 s per task, no tokens reported (hence NULL).
  const measure = await pilot.base.pool.query(`SELECT total_cost_usd::text, input_tokens, work_duration_min::text, tasks, failed_tasks, hardening_rounds,
    first_ci_pass_green, gate_decisions, finished_at IS NOT NULL AS finished FROM cycle_measures WHERE cycle_id = $1`, [cycle]);
  assert.deepEqual(measure.rows[0], { total_cost_usd: '3.5000', input_tokens: null, work_duration_min: '7.00', tasks: 7, failed_tasks: 0, hardening_rounds: 1,
    first_ci_pass_green: true, gate_decisions: 2, finished: true });
  assert.equal(bench.deployer.running('prod', 'inventory'), pilot.digests.get(cycle));
  assert.equal(bench.deployer.running('mockup', 'inventory'), null, 'mock-up removed');
  assert.ok(bench.notifications.for(cycle, 'requester').some((n) => n.content.includes('End of cycle')));
  const budget = h.filter((x) => x.trigger.startsWith('check:budget')).map((x) => `${x.state} ${x.trigger.split(':')[2]}`);
  assert.deepEqual(budget, ['scoping scoping', 'contract hardening', 'hardening_execution hardening', 'hardening_evaluation hardening']);

  // Evolution: skips overlap, repository and Gate 1; the tool in production keeps running.
  const tool = (await pilot.base.readCycle(cycle)).tool_id;
  const evolution = await pilot.createCycle('inventory', 'evolution', tool);
  await pilot.driveUntil(evolution, 'end_success', { timeoutMs: 90_000 });
  assert.equal(await pilot.waitForWorkflowEnd(evolution), 'SUCCESS');
  const h2 = (await pilot.history(evolution)).map((x) => x.state);
  assert.ok(!h2.includes('overlap_search') && !h2.includes('gate_1'));
  assert.equal(await pilot.state(evolution), 'end_success');
});

test('Gate 1 correction with a new name and address: tools row renamed with the approval, forge asked once, the builder told; refused with another outcome, without a change or on a taken slug', { timeout: 120_000 }, async () => {
  const cycle = await pilot.createCycle('equipment-managment');
  await pilot.driveUntil(cycle, 'gate_1', { timeoutMs: 90_000 });
  const send = (m: Message) => bench.orch.send(cycle, m, hats(m));
  const decision = { type: 'decision' as const, gate: 'gate_1' as const, actor_id: ADMIN.id };
  // Refused on entry: nothing written, the cycle still waits at Gate 1.
  await assert.rejects(send({ ...decision, outcome: 'approved', comment: 'Equipment loans', slug: 'equipment-management' }), /only with a "correction" at gate_1/);
  await assert.rejects(send({ ...decision, outcome: 'scope_change', comment: 'More', name: 'Equipment Management' }), /only with a "correction" at gate_1/);
  await assert.rejects(send({ ...decision, outcome: 'correction', comment: 'Typo', name: 'Equipment-managment', slug: 'equipment-managment' }), /already named "Equipment-managment" with slug equipment-managment/);
  await assert.rejects(send({ ...decision, outcome: 'correction', comment: 'Typo', slug: 'inventory' }), /slug inventory is already used by another tool/);
  await assert.rejects(send({ ...decision, outcome: 'correction', comment: 'Typo', slug: 'Equipment Management' }), /^Error: message decision refused: slug:/);
  assert.equal(await pilot.state(cycle), 'gate_1');
  assert.equal((await bench.orch.base.pool.query('SELECT 1 FROM approvals WHERE cycle_id = $1', [cycle])).rowCount, 0);
  assert.deepEqual(bench.forge.renames, []);
  // The real case of the lab: a typo in the name and the slug, fixed at Gate 1.
  const logBefore = bench.engine.switchboard.log.length;
  await send({ ...decision, outcome: 'correction', comment: 'Typo in the name', name: 'Equipment Management', slug: 'equipment-management' });
  await pilot.waitForState(cycle, 'hardening_execution');
  const c = await pilot.base.readCycle(cycle);
  assert.deepEqual([c.name, c.slug], ['Equipment Management', 'equipment-management']);
  assert.deepEqual(bench.forge.renames, [{ from: 'equipment-managment', to: 'equipment-management' }]);
  const approval = await bench.orch.base.pool.query<{ decision: string; comment: string }>(`SELECT decision, comment FROM approvals WHERE cycle_id = $1 AND gate = 'gate_1'`, [cycle]);
  assert.deepEqual(approval.rows, [{ decision: 'correction', comment: 'Typo in the name' }]);
  // The next code task of the cycle works under the new slug and reads the rename after the admin's comment.
  const task = await pilot.wait('code task of the renamed tool', async () => bench.engine.switchboard.log.slice(logBefore).find((j) => j.input.task_id.startsWith(`${c.tool_id}-${c.id}-`))?.input);
  assert.equal(task.tool, 'equipment-management');
  assert.equal(task.branch, `agent/equipment-management/${c.id}/${task.role}`);
  assert.equal(task.context['instruction'], 'Typo in the name\nThe tool was renamed: it is now "Equipment Management", at equipment-management.example.test. Update every name visible in the application (titles, texts, metadata) accordingly.');
});

test('step 6: the engine runs as orch_engine; without the DBOS schema installed, it refuses to start and creates nothing', { timeout: 60_000 }, async () => {
  assert.equal((await bench.orch.base.pool.query('SELECT current_user AS u')).rows[0]!.u, 'orch_engine');
  // Database migrated (node-pg-migrate) but DBOS schema never installed (no DBOS.migrate).
  await createDatabase(postgres, 'no_dbos');
  await migrate(urlBase(postgres.ownerUrl, 'no_dbos'), 'up');
  const r = spawnSync(process.execPath, ['src/main.ts'], { env: { ...process.env, ...ENV_TEST, EUPADEV_EXTERNAL: 'fake-auto', ORCH_DATABASE_URL: urlBase(postgres.engineUrl, 'no_dbos') }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /schema version 0, but this version of DBOS requires \d+\. This process is configured with runMigrations disabled/);
  const admin = new pg.Client({ connectionString: urlBase(postgres.urlAdmin, 'no_dbos') });
  await admin.connect();
  try {
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'dbos'`)).rows[0]!.n, 0);
  } finally {
    await admin.end();
  }
});
