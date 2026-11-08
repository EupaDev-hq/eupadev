/**
 * Diagnosis of a blocked hardening (ADR-027): what the `diagnosis` task receives, the deterministic pre-check it can
 * rely on, the reading of its report and the line shown to the admin. Pure functions: no database, no AI call, tested
 * on the data of cycle 5 of the lab (`tests/diagnosis.test.ts`). The prompt guides, this code checks: a report whose
 * cause and recommendation disagree is "unavailable", never a verdict.
 */
import { CODE_ROLES, REVIEW_ROLES, type RoleCode } from '../external/contracts.ts';
import type { Task, DeviationRow } from '../db.ts';
import type { Values } from '../i18n.ts';

export const CAUSES = ['slow_progress', 'unclear_request', 'platform_or_impossible'] as const;
export type Cause = (typeof CAUSES)[number];

export interface Diagnosis {
  cause: Cause;
  explanation: string;
  evidence: string[];
  recommendation: { top_up_usd: number | null; question: string | null };
}

/** A task as the diagnosis sees it: the fields that tell what happened, bounded (never a whole report). */
export interface TaskFact {
  step: string;
  role: string;
  iteration: number;
  status: Task['status'];
  cost_usd: number;
  report: { status?: string; summary?: string; blocked_reason?: string | null; reason?: string; findings?: { rule: string; file: string; severity: string; owner_role: string }[] } | null;
}

/** A red check of the CI or of the Preview pipeline, with the tail of its job log read by the watcher (`gitea-forge.ts`). */
export interface RedCheck { round: number; pipeline: string; check: string; log_tail: string[] }

export interface DiagnosisContext {
  /** The escalation reason, as the gate shows it. */
  reason: string;
  budget: { cost_usd: number; cap_usd: number };
  tasks: TaskFact[];
  deviations: { round: number; rule: string; file: string; source: string }[];
  /** Red checks since the last reset of the counters, each with its log tail: a platform failure shows there. */
  red_checks: RedCheck[];
  /** Commits ahead of main per code role branch; null when the forge could not be asked. */
  branches: Record<RoleCode, number> | null;
  /** Facts computed by the orchestrator (below): the agent cites them, it does not re-derive them. */
  precheck: string[];
}

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function taskFact(t: Task): TaskFact {
  const r = t.report as Record<string, unknown> | null;
  const findings = Array.isArray(r?.['findings'])
    ? (r['findings'] as Record<string, unknown>[]).slice(0, 20).map((f) => ({ rule: String(f['rule'] ?? ''), file: String(f['file'] ?? ''), severity: String(f['severity'] ?? ''), owner_role: String(f['owner_role'] ?? '') }))
    : undefined;
  const report = r === null || typeof r !== 'object' ? null : {
    ...(text(r['status'], 20) === undefined ? {} : { status: text(r['status'], 20)! }),
    ...(text(r['summary'], 600) === undefined ? {} : { summary: text(r['summary'], 600)! }),
    ...(text(r['blocked_reason'], 600) === undefined ? {} : { blocked_reason: text(r['blocked_reason'], 600)! }),
    ...(text(r['reason'], 600) === undefined ? {} : { reason: text(r['reason'], 600)! }),
    ...(findings === undefined ? {} : { findings }),
  };
  return { step: t.step, role: t.role, iteration: t.iteration, status: t.status, cost_usd: t.cost_usd, report };
}

/** Claude Code stopped by its cap (`claude-engine.ts` REASONS), or a task closed at its cap without a report. */
const CAPPED = /cap reached|error_max_(turns|budget_usd)/;
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Deterministic pre-check, one line per fact, in the admin's words. Rules:
 * - a code role stopped at its cap twice or more: with no commit on its branch, the agent delivered nothing (platform
 *   defect or impossible request — cycle 5 of the lab); with commits, work in progress (slow progress);
 * - a code role that never delivered in the cycle;
 * - a task blocked: the point it names is a question left open (unclear request).
 */
export function precheck(tasks: readonly TaskFact[], branches: Record<RoleCode, number> | null): string[] {
  const lines: string[] = [];
  for (const role of CODE_ROLES) {
    const mine = tasks.filter((t) => t.role === role);
    if (mine.length === 0) continue;
    const capped = mine.filter((t) => t.status === 'failed' && CAPPED.test(t.report?.reason ?? ''));
    const commits = branches?.[role];
    if (capped.length >= 2) {
      const detail = `${capped.length} attempts stopped at the task cap (${capped.map((t) => `round ${t.iteration}: ${usd(t.cost_usd)}`).join(', ')})`;
      if (commits === 0) lines.push(`${role}: ${detail} and no commit on its branch: the agent delivered nothing — platform defect or impossible request`);
      else if (commits === undefined) lines.push(`${role}: ${detail}; the state of its branch is unknown (forge not asked or unreachable)`);
      else lines.push(`${role}: ${detail}, ${commits} commit(s) kept on its branch: work in progress — slow progress`);
    } else if (!mine.some((t) => t.status === 'done')) {
      lines.push(`${role}: never delivered in this cycle (${mine.map((t) => `round ${t.iteration}: ${t.status}`).join(', ')})`);
    }
  }
  for (const t of tasks) {
    if (t.status !== 'blocked') continue;
    const why = (t.report?.blocked_reason ?? '').trim();
    lines.push(`${t.role} blocked at round ${t.iteration}${why === '' ? '' : `: "${why.slice(0, 200)}"`} — a point the contract or the requester left open (unclear request)`);
  }
  return lines;
}

