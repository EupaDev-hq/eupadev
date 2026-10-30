/**
 * State machine of a tool's cycle (W1 workflow `toolCycle`). SINGLE source: the `allowed_transitions` table,
 * the mermaid diagram of MACHINE.md and the "no dead end" tests are derived from it; nothing is hand-written elsewhere.
 *
 * Kinds: `active` (task or technical step), `waiting` (human or forge), `gate` (admin decision with three mandatory
 * outcomes, Gate 1 has a fourth one), `end` (no exit: notifies the requester, cleans up, deletes nothing).
 * Triggers: `task`, `guard`, `event`, `gate`, `timeout_exceeded`, `cancellation`, `incident`, `resume:<state>`.
 * A `from === to` transition is a bounded repeat (`bound`) that does not change the state in the database.
 *
 * The rules and their reasons (budget, counters, stagnation, blocking gates, incident…) are in ROADMAP.md §8.13
 * (D1–D23); the mapping to v1 in MACHINE.md.
 */
import type { Role } from '../external/contracts.ts';

export type Phase = 'entry' | 'scoping' | 'contract' | 'hardening' | 'delivery' | 'cross_cutting' | 'end';
export type Kind = 'active' | 'waiting' | 'gate' | 'end';
export type GateOutcome = 'approved' | 'correction' | 'refused' | 'scope_change';
/** The three outcomes every gate must handle. */
export const GATE_OUTCOMES: readonly GateOutcome[] = ['approved', 'correction', 'refused'];

export type Trigger =
  | { type: 'event'; name: string; outcome?: string }
  | { type: 'task'; result: 'done' | 'failed' }
  | { type: 'guard'; outcome: string }
  | { type: 'gate'; outcome: GateOutcome }
  | { type: 'timeout_exceeded' }
  | { type: 'cancellation' }
  /** D21: unexpected internal error while handling a state (W1 error boundary). */
  | { type: 'incident' }
  /** D21: "retry" at the incident gate, back to the state the incident came from (checked by the database). */
  | { type: 'resume'; state: StateId };

/** Text key of a trigger, as written in `cycles.last_trigger`. */
export function triggerKey(d: Trigger): string {
  switch (d.type) {
    case 'event':
      return d.outcome === undefined ? `event:${d.name}` : `event:${d.name}:${d.outcome}`;
    case 'task':
      return `task:${d.result}`;
    case 'guard':
      return `guard:${d.outcome}`;
    case 'gate':
      return `gate:${d.outcome}`;
    case 'timeout_exceeded':
      return 'timeout_exceeded';
    case 'cancellation':
      return 'cancellation';
    case 'incident':
      return 'incident';
    case 'resume':
      return `resume:${d.state}`;
  }
}

