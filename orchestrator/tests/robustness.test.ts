// One test per robustness fix (cold reviews, ROADMAP §8.13 D21 and rules A/B): each one failed on the previous
// code and passes now. Real DBOS engine, throwaway PostgreSQL, fresh database
// per test, scripted fakes; no state forced in the database except where that is precisely the simulated fault.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { readConfig } from '../src/config.ts';
import { Switchboard, compliantReport, overlapReport, type EngineResponse } from '../src/external/fakes.ts';
import type { TaskInput } from '../src/external/contracts.ts';
import type { Message } from '../src/messages.ts';
import { AuthorizationError } from '../src/orchestrator.ts';
import { cycleWorkflowId, taskWorkflowId } from '../src/workflows/deps.ts';
import { migratedDatabase, startPostgres, unprotected, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ADMIN, REQUESTER, startBench, ENV_TEST, Pilot, happyResponse, type Bench , hats } from './helpers/bench.ts';

let postgres: ThrowawayPostgres;
let number = 0;

before(async () => {
  postgres = await startPostgres({ migrations: false });
}, { timeout: 180_000 });

after(() => postgres?.remove());

async function freshDatabase(): Promise<string> {
  number += 1;
  return migratedDatabase(postgres, `robustness_${number}`);
}

/** Fresh bench; `body` receives the bench and its pilot; the bench is always stopped at the end. */
async function withBench(body: (b: Bench, p: Pilot, url: string) => Promise<void>, url?: string, env: Record<string, string> = {}): Promise<void> {
  const u = url ?? (await freshDatabase());
  const bench = await startBench(u, env);
  try {
    await body(bench, new Pilot(bench), u);
  } finally {
    await bench.orch.stop();
  }
}

const statusW1 = async (cycle: number) => (await DBOS.getWorkflowStatus(cycleWorkflowId(cycle)))?.status;
const lastAdminNotification = (b: Bench, cycle: number) => b.notifications.for(cycle, 'admin').at(-1);
/** The state changes before the gate notification goes out: we wait for the notification itself. */
const adminNotification = (b: Bench, p: Pilot, cycle: number, subject: RegExp) =>
  p.wait(`admin notification ${subject}`, async () => { const n = lastAdminNotification(b, cycle); return n !== undefined && subject.test(n.subject) ? n : undefined; }, 10_000);
const taskOrNothing = (b: Bench, id: string) => b.orch.base.readTask(id).catch(() => undefined);
const history = async (p: Pilot, cycle: number) => (await p.history(cycle)).map((h) => `${h.previous_state ?? '∅'} --[${h.trigger}]--> ${h.state}`);
const all = async (b: Bench) => { b.engine.switchboard.auto = async (_c, e) => happyResponse(e); b.forge.switchboard.auto = async () => ({ type: 'ok' }); b.deployer.switchboard.auto = async () => ({ type: 'ok' }); };

// ── Bench: switchboard of the fakes ─────────────────────────────────────────────────────────────

test('Bench: a request that arrived while a policy replaced in the meantime was being evaluated goes before the new one (never parked without an answer)', async () => {
  const g = new Switchboard<string, string>();
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  g.auto = async () => { await slow; return undefined; }; // the old policy leaves it waiting… but slowly
  const answer = g.ask('preview:x', 'entry');
  g.auto = async () => 'new';
  await g.reconsider(); // sees nothing: the request is not parked yet
  release();
  assert.equal(await Promise.race([answer, sleep(500).then(() => 'parked without an answer')]), 'new');
  assert.equal(g.pending.length, 0);
});

// ── A2 / D21: error boundary of W1 ──────────────────────────────────────────────────────────────

test('Bench: the pilot never sends again the message of a state W1 has just left (state and history read in the same snapshot)', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('bench-snapshot');
    // Worst case, made deterministic: the green CI is dropped off; the pilot reads the cycle back still in waiting_ci, then W1
    // moves on to Gate 1 before the pilot reads the history (the order a loaded machine produced at random).
    const send = b.orch.send.bind(b.orch);
    let ciDropped = false;
    b.orch.send = async (id, m, roles) => { const r = await send(id, m, roles); if (m.type === 'ci_finished') ciDropped = true; return r; };
    const read = b.orch.base.readCycle.bind(b.orch.base);
    let reread!: () => void;
    const rereadWaitingCi = new Promise<void>((r) => { reread = r; });
    let seenStale = false;
    b.orch.base.readCycle = async (id, client) => {
      const c = await read(id, client);
      if (DBOS.workflowID === undefined && ciDropped && c.state === 'waiting_ci') { seenStale = true; reread(); }
      return c;
    };
    const transition = b.orch.base.transition.bind(b.orch.base);
    b.orch.base.transition = async (id, from, ...rest) => { if (from === 'waiting_ci') await rereadWaitingCi; return transition(id, from, ...rest); };
    const readHistory = p.history.bind(p);
    let advance = false;
    p.history = async (id) => {
      if (seenStale && !advance) { advance = true; await p.wait('Gate 1', async () => ((await read(cycle)).state === 'gate_1' ? true : undefined)); }
      return readHistory(id);
    };
    await p.driveUntil(cycle, 'gate_1');
    assert.ok(advance, 'the window was indeed crossed');
    assert.equal(p.digests.get(cycle), (await b.orch.base.readMemory(cycle)).candidateDigest, 'the digest kept by the pilot is the one W1 received');
  });
});

test('A2: an external service down beyond the retries (gate notification) opens the incident gate with the exact error; W1 stays alive', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const notify = b.notifications.notify.bind(b.notifications);
    b.notifications.notify = async (d, id, subject, content) => {
      if (subject.startsWith('Decision required: gate_overlap')) throw new Error('SMTP 421: mail service unavailable');
      return notify(d, id, subject, content);
    };
    const cycle = await p.createCycle('a2-tool');
    await p.driveUntil(cycle, 'gate_overlap');
    await p.waitForState(cycle, 'gate_incident');
    const n = await adminNotification(b, p, cycle, /Decision required: gate_incident/);
    assert.match(n.content, /Technical incident in state gate_overlap/);
    assert.match(n.content, /SMTP 421: mail service unavailable/, 'the exact error is shown to the admin');
    assert.match(n.content, /exceeded its maximum of 3 retries/, 'after the automatic retries (A3)');
    assert.equal(await statusW1(cycle), 'PENDING');
    // Retry returns to the original gate, and to it alone.
    b.notifications.notify = notify;
    await p.send(cycle, { type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id });
    await p.waitForState(cycle, 'gate_overlap');
    assert.ok((await history(p, cycle)).includes('gate_incident --[resume:gate_overlap]--> gate_overlap'));
  }, undefined, { MONITORING_CRON: '0 0 0 1 1 *' }); // the error boundary of W1 alone, without the monitoring that would catch a dead W1
});

test('A5 (defence in depth): an invalid message that still reached the mailbox leads to the incident, never to the death of W1', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a5-mailbox');
    await p.driveUntil(cycle, 'gate_overlap');
    const c = await b.orch.base.readCycle(cycle);
    // Bypasses the entry validation (and the authorisation: hat already set): `correction` without a comment, violates
    // approvals_correction_commented.
    await DBOS.send(cycleWorkflowId(cycle), { type: 'decision', gate: 'gate_overlap', outcome: 'correction', actor_id: ADMIN.id, hat: 'admin', visit: c.visit } satisfies Message, 'mailbox');
    await p.waitForState(cycle, 'gate_incident');
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_incident/)).content, /approvals_correction_commented/);
    assert.equal(await statusW1(cycle), 'PENDING');
  });
});

test('A3: a transient database error is retried with a growing wait, without an incident', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a3-tool');
    await p.driveUntil(cycle, 'waiting_scoping_feedback');
    const read = b.orch.base.readCycle.bind(b.orch.base);
    let faults = 0;
    b.orch.base.readCycle = async (id: number) => {
      if (faults < 2 && DBOS.workflowID === cycleWorkflowId(id)) { faults += 1; throw new Error('Connection terminated unexpectedly'); }
      return read(id);
    };
    await all(b);
    await p.send(cycle, { type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id });
    await p.waitForState(cycle, 'hardening_execution');
    assert.equal(faults, 2);
    assert.ok(!(await history(p, cycle)).some((h) => h.includes('incident')));
    // The retry happened INSIDE the step (A3): no incident recorded, no "unrecorded" incident reported to the admin.
    assert.deepEqual(b.notifications.for(cycle, 'admin').filter((n) => /incident/i.test(n.subject)).map((n) => n.subject), []);
    const steps = await DBOS.listWorkflowSteps(await p.workflowW1(cycle));
    assert.ok(steps !== undefined && steps.some((s) => s.name === 'read the cycle and its memory' && s.error === null), 'the step finally succeeded');
  });
});

