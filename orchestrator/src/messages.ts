/**
 * Messages received by the W1 workflow `toolCycle` (ROADMAP §8.13, "Messages expected by W1"), all on a
 * single DBOS mailbox (`MAILBOX`) and processed in order of arrival. The ends of tasks (W2) and of external
 * operations are not messages: W1 reads the native status and result of its children (S4).
 *
 * A message coming from outside (human, forge) is fully validated by `validateMessage` before any send (A5):
 * an invalid message is refused to the caller with a clear error, never passed on. `visit` is set by
 * `Orchestrator.send`: the id of the current visit of the state (B9), so that a double send is never applied
 * twice, nor during a later visit of the same state.
 */
import type { Hat } from './auth.ts';
import type { CoreUpdate } from './external/contracts.ts';
import type { StateId, GateOutcome } from './machine/states.ts';
import { invisibleCharacter } from './text.ts';

export const MAILBOX = 'mailbox';

/**
 * I0 (ADR-017): a human message carries the person's internal id (`actors.id`, uuid), set by the API from the verified
 * token — never a name nor an e-mail declared by the caller; `hat` (the role under which the message is accepted) and
 * `four_eyes_exemption` are set by `Orchestrator.send` after authorisation, never received from the client.
 */
export interface Human { actor_id: string; hat?: Hat; visit?: number }
export const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PipelineCheck = { check: string; result: 'green' | 'red'; details?: unknown };

export type Message =
  | ({ type: 'scoping_feedback'; outcome: 'satisfied' | 'correction'; text?: string } & Human)
  | ({ type: 'preview_feedback'; outcome: 'satisfied' | 'bug' | 'new_capability'; text?: string } & Human)
  | ({ type: 'requester_abandonment' } & Human)
  | ({ type: 'requester_message'; text: string } & Human)
  | ({
      type: 'decision';
      gate: StateId;
      outcome: GateOutcome;
      comment?: string;
      budget_top_up_usd?: number;
      digest?: string;
      /** Four eyes (Gate 2) lifted by FOUR_EYES_EXEMPTION_SUBJECT: recorded in `approvals`. */
      four_eyes_exemption?: boolean;
    } & Human)
  | { type: 'ci_finished'; outcome: 'green' | 'red'; digest?: string; checks: PipelineCheck[]; visit?: number }
  | { type: 'preview_pipeline_finished'; outcome: 'green' | 'red'; checks: PipelineCheck[]; visit?: number }
  | ({ type: 'cancellation' } & Human);

export const HUMAN_TYPES = new Set<Message['type']>(['scoping_feedback', 'preview_feedback', 'requester_abandonment', 'requester_message', 'decision', 'cancellation']);
export const isHuman = (m: Message): m is Extract<Message, Human> => HUMAN_TYPES.has(m.type);

/** Result of an external operation (forge, deployment): output of the child workflow `externalOperation`. */
export type OperationResult =
  | { type: 'ok' }
  | { type: 'out_of_scope'; files: { file: string; role: string }[] }
  | { type: 'conflict'; files: string[] }
  | { type: 'deployment'; digest: string; url: string; health: 'ok' | 'failed'; reason?: string }
  /** Decision A: the core bump computed by the engine (executor); null = no core, or already on the latest version. */
  | { type: 'core'; update: CoreUpdate | null }
  | { type: 'error'; reason: string };

/** Trigger key `event:<name>[:<outcome>]` of a human or forge message, for the check on entry. */
export function eventKey(m: Message): string {
  switch (m.type) {
    case 'scoping_feedback':
    case 'preview_feedback':
    case 'ci_finished':
    case 'preview_pipeline_finished':
      return `event:${m.type}:${m.outcome}`;
    case 'requester_abandonment':
    case 'requester_message':
      return `event:${m.type}`;
    case 'decision':
      return `gate:${m.outcome}`;
    case 'cancellation':
      return 'cancellation';
  }
}

export const DIGEST_FORMAT = /^sha256:[0-9a-f]{64}$/;
/** Cap of a top-up (numeric(10, 2) in the db): beyond it, it is a typo. */
export const MAX_TOP_UP_USD = 100_000;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const actorId = (v: unknown): string | null => (typeof v === 'string' && UUID_FORMAT.test(v) ? null : 'actor_id: actor id (uuid) expected');
const among = (v: unknown, values: readonly string[]): boolean => typeof v === 'string' && values.includes(v);

