// Anti-loop mechanisms M1 to M7 (ROADMAP §8.13 D20): pure functions, no database, no AI call.
// Each test replays a Gherkin scenario of the hardening-review feature (anti-loop section).
import { text } from '../src/i18n.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SARIF_MARKER } from '../src/external/gitea-forge.ts';
import { trees, counters, deduplicate, opengrepDeviations, evaluate, noProgress, SARIF_CHECK, type Deviation } from '../src/hardening/stagnation.ts';

const sec = (rule: string, extra: Partial<Deviation> = {}): Deviation => ({ rule, file: 'api/tools.js', category: 'security.md#Requests', source: 'security-reviewer', ...extra });

test('v1 case (E9 + D20): same deviation reworded for 3 rounds, line moved, label SEC-IDOR → SEC-URL → SEC-IDOR → stagnation by the category', () => {
  const t1 = [sec('SEC-IDOR', { id: 'F-001' })];
  const t2 = [sec('SEC-URL', { id: 'F-001' })]; // reworded, line 45, another valid label, same category, same file
  const t3 = [sec('SEC-IDOR', { id: 'F-001' })];
  const e = evaluate([t1, t2], t3);
  const c = e.counters[0]!;
  assert.equal(c.fine, 1, 'fine fingerprint broken by the drift (scenario 27 stays true)');
  assert.equal(c.category, 3);
  assert.equal(c.counter, 3);
  assert.ok(e.escalation);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M2-category']);
  assert.match(text('en', e.reasons[0]!.key, e.reasons[0]!.values), /stagnation/);
  assert.match(text('en', e.reasons[0]!.key, e.reasons[0]!.values), /security\.md#Requests.*api\/tools\.js/);
  // Without the safety net: in round 2 nothing escalates.
  assert.equal(evaluate([t1], t2).escalation, false);
});

test('scenario 27: a deviation gone for a round, then back, starts again at 1 (fine fingerprint and category); at round 4 patience escalates, not the deviation', () => {
  const idor = [sec('SEC-IDOR')];
  const xss = [{ rule: 'SEC-XSS', file: 'api/views.js', category: 'security.md#Responses', source: 'security-reviewer' }];
  const c = counters([idor, idor, xss, idor]);
  assert.deepEqual([c[0]!.fine, c[0]!.category, c[0]!.counter], [1, 1, 1]);
  assert.equal(counters([idor, idor])[0]!.fine, 2);
  assert.equal(evaluate([idor, idor], xss).escalation, false);
  // 1, 1, 1, 1 deviation: the minimum (1) dates from round 1, three evaluations without improvement → M3, and only M3.
  const e = evaluate([idor, idor, xss], idor);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M3-patience']);
});

test('M1: an invalid report (label outside the list) becomes the deviation report:<role>, which stagnates like the others', () => {
  const invalid: Deviation = { rule: 'report:security-reviewer', file: 'report', source: 'orchestrator' };
  assert.equal(evaluate([[invalid], [invalid]], [invalid]).escalation, true);
  assert.equal(evaluate([[invalid]], [invalid]).escalation, false);
});

test('M2: deduplication by (rule, file) — two reviewers, the same deviation, a single counter', () => {
  const a = sec('SEC-IDOR', { source: 'security-reviewer', id: 'F-001' });
  const b = sec('SEC-IDOR', { source: 'quality-reviewer', id: 'F-007' });
  assert.equal(deduplicate([a, b]).length, 1);
  assert.equal(counters([[a, b], [b, a]])[0]!.fine, 2);
});

test('M3: patience — 3, 2, 3, 2, 3 deviations all different → escalation at the 5th evaluation; 3, 2, 1 → none', () => {
  assert.equal(noProgress([3, 2, 3, 2]), false);
  assert.equal(noProgress([3, 2, 3, 2, 3]), true);
  assert.equal(noProgress([3, 2, 1]), false);
  assert.equal(noProgress([5, 5, 5]), false);
  assert.equal(noProgress([5, 5, 5, 5]), true);
  assert.equal(noProgress([]), false);
  // With labels that change every round (no M2 level holds).
  const round = (n: number, t: number) => Array.from({ length: n }, (_, i) => sec(`SEC-RULE${t}-${i}`, { file: `api/f${t}-${i}.js`, category: `security.md#C${t}` }));
  const rounds = [round(3, 1), round(2, 2), round(3, 3), round(2, 4)];
  assert.equal(evaluate(rounds.slice(0, 3), rounds[3]!).escalation, false);
  const e = evaluate(rounds, round(3, 5));
  assert.deepEqual(e.counts, [3, 2, 3, 2, 3]);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M3-patience']);
  // 3, 2, 1, 0: compliant, nothing to escalate.
  assert.equal(evaluate([round(3, 1), round(2, 2), round(1, 3)], []).escalation, false);
});

test('M4a: role tree unchanged after a round with deviations → deviation code:unchanged:<role>', () => {
  assert.deepEqual(trees({ builder: ['A', 'A'] }), { unchanged: ['builder'], oscillations: [] });
  assert.deepEqual(trees({ builder: ['A'] }), { unchanged: [], oscillations: [] });
  const e = evaluate([[sec('SEC-IDOR')]], [sec('SEC-IDOR')], { builder: ['A', 'A'], tests: ['F1', 'F2'] });
  assert.ok(e.deviations.some((x) => x.rule === 'code:unchanged:builder' && x.file === 'builder'));
  assert.equal(e.escalation, false, 'a single unchanged round: deviation, not escalation');
  // Three rounds without touching the code: the `code:unchanged` deviation itself stagnates.
  const unchanged: Deviation = { rule: 'code:unchanged:builder', file: 'builder' };
  assert.ok(evaluate([[sec('SEC-IDOR'), unchanged], [sec('SEC-URL'), unchanged]], [sec('SEC-ROLE')], { builder: ['A', 'A', 'A', 'A'] }).reasons.some((r) => r.mechanism === 'M2-fine'));
});

test('M4b: oscillation A → B → A → immediate escalation, even if the labels change', () => {
  assert.deepEqual(trees({ builder: ['A', 'B', 'A'] }), { unchanged: [], oscillations: ['builder'] });
  assert.deepEqual(trees({ builder: ['A', 'B', 'C', 'A'] }).oscillations, ['builder']);
  assert.deepEqual(trees({ builder: ['A', 'B', 'C'] }).oscillations, []);
  const e = evaluate([[sec('SEC-IDOR')], [{ rule: 'quality.md#API', file: 'api/tools.js', category: 'quality.md#API' }]], [sec('SEC-URL')], { builder: ['A', 'B', 'A'] });
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M4-oscillation']);
  assert.match(text('en', e.reasons[0]!.key, e.reasons[0]!.values), /oscillation.*builder/);
});

test('M5: the check whose SARIF details are read is the template\'s Opengrep job (Q5: it was `opengrep`, a name no job has)', () => {
  const ci = readFileSync(new URL('../../tool-template/.gitea/workflows/check.yml', import.meta.url), 'utf8');
  const jobs = ci.slice(ci.indexOf('\njobs:\n')).match(/^ {2}[a-z][a-z0-9-]*(?=:$)/gm)?.map((j) => j.trim()) ?? [];
  assert.ok(jobs.includes(SARIF_CHECK), `${SARIF_CHECK} is not a job of check.yml (${jobs.join(', ')})`);
  assert.match(ci, new RegExp(`^ {2}${SARIF_CHECK}:\\n(?:(?! {2}\\S).*\\n)*? +run: opengrep scan `, 'm'), 'that job runs Opengrep');
  // …and publishes what the watcher reads (opengrepSarif): SARIF file, then the marker and one result per line, in the same job.
  const job = ci.slice(ci.indexOf(`\n  ${SARIF_CHECK}:\n`) + 1).split(/\n(?= {2}\S)/)[0]!;
  assert.match(job, /run: opengrep scan .*--sarif-output=\/tmp\/opengrep\.sarif /, 'the scan writes its SARIF');
  assert.match(job, new RegExp(`if: failure\\(\\)\\n +run: \\|\\n(?: +.*\\n)*? +echo ${SARIF_MARKER}\\n +node -e .*/tmp/opengrep\\.sarif`), 'the findings step prints the marker then the results');
});

test('M5: Opengrep findings identified by matchBasedId (stable when moved); different ids → no M5 stagnation', () => {
  const sarif = (id: string, line: number) => ({ runs: [{ results: [{ ruleId: 'innerhtml-variable-text', fingerprints: { 'matchBasedId/v1': id }, locations: [{ physicalLocation: { artifactLocation: { uri: 'web/app.js' }, region: { startLine: line } } }] }] }] });
  const t1 = opengrepDeviations(sarif('abc_0', 10));
  const t2 = opengrepDeviations(sarif('abc_0', 13));
  const t3 = opengrepDeviations(sarif('abc_0', 17));
  assert.deepEqual(t1, [{ rule: 'ci:opengrep:abc_0', file: 'web/app.js', source: 'orchestrator' }]);
  const e = evaluate([t1, t2], t3);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M2-fine']);
  assert.match(text('en', e.reasons[0]!.key, e.reasons[0]!.values), /ci:opengrep:abc_0 web\/app\.js/);
  const others = evaluate([opengrepDeviations(sarif('a_0', 1)), opengrepDeviations(sarif('b_0', 1))], opengrepDeviations(sarif('c_0', 1)));
  assert.equal(others.escalation, false);
  // Without a fingerprint: fallback to ruleId; with nothing: ignored.
  assert.equal(opengrepDeviations({ runs: [{ results: [{ ruleId: 'r' }] }] })[0]!.rule, 'ci:opengrep:r');
  assert.deepEqual(opengrepDeviations({ runs: [{ results: [{}] }] }), []);
  assert.deepEqual(opengrepDeviations(null), []);
});

test('M7: previous_id inherits the counter of the referenced finding and never resets anything', () => {
  const t1 = [sec('SEC-IDOR', { id: 'F-001' })];
  // Round 2: another rule AND another category, but the reviewer says it is the same problem.
  const t2 = [sec('SEC-URL', { id: 'F-002', category: 'security.md#Authentication and sessions', previous_id: 'F-001' })];
  const c2 = counters([t1, t2])[0]!;
  assert.deepEqual([c2.fine, c2.category, c2.inherited, c2.counter], [1, 1, 2, 2]);
  // Round 3: same deviation as round 2, previous_id forgotten (null): the fine digest carries on, nothing is reset.
  const t3 = [sec('SEC-URL', { id: 'F-003', category: 'security.md#Authentication and sessions', previous_id: null })];
  const c3 = counters([t1, t2, t3])[0]!;
  assert.deepEqual([c3.fine, c3.category, c3.inherited], [2, 2, 0]);
  // Round 3 bis: previous_id filled in → 3 → "inherited" escalation.
  const t3bis = [sec('SEC-URL', { id: 'F-003', category: 'security.md#Authentication and sessions', previous_id: 'F-002' })];
  const e = evaluate([t1, t2], t3bis);
  assert.equal(e.counters[0]!.inherited, 3);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M7-inherited']);
  // previous_id unknown, or from another source: information ignored, counters intact.
  assert.equal(counters([t1, [sec('SEC-URL', { previous_id: 'F-999' })]])[0]!.inherited, 0);
  assert.equal(counters([t1, [sec('SEC-URL', { previous_id: 'F-001', source: 'quality-reviewer' })]])[0]!.inherited, 0);
});

test('order of the reasons: fine fingerprint, category, inherited, oscillation, patience; a single reason per deviation', () => {
  const t = [sec('SEC-IDOR', { id: 'F-001' })];
  const e = evaluate([t, t], t, { builder: ['A', 'B', 'A'] });
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M2-fine', 'M4-oscillation']);
});

test('B8: a single reason per (category, file), even if several labels of the round share it', () => {
  const t = (rule: string) => ({ rule, file: 'api/tools.js', category: 'security.md#Requests', source: 'security-reviewer' });
  const e = evaluate([[t('SEC-IDOR')], [t('SEC-URL')]], [t('SEC-ROLE'), t('SEC-VALID')]);
  assert.deepEqual(e.reasons.map((r) => r.mechanism), ['M2-category']);
});

test('A5 (defence in depth): an incomplete SARIF never produces a deviation the database would refuse (empty file or id)', () => {
  const sarif = { runs: [{ results: [
    { ruleId: 'r1', fingerprints: { 'matchBasedId/v1': 'abc_0' }, locations: [{ physicalLocation: { artifactLocation: { uri: '' } } }] },
    { ruleId: '', fingerprints: {} },
  ] }] };
  assert.deepEqual(opengrepDeviations(sarif), [{ rule: 'ci:opengrep:abc_0', file: 'pipeline', source: 'orchestrator' }]);
});