// ── A4: W1 always sees the end of W2 (native status, S4), bounded output, enforced timeout ─────────

test('A4: engine output out of bounds (tree digest, cost, duration, tokens) → task failed with the reason, never an SQL violation', { timeout: 90_000 }, async () => {
  for (const [name, output, reason] of [
    ['tree', { tree_hash: 'not-a-sha256' }, /tree digest out of format/],
    ['cost', { cost_usd: Number.NaN }, /invalid declared cost/],
    ['duration', { duration_s: 1.5 }, /invalid declared duration/],
    ['tokens', { tokens: { input: -1, output: 0 } }, /invalid declared tokens/],
  ] as const) {
    await withBench(async (b, p) => {
      const cycle = await p.createCycle(`a4-${name}`);
      await p.driveUntil(cycle, 'hardening_execution');
      b.engine.switchboard.auto = async (_c, e) => (e.role === 'builder' ? { type: 'report', report: compliantReport('builder', e.task_id), ...output } as EngineResponse : happyResponse(e));
      await b.engine.switchboard.reconsider();
      const c = await b.orch.base.readCycle(cycle);
      const id = `${c.tool_id}-${c.id}-1-builder`;
      const t = await p.wait(`task ${id} closed`, async () => { const x = await taskOrNothing(b, id); return x === undefined || x.status === 'in_progress' || x.status === 'queued' ? undefined : x; });
      assert.equal(t.status, 'failed', name);
      assert.match((t.report as { reason: string }).reason, reason);
      assert.equal(t.cost_usd, 10, 'unknown cost = cap');
      await p.wait('round evaluated', async () => ((await history(p, cycle)).some((h) => h.startsWith('hardening_execution --[task:failed]')) ? true : undefined));
      assert.ok(!(await history(p, cycle)).some((h) => h.includes('incident')));
    });
  }
});

test('A4: a result impossible to record (report refused by PostgreSQL): W2 ends in ERROR, W1 sees it and closes the task as failed at the cap', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a4-record');
    await p.driveUntil(cycle, 'contract');
    b.engine.answer('contract', { type: 'report', report: (e: Omit<TaskInput, 'signal'>) => compliantReport('contract', e.task_id, { summary: 'contract written \u0000 (null byte refused by jsonb)' }) });
    await p.waitForState(cycle, 'gate_contract_blocked');
    const c = await b.orch.base.readCycle(cycle);
    const t = await b.orch.base.readTask(`${c.tool_id}-${c.id}-1-contract`);
    assert.deepEqual([t.status, t.cost_usd], ['failed', 10]);
    assert.match((t.report as { reason: string }).reason, /task stopped without a recorded result \(workflow ERROR: .*unsupported Unicode escape sequence/);
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_contract_blocked/)).content, /task stopped without a recorded result \(workflow ERROR/);
  });
});

test('A4: an engine that ignores the stop signal no longer blocks the queue; a W2 cancelled from outside counts as a failed task', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const execute = b.engine.execute.bind(b.engine);
    b.engine.execute = async (e) => (e.tool === 'a4-silent' ? new Promise(() => {}) : execute(e));
    await all(b);
    const silent = await p.createCycle('a4-silent');
    const behind = await p.createCycle('a4-behind'); // N = 1: its task waits behind in the queue
    await p.waitForState(silent, 'gate_overlap', 15_000);
    const d = await b.orch.base.readCycle(behind);
    await p.wait('the other tool\'s task goes through despite the silent engine', async () => ((await taskOrNothing(b, `${d.tool_id}-${d.id}-1-overlap`))?.status === 'done' ? true : undefined), 15_000);
    const c = await b.orch.base.readCycle(silent);
    const t = await b.orch.base.readTask(`${c.tool_id}-${c.id}-1-overlap`);
    assert.equal(t.status, 'failed');
    assert.match((t.report as { reason: string }).reason, /task timeout exceeded/);
  });
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a4-cancelled');
    await p.driveUntil(cycle, 'overlap_search');
    const c = await b.orch.base.readCycle(cycle);
    const id = `${c.tool_id}-${c.id}-1-overlap`;
    await p.wait('task in progress', async () => ((await taskOrNothing(b, id))?.status === 'in_progress' ? true : undefined));
    await DBOS.cancelWorkflow(taskWorkflowId(id));
    await p.waitForState(cycle, 'gate_overlap', 15_000);
    assert.equal((await b.orch.base.readTask(id)).status, 'failed');
    assert.ok((await history(p, cycle)).includes('overlap_search --[task:failed]--> gate_overlap'));
  });
});

// ── A5: full validation of the content at the entry ─────────────────────────────────────────────

test('A5: an invalid message or request is refused to the caller with a clear error, never passed on', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a5-entry');
    await p.driveUntil(cycle, 'gate_scoping_budget');
    const invalid: [Message, RegExp][] = [
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'correction', actor_id: ADMIN.id }, /comment required/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'correction', actor_id: ADMIN.id, comment: '   ' }, /comment/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: '' }, /actor_id/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: ADMIN.id, budget_top_up_usd: -5 }, /budget_top_up_usd/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: ADMIN.id, budget_top_up_usd: Number.NaN }, /budget_top_up_usd/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'refused', actor_id: ADMIN.id, budget_top_up_usd: 5 }, /only with "approved"/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: ADMIN.id, digest: 'latest' }, /digest/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: ADMIN.id, digest: `sha256:${'a'.repeat(64)}` }, /only Gate 2/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'maybe' as never, actor_id: ADMIN.id }, /outcome/],
      [{ type: 'decision', gate: 'gate_scoping_budget', outcome: 'scope_change', actor_id: ADMIN.id, comment: 'x' }, /impossible at gate/],
      [{ type: 'cancellation', actor_id: 'admin@example.test' }, /actor_id/],
      [{ type: 'scoping_feedback', outcome: 'satisfied', actor_id: 'not-a-uuid' }, /actor_id/],
      [{ type: 'requester_message', text: '', actor_id: REQUESTER.id }, /text/],
      [{ type: 'ci_finished', outcome: 'red', checks: [{ check: 'lint', result: 'green' }] }, /without any red check/],
      [{ type: 'ci_finished', outcome: 'green', digest: `sha256:${'b'.repeat(64)}`, checks: 'not an array' as never }, /checks: array expected/],
      [{ type: 'preview_pipeline_finished', outcome: 'green', checks: [{ check: '', result: 'green' }] }, /checks\[0\]\.check/],
      [{ type: 'unknown' } as never, /unknown message type/],
    ];
    for (const [m, expected] of invalid) await assert.rejects(b.orch.send(cycle, m, ADMIN.roles), expected, JSON.stringify(m));
    // Nothing was transmitted: W1 still waits at the gate, no approval, no message traced as ignored.
    await sleep(300);
    assert.equal(await p.state(cycle), 'gate_scoping_budget');
    assert.equal(await statusW1(cycle), 'PENDING');
    assert.equal((await b.orch.base.pool.query('SELECT 1 FROM approvals WHERE cycle_id = $1', [cycle])).rowCount, 0);
    assert.ok(!(await b.orch.base.cycleMessages(cycle)).some((m) => m.content.includes('ignored')));
    // A top-up only makes sense at budget gates (B4); at Gate 1, refused at the entry.
    const g1 = await p.createCycle('a5-gate1');
    await p.driveUntil(g1, 'gate_1');
    await assert.rejects(b.orch.send(g1, { type: 'decision', gate: 'gate_1', outcome: 'approved', actor_id: ADMIN.id, budget_top_up_usd: 5 }, hats({ type: 'decision', gate: 'gate_1', outcome: 'approved', actor_id: ADMIN.id, budget_top_up_usd: 5 })), /top-up meaningless/);
    // Requests.
    await assert.rejects(b.orch.newRequest({ type: 'creation', name: ' ', slug: 'x', owner_service: 's', need: 'Track the department vehicles' }, REQUESTER), /name/);
    await assert.rejects(b.orch.newRequest({ type: 'creation', name: 'X', slug: 'Not A Slug', owner_service: 's', need: 'Track the department vehicles' }, REQUESTER), /slug/);
    await assert.rejects(b.orch.newRequest({ type: 'evolution', tool_id: -1, need: 'Add a column' }, REQUESTER), /tool_id/);
    // I0: a request comes from an authenticated person with a hat; E1: their mail address must be known
    // (creation as well as evolution), otherwise no notification could go out.
    await assert.rejects(b.orch.newRequest({ type: 'creation', name: 'X', slug: 'x', owner_service: 's', need: 'Track the department vehicles' }, { id: REQUESTER.id, roles: [] }), (e: Error) => e instanceof AuthorizationError && /hat/.test(e.message));
    const noMail = (await b.orch.base.pool.query<{ id: string }>(`INSERT INTO actors (type, display_name) VALUES ('human', 'No Mail') RETURNING id`)).rows[0]!.id;
    await assert.rejects(b.orch.newRequest({ type: 'creation', name: 'X', slug: 'x', owner_service: 's', need: 'Track the department vehicles' }, { id: noMail, roles: ['requester'] }), /no mail address/);
    await assert.rejects(b.orch.newRequest({ type: 'evolution', tool_id: 1, need: 'Add a column' }, { id: noMail, roles: ['admin'] }), /no mail address/);
    assert.equal((await b.orch.base.pool.query(`SELECT 1 FROM tools WHERE slug = 'x'`)).rowCount, 0);
  });
});

