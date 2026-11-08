// Then steps: everything is checked in the business database or in the logs of the fakes, by active
// waiting (the workflow works in the background); an absence is checked after a short delay.
import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { Role } from '../../src/external/contracts.ts';
import { HARDENING_ROLES, hardeningCounters } from '../../src/workflows/toolCycle.ts';
import { ENV_TEST } from '../../tests/helpers/bench.ts';
import { DEFAULT_THRESHOLDS, type StateId } from '../../src/machine/states.ts';
import { World, DEFAULT_SLUG } from '../support/world.ts';

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
/**
 * Observation window of an ABSENCE (no 4th reminder, no task, no CI): longer than the longest delay
 * that could produce it (long wait + one reminder), otherwise the test would see nothing and pass wrongly (D2).
 */
const WINDOW_MS = Number(ENV_TEST['LONG_WAIT_DELAY_MS']) + Number(ENV_TEST['REMINDER_DELAY_MS']) + 400;

// ── Transitions and states ──────────────────────────────────────────────────────────────────────

Then('the cycle moves from {string} to {string} by {string}', async function (this: World, from: string, to: string, trigger: string) {
  await this.transition(from, trigger, to);
});
Then('the cycle stays in state {string} by {string}', async function (this: World, e: string, trigger: string) {
  await this.transition(e, trigger, e);
});
Then('the cycle is in state {string}', async function (this: World, e: string) {
  // The state alone is not enough: a message sent just before may not be read yet. We wait until the workflow has
  // emptied its mailbox (message handled or discarded) in this state (D2).
  const end = e.startsWith('end_'); // an ended workflow no longer reads its mailbox
  await this.wait(`state ${e}, workflow mailbox empty`, async () => ((await this.pilot.state(this.cycleId)) === e && (end || (await this.pilot.mailboxEmpty(this.cycleId))) ? true : undefined), 3_000);
});
// D-E5: the names the Gate 1 page shows for the core-tools.yml entry, as the engine read them from main on entering the gate.
Then('the Gate 1 page lists roles {string} and retention periods {string} for the core-tools.yml entry', async function (this: World, roles: string, retentions: string) {
  const split = (s: string) => s.split(',').map((x) => x.trim());
  assert.deepEqual((await this.base.readMemory(this.cycleId)).registration, { roles: split(roles), retentions: split(retentions) });
});
Then('the cycle is not in state {string}', async function (this: World, e: string) {
  await this.letThrough();
  assert.notEqual(await this.pilot.state(this.cycleId), e);
});
Then('the cycle has not passed through state {string}', async function (this: World, e: string) {
  await this.letThrough();
  const cursor = this.cursors.get(this.cycleId) ?? 0;
  assert.ok(!(await this.pilot.history(this.cycleId)).some((h) => h.id > cursor && h.state === e), `the cycle went through ${e}`);
});
Then('message {string} is handled as scoping feedback {string}', async function (this: World, text: string, outcome: string) {
  // The "correction" feedback is recognised by its two effects: the transition event:scoping_feedback:<outcome> on behalf of
  // the requester, and the next scoping task that receives the message as an instruction.
  const cursor = this.cursors.get(this.cycleId) ?? 0;
  await this.wait(`transition event:scoping_feedback:${outcome}`, async () => (await this.pilot.history(this.cycleId)).some((h) => h.id > cursor && h.trigger === `event:scoping_feedback:${outcome}` && h.actor !== 'orchestrator'));
  const c = await this.cycle();
  await this.wait(`scoping task with the instruction "${text}"`, async () => this.bench.engine.switchboard.log.some((j) => j.input.role === 'scoping' && j.input.task_id.startsWith(`${c.tool_id}-${c.id}-`) && j.input.context['instruction'] === text));
});

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────────

async function tasks(this: World, filter: { role?: string; iteration?: number; step?: string }) {
  const r = await this.base.pool.query(
    `SELECT id, role, iteration, status, step, cost_usd::float8 AS cost_usd, duration_s, tree_hash, report FROM tasks WHERE cycle_id = $1
     AND ($2::text IS NULL OR role = $2) AND ($3::int IS NULL OR iteration = $3) AND ($4::text IS NULL OR step = $4) ORDER BY created_at, id`,
    [this.cycleId, filter.role ?? null, filter.iteration ?? null, filter.step ?? null],
  );
  return r.rows as { id: string; role: string; iteration: number; status: string; step: string; cost_usd: number; duration_s: number; tree_hash: string | null; report: Record<string, unknown> | null }[];
}

