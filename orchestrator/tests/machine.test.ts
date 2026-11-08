// "No dead end" test (ROADMAP §8.13) + targeted rules. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, INITIAL_STATE, GATE_OUTCOMES, DEFAULT_THRESHOLDS, TRANSITIONS, triggerKey, topUpEnvelope, isIncidentDetour, gateOutcomes, type StateId } from '../src/machine/states.ts';

const ids = new Set<string>(STATES.map((e) => e.id));
const ends = STATES.filter((e) => e.kind === 'end').map((e) => e.id);
const nonEnds = STATES.filter((e) => e.kind !== 'end');
const exitsOf = (id: StateId) => TRANSITIONS.filter((t) => t.from === id);
// Exits that change state (reminders with from === to are not exits).
const realExits = (id: StateId) => exitsOf(id).filter((t) => t.to !== t.from);

function reachable(since: StateId, noIncidentDetour = false): Set<StateId> {
  const seen = new Set<StateId>([since]);
  const pile: StateId[] = [since];
  for (let e = pile.pop(); e !== undefined; e = pile.pop()) {
    for (const t of exitsOf(e)) {
      if (noIncidentDetour && isIncidentDetour(t)) continue;
      if (!seen.has(t.to)) { seen.add(t.to); pile.push(t.to); }
    }
  }
  return seen;
}
/** Business path: the round trip through the incident gate (D21) returns to the original state, it opens no path. */
const walk = (since: StateId) => reachable(since, true);

test('(a) every non-end state has at least one exit that changes the state', () => {
  for (const e of nonEnds) assert.ok(realExits(e.id).length > 0, `dead end: ${e.id}`);
});

test('(a bis) an end has no exit, notifies the requester and cleans up', () => {
  for (const id of ends) {
    assert.equal(exitsOf(id).length, 0, `${id} has an exit`);
    const e = STATES.find((x) => x.id === id)!;
    assert.match(e.description, /notified/, `${id} does not notify the requester`);
    assert.match(e.description, /cleanup/, `${id} does not clean up`);
  }
});

test('(b) every state is reachable from the entry', () => {
  const seen = reachable(INITIAL_STATE);
  for (const e of STATES) assert.ok(seen.has(e.id), `unreachable: ${e.id}`);
});

test('(c) every end is reachable', () => {
  const seen = reachable(INITIAL_STATE);
  for (const id of ends) assert.ok(seen.has(id), `unreachable end: ${id}`);
});

test('(d) every waiting state and every gate has a timeout way out (exit or bounded reminder leading to an exit)', () => {
  for (const e of STATES.filter((x) => x.kind === 'waiting' || x.kind === 'gate')) {
    const timeouts = exitsOf(e.id).filter((t) => t.trigger.type === 'timeout_exceeded');
    assert.equal(timeouts.length, 1, `${e.id}: exactly one timeout_exceeded transition expected`);
    const d = timeouts[0]!;
    if (d.to === d.from) {
      assert.ok(typeof d.bound === 'number' && d.bound > 0, `${e.id}: unbounded repeat in place`);
      // After the bound, there must be a way out: either a "reminders exhausted" guard, or a
      // human decision that is always possible (gate: 3 outcomes; waiting: event).
      const after = realExits(e.id).filter((t) => t.trigger.type !== 'cancellation');
      assert.ok(after.length > 0, `${e.id}: bounded repeat with no way out afterwards`);
    }
  }
});

test('(e) every gate handles its three mandatory outcomes, each once; only Gate 1 and the hardening escalation have a 4th button (decision 2)', () => {
  for (const e of STATES.filter((x) => x.kind === 'gate')) {
    const issues = exitsOf(e.id)
      .filter((t) => t.trigger.type === 'gate')
      .map((t) => (t.trigger.type === 'gate' ? t.trigger.outcome : ''))
      .sort();
    // D21: the incident gate has no `correction` (an incident is not a matter of content); `approved` there is
    // the resume towards the original state (transitions resume:<state>, checked further down).
    const expected = e.id === 'gate_1' || e.id === 'gate_hardening_blocked' ? [...GATE_OUTCOMES, 'scope_change'] : e.id === 'gate_incident' ? ['refused'] : [...GATE_OUTCOMES];
    assert.deepEqual(issues, expected.sort(), `${e.id} : issues ${issues.join(',')}`);
    const refusal = exitsOf(e.id).find((t) => t.trigger.type === 'gate' && t.trigger.outcome === 'refused')!;
    assert.equal(refusal.to, 'end_refusal', `${e.id}: refusing must end the cycle`);
  }
  // And no gate outcome outside a gate.
  for (const t of TRANSITIONS.filter((t) => t.trigger.type === 'gate')) {
    assert.equal(STATES.find((e) => e.id === t.from)!.kind, 'gate', `${t.from} is not a gate`);
  }
});