// ── A6: sweep at startup ────────────────────────────────────────────────────────────────────────

test('A6: an open cycle without a workflow is launched at startup, the admin is told', { timeout: 60_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  await withBench(async (b) => {
    // Simulated stop between the creation of the cycle and the start of its workflow.
    cycle = (await b.orch.base.createRequest({ type: 'creation', name: 'Orphan', slug: 'a6-orphan', owner_service: 's', need: 'Track the department vehicles' }, REQUESTER.id, { scoping: 10, hardening: 20 })).cycle_id;
    assert.equal(await statusW1(cycle), undefined);
  }, url);
  await withBench(async (b, p) => {
    p.cycles.set('a6-orphan', cycle);
    await p.waitForState(cycle, 'overlap_search');
    assert.equal(await statusW1(cycle), 'PENDING');
    assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject.includes('launched again (no workflow)')));
  }, url);
});

test('A6 + B1: a dead workflow (ERROR) at the "prod blocked" gate is resumed at startup by an incident; retrying, then approving deploys to Prod the digest approved at Gate 2', { timeout: 120_000 }, async () => {
  const url = await freshDatabase();
  const candidate = `sha256:${'5'.repeat(64)}`;
  let cycle = 0;
  await withBench(async (b, p) => {
    cycle = await p.createCycle('a6-prod');
    await p.driveUntil(cycle, 'gate_prod_blocked', { ciDigest: candidate });
    assert.equal((await b.orch.base.pool.query(`SELECT digest FROM approvals WHERE cycle_id = $1 AND gate = 'gate_2'`, [cycle])).rows[0]?.digest, candidate);
  }, url);
  // The workflow dies during the stop (before D21, this happened on any error): ERROR status in the database. The
  // workflow's memory also carries a stale candidate digest: Prod must deploy the APPROVED digest, read from the
  // approvals, never the one from memory (D19, B1).
  const pool = new pg.Pool({ connectionString: url });
  await pool.query(`UPDATE dbos.workflow_status SET status = 'ERROR' WHERE workflow_uuid = $1`, [cycleWorkflowId(cycle)]);
  await unprotected(url, `UPDATE cycle_memory SET memory = jsonb_set(memory, '{candidateDigest}', to_jsonb($2::text)) WHERE cycle_id = $1`, [cycle, `sha256:${'6'.repeat(64)}`]);
  await pool.end();
  await withBench(async (b, p) => {
    p.cycles.set('a6-prod', cycle);
    await p.waitForState(cycle, 'gate_incident');
    assert.ok(b.notifications.for(cycle, 'admin').some((n) => n.subject.includes('workflow of cycle') && n.content.includes('gate_prod_blocked')));
    await p.wait('the W1 resumed from the start runs', async () => ((await statusW1(cycle)) === 'PENDING' ? true : undefined));
    await p.send(cycle, { type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id });
    await p.waitForState(cycle, 'gate_prod_blocked');
    b.deployer.switchboard.auto = async () => ({ type: 'ok' });
    await p.send(cycle, { type: 'decision', gate: 'gate_prod_blocked', outcome: 'approved', actor_id: ADMIN.id });
    await p.waitForState(cycle, 'end_success');
    assert.equal(b.deployer.running('prod', 'a6-prod'), candidate, 'the Prod serves the approved digest (read from the database, not from memory)');
  }, url);
});

// ── A7, A8 ──────────────────────────────────────────────────────────────────────────────────────

test('A7: a failing end cleanup is retried, then reported explicitly to the admin; the cycle stays finished', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    b.deployer.remove = async () => { throw new Error('CI VM unreachable: removal impossible'); };
    const cycle = await p.createCycle('a7-tool');
    await p.driveUntil(cycle, 'gate_overlap');
    await p.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'refused', actor_id: ADMIN.id });
    assert.equal(await p.waitForWorkflowEnd(cycle), 'SUCCESS');
    assert.equal(await p.state(cycle), 'end_refusal');
    const alert = b.notifications.for(cycle, 'admin').find((n) => n.subject.startsWith('Incomplete cleanup'));
    assert.ok(alert !== undefined, 'incomplete cleanup alert');
    assert.match(alert.content, /remove the mock-up: .*CI VM unreachable: removal impossible/);
    assert.ok(b.notifications.for(cycle, 'requester').some((n) => n.content.startsWith('End of cycle')), 'the other actions took place');
  });
});

test('A8: a zero or negative timeout, concurrency or number of attempts is refused at startup', () => {
  const base = { ...ENV_TEST, ORCH_DATABASE_URL: 'postgres://x' };
  for (const v of ['REMINDER_DELAY_MS', 'PAUSE_ARCHIVE_DELAY_MS', 'CI_MAX_TIMEOUT_MS', 'TASK_TIMEOUT_MS', 'LONG_WAIT_DELAY_MS', 'LONG_REMINDER_DELAY_MS', 'POLLING_INTERVAL_MS', 'AGENT_CONCURRENCY', 'STEP_ATTEMPTS', 'STEP_INTERVAL_MS']) {
    assert.throws(() => readConfig({ ...base, [v]: '0' }), new RegExp(`${v} invalid`), `${v} = 0`);
    assert.throws(() => readConfig({ ...base, [v]: '-5' }), new RegExp(`${v} invalid`), `${v} = -5`);
  }
});

// ── B: bugs ─────────────────────────────────────────────────────────────────────────────────────

test('B2: the scoping work duration does not count in the hardening one', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b2-tool');
    await p.driveUntil(cycle, 'waiting_scoping_feedback');
    await unprotected(b.orch.config.databaseUrl, `UPDATE tasks SET duration_s = 7200 WHERE cycle_id = $1 AND role = 'scoping'`, [cycle]);
    assert.equal(await b.orch.base.workDurationMin(cycle, 'hardening'), 0);
    assert.equal(await b.orch.base.workDurationMin(cycle, 'scoping'), 121); // 2 h of scoping + 1 min of overlap search
    await p.driveUntil(cycle, 'hardening_integration');
    assert.ok(!(await history(p, cycle)).some((h) => h.includes('gate_hardening_blocked')));
  });
});

test('B3: on cancellation, a task never started (queued) costs $0, a running task the cap', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b3-tool');
    // A-R2a: tests then builder never leave a task in the queue; the fan-out of the two reviewers does (N = 1).
    await p.driveUntil(cycle, 'hardening_review');
    await p.wait('one task in progress, one queued (N = 1)', async () => {
      const r = await b.orch.base.pool.query<{ status: string }>(`SELECT status FROM tasks WHERE cycle_id = $1 AND role IN ('security-reviewer','quality-reviewer') ORDER BY status`, [cycle]);
      return r.rows.map((x) => x.status).join(',') === 'in_progress,queued' ? true : undefined;
    });
    await p.send(cycle, { type: 'cancellation', actor_id: ADMIN.id });
    await p.waitForState(cycle, 'end_cancellation');
    const r = await b.orch.base.pool.query<{ cost: number; started: boolean }>(`SELECT cost_usd::float8 AS cost, started_at IS NOT NULL AS started FROM tasks WHERE cycle_id = $1 AND role IN ('security-reviewer','quality-reviewer')`, [cycle]);
    assert.deepEqual(r.rows.map((x) => `${x.started ? 'started' : 'queued'}:${x.cost}`).sort(), ['queued:0', 'started:10']);
  });
});

