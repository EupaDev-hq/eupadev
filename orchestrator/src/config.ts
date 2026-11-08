/**
 * Configuration of the orchestrator, read from the environment variables and checked at startup
 * (ROADMAP E10): a missing required value makes startup refuse, with the name of the variable in the
 * message. The timeouts (24 h, 96 h, 30 d, 60 min…) are derived from the thresholds but can be
 * overridden variable by variable, so that the tests do not wait.
 */
import { LANGUAGES, type Language } from './i18n.ts';
import { readFileSync } from 'node:fs';
import type { OptionsOidc } from './auth.ts';
import type { OptionsOidcWeb } from './web-session.ts';
import { DEFAULT_THRESHOLDS } from './machine/states.ts';
import type { Effort, Role } from './external/contracts.ts';

/**
 * ROADMAP no. 25 (a): model (full name, never an alias that would change model without a decision) and effort per role,
 * passed to the agent engine like the cap. Starting table of A-R5 (Ilan's decision of 2026-10-17):
 * overlap Haiku 5.5 `medium` (at `low`, Haiku "skip a search, stop early"); scoping Sonnet 5.5 `medium`; contract Opus 5.5
 * `high` (it freezes the scope); tests and builder (A-R1, ADR-021: the "code" line) Opus 5.5 `medium`; reviewers Opus 5.5
 * `high`. Fable 5.1 in no line: escalation only. To be readjusted on the real costs of the measurement run (`tasks` columns).
 * ponytail: fixed in the code; an environment variable the day a client must change them without a new image.
 */
export const MODELS_BY_ROLE: Readonly<Record<Role, { model: string; effort: Effort }>> = {
  overlap: { model: 'claude-haiku-5-5', effort: 'medium' },
  scoping: { model: 'claude-sonnet-5-5', effort: 'medium' },
  contract: { model: 'claude-opus-5-5', effort: 'high' },
  tests: { model: 'claude-opus-5-5', effort: 'medium' },
  builder: { model: 'claude-opus-5-5', effort: 'medium' },
  'security-reviewer': { model: 'claude-opus-5-5', effort: 'high' },
  'quality-reviewer': { model: 'claude-opus-5-5', effort: 'high' },
  /** ADR-027: reads a small, pre-digested file; Sonnet is enough and keeps the cap at $2 realistic. */
  diagnosis: { model: 'claude-sonnet-5-5', effort: 'medium' },
};

export interface Timeouts {
  /** Between two reminders to a human (24 h). */
  reminder_ms: number;
  /** Pause without an answer before abandonment and archiving (30 d). */
  pause_archive_ms: number;
  /** Silent CI or Preview pipeline (60 min). */
  ci_max_ms: number;
  /**
   * Maximum duration of an agent task: null = the duration of its role's cap (`thresholds.task[role].duration_min`, A-R5);
   * `TASK_TIMEOUT_MS` (tests, lab) imposes it on all roles. Beyond it: failed, cost = the role's cap.
   */
  task_ms: number | null;
  /** "Long" wait between two checks when the requester's reminders are used up (feedback on the Preview). */
  long_wait_ms: number;
  /** S6: admin gate without a decision after its 3 reminders: one reminder a week until the decision (7 d). */
  long_reminder_ms: number;
  /** Polling interval of the queue and of the DBOS mailboxes. */
  polling_ms: number;
  /**
   * B1: maximum duration of an external operation (forge, deployment) and of a step attempt (db, notification);
   * beyond it: failure, never an endless wait (10 min).
   */
  operation_ms: number;
  /** B4: first wait before retrying to record an incident (1 min), doubled on each failure up to 60 times (1 h). */
  incident_retry_ms: number;
}

/** Timer of a task (W2): `TASK_TIMEOUT_MS` if given, otherwise the duration of its role's cap (A-R5). */
export function taskTimeoutMs(timeouts: Timeouts, cap: { duration_min: number }): number {
  return timeouts.task_ms ?? cap.duration_min * 60_000;
}

/** Automatic retries of the DBOS steps that touch the db or the external world (wait growing ×2). */
export interface Retries {
  /** Attempts in total, the first included; beyond: technical incident (D21). */
  attempts: number;
  /** Wait before the first retry, doubled each time (1 s, 2 s, 4 s, 8 s…). */
  interval_ms: number;
}

