// Recovery after a fault, DBOS's reason for being (ROADMAP §8.3, §8.9 step 2): a cycle is started in a
// child process, killed (SIGKILL) three times — in the middle of an agent task (tests, the builder started only after), in
// the middle of an external operation (Preview deployment child workflow), in the middle of the durable wait of Gate 2; each
// restart resumes where the cycle was, with no duplicated task, operation or transition, and the cycle ends in end_success.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { startPostgres, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ENV_TEST } from './helpers/bench.ts';

let postgres: ThrowawayPostgres;
let pool: pg.Pool;
const log = join(process.env['TMPDIR'] ?? '/tmp', `resume-${process.pid}.log`);
const children: ChildProcess[] = [];

before(async () => {
  postgres = await startPostgres();
  pool = new pg.Pool({ connectionString: postgres.urlAdmin });
  writeFileSync(log, '');
}, { timeout: 180_000 });

after(async () => {
  for (const e of children) if (e.exitCode === null) e.kill('SIGKILL');
  await pool?.end();
  postgres?.remove();
});

interface Child { childProcess: ChildProcess; output: string[]; wait(reason: RegExp, timeoutMs?: number): Promise<string> }

function launch(env: Record<string, string>): Child {
  const childProcess = spawn(process.execPath, ['tests/resume/child.ts'], {
    env: { ...process.env, ...ENV_TEST, ORCH_DATABASE_URL: postgres.engineUrl, LOG: log, DBOS__VMID: 'resume-test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(childProcess);
  const output: string[] = [];
  childProcess.stdout!.on('data', (d: Buffer) => output.push(...d.toString().split('\n').filter((l) => l !== '')));
  childProcess.stderr!.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) if (/error|Error/.test(l) && !/Deprecation/.test(l)) output.push(`ERR ${l}`); });
  return {
    childProcess,
    output: output,
    async wait(reason, timeoutMs = 60_000) {
      const limit = Date.now() + timeoutMs;
      for (;;) {
        const l = output.find((x) => reason.test(x));
        if (l !== undefined) return l;
        if (childProcess.exitCode !== null) throw new Error(`child finished (${childProcess.exitCode}): ${output.join(' | ')}`);
        if (Date.now() > limit) throw new Error(`timeout waiting for ${reason}; output: ${output.join(' | ')}`);
        await sleep(50);
      }
    },
  };
}

const state = async (cycle: number) => (await pool.query<{ state: string }>('SELECT state FROM cycles WHERE id = $1', [cycle])).rows[0]!.state;
async function waitForDatabase(description: string, condition: () => Promise<boolean>, timeoutMs = 60_000) {
  const limit = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error(`timeout: ${description}`);
    await sleep(50);
  }
}

const logLines = () => readFileSync(log, 'utf8').trim().split('\n');
async function kill(e: Child, name: string) {
  e.childProcess.kill('SIGKILL');
  await waitForDatabase(`${name} process dead`, async () => e.childProcess.exitCode !== null || e.childProcess.signalCode !== null, 10_000);
}