test('B4: a top-up at the "contract blocked" gate increases the hardening budget (phase of the gate), not the scoping one', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b4-tool');
    await p.driveUntil(cycle, 'gate_contract_blocked');
    await all(b);
    await p.send(cycle, { type: 'decision', gate: 'gate_contract_blocked', outcome: 'approved', actor_id: ADMIN.id, budget_top_up_usd: 5 });
    await p.waitForState(cycle, 'hardening_execution');
    const c = await b.orch.base.readCycle(cycle);
    assert.deepEqual([c.scoping_budget_usd, c.hardening_budget_usd], [10, 45]);
  });
});

test('B5: after a resume (DBOS replay), the instruction already passed on is not sent again to the next task', { timeout: 120_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  const instruction = 'Single instruction of Gate 1';
  await withBench(async (b, p) => {
    cycle = await p.createCycle('b5-tool');
    await p.driveUntil(cycle, 'gate_1');
    b.engine.switchboard.auto = undefined; // the round 2 tasks are waiting: we cut during this round
    await p.send(cycle, { type: 'decision', gate: 'gate_1', outcome: 'correction', actor_id: ADMIN.id, comment: instruction });
    const c = await b.orch.base.readCycle(cycle);
    await p.wait('tests task of round 2 launched with the instruction (first in the queue)', async () => (b.engine.calls(`${c.tool_id}-${c.id}-2-tests`)[0]?.context['instruction'] === instruction ? true : undefined));
  }, url);
  await withBench(async (b, p) => {
    p.cycles.set('b5-tool', cycle);
    await all(b);
    const c = await b.orch.base.readCycle(cycle);
    const reread = await p.wait('review of round 2', async () => b.engine.calls(`${c.tool_id}-${c.id}-2-security-reviewer`)[0]);
    assert.equal(reread.context['instruction'], undefined, 'the Gate 1 instruction leaked into the review after the replay');
  }, url);
});

test('B6: an invalid report from the builder runs again only the builder', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b6-tool');
    await p.driveUntil(cycle, 'hardening_execution');
    b.engine.switchboard.auto = async (_c, e) => (e.role === 'builder' && e.task_id.endsWith('-1-builder') ? { type: 'report', report: { free: 'outside the schema' } } : happyResponse(e));
    b.forge.switchboard.auto = async () => ({ type: 'ok' });
    await b.engine.switchboard.reconsider();
    const c = await b.orch.base.readCycle(cycle);
    await p.wait('round 2 launched', async () => ((await b.orch.base.cycleTasks(cycle, { iteration: 2 })).length > 0 ? true : undefined));
    await sleep(300);
    const roles = (await b.orch.base.cycleTasks(cycle, { iteration: 2, roles: ['tests', 'builder'] })).map((t) => t.role);
    assert.deepEqual(roles, ['builder']);
    assert.equal((await b.orch.base.pool.query(`SELECT 1 FROM deviations WHERE cycle_id = $1 AND iteration = 1 AND rule = 'report:builder'`, [c.id])).rowCount, 1);
  });
});

test('B8: the escalation reason of a red check is announced only once, in its telling form', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b8-tool');
    for (let i = 0; i < 3; i += 1) {
      await p.driveUntil(cycle, 'preview_pipeline');
      await p.sendWhenExpected(cycle, { type: 'preview_pipeline_finished', outcome: 'red', checks: [{ check: 'dast', result: 'red' }] });
    }
    await p.waitForState(cycle, 'gate_hardening_blocked');
    const n = (await adminNotification(b, p, cycle, /Decision required: gate_hardening_blocked/)).content;
    assert.equal(n.split('preview:dast').length - 1, 1, n);
    assert.match(n, /stagnation: check preview:dast red for 3 rounds/);
  });
});

test('3.7: a red acceptance job gives one deviation per failed test, passed on to the next round', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('a37-tool');
    await p.driveUntil(cycle, 'preview_pipeline');
    const failures = ['[chromium] › features/handle.feature.spec.js:12:7 › Handle › closes', 'SEC-ROLE DELETE /requests/{id} as reader → 403'];
    await p.sendWhenExpected(cycle, { type: 'preview_pipeline_finished', outcome: 'red', checks: [{ check: 'perf', result: 'green' }, { check: 'acceptance', result: 'red', details: { failures } }] });
    const c = await b.orch.base.readCycle(cycle);
    const lines = await p.wait('deviations of the Preview pipeline', async () => {
      const r = await b.orch.base.pool.query<{ rule: string; iteration: number }>(`SELECT rule, iteration FROM deviations WHERE cycle_id = $1 AND rule LIKE 'preview:%' ORDER BY rule`, [c.id]);
      return r.rowCount ? r.rows : undefined;
    });
    assert.deepEqual(lines.map((l) => l.rule), failures.map((e) => `preview:acceptance:${e}`).sort());
    const round = lines[0]!.iteration + 1;
    const call = await p.wait(`tests task of round ${round}`, async () => b.engine.calls(`${c.tool_id}-${c.id}-${round}-tests`)[0]);
    assert.deepEqual((call.context['deviations'] as { text: string }[]).map((e) => e.text).sort(), failures.map((e) => `preview:acceptance:${e}: red check`).sort());
  });
});

test('B9: a decision sent twice is applied only once, even when the cycle goes through the same gate again', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('b9-tool');
    await p.driveUntil(cycle, 'gate_scoping_budget');
    const d: Message = { type: 'decision', gate: 'gate_scoping_budget', outcome: 'approved', actor_id: ADMIN.id };
    // Double click: both are dropped off during the same pass (W1 held at the gate until the 2nd drop-off, otherwise the 2nd
    // would, depending on the machine's speed, already be refused at drop-off as pointless).
    const transition = b.orch.base.transition.bind(b.orch.base);
    let release!: () => void;
    const twoDropped = new Promise<void>((r) => { release = r; });
    b.orch.base.transition = async (id, from, ...rest) => { if (from === 'gate_scoping_budget') await twoDropped; return transition(id, from, ...rest); };
    assert.deepEqual(await b.orch.send(cycle, d, ADMIN.roles), { transmitted: true });
    assert.deepEqual(await b.orch.send(cycle, d, ADMIN.roles), { transmitted: true });
    release();
    // Without a top-up, the budget reopens the same gate at once (D12): new pass, where the duplicate is worth nothing any more.
    await p.wait('back to the gate', async () => ((await history(p, cycle)).includes('scoping --[guard:budget_exceeded]--> gate_scoping_budget') && (await history(p, cycle)).filter((h) => h.endsWith('--> gate_scoping_budget')).length >= 2 ? true : undefined));
    await sleep(800);
    assert.equal((await b.orch.base.pool.query('SELECT 1 FROM approvals WHERE cycle_id = $1', [cycle])).rowCount, 1);
    assert.equal(await p.state(cycle), 'gate_scoping_budget');
    assert.ok((await b.orch.base.cycleMessages(cycle)).some((m) => m.content.includes('earlier visit')), 'the duplicate is traced as ignored');
  });
});

test('C1: the overlap verdict is read in the verdict field, never in the summary', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    // A tool in the catalogue: a plausible verdict must name a tool that exists (otherwise "to be checked", scenario 2 ter).
    const existing = await p.createCycle('c1-existing');
    await p.driveUntil(existing, 'end_success');
    await p.waitForWorkflowEnd(existing);
    const plausible = await p.createCycle('c1-plausible');
    b.engine.answer('overlap', { type: 'report', report: (e: Omit<TaskInput, 'signal'>) => overlapReport(e.task_id, 'plausible', 'not_plausible at first sight, but c1-existing covers the need', 'c1-existing') });
    await p.waitForState(plausible, 'gate_overlap');
    assert.ok((await history(p, plausible)).includes('overlap_search --[guard:plausible]--> gate_overlap'));
  });
});