test('(f) every non-final state has a cancellation exit to end_cancellation', () => {
  for (const e of nonEnds) {
    const a = exitsOf(e.id).filter((t) => t.trigger.type === 'cancellation');
    assert.equal(a.length, 1, `${e.id}`);
    assert.equal(a[0]!.to, 'end_cancellation');
  }
});

test('(g) no transition names a nonexistent state', () => {
  for (const t of TRANSITIONS) {
    assert.ok(ids.has(t.from), `unknown from: ${t.from}`);
    assert.ok(ids.has(t.to), `unknown to: ${t.to}`);
  }
  assert.ok(ids.has(INITIAL_STATE));
});

test('(h) no duplicate transition (same from + trigger)', () => {
  const seen = new Set<string>();
  for (const t of TRANSITIONS) {
    const k = `${t.from} ${triggerKey(t.trigger)}`;
    assert.ok(!seen.has(k), `duplicate: ${k}`);
    seen.add(k);
  }
  const stateIds = STATES.map((e) => e.id);
  assert.equal(new Set(stateIds).size, stateIds.length, 'duplicate state id');
});

test('(i) from every state, an end is reachable (no closed loop without a way out)', () => {
  for (const e of STATES) {
    const seen = reachable(e.id);
    assert.ok(ends.some((f) => seen.has(f)), `no end reachable from ${e.id}`);
  }
});

test('(j) a repeat in place is always bounded, a transition that changes the state never "bounded" without reason', () => {
  for (const t of TRANSITIONS) {
    if (t.to === t.from) assert.ok(t.bound !== undefined, `${t.from} ${triggerKey(t.trigger)}: unbounded repeat`);
  }
});

// ── Rules §8.13 ─────────────────────────────────────────────────────────────

test('Gate 1: reached only from candidate_image, which can skip it (evolution / already granted)', () => {
  const entries = TRANSITIONS.filter((t) => t.to === 'gate_1' && t.from !== 'gate_1' && !isIncidentDetour(t));
  assert.deepEqual(entries.map((t) => t.from), ['candidate_image']);
  const jump = exitsOf('candidate_image').find((t) => t.trigger.type === 'guard' && t.trigger.outcome === 'gate1_already_granted');
  assert.equal(jump?.to, 'preview_deployment');
});

test('Evolution: the entry skips overlap and repository creation', () => {
  const evo = exitsOf('request_received').find((t) => t.trigger.type === 'guard' && t.trigger.outcome === 'evolution');
  assert.equal(evo?.to, 'scoping');
});

test('Preview: bug → hardening, new capability → contract, never scoping (D6); satisfied → Gate 2 without running the pipeline again (S5)', () => {
  const s = exitsOf('waiting_preview_feedback');
  const par = (outcome: string) => s.find((t) => t.trigger.type === 'event' && t.trigger.outcome === outcome)?.to;
  assert.equal(par('bug'), 'hardening_execution');
  assert.equal(par('new_capability'), 'contract');
  assert.equal(par('satisfied'), 'gate_2');
  assert.ok(!s.some((t) => t.to === 'scoping'));
  assert.ok(!s.some((t) => t.to === 'preview_pipeline'), 'an already checked digest does not go through the pipeline again');
});