Then('table {string} contains exactly one {string} task for iteration {int}', async function (this: World, _t: string, role: string, iteration: number) {
  await this.wait(`task ${role} iteration ${iteration}`, async () => ((await tasks.call(this, { role, iteration })).length >= 1 ? true : undefined));
  assert.equal((await tasks.call(this, { role, iteration })).length, 1);
});
Then('task {string} of iteration {int} was created before task {string}', async function (this: World, first: string, iteration: number, second: string) {
  // ADR-021: the queue order (tests then builder) is read from the creation of the tasks (one insert after the other).
  const r = await this.base.pool.query<{ before: boolean | null }>(`SELECT (SELECT created_at FROM tasks WHERE id = $1) < (SELECT created_at FROM tasks WHERE id = $2) AS before`, [await this.taskId(first, iteration), await this.taskId(second, iteration)]);
  assert.equal(r.rows[0]!.before, true, `${first} created before ${second} (iteration ${iteration})`);
});
Then('table {string} contains no {string} task for iteration {int}', async function (this: World, _t: string, role: string, iteration: number) {
  await this.letThrough();
  assert.deepEqual(await tasks.call(this, { role, iteration }), []);
});
Then('table {string} contains no {string} task', async function (this: World, _t: string, role: string) {
  await this.letThrough();
  assert.deepEqual(await tasks.call(this, { role }), []);
});
Then('table {string} contains no task for iteration {int}', async function (this: World, _t: string, iteration: number) {
  await this.letThrough();
  assert.deepEqual((await tasks.call(this, { iteration })).filter((t) => HARDENING_ROLES.includes(t.role as Role)), []);
});
Then('table {string} contains no task for step {string}', async function (this: World, _t: string, step: string) {
  assert.deepEqual(await tasks.call(this, { step: step }), []);
});
Then('no agent task is launched', async function (this: World) {
  const before = (await tasks.call(this, {})).length;
  await this.letThrough(WINDOW_MS);
  assert.equal((await tasks.call(this, {})).length, before);
  const c = await this.cycle();
  assert.deepEqual(this.bench.engine.inProgress().filter((id) => id.startsWith(`${c.tool_id}-${c.id}-`)), []);
});
Then('the {int} tasks of round {int} have status {string}', async function (this: World, n: number, iteration: number, status: string) {
  const t = (await tasks.call(this, { iteration })).filter((x) => HARDENING_ROLES.includes(x.role as Role));
  assert.equal(t.length, n);
  for (const x of t) assert.equal(x.status, status, x.id);
});
const taskOrNothing = async (m: World, id: string) => m.base.readTask(id).catch(() => undefined);
Then('task {string} of iteration {int} has status {string}', async function (this: World, role: string, iteration: number, status: string) {
  const id = await this.taskId(role, iteration);
  await this.wait(`task ${id} ${status}`, async () => ((await taskOrNothing(this, id))?.status === status ? true : undefined));
});
Then('task {string} of iteration {int} has a cost of {int} $', async function (this: World, role: string, iteration: number, cost: number) {
  const t = await this.base.readTask(await this.taskId(role, iteration));
  assert.ok(close(t.cost_usd, cost), `cost ${t.cost_usd}`);
});
Then('the recorded reason of task {string} of iteration {int} is {string}', async function (this: World, role: string, iteration: number, reason: string) {
  const t = await this.base.readTask(await this.taskId(role, iteration));
  assert.equal((t.report as { reason?: unknown } | null)?.reason, reason);
});
Then('task {string} of iteration {int} has a tree hash', async function (this: World, role: string, iteration: number) {
  const id = await this.taskId(role, iteration);
  await this.wait(`tree digest of ${id}`, async () => ((await this.base.readTask(id)).tree_hash !== null ? true : undefined));
});
async function trees(this: World, role: string, a: number, b: number): Promise<[string, string]> {
  const ida = await this.taskId(role, a);
  const idb = await this.taskId(role, b);
  return this.wait(`tree digests of ${ida} and ${idb}`, async () => {
    const ta = await taskOrNothing(this, ida);
    const tb = await taskOrNothing(this, idb);
    return ta?.tree_hash && tb?.tree_hash ? [ta.tree_hash, tb.tree_hash] : undefined;
  });
}
Then('the tree hash of task {string} of iteration {int} equals the one of iteration {int}', async function (this: World, role: string, a: number, b: number) {
  const [ha, hb] = await trees.call(this, role, a, b);
  assert.equal(ha, hb);
});
Then('the tree hash of task {string} of iteration {int} differs from the one of iteration {int}', async function (this: World, role: string, a: number, b: number) {
  const [ha, hb] = await trees.call(this, role, a, b);
  assert.notEqual(ha, hb);
});
Then('the container of task {string} of iteration {int} is stopped', async function (this: World, role: string, iteration: number) {
  const id = await this.taskId(role, iteration);
  // The engine received the stop signal for THIS task (timeout or cancellation) and no longer runs it.
  await this.wait(`stop signal received for ${id}`, async () => (this.bench.engine.stopped.has(id) && !this.bench.engine.inProgress().includes(id) ? true : undefined));
});
Then('no agent container of the cycle is running', async function (this: World) {
  const c = await this.cycle();
  await this.wait('no container of the cycle', async () => (this.bench.engine.inProgress().some((id) => id.startsWith(`${c.tool_id}-${c.id}-`)) ? undefined : true));
});
Then('every still open task of the cycle has status {string}, a cost equal to its role\'s budget cap if it had started and 0 $ otherwise', async function (this: World, status: string) {
  const r = await this.base.pool.query<{ id: string; status: string; role: Role; cost_usd: number; started: boolean; reason: string | null }>(
    // Started = its container was launched (`executions`); a task closed while still preparing has spent nothing.
    `SELECT id, role, status, cost_usd::float8 AS cost_usd, executions > 0 AS started, split_part(report ->> 'reason', ' (cost unknown', 1) AS reason FROM tasks WHERE cycle_id = $1`, [this.cycleId]);
  assert.ok(!r.rows.some((x) => x.status === 'queued' || x.status === 'in_progress'), 'a task is still open');
  // Each task open BEFORE the cancellation (noted by the setup step) is closed by it (D2: never empty).
  for (const id of this.openTasks) {
    const x = r.rows.find((y) => y.id === id);
    assert.ok(x !== undefined && x.reason === 'cancellation', `${id} not closed by the cancellation (reason ${x?.reason})`);
    assert.equal(x.status, status, x.id);
    assert.ok(close(x.cost_usd, x.started ? DEFAULT_THRESHOLDS.task[x.role].budget_usd : 0), `${x.id}: cost ${x.cost_usd} (started: ${x.started})`);
  }
  // The task seen running before the cancellation is among the closed tasks, at the cap (B3, E15).
  if (this.runningTask !== undefined) assert.ok(this.openTasks.includes(this.runningTask), `${this.runningTask} missing from the open tasks`);
});