export interface Config {
  databaseUrl: string;
  adminEscalationAddress: string;
  /** Domain of the tools: <slug>.scoping.<domain>, <slug>.preview.<domain>, <slug>.<domain>. */
  toolDomain: string;
  dashboardUrl: string;
  /** N simultaneous agents (DBOS queue), default 1; 3 at most per tool (ROADMAP §8.3). */
  agentConcurrency: number;
  reportSchemaPath: string;
  /** Directory of the role instructions (`AGENTS.md`, `agents/`, `.claude/rules/`): the template in dev, `/app/instructions` in the image. */
  instructionsPath: string;
  /** The requester's page files (`WEB_PATH`: `orchestrator/web/` in dev, `/app/web` in the image) and the deep-chat bundle (`DEEP_CHAT_PATH`: `node_modules` in dev, `/app/vendor/…` in the image). ADR-024. */
  webPath: string;
  deepChatPath: string;
  /** S2: DBOS schedule (6-field cron, seconds included) of the monitoring of dead runs (every 5 min). */
  monitoringCron: string;
  /** E4: DBOS schedule of the CI watcher (real forge only), every 30 s. */
  watcherCron: string;
  timeouts: Timeouts;
  retries: Retries;
  thresholds: typeof DEFAULT_THRESHOLDS;
  /** Model and effort of each role (MODELS_BY_ROLE). */
  models: typeof MODELS_BY_ROLE;
  /**
   * Engine-side emergency stop: `PAUSE_AGENTS=1` → this process no longer takes any task
   * from the agents queue (DBOS: `agent-tasks` removed from `listenQueues`); the cycles go on (messages, gates) and the tasks stay queued.
   */
  pauseAgents: boolean;
  /** Local API (§8.16 M8): listen address (127.0.0.1 by default; 0.0.0.0 in a container whose port is published on 127.0.0.1) and port. */
  api: { address: string; port: number };
  /** Role of the process (`EUPADEV_ROLE`): see `ROLES`. */
  role: ProcessRole;
  /** Language of the end-user texts (chat messages, mails, gate reasons): `EUPADEV_LANGUAGE`, English by default (ADR-025). */
  language: Language;
  /**
   * I0 (ADR-017): the IdP (Keycloak) as seen by the API — `OIDC_ISSUER` (public iss, fixed), `OIDC_JWKS_URL` (keys, internal
   * URL), `OIDC_AUDIENCE` (`eupadev-api`). Required except for the executor, which has no API.
   */
  oidc: OptionsOidc;
  /**
   * Browser sign-in of the requester's web page (ADR-024): confidential client
   * `OIDC_WEB_CLIENT_ID` (`eupadev-web`), `OIDC_WEB_CLIENT_SECRET` (or `_FILE`), `OIDC_WEB_REDIRECT_URL`
   * (`<page origin>/auth/callback`). null = not configured: the `/auth/*` routes refuse (503), the rest of the API works.
   */
  oidcWeb: OptionsOidcWeb | null;
  /**
   * Four eyes (Gate 2): OIDC subject (`sub` at `OIDC_ISSUER`) allowed to approve the delivery of a tool of which it is
   * the requester; empty by default (no exemption). Each use is recorded (`approvals.four_eyes_exemption`).
   */
  fourEyesExemptionSubject: string;
}

/**
 * `all-in-one` (default, lab from before the agents VM): pilots AND runs the agent tasks; `pilot` (orchestrator VM):
 * cycles, gates, API, watcher, no agent task; `executor` (agents VM): only the agent tasks (queue `agent-tasks`),
 * neither API, nor watcher, nor monitoring.
 */
export const ROLES = ['all-in-one', 'pilot', 'executor'] as const;
export type ProcessRole = (typeof ROLES)[number];
/**
 * DBOS id (`executor_id`) of the executor, imposed (no `DBOS__VMID` to set): a single executor at a time (lock), and
 * the pilot must have another one, otherwise on restart it would "resume" the tasks the executor is running.
 * ponytail: a single executor; several agents VMs = one id and one lock per VM.
 */
export const EXECUTOR_VMID = 'agent-executor';

const REQUIRED = ['ADMIN_ESCALATION_ADDRESS', 'TOOL_DOMAIN', 'DASHBOARD_URL'] as const;

/**
 * Secret (ROADMAP §8.16 M1): read either from `NAME` or from the file named by `NAME_FILE` (Compose secret decrypted by
 * `systemd-creds`), never both; a single final line break of the file is removed. No message contains the value: only
 * the name of the variable and, for a file, its path.
 */