test('S5: the Preview checks run before the requester is told; a red one goes back to hardening without them', () => {
  const target = (from: StateId, k: string) => exitsOf(from).find((t) => triggerKey(t.trigger) === k)?.to;
  assert.equal(target('preview_deployment', 'task:done'), 'preview_pipeline');
  assert.equal(target('preview_pipeline', 'event:preview_pipeline_finished:green'), 'waiting_preview_feedback');
  assert.equal(target('preview_pipeline', 'event:preview_pipeline_finished:red'), 'hardening_execution');
  // The requester is only asked after a green pipeline: no other business entry into `waiting_preview_feedback`.
  const entries = TRANSITIONS.filter((t) => t.to === 'waiting_preview_feedback' && t.from !== 'waiting_preview_feedback' && !isIncidentDetour(t));
  assert.deepEqual(entries.map((t) => `${t.from} ${triggerKey(t.trigger)}`), ['preview_pipeline event:preview_pipeline_finished:green']);
  // Gate 2 is only opened by the `satisfied` feedback on this checked digest.
  const toGate2 = TRANSITIONS.filter((t) => t.to === 'gate_2' && t.from !== 'gate_2' && !isIncidentDetour(t));
  assert.deepEqual(toGate2.map((t) => `${t.from} ${triggerKey(t.trigger)}`), ['waiting_preview_feedback event:preview_feedback:satisfied']);
  // A `bug` from the requester produces a new digest, which goes through the pipeline again before any new feedback: the only
  // path from hardening to `waiting_preview_feedback` goes through `preview_pipeline`.
  const noPipeline = (since: StateId): Set<StateId> => {
    const seen = new Set<StateId>([since]);
    const pile: StateId[] = [since];
    for (let e = pile.pop(); e !== undefined; e = pile.pop()) {
      for (const t of exitsOf(e).filter((t) => !isIncidentDetour(t) && t.to !== 'preview_pipeline')) if (!seen.has(t.to)) { seen.add(t.to); pile.push(t.to); }
    }
    return seen;
  };
  assert.ok(!noPipeline('hardening_execution').has('waiting_preview_feedback'), 'the requester would be asked about an unchecked digest');
});

test('After the merge, no transition goes back to scoping', () => {
  const afterMerge = walk('merge');
  for (const id of afterMerge) {
    for (const t of exitsOf(id).filter((t) => !isIncidentDetour(t))) assert.notEqual(t.to, 'scoping', `${id} goes back to scoping`);
  }
});

// ── D21: "technical incident" gate ──────────────────────────────────────────

test('D21: every non-final state (except the incident gate) leads to gate_incident by the dedicated trigger "incident"', () => {
  for (const e of nonEnds.filter((e) => e.id !== 'gate_incident')) {
    const i = exitsOf(e.id).filter((t) => t.trigger.type === 'incident');
    assert.equal(i.length, 1, `${e.id}: one incident transition expected`);
    assert.equal(i[0]!.to, 'gate_incident');
  }
  // The incident trigger is used only for that, and nothing else enters the incident gate.
  for (const t of TRANSITIONS.filter((t) => t.to === 'gate_incident' && t.from !== 'gate_incident')) assert.equal(t.trigger.type, 'incident', `${t.from} enters gate_incident by ${triggerKey(t.trigger)}`);
  for (const t of TRANSITIONS.filter((t) => t.trigger.type === 'incident')) assert.equal(t.to, 'gate_incident');
});

test('D21: "retry" goes back to each possible original state, and only from the incident gate; refusing ends, the reminders are bounded', () => {
  const g = exitsOf('gate_incident');
  const resumes = g.filter((t) => t.trigger.type === 'resume');
  const origins = TRANSITIONS.filter((t) => t.trigger.type === 'incident').map((t) => t.from).sort();
  assert.deepEqual(resumes.map((t) => t.to).sort(), origins, 'one resume per original state');
  for (const t of resumes) assert.equal(triggerKey(t.trigger), `resume:${t.to}`, 'the resume key names its target: the trigger checks the origin');
  assert.deepEqual(TRANSITIONS.filter((t) => t.trigger.type === 'resume' && t.from !== 'gate_incident'), []);
  assert.equal(g.find((t) => triggerKey(t.trigger) === 'gate:refused')?.to, 'end_refusal');
  assert.equal(g.find((t) => t.trigger.type === 'cancellation')?.to, 'end_cancellation');
  assert.equal(g.find((t) => t.trigger.type === 'timeout_exceeded')?.bound, DEFAULT_THRESHOLDS.reminders.count);
  assert.ok(!g.some((t) => triggerKey(t.trigger) === 'gate:correction'));
  assert.deepEqual([...gateOutcomes('gate_incident')].sort(), ['approved', 'refused']);
  assert.deepEqual([...gateOutcomes('gate_1')].sort(), ['approved', 'correction', 'refused', 'scope_change']);
  assert.deepEqual([...gateOutcomes('scoping')], []);
});

test('D21: from the incident gate, a round trip to the origin creates no dead end (each origin keeps its own exits)', () => {
  for (const t of exitsOf('gate_incident').filter((t) => t.trigger.type === 'resume')) {
    assert.ok(realExits(t.to).some((s) => !isIncidentDetour(s) && s.trigger.type !== 'cancellation'), `${t.to}: no business exit`);
  }
});