export const STATES = [
  // ── Entry ─────────────────────────────────────────────────────────────────
  { id: 'request_received', phase: 'entry', kind: 'active', description: 'Authenticated request received; cycle created (creation or evolution)' },
  { id: 'overlap_search', phase: 'entry', kind: 'active', description: 'Agent task: does a tool of the registry already cover the need? (creation only)' },
  { id: 'gate_overlap', phase: 'entry', kind: 'gate', description: 'The admin decides on a plausible overlap, a technical failure or an unreadable report' },
  { id: 'repo_creation', phase: 'entry', kind: 'active', description: 'Creation of the repository from the template, idempotent (does nothing if the repository exists)' },
  // ── Scoping ───────────────────────────────────────────────────────────────
  { id: 'scoping', phase: 'scoping', kind: 'active', description: 'Budget check, then the scoping agent task (mock-up + specification)' },
  { id: 'gate_scoping_budget', phase: 'scoping', kind: 'gate', description: 'Cycle budget (scoping) reached: the admin continues (top-up), clarifies or refuses' },
  { id: 'gate_scoping_blocked', phase: 'scoping', kind: 'gate', description: 'Repeated technical failures, attempts cap or duration: the admin decides' },
  { id: 'mockup_deployment', phase: 'scoping', kind: 'active', description: 'W4: deployment of the mock-up on <tool>.scoping.<domain>, wait for availability + health' },
  { id: 'waiting_scoping_feedback', phase: 'scoping', kind: 'waiting', description: 'The requester looks at the mock-up and answers in the chat (reminders at 24/48/72 h)' },
  { id: 'scoping_pause', phase: 'scoping', kind: 'waiting', description: 'Requester silent for 96 h (3 reminders): mock-up stopped, admin told; their free message resumes the cycle as a correction request; 30 days without an answer → abandonment and archiving' },
  // ── Contract ──────────────────────────────────────────────────────────────
  { id: 'contract', phase: 'contract', kind: 'active', description: 'Agent task: OpenAPI + Gherkin scenarios from the validated scope' },
  { id: 'gate_contract_blocked', phase: 'contract', kind: 'gate', description: 'Contract failed technically or hardening budget (same envelope) reached: the admin decides' },
  // ── Hardening ─────────────────────────────────────────────────────────────
  { id: 'hardening_execution', phase: 'hardening', kind: 'active', description: 'Guard-rail checks (budget, then stagnation / cap / duration), then the tests task, then the builder task (only the roles concerned, ADR-021)' },
  { id: 'hardening_integration', phase: 'hardening', kind: 'active', description: 'Merge of the role branches onto the iteration branch; a conflict becomes a deviation for the file\'s owner role' },
  { id: 'hardening_review', phase: 'hardening', kind: 'active', description: 'Fan-out of the security review / quality review, read-only' },
  { id: 'hardening_evaluation', phase: 'hardening', kind: 'active', description: 'Evaluation of the round: compliance (fail-closed, deviations from the agents, the CI and the Preview pipeline, tree digest per role), stagnation (cascade rule+file / category+file / previous_id, patience, oscillation — D20), cap, duration, budget' },
  { id: 'gate_hardening_blocked', phase: 'hardening', kind: 'gate', description: 'Escalation (stagnation — precise reason: fine fingerprint, same category in the file, inherited deviation, no progress, oscillation —, cap, duration, budget): the admin sees which check fails, its result and for how many rounds (pipeline_results, deviations, tasks.report); continue (top-up), clarify or refuse' },
  // ── Delivery ──────────────────────────────────────────────────────────────
  { id: 'merge', phase: 'delivery', kind: 'active', description: 'Diff check per role (out of scope = round deviation, back to hardening), then squash into main by the orchestrator account' },
  { id: 'waiting_ci', phase: 'delivery', kind: 'waiting', description: 'The CI builds the image once and publishes its digest' },
  { id: 'candidate_image', phase: 'delivery', kind: 'active', description: 'Digest recorded; Gate 1 required only once per tool' },
  { id: 'gate_1', phase: 'delivery', kind: 'gate', description: 'Gate 1: name and domain of the tool (once per tool, skipped for an evolution); two correction buttons: "correction" or "scope change"' },
  { id: 'preview_deployment', phase: 'delivery', kind: 'active', description: 'W4: deployment of the digest to Preview' },
  { id: 'preview_pipeline', phase: 'delivery', kind: 'waiting', description: 'Pipeline 2 against the Preview (perf, accessibility, DAST, acceptance suite), before any feedback from the requester; results recorded against the digest (pipeline_results); red → hardening, green → link sent to the requester' },
  { id: 'waiting_preview_feedback', phase: 'delivery', kind: 'waiting', description: 'The requester tries a Preview whose checks are green: validated → Gate 2 without running the pipeline again, or two correction buttons: bug or new capability' },
  { id: 'gate_2', phase: 'delivery', kind: 'gate', description: 'Gate 2: approval of a precise digest, with the results and the dependencies diff' },
  { id: 'prod_deployment', phase: 'delivery', kind: 'active', description: 'Promotion: W4 deploys the approved digest to Prod; the deployments row (prod) stands for the release, no dedicated table' },
  { id: 'gate_delivery_blocked', phase: 'delivery', kind: 'gate', description: 'Technical block after the merge (merge failure, silent CI or pipeline, failed Preview deployment): the admin decides; "retry" starts again from the merge' },
  { id: 'gate_prod_blocked', phase: 'delivery', kind: 'gate', description: 'Failed Prod deployment: the admin runs again only the Prod deployment of the same approved digest, clarifies or refuses; the last healthy prod deployment stays the reference (D19)' },
  // ── Cross-cutting ─────────────────────────────────────────────────────────
  { id: 'gate_incident', phase: 'cross_cutting', kind: 'gate', description: 'Technical incident (D21): an unexpected internal error interrupted the handling of a state; the admin sees the exact error, retries (back to the original state, taken from the history and checked by the database) or refuses; reminders at 24/48/72 h' },
  // ── Ends ──────────────────────────────────────────────────────────────────
  { id: 'end_success', phase: 'end', kind: 'end', description: 'Tool in production: requester notified, cleanup (iteration branches, mock-up containers, scoping subdomain); nothing is deleted in the database' },
  { id: 'end_abandonment', phase: 'end', kind: 'end', description: 'Abandonment by the requester before the merge, or a 30-day pause without an answer: notified, cleanup; creation → tool archived (never deleted), evolution → the tool in prod goes on' },
  { id: 'end_refusal', phase: 'end', kind: 'end', description: 'Refusal by the admin at a gate: requester notified, cleanup; creation → tool archived (never deleted), evolution → the tool in prod goes on' },
  { id: 'end_cancellation', phase: 'end', kind: 'end', description: 'Cancellation by the admin (E15, the only way to stop after the merge): containers stopped, requester notified, cleanup; creation → tool archived (never deleted), evolution → the tool in prod goes on' },
] as const satisfies readonly { id: string; phase: Phase; kind: Kind; description: string }[];

