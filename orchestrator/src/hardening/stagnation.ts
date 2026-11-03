/**
 * Stagnation detection for the hardening loop (ROADMAP §8.12 E9, §8.13 D20: M1 to M7).
 *
 * Pure functions, without database or DBOS: the future W1 workflow calls them at `hardening_evaluation`
 * and on entering `hardening_execution` (D15) with the stored deviations (`deviations`) and the
 * tree digests (`tasks.tree_hash`). Nothing here reads the free text or the line of a deviation.
 *
 * Vocabulary
 * - Deviation: (rule, file) + optionally category (reviewers), previous_id and id (M7), source.
 *   The orchestrator's synthetic deviations have the same shape: `ci:<check>` / `preview:<check>`
 *   on `pipeline`, `ci:opengrep:<matchBasedId>` on the targeted file (M5), `scope:<file>`,
 *   `report:<role>` on `report` (M1: invalid report, failed or blocked task = no valid
 *   report), `code:unchanged:<role>` on `<role>` (M4a).
 * - Counter of a deviation at round t = max of three tiers (M2, M7), each = 1 + the same tier at round
 *   t-1 if it was present there, otherwise 1:
 *     fine      : (rule, file)                — the E9 fingerprint;
 *     category  : (category, file)           — safety net against label drift (SEC-IDOR → SEC-URL);
 *     inherited : previous_id → counter of the deviation referenced at round t-1, same source (reviewer).
 *   No tier resets another to zero; a missing or unknown `previous_id` simply counts as 0.
 * - Patience (M3): number of deviations deduplicated by (rule, file) per evaluation; if the observed
 *   minimum has not been strictly improved for `patience` evaluations → "no progress" escalation.
 * - Trees (M4): Git tree digest of a role's folders after each of its rounds;
 *   equal to the previous one → `code:unchanged:<role>` deviation; equal to an older digest → oscillation.
 */

export interface Deviation {
  rule: string;
  file: string;
  category?: string;
  /** Id in the report (e.g. F-001); serves as the target of the next round's `previous_id`. */
  id?: string;
  /** M7: id of the deviation in the previous report of the same source when it is the same problem. */
  previous_id?: string | null;
  /** Reviewer role, or `orchestrator` for synthetic deviations. Scope of id/previous_id. */
  source?: string;
}

/** Code roles and the paths of their tree digest: one single table, in the contracts (ADR-021). */
import { PATHS_BY_ROLE, type RoleCode } from '../external/contracts.ts';
import type { Values } from '../i18n.ts';

export interface Counters {
  deviation: Deviation;
  fine: number;
  category: number;
  inherited: number;
  /** max(fine, category, inherited): what the admin sees. */
  counter: number;
}

export type Mechanism = 'M2-fine' | 'M2-category' | 'M7-inherited' | 'M3-patience' | 'M4-oscillation';
/** A stagnation reason: its mechanism, and its text for the admin as a dictionary key (`lang/*.json`) and values. */
export interface Reason { mechanism: Mechanism; key: string; values: Values }

export interface Thresholds { stagnation: number; patience: number }
export const STAGNATION_THRESHOLDS: Thresholds = { stagnation: 3, patience: 3 };

const endKey = (e: Deviation) => `${e.rule}\u0000${e.file}`;
const categoryKey = (e: Deviation) => (e.category === undefined ? undefined : `${e.category}\u0000${e.file}`);
const idKey = (e: Deviation, id: string) => `${e.source ?? ''}\u0000${id}`;

/** One deviation per (rule, file); the first one met wins (same rule as `UNIQUE (cycle_id, iteration, rule, file)` in the database). */
export function deduplicate(deviations: readonly Deviation[]): Deviation[] {
  const seen = new Map<string, Deviation>();
  for (const e of deviations) if (!seen.has(endKey(e))) seen.set(endKey(e), e);
  return [...seen.values()];
}

/**
 * Counters of the last round's deviations, computed over the whole series (M2 + M7).
 * `rounds`: deviations of each evaluation of the cycle since the last reset ("continue" at the gate), in order.
 */
export function counters(rounds: readonly (readonly Deviation[])[]): Counters[] {
  let end = new Map<string, number>();
  let category = new Map<string, number>();
  let byId = new Map<string, number>();
  let result: Counters[] = [];
  for (const round of rounds) {
    const deviations = deduplicate(round);
    const nextEnd = new Map<string, number>();
    const nextCategory = new Map<string, number>();
    const nextById = new Map<string, number>();
    result = deviations.map((e) => {
      const f = 1 + (end.get(endKey(e)) ?? 0);
      const kc = categoryKey(e);
      // Several deviations of the round may share (category, file): same coarse counter for all.
      const c = kc === undefined ? 0 : (nextCategory.get(kc) ?? 1 + (category.get(kc) ?? 0));
      const h = e.previous_id ? 1 + (byId.get(idKey(e, e.previous_id)) ?? -1) : 0;
      const counter = Math.max(f, c, h);
      nextEnd.set(endKey(e), f);
      if (kc !== undefined) nextCategory.set(kc, c);
      if (e.id !== undefined) nextById.set(idKey(e, e.id), counter);
      return { deviation: e, fine: f, category: c, inherited: h, counter: counter };
    });
    end = nextEnd;
    category = nextCategory;
    byId = nextById;
  }
  return result;
}

/**
 * M3: true if the smallest number of deviations has not been strictly improved for `patience` evaluations.
 * [3,2,3,2,3] → true at the 5th (minimum 2 reached at the 2nd, three evaluations without better); [3,2,1] → false.
 */
