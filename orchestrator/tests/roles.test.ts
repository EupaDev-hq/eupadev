// Pilot and executor in separate processes: the pilot
// (orchestrator VM) runs the cycles, the executor (agents VM) only the agent tasks, on the same database. Real
// processes (tests/roles/child.ts), real DBOS, throwaway PostgreSQL, a fresh database per test, automatic fake world.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { migratedDatabase, startPostgres, unprotected, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ENV_TEST } from './helpers/bench.ts';

const PILOT = 'pilot-test';
const EXECUTOR = 'agent-executor';
let postgres: ThrowawayPostgres;
let number = 0;
const children: ChildProcess[] = [];

before(async () => { postgres = await startPostgres({ migrations: false }); }, { timeout: 180_000 });
after(() => {
  for (const e of children) if (e.exitCode === null && e.signalCode === null) e.kill('SIGKILL');
  postgres?.remove();
});

interface Bench { url: string; log: string; pool: pg.Pool }
async function bench(): Promise<Bench> {
  const name = `roles_${++number}`;
  const log = join(process.env['TMPDIR'] ?? '/tmp', `roles-${process.pid}-${number}.log`);
  writeFileSync(log, '');
  const url = await migratedDatabase(postgres, name);
  return { url, log, pool: new pg.Pool({ connectionString: url }) };
}

interface Child { childProcess: ChildProcess; output: string[]; wait(reason: RegExp, timeoutMs?: number): Promise<string> }
function launch(b: Bench, env: Record<string, string>): Child {
  const childProcess = spawn(process.execPath, ['tests/roles/child.ts'], {
    env: { ...process.env, ...ENV_TEST, ORCH_DATABASE_URL: b.url, LOG: b.log, ...env },
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
        // Standard output read after the end of the process: one last look before concluding.
        if (childProcess.exitCode !== null) {
          await sleep(300);
          const last = output.find((x) => reason.test(x));
          if (last !== undefined) return last;
          throw new Error(`child finished (${childProcess.exitCode}): ${output.join(' | ')}`);
        }
        if (Date.now() > limit) throw new Error(`timeout waiting for ${reason}; output: ${output.join(' | ')}`);
        await sleep(50);
      }
    },
  };
}
const executor = (b: Bench, env: Record<string, string> = {}) => launch(b, { EUPADEV_ROLE: 'executor', ...env });
const pilot = (b: Bench, env: Record<string, string> = {}) => launch(b, { EUPADEV_ROLE: 'pilot', DBOS__VMID: PILOT, ...env });
async function kill(e: Child): Promise<void> {
  e.childProcess.kill('SIGKILL');
  while (e.childProcess.exitCode === null && e.childProcess.signalCode === null) await sleep(20);
}
async function stopAll(b: Bench): Promise<void> {
  for (const e of children) if (e.exitCode === null && e.signalCode === null) e.kill('SIGKILL');
  await b.pool.end();
}
async function waitForDatabase(b: Bench, description: string, condition: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error(`timeout: ${description}`);
    await sleep(50);
  }
}
const state = async (b: Bench, cycle: number) => (await b.pool.query<{ state: string }>('SELECT state FROM cycles WHERE id = $1', [cycle])).rows[0]!.state;
/** Cycle in end_success and its W1 finished (it finishes right after the last transition). */
const endSuccess = (b: Bench, cycle: number) => waitForDatabase(b, `cycle ${cycle} in end_success, W1 finished`, async () => (await state(b, cycle)) === 'end_success' && (await statusW1(b, cycle)).status === 'SUCCESS');
const statusW1 = async (b: Bench, cycle: number) => (await b.pool.query<{ status: string; executor_id: string }>('SELECT status, executor_id FROM dbos.workflow_status WHERE workflow_uuid = $1', [`cycle-${cycle}`])).rows[0]!;
const log = (b: Bench) => readFileSync(b.log, 'utf8').trim().split('\n').filter((l) => l !== '');
const cycleOf = async (e: Child) => Number((await e.wait(/^CYCLE /)).split(' ')[1]);
/** What DBOS does at pilot startup for its pending workflows (`reenqueueWorkflowsForRecovery`, DBOS 5.2.11). */
const dbosRecovery = (b: Bench, queue: string) => unprotected(b.url, `UPDATE dbos.workflow_status SET status = 'ENQUEUED', started_at_epoch_ms = NULL, owner_xid = NULL, queue_name = ${queue} WHERE workflow_uuid LIKE 'cycle-%' AND status = 'PENDING' AND executor_id = $1`, [PILOT]);