export type StateId = (typeof STATES)[number]['id'];
export type State = (typeof STATES)[number];

export const INITIAL_STATE: StateId = 'request_received';

/** Caps of ONE agent task: duration (launcher timer), turns (`--max-turns`), budget (`--max-budget-usd`, cost of a failure without a known cost). */
export interface TaskCap { duration_min: number; turns: number; budget_usd: number }
/**
 * A-R5 (agents research §6.3): PROVISIONAL values of the measurement pass, to be measured — wide safety nets, the same for
 * every role. After the pass: record duration, turns, tokens and cost per role, then set ≈ 1.5 × the observed value.
 */
const MEASUREMENT_NET: TaskCap = { duration_min: 60, turns: 150, budget_usd: 10 };
/**
 * Scoping roles (overlap, scoping): budget below the scoping envelope ($10), otherwise a single lost task (unknown
 * cost = cap) would exhaust it (Ilan's decision of 2026-10-18, option a); duration and turns stay wide.
 */
const SCOPING: TaskCap = { ...MEASUREMENT_NET, budget_usd: 4 };

/** Default thresholds (ROADMAP §8.13), adjustable per installation. */
export const DEFAULT_THRESHOLDS = {
  scoping: {
    budget_usd: 10,
    /** Safety net: technical attempts IN TOTAL (mock-up deployment failures included), D17. */
    attempts_cap: 5,
    /** Same error N times in a row (mock-up deployment failures included), D17. */
    stagnation: 3,
    /** A-R5: provisional, measurement pass (was 120). */
    agent_work_duration_min: 240,
  },
  hardening: {
    /**
     * Main guard-rail (D1). The contract has no envelope of its own: it is counted here (D16). A-R5: provisional,
     * measurement pass — 10 + 40 = $50 per cycle, without top-up during this pass (an admin rule, not a code one).
     */
    budget_usd: 40,
    /** Safety net. */
    rounds_cap: 25,
    /** Same deviation N consecutive rounds — cascade rule + file, then category + file, then previous_id (D20 M2/M7); a tier missing for one round restarts at 1. */
    stagnation: 3,
    /** Patience (D20 M3): number of deduplicated deviations without a new minimum for N evaluations → "no progress" escalation. */
    patience: 3,
    /** A-R5: provisional, measurement pass (was 120). */
    agent_work_duration_min: 240,
  },
  /** Caps per role (A-R5, replaces the single cap 15 min / 40 turns / $3): one line per role, enforced by the type. */
  task: {
    overlap: SCOPING,
    scoping: SCOPING,
    contract: MEASUREMENT_NET,
    tests: MEASUREMENT_NET,
    /** The builder does the work of the former back and front in one task: same wide safety net as the other roles, to be measured (A-R1 on A-R5). */
    builder: MEASUREMENT_NET,
    'security-reviewer': MEASUREMENT_NET,
    'quality-reviewer': MEASUREMENT_NET,
  } satisfies Readonly<Record<Role, TaskCap>> as Readonly<Record<Role, TaskCap>>,
  reminders: {
    /** Interval between two reminders to a human. */
    interval_h: 24,
    /** 24 / 48 / 72 h. */
    count: 3,
    /** Pause 24 h after the 3rd reminder (requester, scoping); admin gate: "waiting > 72 h". Decision 13. */
    pause_after_h: 96,
    /** Pause without an answer: abandonment, tool archived (never deleted). Decision 1. */
    pause_archive_after_days: 30,
  },
  forge: {
    /** CI or pipeline silent beyond this: "delivery blocked" gate (decision 14). */
    ci_wait_max_min: 60,
    /** Availability of the mock-up / Preview after deployment (≥ 60 s). */
    availability_wait_s: 60,
  },
  /** Order of the escalation reasons shown to the admin. */
  escalation_reasons_order: ['stagnation', 'cap', 'duration', 'budget'],
} as const;