test('B4: a top-up increases the envelope of its gate\'s phase (scoping / contract + hardening), none elsewhere', () => {
  assert.equal(topUpEnvelope('gate_scoping_budget'), 'scoping');
  assert.equal(topUpEnvelope('gate_scoping_blocked'), 'scoping');
  assert.equal(topUpEnvelope('gate_contract_blocked'), 'hardening');
  assert.equal(topUpEnvelope('gate_hardening_blocked'), 'hardening');
  for (const g of ['gate_overlap', 'gate_1', 'gate_2', 'gate_delivery_blocked', 'gate_prod_blocked', 'gate_incident'] as const) assert.equal(topUpEnvelope(g), null, g);
});

test('Failed review → evaluation (non-compliant), never the merge directly (fail-closed)', () => {
  const failure = exitsOf('hardening_review').find((t) => t.trigger.type === 'task' && t.trigger.result === 'failed');
  assert.equal(failure?.to, 'hardening_evaluation');
  const toMerge = TRANSITIONS.filter((t) => t.to === 'merge' && t.from !== 'gate_delivery_blocked' && !isIncidentDetour(t));
  assert.deepEqual(toMerge.map((t) => `${t.from} ${triggerKey(t.trigger)}`), ['hardening_evaluation guard:compliant']);
});

test('Cautious overlap: technical failure and unreadable report go to the gate', () => {
  const s = exitsOf('overlap_search');
  const target = (k: string) => s.find((t) => triggerKey(t.trigger) === k)?.to;
  assert.equal(target('task:failed'), 'gate_overlap');
  assert.equal(target('guard:unreadable_report'), 'gate_overlap');
  assert.equal(target('guard:plausible'), 'gate_overlap');
});

test('Red CI → hardening; silent scoping feedback → reminders, then pause → resume', () => {
  assert.equal(exitsOf('waiting_ci').find((t) => triggerKey(t.trigger) === 'event:ci_finished:red')?.to, 'hardening_execution');
  assert.equal(exitsOf('waiting_scoping_feedback').find((t) => triggerKey(t.trigger) === 'guard:reminders_exhausted')?.to, 'scoping_pause');
  assert.equal(exitsOf('scoping_pause').find((t) => triggerKey(t.trigger) === 'event:requester_message')?.to, 'mockup_deployment');
});

test('Budget (decision 12): one check per round, before launching it, never between two agents of the same round', () => {
  const withCheck = TRANSITIONS.filter((t) => triggerKey(t.trigger) === 'guard:budget_exceeded');
  assert.deepEqual(withCheck.map((t) => t.from).sort(), ['contract', 'hardening_execution', 'scoping']);
  for (const b of withCheck) assert.equal(STATES.find((e) => e.id === b.to)!.kind, 'gate', `${b.from} → ${b.to}`);
  // The round evaluation also escalates on the budget (note of the transition).
  const evaluation = exitsOf('hardening_evaluation').find((t) => triggerKey(t.trigger) === 'guard:escalation')!;
  assert.match(evaluation.note, /budget/);
});

test('D15: the counters (stagnation, cap, duration) also escalate on entering the round, without running an agent again', () => {
  const input = exitsOf('hardening_execution').find((t) => triggerKey(t.trigger) === 'guard:escalation');
  assert.equal(input?.to, 'gate_hardening_blocked');
  assert.match(input!.note, /stagnation.*cap.*duration/);
});

test('D17: 5 scoping attempts in total = 4 repeats in place', () => {
  const reminder = exitsOf('scoping').find((t) => triggerKey(t.trigger) === 'guard:technical_failure')!;
  assert.equal(reminder.bound, DEFAULT_THRESHOLDS.scoping.attempts_cap - 1);
  assert.match(exitsOf('mockup_deployment').find((t) => triggerKey(t.trigger) === 'guard:technical_failure')!.note, /5 attempts/);
});

// ── Ilan's decisions (18 questions settled) ─────────────────────────────────

test('Decisions 1 and 9: no end deletes; outside success, a creation is archived, an evolution leaves the tool in prod', () => {
  for (const id of ends) {
    const e = STATES.find((x) => x.id === id)!;
    assert.match(e.description, /never deleted|nothing is deleted/, `${id} does not say that nothing is deleted`);
    if (id !== 'end_success') {
      assert.match(e.description, /archived/, `${id} does not archive the creation`);
      assert.match(e.description, /evolution → the tool in prod goes on/, `${id} does not state the evolution case`);
    }
  }
  // 30-day pause without an answer: abandonment (archiving), not a dedicated end.
  const pause = exitsOf('scoping_pause').find((t) => t.trigger.type === 'timeout_exceeded')!;
  assert.equal(pause.to, 'end_abandonment');
  assert.match(pause.note, /30 days/);
  assert.equal(DEFAULT_THRESHOLDS.reminders.pause_archive_after_days, 30);
});

