/**
 * Chat commands in plain words (ADR-031, S1): what a typed sentence means, among the actions the current state allows
 * for the person's hat — or `unclear`. Nothing here decides anything: the page posts the message itself
 * (`POST /messages`), under the same checks as a click. Three pieces:
 * 1. the allowed set, computed from the state machine (`TRANSITIONS`, `gateOutcomes`, `topUpEnvelope`): the enum the
 *    reader may answer from; empty for a hat that has nothing to say in this state (a requester at a gate, anyone where
 *    nothing is expected), and then the reader is not called;
 * 2. the `IntentReader` contract and its fake, built from the page's word lists (`web/words.js`): every test runs
 *    without an AI call (ADR-013 spirit); the model reader (executor, AI proxy) comes with S3;
 * 3. the re-validation of any answer, whoever gave it: outside the set, a top-up without an amount, an amount with
 *    another name, over the cap or at a gate without an envelope → `unclear`. A top-up stays a top-up: it never
 *    becomes an approval (Ilan, 2026-11-07).
 */
import type { Hat } from './auth.ts';
import { TRANSITIONS, gateOutcomes, topUpEnvelope, type GateOutcome, type StateId } from './machine/states.ts';
import { MAX_TOP_UP_USD } from './messages.ts';
// @ts-expect-error -- JavaScript module shared with the page, without type declarations (like the core's in contract.ts)
import * as shared from '../web/words.js';

/** The page's word lists, typed here: one list for the browser's degraded mode and the fake reader. */
const { words, YES, FILLER } = shared as { words: (text: string) => string[]; YES: Set<string>; FILLER: Set<string> };

/** The requester's feedback outcomes and own actions, the admin's gate outcomes, plus the top-up at the envelope gates. */
export type IntentName = 'satisfied' | 'correction' | 'bug' | 'new_capability' | 'abandon' | 'message' | GateOutcome | 'top_up';
export type Intent = { intent: IntentName | 'unclear'; amount_usd?: number };
export const UNCLEAR: Intent = { intent: 'unclear' };

export interface IntentQuery {
  hat: Hat;
  state: StateId;
  /** The only names the reader may answer (besides `unclear`); never empty when the reader is called. */
  allowed: ReadonlySet<IntentName>;
  lang: 'fr' | 'en';
  /** Key of the question the page is showing, if any ("did you mean to approve?"): "yes" then answers it. */
  pendingQuestion?: string;
  text: string;
}
/**
 * What a reader returns, before re-validation: the fake's answer is already of this shape, a model's is checked. `reply`:
 * the model's own words for the person, like any LLM chat (the echo of what it understood, its question back, "that is
 * the admin's call"); the page shows it as plain text instead of its dictionary line. The fake never has any.
 */
export type IntentReading = Intent & { tokens?: { input: number; output: number }; reply?: string };
export interface IntentReader {
  /** Recorded with each sentence (`intents.reader`): the model id, or `words` for the fake. */
  readonly id: string;
  read(q: IntentQuery): Promise<IntentReading>;
}

/**
 * The actions `hat` may mean in `state`, from the machine: the requester's feedback events (`scoping_feedback`,
 * `preview_feedback`: their outcome), abandonment and free message; the admin's gate outcomes (`gateOutcomes`, retry =
 * `approved` at the incident gate) and `top_up` where the gate's phase has an envelope. An admin at a requester's wait
 * gets nothing (the page tells them so), like a requester at a gate.
 */
export function allowedIntents(state: StateId, hat: Hat): Set<IntentName> {
  const set = new Set<IntentName>();
  if (hat === 'requester') {
    for (const t of TRANSITIONS) {
      if (t.from !== state || t.trigger.type !== 'event') continue;
      const d = t.trigger;
      if ((d.name === 'scoping_feedback' || d.name === 'preview_feedback') && d.outcome !== undefined) set.add(d.outcome as IntentName);
      else if (d.name === 'requester_abandonment') set.add('abandon');
      else if (d.name === 'requester_message') set.add('message');
    }
  }
  if (hat === 'admin') {
    for (const o of gateOutcomes(state)) set.add(o);
    if (set.size > 0 && topUpEnvelope(state) !== null) set.add('top_up');
  }
  return set;
}

/**
 * Re-validation of a reading (the model's JSON, or the fake's answer) against the set computed here, never the one the
 * caller claims: the result is `unclear` unless the name is allowed and the amount is exactly what a top-up needs
 * (finite, > 0, ≤ `MAX_TOP_UP_USD`, at a gate with an envelope) and only there.
 */