export interface Transition {
  from: StateId;
  to: StateId;
  trigger: Trigger;
  /** What happens, in one line. */
  note: string;
  /** Bounded repeat (from === to): maximum number of repeats. */
  bound?: number;
}

const task = (result: 'done' | 'failed'): Trigger => ({ type: 'task', result: result });
const guard = (outcome: string): Trigger => ({ type: 'guard', outcome: outcome });
const event = (name: string, outcome?: string): Trigger =>
  outcome === undefined ? { type: 'event', name: name } : { type: 'event', name: name, outcome: outcome };
const gate = (outcome: GateOutcome): Trigger => ({ type: 'gate', outcome: outcome });
const DELAY: Trigger = { type: 'timeout_exceeded' };

/** The three outcomes of an admin gate, plus the bounded reminder (D4). */
function gateExits(
  from: StateId,
  approved: StateId,
  correction: StateId,
  approvedNote: string,
  noteCorrection: string,
): Transition[] {
  return [
    { from, to: approved, trigger: gate('approved'), note: approvedNote },
    { from, to: correction, trigger: gate('correction'), note: noteCorrection },
    { from, to: 'end_refusal', trigger: gate('refused'), note: 'Refusal: end of the cycle, requester notified, cleanup' },
    { from, to: from, trigger: DELAY, bound: DEFAULT_THRESHOLDS.reminders.count, note: 'Reminder to the admin (24/48/72 h); beyond: "waiting > 72 h" on the dashboard and one reminder a week (notification, no trace) until the decision' },
  ];
}