test('Decision 9: the requester can abandon before the merge only; after it, the admin cancels', () => {
  const abandons = TRANSITIONS.filter((t) => triggerKey(t.trigger) === 'event:requester_abandonment');
  assert.deepEqual(abandons.map((t) => t.from).sort(), ['scoping_pause', 'waiting_scoping_feedback']);
  for (const a of abandons) assert.equal(a.to, 'end_abandonment');
  const afterMerge = walk('merge');
  for (const a of abandons) assert.ok(!afterMerge.has(a.from), `${a.from} is after the merge`);
  for (const id of afterMerge) if (STATES.find((e) => e.id === id)!.kind !== 'end') {
    assert.ok(exitsOf(id).some((t) => t.trigger.type === 'cancellation'), `${id}: no admin cancellation`);
  }
});

test('Decision 13: reminders at 24/48/72 h, then pause at 96 h', () => {
  const r = DEFAULT_THRESHOLDS.reminders;
  assert.equal(r.interval_h, 24);
  assert.equal(r.count, 3);
  assert.equal(r.pause_after_h, r.interval_h * (r.count + 1));
  const reminder = exitsOf('waiting_scoping_feedback').find((t) => t.trigger.type === 'timeout_exceeded')!;
  assert.equal(reminder.bound, r.count);
  assert.equal(exitsOf('waiting_scoping_feedback').find((t) => triggerKey(t.trigger) === 'guard:reminders_exhausted')?.to, 'scoping_pause');
});

test('Decision 2: Gate 1 — "correction" → hardening, "scope change" → contract, never scoping', () => {
  const s = exitsOf('gate_1');
  const par = (k: string) => s.find((t) => triggerKey(t.trigger) === k)?.to;
  assert.equal(par('gate:correction'), 'hardening_execution');
  assert.equal(par('gate:scope_change'), 'contract');
  assert.equal(par('gate:approved'), 'preview_deployment');
  assert.ok(!s.some((t) => t.to === 'scoping'));
  // The only other gate with this button: the hardening escalation, for a defect of the frozen contract.
  assert.deepEqual(TRANSITIONS.filter((t) => triggerKey(t.trigger) === 'gate:scope_change').map((t) => t.from), ['gate_hardening_blocked', 'gate_1']);
});

test('Decision 11: red Preview pipeline → automatic hardening, green → requester feedback, then Gate 2 (S5); red CI likewise', () => {
  const target = (from: StateId, k: string) => exitsOf(from).find((t) => triggerKey(t.trigger) === k)?.to;
  assert.equal(target('preview_pipeline', 'event:preview_pipeline_finished:green'), 'waiting_preview_feedback');
  assert.equal(target('preview_pipeline', 'event:preview_pipeline_finished:red'), 'hardening_execution');
  assert.equal(target('preview_pipeline', 'event:preview_pipeline_finished'), undefined, 'no pipeline end without a colour any more');
  assert.equal(target('waiting_ci', 'event:ci_finished:red'), 'hardening_execution');
  // No pipeline transition leads to a gate other than "delivery blocked" (timeout): green goes through the requester.
  for (const t of realExits('preview_pipeline').filter((t) => !isIncidentDetour(t))) assert.ok(['waiting_preview_feedback', 'hardening_execution', 'gate_delivery_blocked', 'end_cancellation'].includes(t.to), t.to);
  // The admin must see what fails: the "hardening blocked" gate says so.
  assert.match(STATES.find((e) => e.id === 'gate_hardening_blocked')!.description, /which check fails.*for how many rounds/);
});

test('Decision 6: "continue" without a top-up when the budget is what blocks triggers the same gate again', () => {
  for (const b of TRANSITIONS.filter((t) => triggerKey(t.trigger) === 'guard:budget_exceeded')) {
    const approved = exitsOf(b.to).find((t) => triggerKey(t.trigger) === 'gate:approved')!;
    const back = exitsOf(approved.to).find((t) => triggerKey(t.trigger) === 'guard:budget_exceeded');
    assert.equal(back?.to, b.to, `${b.to}: approving without a top-up does not loop back to the gate`);
  }
});

