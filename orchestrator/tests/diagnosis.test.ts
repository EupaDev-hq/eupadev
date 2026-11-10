// Diagnosis of a blocked hardening (ADR-027): pure functions of src/hardening/diagnosis.ts, no database, no AI call.
// The fixture is the real cycle 5 of the lab (the PPE tool): what the task receives, the pre-check it can rely on, the
// reading of its report and the line the admin sees. The two other causes use synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { diagnosisContext, diagnosisMessage, earlyDiagnosisDue, precheck, readDiagnosis, taskFact } from '../src/hardening/diagnosis.ts';
import { compliantReport, diagnosisReport } from '../src/external/fakes.ts';
import { ReportValidator } from '../src/agent-engine/report.ts';
import { text } from '../src/i18n.ts';
import type { Task, DeviationRow } from '../src/db.ts';

const SCHEMA = new URL('../../tool-template/agents/report.schema.json', import.meta.url).pathname;
const cycle5 = JSON.parse(readFileSync(new URL('./fixtures/diagnosis-cycle-5.json', import.meta.url), 'utf8')) as {
  reason: string; budget: { cost_usd: number; cap_usd: number }; branches: { tests: number; builder: number }; tasks: Task[]; deviations: DeviationRow[]; expected_cause: string; plausible_report: unknown;
};
const task = (role: string, iteration: number, status: Task['status'], cost_usd: number, report: unknown): Task =>
  ({ id: `1-9-${iteration}-${role}`, role: role as Task['role'], iteration, step: 'hardening_execution', status, cost_usd, duration_s: 60, tree_hash: null, report });
const CAPPED = 'Claude Code stopped: budget cap reached (error_max_budget_usd, 80 turns, code 1)';

test('cycle 5 (platform_or_impossible): the task receives the tasks, the deviations per round, the reason, the budget, the branches and the pre-check; the pre-check names the builder stopped twice at its cap with no commit', () => {
  const ctx = diagnosisContext({ reason: cycle5.reason, budget: cycle5.budget, tasks: cycle5.tasks, deviations: cycle5.deviations, branches: cycle5.branches });
  assert.equal(ctx.reason, cycle5.reason);
  assert.deepEqual(ctx.budget, { cost_usd: 30.12, cap_usd: 40 });
  assert.deepEqual(ctx.branches, { tests: 3, builder: 0 });
  assert.deepEqual(ctx.tasks.map((t) => `${t.role}/${t.iteration}/${t.status}/${t.cost_usd}`), ['contract/1/done/2.9', 'tests/1/blocked/5.3', 'tests/2/done/0.21', 'security-reviewer/2/done/1.39', 'quality-reviewer/2/done/1.56', 'tests/3/done/2.02', 'builder/3/failed/8.39', 'builder/4/failed/8.35']);
  assert.deepEqual(ctx.tasks[6]!.report, { status: 'failed', reason: 'Claude Code stopped: budget cap reached (error_max_budget_usd, 79 turns, code 1)' });
  assert.deepEqual(ctx.tasks[3]!.report, { status: 'done', summary: 'The builder has not built anything: the repository only holds the template and the acceptance suite.', findings: [] });
  assert.deepEqual(ctx.deviations.map((d) => `${d.round}:${d.rule}`), ['1:report:tests', '3:report:builder', '4:report:builder', '4:code:unchanged:builder']);
  assert.deepEqual(ctx.precheck, [
    'builder: 2 attempts stopped at the task cap (round 3: $8.39, round 4: $8.35) and no commit on its branch: the agent delivered nothing — platform defect or impossible request',
    'tests blocked at round 1: "The contract does not say who can read /ppe" — a point the contract or the requester left open (unclear request)',
  ]);
  // A previous diagnosis of the cycle is never part of the data (nothing to diagnose about itself).
  assert.ok(!diagnosisContext({ ...cycle5, tasks: [...cycle5.tasks, task('diagnosis', 1, 'done', 1, {})], branches: null }).tasks.some((t) => t.role === 'diagnosis'));
});