const EXPLICIT_TRANSITIONS: readonly Transition[] = [
  // ── Entry ─────────────────────────────────────────────────────────────────
  { from: 'request_received', to: 'overlap_search', trigger: guard('creation'), note: 'New tool: overlap search before any scoping' },
  { from: 'request_received', to: 'scoping', trigger: guard('evolution'), note: 'Evolution of an existing tool: neither overlap nor repository creation, cycle budget at zero' },

  { from: 'overlap_search', to: 'repo_creation', trigger: guard('not_plausible'), note: 'No overlap: the repository is created' },
  { from: 'overlap_search', to: 'gate_overlap', trigger: guard('plausible'), note: 'Plausible overlap: the admin decides, with the agent\'s reason' },
  { from: 'overlap_search', to: 'gate_overlap', trigger: guard('unreadable_report'), note: 'Invalid report: "to be checked", never "not plausible" by default (v1 deviation)' },
  { from: 'overlap_search', to: 'gate_overlap', trigger: task('failed'), note: 'Technical failure: the admin decides, to be safe' },

  ...gateExits('gate_overlap', 'repo_creation', 'repo_creation',
    'No redundancy: the repository is created',
    'The admin\'s clarification is passed to the first scoping as data'),

  { from: 'repo_creation', to: 'scoping', trigger: task('done'), note: 'Repository created (or already there on replay): branch protections applied' },
  { from: 'repo_creation', to: 'gate_scoping_blocked', trigger: task('failed'), note: 'The forge refuses or does not answer after the retries: "scoping blocked" gate, whose "continue" goes through repo_creation again (idempotent) (decision 3)' },

  // ── Scoping ───────────────────────────────────────────────────────────────
  { from: 'scoping', to: 'gate_scoping_budget', trigger: guard('budget_exceeded'), note: 'Check once per round, before launching it (E2, decision 12): cycle budget reached' },
  { from: 'scoping', to: 'mockup_deployment', trigger: task('done'), note: 'Valid report: the mock-up is built by the CI and deployed' },
  // 5 attempts in total = 4 retries (D17); a `mockup_deployment` failure counts as one attempt.
  { from: 'scoping', to: 'scoping', trigger: guard('technical_failure'), bound: DEFAULT_THRESHOLDS.scoping.attempts_cap - 1, note: 'Technical failure: run again with the error in the context; counter of attempts (5 in total, mock-up included) and of repetitions of the same error (D17)' },
  { from: 'scoping', to: 'gate_scoping_blocked', trigger: guard('escalation'), note: 'Same error 3 times, 5 attempts in total or work duration exceeded' },

  ...gateExits('gate_scoping_budget', 'scoping', 'scoping',
    'Continue: top-up = approved + approvals.budget_top_up_usd (D2, decision 6); without a top-up, the budget check triggers this gate again at once',
    'The admin\'s text becomes the instruction of the next scoping'),

  ...gateExits('gate_scoping_blocked', 'repo_creation', 'repo_creation',
    'Continue: counters reset, never the cost; goes through repo_creation again (idempotent, also covers a failed repository creation), then scoping',
    'The admin\'s text becomes the instruction of the next scoping'),

  { from: 'mockup_deployment', to: 'waiting_scoping_feedback', trigger: task('done'), note: 'Mock-up available (health check OK): link sent to the requester' },
  { from: 'mockup_deployment', to: 'scoping', trigger: guard('technical_failure'), note: 'Failed deployment: scoping run again with the error; counts in the 5 attempts and in "same error ×3" (D17; as in v1, where a deployment failure was a scoping failure)' },
  { from: 'mockup_deployment', to: 'gate_scoping_blocked', trigger: guard('escalation'), note: 'Same error 3 times, 5 attempts in total or work duration exceeded: the admin decides' },

  { from: 'waiting_scoping_feedback', to: 'contract', trigger: event('scoping_feedback', 'satisfied'), note: 'Scope validated by the requester: the contract is produced' },
  { from: 'waiting_scoping_feedback', to: 'scoping', trigger: event('scoping_feedback', 'correction'), note: 'Not satisfied: new scoping round with the whole chat history (E7)' },
  { from: 'waiting_scoping_feedback', to: 'end_abandonment', trigger: event('requester_abandonment'), note: 'The requester abandons from the chat' },
  { from: 'waiting_scoping_feedback', to: 'waiting_scoping_feedback', trigger: DELAY, bound: DEFAULT_THRESHOLDS.reminders.count, note: 'Reminder to the requester at 24, 48, 72 h; no agent run again (decision 13)' },
  { from: 'waiting_scoping_feedback', to: 'scoping_pause', trigger: guard('reminders_exhausted'), note: 'Silence 24 h after the 3rd reminder (96 h): pause, mock-up stopped, admin told (D4, decision 13)' },

  { from: 'scoping_pause', to: 'mockup_deployment', trigger: event('requester_message'), note: 'The requester\'s answer resumes where things stopped: mock-up started again, then their free message is handled as a correction request (scoping run again with that message) (decision 17, D18)' },
  { from: 'scoping_pause', to: 'end_abandonment', trigger: event('requester_abandonment'), note: 'The requester abandons from the chat' },
  { from: 'scoping_pause', to: 'end_abandonment', trigger: DELAY, note: 'Pause without an answer for 30 days: abandonment, requester and admin notified, tool archived — never deleted (decision 1)' },

  // ── Contract ──────────────────────────────────────────────────────────────
  { from: 'contract', to: 'hardening_execution', trigger: task('done'), note: 'Contract versioned in the repository: parallel work becomes possible' },
  { from: 'contract', to: 'gate_contract_blocked', trigger: task('failed'), note: 'Technical failure (or blocked agent, decision 7): dedicated gate so that "continue" runs the contract again and not the scoping or the hardening (decision 4)' },
  { from: 'contract', to: 'gate_contract_blocked', trigger: guard('budget_exceeded'), note: 'Budget check once before the launch (E2, decision 12); the contract is counted in the hardening envelope ($20), no threshold of its own (D16)' },

  ...gateExits('gate_contract_blocked', 'contract', 'contract',
    'Continue (top-up = approved + amount; without a top-up when the budget is what blocks, the gate triggers again): the contract is run again',
    'The admin\'s text becomes the instruction of the contract'),

  // ── Hardening ─────────────────────────────────────────────────────────────
  { from: 'hardening_execution', to: 'gate_hardening_blocked', trigger: guard('budget_exceeded'), note: 'Check once per round, before the fan-out (E2, decision 12); overrun bounded by (tasks of the round) × cap per task' },
  { from: 'hardening_execution', to: 'gate_hardening_blocked', trigger: guard('escalation'), note: 'Check of the counters on entering the round, like the budget: stagnation (cascade rule + file / category + file / previous_id, patience, pipeline/CI/scope included — D20), rounds cap or duration reached before running a single agent again (D15)' },
  { from: 'hardening_execution', to: 'hardening_integration', trigger: task('done'), note: 'All the tasks of the round finished (explicit fan-in, E4)' },
  { from: 'hardening_execution', to: 'hardening_evaluation', trigger: task('failed'), note: 'A code task failed or blocked (blocked = failed, reason shown to the admin, decision 7): round non-compliant (fail-closed), unknown cost = the task\'s cap' },

  { from: 'hardening_integration', to: 'hardening_review', trigger: task('done'), note: 'Iteration branch integrated (conflicts resolved by the integration task if needed)' },
  { from: 'hardening_integration', to: 'hardening_evaluation', trigger: task('failed'), note: 'Integration impossible: round non-compliant' },

  { from: 'hardening_review', to: 'hardening_evaluation', trigger: task('done'), note: 'Reports of both reviewers and of the tests received' },
  { from: 'hardening_review', to: 'hardening_evaluation', trigger: task('failed'), note: 'Failed review or report invalid against the schema: non-compliant, counts as an iteration (v1 fail-open deviation)' },

  { from: 'hardening_evaluation', to: 'merge', trigger: guard('compliant'), note: 'No deviation, all reviews valid: merge' },
  { from: 'hardening_evaluation', to: 'hardening_execution', trigger: guard('non_compliant'), note: 'Deviations routed to the owner roles (file → folder → role), reports of the previous round passed on (E8)' },
  { from: 'hardening_evaluation', to: 'gate_hardening_blocked', trigger: guard('escalation'), note: 'Non-compliant and stagnation (D20: rule + file or category + file or previous_id for 3 consecutive rounds, no new minimum of deviations for 3 evaluations, or a role\'s Git tree back to an earlier state; a red CI/pipeline check counts as a deviation rule = <pipeline>:<check>, Opengrep by matchBasedId, unchanged code as a deviation code:unchanged:<role>), cap, duration or budget: escalation in that order' },

  ...gateExits('gate_hardening_blocked', 'hardening_execution', 'hardening_execution',
    'Continue: counters at zero (never the cost), top-up = approved + amount; without a top-up when the budget is what blocks, the gate triggers again',
    'The admin\'s text becomes the instruction of the next round'),

  // ── Delivery ──────────────────────────────────────────────────────────────
  { from: 'merge', to: 'waiting_ci', trigger: task('done'), note: 'Squash into main; the CI starts' },
  { from: 'merge', to: 'hardening_execution', trigger: guard('diff_out_of_scope'), note: 'Out-of-scope diff (file outside the role, rules or CI touched): not a technical block — round deviation rule = scope:<file> passed on to the roles concerned, counters kept; stagnation / budget / cap / duration escalate if it loops (arbitration A, like the red pipeline)' },
  { from: 'merge', to: 'gate_delivery_blocked', trigger: task('failed'), note: 'Real technical failure of the merge (Git error, forge unavailable): the admin decides (decision 5)' },

  { from: 'waiting_ci', to: 'candidate_image', trigger: event('ci_finished', 'green'), note: 'Image built once, digest published' },
  { from: 'waiting_ci', to: 'hardening_execution', trigger: event('ci_finished', 'red'), note: 'Red CI: automatic return to hardening with the failed checks (pipeline_results), counters kept' },
  { from: 'waiting_ci', to: 'gate_delivery_blocked', trigger: DELAY, note: 'CI silent for 60 min: the admin decides (decision 14)' },

  { from: 'candidate_image', to: 'gate_1', trigger: guard('gate1_required'), note: 'First delivery of the tool: Gate 1 (name, domain)' },
  { from: 'candidate_image', to: 'preview_deployment', trigger: guard('gate1_already_granted'), note: 'Gate 1 already granted (approvals) or evolution cycle: skipped unconditionally (D5)' },

  ...gateExits('gate_1', 'preview_deployment', 'hardening_execution',
    'Name and domain approved, once for the whole life of the tool',
    '"Correction" button (contract unchanged): instruction passed to hardening, never to scoping (decision 2)'),
  { from: 'gate_1', to: 'contract', trigger: gate('scope_change'), note: '"Scope change" button: the contract is reviewed with the admin\'s text (decision 2)' },

  // S5 (note 2026-10-26 acceptance-on-preview §3.5): the controls run on the fresh Preview before the requester is told.
  { from: 'preview_deployment', to: 'preview_pipeline', trigger: task('done'), note: 'Preview deployed by digest, health OK: pipeline 2 against that digest before the requester is told (decision 11)' },
  { from: 'preview_deployment', to: 'gate_delivery_blocked', trigger: task('failed'), note: 'Failed Preview deployment: the admin decides (decision 5)' },

  { from: 'preview_pipeline', to: 'waiting_preview_feedback', trigger: event('preview_pipeline_finished', 'green'), note: 'All checks green, recorded against the digest: Preview link sent to the requester; the results are shown at Gate 2 (decision 11)' },
  { from: 'preview_pipeline', to: 'hardening_execution', trigger: event('preview_pipeline_finished', 'red'), note: 'At least one red check: automatic return to hardening with the failed checks (pipeline_results), without disturbing the requester, counters kept; the hardening guard-rails escalate if it loops (decision 11)' },
  { from: 'preview_pipeline', to: 'gate_delivery_blocked', trigger: DELAY, note: 'Pipeline silent for 60 min: the admin decides (decision 14)' },

  { from: 'waiting_preview_feedback', to: 'gate_2', trigger: event('preview_feedback', 'satisfied'), note: 'Preview validated by the requester on an already checked digest: Gate 2, without running the pipeline again' },
  { from: 'waiting_preview_feedback', to: 'hardening_execution', trigger: event('preview_feedback', 'bug'), note: 'The requester\'s "bug" button, contract unchanged: hardening, never scoping (D6, decision 8); the new digest goes through the pipeline again before new feedback' },
  { from: 'waiting_preview_feedback', to: 'contract', trigger: event('preview_feedback', 'new_capability'), note: 'The requester\'s "new capability" button: the contract is reviewed (D6, decision 8)' },
  { from: 'waiting_preview_feedback', to: 'waiting_preview_feedback', trigger: DELAY, bound: DEFAULT_THRESHOLDS.reminders.count, note: 'Reminder to the requester ×3, then "waiting > 72 h" on the dashboard (after the merge: no pause, no abandonment by the requester — the admin cancels, decision 9)' },

  ...gateExits('gate_2', 'prod_deployment', 'hardening_execution',
    'Precise digest approved: promotion',
    'Correction requested: instruction passed to hardening'),

  { from: 'prod_deployment', to: 'end_success', trigger: task('done'), note: 'Same digest in Prod, health OK, deployments row (prod) written — no releases table (decision 16), registry up to date' },
  { from: 'prod_deployment', to: 'gate_prod_blocked', trigger: task('failed'), note: 'Failed Prod deployment: dedicated gate, the last healthy prod deployment stays the reference (decision 5, D19)' },

  ...gateExits('gate_delivery_blocked', 'merge', 'hardening_execution',
    'Retry: start again from the merge (idempotent), which runs CI → Preview → … again without any agent task (decision 5)',
    'Correction requested: instruction passed to hardening'),

  ...gateExits('gate_prod_blocked', 'prod_deployment', 'hardening_execution',
    'Retry: runs again only the Prod deployment of the same digest approved at Gate 2, without redoing merge, CI, Preview or Gate 2 (D19)',
    'Correction requested: instruction passed to hardening'),
];

