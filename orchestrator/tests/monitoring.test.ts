// 3rd round: the monitoring and the recovery of dead workflows let no path die silently, wait forever
// or lead nowhere. A single engine at a time (D23); sweep on the real state (G1); cleanup limited to the cycle
// (G4); orphan environments removed; message received during an incident asked again (S5); "transmitted" only to
// a live workflow (M2, M3); one sweep at a time (M7); children seen and stopped (review: alpha, beta, gamma).
// Real DBOS engine, throwaway PostgreSQL, fresh database per test, scripted fakes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { FakeDeployer, FakeForge, launchFakeWatcher, FakeEngine, FakeNotifications } from '../src/external/fakes.ts';
import type { CiResult } from '../src/external/contracts.ts';
import type { StateId } from '../src/machine/states.ts';
import type { Message } from '../src/messages.ts';
import { ENGINE_LOCK_KEY, Orchestrator } from '../src/orchestrator.ts';
import { migratedDatabase, startPostgres, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ADMIN, REQUESTER, startBench, ENV_TEST, Pilot, happyResponse, type Bench , hats } from './helpers/bench.ts';

let postgres: ThrowawayPostgres;
let number = 0;
before(async () => { postgres = await startPostgres({ migrations: false }); }, { timeout: 180_000 });
after(() => postgres?.remove());

const freshDatabase = () => migratedDatabase(postgres, `monitoring_${++number}`);
async function withBench(body: (b: Bench, p: Pilot, url: string) => Promise<void>, url?: string, env: Record<string, string> = {}): Promise<void> {
  const u = url ?? (await freshDatabase());
  const bench = await startBench(u, env);
  try {
    await body(bench, new Pilot(bench), u);
  } finally {
    await bench.orch.stop();
  }
}
const history = async (p: Pilot, cycle: number) => (await p.history(cycle)).map((h) => `${h.previous_state ?? '∅'} --[${h.trigger}]--> ${h.state}`).filter((x) => !x.includes('check:'));
const approve = (gate: StateId): Message => ({ type: 'decision', gate, outcome: 'approved', actor_id: ADMIN.id });
const cycleEnds = (b: Bench, cycle: number) => b.notifications.for(cycle, 'requester').filter((n) => n.content.startsWith('End of cycle')).length;
/** No scheduled monitoring (1 January only): the test calls `sweep()` itself. */
const NO_SWEEP = { MONITORING_CRON: '0 0 0 1 1 *' };

async function cancelW1(p: Pilot, cycle: number): Promise<string> {
  const wf = await p.workflowW1(cycle);
  await DBOS.cancelWorkflow(wf);
  await p.wait('W1 cancelled', async () => ((await DBOS.getWorkflowStatus(wf))?.status === 'CANCELLED' ? true : undefined));
  return wf;
}

// ── D23: a single engine at a time ──────────────────────────────────────────────────────────────

test('D23: a 2nd engine on the same database refuses to start while the 1st holds the lock; it starts once the 1st is stopped', { timeout: 60_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  const external = () => ({ engine: new FakeEngine(), forge: new FakeForge(), deployer: new FakeDeployer('example.test'), notifications: new FakeNotifications() });
  await withBench(async (b, p) => {
    await assert.rejects(Orchestrator.start(external(), { ...ENV_TEST, ORCH_DATABASE_URL: url }), /startup refused: another EupaDev engine already runs on this database/);
    // The first engine is not affected.
    cycle = await p.createCycle('d23-unique');
    await p.driveUntil(cycle, 'gate_overlap');
    assert.equal(b.lockLosses.length, 0);
  }, url);
  await withBench(async (_b, p) => {
    p.cycles.set('d23-unique', cycle);
    await p.wait('the 2nd engine started and resumes the cycle', async () => ((await p.statusW1(cycle)) === 'PENDING' ? true : undefined));
  }, url);
});