// ── 2nd review: every fix has its test (fails on 0d12670, passes here) ─────────────────────────

test('2nd round B1: a silent forge during the repository creation opens the planned gate (scoping blocked), never an endless wait', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-b1-forge');
    await p.driveUntil(cycle, 'repo_creation'); // the forge never answers
    await p.waitForState(cycle, 'gate_scoping_blocked', 20_000);
    assert.ok((await history(p, cycle)).includes('repo_creation --[task:failed]--> gate_scoping_blocked'));
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_scoping_blocked/)).content, /without an answer/);
  }, undefined, { OPERATION_TIMEOUT_MS: '2000' });
});

test('2nd round B1: a silent service called in a step (stopping the mock-up during the pause) leads to the incident, never to an endless wait', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    b.deployer.stop = () => new Promise(() => {}); // never answers
    const cycle = await p.createCycle('r2-b1-step');
    await p.driveUntil(cycle, 'scoping_pause');
    await p.waitForState(cycle, 'gate_incident', 20_000);
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_incident/)).content, /timed out after 1000ms/);
    assert.equal(await p.statusW1(cycle), 'PENDING');
  }, undefined, { OPERATION_TIMEOUT_MS: '1000' });
});

test('2nd round B5 + M5: a served digest different from the expected one is a failure (Preview: delivery blocked; Prod: prod blocked); in Prod, the digest really served is recorded, the Prod removed (creation) or restored (evolution), the admin alerted', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const other = `sha256:${'e'.repeat(64)}`;
    const fake = async () => ({ type: 'ok' as const, served: other });
    // Preview: the deployer (scriptable fake) serves an image other than the CI's.
    const preview = await p.createCycle('r2-b5-preview');
    await p.driveUntil(preview, 'preview_deployment');
    b.deployer.switchboard.auto = fake;
    await b.deployer.switchboard.reconsider();
    await p.waitForState(preview, 'gate_delivery_blocked');
    assert.ok((await history(p, preview)).includes('preview_deployment --[task:failed]--> gate_delivery_blocked'));
    assert.match((await adminNotification(b, p, preview, /Decision required: gate_delivery_blocked/)).content, /different from the expected digest/);
    assert.equal(await b.orch.base.candidateDigest(preview), null, 'no candidate digest: the last Preview deployment failed');
    // Prod of a creation: the other image is recorded as is (failed), then removed; alert.
    b.deployer.switchboard.auto = undefined;
    const creation = await p.createCycle('r2-b5-prod');
    await p.driveUntil(creation, 'prod_deployment');
    b.deployer.switchboard.auto = fake;
    await b.deployer.switchboard.reconsider();
    await p.waitForState(creation, 'gate_prod_blocked');
    assert.ok(!(await history(p, creation)).some((h) => h.endsWith('end_success')));
    const prod = await b.orch.base.pool.query<{ health: string; digest: string }>(`SELECT health, digest FROM deployments WHERE cycle_id = $1 AND environment = 'prod'`, [creation]);
    assert.deepEqual(prod.rows, [{ health: 'failed', digest: other }], 'digest REALLY served recorded');
    assert.equal(b.deployer.running('prod', 'r2-b5-prod'), null, 'Prod removed');
    assert.ok((await history(p, creation)).includes('prod_deployment --[cleanup:prod_removed]--> prod_deployment'));
    assert.ok(b.notifications.for(creation, 'admin').some((n) => n.subject.startsWith('Alert: the Prod of r2-b5-prod served another digest')));
    assert.match((await adminNotification(b, p, creation, /Decision required: gate_prod_blocked/)).content, /different from the expected digest.*Prod removed/s);
    // Prod of an evolution: back to the last healthy digest in Prod.
    b.deployer.switchboard.auto = undefined;
    const tool = await p.createCycle('r2-b5-evolution');
    await p.driveUntil(tool, 'end_success');
    await p.waitForWorkflowEnd(tool);
    const healthy = b.deployer.running('prod', 'r2-b5-evolution')!;
    const evolution = await p.createCycle('r2-b5-evolution', 'evolution', (await b.orch.base.readCycle(tool)).tool_id);
    await p.driveUntil(evolution, 'prod_deployment', { timeoutMs: 60_000 });
    let calls = 0;
    b.deployer.switchboard.auto = async () => (++calls === 1 ? { type: 'ok' as const, served: other } : { type: 'ok' as const });
    await b.deployer.switchboard.reconsider();
    await p.waitForState(evolution, 'gate_prod_blocked');
    assert.equal(b.deployer.running('prod', 'r2-b5-evolution'), healthy, 'Prod restored to the last healthy digest');
    assert.ok((await history(p, evolution)).includes('prod_deployment --[cleanup:prod_restored]--> prod_deployment'));
    assert.match((await adminNotification(b, p, evolution, /Decision required: gate_prod_blocked/)).content, /Prod restored to the last healthy digest/);
    assert.equal(await b.orch.base.lastHealthyProd((await b.orch.base.readCycle(evolution)).tool_id), healthy, 'the healthy reference stays the earlier one');
  });
});

test('2nd round B6: cancellation during the Prod deployment of a creation → Prod removed and traced; the Preview is removed at any end, success included', { timeout: 90_000 }, async () => {
  await withBench(async (b, p) => {
    const deploy = b.deployer.deploy.bind(b.deployer);
    // Prod starts (container running) then the health check drags on: the admin cancels in between.
    b.deployer.deploy = async (env, slug, cy, emp, s) => {
      if (env !== 'prod') return deploy(env, slug, cy, emp, s);
      b.deployer.active.set(`prod:${slug}`, { digest: emp!, state: 'running', cycle: cy });
      return new Promise((_, reject) => s?.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    };
    const cycle = await p.createCycle('r2-b6');
    await p.driveUntil(cycle, 'prod_deployment');
    await p.wait('Prod running', async () => (b.deployer.running('prod', 'r2-b6') !== null ? true : undefined));
    await p.send(cycle, { type: 'cancellation', actor_id: ADMIN.id });
    await p.waitForWorkflowEnd(cycle);
    assert.equal(await p.state(cycle), 'end_cancellation');
    assert.equal(b.deployer.running('prod', 'r2-b6'), null, 'Prod removed');
    assert.equal(b.deployer.running('preview', 'r2-b6'), null, 'Preview removed');
    assert.ok((await history(p, cycle)).includes('end_cancellation --[cleanup:prod_removed]--> end_cancellation'), 'removal traced');
    b.deployer.deploy = deploy;
    const success = await p.createCycle('r2-b6-success');
    await p.driveUntil(success, 'end_success');
    await p.waitForWorkflowEnd(success);
    assert.equal(b.deployer.running('preview', 'r2-b6-success'), null, 'Preview removed after the success');
    assert.notEqual(b.deployer.running('prod', 'r2-b6-success'), null, 'the Prod of a success stays');
  });
});

test('real cost: a failed task is charged the cost its engine reported; nothing before its container started; the cap only for a launch cut short, said in the record', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const execute = b.engine.execute.bind(b.engine);
    const contractTask = async (slug: string, patch?: (i: TaskInput) => Promise<never>) => {
      b.engine.execute = async (i) => (i.role === 'contract' && patch !== undefined ? patch(i) : execute(i));
      const cycle = await p.createCycle(slug);
      await p.driveUntil(cycle, patch === undefined ? 'contract' : 'gate_contract_blocked');
      if (patch === undefined) {
        b.engine.answer('contract', { type: 'failed', reason: 'Claude Code stopped: budget cap reached', cost_usd: 1.25 });
        await p.waitForState(cycle, 'gate_contract_blocked');
      }
      const c = await b.orch.base.readCycle(cycle);
      const t = (await b.orch.base.pool.query<{ status: string; cost: number; executions: number; reason: string }>(
        `SELECT status, cost_usd::float8 AS cost, executions, report ->> 'reason' AS reason FROM tasks WHERE id = $1`, [`${c.tool_id}-${c.id}-1-contract`])).rows[0];
      return t;
    };
    // Known cost (the engine read it in Claude Code's result): charged as is, no forfeit.
    assert.deepEqual(await contractTask('cost-known'), { status: 'failed', cost: 1.25, executions: 1, reason: 'Claude Code stopped: budget cap reached' });
    // Infrastructure failure before the container (clone, signature…): no model ran, nothing charged.
    assert.deepEqual(await contractTask('cost-before-launch', async () => { throw new Error('clone: forge unreachable'); }),
      { status: 'failed', cost: 0, executions: 0, reason: 'clone: forge unreachable' });
    // Container started then lost without a result: the cost is unknown, the cap stands in for it and the record says so.
    assert.deepEqual(await contractTask('cost-cut-short', async (i) => { await i.launched(); throw new Error('container stopped before the end (code 137)'); }),
      { status: 'failed', cost: 10, executions: 1, reason: 'container stopped before the end (code 137) (cost unknown: 1 execution(s) cut short without a reported cost, each charged the role\'s cap of $10)' });
  });
});

