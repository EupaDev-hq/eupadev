// No path dies silently or stays stuck (2nd review, ROADMAP §8.13 D22, A1, A2, B2, B3, B4; §8.14 S1, S2):
// a code update resumes the W1s in place (DBOS patching); a really dead W1 (cancelled, in error, waiting
// on an executor that disappeared) is caught by the scheduled monitoring, goes through the incident gate, is resumed from
// the start under the same identifier and, after "retry", carries on exactly where it was thanks to the memory read back
// from the database — up to the end of the cycle.
// Real DBOS engine, throwaway PostgreSQL, fresh database per test, scripted fakes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { compliantReport, type EngineResponse } from '../src/external/fakes.ts';
import type { StateId } from '../src/machine/states.ts';
import type { Message } from '../src/messages.ts';
import { migratedDatabase, startPostgres, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ADMIN, REQUESTER, startBench, freeze, releaseFreezes, Pilot, happyResponse, type Bench , hats } from './helpers/bench.ts';
import { cycleWorkflowId } from '../src/workflows/deps.ts';

let postgres: ThrowawayPostgres;
let number = 0;
before(async () => { postgres = await startPostgres({ migrations: false }); }, { timeout: 180_000 });
after(() => postgres?.remove());

const freshDatabase = () => migratedDatabase(postgres, `replacement_${++number}`);
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
const all = (b: Bench) => {
  b.engine.switchboard.auto = async (_c, e) => happyResponse(e);
  b.forge.switchboard.auto = async () => ({ type: 'ok' });
  b.deployer.switchboard.auto = async () => ({ type: 'ok' });
};
const approve = (gate: StateId, extra: Partial<Extract<Message, { type: 'decision' }>> = {}): Message => ({ type: 'decision', gate, outcome: 'approved', actor_id: ADMIN.id, ...extra });

/**
 * Kills the cycle's W1 (cancelled: fault, outside intervention); the monitoring resumes it from the start, under
 * the same identifier, at the incident gate; the admin retries.
 */
async function dieAndResume(b: Bench, p: Pilot, cycle: number, state: StateId, afterSweep: () => void = () => {}): Promise<void> {
  const before = await p.workflowW1(cycle);
  await DBOS.cancelWorkflow(before);
  await p.wait('workflow cancelled', async () => ((await DBOS.getWorkflowStatus(before))?.status === 'CANCELLED' ? true : undefined));
  await b.orch.sweep();
  await p.waitForState(cycle, 'gate_incident');
  afterSweep();
  assert.equal(await p.workflowW1(cycle), before, 'the same W1 (same id) is resumed');
  await p.wait('W1 resumed', async () => ((await p.statusW1(cycle)) === 'PENDING' ? true : undefined));
  await p.sendWhenExpected(cycle, approve('gate_incident'));
  await p.wait(`resume of ${state}`, async () => ((await history(p, cycle)).includes(`gate_incident --[resume:${state}]--> ${state}`) ? true : undefined));
}

/** Goes to the end of the cycle (end_success) and checks that Prod serves the CI digest. */
async function toTheEnd(b: Bench, p: Pilot, cycle: number, slug: string): Promise<void> {
  await p.driveUntil(cycle, 'end_success', { timeoutMs: 60_000 });
  assert.equal(await p.waitForWorkflowEnd(cycle), 'SUCCESS');
  assert.equal(b.deployer.running('prod', slug), p.digests.get(cycle) ?? (await b.orch.base.gate2ApprovedDigest(cycle)));
}

// ── S1: code update through DBOS patching (constant application version) ─────────────────────

test('S1: a code update (different workflow source) resumes the W1 in place, without an incident, to the end', { timeout: 120_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  let ciDigest = '';
  await withBench(async (_b, p) => {
    cycle = await p.createCycle('s1-patch');
    await p.driveUntil(cycle, 'gate_1');
    ciDigest = p.digests.get(cycle)!;
  }, url);
  // "New code": one more workflow changes the source hash that DBOS would compute without patching.
  DBOS.registerWorkflow(async function newCode(): Promise<void> {}, { name: 'new-code' });
  await withBench(async (b, p) => {
    p.cycles.set('s1-patch', cycle);
    p.digests.set(cycle, ciDigest);
    assert.equal(DBOS.applicationVersion, 'PATCHING_ENABLED', 'constant version, never computed from the source');
    await p.wait('W1 resumed in place by DBOS', async () => ((await p.statusW1(cycle)) === 'PENDING' ? true : undefined));
    await b.orch.sweep();
    assert.equal(await p.state(cycle), 'gate_1');
    assert.ok(!(await history(p, cycle)).some((h) => h.includes('incident')), 'no incident');
    await toTheEnd(b, p, cycle, 's1-patch');
  }, url);
});

