/**
 * ADR-030: the tail of every red CI or Preview job the watcher already
 * stores (`pipeline_results.details.log_tail`, bounded by `LOG_TAIL` of gitea-forge.ts) goes to the builder's next task as
 * data, under the deviations that job produced (`ci:<check>`, `ci:<check>:<test>`, `ci:opengrep:<id>`). Builder only:
 * the tests role never reads code (ADR-021) and a job log carries stack traces of `api/`. Pure functions: secrets
 * redacted before anything is written, then one size cap per task. Untrusted text, like a report: never interpreted.
 */
import type { RedCheck } from './diagnosis.ts';

/** Size of the whole `ci_logs` field of a task (JSON), oldest lines dropped first. */
export const LOG_FEEDBACK_MAX_CHARS = 20_000;
export const REDACTED = '[REDACTED]';

/**
 * What a log may show: credentials in a URL (user, password or a token alone), a bearer or basic credential, a token
 * with a known prefix or a JWT, the value of a secret-looking key (`k=v`, `k: v`, `"k": "v"`).
 */
const SECRETS: [RegExp, string][] = [
  [/(\w[\w+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/\b(?:ghp_|gho_|ghs_|github_pat_|glpat-|xox[abp]-|sk-)[\w-]{8,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
  // ponytail: `key` also matches "keyboard" or "Primary key: id"; redacting too much is the safe side of a log the agent reads as data.
  [/\b([\w.-]*(?:token|password|passwd|secret|pwd|key)[\w.-]*)(["']?\s*[=:]\s*["']?)(?!\[REDACTED\])[^\s"',;]+/gi, `$1$2${REDACTED}`],
];
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

export const redact = (line: string): string => SECRETS.reduce((s, [re, by]) => s.replace(re, by), line);

/** The lines of a tail, each redacted; a private-key block (one line or several) becomes one marker line. */
export function redactTail(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inKey = false;
  for (const l of lines) {
    if (inKey) {
      if (PRIVATE_KEY_END.test(l)) inKey = false;
      continue;
    }
    if (PRIVATE_KEY_BEGIN.test(l)) {
      out.push(`${REDACTED} private key`);
      inKey = !PRIVATE_KEY_END.test(l);
      continue;
    }
    // A fence in a log line would close task.md's json block: JSON.stringify does not escape backticks.
    out.push(redact(l).replaceAll('```', "'''"));
  }
  return out;
}

export interface LogFeedback {
  pipeline: string;
  check: string;
  /** The deviations this red check produced in the round (`pipelineDeviations`), as the task's `deviations` name them. */
  deviations: string[];
  log_tail: string[];
  /** Lines were dropped to fit the cap (oldest first). */
  truncated?: true;
}

/** The task's `ci_logs`: the red checks that have a tail, redacted, the whole field kept under `max` characters of JSON. */
export function logFeedback(checks: readonly (RedCheck & { deviations: string[] })[], max = LOG_FEEDBACK_MAX_CHARS): LogFeedback[] {
  const entries: LogFeedback[] = checks.filter((k) => k.log_tail.length > 0).map((k) => ({ pipeline: k.pipeline, check: k.check, deviations: k.deviations, log_tail: redactTail(k.log_tail) }));
  // Oldest lines of the oldest check go first; 20 checks of 40 lines at most, the loop is short.
  for (const e of entries) {
    while (JSON.stringify(entries).length > max && e.log_tail.length > 0) {
      e.log_tail.shift();
      e.truncated = true;
    }
  }
  return entries;
}