test('2nd round B7: an undeclared cost (null) counts the task\'s cap', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-b7');
    await p.driveUntil(cycle, 'contract');
    b.engine.answer('contract', { type: 'report', report: (e: Omit<TaskInput, 'signal'>) => compliantReport('contract', e.task_id), cost_usd: null });
    await p.waitForState(cycle, 'hardening_execution');
    const c = await b.orch.base.readCycle(cycle);
    assert.equal((await b.orch.base.readTask(`${c.tool_id}-${c.id}-1-contract`)).cost_usd, 10);
  });
});

test('2nd round B8: a write retried after it succeeded (deployment, CI results) writes nothing twice', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const base = b.orch.base;
    const writeDeployment = base.writeDeployment.bind(base);
    const writeResults = base.writePipelineResults.bind(base);
    let outages = 0;
    // The write succeeds, then the connection drops before the response: the step is retried.
    base.writeDeployment = async (...a) => { await writeDeployment(...a); if (a[1] === 'preview' && outages < 1) { outages += 1; throw new Error('Connection terminated unexpectedly'); } };
    base.writePipelineResults = async (...a) => { await writeResults(...a); if (outages < 2) { outages += 1; throw new Error('Connection terminated unexpectedly'); } };
    const cycle = await p.createCycle('r2-b8');
    await p.driveUntil(cycle, 'waiting_preview_feedback');
    assert.equal(outages, 2);
    const n = async (sql: string) => (await base.pool.query(sql, [cycle])).rowCount;
    assert.equal(await n(`SELECT 1 FROM deployments WHERE cycle_id = $1 AND environment = 'preview'`), 1);
    assert.equal(await n(`SELECT 1 FROM pipeline_results WHERE cycle_id = $1 AND pipeline = 'ci'`), 3);
  });
});

test('2nd round C: name with a line break, task timeout beyond the timer, Gate 2 without a cited digest: refused at the entry', { timeout: 60_000 }, async () => {
  assert.throws(() => readConfig({ ...ENV_TEST, ORCH_DATABASE_URL: 'postgres://x', TASK_TIMEOUT_MS: String(2 ** 31) }), /TASK_TIMEOUT_MS invalid/);
  assert.equal(readConfig({ ...ENV_TEST, ORCH_DATABASE_URL: 'postgres://x', TASK_TIMEOUT_MS: String(2 ** 31 - 1) }).timeouts.task_ms, 2 ** 31 - 1);
  await withBench(async (b, p) => {
    await assert.rejects(b.orch.newRequest({ type: 'creation', name: 'Tool\r\nBcc: all@example.test', slug: 'r2-c-name', owner_service: 's', need: 'Track the department vehicles' }, REQUESTER), /name: line breaks/);
    const cycle = await p.createCycle('r2-c-gate2');
    await p.driveUntil(cycle, 'gate_2');
    await assert.rejects(b.orch.send(cycle, { type: 'decision', gate: 'gate_2', outcome: 'approved', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_2', outcome: 'approved', actor_id: ADMIN.id })), /the approved digest must be cited/);
    await assert.rejects(b.orch.send(cycle, { type: 'decision', gate: 'gate_1', outcome: 'scope_change', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_1', outcome: 'scope_change', actor_id: ADMIN.id })), /comment required for scope_change/);
    assert.equal(await p.state(cycle), 'gate_2');
  });
});

test('2nd round C: a message that became irrelevant during the send is reported to the caller and never applied, even when the W1 has already finished', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-c-send');
    await p.driveUntil(cycle, 'gate_overlap');
    // Between the check of `approved` and its drop-off, another admin refuses: the cycle leaves the gate, and (worst case,
    // that of a loaded machine) its W1 has finished normally before the drop-off. It is not "dead" for all that.
    const retain = b.orch.base.retainCycle.bind(b.orch.base);
    let concurrent = false;
    b.orch.base.retainCycle = async (id, fn) => {
      if (!concurrent) {
        concurrent = true;
        await b.orch.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'refused', actor_id: ADMIN.id }, ADMIN.roles);
        await p.waitForState(cycle, 'end_refusal');
        assert.equal(await p.waitForWorkflowEnd(cycle), 'SUCCESS');
      }
      return retain(id, fn);
    };
    const r = await b.orch.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'approved', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_overlap', outcome: 'approved', actor_id: ADMIN.id }));
    assert.deepEqual(r, { transmitted: false, reason: `cycle ${cycle} went from gate_overlap to end_refusal during the send: message decision no longer relevant` });
    assert.equal(await p.mailboxEmpty(cycle), true, 'nothing dropped off');
    assert.deepEqual((await b.orch.base.pool.query(`SELECT decision FROM approvals WHERE cycle_id = $1`, [cycle])).rows, [{ decision: 'refused' }]);
  });
});

test('2nd round C: the cycle stays in the targeted visit until the end of the drop-off; a message consumed at once is "transmitted", never "no longer relevant"', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-c-consumed');
    await p.driveUntil(cycle, 'gate_overlap');
    // Right after the drop-off, before handing back to `send`, we let W1 read the decision and attempt its transition:
    // it must wait for the cycle lock (otherwise `send` would check a pass that W1 has already left).
    const send = DBOS.send.bind(DBOS);
    let stateDuringDrop = '';
    DBOS.send = (async (...a: unknown[]) => {
      await (send as (...x: unknown[]) => Promise<void>)(...a);
      await p.wait('W1 read the decision and its transition went through or waits for the cycle lock', async () => {
        if ((await history(p, cycle)).includes('gate_overlap --[gate:approved]--> repo_creation')) return true;
        const wait = await b.orch.base.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
        return (wait.rowCount ?? 0) > 0 ? true : undefined;
      });
      stateDuringDrop = await p.state(cycle);
    }) as typeof DBOS.send;
    let r;
    try {
      r = await b.orch.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'approved', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_overlap', outcome: 'approved', actor_id: ADMIN.id }));
    } finally {
      DBOS.send = send;
    }
    assert.equal(stateDuringDrop, 'gate_overlap', 'no transition during the drop-off');
    assert.deepEqual(r, { transmitted: true });
    await p.wait('decision applied', async () => ((await history(p, cycle)).includes('gate_overlap --[gate:approved]--> repo_creation') ? true : undefined));
  });
});

test('2nd round C: the admin\'s clarification goes only to the first scoping, then it is cleared', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-c-clarification');
    await p.driveUntil(cycle, 'gate_overlap');
    await p.send(cycle, { type: 'decision', gate: 'gate_overlap', outcome: 'correction', actor_id: ADMIN.id, comment: 'Do not duplicate car-fleet' });
    await p.driveUntil(cycle, 'waiting_scoping_feedback');
    await p.sendWhenExpected(cycle, { type: 'scoping_feedback', outcome: 'correction', text: 'Add sorting', actor_id: REQUESTER.id });
    const c = await b.orch.base.readCycle(cycle);
    const second = await p.wait('second scoping', async () => b.engine.calls(`${c.tool_id}-${c.id}-2-scoping`)[0]);
    assert.equal((b.engine.calls(`${c.tool_id}-${c.id}-1-scoping`)[0]!.context['data'] as Record<string, unknown>)['admin_clarification'], 'Do not duplicate car-fleet');
    assert.deepEqual(second.context['data'], {});
  });
});