test('A1: a W1 waiting at an executor this engine will never resume (DBOS__VMID changed) is stopped, then resumed here through the incident gate, and goes to the end', { timeout: 120_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  let ciDigest = '';
  process.env['DBOS__VMID'] = 'old-executor';
  try {
    await withBench(async (_b, p) => {
      cycle = await p.createCycle('a1-executor');
      await p.driveUntil(cycle, 'gate_1');
      ciDigest = p.digests.get(cycle)!;
    }, url);
  } finally {
    delete process.env['DBOS__VMID'];
  }
  await withBench(async (b, p) => {
    p.cycles.set('a1-executor', cycle);
    p.digests.set(cycle, ciDigest);
    await p.waitForState(cycle, 'gate_incident');
    const alert = b.notifications.for(cycle, 'admin').find((n) => n.subject.startsWith('Technical incident: workflow of cycle'));
    assert.ok(alert !== undefined && /executor "old-executor"/.test(alert.content), alert?.content);
    await p.wait('W1 resumed by this executor', async () => { const s = await DBOS.getWorkflowStatus(cycleWorkflowId(cycle)); return s?.status === 'PENDING' && s.executorId === DBOS.executorID ? true : undefined; });
    await p.sendWhenExpected(cycle, approve('gate_incident'));
    await p.waitForState(cycle, 'gate_1');
    await toTheEnd(b, p, cycle, 'a1-executor');
  }, url);
});

// ── A2 / D22: no volatile memory — a W1 killed and resumed at every sensitive state goes all the way ──

test('A2: W1 dead and resumed in candidate_image → the candidate digest is read back from the database, the Preview then the Prod deploy it', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a2-image');
    freeze(b, cycle, 'candidate_image');
    await p.driveUntil(cycle, 'candidate_image');
    const ci = p.digests.get(cycle)!;
    // The freeze holds the old workflow in the transient state; it is lifted once the replacement is at the incident gate.
    await dieAndResume(b, p, cycle, 'candidate_image', () => releaseFreezes(b));
    await p.driveUntil(cycle, 'waiting_preview_feedback');
    assert.equal(b.deployer.running('preview', 'a2-image'), ci, 'the Preview serves the CI digest');
    await toTheEnd(b, p, cycle, 'a2-image');
  });
});

test('A2: W1 dead and resumed during preview_deployment → the deployment resumes with the CI digest', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a2-preview');
    await p.driveUntil(cycle, 'preview_deployment'); // the Preview deployer stays silent
    const ci = p.digests.get(cycle)!;
    await dieAndResume(b, p, cycle, 'preview_deployment');
    await p.driveUntil(cycle, 'waiting_preview_feedback');
    assert.equal((await history(p, cycle)).filter((h) => h === 'preview_deployment --[incident]--> gate_incident').length, 1, 'no incident after the resume (candidate digest read back from the database)');
    assert.equal(b.deployer.running('preview', 'a2-preview'), ci);
    await toTheEnd(b, p, cycle, 'a2-preview');
  });
});

test('A2: W1 dead and resumed after a message received during the pause → the mock-up starts again, then the message becomes the scoping instruction (D18)', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a2-pause');
    await p.driveUntil(cycle, 'scoping_pause');
    const text = 'I am back: add sorting by date';
    await p.sendWhenExpected(cycle, { type: 'requester_message', text: text, actor_id: REQUESTER.id });
    await p.waitForState(cycle, 'mockup_deployment'); // the mock-up deployer stays silent
    await dieAndResume(b, p, cycle, 'mockup_deployment');
    all(b);
    await b.deployer.switchboard.reconsider();
    const c = await b.orch.base.readCycle(cycle);
    await p.wait('scoping run again with the requester\'s message', async () => (b.engine.switchboard.log.some((j) => j.input.role === 'scoping' && j.input.task_id.startsWith(`${c.tool_id}-${c.id}-`) && j.input.context['instruction'] === text) ? true : undefined));
    assert.ok((await history(p, cycle)).includes('waiting_scoping_feedback --[event:scoping_feedback:correction]--> scoping'));
    await toTheEnd(b, p, cycle, 'a2-pause');
  });
});