const NON_ENDS = STATES.filter((e) => e.kind !== 'end');

/** Cancellation by the admin from any non-final state (E15), generated once and for all. */
const CANCELLATION_TRANSITIONS: readonly Transition[] = NON_ENDS.map((e) => ({
  from: e.id,
  to: 'end_cancellation',
  trigger: { type: 'cancellation' },
  note: 'Cancellation by the admin: workflow cancelled, containers stopped, traced; creation → tool archived, evolution → the tool in prod goes on (decision 9)',
}));

/** D21: technical incident from any non-final state, and "retry" towards each one (the origin is checked by the database). */
const TRANSITIONS_INCIDENT: readonly Transition[] = [
  ...NON_ENDS.filter((e) => e.id !== 'gate_incident').flatMap((e): Transition[] => [
    { from: e.id, to: 'gate_incident', trigger: { type: 'incident' }, note: 'Unexpected internal error while handling the state (after the automatic retries): running tasks and operations stopped, exact error shown to the admin, workflow still alive (D21)' },
    { from: 'gate_incident', to: e.id, trigger: { type: 'resume', state: e.id }, note: '"Retry": back to the incident\'s original state, and to it alone (last incident row of the history, checked by the trigger); the state is handled again from the start (D21)' },
  ]),
  { from: 'gate_incident', to: 'end_refusal', trigger: gate('refused'), note: 'Refusal: end of the cycle, requester notified, cleanup' },
  { from: 'gate_incident', to: 'gate_incident', trigger: DELAY, bound: DEFAULT_THRESHOLDS.reminders.count, note: 'Reminder to the admin (24/48/72 h); beyond: "waiting > 72 h" on the dashboard and one reminder a week (notification, no trace) until the decision' },
];