export function readSecret(env: Record<string, string | undefined>, name: string): string {
  const direct = env[name] ?? '';
  const path = env[`${name}_FILE`] ?? '';
  if (direct !== '' && path !== '') throw new Error(`${name} and ${name}_FILE both given: only one expected`);
  if (path === '') {
    if (direct.trim() === '') throw new Error(`${name} missing (or ${name}_FILE)`);
    return direct;
  }
  let value: string;
  try {
    value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  } catch (e) {
    throw new Error(`${name}_FILE unreadable (${path}): ${(e as NodeJS.ErrnoException).code ?? 'read error'}`);
  }
  if (value.trim() === '') throw new Error(`${name}_FILE: empty file (${path})`);
  return value;
}
/** Largest delay Node can schedule (setTimeout, setInterval): beyond it, it would fire at once. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const H = 3_600_000;
const DEFAULT_TIMEOUTS: Timeouts = {
  reminder_ms: DEFAULT_THRESHOLDS.reminders.interval_h * H,
  pause_archive_ms: DEFAULT_THRESHOLDS.reminders.pause_archive_after_days * 24 * H,
  ci_max_ms: DEFAULT_THRESHOLDS.forge.ci_wait_max_min * 60_000,
  task_ms: null,
  long_wait_ms: 24 * H,
  long_reminder_ms: 7 * 24 * H,
  polling_ms: 1000,
  operation_ms: 10 * 60_000,
  incident_retry_ms: 60_000,
};
/** Timeouts passed to a Node timer (setTimeout / setInterval / DBOS step timeout): capped at MAX_TIMEOUT_MS (C). */
const TIMERS = new Set<keyof Timeouts>(['task_ms', 'polling_ms', 'operation_ms', 'incident_retry_ms']);

/** Strictly positive integer: a zero or negative timeout, concurrency or number of attempts makes no sense (A8). */
function integer(name: string, value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > max) throw new Error(`${name} invalid: "${value}" (strictly positive integer${max < Number.MAX_SAFE_INTEGER ? ` ≤ ${max}` : ''} expected)`);
  return n;
}