test('A2: W1 dead and resumed at a gate after a correction by the admin → instruction and reason survive; two incidents in the same cycle', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a2-gate');
    await p.driveUntil(cycle, 'gate_scoping_budget');
    const instruction = 'Use the internal directory';
    await p.sendWhenExpected(cycle, { type: 'decision', gate: 'gate_scoping_budget', outcome: 'correction', actor_id: ADMIN.id, comment: instruction });
    // Without a top-up, the budget reopens the same gate at once; the instruction waits for the first scoping started.
    await p.wait('back to the budget gate', async () => ((await history(p, cycle)).filter((h) => h.endsWith('--> gate_scoping_budget')).length === 2 ? true : undefined));
    await dieAndResume(b, p, cycle, 'gate_scoping_budget');
    // Reason given after the resume (D21): the gate shows its own reason again, not the incident.
    const n = await p.wait('notification of the resumed gate', async () => b.notifications.for(cycle, 'admin').filter((x) => x.subject.startsWith('Decision required: gate_scoping_budget')).at(-1));
    assert.match(n.content, /Scoping budget reached/);
    // Second incident in the same cycle, from the same gate: the resume again returns to the right origin.
    await dieAndResume(b, p, cycle, 'gate_scoping_budget');
    assert.match(b.notifications.for(cycle, 'admin').filter((x) => x.subject.startsWith('Decision required: gate_scoping_budget')).at(-1)!.content, /Scoping budget reached/);
    all(b);
    await p.sendWhenExpected(cycle, approve('gate_scoping_budget', { budget_top_up_usd: 5 }));
    const c = await b.orch.base.readCycle(cycle);
    const call = await p.wait('first scoping launched', async () => b.engine.calls(`${c.tool_id}-${c.id}-1-scoping`)[0]);
    assert.equal(call.context['instruction'], instruction, 'the admin\'s instruction survives the resume of the workflow');
    await toTheEnd(b, p, cycle, 'a2-gate');
  });
});

test('A2: W1 dead and resumed during a scoping after two identical failures → the counters survive, the 3rd escalates', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a2-counters');
    await p.driveUntil(cycle, 'scoping'); // the engine waits for scoping
    const failure: EngineResponse = { type: 'failed', reason: 'npm install: ECONNRESET' };
    for (let i = 1; i <= 2; i += 1) {
      b.engine.answer('scoping', failure);
      await p.wait(`failure ${i}`, async () => ((await history(p, cycle)).filter((h) => h === 'scoping --[guard:technical_failure]--> scoping').length === i ? true : undefined));
    }
    const c = await b.orch.base.readCycle(cycle);
    await p.wait('3rd scoping launched', async () => (b.engine.inProgress().includes(`${c.tool_id}-${c.id}-3-scoping`) ? true : undefined));
    assert.deepEqual((await b.orch.base.readMemory(cycle)).scoping, { attempts: 2, sameError: 2, lastError: 'npm install: ECONNRESET' }, 'counters read back from the database');
    await dieAndResume(b, p, cycle, 'scoping');
    // The cut-off task (3) is closed by the sweep, at the cap (started); "retry" restarts the scoping (iteration 4).
    const cut = await b.orch.base.readTask(`${c.tool_id}-${c.id}-3-scoping`);
    assert.deepEqual([cut.status, cut.cost_usd], ['failed', 4]);
    const task = (n: number) => `${c.tool_id}-${c.id}-${n}-scoping`;
    await p.wait('scoping run again, cut container stopped', async () => (b.engine.inProgress().includes(task(4)) && !b.engine.inProgress().includes(task(3)) ? true : undefined));
    b.engine.answer('scoping', failure, 'a2-counters');
    await p.wait('escalation', async () => ((await history(p, cycle)).includes('scoping --[guard:escalation]--> gate_scoping_blocked') ? true : undefined));
    const n = await p.wait('notification of the gate', async () => b.notifications.for(cycle, 'admin').find((x) => x.subject.startsWith('Decision required: gate_scoping_blocked')));
    assert.match(n.content, /same error 3 times in a row/);
    all(b);
    await toTheEnd(b, p, cycle, 'a2-counters');
  });
});

