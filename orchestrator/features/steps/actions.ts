// Given and When steps: setup along the machine's real path (pilot),
// scripts of the fakes, messages of the humans and of the forge.
import { Given, When, type DataTable } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { reportWithDeviations, blockedReport, overlapReport, compliantReport, diagnosisReport, type ScriptedDeviation, type EngineResponse } from '../../src/external/fakes.ts';
import type { Cause } from '../../src/hardening/diagnosis.ts';
import type { Role } from '../../src/external/contracts.ts';
import type { StateId, GateOutcome } from '../../src/machine/states.ts';
import type { PipelineCheck, Message } from '../../src/messages.ts';
import { ADMIN, REQUESTER, REQUESTER_MAIL, ENV_TEST, freeze, releaseFreezes } from '../../tests/helpers/bench.ts';
import { unprotected } from '../../tests/helpers/throwaway-postgres.ts';
import { ORCHESTRATOR_ACTOR } from '../../src/db.ts';
import { HARDENING_ROLES } from '../../src/workflows/toolCycle.ts';
import { logTail } from '../../src/external/gitea-forge.ts';
import { World, DEFAULT_SLUG } from '../support/world.ts';

const role = (s: string) => s as Role;
const STATES_WITH_TASK = new Set(['overlap_search', 'scoping', 'contract', 'hardening_execution', 'hardening_review']);
const state = (s: string) => s as StateId;

// ── Context ─────────────────────────────────────────────────────────────────────────────────────

Given('the default thresholds', function () { /* ENV_TEST keeps the thresholds of states.ts, only the delays are shortened */ });
Given('the fake agent engine', function () { /* wired by hooks.ts */ });

// ── Setup ───────────────────────────────────────────────────────────────────────────────────────

async function cycleIn(this: World, type: 'creation' | 'evolution', target: string, slug: string, options: { ciDigest?: string } = {}) {
  if (type === 'evolution' && this.toolId === 0) {
    // An evolution assumes a tool in production: deliver it first.
    const creation = await this.pilot.createCycle(slug);
    await this.pilot.driveUntil(creation, 'end_success');
    await this.pilot.waitForWorkflowEnd(creation);
    this.toolId = (await this.base.readCycle(creation)).tool_id;
  }
  const id = await this.pilot.createCycle(slug, type, type === 'evolution' ? this.toolId : undefined);
  this.cycleId = id;
  this.toolId = (await this.base.readCycle(id)).tool_id;
  this.targets.set((await this.base.readCycle(id)).slug, target);
  await this.pilot.driveUntil(id, state(target), options);
  // A state that starts tasks is "held" only once its entry checks are done and its tasks started: a setup
  // (cost, duration…) put in place before those checks would change what the scenario tests.
  if (STATES_WITH_TASK.has(target)) {
    await this.wait(`tasks of state ${target} started`, async () => {
      const r = await this.base.pool.query(`SELECT 1 FROM tasks WHERE cycle_id = $1 AND step = $2 AND status IN ('queued', 'in_progress')`, [id, target]);
      return (r.rowCount ?? 0) > 0 || (await this.pilot.state(id)) !== target ? true : undefined;
    });
  }
  this.cursors.set(id, (await this.pilot.history(id)).at(-1)!.id);
  this.forgeLogBefore = this.bench.forge.switchboard.log.length;
}

Given('a creation cycle in state {string}', async function (this: World, e: string) {
  await cycleIn.call(this, 'creation', e, DEFAULT_SLUG);
});
Given('a creation cycle in state {string} for tool {string}', async function (this: World, e: string, slug: string) {
  await cycleIn.call(this, 'creation', e, slug);
});
Given('a creation cycle in state {string} with digest {string} in Preview', async function (this: World, e: string, emp: string) {
  await cycleIn.call(this, 'creation', e, DEFAULT_SLUG, { ciDigest: emp });
});
Given('a creation cycle in state {string} for tool {string} with digest {string} in Preview', async function (this: World, e: string, slug: string, emp: string) {
  await cycleIn.call(this, 'creation', e, slug, { ciDigest: emp });
});
/** I0, four eyes: the admin is the tool's requester themself. */
Given('a creation cycle requested by the admin in state {string}', async function (this: World, e: string) {
  const id = await this.pilot.createCycle(DEFAULT_SLUG, 'creation', undefined, ADMIN);
  this.cycleId = id;
  this.toolId = (await this.base.readCycle(id)).tool_id;
  this.targets.set(DEFAULT_SLUG, e);
  await this.pilot.driveUntil(id, state(e));
  this.cursors.set(id, (await this.pilot.history(id)).at(-1)!.id);
});
Given('an evolution cycle in state {string}', async function (this: World, e: string) {
  await cycleIn.call(this, 'evolution', e, DEFAULT_SLUG);
});
Given('an evolution cycle in state {string} for this tool', async function (this: World, e: string) {
  await cycleIn.call(this, 'evolution', e, DEFAULT_SLUG);
});
Given('an evolution cycle in state {string} for this tool with digest {string} in Preview', async function (this: World, e: string, emp: string) {
  await cycleIn.call(this, 'evolution', e, DEFAULT_SLUG, { ciDigest: emp });
});
Given('an evolution cycle in state {string} for this tool with approved digest {string}', async function (this: World, e: string, emp: string) {
  await cycleIn.call(this, 'evolution', e, DEFAULT_SLUG, { ciDigest: emp });
  // The step says "approved": check it (Gate 2 really passed on this digest) instead of assuming it.
  assert.equal(await this.base.gate2ApprovedDigest(this.cycleId), emp, `digest ${emp} not approved at Gate 2`);
});