test('cycle 5: a plausible report is valid against the schema and reads as platform_or_impossible; the gate line says to refuse and send the report, in English and in French', () => {
  const report = compliantReport('diagnosis', 't-5', { summary: 'The tool was never built.', diagnosis: cycle5.plausible_report });
  const v = new ReportValidator(SCHEMA).validate(report, { role: 'diagnosis', task_id: 't-5' });
  assert.ok(v.valid, JSON.stringify(v));
  const d = readDiagnosis(cycle5.plausible_report);
  assert.equal(d?.cause, cycle5.expected_cause);
  assert.deepEqual(d?.recommendation, { top_up_usd: null, question: null });
  const m = diagnosisMessage('done', report);
  const en = text('en', m.key, m.values);
  assert.match(en, /^Diagnosis — platform problem or impossible request: The part of the tool/);
  assert.match(en, /Evidence: builder: 2 attempts stopped at the task cap .*; security-reviewer, round 2/);
  assert.match(en, /Recommendation: refuse and send this report to the EupaDev maintainers\.$/);
  assert.match(text('fr', m.key, m.values), /^Diagnostic — problème de plateforme ou demande impossible : .*Recommandation : refuser et transmettre ce rapport aux mainteneurs d'EupaDev\.$/s);
});

test('slow_progress (synthetic): capped attempts with commits kept are work in progress; the line proposes the top-up', () => {
  const tasks = [task('tests', 1, 'done', 1.5, compliantReport('tests', 't')), task('builder', 1, 'failed', 8.4, { status: 'failed', reason: `${CAPPED}; its commits are kept on agent/ppe/9/builder` }), task('builder', 2, 'failed', 8.2, { status: 'failed', reason: CAPPED })];
  assert.deepEqual(precheck(tasks.map(taskFact), { tests: 2, builder: 7 }), ['builder: 2 attempts stopped at the task cap (round 1: $8.40, round 2: $8.20), 7 commit(s) kept on its branch: work in progress — slow progress']);
  // Forge not asked: the fact is still there, the branch state is said unknown.
  assert.match(precheck(tasks.map(taskFact), null)[0]!, /the state of its branch is unknown/);
  const report = diagnosisReport('t-1', 'slow_progress', 'The builder keeps its work between attempts and needs one more round.', { top_up_usd: 15 });
  assert.ok(new ReportValidator(SCHEMA).validate(report, { role: 'diagnosis', task_id: 't-1' }).valid);
  const m = diagnosisMessage('done', report);
  assert.match(text('en', m.key, m.values), /^Diagnosis — slow progress: The builder keeps its work.*Recommendation: continue with a top-up of about \$15\.00\.$/s);
  assert.match(text('fr', m.key, m.values), /rallonge d'environ 15\.00 \$/);
});

test('unclear_request (synthetic): a blocked task is a point left open; the line carries the exact question for the requester', () => {
  const tasks = [task('tests', 1, 'blocked', 2, { status: 'blocked', blocked_reason: 'The contract does not say which sites a manager sees' }), task('builder', 1, 'done', 5, compliantReport('builder', 't'))];
  const lines = precheck(tasks.map(taskFact), { tests: 0, builder: 4 });
  assert.deepEqual(lines, [
    'tests: never delivered in this cycle (round 1: blocked)',
    'tests blocked at round 1: "The contract does not say which sites a manager sees" — a point the contract or the requester left open (unclear request)',
  ]);
  const report = diagnosisReport('t-2', 'unclear_request', 'The agents do not know which sites a manager may see.', { question: 'Should a manager see every site, or only their own?' });
  const m = diagnosisMessage('done', report);
  assert.match(text('en', m.key, m.values), /^Diagnosis — unclear request: .*Recommendation: clarify by asking the requester: "Should a manager see every site, or only their own\?"$/s);
  assert.match(text('fr', m.key, m.values), /« Should a manager see every site, or only their own\? »$/);
});

test('fail-closed: a cause whose recommendation does not match, a missing field or a task that did not finish give "diagnosis unavailable", never a verdict', () => {
  const d = cycle5.plausible_report as Record<string, unknown>;
  assert.equal(readDiagnosis({ ...d, recommendation: { top_up_usd: 10, question: null } }), null, 'platform_or_impossible with a top-up');
  assert.equal(readDiagnosis({ ...d, cause: 'slow_progress' }), null, 'slow_progress without a top-up');
  assert.equal(readDiagnosis({ ...d, cause: 'slow_progress', recommendation: { top_up_usd: 10, question: 'and a question' } }), null, 'both');
  assert.equal(readDiagnosis({ ...d, cause: 'unclear_request', recommendation: { top_up_usd: null, question: '  ' } }), null, 'blank question');
  assert.equal(readDiagnosis({ ...d, cause: 'other' }), null);
  assert.equal(readDiagnosis({ ...d, evidence: [] }), null);
  assert.equal(readDiagnosis(null), null);
  assert.equal(readDiagnosis('text'), null);
  const unavailable = (status: Task['status'], report: unknown, why: string) => {
    const m = diagnosisMessage(status, report);
    assert.equal(m.key, 'gate.diagnosis.unavailable');
    assert.equal(text('en', m.key, m.values), `Diagnosis unavailable (${why}): decide with the information above.`);
  };
  unavailable('done', compliantReport('diagnosis', 't-3'), 'report without a usable diagnosis');
  unavailable('done', compliantReport('diagnosis', 't-3', { diagnosis: { ...d, recommendation: { top_up_usd: 3, question: null } } }), 'report without a usable diagnosis');
  unavailable('failed', { status: 'failed', reason: 'container stopped: OOM' }, 'container stopped: OOM');
  unavailable('blocked', { status: 'blocked', blocked_reason: 'no data' }, 'no data');
  unavailable('failed', null, 'task failed');
  // The schema refuses an unknown cause and an extra field (fail-closed at validation, before the reading).
  const v = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  assert.ok(!v(compliantReport('diagnosis', 't-4', { diagnosis: { ...d, cause: 'other' } })));
  assert.ok(!v(compliantReport('diagnosis', 't-4', { diagnosis: { ...d, extra: 1 } })));
  assert.ok(v(compliantReport('diagnosis', 't-4', { diagnosis: null })), 'null is the value of the other roles');
});

// ── ADR-027, first failed round: the trigger of the early diagnosis and the red checks' log tails in its data ─────────
const PIPELINE: DeviationRow = { iteration: 1, rule: 'preview:accessibility-preview', file: 'pipeline', category: null, finding_id: null, previous_id: null, source: 'orchestrator' };
const FINDING: DeviationRow = { iteration: 1, rule: 'SEC-IDOR', file: 'api/tools.js', category: null, finding_id: null, previous_id: null, source: 'security-reviewer' };
const round1 = [task('tests', 1, 'done', 1, {}), task('builder', 1, 'done', 2, {}), task('security-reviewer', 1, 'done', 1, {}), task('quality-reviewer', 1, 'done', 1, {})];

test('first failed round: due on a red check of the CI or of the Preview pipeline, never on the reviewers\' findings alone (paid cycle 9: five rounds paid on a Preview check the platform failed)', () => {
  assert.equal(earlyDiagnosisDue(round1, 1, 1, [PIPELINE]), true);
  assert.equal(earlyDiagnosisDue(round1, 1, 1, [FINDING]), false, 'a finding of the code is the agents\' to fix');
  assert.equal(earlyDiagnosisDue(round1, 1, 1, [{ ...FINDING, rule: 'ci:opengrep:8ef5fb06_0', file: 'web/app.js' }]), false, 'an Opengrep finding targets a file of the code');
  assert.equal(earlyDiagnosisDue([], 1, 0, []), false, 'no round played');
});

test('first failed round: due on a task that failed without being capped or refused by the schema (launcher, engine, container) or blocked on an open point (cycle 5 of the lab); not on a cap, a timeout or an invalid report', () => {
  const failed = (reason: string) => [task('tests', 1, 'done', 1, {}), task('builder', 1, 'failed', 4, { status: 'failed', reason })];
  assert.equal(earlyDiagnosisDue(failed('container stopped: OOM'), 1, 1, []), true);
  assert.equal(earlyDiagnosisDue(failed('task stopped without a recorded result (workflow ERROR)'), 1, 1, []), true);
  assert.equal(earlyDiagnosisDue(failed('Claude Code stopped: error during execution (error_during_execution, 3 turns, code 1)'), 1, 1, []), true);
  assert.equal(earlyDiagnosisDue(failed(CAPPED), 1, 1, []), false, 'a cap is the agent\'s own stop');
  assert.equal(earlyDiagnosisDue(failed('interrupted: task timeout exceeded (30 min)'), 1, 1, []), false);
  assert.equal(earlyDiagnosisDue(failed('invalid report: findings/0 must have required property rule'), 1, 1, []), false);
  assert.equal(earlyDiagnosisDue([task('tests', 1, 'blocked', 5.3, { status: 'blocked', blocked_reason: 'The contract does not say who can read /ppe' })], 1, 1, []), true);
  // Only the round that just ended counts: a failure of round 1 is not a reason to diagnose round 2 again.
  assert.equal(earlyDiagnosisDue([...failed('container stopped: OOM'), ...round1.map((t) => ({ ...t, iteration: 2 }))], 1, 2, []), false);
});

test('first failed round: once per situation — never when a diagnosis was created since the first hardening task of the round counted since the last reset; due again after a reset', () => {
  const diagnosed = [...round1, task('diagnosis', 1, 'done', 1.5, {})];
  assert.equal(earlyDiagnosisDue(diagnosed, 1, 1, [PIPELINE]), false, 'already diagnosed');
  assert.equal(earlyDiagnosisDue([...diagnosed, ...round1.map((t) => ({ ...t, iteration: 2 }))], 1, 2, [PIPELINE]), false, 'the stagnation rule takes over');
  // "Continue" at the gate: the counters count from round 2; the diagnosis of the gate predates the first task of round 2.
  assert.equal(earlyDiagnosisDue([...diagnosed, ...round1.map((t) => ({ ...t, iteration: 2 }))], 2, 2, [PIPELINE]), true);
  assert.equal(earlyDiagnosisDue([...diagnosed, ...round1.map((t) => ({ ...t, iteration: 2 })), task('diagnosis', 2, 'failed', 2, {})], 2, 2, [PIPELINE]), false, 'a failed diagnosis counts: one attempt per situation');
  // "Scope change" at the gate: the counters count from round 2 while the last round played is still round 1, whose blocked
  // task the gate already diagnosed; the contract task (iteration 2) is not a diagnosis. No second diagnosis before round 2.
  const scopeChanged = [task('tests', 1, 'done', 1, {}), task('builder', 1, 'blocked', 3, { status: 'blocked', blocked_reason: 'GET /tools/{id} has no site parameter' }), task('diagnosis', 1, 'done', 1.5, {}), task('contract', 2, 'done', 1, {})];
  assert.equal(earlyDiagnosisDue(scopeChanged, 2, 1, []), false, 'a round before the reset was diagnosed by the gate that reset the counters');
});

test('red checks: the task receives the red checks since the reset with the watcher\'s log tails, bounded (20 checks, 40 lines of 300 characters), and nothing from a check without a tail', () => {
  const tail = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  const rows = [
    { iteration: 1, pipeline: 'preview', check: 'accessibility-preview', details: { log_tail: tail } },
    { iteration: 1, pipeline: 'preview', check: 'acceptance', details: { failures: ['SEC-ROLE …'], log_tail: ['x'.repeat(400), 7, 'ok'] } },
    { iteration: 2, pipeline: 'ci', check: 'pipeline', details: {} },
  ];
  const ctx = diagnosisContext({ reason: 'r', budget: { cost_usd: 1, cap_usd: 40 }, tasks: [], deviations: [], redChecks: rows, branches: null });
  assert.deepEqual(ctx.red_checks.map((k) => `${k.round}:${k.pipeline}:${k.check}:${k.log_tail.length}`), ['1:preview:accessibility-preview:40', '1:preview:acceptance:2', '2:ci:pipeline:0']);
  assert.deepEqual([ctx.red_checks[0]!.log_tail[0], ctx.red_checks[0]!.log_tail.at(-1)], ['line 21', 'line 60']);
  assert.deepEqual(ctx.red_checks[1]!.log_tail, ['x'.repeat(300), 'ok']);
  assert.equal(diagnosisContext({ reason: 'r', budget: { cost_usd: 1, cap_usd: 40 }, tasks: [], deviations: [], redChecks: Array.from({ length: 25 }, (_, i) => ({ ...rows[0]!, iteration: i + 1 })), branches: null }).red_checks.length, 20);
  assert.deepEqual(diagnosisContext({ reason: cycle5.reason, budget: cycle5.budget, tasks: cycle5.tasks, deviations: cycle5.deviations, branches: cycle5.branches }).red_checks, [], 'cycle 5: no red check');
});