/** Reads and checks the configuration; throws `Error('<VARIABLE> missing')` at the first missing value. */
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const databaseUrl = readSecret(env, 'ORCH_DATABASE_URL');
  for (const name of REQUIRED) {
    if (env[name] === undefined || env[name].trim() === '') throw new Error(`${name} missing`);
  }
  const concurrency = integer('AGENT_CONCURRENCY', env['AGENT_CONCURRENCY'], 1);
  const role = (env['EUPADEV_ROLE'] || 'all-in-one') as ProcessRole;
  if (!ROLES.includes(role)) throw new Error(`EUPADEV_ROLE invalid: "${role}" (${ROLES.join(', ')} expected)`);
  const language = (env['EUPADEV_LANGUAGE'] || 'en') as Language;
  if (!LANGUAGES.includes(language)) throw new Error(`EUPADEV_LANGUAGE invalid: "${language}" (${LANGUAGES.join(', ')} expected)`);
  if (role !== 'executor' && env['DBOS__VMID'] === EXECUTOR_VMID) throw new Error(`DBOS__VMID: "${EXECUTOR_VMID}" is reserved for the executor`);
  // I0: the API requires the IdP; the executor has no API. A malformed URL is refused at startup, not at the first token.
  const oidc: OptionsOidc = { issuer: env['OIDC_ISSUER'] ?? '', jwksUrl: env['OIDC_JWKS_URL'] ?? '', audience: env['OIDC_AUDIENCE'] || 'eupadev-api' };
  if (role !== 'executor') {
    for (const [name, value] of [['OIDC_ISSUER', oidc.issuer], ['OIDC_JWKS_URL', oidc.jwksUrl]] as const) {
      if (value.trim() === '') throw new Error(`${name} missing`);
      if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) throw new Error(`${name} invalid: "${value}" (http(s) URL expected)`);
    }
  }
  // Web sign-in: off unless the client id is given; then everything is required (fail closed). The token endpoint is the
  // JWKS URL's sibling (same realm, same internal route): Keycloak's layout, the only IdP we run.
  let oidcWeb: OptionsOidcWeb | null = null;
  const webClientId = (env['OIDC_WEB_CLIENT_ID'] ?? '').trim();
  if (webClientId !== '' && role !== 'executor') {
    const redirectUrl = env['OIDC_WEB_REDIRECT_URL'] ?? '';
    if (!URL.canParse(redirectUrl) || !/^https?:$/.test(new URL(redirectUrl).protocol) || new URL(redirectUrl).pathname !== '/auth/callback') throw new Error(`OIDC_WEB_REDIRECT_URL invalid: "${redirectUrl}" (http(s) URL ending in /auth/callback expected)`);
    if (!oidc.jwksUrl.endsWith('/protocol/openid-connect/certs')) throw new Error('OIDC_JWKS_URL: a Keycloak URL ending in /protocol/openid-connect/certs is expected when OIDC_WEB_CLIENT_ID is set (the token endpoint is derived from it)');
    oidcWeb = { clientId: webClientId, clientSecret: readSecret(env, 'OIDC_WEB_CLIENT_SECRET'), redirectUrl, tokenUrl: oidc.jwksUrl.replace(/certs$/, 'token') };
  }
  const timeout = (key: Exclude<keyof Timeouts, 'task_ms'>, variable: string) => integer(variable, env[variable], DEFAULT_TIMEOUTS[key], TIMERS.has(key) ? MAX_TIMEOUT_MS : undefined);
  return {
    databaseUrl,
    adminEscalationAddress: env['ADMIN_ESCALATION_ADDRESS']!,
    toolDomain: env['TOOL_DOMAIN']!,
    dashboardUrl: env['DASHBOARD_URL']!,
    agentConcurrency: concurrency,
    reportSchemaPath: env['REPORT_SCHEMA_PATH'] ?? new URL('../../tool-template/agents/report.schema.json', import.meta.url).pathname,
    instructionsPath: env['INSTRUCTIONS_PATH'] ?? new URL('../../tool-template/', import.meta.url).pathname,
    webPath: env['WEB_PATH'] ?? new URL('../web/', import.meta.url).pathname,
    deepChatPath: env['DEEP_CHAT_PATH'] ?? new URL('../node_modules/deep-chat/dist/deepChat.bundle.js', import.meta.url).pathname,
    monitoringCron: env['MONITORING_CRON'] || '0 */5 * * * *', // checked by DBOS at startup (applySchedules)
    watcherCron: env['WATCHER_CRON'] || '*/30 * * * * *',
    timeouts: {
      reminder_ms: timeout('reminder_ms', 'REMINDER_DELAY_MS'),
      pause_archive_ms: timeout('pause_archive_ms', 'PAUSE_ARCHIVE_DELAY_MS'),
      ci_max_ms: timeout('ci_max_ms', 'CI_MAX_TIMEOUT_MS'),
      task_ms: env['TASK_TIMEOUT_MS'] ? integer('TASK_TIMEOUT_MS', env['TASK_TIMEOUT_MS'], 1, MAX_TIMEOUT_MS) : null,
      long_wait_ms: timeout('long_wait_ms', 'LONG_WAIT_DELAY_MS'),
      long_reminder_ms: timeout('long_reminder_ms', 'LONG_REMINDER_DELAY_MS'),
      polling_ms: timeout('polling_ms', 'POLLING_INTERVAL_MS'),
      operation_ms: timeout('operation_ms', 'OPERATION_TIMEOUT_MS'),
      incident_retry_ms: timeout('incident_retry_ms', 'INCIDENT_RETRY_DELAY_MS'),
    },
    retries: {
      attempts: integer('STEP_ATTEMPTS', env['STEP_ATTEMPTS'], 5),
      interval_ms: integer('STEP_INTERVAL_MS', env['STEP_INTERVAL_MS'], 1000, MAX_TIMEOUT_MS),
    },
    thresholds: DEFAULT_THRESHOLDS,
    models: MODELS_BY_ROLE,
    pauseAgents: flag('PAUSE_AGENTS', env['PAUSE_AGENTS']),
    api: { address: env['API_ADDRESS'] || '127.0.0.1', port: integer('API_PORT', env['API_PORT'], 8080, 65_535) },
    role,
    language,
    oidc,
    oidcWeb,
    fourEyesExemptionSubject: (env['FOUR_EYES_EXEMPTION_SUBJECT'] ?? '').trim(),
  };
}

function flag(name: string, value: string | undefined): boolean {
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error(`${name} invalid: "${value}" (0 or 1 expected)`);
}