/** D21: the cycle is driven into the state along its real path, and the transition that takes it out fails (injected internal fault). */
Given('a creation cycle driven to state {string} whose exit fails with error {string}', async function (this: World, e: string, error: string) {
  const id = await this.pilot.createCycle(DEFAULT_SLUG);
  this.cycleId = id;
  this.toolId = (await this.base.readCycle(id)).tool_id;
  this.targets.set(DEFAULT_SLUG, 'gate_incident');
  await this.pilot.driveUntil(id, 'gate_incident', { faultIn: state(e), fault: error });
  // The cursor stops just before the incident: the scenario checks the transition itself.
  const incident = (await this.pilot.history(id)).find((x) => x.trigger === 'incident');
  assert.ok(incident !== undefined, 'no incident traced');
  this.cursors.set(id, incident.id - 1);
});

/** D21: the next transition that leaves this state fails (injected internal fault, definitive database error). */
When('an internal error occurs when leaving state {string} with error {string}', function (this: World, e: string, error: string) {
  this.bench.faults.set(`${this.cycleId}/${e}`, error);
});
/**
 * D21 + S4: W1 dies (cancelled from outside) while it waits for the native end of its tasks, which are in flight; the
 * scheduled monitoring takes it over at the incident gate, stopping its children.
 */
When('the cycle\'s workflow dies while the cycle waits for its tasks', async function (this: World) {
  await DBOS.cancelWorkflow(await this.pilot.workflowW1(this.cycleId));
});

/** E15 on a transient state: W1 is held in the state (it reads it then waits) while the admin acts. */
Given('a creation cycle held in state {string}', async function (this: World, e: string) {
  freeze(this.bench, '*', state(e));
  await cycleIn.call(this, 'creation', e, DEFAULT_SLUG);
});

// Decision A: what the fake engine answers to the core bump of the next evolution (nothing scripted = already up to date).
Given('the latest published core version {string} while the tool is on {string}', function (this: World, to: string, from: string) {
  this.bench.engine.preparedCores.push({ type: 'update', from, to });
});
Given('an unreachable core registry', function (this: World) {
  this.bench.engine.preparedCores.push({ type: 'error', reason: 'core registry unreachable' });
});

Given('a tool in production with digest {string}', async function (this: World, emp: string) {
  const creation = await this.pilot.createCycle(this.pilot.cycles.has(DEFAULT_SLUG) ? `${DEFAULT_SLUG}-prod` : DEFAULT_SLUG);
  await this.pilot.driveUntil(creation, 'end_success', { ciDigest: emp });
  await this.pilot.waitForWorkflowEnd(creation);
  this.cycleId = creation;
  this.toolId = (await this.base.readCycle(creation)).tool_id;
});
Given('a tool in production whose creation cycle cost {int} $', async function (this: World, cost: number) {
  const creation = await this.pilot.createCycle(DEFAULT_SLUG);
  await this.pilot.driveUntil(creation, 'end_success');
  await this.pilot.waitForWorkflowEnd(creation);
  this.toolId = (await this.base.readCycle(creation)).tool_id;
  await unprotected(this.bench.orch.config.databaseUrl, `UPDATE tasks SET cost_usd = 0 WHERE cycle_id = $1`, [creation]);
  await unprotected(this.bench.orch.config.databaseUrl, `UPDATE tasks SET cost_usd = $2 WHERE id = (SELECT id FROM tasks WHERE cycle_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)`, [creation, cost]);
});
/** Overlap search: a tool of the catalogue, whose description is the comment of the Gate 1 approval. */
Given('an existing tool {string} approved at Gate 1 with comment {string}', async function (this: World, slug: string, comment: string) {
  const creation = await this.pilot.createCycle(slug);
  await this.pilot.driveUntil(creation, 'gate_1');
  await this.pilot.sendWhenExpected(creation, { type: 'decision', gate: 'gate_1', outcome: 'approved', actor_id: ADMIN.id, comment: comment });
  await this.pilot.driveUntil(creation, 'end_success');
  await this.pilot.waitForWorkflowEnd(creation);
});
Given('an archived tool', async function (this: World) {
  const creation = await this.pilot.createCycle('archive');
  await this.pilot.driveUntil(creation, 'gate_overlap');
  await this.pilot.send(creation, { type: 'decision', gate: 'gate_overlap', outcome: 'refused', actor_id: ADMIN.id });
  await this.pilot.waitForWorkflowEnd(creation);
  this.cycleId = creation;
  this.toolId = (await this.base.readCycle(creation)).tool_id;
});

/**
 * The cumulative cost is the sum of `tasks.cost_usd`: cost / duration set on the cycle's last FINISHED task (a running
 * task would be rewritten by W2), the others at zero; setup outside the protection triggers (M8).
 */