// ── B2: monitoring while the process runs ───────────────────────────────────────────────────────

test('B2 + S2: a W1 cancelled on the way is caught by the scheduled monitoring (DBOS), without a restart, and the admin is alerted', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b2-periodic');
    await p.driveUntil(cycle, 'gate_overlap');
    await DBOS.cancelWorkflow(await p.workflowW1(cycle));
    // No explicit call: the scheduled task runs every second here (MONITORING_CRON).
    await p.waitForState(cycle, 'gate_incident', 10_000);
    await p.wait('admin alert', async () => (b.notifications.for(cycle, 'admin').some((n) => /Technical incident: workflow of cycle .* stopped \(CANCELLED\)/.test(n.subject)) ? true : undefined));
    await new Promise((r) => setTimeout(r, 2500)); // two more sweeps: the resumed W1, alive, is not resumed again
    const alerts = b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Technical incident: workflow of cycle'));
    assert.equal(alerts.length, 1, b.notifications.for(cycle, 'admin').map((n) => `${n.subject} — ${n.content}`).join('\n'));
    assert.ok((await DBOS.listWorkflows({ workflowName: 'monitoring' })).length >= 2, 'monitoring run by the DBOS schedule');
    await p.sendWhenExpected(cycle, approve('gate_incident'));
    await p.waitForState(cycle, 'gate_overlap');
  });
});

test('B2: a message to a dead workflow is refused with the reason and triggers the resume; a cancellation, for its part, goes to the resumed W1', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b2-send');
    await p.driveUntil(cycle, 'gate_overlap');
    await DBOS.cancelWorkflow(await p.workflowW1(cycle));
    await p.wait('cancelled', async () => ((await p.statusW1(cycle)) === 'CANCELLED' ? true : undefined));
    await assert.rejects(b.orch.send(cycle, approve('gate_overlap'), ADMIN.roles), /workflow of cycle \d+ stopped: message decision not passed on/);
    assert.equal(await p.state(cycle), 'gate_incident', 'the resume took place at once');
    await DBOS.cancelWorkflow(await p.workflowW1(cycle));
    await p.wait('cancelled', async () => ((await p.statusW1(cycle)) === 'CANCELLED' ? true : undefined));
    assert.deepEqual(await b.orch.send(cycle, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id })), { transmitted: true });
    await p.waitForState(cycle, 'end_cancellation');
  }, undefined, { MONITORING_CRON: '0 0 0 1 1 *' });
});

test('B2: the sweep cancels the external operations of the dead workflow; a cycle in error does not hold up the others', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const silent = await p.createCycle('b2-operation');
    await p.driveUntil(silent, 'repo_creation'); // the forge stays silent
    const other = await p.createCycle('b2-other');
    await p.driveUntil(other, 'gate_overlap');
    const ops = await DBOS.listWorkflows({ workflow_id_prefix: `op-${silent}-`, status: 'PENDING' });
    assert.equal(ops.length, 1);
    // The "other" cycle makes its sweep fail (database refusing to read its memory): the "silent" cycle is handled anyway.
    const read = b.orch.base.readMemory.bind(b.orch.base);
    b.orch.base.readMemory = async (id) => { if (id === other && DBOS.workflowID === undefined) throw new Error('simulated fault: unreadable memory'); return read(id); };
    await DBOS.cancelWorkflow(await p.workflowW1(silent));
    await DBOS.cancelWorkflow(await p.workflowW1(other));
    const done = await b.orch.sweep();
    assert.ok(done.some((f) => f.startsWith(`cycle ${silent}: workflow CANCELLED resumed`)), done.join(' | '));
    assert.ok(done.some((f) => f.startsWith(`cycle ${other}: sweep error`)), done.join(' | '));
    assert.equal((await DBOS.getWorkflowStatus(ops[0]!.workflowID))?.status, 'CANCELLED', 'the operation of the dead workflow is cancelled');
    assert.ok(b.notifications.for(other, 'admin').some((n) => n.subject.startsWith('Sweep failed')));
    b.orch.base.readMemory = read;
    await b.orch.sweep(); // the next sweep catches it
    await p.waitForState(other, 'gate_incident', 10_000);
  }, undefined, { MONITORING_CRON: '0 0 0 1 1 *', OPERATION_TIMEOUT_MS: '30000' });
});