test('D23: loss of the lock connection → the engine stops cleanly (the supervisor restarts it), then a new engine resumes', { timeout: 60_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  await withBench(async (b, p) => {
    cycle = await p.createCycle('d23-loss');
    await p.driveUntil(cycle, 'gate_overlap');
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const r = await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND classid::bigint = ($1::bigint >> 32) AND objid::bigint = ($1::bigint & 4294967295)`, [ENGINE_LOCK_KEY]);
    await admin.end();
    assert.equal(r.rowCount, 1, 'a connection held the lock');
    await p.wait('engine stop', async () => (b.lockLosses.length > 0 && !DBOS.isInitialized() ? true : undefined), 15_000);
    assert.match(b.lockLosses[0]!.message, /"single engine" lock lost/);
  }, url, NO_SWEEP); // the loss is seen by the connection itself, without waiting for a sweep
  await withBench(async (_b, p) => {
    p.cycles.set('d23-loss', cycle);
    await p.wait('a new engine resumes the cycle', async () => ((await p.statusW1(cycle)) === 'PENDING' ? true : undefined));
    assert.equal(await p.state(cycle), 'gate_overlap');
  }, url);
});

// ── G1: sweep on the real state ─────────────────────────────────────────────────────────────────

test('G1: a cycle that finishes during the sweep (healthy W1, SUCCESS) is neither resumed nor sent to the incident; no end replayed, no false alert', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    // A: dead workflow, handled slowly (its alert is held back); B: opened when the sweep takes its list.
    const A = await p.createCycle('g1-a');
    await p.driveUntil(A, 'gate_overlap');
    const B = await p.createCycle('g1-b');
    await p.driveUntil(B, 'gate_overlap');
    await cancelW1(p, A);
    let input!: () => void;
    const inA = new Promise<void>((r) => { input = r; });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const notify = b.notifications.notify.bind(b.notifications);
    b.notifications.notify = async (d, id, subject, content, key) => {
      if (id === A && subject.startsWith('Technical incident: workflow of cycle')) { input(); await held; }
      return notify(d, id, subject, content, key);
    };
    const sweep = b.orch.sweep();
    await inA; // the list of cycles is taken: B is in it, open
    await b.orch.send(B, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id }));
    assert.equal(await p.waitForWorkflowEnd(B), 'SUCCESS', 'B\'s W1 finished its end (notification, cleanup)');
    release();
    const done = await sweep;
    assert.ok(!done.some((f) => f.startsWith(`cycle ${B} `)), done.join(' | '));
    assert.equal(await p.statusW1(B), 'SUCCESS', 'B is not resumed');
    assert.equal(cycleEnds(b, B), 1, 'end notified only once');
    assert.ok(!b.notifications.for(B, 'admin').some((n) => /resumed|Technical incident/.test(n.subject)), 'no false alert');
  }, undefined, NO_SWEEP);
});

// ── G4: end cleanup limited to the cycle ────────────────────────────────────────────────────────

test('G4: the late cleanup of a finished cycle does not remove the mock-up of the next evolution', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const c1 = await p.createCycle('g4-late');
    await p.driveUntil(c1, 'gate_2', { timeoutMs: 60_000 });
    // The end of cycle 1 drags on (notification held back): its cleanup only comes after the mock-up deployment of
    // cycle 2 — held back until then by a promise, not by a duration (on a loaded machine, 5 s was not always enough).
    const notify = b.notifications.notify.bind(b.notifications);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    b.notifications.notify = async (d, id, subject, content, key) => {
      if (id === c1 && content.startsWith('End of cycle')) await held;
      return notify(d, id, subject, content, key);
    };
    await p.driveUntil(c1, 'end_success', { timeoutMs: 60_000 });
    const c2 = await p.createCycle('g4-late', 'evolution', (await b.orch.base.readCycle(c1)).tool_id);
    await p.driveUntil(c2, 'waiting_scoping_feedback', { timeoutMs: 60_000 });
    assert.notEqual(b.deployer.running('mockup', 'g4-late'), null);
    release();
    assert.equal(await p.waitForWorkflowEnd(c1, 20_000), 'SUCCESS');
    assert.equal(await p.state(c2), 'waiting_scoping_feedback');
    assert.notEqual(b.deployer.running('mockup', 'g4-late'), null, 'the mock-up of cycle 2 is still served');
    assert.equal(b.deployer.active.get('mockup:g4-late')!.cycle, c2);
  }, undefined, { ...NO_SWEEP, REMINDER_DELAY_MS: '60000', PAUSE_ARCHIVE_DELAY_MS: '120000' });
});

// ── Point 1 (2nd round): no environment served for a finished cycle or an archived tool ─────────

test('Monitoring: mock-up, Preview and Prod still served after the end of a creation (failed cleanup) are removed by the sweep, with an alert', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const deploy = b.deployer.deploy.bind(b.deployer);
    // Prod starts (container running) then the health check drags on: the admin cancels in between.
    b.deployer.deploy = async (env, slug, cy, emp, s) => {
      if (env !== 'prod') return deploy(env, slug, cy, emp, s);
      b.deployer.active.set(`prod:${slug}`, { digest: emp!, state: 'running', cycle: cy });
      return new Promise((_, reject) => s?.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    };
    const remove = b.deployer.remove.bind(b.deployer);
    b.deployer.remove = async () => { throw new Error('deployer API unavailable'); };
    const cycle = await p.createCycle('orphans');
    await p.driveUntil(cycle, 'prod_deployment');
    await p.wait('Prod running', async () => (b.deployer.running('prod', 'orphans') !== null ? true : undefined));
    await b.orch.send(cycle, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id }));
    assert.equal(await p.waitForWorkflowEnd(cycle), 'SUCCESS');
    assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject.startsWith('Incomplete cleanup')));
    for (const env of ['mockup', 'preview', 'prod'] as const) assert.notEqual(b.deployer.running(env, 'orphans'), null, `${env} still served`);
    b.deployer.remove = remove;
    const done = await b.orch.sweep();
    for (const env of ['mockup', 'preview', 'prod'] as const) {
      assert.equal(b.deployer.running(env, 'orphans'), null, `${env} removed`);
      assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject === `Alert: ${env} of orphans still served`), `alert ${env}`);
    }
    assert.equal(done.filter((f) => f.includes('of orphans')).length, 3, done.join(' | '));
    assert.deepEqual((await b.orch.sweep()).filter((f) => f.includes('orphans')), [], 'nothing to redo at the next sweep');
  }, undefined, NO_SWEEP);
});

// ── S5 / M2 / M3: message received during an incident, sending to a dead workflow ────────────────

test('S5: a message received during the incident is not kept: traced as ignored, asked again on resume, applied once sent again', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('s5-ci');
    await p.driveUntil(cycle, 'waiting_ci');
    const c = await b.orch.base.readCycle(cycle);
    await cancelW1(p, cycle);
    await b.orch.sweep();
    await p.waitForState(cycle, 'gate_incident');
    // The CI end of the original pass arrives during the incident gate (dropped in flight, before the resume).
    const digest = p.newDigest();
    const ci: Message = { type: 'ci_finished', outcome: 'green', digest: digest, checks: [{ check: 'lint', result: 'green' }] };
    await DBOS.send(await p.workflowW1(cycle), { ...ci, visit: c.visit } satisfies Message, 'mailbox');
    await p.wait('message traced as ignored', async () => ((await b.orch.base.cycleMessages(cycle)).some((m) => m.content.startsWith('Message ci_finished ignored in state gate_incident')) ? true : undefined));
    await p.sendWhenExpected(cycle, approve('gate_incident'));
    await p.waitForState(cycle, 'waiting_ci');
    const askedAgain = await p.wait('result asked again', async () => b.notifications.for(cycle, 'admin').find((n) => n.subject.startsWith('Result asked again: waiting_ci')));
    assert.match(askedAgain.content, /Run the CI again/);
    await sleep(800);
    assert.equal(await p.state(cycle), 'waiting_ci', 'the message received during the incident is not applied');
    await p.send(cycle, ci);
    await p.wait('CI applied once sent again', async () => ((await history(p, cycle)).includes('waiting_ci --[event:ci_finished:green]--> candidate_image') ? true : undefined), 10_000);
    assert.equal((await b.orch.base.readMemory(cycle)).candidateDigest, digest);
  }, undefined, { ...NO_SWEEP, CI_MAX_TIMEOUT_MS: '60000' });
});

test('M2: `send` answers "transmitted" only if the message is at a live workflow; dead during the send → resumed at the incident gate, the original gate asks for its decision again after "retry"', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('m2-send');
    await p.driveUntil(cycle, 'gate_overlap');
    await cancelW1(p, cycle);
    // The workflow dies between the check and the drop-off: the check still sees it alive (once).
    const real = Orchestrator.isAlive;
    let times = 0;
    Orchestrator.isAlive = (s) => (++times === 1 ? true : real(s));
    let r;
    try {
      r = await b.orch.send(cycle, approve('gate_overlap'), ADMIN.roles);
    } finally {
      Orchestrator.isAlive = real;
    }
    assert.equal(r.transmitted, false);
    assert.match(r.transmitted === false ? r.reason : '', /stopped during the send.*send it again after "retry"/);
    await p.waitForState(cycle, 'gate_incident');
    const before = b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Decision required — A similar tool may already exist')).length;
    await p.sendWhenExpected(cycle, approve('gate_incident'));
    await p.wait('decision asked again', async () => (b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Decision required — A similar tool may already exist')).length > before ? true : undefined));
    assert.equal(await p.state(cycle), 'gate_overlap', 'the lost decision is not applied');
    await p.sendWhenExpected(cycle, approve('gate_overlap'));
    await p.wait('decision applied once sent again', async () => ((await history(p, cycle)).includes('gate_overlap --[gate:approved]--> repo_creation') ? true : undefined), 10_000);
  }, undefined, NO_SWEEP);
});

test('M3: a decision at the incident gate is accepted even if the W1 is dead (resume, then delivery)', { timeout: 60_000 }, async () => {
  await withBench(async (_b, p) => {
    const cycle = await p.createCycle('m3-incident');
    await p.driveUntil(cycle, 'gate_incident');
    await cancelW1(p, cycle);
    assert.deepEqual(await p.send(cycle, approve('gate_incident')), { transmitted: true });
    await p.wait('resume', async () => ((await history(p, cycle)).includes('gate_incident --[resume:scoping]--> scoping') ? true : undefined), 10_000);
  }, undefined, NO_SWEEP);
});

// ── M7: one sweep at a time ─────────────────────────────────────────────────────────────────────

test('M7: during a slow sweep, the scheduled monitoring does not stack others behind it', { timeout: 60_000 }, async () => {
  await withBench(async (b) => {
    const sweep = b.orch.sweep.bind(b.orch);
    let calls = 0;
    b.orch.sweep = (o) => { calls += 1; return sweep(o); }; // the scheduled task goes through the instance's method
    const list = b.orch.base.openCycles.bind(b.orch.base);
    let started!: () => void;
    const slow = new Promise<void>((r) => { started = r; });
    let finish!: () => void;
    const end = new Promise<void>((r) => { finish = r; });
    // "Slow" sweep = held back until the test releases it: we count deadlines that really passed (runs
    // of the scheduled task), not seconds, which a loaded machine stretches.
    b.orch.base.openCycles = async () => { started(); await end; return list(); };
    await slow;
    calls = 0;
    const start = new Date().toISOString();
    const deadlines = async () => (await DBOS.listWorkflows({ scheduleName: 'monitoring', startTime: start })).length;
    try {
      await new Pilot(b).wait('three deadlines of the schedule during the slow sweep', async () => ((await deadlines()) >= 3 ? true : undefined));
      assert.ok(calls <= 1, `${calls} sweeps requested during a slow sweep (stacked behind it)`);
    } finally {
      b.orch.base.openCycles = list;
      finish();
    }
    await new Pilot(b).wait('the sweeps resume once the slow one is finished', async () => (calls >= 2 ? true : undefined));
  }, undefined, { MONITORING_CRON: '* * * * * *' });
});

// ── Targeted review: alpha, beta, gamma ─────────────────────────────────────────────────────────

test('alpha: a finished cycle whose W1 died before finishing its end is caught: end run again (cleanup, archiving), alert', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('alpha-end');
    await p.driveUntil(cycle, 'gate_overlap');
    const remove = b.deployer.remove.bind(b.deployer);
    b.deployer.remove = () => new Promise(() => {}); // the end stays stuck in the cleanup
    await b.orch.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'refused', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_overlap', outcome: 'refused', actor_id: ADMIN.id }));
    await p.waitForState(cycle, 'end_refusal');
    await p.wait('end started', async () => (cycleEnds(b, cycle) === 1 ? true : undefined));
    await cancelW1(p, cycle);
    b.deployer.remove = remove;
    const done = await b.orch.sweep();
    assert.ok(done.includes(`cycle ${cycle}: end run again (workflow CANCELLED)`), done.join(' | '));
    assert.equal(await p.waitForWorkflowEnd(cycle), 'SUCCESS');
    assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject === 'Tool alpha-end archived: repository to archive'), 'archiving requested by the end run again');
    assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject.startsWith(`End of cycle ${cycle} resumed`)));
  }, undefined, { ...NO_SWEEP, OPERATION_TIMEOUT_MS: '60000' });
});

test('beta: an external operation stopped without a result (cancelled from outside) is seen at once (native status, S4): the state\'s gate, without waiting for the deadline', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('beta-op');
    await p.driveUntil(cycle, 'repo_creation'); // the forge stays silent
    const [op] = await p.wait('operation in progress', async () => { const l = await DBOS.listWorkflows({ workflow_id_prefix: `op-${cycle}-`, status: 'PENDING' }); return l.length > 0 ? l : undefined; });
    await DBOS.cancelWorkflow(op!.workflowID);
    const start = Date.now();
    await p.waitForState(cycle, 'gate_scoping_blocked', 15_000);
    assert.ok(Date.now() - start < 15_000);
    const n = await p.wait('notification', async () => b.notifications.for(cycle, 'admin').find((x) => x.subject.startsWith('Decision required — Scoping blocked')));
    assert.match(n.content, /stopped without a result \(workflow CANCELLED\)/);
  }, undefined, { ...NO_SWEEP, OPERATION_TIMEOUT_MS: '120000' });
});

test('gamma: the cancellation and the death of the W1 stop the running external operation (child workflow cancelled)', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const operationOf = (cycle: number) => p.wait('operation in progress', async () => (await DBOS.listWorkflows({ workflow_id_prefix: `op-${cycle}-`, status: 'PENDING' }))[0]);
    // Cancellation during the repository creation.
    const cancelled = await p.createCycle('gamma-cancellation');
    await p.driveUntil(cancelled, 'repo_creation'); // the forge stays silent
    const op1 = await operationOf(cancelled);
    await b.orch.send(cancelled, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id }));
    await p.waitForState(cancelled, 'end_cancellation');
    await p.wait('operation cancelled (cancellation)', async () => ((await DBOS.getWorkflowStatus(op1.workflowID))?.status === 'CANCELLED' ? true : undefined), 5_000);
    // Incident during the repository creation: the W1 dies while it waits for the operation.
    const fault = await p.createCycle('gamma-incident');
    await p.driveUntil(fault, 'repo_creation');
    const op2 = await operationOf(fault);
    await cancelW1(p, fault);
    await b.orch.sweep();
    await p.waitForState(fault, 'gate_incident');
    await p.wait('operation cancelled (incident)', async () => ((await DBOS.getWorkflowStatus(op2.workflowID))?.status === 'CANCELLED' ? true : undefined), 5_000);
  }, undefined, { ...NO_SWEEP, OPERATION_TIMEOUT_MS: '60000' });
});

// ── E4: CI watcher (DBOS scheduled task) ─────────────────────────────────────────────────────────

test('E4 watcher: scheduled task — CI in progress: nothing; green: registry digest → candidate_image; red: back to hardening, red jobs as deviations; the fake watcher no longer sends the CI', { timeout: 90_000 }, async () => {
  const digest = `sha256:${'b2'.repeat(32)}`;
  const SARIF = { runs: [{ results: [{ ruleId: 'innerhtml-variable-text', fingerprints: { 'matchBasedId/v1': 'abc_0' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'web/app.js' } } }] }] }] };
  const calls: string[] = [];
  /** Simulated real forge: CI in progress for 3 passes, then green (or red for a `-faulty` tool). */
  const ciFinished = async (slug: string, cycle: number, round: number): Promise<CiResult | null> => {
    calls.push(`${slug}/${cycle}/${round}`);
    if (calls.filter((a) => a.startsWith(`${slug}/`)).length <= 3) return null;
    return slug.endsWith('-faulty')
      // The red `analysis` job (the template's Opengrep job) carries its SARIF: one deviation per finding, on its file.
      ? { outcome: 'red', checks: [{ check: 'tests', result: 'green' }, { check: 'analysis', result: 'red', details: SARIF }] }
      : { outcome: 'green', digest: digest, checks: [{ check: 'tests', result: 'green' }] };
  };
  const bench = await startBench(await freshDatabase(), { CI_MAX_TIMEOUT_MS: '60000' }, (f) => Object.assign(f.forge, { ciFinished }));
  const stopFake = launchFakeWatcher(bench.orch, 50); // like main.ts: must no longer send the CI
  try {
    const p = new Pilot(bench);
    const green = await p.createCycle('watch');
    const red = await p.createCycle('watch-faulty');
    await Promise.all([p.driveUntil(green, 'waiting_ci'), p.driveUntil(red, 'waiting_ci')]);
    await p.waitForState(green, 'gate_1');
    assert.equal((await bench.orch.base.readMemory(green)).candidateDigest, digest, 'the registry digest, not the fake watcher\'s');
    assert.ok(calls.filter((a) => a === `watch/${green}/1`).length >= 4, `watched at round 1 until the result: ${calls.join(' ')}`);
    await p.wait('back to hardening', async () => (await history(p, red)).includes('waiting_ci --[event:ci_finished:red]--> hardening_execution') || undefined);
    const deviations = await bench.orch.base.pool.query<{ rule: string; file: string }>("SELECT rule, file FROM deviations WHERE cycle_id = $1 AND rule LIKE 'ci:%'", [red]);
    assert.deepEqual(deviations.rows.map((r) => [r.rule, r.file]), [['ci:opengrep:abc_0', 'web/app.js']], 'the SARIF details of the analysis job are read');
    // At Gate 1, no longer waiting for CI: the watcher no longer asks anything for this cycle.
    const someGreen = () => calls.filter((a) => a.startsWith(`watch/${green}/`)).length;
    const before = someGreen();
    await sleep(2_500);
    assert.equal(someGreen(), before, 'no call outside waiting_ci');
  } finally {
    stopFake();
    await bench.orch.stop();
  }
});

test('E4 watcher: green CI but image missing from the registry → incident gate at once, with the exact reason, watcher stopped; "retry" after the deadline → delivery blocked, reason of the resume', { timeout: 90_000 }, async () => {
  const calls: number[] = [];
  const ciFinished = async (_slug: string, cycle: number): Promise<CiResult | null> => {
    calls.push(cycle);
    return { outcome: 'green', checks: [{ check: 'image', result: 'green' }] };
  };
  const bench = await startBench(await freshDatabase(), { CI_MAX_TIMEOUT_MS: '4000' }, (f) => Object.assign(f.forge, { ciFinished }));
  try {
    const p = new Pilot(bench);
    const cycle = await p.createCycle('watch-no-image');
    await p.driveUntil(cycle, 'waiting_ci');
    await p.waitForState(cycle, 'gate_incident');
    assert.ok((await history(p, cycle)).includes('waiting_ci --[incident]--> gate_incident'), 'before the deadline, not by the timeout');
    assert.match((await bench.orch.base.readMemory(cycle)).gateReason ?? '', /green CI but image missing from the registry/);
    await p.wait('admin told the exact reason', async () => bench.notifications.for(cycle, 'admin').some((n) => n.content.includes('image missing from the registry')) || undefined, 5_000);
    // At the gate: no longer waiting for CI, the watcher no longer asks anything (no loop).
    const before = calls.length;
    await sleep(4_500);
    assert.equal(calls.length, before, 'no call outside waiting_ci');
    // "Retry" after the deadline (counted from the merge, G5): not "silent CI", the reason says why.
    await p.send(cycle, approve('gate_incident'));
    await p.waitForState(cycle, 'gate_delivery_blocked');
    assert.match((await bench.orch.base.readMemory(cycle)).gateReason ?? '', /passed after a resume/);
  } finally {
    await bench.orch.stop();
  }
});

test('E5f watcher: W1 launches the Preview pipeline once (Preview URL, id from before), the watcher reads the run above it; green → requester feedback; a Preview no longer serving the candidate digest → red preview_changed; the fake watcher sends nothing', { timeout: 90_000 }, async () => {
  const launches: string[] = [];
  const reads: string[] = [];
  const ciFinished = async (): Promise<CiResult | null> => null; // real forge: scheduled watcher
  const launchPreviewPipeline = async (slug: string, url: string): Promise<number> => {
    launches.push(`${slug} ${url}`);
    return 41;
  };
  const previewPipelineFinished = async (slug: string, since: number) => {
    reads.push(`${slug}/${since}`);
    if (reads.filter((l) => l.startsWith(`${slug}/`)).length <= 2) return null;
    return { outcome: 'green' as const, checks: [{ check: 'perf', result: 'green' as const }] };
  };
  const bench = await startBench(await freshDatabase(), { CI_MAX_TIMEOUT_MS: '60000' }, (f) => Object.assign(f.forge, { ciFinished, launchPreviewPipeline, previewPipelineFinished }));
  const stopFake = launchFakeWatcher(bench.orch, 50); // must no longer send the Preview pipeline
  try {
    const p = new Pilot(bench);
    const green = await p.createCycle('prev');
    const change = await p.createCycle('prev-change');
    // The Preview of `prev-change` serves a digest other than the candidate (M5, §8.4) when the pipeline ends.
    const served = bench.orch.external.deployer.served.bind(bench.orch.external.deployer);
    bench.orch.external.deployer.served = async (env, slug) => (slug === 'prev-change' && env === 'preview' ? { digest: `sha256:${'c3'.repeat(32)}`, cycleId: change } : served(env, slug));
    await Promise.all([p.driveUntil(green, 'preview_pipeline'), p.driveUntil(change, 'preview_pipeline')]);
    await p.waitForState(green, 'waiting_preview_feedback'); // S5: green → the requester is notified, Gate 2 waits for their feedback
    await p.wait('back to hardening', async () => (await history(p, change)).includes('preview_pipeline --[event:preview_pipeline_finished:red]--> hardening_execution') || undefined);
    assert.deepEqual(launches.filter((l) => l.startsWith('prev ')), [`prev https://prev.preview.${ENV_TEST.TOOL_DOMAIN}`], 'launched once, Preview URL');
    assert.ok(reads.filter((l) => l === 'prev/41').length >= 3, `run read above the id from before: ${reads.join(' ')}`);
    const r = await bench.orch.base.pool.query<{ check: string; result: string }>(`SELECT check_name AS "check", result FROM pipeline_results WHERE cycle_id = $1 AND pipeline = 'preview' ORDER BY check_name`, [change]);
    assert.deepEqual(r.rows, [{ check: 'perf', result: 'green' }, { check: 'preview_changed', result: 'red' }]);
  } finally {
    stopFake();
    await bench.orch.stop();
  }
});

test('DBOS history: monitoring purges the successful runs of the scheduled tasks older than a day, never a cycle, a task or an idempotency key of the API', { timeout: 90_000 }, async () => {
  const ciFinished = async (): Promise<CiResult | null> => null; // real forge: watcher scheduled every second
  const bench = await startBench(await freshDatabase(), {}, (f) => Object.assign(f.forge, { ciFinished }));
  try {
    const p = new Pilot(bench);
    const cycle = await p.createCycle('purge');
    await p.driveUntil(cycle, 'gate_overlap'); // W1 alive, a W2 task finished
    await bench.orch.requestByKey('purge-key', { type: 'creation', name: 'Purge api', slug: 'purge-api', owner_service: 's', need: 'Track the department vehicles' }, REQUESTER);
    const scheduled = (before?: string) => DBOS.listWorkflows({ scheduleName: ['watcher', 'monitoring'], status: 'SUCCESS', ...(before === undefined ? {} : { completedBefore: before }), loadInput: false, loadOutput: false });
    await p.wait('successful runs of the watcher and the monitoring', async () => {
      const names = new Set((await scheduled()).map((w) => w.workflowName));
      return names.has('watcher') && names.has('monitoring') ? true : undefined;
    });
    const others = async () => (await DBOS.listWorkflows({ loadInput: false, loadOutput: false })).filter((w) => w.scheduleName === undefined).map((w) => w.workflowID).sort();
    const before = await others();
    assert.ok(before.includes(`api-${REQUESTER.id}-purge-key`) && before.some((w) => w.startsWith('cycle-')) && before.some((w) => w.startsWith('task-')), before.join(' '));
    // One-day retention: nothing recent is deleted.
    assert.equal(await bench.orch.purgeScheduled(), 0);
    assert.ok((await scheduled()).length > 0);
    // Without retention: all finished successful runs go; the rest of the DBOS history is intact.
    const instant = new Date().toISOString();
    assert.ok((await bench.orch.purgeScheduled(0)) > 0);
    assert.equal((await scheduled(instant)).length, 0);
    assert.deepEqual((await others()).filter((w) => before.includes(w)), before, 'cycles, tasks and API keys kept');
    assert.equal(await p.state(cycle), 'gate_overlap');
  } finally {
    await bench.orch.stop();
  }
});