export function noProgress(counts: readonly number[], patience = STAGNATION_THRESHOLDS.patience): boolean {
  if (counts.length === 0) return false;
  let indexMin = 0;
  for (let i = 1; i < counts.length; i += 1) if (counts[i]! < counts[indexMin]!) indexMin = i;
  return counts.length - 1 - indexMin >= patience;
}

export interface TreeState { unchanged: RoleCode[]; oscillations: RoleCode[] }

/**
 * M4: `trees[role]` = digests after each round where the role was run again, in order.
 * Last equal to the one before → unchanged; equal to an older one → oscillation (A → B → A).
 */
export function trees(trees: Partial<Record<RoleCode, readonly string[]>>): TreeState {
  const state: TreeState = { unchanged: [], oscillations: [] };
  for (const role of Object.keys(PATHS_BY_ROLE) as RoleCode[]) {
    const h = trees[role];
    if (h === undefined || h.length < 2) continue;
    const last = h[h.length - 1]!;
    if (last === h[h.length - 2]) state.unchanged.push(role);
    else if (h.slice(0, -2).includes(last)) state.oscillations.push(role);
  }
  return state;
}

/**
 * Check of the tool's CI whose details are the Opengrep SARIF: the job id of the template's `analysis` job
 * (`tool-template/.gitea/workflows/check.yml`, checked by `tests/stagnation.test.ts`).
 */
export const SARIF_CHECK = 'analysis';

/** M5: deviations of an Opengrep SARIF — one per finding, identified by its `matchBasedId/v1` (stable when lines move). */
export function opengrepDeviations(sarif: unknown): Deviation[] {
  const runs = (sarif as { runs?: unknown[] } | null)?.runs ?? [];
  const deviations: Deviation[] = [];
  for (const run of runs) {
    for (const r of (run as { results?: unknown[] }).results ?? []) {
      const res = r as { ruleId?: string; fingerprints?: Record<string, string>; locations?: { physicalLocation?: { artifactLocation?: { uri?: string } } }[] };
      const id = res.fingerprints?.['matchBasedId/v1'] ?? res.ruleId;
      if (typeof id !== 'string' || id.trim() === '') continue; // neither fingerprint nor rule: unusable
      const uri = res.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
      deviations.push({ rule: `ci:opengrep:${id}`, file: typeof uri === 'string' && uri.trim() !== '' ? uri : 'pipeline', source: 'orchestrator' });
    }
  }
  return deduplicate(deviations);
}

export interface Evaluation {
  /** Deduplicated deviations of the current round, `code:unchanged:<role>` included (M4a). */
  deviations: Deviation[];
  counters: Counters[];
  counts: number[];
  reasons: Reason[];
  escalation: boolean;
}

/**
 * Evaluation of a round: `previousRounds` = deviations of the previous evaluations since the last
 * reset; `roundDeviations` = deviations of the current round (valid reports + synthetic); `treesByRole` =
 * tree digests by role, the current round's last. Order of the reasons: fine fingerprint, same
 * category in the file, inherited deviation, oscillation, no progress.
 */
export function evaluate(
  previousRounds: readonly (readonly Deviation[])[],
  roundDeviations: readonly Deviation[],
  treesByRole: Partial<Record<RoleCode, readonly string[]>> = {},
  thresholds: Thresholds = STAGNATION_THRESHOLDS,
): Evaluation {
  const treeState = trees(treesByRole);
  const deviations = deduplicate([
    ...roundDeviations,
    ...treeState.unchanged.map((role): Deviation => ({ rule: `code:unchanged:${role}`, file: role, source: 'orchestrator' })),
  ]);
  const rounds = [...previousRounds, deviations];
  const c = counters(rounds);
  const counts = rounds.map((t) => deduplicate(t).length);
  const reasons: Reason[] = [];
  for (const x of c.filter((x) => x.fine >= thresholds.stagnation)) reasons.push({ mechanism: 'M2-fine', key: 'stagnation.fine', values: { rule: x.deviation.rule, file: x.deviation.file, n: x.fine } });
  // One single reason per (category, file) even if several labels of the round share it (B8).
  const seenCategories = new Set<string>();
  for (const x of c.filter((x) => x.category >= thresholds.stagnation && x.fine < thresholds.stagnation)) {
    const k = categoryKey(x.deviation)!;
    if (seenCategories.has(k)) continue;
    seenCategories.add(k);
    reasons.push({ mechanism: 'M2-category', key: 'stagnation.category', values: { category: x.deviation.category ?? '', file: x.deviation.file, n: x.category, rule: x.deviation.rule } });
  }
  for (const x of c.filter((x) => x.inherited >= thresholds.stagnation && x.fine < thresholds.stagnation && x.category < thresholds.stagnation)) reasons.push({ mechanism: 'M7-inherited', key: 'stagnation.inherited', values: { rule: x.deviation.rule, file: x.deviation.file, n: x.inherited } });
  for (const role of treeState.oscillations) reasons.push({ mechanism: 'M4-oscillation', key: 'stagnation.oscillation', values: { role } });
  if (deviations.length > 0 && noProgress(counts, thresholds.patience)) reasons.push({ mechanism: 'M3-patience', key: 'stagnation.patience', values: { n: thresholds.patience, counts: counts.join(', ') } });
  return { deviations: deviations, counters: c, counts, reasons, escalation: reasons.length > 0 };
}