async function setOnLastTask(this: World, column: 'cost_usd' | 'duration_s', value: number) {
  await unprotected(this.bench.orch.config.databaseUrl, `UPDATE tasks SET ${column} = 0 WHERE cycle_id = $1`, [this.cycleId]);
  const r = await unprotected(this.bench.orch.config.databaseUrl,
    `UPDATE tasks SET ${column} = $2 WHERE id = (SELECT id FROM tasks WHERE cycle_id = $1 AND status IN ('done', 'failed', 'blocked') ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [this.cycleId, value],
  );
  assert.equal(r.rowCount, 1, `the cycle must already have a finished task to carry ${column}`);
}
Given('a cumulative cycle cost of {int} $', async function (this: World, cost: number) {
  await setOnLastTask.call(this, 'cost_usd', cost);
});
Given('a cumulative agent work duration of {int} minutes on the cycle', async function (this: World, minutes: number) {
  await setOnLastTask.call(this, 'duration_s', minutes * 60);
});
Given('the requester has already received {int} reminders', async function (this: World, n: number) {
  await this.wait(`${n} reminders to the requester`, async () => (this.bench.notifications.for(this.cycleId, 'requester').filter((e) => e.content.startsWith('Reminder')).length >= n ? true : undefined));
});
Given('the cycle\'s chat contains the requester\'s message {string}', async function (this: World, text: string) {
  await this.base.writeMessage(await this.cycle(), 'requester', REQUESTER.id, text);
});
Given('the cycle\'s chat contains the orchestrator\'s message {string}', async function (this: World, text: string) {
  await this.base.writeMessage(await this.cycle(), 'orchestrator', ORCHESTRATOR_ACTOR, text);
});
Given('an agent task of the cycle running if the state launches one', async function (this: World) {
  // The fake engine is waiting for an answer: it is the "running container" of the current state, if there is one.
  this.runningTask = undefined;
  this.openTasks = [];
  if (!STATES_WITH_TASK.has(await this.pilot.state(this.cycleId))) return;
  const c = await this.cycle();
  this.runningTask = await this.wait('a task of the cycle running at the engine', async () => {
    const r = await this.base.pool.query<{ id: string }>(`SELECT id FROM tasks WHERE cycle_id = $1 AND status = 'in_progress'`, [c.id]);
    return r.rows.map((x) => x.id).find((id) => this.bench.engine.inProgress().includes(id));
  });
  this.openTasks = (await this.base.pool.query<{ id: string }>(`SELECT id FROM tasks WHERE cycle_id = $1 AND status IN ('queued', 'in_progress')`, [c.id])).rows.map((x) => x.id);
});
Given('the iteration branch changes file {string} from role {string}', function (this: World, file: string, r: string) {
  this.outOfScope.push({ file: file, role: role(r) });
});
Given('a configuration without variable {string}', function (this: World, variable: string) {
  this.lastError = variable;
});

// ── Fake engine ─────────────────────────────────────────────────────────────────────────────────

function deviationsFromTable(table: DataTable): ScriptedDeviation[] {
  return table.hashes().map((l) => ({
    rule: l['rule']!,
    file: l['file']!,
    ...(l['category'] ? { category: l['category'] } : {}),
    ...(l['id'] ? { id: l['id'] } : {}),
    ...(l['line'] ? { line: Number(l['line']) } : {}),
    ...(l['message'] ? { evidence: l['message'] } : {}),
    ...(l['previous_id'] ? { previous_id: l['previous_id'] } : {}),
    ...(l['owner_role'] ? { owner_role: l['owner_role'] } : {}),
  }));
}

When('the request is handled', function () { /* the workflow is started as soon as the request is made */ });
When('the fake engine returns a compliant report for {string}', function (this: World, r: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id) });
});
When('the fake engine returns a compliant report for roles {string}', function (this: World, roles: string) {
  for (const r of roles.split(',').map((x) => x.trim())) this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id) });
});
When('the fake engine returns verdict {string} for {string}', function (this: World, verdict: string, r: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => overlapReport(e.task_id, verdict as 'plausible' | 'not_plausible') });
});
When('the fake engine returns verdict {string} for {string} with reason {string}', function (this: World, verdict: string, r: string, reason: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => overlapReport(e.task_id, verdict as 'plausible' | 'not_plausible', reason) });
});
When('the fake engine returns verdict {string} for {string} on tool {string} with reason {string}', function (this: World, verdict: string, r: string, tool: string, reason: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => overlapReport(e.task_id, verdict as 'plausible' | 'not_plausible', reason, tool) });
});
When('the fake engine returns a compliant report for {string} with the message to the requester {string}', function (this: World, r: string, message: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id, { requester_message: message }) });
});
When('the fake engine returns a failure for {string} with reason {string}', function (this: World, r: string, reason: string) {
  this.bench.engine.answer(role(r), { type: 'failed', reason: reason });
});
When('the fake engine returns a failure for {string} with reason {string} and a cost of {float} $', function (this: World, r: string, reason: string, cost: number) {
  this.bench.engine.answer(role(r), { type: 'failed', reason: reason, cost_usd: cost });
});
/** ADR-027: the diagnosis verdict, its recommendation matching the cause (a top-up, a question, or neither). */
When('the fake engine returns for {string} the diagnosis {string} explaining {string}', function (this: World, r: string, cause: string, explanation: string) {
  assert.equal(r, 'diagnosis');
  const recommendation = cause === 'slow_progress' ? { top_up_usd: 12 } : cause === 'unclear_request' ? { question: 'Which sites must the tool cover?' } : {};
  this.bench.engine.answer('diagnosis', { type: 'report', report: (e: { task_id: string }) => diagnosisReport(e.task_id, cause as Cause, explanation, recommendation) });
});
Given('the forge holds {int} commits on the {string} branch of the cycle', async function (this: World, n: number, r: string) {
  this.bench.forge.branchCommits.set(`${(await this.cycle()).slug}/${this.cycleId}/${r}`, n);
});
When('the fake engine returns for {string} a report without verdict whose summary starts with {string}', function (this: World, r: string, start: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id, { summary: `${start} — no tool of the registry manages the inventory` }) });
});
When('the fake engine returns a compliant report for {string} without a declared cost', function (this: World, r: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id), cost_usd: null });
});
When('the fake engine returns a report invalid against the schema for {string}', function (this: World, r: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: { result: 'ok', comment: 'free report, outside the schema' } });
});
When('the fake engine returns state {string} for {string} with reason {string}', function (this: World, status: string, r: string, reason: string) {
  assert.equal(status, 'blocked');
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => blockedReport(role(r), e.task_id, reason) });
});
When('the fake engine returns for {string} a report with the deviations:', function (this: World, r: string, table: DataTable) {
  const deviations = deviationsFromTable(table);
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => reportWithDeviations(role(r), e.task_id, deviations) });
});
When('the fake engine returns for {string} state {string} with the deviations:', function (this: World, r: string, status: string, table: DataTable) {
  assert.equal(status, 'blocked');
  const deviations = deviationsFromTable(table);
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => ({ ...reportWithDeviations(role(r), e.task_id, deviations), status: 'blocked', blocked_reason: 'a test contradicts the contract' }) });
});
When('the fake engine returns for {string} a report with deviation {string} on {string}, a label missing from the schema\'s closed list', function (this: World, r: string, rule: string, file: string) {
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => reportWithDeviations(role(r), e.task_id, [{ rule, file }]) });
});
When('the fake engine returns a compliant report for {string} without changing any file', async function (this: World, r: string) {
  const c = await this.cycle();
  const tree = this.bench.engine.lastDigests.get(`${c.slug}/${r}`);
  assert.ok(tree !== undefined, `no tree digest known for ${r}`);
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id), tree_hash: tree });
});
When('the fake engine returns state {string} for {string} with reason {string} without changing any file', async function (this: World, status: string, r: string, reason: string) {
  assert.equal(status, 'blocked');
  const c = await this.cycle();
  const tree = this.bench.engine.lastDigests.get(`${c.slug}/${r}`);
  assert.ok(tree !== undefined, `no tree digest known for ${r}`);
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => blockedReport(role(r), e.task_id, reason), tree_hash: tree });
});
When('the fake engine returns a compliant report for {string}, putting its files back as they were at iteration {int}', async function (this: World, r: string, iteration: number) {
  const t = await this.base.readTask(await this.taskId(r, iteration));
  assert.ok(t.tree_hash !== null);
  this.bench.engine.answer(role(r), { type: 'report', report: (e: { task_id: string }) => compliantReport(role(r), e.task_id), tree_hash: t.tree_hash });
});
When('the fake engine does not answer for {string} for {int} minutes', function (this: World, r: string, _min: number) {
  this.bench.engine.answer(role(r), { type: 'silence' });
});
When('the fake engine declares a cost of {int} $ per task', function (this: World, cost: number) {
  this.bench.engine.defaultCost = cost;
});
Given('the fake engine is still preparing the {string} tasks, their container not started', function (this: World, role: Role) {
  // Clone, image signature…: the task is in progress for W2 but no container (nothing paid) until the stop signal.
  this.bench.engine.preparing.add(role);
});
When('the fake engine declares a work duration of {int} minutes per task', function (this: World, minutes: number) {
  this.bench.engine.defaultDuration_s = minutes * 60;
});
When('the fake engine declares a queue wait of {int} minutes per task', function (_min: number) { /* queue waiting time is not working time (D3): nothing to declare to the engine */ });

/**
 * A full hardening round: code roles and integration happy, one reviewer with the given deviations,
 * the other compliant; waits for the evaluation of this round. The roles the scenario scripts separately keep control.
 */
async function playRound(this: World, number: number | null, reviewer: string, reviewerReport: (task_id: string) => unknown) {
  const { engine: engine, forge } = this.bench;
  // "The next round": the one whose tasks are already started and not finished, otherwise the next one.
  const last = await this.base.lastIteration(this.cycleId, HARDENING_ROLES);
  const open = last === 0 ? [] : (await this.base.cycleTasks(this.cycleId, { iteration: last, roles: [...HARDENING_ROLES] })).filter((t) => t.status === 'queued' || t.status === 'in_progress');
  const expectedRound = number ?? (last === 0 ? 1 : open.length > 0 ? last : last + 1);
  const autoBefore = engine.switchboard.auto;
  const autoForgeBefore = forge.switchboard.auto;
  const answer = (input: { role: string; task_id: string }): EngineResponse => ({
    type: 'report',
    report: input.role === reviewer ? reviewerReport(input.task_id) : compliantReport(role(input.role), input.task_id),
  });
  engine.switchboard.auto = async (key, input) => (input.task_id.endsWith(`-${expectedRound}-${input.role}`) ? answer(input) : autoBefore === undefined ? undefined : autoBefore(key, input));
  forge.switchboard.auto = async (key, input) => (input.operation === 'integration' && input.iteration === expectedRound ? { type: 'ok' } : autoForgeBefore === undefined ? undefined : autoForgeBefore(key, input));
  try {
    await engine.switchboard.reconsider();
    await forge.switchboard.reconsider();
    const cursor = this.evaluationCursor;
    // The evaluation exit of THIS round: a real transition (not a budget trace) after the creation of the round's tasks.
    const line = await this.wait(`evaluation of round ${expectedRound}`, async () => {
      const creation = await this.base.pool.query<{ t: number }>(`SELECT (extract(epoch from max(created_at)) * 1000)::float8 AS t FROM tasks WHERE cycle_id = $1 AND iteration = $2 AND role <> 'contract' AND role <> 'scoping' AND role <> 'overlap'`, [this.cycleId, expectedRound]);
      const t = creation.rows[0]?.t;
      if (t === null || t === undefined) return undefined;
      return (await this.pilot.history(this.cycleId)).find((x) => x.id > cursor && x.t > t && x.previous_state === 'hardening_evaluation' && x.state !== 'hardening_evaluation');
    }, 20_000);
    this.evaluationCursor = line.id;
    // The scenario's cursor stops just before the evaluation exit: it checks it itself.
    this.cursors.set(this.cycleId, Math.max(this.cursors.get(this.cycleId) ?? 0, line.id - 1));
  } finally {
    engine.switchboard.auto = autoBefore;
    forge.switchboard.auto = autoForgeBefore;
  }
}

When('hardening round {int} is played with, for {string}, the deviations:', async function (this: World, number: number, r: string, table: DataTable) {
  const deviations = deviationsFromTable(table);
  await playRound.call(this, number, r, (id) => reportWithDeviations(role(r), id, deviations));
});
When('the next hardening round is played with, for {string}, the deviations:', async function (this: World, r: string, table: DataTable) {
  const deviations = deviationsFromTable(table);
  await playRound.call(this, null, r, (id) => reportWithDeviations(role(r), id, deviations));
});
When('hardening round {int} is played with, for {string}, a report whose category {string} is missing from the schema\'s closed list', async function (this: World, number: number, r: string, category: string) {
  await playRound.call(this, number, r, (id) => reportWithDeviations(role(r), id, [{ rule: 'SEC-IDOR', file: 'api/tools.js', category: category }]));
});

// E1: situations reached along the real path (rounds really played), never by forcing a counter.
Given('deviation {string} on {string} present in the last 2 rounds', { timeout: 120_000 }, async function (this: World, rule: string, file: string) {
  for (let i = 0; i < 2; i += 1) await playRound.call(this, null, 'security-reviewer', (id) => reportWithDeviations('security-reviewer', id, [{ rule, file }]));
});
Given('24 hardening rounds already played, each with fewer deviations than the previous one, all different', { timeout: 300_000 }, async function (this: World) {
  // Zero cost and duration during the setup: only the round cap must be able to trigger afterwards.
  const { engine: engine } = this.bench;
  const before = { cost: engine.defaultCost, duration: engine.defaultDuration_s };
  engine.defaultCost = 0;
  engine.defaultDuration_s = 0;
  try {
    for (let round = 1; round <= 24; round += 1) {
      const deviations = Array.from({ length: 26 - round }, (_, i) => ({ rule: 'SEC-IDOR', file: `api/round-${round}-${i + 1}.js` }));
      await playRound.call(this, round, 'security-reviewer', (id) => reportWithDeviations('security-reviewer', id, deviations));
    }
  } finally {
    engine.defaultCost = before.cost;
    engine.defaultDuration_s = before.duration;
  }
});

// ── Fake forge and deployments ──────────────────────────────────────────────────────────────────

When('the forge creates repository {string}', function (this: World, slug: string) {
  this.bench.forge.answer('repo', { type: 'ok' }, slug);
});
When('the forge refuses to create the repository with error {string}', function (this: World, reason: string) {
  this.bench.forge.answer('repo', { type: 'error', reason: reason });
});
When('the integration of the role branches succeeds', async function (this: World) {
  this.bench.forge.answer('integration', { type: 'ok' }, (await this.cycle()).slug);
});
When('the integration of the role branches fails with conflict {string}', async function (this: World, file: string) {
  this.bench.forge.answer('integration', { type: 'conflict', files: [file] }, (await this.cycle()).slug);
});
When('the forge accepts the squash into {string}', async function (this: World, _branch: string) {
  this.bench.forge.answer('merge', { type: 'ok' }, (await this.cycle()).slug);
});
When('the forge is unavailable during the squash into {string}', async function (this: World, _branch: string) {
  this.bench.forge.answer('merge', { type: 'error', reason: 'forge unavailable' }, (await this.cycle()).slug);
});
When('the iteration branch diff is checked per role', async function (this: World) {
  this.bench.forge.answer('merge', { type: 'out_of_scope', files: this.outOfScope }, (await this.cycle()).slug);
});
When('the mock-up answers the health check after {int} seconds', async function (this: World, _s: number) {
  this.bench.deployer.answer('mockup', { type: 'ok' }, (await this.cycle()).slug);
});
When('the mock-up does not answer the health check for {int} seconds', async function (this: World, s: number) {
  this.bench.deployer.answer('mockup', { type: 'failed', reason: `health check failed after ${s} s` }, (await this.cycle()).slug);
});
When('the Preview answers the health check after {int} seconds', async function (this: World, _s: number) {
  this.bench.deployer.answer('preview', { type: 'ok' }, (await this.cycle()).slug);
});
When('the Preview does not answer the health check for {int} seconds', async function (this: World, s: number) {
  this.bench.deployer.answer('preview', { type: 'failed', reason: `health check failed after ${s} s` }, (await this.cycle()).slug);
});
When('the Prod answers the health check after {int} seconds', async function (this: World, _s: number) {
  this.bench.deployer.answer('prod', { type: 'ok' }, (await this.cycle()).slug);
});
When('the Prod does not answer the health check for {int} seconds', async function (this: World, s: number) {
  this.bench.deployer.answer('prod', { type: 'failed', reason: `health check failed after ${s} s` }, (await this.cycle()).slug);
});
// D19 / B1: the candidate digest (last healthy Preview) changes without a new Gate 2; written with the engine's rights.
When('a healthy Preview deployment of digest {string} is recorded in the cycle after the approval', async function (this: World, emp: string) {
  const c = await this.cycle();
  await this.base.writeDeployment(c, 'preview', emp, `https://preview.example/${c.slug}`, 'ok', `op-${c.id}-late-preview`);
  assert.equal(await this.base.candidateDigest(c.id), emp);
});