test('separate: agent tasks at the executor only, the pilot\'s workflows at the pilot only; the cycle goes to the end', { timeout: 180_000 }, async () => {
  const b = await bench();
  try {
    await executor(b).wait(/^READY$/);
    const p = pilot(b, { CREATE: 'separate' });
    const cycle = await cycleOf(p);
    await endSuccess(b, cycle);
    const lines = (await b.pool.query<{ name: string; executor_id: string; queue_name: string | null }>("SELECT name, executor_id, queue_name FROM dbos.workflow_status WHERE status = 'SUCCESS'")).rows;
    const tasks = lines.filter((l) => l.queue_name === 'agent-tasks');
    assert.ok(tasks.length > 0 && tasks.every((l) => l.name === 'agentTask' && l.executor_id === EXECUTOR), JSON.stringify(tasks));
    const others = lines.filter((l) => l.queue_name !== 'agent-tasks');
    assert.ok(others.some((l) => l.name === 'toolCycle') && others.every((l) => l.executor_id === PILOT && l.queue_name === 'control'), JSON.stringify(others));
    assert.ok(log(b).length > 0 && log(b).every((l) => l.startsWith('executor ')), 'the agent engine is called by the executor only');
  } finally {
    await stopAll(b);
  }
});

test('executor killed during a task: the pilot does not take it over; the restarted executor resumes it and the cycle goes to the end', { timeout: 180_000 }, async () => {
  const b = await bench();
  try {
    const e1 = executor(b, { ENGINE_SLOWNESS_MS: '4000', TASK_TIMEOUT_MS: '60000' });
    await e1.wait(/^READY$/);
    const cycle = await cycleOf(pilot(b, { CREATE: 'executor-killed' }));
    await waitForDatabase(b, 'a task in progress at the executor', async () => log(b).length > 0);
    const cut = log(b)[0]!.split(' ')[1]!;
    await kill(e1);
    await sleep(1500);
    const s = (await b.pool.query<{ status: string; executor_id: string }>('SELECT status, executor_id FROM dbos.workflow_status WHERE workflow_uuid = $1', [`task-${cut}`])).rows[0]!;
    assert.deepEqual(s, { status: 'PENDING', executor_id: EXECUTOR }, 'the cut task waits for its executor, the pilot did not take it');
    await executor(b).wait(/^READY$/);
    await endSuccess(b, cycle);
    assert.ok(log(b).filter((l) => l === `executor ${cut}`).length >= 2, 'the cut task is run again by the executor');
  } finally {
    await stopAll(b);
  }
});

test('pilot killed (W1 at a gate), then resumed by DBOS: the executor never takes the W1 (control queue); the restarted pilot resumes it', { timeout: 180_000 }, async () => {
  const b = await bench();
  try {
    await executor(b).wait(/^READY$/);
    const p1 = pilot(b, { CREATE: 'pilot-killed', STOP_AT: 'gate_1' });
    const cycle = await cycleOf(p1);
    await p1.wait(/^ARRIVE \d+ gate_1$/, 90_000);
    await kill(p1);
    await dbosRecovery(b, "COALESCE(queue_name, '_dbos_internal_queue')");
    await sleep(3000); // the executor polls every 50 ms
    assert.deepEqual(await statusW1(b, cycle), { status: 'ENQUEUED', executor_id: PILOT }, 'the W1 waits for the pilot');
    pilot(b);
    await endSuccess(b, cycle);
    assert.equal((await statusW1(b, cycle)).executor_id, PILOT);
  } finally {
    await stopAll(b);
  }
});

test('W1 launched before the control queue (resumed in DBOS\'s internal queue): taken by the executor, it fails doing nothing; the pilot resumes it through the incident gate', { timeout: 180_000 }, async () => {
  const b = await bench();
  try {
    await executor(b).wait(/^READY$/);
    const p1 = pilot(b, { CREATE: 'old-w1', STOP_AT: 'gate_1' });
    const cycle = await cycleOf(p1);
    await p1.wait(/^ARRIVE \d+ gate_1$/, 90_000);
    await kill(p1);
    await dbosRecovery(b, "'_dbos_internal_queue'");
    await waitForDatabase(b, 'W1 in error at the executor', async () => (await statusW1(b, cycle)).status === 'ERROR', 30_000);
    // DBOS 5 keeps the error message out of workflow_status; the executor took it (executor_id) and refused it (ERROR).
    assert.equal((await statusW1(b, cycle)).executor_id, EXECUTOR);
    assert.equal(await state(b, cycle), 'gate_1', 'nothing done');
    pilot(b);
    await endSuccess(b, cycle);
    const h = (await b.pool.query<{ state: string }>('SELECT state FROM tool_history WHERE cycle_id = $1', [cycle])).rows.map((r) => r.state);
    assert.ok(h.includes('gate_incident'), 'resumed through the incident gate');
    assert.equal((await statusW1(b, cycle)).executor_id, PILOT);
  } finally {
    await stopAll(b);
  }
});

test('lock per role: a second executor, or an all-in-one, refuses to start while an executor runs; a pilot starts', { timeout: 120_000 }, async () => {
  const b = await bench();
  try {
    await executor(b).wait(/^READY$/);
    assert.match(await executor(b).wait(/^REFUSED /), /another executor/);
    assert.match(await launch(b, {}).wait(/^REFUSED /), /another executor/);
    await pilot(b).wait(/^READY$/);
    assert.match(await pilot(b, { DBOS__VMID: 'pilot-2' }).wait(/^REFUSED /), /another EupaDev engine/);
  } finally {
    await stopAll(b);
  }
});