export const TRANSITIONS: readonly Transition[] = [...EXPLICIT_TRANSITIONS, ...TRANSITIONS_INCIDENT, ...CANCELLATION_TRANSITIONS];

/** Incident and resume transitions (D21): a round trip to the original state, to be ignored when reasoning about the business path. */
export const isIncidentDetour = (t: Transition): boolean => t.trigger.type === 'incident' || t.trigger.type === 'resume';

/**
 * Outcomes an admin can choose at a gate, derived from the transitions: `gate:<issue>`, plus `approved` at the
 * incident gate (= retry, `resume:<state>` transitions). Empty for a state that is not a gate.
 */
export function gateOutcomes(state: StateId): Set<GateOutcome> {
  const issues = new Set<GateOutcome>();
  for (const t of TRANSITIONS) {
    if (t.from !== state) continue;
    if (t.trigger.type === 'gate') issues.add(t.trigger.outcome);
    if (t.trigger.type === 'resume') issues.add('approved');
  }
  return issues;
}

/**
 * Budget envelope that a top-up (`approved` + amount, D12) increases at this gate, according to the gate's phase
 * (B4): scoping → scoping budget; contract and hardening → hardening budget (D16); elsewhere, a top-up
 * makes no sense (null).
 */
export function topUpEnvelope(state: StateId): 'scoping' | 'hardening' | null {
  const phase = STATES.find((e) => e.id === state)?.phase;
  return phase === 'scoping' ? 'scoping' : phase === 'contract' || phase === 'hardening' ? 'hardening' : null;
}