test('2nd round C: the invalid report of a reviewer runs again only that reviewer, no code role', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('r2-c-reviewer');
    await p.driveUntil(cycle, 'hardening_review');
    b.engine.switchboard.auto = async (_c, e) => (e.role === 'quality-reviewer' && e.task_id.endsWith('-1-quality-reviewer') ? { type: 'report', report: { free: 'outside the schema' } } : happyResponse(e));
    b.forge.switchboard.auto = async () => ({ type: 'ok' });
    await b.engine.switchboard.reconsider();
    await p.wait('round 2 reviewed, then compliant', async () => ((await history(p, cycle)).includes('hardening_evaluation --[guard:compliant]--> merge') ? true : undefined));
    const round2 = (await b.orch.base.cycleTasks(cycle, { iteration: 2 })).map((t) => `${t.role}:${t.status}`);
    assert.deepEqual(round2, ['quality-reviewer:done'], 'only the reviewer with the invalid report is run again');
    assert.equal((await b.orch.base.readMemory(cycle)).reviewOnly, null);
  });
});

test('2nd round D2 + S4: the end of a task wakes W1 at once (native wait for the result of W2), without waiting for the task timeout', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    b.engine.switchboard.auto = async (_c, e) => happyResponse(e);
    const cycle = await p.createCycle('r2-d2-message');
    const c = await b.orch.base.readCycle(cycle);
    const id = `${c.tool_id}-${c.id}-1-overlap`;
    await p.wait('task finished', async () => ((await taskOrNothing(b, id))?.status === 'done' ? true : undefined));
    const end = Date.now();
    // TASK_TIMEOUT_MS is 60 s here: only the native wait for the end of W2 can wake W1 in time.
    await p.waitForState(cycle, 'repo_creation', 5_000);
    assert.ok(Date.now() - end < 5_000);
  }, undefined, { TASK_TIMEOUT_MS: '60000' });
});

// ── 3rd round────────────────────────────────────────────────────────────────────────────────────

test('3rd round G3: failure, then success of the Preview deployment in the same visit → the candidate digest is the one of the last healthy deployment really done', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('g3-same-visit');
    await p.driveUntil(cycle, 'waiting_preview_feedback');
    const e1 = p.digests.get(cycle);
    await p.sendWhenExpected(cycle, { type: 'preview_feedback', outcome: 'bug', text: 'the sorting by date is wrong', actor_id: REQUESTER.id });
    await p.driveUntil(cycle, 'preview_deployment', { timeoutMs: 60_000 });
    const e2 = p.digests.get(cycle);
    assert.notEqual(e1, e2);
    // The database refuses the exit from preview_deployment then the recording of the incident: the state is handled again
    // within the same pass.
    let refusal = 0;
    const transition = b.orch.base.transition.bind(b.orch.base);
    b.orch.base.transition = async (id, from, decl, to, ...rest) => {
      if (id === cycle && from === 'preview_deployment' && refusal < 2) { refusal += 1; throw Object.assign(new Error(`simulated fault (${decl})`), { code: 'P0001' }); }
      return transition(id, from, decl, to, ...rest);
    };
    let attempts = 0;
    b.deployer.switchboard.auto = async () => (++attempts === 1 ? { type: 'failed', reason: 'health KO at the 1st try' } : { type: 'ok' });
    await b.deployer.switchboard.reconsider();
    await p.waitForState(cycle, 'preview_pipeline', 30_000); // S5: the healthy Preview goes to the pipeline first, the requester is not notified yet
    assert.equal(refusal, 2);
    assert.equal(b.deployer.running('preview', 'g3-same-visit'), e2);
    assert.equal(await b.orch.base.candidateDigest(cycle), e2, 'candidate digest = the one really served, never the rejected version');
    const lines = (await b.orch.base.pool.query<{ health: string; digest: string }>(`SELECT health, digest FROM deployments WHERE cycle_id = $1 AND environment = 'preview' ORDER BY id`, [cycle])).rows;
    assert.deepEqual(lines.slice(-2), [{ health: 'failed', digest: e2 }, { health: 'ok', digest: e2 }], 'one row per attempted deployment');
    // Gate 2 presents and accepts only E2.
    b.orch.base.transition = transition;
    await p.driveUntil(cycle, 'gate_2', { timeoutMs: 60_000 });
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_2/)).content, new RegExp(`Digest ${e2}`));
    await assert.rejects(b.orch.send(cycle, { type: 'decision', gate: 'gate_2', outcome: 'approved', actor_id: ADMIN.id, digest: e1! }, hats({ type: 'decision', gate: 'gate_2', outcome: 'approved', actor_id: ADMIN.id, digest: e1! })), /refused: the candidate digest of Gate 2 is/);
  }, undefined, { MONITORING_CRON: '0 0 0 1 1 *' });
});

test('3rd round G5: a resume of the dead workflow (incident, then "retry") does not reset the pause deadline', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('g5-pause');
    await p.driveUntil(cycle, 'scoping_pause');
    const input = (await p.history(cycle)).filter((h) => h.state === 'scoping_pause' && h.previous_state !== 'scoping_pause')[0]!.t;
    await sleep(4000); // half of the deadline (8 s) has elapsed
    const wf = await p.workflowW1(cycle);
    await DBOS.cancelWorkflow(wf);
    await p.wait('cancelled', async () => ((await DBOS.getWorkflowStatus(wf))?.status === 'CANCELLED' ? true : undefined));
    await b.orch.sweep();
    await p.waitForState(cycle, 'gate_incident');
    await p.sendWhenExpected(cycle, { type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id });
    await p.waitForState(cycle, 'end_abandonment', 30_000);
    const archive = (await p.history(cycle)).find((h) => h.state === 'end_abandonment')!;
    assert.equal(archive.trigger, 'timeout_exceeded');
    assert.ok(archive.t - input < 8000 + 2500, `archiving ${Math.round(archive.t - input)} ms after the FIRST entry into the pause (deadline 8000 ms)`);
  }, undefined, { PAUSE_ARCHIVE_DELAY_MS: '8000', MONITORING_CRON: '0 0 0 1 1 *' });
});

test('3rd round G5: reminders already sent at a gate kept after a resume of the dead workflow, even between the notification and its trace (never more than 3)', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    // Worst moment, made deterministic: W1 dies after notifying the 2nd reminder, before writing its trace (the race
    // that made this test fail one time in ten in parallel: 4 reminders, the 2nd sent again by the resumed W1).
    const remind = b.orch.base.remind.bind(b.orch.base);
    let release!: () => void;
    const outage = new Promise<void>((r) => { release = r; });
    let held = false;
    b.orch.base.remind = async (id, state, visit, already) => {
      if (already === 1 && !held) { held = true; await outage; throw new Error('Connection terminated unexpectedly'); }
      return remind(id, state, visit, already);
    };
    try {
      const cycle = await p.createCycle('g5-reminders');
      await p.driveUntil(cycle, 'gate_overlap');
      const reminders = () => b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Reminder') && n.subject.includes('gate_overlap')).map((n) => n.subject.slice(0, 'Reminder 1/3'.length));
      const traces = async () => (await p.history(cycle)).filter((h) => h.state === 'gate_overlap' && h.previous_state === 'gate_overlap' && h.trigger === 'timeout_exceeded').length;
      await p.wait('2nd reminder notified, its trace held back', async () => (reminders().length === 2 && held ? true : undefined), 10_000);
      const wf = await p.workflowW1(cycle);
      await DBOS.cancelWorkflow(wf);
      await p.wait('cancelled', async () => ((await DBOS.getWorkflowStatus(wf))?.status === 'CANCELLED' ? true : undefined));
      assert.equal(await traces(), 1); // the cancelled run stays suspended in its trace until the end of the test
      await b.orch.sweep();
      await p.waitForState(cycle, 'gate_incident');
      await b.orch.send(cycle, { type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id }));
      await p.waitForState(cycle, 'gate_overlap');
      await p.wait('3 traces', async () => ((await traces()) === 3 ? true : undefined), 15_000);
      assert.deepEqual(reminders(), ['Reminder 1/3', 'Reminder 2/3', 'Reminder 3/3'], 'the 2nd sent again under the same key (a single send), then only the 3rd');
    } finally {
      release();
    }
  }, undefined, { REMINDER_DELAY_MS: '1200', LONG_WAIT_DELAY_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
});