// ── Context passed to the tasks (fake engine's log) ─────────────────────────────────────────────

async function contextOf(this: World, role: string, iteration: number) {
  const id = await this.taskId(role, iteration);
  return this.wait(`engine call for ${id}`, async () => this.bench.engine.calls(id)[0]);
}
Then('task {string} of iteration {int} has {string} in its context', async function (this: World, role: string, iteration: number, text: string) {
  const e = await contextOf.call(this, role, iteration);
  assert.ok(JSON.stringify(e.context).includes(text), `context: ${JSON.stringify(e.context)}`);
});
Then('task {string} of iteration {int} works on branch {string}', async function (this: World, role: string, iteration: number, branch: string) {
  const e = await contextOf.call(this, role, iteration);
  assert.equal(e.branch, branch);
});
Then('the tool is named {string} with address {string}', async function (this: World, name: string, slug: string) {
  const c = await this.cycle();
  assert.deepEqual([c.name, c.slug], [name, slug]);
});
Then('the forge renamed repository {string} to {string}', function (this: World, from: string, to: string) {
  assert.deepEqual(this.bench.forge.renames, [{ from, to }]);
});
Then('the next agent task launched has {string} in its context', async function (this: World, text: string) {
  const c = await this.cycle();
  const e = await this.wait(`next task started (state ${await this.pilot.state(this.cycleId)}, last admin notification: ${this.bench.notifications.for(this.cycleId, 'admin').at(-1)?.content.slice(0, 200)})`, async () => this.bench.engine.switchboard.log.slice(this.engineLogBefore).find((j) => j.input.task_id.startsWith(`${c.tool_id}-${c.id}-`))?.input);
  assert.ok(JSON.stringify(e.context).includes(text), `context: ${JSON.stringify(e.context)}`);
});
Then('task {string} of iteration {int} receives the clarification {string} as data', async function (this: World, role: string, iteration: number, text: string) {
  const e = await contextOf.call(this, role, iteration);
  assert.equal((e.context['data'] as Record<string, unknown>)['admin_clarification'], text);
  this.clarificationSeen = text;
});
Then('task {string} of iteration {int} does not receive this clarification in its instructions', async function (this: World, role: string, iteration: number) {
  // "this clarification" = the text quoted by the previous step, not a value read back from the context (which would make the assertion empty).
  assert.ok(this.clarificationSeen !== undefined && this.clarificationSeen.trim() !== '', 'no clarification quoted before this step');
  const e = await contextOf.call(this, role, iteration);
  assert.ok(!e.instructions.includes(this.clarificationSeen), `the clarification is in the instructions: ${e.instructions}`);
  assert.ok(!e.instructions.includes(this.clarificationSeen.slice(0, 20)));
});
Then('task {string} of iteration {int} does not receive {string} in its instructions', async function (this: World, role: string, iteration: number, text: string) {
  assert.ok(text.trim() !== '');
  const e = await contextOf.call(this, role, iteration);
  assert.ok(!e.instructions.includes(text), `"${text}" is in the instructions: ${e.instructions.slice(0, 300)}…`);
});
const receivedDeviations = (context: Record<string, unknown>) => [...((context['deviations'] as { rule: string; file: string }[] | undefined) ?? []), ...((context['previous_deviations'] as { rule: string; file: string }[] | undefined) ?? [])];
Then('task {string} of iteration {int} receives deviation {string} on {string}', async function (this: World, role: string, iteration: number, rule: string, file: string) {
  const e = await contextOf.call(this, role, iteration);
  assert.ok(receivedDeviations(e.context).some((x) => x.rule === rule && x.file === file), `deviations received: ${JSON.stringify(receivedDeviations(e.context))}`);
});
Then('task {string} of iteration {int} does not receive deviation {string} on {string}', async function (this: World, role: string, iteration: number, rule: string, file: string) {
  const e = await contextOf.call(this, role, iteration);
  assert.ok(!receivedDeviations(e.context).some((x) => x.rule === rule && x.file === file));
});
Then('task {string} of iteration {int} receives from the builder finding {string} on {string} with evidence {string}', async function (this: World, role: string, iteration: number, rule: string, file: string, evidence: string) {
  const e = await contextOf.call(this, role, iteration);
  const findings = (e.context['builder_findings'] as { rule: string; file: string; evidence: string }[] | undefined) ?? [];
  assert.ok(findings.some((x) => x.rule === rule && x.file === file && x.evidence === evidence), `builder findings received: ${JSON.stringify(findings)}`);
});
Then('task {string} of iteration {int} receives the previous report of {string} from iteration {int}', async function (this: World, role: string, iteration: number, source: string, it: number) {
  const e = await contextOf.call(this, role, iteration);
  const reports = e.context['previous_reports'] as { role: string; iteration: number }[];
  assert.ok(reports.some((r) => r.role === source && r.iteration === it), `previous reports: ${JSON.stringify(reports.map((r) => `${r.role}#${r.iteration}`))}`);
});

// ── Counters ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stagnation counters computed BY THE ENGINE (`hardeningCounters`, the one the evaluation calls, D2) for the
 * last judged round: the last round that has deviations (the next round, already started, is not judged yet).
 */
async function engineCounters(this: World) {
  const since = await this.base.resumeIteration(this.cycleId);
  const r = await this.base.pool.query<{ t: number | null }>('SELECT max(iteration)::int AS t FROM deviations WHERE cycle_id = $1 AND iteration >= $2', [this.cycleId, since]);
  const round = r.rows[0]?.t ?? null;
  if (round === null) return [];
  return (await hardeningCounters(this.base, this.bench.orch.config.thresholds, this.cycleId, round)).counters;
}
Then('the stagnation counter of deviation {string} on {string} is {int}', async function (this: World, rule: string, file: string, n: number) {
  const c = (await engineCounters.call(this)).find((x) => x.deviation.rule === rule && x.deviation.file === file);
  assert.equal(c?.fine ?? 0, n);
});
Then('the stagnation counter of category {string} on {string} is {int}', async function (this: World, category: string, file: string, n: number) {
  const c = (await engineCounters.call(this)).filter((x) => x.deviation.category === category && x.deviation.file === file);
  assert.equal(Math.max(0, ...c.map((x) => x.category)), n);
});
Then('the inherited counter of deviation {string} on {string} is {int}', async function (this: World, rule: string, file: string, n: number) {
  const c = (await engineCounters.call(this)).find((x) => x.deviation.rule === rule && x.deviation.file === file);
  assert.equal(c?.inherited ?? 0, n);
});
Then('no deviation or category stagnation counter reaches {int}', async function (this: World, n: number) {
  const counters = await engineCounters.call(this);
  assert.ok(counters.length > 0, 'no deviation judged: nothing to check');
  for (const c of counters) assert.ok(c.fine < n && c.category < n, `${c.deviation.rule} ${c.deviation.file}: ${c.fine}/${c.category}`);
});
Then('the number of deduplicated deviations of rounds {int} to {int} is {string}', async function (this: World, from: number, a: number, expected: string) {
  const lines = await this.base.deviationsSince(this.cycleId, from);
  const counts = [];
  for (let it = from; it <= a; it += 1) counts.push(lines.filter((l) => l.iteration === it).length);
  assert.equal(counts.join(', '), expected);
});
Then('the cycle\'s round counter is {int}', async function (this: World, n: number) {
  await this.wait(`${n} rounds`, async () => ((await this.base.lastIteration(this.cycleId, HARDENING_ROLES)) === n ? true : undefined), 3_000);
});
/** Scoping counters as the engine recorded them (workflow memory read back from the database, D22), not a calculation redone on the side. */
const scopingCounters = async (m: World) => (await m.base.readMemory(m.cycleId)).scoping;
Then('the cycle\'s "same error" counter is {int}', async function (this: World, n: number) {
  await this.wait(`same error ×${n}`, async () => ((await scopingCounters(this)).sameError === n ? true : undefined), 5_000)
    .catch(async () => assert.fail(`scoping counters: ${JSON.stringify(await scopingCounters(this))}`));
});
Then('the cycle\'s attempt counter is {int}', async function (this: World, n: number) {
  await this.wait(`${n} attempts`, async () => ((await scopingCounters(this)).attempts === n ? true : undefined), 5_000)
    .catch(async () => assert.fail(`scoping counters: ${JSON.stringify(await scopingCounters(this))}`));
});

// ── Budget, duration ────────────────────────────────────────────────────────────────────────────

const totalCost = async (m: World) => (await m.base.pool.query<{ t: number }>(`SELECT coalesce(sum(cost_usd), 0)::float8 AS t FROM tasks WHERE cycle_id = $1`, [m.cycleId])).rows[0]!.t;
Then('the cycle\'s cumulative cost is {int} $', async function (this: World, cost: number) {
  await this.wait(`cost $${cost}`, async () => (close(await totalCost(this), cost) ? true : undefined), 3_000);
});
Then('the cycle\'s budget overrun is at most {int} $', async function (this: World, max: number) {
  const c = await this.cycle();
  assert.ok((await this.base.cumulativeCost(this.cycleId, 'hardening')) - c.hardening_budget_usd <= max + 0.005);
});
Then('the cycle\'s {word} budget check is on {float} $ spent for a cap of {int} $', async function (this: World, envelope: string, cost: number, cap: number) {
  const trace = `check:budget:${envelope}:ok:${cost.toFixed(2)}/${cap.toFixed(2)}`;
  await this.wait(`trace ${trace}`, async () => ((await this.pilot.history(this.cycleId)).some((h) => h.trigger === trace) ? true : undefined))
    .catch(async () => assert.fail(`budget checks traced: ${(await this.pilot.history(this.cycleId)).map((h) => h.trigger).filter((t) => t.startsWith('check:budget:')).join(', ')}`));
});
Then('the cycle\'s scoping budget cap is {int} $', async function (this: World, n: number) {
  await this.wait(`scoping cap ${n}`, async () => (close((await this.cycle()).scoping_budget_usd, n) ? true : undefined), 3_000);
});
Then('the cycle\'s hardening budget cap is {int} $', async function (this: World, n: number) {
  await this.wait(`hardening cap ${n}`, async () => (close((await this.cycle()).hardening_budget_usd, n) ? true : undefined), 3_000);
});
Then('the budget cap applied to the contract is the cycle\'s hardening cap, {int} $', async function (this: World, n: number) {
  const c = await this.cycle();
  assert.ok(close(c.hardening_budget_usd, n));
  const h = await this.pilot.history(this.cycleId);
  assert.ok(h.some((x) => x.state === 'contract' && x.trigger.startsWith('check:budget:hardening:exceeded')), 'the contract\'s budget check must be on the hardening envelope');
});
Then('the cycle\'s agent work duration is {int} minutes', async function (this: World, n: number) {
  await this.wait(`duration ${n} min`, async () => (close(await this.base.workDurationMin(this.cycleId, 'hardening'), n) ? true : undefined), 3_000);
});

// ── Notifications ───────────────────────────────────────────────────────────────────────────────

const reminders = (m: World, dest: 'admin' | 'requester') => m.bench.notifications.for(m.cycleId, dest).filter((e) => e.content.startsWith('Reminder') || e.subject.startsWith('Reminder')).length;
Then('the requester has received {int} reminder', async function (this: World, n: number) {
  await this.wait(`${n} reminder`, async () => (reminders(this, 'requester') >= n ? true : undefined));
  assert.equal(reminders(this, 'requester'), n);
});
Then('the requester has received {int} reminders', async function (this: World, n: number) {
  await this.wait(`${n} reminders`, async () => (reminders(this, 'requester') >= n ? true : undefined));
  assert.equal(reminders(this, 'requester'), n);
});
Then('the admin has received {int} reminder', async function (this: World, n: number) {
  await this.wait(`${n} admin reminder`, async () => (reminders(this, 'admin') >= n ? true : undefined));
  assert.equal(reminders(this, 'admin'), n);
});
Then('the admin has received {int} reminders', async function (this: World, n: number) {
  await this.wait(`${n} admin reminders`, async () => (reminders(this, 'admin') >= n ? true : undefined));
  assert.equal(reminders(this, 'admin'), n);
});
Then('the admin has received a weekly reminder without a new traced reminder', async function (this: World) {
  const n = this.bench.notifications.for(this.cycleId, 'admin').find((x) => x.subject.startsWith('Weekly reminder'));
  assert.ok(n !== undefined && n.subject.includes(await this.pilot.state(this.cycleId)), n?.subject);
  const e = await this.pilot.state(this.cycleId);
  assert.equal((await this.pilot.history(this.cycleId)).filter((x) => x.trigger === 'timeout_exceeded' && x.state === e && x.previous_state === e).length, 3, 'still 3 reminders traced (bound of the machine)');
  assert.equal(reminders(this, 'admin'), 3, 'still 3 "Reminder n/3" reminders');
});
Then('the requester does not receive a 4th reminder', async function (this: World) {
  await this.letThrough(WINDOW_MS);
  assert.equal(reminders(this, 'requester'), 3);
});
Then('the notification sent to the admin contains {string}', async function (this: World, text: string) {
  // The last notification sent to the admin for this cycle (the one of the event the scenario just caused), not any of them.
  const last = () => this.bench.notifications.for(this.cycleId, 'admin').at(-1);
  await this.wait(`last admin notification containing "${text}"`, async () => { const e = last(); return e !== undefined && (e.content.includes(text) || e.subject.includes(text)) ? true : undefined; }, 5_000)
    .catch(() => assert.fail(`last admin notification: "${last()?.subject} — ${last()?.content}"`));
});
Then('the cycle\'s workflow is still running', async function (this: World) {
  await this.letThrough();
  assert.equal(await this.pilot.statusW1(this.cycleId), 'PENDING');
});
Then('the notification sent to the admin does not contain {string}', async function (this: World, text: string) {
  const last = this.bench.notifications.for(this.cycleId, 'admin').at(-1);
  assert.ok(last !== undefined && !last.content.includes(text) && !last.subject.includes(text), last?.content);
});
Then('no gate {string} notification is sent to the admin', async function (this: World, g: string) {
  await this.letThrough();
  assert.ok(!this.bench.notifications.for(this.cycleId, 'admin').some((e) => e.subject.includes(g)));
});
Then('the requester receives an end-of-cycle notification', async function (this: World) {
  await this.wait('end-of-cycle notification', async () => (this.bench.notifications.for(this.cycleId, 'requester').some((e) => e.content.startsWith('End of cycle')) ? true : undefined));
});
Then('the requester receives link {string}', async function (this: World, link: string) {
  await this.wait(`link ${link}`, async () => (this.bench.notifications.for(this.cycleId, 'requester').some((e) => e.content.includes(link)) ? true : undefined));
});
Then('the requester receives with the mock-up link the message {string}', async function (this: World, message: string) {
  await this.wait(`mock-up and ${message}`, async () => (this.bench.notifications.for(this.cycleId, 'requester')
    .some((e) => e.content.startsWith('Mock-up available: ') && e.content.includes(message)) ? true : undefined));
});
Then('the requester has received no link to the mock-up', function (this: World) {
  assert.ok(!this.bench.notifications.for(this.cycleId, 'requester').some((e) => e.content.includes('.scoping.')));
});
Then('the requester has received no link to the Preview', function (this: World) {
  assert.ok(!this.bench.notifications.for(this.cycleId, 'requester').some((e) => e.content.includes('.preview.')));
});
Then('the fake mail server has sent the admin a message whose subject contains {string}', async function (this: World, text: string) {
  await this.wait(`subject containing ${text}`, async () => (this.bench.notifications.for(this.cycleId, 'admin').some((e) => e.subject.includes(text)) ? true : undefined));
});
Then('the message contains the link to the cycle\'s dashboard', function (this: World) {
  const last = this.bench.notifications.for(this.cycleId, 'admin').at(-1)!;
  assert.ok(last.content.includes(`${this.bench.orch.config.dashboardUrl}/cycles/${this.cycleId}`), last.content);
});
Then('the decision is refused with message {string}', function (this: World, text: string) {
  assert.ok(this.lastError.includes(text), `error received: "${this.lastError}"`);
});
Then('table {string} contains a {string} decision at gate {string} by actor {string} under hat {string}', async function (this: World, _t: string, decision: string, g: string, actor: string, role: string) {
  await this.wait(`approval ${decision} ${g} by ${actor} (${role})`, async () => ((await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2 AND decision = $3 AND actor = $4 AND role = $5 AND NOT four_eyes_exemption`, [this.cycleId, g, decision, actor, role])).rowCount ? true : undefined));
});
Then('table {string} contains no decision for gate {string}', async function (this: World, _t: string, g: string) {
  await this.letThrough();
  const r = await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2`, [this.cycleId, g]);
  assert.equal(r.rowCount, 0);
});
Then('the forge\'s signal is refused with message {string}', function (this: World, text: string) {
  assert.ok(this.lastError.includes(text), `error received: "${this.lastError}"`);
});
Then('the abandonment request is refused with message {string}', function (this: World, text: string) {
  assert.ok(this.lastError.includes(text), this.lastError);
});

// ── Business tables ─────────────────────────────────────────────────────────────────────────────

Then('table {string} contains a {string} decision for gate {string}', async function (this: World, _t: string, decision: string, g: string) {
  await this.wait(`approval ${decision} ${g}`, async () => ((await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2 AND decision = $3`, [this.cycleId, g, decision])).rowCount ? true : undefined));
});
Then('table {string} contains a {string} decision for gate {string} with a top-up of {int} $', async function (this: World, _t: string, decision: string, g: string, topUp: number) {
  await this.wait('approval with a top-up', async () => ((await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2 AND decision = $3 AND budget_top_up_usd = $4`, [this.cycleId, g, decision, topUp])).rowCount ? true : undefined));
});
Then('table {string} contains a {string} decision for gate {string} with digest {string}', async function (this: World, _t: string, decision: string, g: string, emp: string) {
  await this.wait('approval with a digest', async () => ((await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2 AND decision = $3 AND digest = $4`, [this.cycleId, g, decision, emp])).rowCount ? true : undefined));
});
Then('table {string} contains a {string} decision for gate {string} with comment {string}', async function (this: World, _t: string, decision: string, g: string, comment: string) {
  await this.wait('commented approval', async () => ((await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2 AND decision = $3 AND comment = $4`, [this.cycleId, g, decision, comment])).rowCount ? true : undefined));
});
Then('table {string} contains exactly one decision for gate {string}', async function (this: World, _t: string, g: string) {
  const r = await this.base.pool.query(`SELECT 1 FROM approvals WHERE cycle_id = $1 AND gate = $2`, [this.cycleId, g]);
  assert.equal(r.rowCount, 1);
});
Then('table {string} contains a {string} deployment with health {string}', async function (this: World, _t: string, env: string, health: string) {
  await this.wait(`deployment ${env} ${health}`, async () => ((await this.base.pool.query(`SELECT 1 FROM deployments WHERE cycle_id = $1 AND environment = $2 AND health = $3`, [this.cycleId, env, health])).rowCount ? true : undefined));
});
Then('table {string} contains a {string} deployment of digest {string} with health {string}', async function (this: World, _t: string, env: string, emp: string, health: string) {
  await this.wait(`deployment ${env} ${emp} ${health}`, async () => ((await this.base.pool.query(`SELECT 1 FROM deployments WHERE cycle_id = $1 AND environment = $2 AND digest = $3 AND health = $4`, [this.cycleId, env, emp, health])).rowCount ? true : undefined));
});
Then('the tool\'s last healthy {string} deployment has digest {string}', async function (this: World, env: string, emp: string) {
  const r = await this.base.pool.query<{ digest: string }>(`SELECT digest FROM deployments WHERE tool_id = $1 AND environment = $2 AND health = 'ok' ORDER BY id DESC LIMIT 1`, [this.toolId, env]);
  assert.equal(r.rows[0]?.digest, emp);
});
Then('table {string} contains for pipeline {string} and iteration {int} check {string} with result {string} against digest {string}', async function (this: World, _t: string, pipeline: string, iteration: number, check: string, result: string, emp: string) {
  await this.wait('pipeline result', async () => ((await this.base.pool.query(`SELECT 1 FROM pipeline_results WHERE cycle_id = $1 AND pipeline = $2 AND iteration = $3 AND check_name = $4 AND result = $5 AND digest = $6`, [this.cycleId, pipeline, iteration, check, result, emp])).rowCount ? true : undefined));
});
Then('table {string} contains for iteration {int} deviation {string} on {string}', async function (this: World, _t: string, iteration: number, rule: string, file: string) {
  await this.wait(`deviation ${rule} ${file} at round ${iteration}`, async () => ((await this.base.pool.query(`SELECT 1 FROM deviations WHERE cycle_id = $1 AND iteration = $2 AND rule = $3 AND file = $4`, [this.cycleId, iteration, rule, file])).rowCount ? true : undefined));
});
Then('table {string} contains for iteration {int} no deviation {string}', async function (this: World, _t: string, iteration: number, rule: string) {
  const r = await this.base.pool.query(`SELECT 1 FROM deviations WHERE cycle_id = $1 AND iteration = $2 AND rule = $3`, [this.cycleId, iteration, rule]);
  assert.equal(r.rowCount, 0);
});
Then('table {string} contains a cancellation by actor {string}', async function (this: World, _t: string, actor: string) {
  await this.wait('cancellation traced', async () => ((await this.base.pool.query(`SELECT 1 FROM tool_history WHERE cycle_id = $1 AND trigger = 'cancellation' AND actor = $2`, [this.cycleId, actor])).rowCount ? true : undefined));
});
Then('the requester reads the orchestrator\'s message {string} in the chat', async function (this: World, text: string) {
  await this.wait(`message "${text}"`, async () => ((await this.base.cycleMessages(this.cycleId)).some((m) => m.author_type === 'orchestrator' && m.content.includes(text)) ? true : undefined));
});
// Decision A: the core is checked once per evolution (never for the creation that delivered the tool), nothing committed when there is nothing to do.
Then('the platform has checked the core once without publishing anything into main', async function (this: World) {
  await this.letThrough();
  assert.equal(this.bench.engine.cores.length, 1, JSON.stringify(this.bench.engine.cores));
  assert.deepEqual(this.bench.forge.publications.filter((p) => p.role === 'core'), []);
});
Then('table {string} contains {int} messages for the cycle', async function (this: World, _t: string, n: number) {
  await this.wait(`${n} messages`, async () => ((await this.base.cycleMessages(this.cycleId)).length >= n ? true : undefined), 3_000);
  assert.equal((await this.base.cycleMessages(this.cycleId)).length, n);
});
Then('table {string} contains a budget check for step {string} before the launch of task {string} of iteration {int}', async function (this: World, _t: string, step: string, role: string, iteration: number) {
  const id = await this.taskId(role, iteration);
  await this.wait(`budget check on ${step} before ${id}`, async () => ((await this.base.pool.query(`SELECT 1 FROM tool_history h, tasks t WHERE t.id = $2 AND h.cycle_id = $1 AND h.state = $3 AND h.trigger LIKE 'check:budget:%' AND h.created_at <= t.created_at`, [this.cycleId, id, step])).rowCount ? true : undefined));
});
Then('the forge has published the {string} work into main before task {string} of iteration {int}', async function (this: World, role: string, task: string, iteration: number) {
  // E7: the validated work of the previous step is in main (forge `publish`) before the role that starts from main is created.
  const id = await this.taskId(task, iteration);
  const creation = await this.wait(`task ${id}`, async () => (await this.base.pool.query<{ t: number }>(`SELECT (extract(epoch from created_at) * 1000)::float8 AS t FROM tasks WHERE id = $1`, [id])).rows[0]?.t);
  const publications = this.bench.forge.publications.filter((p) => p.cycleId === this.cycleId && p.role === role);
  assert.ok(publications.length > 0 && publications[0]!.at <= creation, `publication of the ${role} work (cycle ${this.cycleId}) before task ${task}; publications: ${JSON.stringify(this.bench.forge.publications)}`);
});
Then('table {string} contains no budget check between task {string} and task {string} of iteration {int}', async function (this: World, _t: string, a: string, b: string, iteration: number) {
  const r = await this.base.pool.query(
    `SELECT 1 FROM tool_history h, tasks ta, tasks tb WHERE ta.id = $2 AND tb.id = $3 AND h.cycle_id = $1 AND h.trigger LIKE 'check:budget:%'
     AND h.created_at > least(ta.created_at, tb.created_at) AND h.created_at < greatest(ta.created_at, tb.created_at)`,
    [this.cycleId, await this.taskId(a, iteration), await this.taskId(b, iteration)],
  );
  assert.equal(r.rowCount, 0);
});

// ── Tool, archiving, cleanup ────────────────────────────────────────────────────────────────────

const archivedAt = async (m: World) => (await m.base.pool.query<{ archived_at: Date | null }>('SELECT archived_at FROM tools WHERE id = $1', [m.toolId])).rows[0]!.archived_at;
Then('the tool is archived', async function (this: World) {
  await this.wait('tool archived', async () => ((await archivedAt(this)) !== null ? true : undefined));
});
Then('the tool is not archived', async function (this: World) {
  await this.letThrough();
  assert.equal(await archivedAt(this), null);
});
Then('no data of the cycle is deleted', async function (this: World) {
  const c = await this.cycle();
  assert.ok(c.finished_at instanceof Date);
  assert.ok((await this.pilot.history(this.cycleId)).length >= 2);
  const o = await this.base.pool.query('SELECT 1 FROM tools WHERE id = $1', [c.tool_id]);
  assert.equal(o.rowCount, 1);
});
Then('creating a new cycle for this tool is refused', async function (this: World) {
  if (this.lastError === '') await this.pilot.createCycle(DEFAULT_SLUG + '-bis', 'evolution', this.toolId).catch((e: Error) => { this.lastError = e.message; });
  assert.match(this.lastError, /archived|cycles_one_in_progress/);
});
Then('tool {string} has exactly one cycle in progress', async function (this: World, slug: string) {
  const r = await this.base.pool.query(`SELECT count(*)::int AS n FROM cycles c JOIN tools o ON o.id = c.tool_id WHERE o.slug = $1 AND c.finished_at IS NULL`, [slug]);
  assert.equal(r.rows[0]!.n, 1);
});
const mockupState = async (m: World) => m.bench.deployer.active.get(`mockup:${(await m.cycle()).slug}`)?.state;
Then('the tool\'s mock-up container is stopped', async function (this: World) {
  await this.wait('mock-up stopped', async () => ((await mockupState(this)) === 'stopped' ? true : undefined));
});
Then('the tool\'s mock-up container is removed', async function (this: World) {
  await this.wait('mock-up removed', async () => ((await mockupState(this)) === 'removed' ? true : undefined));
});
Then('the tool\'s scoping subdomain is removed', async function (this: World) {
  // The fake deployer carries container and subdomain together: removed = no longer served under <tool>.scoping.<domain>.
  const slug = (await this.cycle()).slug;
  await this.wait('subdomain removed', async () => ((await mockupState(this)) === 'removed' && this.bench.deployer.running('mockup', slug) === null ? true : undefined));
});
// M5: the engine, which no longer administers the repository, asks a human for the archiving; no branch is deleted.
Then('the admin is asked to archive the tool\'s repository in the forge', async function (this: World) {
  const slug = (await this.cycle()).slug;
  await this.wait('archiving request', async () => (this.bench.notifications.for(this.cycleId, 'admin').some((e) => e.subject === `Tool ${slug} archived: repository to archive` && e.content.includes(`archive the repository ${slug}`)) ? true : undefined));
});
Then('the tool answers in production with digest {string}', async function (this: World, emp: string) {
  const slug = (await this.base.pool.query<{ slug: string }>('SELECT slug FROM tools WHERE id = $1', [this.toolId])).rows[0]!.slug;
  await this.wait(`prod ${emp}`, async () => (this.bench.deployer.running('prod', slug) === emp ? true : undefined));
});
Then('the tool\'s Preview stays deployed', async function (this: World) {
  assert.ok(this.bench.deployer.running('preview', (await this.cycle()).slug) !== null);
});

// ── Forge ───────────────────────────────────────────────────────────────────────────────────────

Then('the forge has received exactly one creation request for repository {string}', function (this: World, slug: string) {
  assert.equal(this.bench.forge.switchboard.log.filter((j) => j.key === `repo:${slug}`).length, 1);
});
Then('the forge has received no repository creation request', async function (this: World) {
  await this.letThrough();
  assert.deepEqual(this.bench.forge.switchboard.log.slice(this.forgeLogBefore).filter((j) => j.key.startsWith('repo:')), []);
});
Then('the forge has received no new CI or Preview pipeline request', async function (this: World) {
  await this.letThrough(WINDOW_MS);
  // Neither a squash asked of the forge (a CI starts from each squash), nor a pass through the CI or pipeline wait since the decision.
  assert.deepEqual(this.bench.forge.switchboard.log.slice(this.forgeLogBefore).filter((j) => j.key.startsWith('merge:')), []);
  assert.equal(this.bench.forge.merges.get((await this.cycle()).slug) ?? 0, this.mergesBefore);
  const cursor = this.cursors.get(this.cycleId) ?? 0;
  assert.ok(!(await this.pilot.history(this.cycleId)).some((h) => h.id > cursor && (h.state === 'waiting_ci' || h.state === 'preview_pipeline')));
});

// ── Dashboard (reads the same tables) ───────────────────────────────────────────────────────────

Then('the admin dashboard shows for task {string} of iteration {int} reason {string}', async function (this: World, role: string, iteration: number, reason: string) {
  const t = await this.base.readTask(await this.taskId(role, iteration));
  assert.equal((t.report as { blocked_reason?: string }).blocked_reason, reason);
});
Then('the admin dashboard shows for iteration {int} deviation {string}', async function (this: World, iteration: number, rule: string) {
  const r = await this.base.pool.query(`SELECT 1 FROM deviations WHERE cycle_id = $1 AND iteration = $2 AND rule = $3`, [this.cycleId, iteration, rule]);
  assert.equal(r.rowCount, 1);
});
Then('the admin dashboard shows deviation {string} on {string} as a follow-up of {string} from round {int}', async function (this: World, rule: string, file: string, previous: number | string, round: number) {
  const r = await this.base.pool.query<{ previous_id: string }>(`SELECT previous_id FROM deviations WHERE cycle_id = $1 AND rule = $2 AND file = $3 AND iteration = $4`, [this.cycleId, rule, file, round + 1]);
  assert.equal(r.rows[0]?.previous_id, previous);
});
Then('the admin dashboard shows the cycle "waiting > {int} h"', async function (this: World, _h: number) {
  // Observed beyond the long wait: a 4th reminder, if the engine sent one, would already be there (D2).
  await this.letThrough(WINDOW_MS);
  const h = await this.pilot.history(this.cycleId);
  const e = await this.pilot.state(this.cycleId);
  assert.equal(h.filter((x) => x.trigger === 'timeout_exceeded' && x.state === e && x.previous_state === e).length, 3, '3 reminders traced without an answer');
  const notifications = this.bench.notifications.for(this.cycleId).filter((n) => n.content.startsWith('Reminder') || n.subject.startsWith('Reminder'));
  assert.equal(notifications.length, 3, 'exactly 3 reminders sent');
});

// ── Startup (E10 bis) ───────────────────────────────────────────────────────────────────────────

Then('the orchestrator stops with message {string}', function (this: World, text: string) {
  assert.ok(this.lastError.startsWith('2 ') && this.lastError.includes(text), this.lastError);
});
Then('no workflow is launched', async function (this: World) {
  // In the database given to the refused process: DBOS did not even create its schema there.
  const client = new pg.Client({ connectionString: this.startupDatabase });
  await client.connect();
  try {
    const r = await client.query(`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'dbos'`);
    assert.equal(r.rows[0]!.n, 0, 'the refused process launched DBOS');
  } finally {
    await client.end();
  }
});
Then('table {string} contains for pipeline {string} and iteration {int} check {string} with result {string}', async function (this: World, _t: string, pipeline: string, iteration: number, check: string, result: string) {
  await this.wait('pipeline result', async () => ((await this.base.pool.query(`SELECT 1 FROM pipeline_results WHERE cycle_id = $1 AND pipeline = $2 AND iteration = $3 AND check_name = $4 AND result = $5`, [this.cycleId, pipeline, iteration, check, result])).rowCount ? true : undefined));
});
Then('table {string} contains no task for the next iteration', async function (this: World, _t: string) {
  await this.letThrough(500);
  // The round that escalated is the last reviewed round (it has its reviewers); no role must have been restarted after it.
  const n = await this.base.lastIteration(this.cycleId, ['security-reviewer']);
  const next = (await tasks.call(this, { iteration: n + 1 })).filter((t) => HARDENING_ROLES.includes(t.role as Role));
  assert.deepEqual(next, []);
});

export type { StateId };