test('the cycle resumes after three abrupt stops (during the tests task before the builder, during an external operation, during a gate) without duplicating anything', { timeout: 400_000 }, async () => {
  // 1. First process: heads for Gate 2, the tests role (first of the round, ADR-021) takes 3 s to answer → we kill it during
  //    this task; the builder is not created yet (A-R2a: explicit wait for the end of tests).
  const first = launch({ MODE: 'create', TARGET: 'gate_2', TESTS_SLOWNESS_MS: '3000' });
  const cycle = Number((await first.wait(/^CYCLE /)).split(' ')[1]);
  await waitForDatabase('tests task in progress, builder not created yet', async () => {
    const r = await pool.query<{ role: string; status: string }>(`SELECT role, status FROM tasks WHERE cycle_id = $1 AND role IN ('tests', 'builder') ORDER BY role`, [cycle]);
    return r.rows.map((x) => `${x.role}:${x.status}`).join(',') === 'tests:in_progress';
  });
  await waitForDatabase('engine called for tests', async () => logLines().some((a) => a.endsWith(`-${cycle}-1-tests`)));
  await kill(first, 'first');
  assert.equal(await state(cycle), 'hardening_execution');
  assert.equal(logLines().filter((a) => a.endsWith(`-${cycle}-1-tests`)).length, 1, 'tests called once before the cut');

  // 2. Second process: DBOS resumes W1 and the cut-off task, then W1 starts the builder; the Preview deployment (child
  //    workflow) takes 3 s → we kill during this external operation.
  const second = launch({ MODE: 'resume', CYCLE: String(cycle), TARGET: 'gate_2', PREVIEW_SLOWNESS_MS: '3000' });
  await waitForDatabase('Preview deployment in progress', async () => (await state(cycle)) === 'preview_deployment' && logLines().includes('deployment:preview'), 120_000);
  const op = await pool.query<{ status: string }>(`SELECT status FROM dbos.workflow_status WHERE workflow_uuid LIKE $1`, [`op-${cycle}-deployment-%`]);
  assert.ok(op.rows.some((x) => x.status === 'PENDING'), 'Preview operation in progress at the time of the cut');
  await kill(second, 'second');
  assert.equal(await state(cycle), 'preview_deployment');

  // 3. Third process: the external operation resumes, we drive up to Gate 2 then kill in the middle of the durable wait.
  const third = launch({ MODE: 'resume', CYCLE: String(cycle), TARGET: 'gate_2' });
  await third.wait(/^ARRIVE gate_2/, 120_000);
  await sleep(1500); // the workflow is in its durable recv
  assert.equal(await state(cycle), 'gate_2');
  await kill(third, 'third');

  // 4. Fourth process: resume of the wait at Gate 2, decision, Prod, end.
  const fourth = launch({ MODE: 'resume', CYCLE: String(cycle), TARGET: 'end_success' });
  const end = await fourth.wait(/^WORKFLOW /, 120_000);
  assert.equal(end, 'WORKFLOW SUCCESS');
  await waitForDatabase('fourth process finished', async () => fourth.childProcess.exitCode !== null, 20_000);
  assert.equal(fourth.childProcess.exitCode, 0, fourth.output.join(' | '));
  assert.deepEqual(fourth.output.filter((l) => l.startsWith('ERR')), []);

  // Checks: final state, no duplicated transition, one task per role and per iteration, each task run once except the
  // cut-off one (at most twice).
  assert.equal(await state(cycle), 'end_success');
  const h = (await pool.query<{ previous_state: string | null; state: string; trigger: string }>(`SELECT previous_state, state, trigger FROM tool_history WHERE cycle_id = $1 AND trigger NOT LIKE 'check:%' ORDER BY id`, [cycle])).rows;
  // The admin's reminders at Gate 2 (24 h = 400 ms here) are expected during the stop; capped at 3 even after the resume,
  // never replayed.
  const reminders = h.filter((x) => x.trigger === 'timeout_exceeded');
  assert.ok(reminders.length <= 3 && reminders.every((x) => x.state === 'gate_2' && x.previous_state === 'gate_2'), `reminders: ${reminders.length}`);
  const transitions = h.filter((x) => x.trigger !== 'timeout_exceeded').map((x) => `${x.previous_state ?? '∅'} --[${x.trigger}]--> ${x.state}`);
  assert.deepEqual(transitions, [
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
  const tasks = (await pool.query<{ id: string; role: string; iteration: number; status: string }>('SELECT id, role, iteration, status FROM tasks WHERE cycle_id = $1 ORDER BY id', [cycle])).rows;
  assert.deepEqual(tasks.map((t) => `${t.iteration}-${t.role}:${t.status}`).sort(), ['1-builder:done', '1-contract:done', '1-overlap:done', '1-quality-reviewer:done', '1-scoping:done', '1-security-reviewer:done', '1-tests:done']);
  const calls = logLines();
  for (const t of tasks) {
    const n = calls.filter((a) => a === t.id).length;
    // The cut-off task is restarted exactly once by the resume (container restarted); the others, never doubled.
    assert.equal(n, t.role === 'tests' ? 2 : 1, `${t.id} run ${n} times`);
  }
  // B7: the cut-off task cost two runs: the first, lost, at the cap ($10), plus the second ($0.50).
  const cut = tasks.find((t) => t.role === 'tests')!;
  assert.deepEqual((await pool.query<{ c: number; n: number }>('SELECT cost_usd::float8 AS c, executions AS n FROM tasks WHERE id = $1', [cut.id])).rows[0], { c: 10.5, n: 2 });
  // The cut-off operation is replayed exactly once, and writes a single Preview deployment.
  assert.equal(calls.filter((a) => a === 'deployment:preview').length, 2, 'Preview: one call cut + one resume call');
  // D3: no other side effect doubled on replay (persistent log of the fakes).
  assert.deepEqual(['deployment:mockup', 'deployment:prod', 'forge:repo:', 'forge:integration:1', 'forge:merge:1'].map((x) => `${x}×${calls.filter((a) => a === x).length}`),
    ['deployment:mockup×1', 'deployment:prod×1', 'forge:repo:×1', 'forge:integration:1×1', 'forge:merge:1×1']);
  const notifications = calls.filter((a) => a.startsWith('notification:'));
  const duplicates = notifications.filter((n, i) => notifications.indexOf(n) !== i);
  assert.deepEqual(duplicates, [], 'no notification sent twice');
  assert.ok(notifications.some((n) => n.startsWith('notification:admin:Decision required: gate_2')) && notifications.some((n) => n.startsWith('notification:requester:Inventory: End of cycle')), notifications.join('\n'));
  const chat = (await pool.query<{ content: string }>('SELECT content FROM messages WHERE cycle_id = $1', [cycle])).rows.map((x) => x.content);
  assert.deepEqual(chat.filter((m, i) => chat.indexOf(m) !== i), [], 'no chat message written twice');
  const previews = await pool.query(`SELECT 1 FROM deployments WHERE cycle_id = $1 AND environment = 'preview'`, [cycle]);
  assert.equal(previews.rowCount, 1, 'a single Preview deployment recorded');
  // A single W1 workflow for this cycle, finished.
  const wf = await pool.query<{ status: string }>(`SELECT status FROM dbos.workflow_status WHERE workflow_uuid = $1`, [`cycle-${cycle}`]);
  assert.deepEqual(wf.rows, [{ status: 'SUCCESS' }]);
  const gate2 = await pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = 'gate_2'`, [cycle]);
  assert.equal(gate2.rowCount, 1, 'a single approval at Gate 2');
});