/** Bounds of the red checks passed on: the last 20, each tail as the watcher bounded it (`LOG_TAIL`), 40 lines at most. */
export function redChecks(rows: readonly { iteration: number; pipeline: string; check: string; details: unknown }[]): RedCheck[] {
  return rows.slice(-20).map((r) => {
    const tail = (r.details as { log_tail?: unknown } | null)?.log_tail;
    return { round: r.iteration, pipeline: r.pipeline, check: r.check, log_tail: Array.isArray(tail) ? tail.filter((l): l is string => typeof l === 'string').slice(-40).map((l) => l.slice(0, 300)) : [] };
  });
}

/** The task's data: tasks, deviations per round, red checks with their log tails, reason, budget, branches, pre-check. The contract is read in the clone. */
export function diagnosisContext(d: { reason: string; budget: { cost_usd: number; cap_usd: number }; tasks: readonly Task[]; deviations: readonly DeviationRow[]; redChecks?: readonly { iteration: number; pipeline: string; check: string; details: unknown }[]; branches: Record<RoleCode, number> | null }): DiagnosisContext {
  const tasks = d.tasks.filter((t) => t.role !== 'diagnosis').map(taskFact);
  return {
    reason: d.reason,
    budget: d.budget,
    tasks,
    deviations: d.deviations.map((l) => ({ round: l.iteration, rule: l.rule, file: l.file, source: l.source })),
    red_checks: redChecks(d.redChecks ?? []),
    branches: d.branches,
    precheck: precheck(tasks, d.branches),
  };
}

/** A failure the agent produced itself: stopped at a cap or a timeout, or a report the schema refused. Anything else is not its doing. */
const AGENT_FAULT = /cap reached|error_max_(turns|budget_usd)|task timeout exceeded|^invalid report/;
const HARDENING = new Set<string>(['contract', ...CODE_ROLES, ...REVIEW_ROLES]);

/**
 * ADR-027, first failed round: the diagnosis runs before the next paid round when the round that just ended holds a
 * failure the agents did not produce — a red check of the CI or of the Preview pipeline (`file = 'pipeline'`), a task that
 * failed without being capped or refused by the schema (launcher, engine, container), or a task `blocked` on an open
 * point (unclear request, cycle 5 of the lab). Once per situation: never when a `diagnosis` task was created since the
 * first hardening task of the round `since` (the first round counted since the last reset of the counters). `tasks` in
 * creation order, as `cycleTasks` returns them.
 */
export function earlyDiagnosisDue(tasks: readonly Pick<Task, 'role' | 'iteration' | 'status' | 'report'>[], since: number, round: number, roundDeviations: readonly Pick<DeviationRow, 'rule' | 'file'>[]): boolean {
  const first = tasks.findIndex((t) => HARDENING.has(t.role) && t.iteration >= since);
  if (first >= 0 && tasks.slice(first).some((t) => t.role === 'diagnosis')) return false;
  if (roundDeviations.some((l) => l.file === 'pipeline')) return true;
  return tasks.some((t) => HARDENING.has(t.role) && t.iteration === round
    && (t.status === 'blocked' || (t.status === 'failed' && !AGENT_FAULT.test(String((t.report as { reason?: unknown } | null)?.reason ?? '')))));
}

/**
 * The report's `diagnosis` field, accepted only when cause and recommendation agree: a top-up for slow_progress, a
 * question for unclear_request, neither for platform_or_impossible. Anything else: null (unavailable).
 */
export function readDiagnosis(field: unknown): Diagnosis | null {
  if (field === null || typeof field !== 'object') return null;
  const d = field as Record<string, unknown>;
  const cause = d['cause'];
  if (!(CAUSES as readonly unknown[]).includes(cause)) return null;
  const explanation = d['explanation'];
  if (typeof explanation !== 'string' || explanation.trim() === '') return null;
  const evidence = d['evidence'];
  if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((e) => typeof e === 'string' && e.trim() !== '')) return null;
  const r = d['recommendation'];
  if (r === null || typeof r !== 'object') return null;
  const top_up = (r as Record<string, unknown>)['top_up_usd'];
  const question = (r as Record<string, unknown>)['question'];
  const hasTopUp = typeof top_up === 'number' && Number.isFinite(top_up) && top_up > 0;
  const hasQuestion = typeof question === 'string' && question.trim() !== '';
  if (cause === 'slow_progress' && !(hasTopUp && question === null)) return null;
  if (cause === 'unclear_request' && !(hasQuestion && top_up === null)) return null;
  if (cause === 'platform_or_impossible' && !(top_up === null && question === null)) return null;
  return { cause: cause as Cause, explanation: explanation.trim(), evidence: (evidence as string[]).map((e) => e.trim()), recommendation: { top_up_usd: hasTopUp ? top_up : null, question: hasQuestion ? question.trim() : null } };
}

/**
 * The line of the gate: the verdict (`gate.diagnosis.<cause>`) from a done task whose diagnosis reads, otherwise
 * `gate.diagnosis.unavailable` with why (task failed, blocked, report without a usable diagnosis). Never nothing.
 */
export function diagnosisMessage(status: Task['status'], report: unknown): { key: string; values: Values } {
  const r = report as Record<string, unknown> | null;
  const d = status === 'done' ? readDiagnosis(r?.['diagnosis']) : null;
  if (d === null) {
    const why = status === 'done' ? 'report without a usable diagnosis' : String(r?.['reason'] ?? r?.['blocked_reason'] ?? `task ${status}`).slice(0, 300);
    return { key: 'gate.diagnosis.unavailable', values: { reason: why } };
  }
  return {
    key: `gate.diagnosis.${d.cause}`,
    values: { explanation: d.explanation, evidence: d.evidence.join('; '), top_up: (d.recommendation.top_up_usd ?? 0).toFixed(2), question: d.recommendation.question ?? '' },
  };
}