// ── Messages: forge ─────────────────────────────────────────────────────────────────────────────

const checksFromTable = (table?: DataTable): PipelineCheck[] =>
  table === undefined ? [] : table.hashes().map((l) => ({ check: l['check']!, result: l['result'] as 'green' | 'red' }));

When('the forge signals {string} with result {string} and digest {string}', async function (this: World, type: string, result: string, emp: string) {
  assert.equal(type, 'ci_finished');
  this.pilot.digests.set(this.cycleId, emp);
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'ci_finished', outcome: result as 'green' | 'red', digest: emp, checks: [{ check: 'lint', result: 'green' }, { check: 'tests', result: 'green' }, { check: 'analysis', result: 'green' }] });
});
When('the forge signals {string} with result {string} and the failed checks:', async function (this: World, type: string, result: string, table: DataTable) {
  const checks = checksFromTable(table).map((k) => (this.details.has(k.check) ? { ...k, details: this.details.get(k.check) } : k));
  this.details.clear();
  const m: Message = type === 'ci_finished'
    ? { type: 'ci_finished', outcome: result as 'green' | 'red', checks: checks }
    : { type: 'preview_pipeline_finished', outcome: result as 'green' | 'red', checks: checks };
  await this.pilot.sendWhenExpected(this.cycleId, m);
});
// ADR-027: the log of a red job, as the watcher stores its tail (`logTail`) in the details of the next signal.
Given('check {string} of the next pipeline carries the log:', function (this: World, check: string, log: string) {
  this.details.set(check, { ...((this.details.get(check) as object | undefined) ?? {}), log_tail: logTail(log) });
});
// M5: the SARIF results the watcher reads in the log of the `analysis` job (GiteaForge.ciFinished), for the next signal.
Given('check {string} of the next CI carries the SARIF findings:', function (this: World, check: string, table: DataTable) {
  this.details.set(check, { runs: [{ results: table.hashes().map((l) => ({
    ruleId: l['ruleId'], fingerprints: { 'matchBasedId/v1': l['matchBasedId'] },
    locations: [{ physicalLocation: { artifactLocation: { uri: l['file'] }, region: { startLine: Number(l['line']) } } }],
  })) }] });
});
When('the delivery up to the CI replays', async function (this: World) {
  await this.pilot.driveUntil(this.cycleId, 'waiting_ci');
});
When('the forge signals {string} with result {string}', async function (this: World, type: string, result: string) {
  assert.equal(type, 'preview_pipeline_finished');
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'preview_pipeline_finished', outcome: result as 'green' | 'red', checks: [{ check: 'dast', result: 'green' }, { check: 'accessibility', result: 'green' }] });
});
When('the forge tries to signal a green CI with digest {string} and red check {string}', async function (this: World, emp: string, check: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'ci_finished', outcome: 'green', digest: emp, checks: [{ check: 'lint', result: 'green' }, { check: check, result: 'red' }] }).catch((e: Error) => { this.lastError = e.message; });
});
When('the forge stays silent for {int} minutes', async function (this: World, _min: number) {
  const before = await this.pilot.state(this.cycleId);
  await this.wait('forge delay elapsed', async () => ((await this.pilot.state(this.cycleId)) !== before ? true : undefined));
});
When('the delivery up to the Preview pipeline replays with digest {string}', async function (this: World, emp: string) {
  await this.pilot.driveUntil(this.cycleId, 'preview_pipeline', { ciDigest: emp });
  this.cursors.set(this.cycleId, (await this.pilot.history(this.cycleId)).at(-1)!.id);
});
When('the cycle enters gate {string}', async function (this: World, g: string) {
  await this.pilot.driveUntil(this.cycleId, state(g));
});