export function revalidate(reading: unknown, allowed: ReadonlySet<IntentName>, state: StateId): Intent {
  if (typeof reading !== 'object' || reading === null) return UNCLEAR;
  const { intent, amount_usd } = reading as Record<string, unknown>;
  if (typeof intent !== 'string' || !allowed.has(intent as IntentName)) return UNCLEAR;
  if (intent === 'top_up') {
    if (typeof amount_usd !== 'number' || !Number.isFinite(amount_usd) || amount_usd <= 0 || amount_usd > MAX_TOP_UP_USD || topUpEnvelope(state) === null) return UNCLEAR;
    return { intent, amount_usd };
  }
  if (amount_usd !== undefined) return UNCLEAR;
  return { intent: intent as IntentName };
}

/** Longest reply shown by the page: one or two sentences, never an essay. */
export const REPLY_MAX_CHARS = 500;
/** The reader's words for the person, trimmed and capped; `undefined` when there are none (the fake, a model that said nothing). */
export function replyOf(reading: unknown): string | undefined {
  const r = typeof reading === 'object' && reading !== null ? (reading as Record<string, unknown>)['reply'] : undefined;
  if (typeof r !== 'string' || r.trim() === '') return undefined;
  return r.trim().slice(0, REPLY_MAX_CHARS);
}

/** Intents that restart agents whatever the state (a correction reworks the mock-up or a round, a top-up resumes the work). */
const RESTARTS_AGENTS = new Set<IntentName>(['correction', 'bug', 'new_capability', 'scope_change', 'top_up']);
/** States whose entry starts an agent task: an approval that leads there is paid. */
const AGENT_STATES = new Set<StateId>(['repo_creation', 'scoping', 'contract', 'hardening_execution']);
/** Irreversible (Ilan, 2026-11-07): an end state (abandon, refuse) or production (Gate 2 approved) also waits for the click. */
export const irreversible = (intent: IntentName, state: StateId): boolean => intent === 'abandon' || intent === 'refused' || (intent === 'approved' && state === 'gate_2');
/**
 * Needs one "Approve" click after the sentence is understood: what is paid (Ilan's decision 3: nothing is spent before
 * the click) or irreversible. An approval or a satisfied requester is paid when it leads to an agent state (overlap,
 * scoping budget or blocked, contract and hardening gates; the mock-up validated starts the contract task); the delivery
 * approvals (Preview, retries), the Preview validated and the free actions act at once.
 */
export function needsClick(intent: IntentName, state: StateId): boolean {
  if (RESTARTS_AGENTS.has(intent) || irreversible(intent, state)) return true;
  if (intent !== 'approved' && intent !== 'satisfied') return false;
  return TRANSITIONS.some((t) => t.from === state && (t.trigger.type === 'gate' || t.trigger.type === 'event') && t.trigger.outcome === intent && AGENT_STATES.has(t.to));
}

/** Around an amount: "ok, 20 dollars more" — the fake's only grammar. */
const MONEY = new Set(['usd', 'dollar', 'dollars', 'bucks', 'with', 'more', 'plus', 'avec', 'de', 'en']);
const NUMBER = /^\d+$/;
/**
 * The fake reader: the page's acceptance rule (`accepted()`), read server side. A sentence made of yes-words only is
 * `satisfied` for a requester and `approved` for an admin; with one whole number in it, a `top_up` of that amount
 * (re-validation drops it outside the four envelope gates); anything else is `unclear`. `pendingQuestion` is ignored:
 * the model reader uses it.
 */
export const wordsReader: IntentReader = {
  id: 'words',
  async read(q) {
    const w = words(q.text);
    const numbers = w.filter((x) => NUMBER.test(x));
    const rest = w.filter((x) => !NUMBER.test(x));
    const yes = rest.some((x) => YES.has(x)) && rest.every((x) => YES.has(x) || FILLER.has(x) || MONEY.has(x)) && numbers.length <= 1;
    if (!yes) return UNCLEAR;
    if (numbers.length === 1) return { intent: 'top_up', amount_usd: Number(numbers[0]) };
    return { intent: q.hat === 'requester' ? 'satisfied' : 'approved' };
  },
};

/** Sentences per person and per sliding minute (note §4.2): bounds a runaway client; the monthly cap bounds the rest. */
export const INTENT_RATE = { calls: 20, window_ms: 60_000 } as const;
/**
 * Per-key sliding window. ponytail: in memory, per process — the API runs in the single pilot (D23); a restart forgets
 * the counts, which is fine for a limit against mistakes, not against an attacker (Keycloak and CrowdSec are for that).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly calls: number;
  private readonly windowMs: number;
  constructor(calls: number = INTENT_RATE.calls, windowMs: number = INTENT_RATE.window_ms) {
    this.calls = calls;
    this.windowMs = windowMs;
  }
  /** 0 = allowed now (and counted); otherwise the milliseconds to wait before the next allowed call. */
  take(key: string, now: number = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.calls) return recent[0]! + this.windowMs - now;
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }
}