test('Decisions 3, 4, 5, 14: technical failures routed to a dedicated gate, without a marker to confirm', () => {
  const target = (from: StateId, k: string) => exitsOf(from).find((t) => triggerKey(t.trigger) === k)?.to;
  assert.equal(target('repo_creation', 'task:failed'), 'gate_scoping_blocked');
  assert.equal(target('contract', 'task:failed'), 'gate_contract_blocked');
  assert.equal(target('gate_contract_blocked', 'gate:approved'), 'contract');
  for (const [from, k] of [['waiting_ci', 'timeout_exceeded'], ['preview_pipeline', 'timeout_exceeded'], ['preview_deployment', 'task:failed'], ['merge', 'task:failed']] as const) {
    assert.equal(target(from, k), 'gate_delivery_blocked', `${from} ${k}`);
  }
  assert.equal(target('gate_delivery_blocked', 'gate:approved'), 'merge', 'retry starts again from the merge');
  // D19: the Prod deployment failure has its gate, whose "retry" only restarts the Prod deployment.
  assert.equal(target('prod_deployment', 'task:failed'), 'gate_prod_blocked');
  assert.equal(target('gate_prod_blocked', 'gate:approved'), 'prod_deployment');
  assert.deepEqual(TRANSITIONS.filter((t) => t.to === 'gate_prod_blocked' && t.from !== 'gate_prod_blocked' && !isIncidentDetour(t)).map((t) => t.from), ['prod_deployment']);
  assert.equal(DEFAULT_THRESHOLDS.forge.ci_wait_max_min, 60);
});

test('Arbitration A: an out-of-scope diff at the merge is a round deviation (→ hardening), not a technical block', () => {
  const s = exitsOf('merge');
  const target = (k: string) => s.find((t) => triggerKey(t.trigger) === k);
  assert.equal(target('guard:diff_out_of_scope')?.to, 'hardening_execution');
  assert.match(target('guard:diff_out_of_scope')!.note, /scope:<file>/);
  assert.equal(target('task:failed')?.to, 'gate_delivery_blocked');
  // The automatic returns to hardening after the merge: red CI, red pipeline, out-of-scope diff.
  const returns = TRANSITIONS.filter((t) => t.to === 'hardening_execution' && STATES.find((e) => e.id === t.from)!.phase === 'delivery' && t.trigger.type !== 'gate' && !isIncidentDetour(t))
    .map((t) => `${t.from} ${triggerKey(t.trigger)}`).sort();
  assert.deepEqual(returns, ['merge guard:diff_out_of_scope', 'preview_pipeline event:preview_pipeline_finished:red', 'waiting_ci event:ci_finished:red', 'waiting_preview_feedback event:preview_feedback:bug']);
});

test('Decision 17: resuming after the pause starts the mock-up again, then handles the message as feedback', () => {
  const resume = exitsOf('scoping_pause').find((t) => triggerKey(t.trigger) === 'event:requester_message')!;
  assert.equal(resume.to, 'mockup_deployment');
  assert.equal(exitsOf('mockup_deployment').find((t) => triggerKey(t.trigger) === 'task:done')?.to, 'waiting_scoping_feedback');
});

// ── Generated files up to date ───────────────────────────────────────────────

test('the latest generated migration (*_state-machine.sql) matches states.ts; 0002 is never regenerated', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { generateSql } = await import('../scripts/generate-transitions.ts');
  const files = readdirSync('migrations').filter((f) => /^\d{4}_state-machine\.sql$/.test(f)).sort();
  const last = files.at(-1)!;
  assert.ok(files.length >= 2 && last > '0002_state-machine.sql', 'the machine changed since 0002: a more recent generated migration must exist');
  assert.equal(readFileSync(`migrations/${last}`, 'utf8'), generateSql(), `run again: node scripts/generate-transitions.ts migrations/${last} (or a new number if it is already applied on the lab)`);
  assert.match(readFileSync('migrations/0002_state-machine.sql', 'utf8'), /^DELETE FROM states;$/m, '0002 (applied everywhere) keeps its original form');
});

test('the mermaid diagram of MACHINE.md matches states.ts', async () => {
  const { readFileSync } = await import('node:fs');
  const { generateBlock } = await import('../scripts/generate-mermaid.ts');
  assert.ok(readFileSync('MACHINE.md', 'utf8').includes(generateBlock()), 'run again: node scripts/generate-mermaid.ts');
});