// ── Messages: requester and admin ───────────────────────────────────────────────────────────────

When('the requester sends scoping feedback {string}', async function (this: World, outcome: string) {
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'scoping_feedback', outcome: outcome as 'satisfied' | 'correction', actor_id: REQUESTER.id });
});
When('the requester sends scoping feedback {string} with text {string}', async function (this: World, outcome: string, text: string) {
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'scoping_feedback', outcome: outcome as 'satisfied' | 'correction', text: text, actor_id: REQUESTER.id });
});
When('the requester sends preview feedback {string}', async function (this: World, outcome: string) {
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'preview_feedback', outcome: outcome as 'satisfied' | 'bug' | 'new_capability', actor_id: REQUESTER.id });
});
When('the requester sends preview feedback {string} with text {string}', async function (this: World, outcome: string, text: string) {
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'preview_feedback', outcome: outcome as 'satisfied' | 'bug' | 'new_capability', text: text, actor_id: REQUESTER.id });
});
When('the requester sends message {string}', async function (this: World, text: string) {
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'requester_message', text: text, actor_id: REQUESTER.id });
});
When('the requester abandons from the chat', async function (this: World) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'requester_abandonment', actor_id: REQUESTER.id }).catch((e: Error) => { this.lastError = e.message; });
});

async function decide(this: World, outcome: string, g: string, extra: Partial<Extract<Message, { type: 'decision' }>> = {}) {
  this.mergesBefore = this.bench.forge.merges.get((await this.cycle()).slug) ?? 0;
  this.engineLogBefore = this.bench.engine.switchboard.log.length;
  this.forgeLogBefore = this.bench.forge.switchboard.log.length;
  // At Gate 2, the admin quotes the digest they approve (the one the dashboard shows them) unless the scenario gives it.
  const cite = g === 'gate_2' && outcome === 'approved' && extra.digest === undefined ? (await this.base.candidateDigest(this.cycleId)) ?? undefined : undefined;
  await this.pilot.sendWhenExpected(this.cycleId, { type: 'decision', gate: state(g), outcome: outcome as GateOutcome, actor_id: ADMIN.id, ...(cite === undefined ? {} : { digest: cite }), ...extra });
}
When('the admin decides {string} at gate {string}', async function (this: World, outcome: string, g: string) {
  await decide.call(this, outcome, g);
});
When('the admin decides {string} at gate {string} with text {string}', async function (this: World, outcome: string, g: string, text: string) {
  await decide.call(this, outcome, g, { comment: text });
});
When('the admin decides {string} at gate {string} with text {string}, new name {string} and new address {string}', async function (this: World, outcome: string, g: string, text: string, name: string, slug: string) {
  await decide.call(this, outcome, g, { comment: text, name, slug });
});
When('the admin tries to decide {string} at gate {string} with text {string} and new address {string}', async function (this: World, outcome: string, g: string, text: string, slug: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: outcome as GateOutcome, actor_id: ADMIN.id, comment: text, slug }).catch((e: Error) => { this.lastError = e.message; });
});
When('the admin decides {string} at gate {string} with a top-up of {int} $', async function (this: World, outcome: string, g: string, topUp: number) {
  await decide.call(this, outcome, g, { budget_top_up_usd: topUp });
});
When('the admin decides {string} at gate {string} for digest {string}', async function (this: World, outcome: string, g: string, emp: string) {
  await decide.call(this, outcome, g, { digest: emp });
});
When('the admin tries to approve gate {string} for digest {string}', async function (this: World, g: string, emp: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: 'approved', actor_id: ADMIN.id, digest: emp }).catch((e: Error) => { this.lastError = e.message; });
});
When('the admin tries to approve gate {string} for the candidate digest', async function (this: World, g: string) {
  this.lastError = '';
  const emp = (await this.base.candidateDigest(this.cycleId)) ?? undefined;
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: 'approved', actor_id: ADMIN.id, ...(emp === undefined ? {} : { digest: emp }) }).catch((e: Error) => { this.lastError = e.message; });
});
/** I0: the requester does not have the admin hat; the decision is refused before any state check. */
When('the requester tries to decide {string} at gate {string}', async function (this: World, outcome: string, g: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: outcome as GateOutcome, actor_id: REQUESTER.id }).catch((e: Error) => { this.lastError = e.message; });
});
When('the requester tries to cancel the cycle', async function (this: World) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'cancellation', actor_id: REQUESTER.id }).catch((e: Error) => { this.lastError = e.message; });
});
/** Actor merge (0010): the requester came back under a new subject (second actor), which the admin attached by a merge. */
Given('the admin has merged a second actor into the requester', async function (this: World) {
  this.secondActor = (await this.base.pool.query<{ id: string }>(`INSERT INTO actors (type, mail, display_name) VALUES ('human', $1, 'requester (new subject)') RETURNING id`, [REQUESTER_MAIL])).rows[0]!.id;
  await this.base.mergeActors(this.secondActor, REQUESTER.id, 'AD connector recreated, subject changed', ADMIN.id);
});
/** The second actor acts with the admin hat (read in their token): without the merge, they would approve the delivery of their own request. */
When('the requester\'s second actor tries to approve gate {string} for the candidate digest with the admin hat', async function (this: World, g: string) {
  this.lastError = '';
  const emp = (await this.base.candidateDigest(this.cycleId)) ?? undefined;
  await this.bench.orch.send(this.cycleId, { type: 'decision', gate: state(g), outcome: 'approved', actor_id: this.secondActor, ...(emp === undefined ? {} : { digest: emp }) }, ['admin']).catch((e: Error) => { this.lastError = e.message; });
});
When('the admin tries to approve gate {string} without citing a digest', async function (this: World, g: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: 'approved', actor_id: ADMIN.id }).catch((e: Error) => { this.lastError = e.message; });
});
When('the admin tries to decide {string} at gate {string} without a comment', async function (this: World, outcome: string, g: string) {
  this.lastError = '';
  await this.pilot.send(this.cycleId, { type: 'decision', gate: state(g), outcome: outcome as GateOutcome, actor_id: ADMIN.id }).catch((e: Error) => { this.lastError = e.message; });
});
When('the admin cancels the cycle', async function (this: World) {
  await this.pilot.send(this.cycleId, { type: 'cancellation', actor_id: ADMIN.id });
  releaseFreezes(this.bench); // a cycle held in a transient state resumes: it sees the cancellation while handling that state
});
When('an evolution request is filed for this tool', async function (this: World) {
  this.lastError = '';
  await this.pilot.createCycle(DEFAULT_SLUG + '-evolution', 'evolution', this.toolId).catch((e: Error) => { this.lastError = e.message; });
});