function validateChecks(checks: unknown, outcome: string, red: string): string | null {
  if (!Array.isArray(checks)) return 'checks: array expected';
  for (const [i, k] of checks.entries()) {
    if (typeof k !== 'object' || k === null) return `checks[${i}]: object expected`;
    const c = k as Record<string, unknown>;
    if (!nonEmpty(c['check'])) return `checks[${i}].check: non-empty name expected`;
    if (!among(c['result'], ['green', 'red'])) return `checks[${i}].result: green or red expected`;
  }
  const redCount = checks.filter((k) => (k as { result: string }).result === 'red').length;
  if (outcome === red && redCount === 0) return `outcome ${outcome} without any red check`;
  if (outcome !== red && redCount > 0) return `outcome ${outcome} with ${redCount} red check(s)`;
  return null;
}

/**
 * Full validation of the CONTENT of a message coming from outside (A5), constraint by constraint of the schema
 * (`actor_id` in uuid format, non-empty `messages.content`, `approvals`: comment on a correction,
 * top-up > 0 with `approved` only, well-formed digest, `pipeline_results`…).
 * Returns the reason for the refusal, or null if the message is valid. What depends on the cycle's state (current
 * gate, possible outcome, candidate digest, phase of the top-up) is checked by `Orchestrator.send`.
 */
export function validateMessage(m: unknown): string | null {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return 'message: object expected';
  const x = m as Record<string, unknown>;
  // Free texts passed on to the agents (chat, clarification, catalogue description): never an invisible character
  // (zero-width, bidi, Unicode tags — "Rules File Backdoor").
  for (const field of ['text', 'comment']) {
    const invisible = typeof x[field] === 'string' ? invisibleCharacter(x[field]) : null;
    if (invisible !== null) return `${field}: invisible character refused (${invisible})`;
  }
  const optionalText = (): string | null => (x['text'] === undefined || nonEmpty(x['text']) ? null : 'text: non-empty string expected (or missing)');
  switch (x['type']) {
    case 'scoping_feedback':
      if (!among(x['outcome'], ['satisfied', 'correction'])) return 'outcome: satisfied or correction expected';
      return actorId(x['actor_id']) ?? optionalText();
    case 'preview_feedback':
      if (!among(x['outcome'], ['satisfied', 'bug', 'new_capability'])) return 'outcome: satisfied, bug or new_capability expected';
      return actorId(x['actor_id']) ?? optionalText();
    case 'requester_abandonment':
      return actorId(x['actor_id']);
    case 'requester_message':
      if (!nonEmpty(x['text'])) return 'text: non-empty expected';
      return actorId(x['actor_id']);
    case 'decision': {
      if (!nonEmpty(x['gate'])) return 'gate: non-empty expected';
      if (!among(x['outcome'], ['approved', 'correction', 'refused', 'scope_change'])) return 'outcome: approved, correction, refused or scope_change expected';
      if (actorId(x['actor_id']) !== null) return actorId(x['actor_id']);
      if (x['comment'] !== undefined && !nonEmpty(x['comment'])) return 'comment: non-empty string expected (or missing)';
      if ((x['outcome'] === 'correction' || x['outcome'] === 'scope_change') && !nonEmpty(x['comment'])) return `comment required for ${String(x['outcome'])}`;
      const r = x['budget_top_up_usd'];
      if (r !== undefined) {
        if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > MAX_TOP_UP_USD) return `budget_top_up_usd: number > 0 and ≤ ${MAX_TOP_UP_USD} expected`;
        if (x['outcome'] !== 'approved') return 'budget_top_up_usd: only with "approved"';
      }
      if (x['digest'] !== undefined && !(typeof x['digest'] === 'string' && DIGEST_FORMAT.test(x['digest']))) return 'digest: sha256:<64 hexadecimal digits> expected';
      return null;
    }
    case 'ci_finished':
      if (!among(x['outcome'], ['green', 'red'])) return 'outcome: green or red expected';
      if (x['digest'] !== undefined && !(typeof x['digest'] === 'string' && DIGEST_FORMAT.test(x['digest']))) return 'digest: sha256:<64 hexadecimal digits> expected';
      return validateChecks(x['checks'], x['outcome'] as string, 'red');
    case 'preview_pipeline_finished':
      if (!among(x['outcome'], ['green', 'red'])) return 'outcome: green or red expected';
      return validateChecks(x['checks'], x['outcome'] as string, 'red');
    case 'cancellation':
      return actorId(x['actor_id']);
    default:
      return `unknown message type: ${String(x['type'])}`;
  }
}