// ── B3: "retry" really restarts the work ────────────────────────────────────────────────────────

test('B3: W1 dead during the review (tasks in flight) → "retry" runs the reviewers again (new attempt), without charging again what succeeded', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b3-review');
    await p.driveUntil(cycle, 'hardening_review'); // the reviewers wait
    const c = await b.orch.base.readCycle(cycle);
    const id = (r: string, s = '') => `${c.tool_id}-${c.id}-1-${r}${s}`;
    // The quality reviewer finishes; the security reviewer is still in flight when the incident occurs.
    b.engine.answer('quality-reviewer', { type: 'report', report: (e: { task_id: string }) => compliantReport('quality-reviewer', e.task_id) });
    await p.wait('quality finished', async () => ((await b.orch.base.readTask(id('quality-reviewer')).catch(() => undefined))?.status === 'done' ? true : undefined));
    // The W1 dies while waiting for the reviewers: the monitoring stops its children and opens the incident.
    await DBOS.cancelWorkflow(await p.workflowW1(cycle));
    await p.waitForState(cycle, 'gate_incident');
    assert.equal((await b.orch.base.readTask(id('security-reviewer'))).status, 'failed', 'task in flight closed by the incident');
    assert.equal((await b.orch.base.readTask(id('security-reviewer'))).cost_usd, 10, 'started: cap');
    all(b);
    await p.sendWhenExpected(cycle, approve('gate_incident'));
    await p.wait('review resumed and compliant', async () => ((await history(p, cycle)).includes('hardening_review --[task:done]--> hardening_evaluation') ? true : undefined));
    assert.equal(b.engine.calls(id('security-reviewer', '-r2')).length, 1, 'the security reviewer is run again (attempt 2)');
    assert.equal(b.engine.calls(id('quality-reviewer')).length, 1, 'the quality reviewer, already finished, is not charged again');
    assert.deepEqual(b.engine.calls(id('quality-reviewer', '-r2')), []);
    await p.wait('merge', async () => ((await history(p, cycle)).includes('hardening_evaluation --[guard:compliant]--> merge') ? true : undefined));
    assert.deepEqual((await b.orch.base.deviationsSince(cycle, 1)).map((e) => e.rule), [], 'no phantom report:<role> deviation');
  }, undefined, { AGENT_CONCURRENCY: '2' });
});

// ── B4: faults during the incident gate ─────────────────────────────────────────────────────────

test('B4: a lasting fault during the incident gate is retried at short, growing intervals; a cancellation is read during the wait', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    // Reading the incident gate's reminders fails every time (database "down" for this query), from the gate entry on.
    const reminders = b.orch.base.reminders.bind(b.orch.base);
    b.orch.base.reminders = async (id, state, visit) => {
      if ((await b.orch.base.readCycle(id)).state === 'gate_incident') throw new Error('simulated fault: connection refused');
      return reminders(id, state, visit);
    };
    const cycle = await p.createCycle('b4-wait');
    await p.driveUntil(cycle, 'gate_incident');
    const alerts = () => b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Technical incident during the incident gate'));
    const instants: number[] = [];
    await p.wait('three alerts', async () => { while (instants.length < alerts().length) instants.push(Date.now()); return alerts().length >= 3 ? true : undefined; }, 30_000);
    const deviations = [instants[1]! - instants[0]!, instants[2]! - instants[1]!];
    assert.ok(deviations[1]! > deviations[0]!, `growing waits: ${deviations.join(' ms, ')} ms`);
    // The cancellation arrives during a wait: it is applied without waiting for the end of the fault or the deadline (60 s here).
    const before = Date.now();
    await b.orch.send(cycle, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id }));
    await p.waitForState(cycle, 'end_cancellation', 10_000);
    assert.ok(Date.now() - before < 10_000);
    b.orch.base.reminders = reminders;
  }, undefined, { REMINDER_DELAY_MS: '60000', INCIDENT_RETRY_DELAY_MS: '300', STEP_ATTEMPTS: '1' });
});