// ── Time passes (delays shortened by the configuration) ─────────────────────────────────────────

/** "N hours pass": wait for the next reminder or the next state change, otherwise the configured delay. */
async function hoursPass(this: World, hours: number, recipient: 'admin' | 'requester') {
  const reminderMs = Number(ENV_TEST['REMINDER_DELAY_MS']);
  for (let i = 0; i < hours / 24; i += 1) {
    const remindersBefore = this.bench.notifications.for(this.cycleId, recipient).filter((e) => e.content.startsWith('Reminder') || e.subject.startsWith('Reminder')).length;
    const historyBefore = (await this.pilot.history(this.cycleId)).length;
    const limit = Date.now() + reminderMs * 2;
    for (;;) {
      const reminders = this.bench.notifications.for(this.cycleId, recipient).filter((e) => e.content.startsWith('Reminder') || e.subject.startsWith('Reminder')).length;
      const hist = (await this.pilot.history(this.cycleId)).length;
      if (reminders > remindersBefore || hist > historyBefore || Date.now() > limit) break;
      await this.letThrough(20);
    }
  }
}
When('{int} hours pass without an answer from the requester', async function (this: World, h: number) {
  await hoursPass.call(this, h, 'requester');
});
When('{int} hours pass without an answer from the admin', async function (this: World, h: number) {
  await hoursPass.call(this, h, 'admin');
});
/** S6: "a week passes" = until the next weekly reminder (delay shortened by LONG_REMINDER_DELAY_MS). */
When('a week passes without an answer from the admin', async function (this: World) {
  const reminders = () => this.bench.notifications.for(this.cycleId, 'admin').filter((n) => n.subject.startsWith('Weekly reminder')).length;
  const before = reminders();
  await this.wait('weekly reminder', async () => (reminders() > before ? true : undefined), 3 * Number(ENV_TEST['LONG_REMINDER_DELAY_MS']));
});
When('{int} days pass without an answer from the requester', async function (this: World, _days: number) {
  const before = await this.pilot.state(this.cycleId);
  await this.wait('end of the pause', async () => ((await this.pilot.state(this.cycleId)) !== before ? true : undefined));
});

// ── Orchestrator startup (E10 bis) ──────────────────────────────────────────────────────────────

When('the orchestrator starts', async function (this: World) {
  const variable = this.lastError;
  // A real, empty database: we then check that the process started nothing in it (no DBOS schema, no workflow).
  this.startupDatabase = await this.emptyDatabases();
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...ENV_TEST, EUPADEV_EXTERNAL: 'fake-auto', ORCH_DATABASE_URL: this.startupDatabase };
  delete env[variable];
  const r = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf8', timeout: 30_000 });
  this.lastError = `${r.status} ${r.stderr}`;
});