test('Reminder to the requester: a W1 resumed between writing the reminder and its trace does not write it twice in the chat', { timeout: 120_000 }, async () => {
  await withBench(async (b, p) => {
    // Same worst moment as G5, on the requester's side: the 2nd reminder is written in the chat and notified, its trace held
    // back, then W1 dies and is repaired: it sends the reminder again (never lost) under the same key, hence a single message.
    const remind = b.orch.base.remind.bind(b.orch.base);
    let release!: () => void;
    const outage = new Promise<void>((r) => { release = r; });
    let held = false;
    b.orch.base.remind = async (id, state, visit, already) => {
      if (already === 1 && !held) { held = true; await outage; throw new Error('Connection terminated unexpectedly'); }
      return remind(id, state, visit, already);
    };
    try {
      const cycle = await p.createCycle('reminders-chat');
      await p.driveUntil(cycle, 'waiting_scoping_feedback');
      const inTheChat = async () => (await b.orch.base.cycleMessages(cycle)).filter((m) => m.author_type === 'orchestrator' && m.content.startsWith('Reminder')).map((m) => m.content.slice(0, 'Reminder 1/3'.length));
      const traces = async () => (await p.history(cycle)).filter((h) => h.state === 'waiting_scoping_feedback' && h.previous_state === 'waiting_scoping_feedback' && h.trigger === 'timeout_exceeded').length;
      await p.wait('2nd reminder written, its trace held back', async () => ((await inTheChat()).length === 2 && held ? true : undefined), 10_000);
      const wf = await p.workflowW1(cycle);
      await DBOS.cancelWorkflow(wf);
      await p.wait('cancelled', async () => ((await DBOS.getWorkflowStatus(wf))?.status === 'CANCELLED' ? true : undefined));
      await b.orch.sweep();
      await p.waitForState(cycle, 'gate_incident');
      await b.orch.send(cycle, { type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id }, hats({ type: 'decision', gate: 'gate_incident', outcome: 'approved', actor_id: ADMIN.id }));
      await p.waitForState(cycle, 'waiting_scoping_feedback');
      await p.wait('3 traces', async () => ((await traces()) === 3 ? true : undefined), 15_000);
      assert.deepEqual(await inTheChat(), ['Reminder 1/3', 'Reminder 2/3', 'Reminder 3/3'], 'the 2nd reminder sent again under the same key: a single message in the chat');
    } finally {
      release();
    }
  }, undefined, { REMINDER_DELAY_MS: '1200', LONG_WAIT_DELAY_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
});

test('3rd round M4: a task cancelled after a resume is charged at the cap per uncounted execution', { timeout: 120_000 }, async () => {
  const url = await freshDatabase();
  let cycle = 0;
  let task = '';
  await withBench(async (b, p) => {
    cycle = await p.createCycle('m4-executions');
    const c = await b.orch.base.readCycle(cycle);
    task = `${c.tool_id}-${c.id}-1-overlap`;
    await p.wait('overlap in progress', async () => (b.engine.inProgress().includes(task) ? true : undefined));
  }, url, { TASK_TIMEOUT_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
  await withBench(async (b, p) => {
    p.cycles.set('m4-executions', cycle);
    // DBOS resumes W2: the cut-off run is replayed (2nd run of the engine), then the admin cancels.
    await p.wait('2nd execution', async () => ((await b.orch.base.pool.query<{ n: number }>('SELECT executions AS n FROM tasks WHERE id = $1', [task])).rows[0]?.n === 2 ? true : undefined));
    await p.wait('engine called', async () => (b.engine.inProgress().includes(task) ? true : undefined));
    await b.orch.send(cycle, { type: 'cancellation', actor_id: ADMIN.id }, hats({ type: 'cancellation', actor_id: ADMIN.id }));
    await p.waitForState(cycle, 'end_cancellation');
    const t = await b.orch.base.readTask(task);
    assert.deepEqual([t.status, t.cost_usd], ['failed', 8], '2 executions never counted = 2 × $4 (cap of the scoping role)');
  }, url, { TASK_TIMEOUT_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
});

test('3rd round M6: the trace of a reminder retried after it succeeded is not doubled (3 reminders, not one fewer)', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const remind = b.orch.base.remind.bind(b.orch.base);
    let outages = 0;
    // The trace is written, then the connection drops before the response: the step is retried.
    b.orch.base.remind = async (...a) => { const r = await remind(...a); if (outages < 1) { outages += 1; throw new Error('Connection terminated unexpectedly'); } return r; };
    const cycle = await p.createCycle('m6-reminder');
    await p.driveUntil(cycle, 'gate_overlap');
    const reminders = () => b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Reminder')).map((n) => n.subject.slice(0, 'Reminder 1/3'.length));
    await p.wait('3 reminders', async () => (reminders().length >= 3 ? true : undefined), 10_000);
    await sleep(1500);
    assert.equal(outages, 1);
    assert.deepEqual(reminders(), ['Reminder 1/3', 'Reminder 2/3', 'Reminder 3/3']);
    assert.equal((await p.history(cycle)).filter((h) => h.trigger === 'timeout_exceeded').length, 3);
  }, undefined, { REMINDER_DELAY_MS: '300', LONG_WAIT_DELAY_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
});

test('3rd round M9: a notification whose attempt exceeds its timeout but succeeds in the background, then is retried, is sent only once', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const notify = b.notifications.notify.bind(b.notifications);
    let slow = true;
    b.notifications.notify = async (d, id, subject, content, key) => {
      if (slow && subject.startsWith('Decision required: gate_overlap')) { slow = false; await sleep(1500); }
      return notify(d, id, subject, content, key);
    };
    const cycle = await p.createCycle('m9-notification');
    await p.driveUntil(cycle, 'gate_overlap');
    await sleep(2500); // the 1st attempt (given up at 800 ms) succeeds at 1.5 s, after the retry
    assert.equal(slow, false);
    assert.equal(b.notifications.for(cycle, 'admin').filter((n) => n.subject.startsWith('Decision required: gate_overlap')).length, 1);
  }, undefined, { OPERATION_TIMEOUT_MS: '800', REMINDER_DELAY_MS: '60000', MONITORING_CRON: '0 0 0 1 1 *' });
});

// ── S4: error boundary during the native wait for the tasks ──────────────────────────────────────

test('S4 + D21: an internal error while W1 waits for its tasks opens the incident and stops the tasks (started: cap, queued: $0)', { timeout: 60_000 }, async () => {
  await withBench(async (b, p) => {
    const cycle = await p.createCycle('s4-incident');
    const c = await b.orch.base.readCycle(cycle);
    const first = `${c.tool_id}-${c.id}-1-security-reviewer`;
    const waitAll = DBOS.waitAll.bind(DBOS);
    // The native wait of the review fails (database unreachable) once the first reviewer has started, the second queued
    // (N = 1); A-R2a: hardening waits for tests then builder one at a time, only the reviewers' fan-out has two tasks.
    DBOS.waitAll = (async (h: Parameters<typeof waitAll>[0], o?: Parameters<typeof waitAll>[1]) => {
      if (DBOS.workflowID === cycleWorkflowId(cycle) && h.length === 2) {
        await p.wait('security-reviewer started', async () => (b.engine.inProgress().includes(first) ? true : undefined));
        throw new Error('simulated fault: database unavailable during the wait');
      }
      return waitAll(h, o);
    }) as typeof DBOS.waitAll;
    try {
      await p.driveUntil(cycle, 'hardening_review');
      await p.waitForState(cycle, 'gate_incident');
    } finally {
      DBOS.waitAll = waitAll;
    }
    assert.match((await adminNotification(b, p, cycle, /Decision required: gate_incident/)).content, /simulated fault: database unavailable during the wait/);
    await p.wait('container stopped', async () => (b.engine.inProgress().includes(first) ? undefined : true));
    const r = await b.orch.base.pool.query<{ role: string; status: string; cost: number }>(`SELECT role, status, cost_usd::float8 AS cost FROM tasks WHERE cycle_id = $1 AND iteration = 1 AND role IN ('security-reviewer','quality-reviewer') ORDER BY role`, [cycle]);
    assert.deepEqual(r.rows.map((x) => `${x.role}:${x.status}:${x.cost}`), ['quality-reviewer:failed:0', 'security-reviewer:failed:10']);
    for (const role of ['security-reviewer', 'quality-reviewer']) {
      assert.equal((await DBOS.getWorkflowStatus(taskWorkflowId(`${c.tool_id}-${c.id}-1-${role}`)))?.status, 'CANCELLED', `W2 ${role} stopped`);
    }
  }, undefined, { MONITORING_CRON: '0 0 0 1 1 *' });
});
