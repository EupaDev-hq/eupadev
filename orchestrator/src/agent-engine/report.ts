/**
 * Validation of an agent report against `tool-template/agents/report.schema.json` (D20 M1:
 * closed lists of `rule` and `category`). Fail-closed: any non-conforming report is "invalid".
 */
import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

export interface Finding {
  id: string;
  rule: string;
  category: string;
  severity: string;
  file: string;
  line: number | null;
  evidence: string;
  owner_role: string;
  previous_id: string | null;
}

export interface Report {
  schema_version: '1';
  role: string;
  task_id: string;
  status: 'done' | 'blocked' | 'failed';
  summary: string;
  blocked_reason: string | null;
  files_changed: string[];
  verifications: { command: string; result: 'pass' | 'fail'; details: string }[];
  findings: Finding[];
  category_verdicts: { category: string; verdict: string; evidence: string }[];
  assumptions: string[];
  /** Overlap role only (C1): verdict of the overlap search; missing = "to check". */
  verdict?: 'plausible' | 'not_plausible';
  /** Overlap role, plausible verdict: slug of the designated catalogue tool; missing from the catalogue = "to check". */
  overlapping_tool?: string | null;
  /** Scoping only (A-R6, D2): sent to the requester with the mock-up link, after the refused-words check (C1, `jargon.ts`). */
  requester_message?: string | null;
  /** Scoping only: ids of the platform capabilities the scope relies on (closed list `$defs.capability`); missing = invalid report. */
  capabilities_used?: string[] | null;
  /** Scoping only: what the requester asked for that the platform does not offer (business words). */
  capabilities_missing?: string[] | null;
  /** Diagnosis only (ADR-027): read by `readDiagnosis` (`hardening/diagnosis.ts`), which checks its consistency; anything else = unavailable. */
  diagnosis?: unknown;
}

/**
 * C2 (A-R6): a builder finding forwarded to the tests role never carries code (the tests role never reads the
 * implementation). Evidence naming a code file (`api/`, `web/`, `db/`, not a contract path such as `/api/x`) or holding a
 * code fence is withheld; rule, file and line still reach the tests role.
 */
export const RETAINED_EVIDENCE = 'withheld: cited code';
export function transmissibleEvidence(evidence: string): string {
  return /(?<![\w./-])(api|web|db)\//.test(evidence) || evidence.includes('```') ? RETAINED_EVIDENCE : evidence;
}

export type Validation = { valid: true; report: Report } | { valid: false; errors: string };

export class ReportValidator {
  readonly #validate: ValidateFunction;

  constructor(schemaPath: string) {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    this.#validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }

  /** Validates the JSON and its consistency with the task (role, id); `blocked` requires a non-empty reason. */
  validate(report: unknown, expected: { role: string; task_id: string }): Validation {
    if (!this.#validate(report)) {
      return { valid: false, errors: (this.#validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join(' ; ') };
    }
    const r = report as Report;
    if (r.role !== expected.role) return { valid: false, errors: `role ${r.role} instead of ${expected.role}` };
    if (r.task_id !== expected.task_id) return { valid: false, errors: `task_id ${r.task_id} instead of ${expected.task_id}` };
    if (r.status === 'blocked' && (r.blocked_reason ?? '').trim() === '') return { valid: false, errors: 'blocked without blocked_reason' };
    // The scoping says which platform capabilities it relies on (a promise outside the list is refused by the schema).
    if (r.role === 'scoping' && !Array.isArray(r.capabilities_used)) return { valid: false, errors: 'scoping without capabilities_used' };
    return { valid: true, report: r };
  }
}
