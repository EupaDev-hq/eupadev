/**
 * Contracts of the outside world: a fake implementation scriptable by the tests (`fakes.ts`) and the real ones behind
 * the same signatures (`claude-engine.ts`, `gitea-forge.ts`, `ssh-deployer.ts`, `smtp-notifications.ts`), chosen by
 * `world.ts`. Nothing more than what they require.
 */

export type Role =
  | 'overlap' | 'scoping' | 'contract' | 'tests' | 'builder'
  | 'security-reviewer' | 'quality-reviewer'
  /** Read-only, run once before the hardening-blocked gate opens: names the cause of the block for the admin (ADR-027). */
  | 'diagnosis';
/** Code roles, in queueing order (at N = 1, execution order): the acceptance suite first, the builder next (ADR-021). */
export const CODE_ROLES = ['tests', 'builder'] as const;
export type RoleCode = (typeof CODE_ROLES)[number];
export const REVIEW_ROLES = ['security-reviewer', 'quality-reviewer'] as const;
/**
 * Paths whose Git tree is the code role's digest (`sha256(git ls-tree <commit> -- <paths>)`, D20 M4): the only
 * ownership table (ADR-021), reused by the launcher, the pushing fake and the stagnation rule. The commons are not part
 * of it: a round that only changes README.md produces `code:unchanged:builder`, on purpose (M4a).
 */
export const PATHS_BY_ROLE: Readonly<Record<RoleCode, readonly string[]>> = {
  tests: ['tests/acceptance'],
  builder: ['api', 'db', 'web', 'tests/unit'],
};
/** Owner role of a file (the template's AGENTS.md: api/, db/, web/, tests/unit/ → builder; tests/acceptance/ → tests). The `Dockerfile` belongs to nobody: the image comes from the platform's fixed `Dockerfile` (A-R0). */
export function ownerRole(file: string): RoleCode | undefined {
  if (/^(api|db|web|tests\/unit)\//.test(file)) return 'builder';
  if (/^tests\/acceptance\//.test(file)) return 'tests';
  return undefined;
}

/** Files the builder may also change (AGENTS.md: README, example variables, decisions, packages). */
const CODE_COMMONS = /^(README\.md|\.env\.example|docs\/DECISIONS\.md|package\.json|pnpm-lock\.yaml)$/;
/**
 * Write scope of a role ("Roles and folders" table of AGENTS.md), checked by the launcher before any push
 * and by the merge: builder `api/`, `db/`, `web/`, `tests/unit/` and the commons;
 * tests `tests/acceptance/`; contract `openapi.yaml` (root, E13), `tests/acceptance/features/`; scoping: everything (except the
 * forbidden paths, checked separately); read-only roles: nothing.
 */
export function inScope(role: Role, file: string): boolean {
  switch (role) {
    case 'builder': return ownerRole(file) === 'builder' || CODE_COMMONS.test(file);
    case 'tests': return ownerRole(file) === 'tests';
    case 'contract': return /^(openapi\.yaml|tests\/acceptance\/features\/.+)$/.test(file);
    case 'scoping': return true;
    default: return false;
  }
}

/**
 * Roles whose validated work enters main BEFORE the next role starts (a task's base is main until it has a branch):
 * scoping (spec, decisions, mock-up) before the contract; contract (OpenAPI, features) before tests and builder.
 */
export type PublishedRole = 'scoping' | 'contract';
export type { Registration } from '../registration.ts';
import type { Registration } from '../registration.ts';

/** Roles whose tasks count against the scoping envelope; all the others against the hardening one (D16). */
export const SCOPING_ROLES: readonly Role[] = ['overlap', 'scoping'];

// ── Agent engine (ROADMAP §8.11: fixed contract, interchangeable engine) ────────────────────────────

/** Claude Code effort levels (`--effort`); another engine translates them (ROADMAP no. 25). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface TaskInput {
  task_id: string;
  tool: string;
  role: Role;
  /** The role's instructions (prompt), never mixed with the data. */
  instructions: string;
  /** Data: chat, clarifications, deviations, previous reports… passed as data (§8.13). */
  context: Record<string, unknown>;
  cap: { duration_min: number; turns: number; budget_usd: number };
  /** The role's model (full name, never an alias) and effort, passed as is like the cap (ROADMAP no. 25). */
  model: string;
  effort: Effort;
  /** Branch where the launcher pushes the task's work, computed by the orchestrator (`agent/<tool>/<cycle>/<role>`, L5). */
  branch: string;
  /** Fired by the task's timeout or by cancellation: the engine must stop the container. */
  signal: AbortSignal;
  /**
   * Called by the engine right before anything that can spend money (the agent's container starts), never after. W2 counts
   * the launch (`tasks.executions`): an execution cut short AFTER this call with no reported cost is charged the role's cap
   * (the cost is unknown), one cut short BEFORE it costs nothing (no model ran). Throws if the task is already closed
   * (cancellation, incident): the engine must not start the container.
   */
  launched: () => Promise<void>;
}

export interface TaskOutput {
  /** JSON report in the `agents/report.schema.json` format (validated by W2, never by the engine); `null` if the agent produced none (`error` says why). */
  report: unknown | null;
  error?: string;
  /** Actual measured cost; `null` = unknown → W2 counts the task's cap. */
  cost_usd: number | null;
  duration_s: number;
  /** Tokens used, if the engine gives them (another engine may not). */
  tokens?: { input: number; output: number };
  /** D20 M4: sha256 digest of the Git tree of the role's folders after the task (code roles), otherwise null. */
  tree_hash: string | null;
}

/**
 * Decision A (2026-10-27, ADR-023 *Updates*): at the start of an evolution cycle the PLATFORM moves the tool to the
 * latest published core version, before any agent works (agents have no route to the forge's registry). The two
 * files are data: computed by the engine (executor, read badge), committed into main by the forge (pilot).
 */
export interface CoreUpdate {
  /** Version named by the tool's lockfile before, and the latest published version after. */
  from: string;
  to: string;
  package_json: string;
  lockfile: string;
}

export interface AgentEngine {
  /** Throws on an infrastructure failure (container, network…): W2 turns it into `failed`, unknown cost = cap. */
  execute(input: TaskInput): Promise<TaskOutput>;
  /**
   * Decision A: the tool's `package.json` and `pnpm-lock.yaml` moved to the latest published core (`pnpm add
   * @eupadev/core@latest --lockfile-only`, in a container with a route to the forge's registry and the read badge),
   * or null when the tool has no core or is already on the latest version. Throws when the registry cannot answer.
   * Optional: an engine without it leaves the version as it is.
   */
  coreUpToDate?(tool: string, signal?: AbortSignal): Promise<CoreUpdate | null>;
}

// ── Forge Git (Gitea) ─────────────────────────────────────────────────────────────────────────────

export type MergeResult =
  | { result: 'ok' }
  | { result: 'out_of_scope'; files: { file: string; role: Role }[] };
export type IntegrationResult = { result: 'ok' } | { result: 'conflict'; files: string[] };
/** E4: CI finished; `checks` = the pipeline's jobs; `digest` (registry) only if green, absent if the image is missing from the registry. */
export type CiResult = { outcome: 'green' | 'red'; digest?: string; checks: { check: string; result: 'green' | 'red'; details?: unknown }[] };

/**
 * M5 (ROADMAP §8.16): no branch is deleted (Gitea 28 makes any branch covered by a rule indestructible),
 * and the engine does not archive: once removed from the repository's administration, it no longer can; archiving is asked
 * of a human (notification to the admin, `finish` in `toolCycle.ts`).
 */
export interface Forge {
  /** Idempotent: resumes a repository it already created. Throws if the forge refuses or does not answer. `signal`: cycle cancellation. */
  createRepo(slug: string, signal?: AbortSignal): Promise<void>;
  /**
   * Rename at Gate 1 (correction): the repository `from` becomes `to` (hence the image path and the web address), then
   * the head of every branch `agent/<from>/…` is carried over as `agent/<to>/…`; the old branches stay (the forge
   * neither renames nor deletes a branch under a rule: M5). Idempotent (a DBOS step can replay): `from` gone and `to`
   * present → continue; a branch already carried over → skipped.
   */
  renameTool(from: string, to: string, signal?: AbortSignal): Promise<void>;
  /**
   * Validated work of `role` (its branch `agent/<slug>/<cycle>/<role>`) merged into main by the orchestrator account,
   * diff checked against the role's perimeter. Idempotent: a branch already in main, or absent, changes nothing.
   */
  publish(slug: string, cycleId: number, role: PublishedRole, signal?: AbortSignal): Promise<void>;
  /**
   * Decision A: the core bump (`package.json`, `pnpm-lock.yaml`) committed into main by the orchestrator account,
   * `[skip ci]` like `publish` (the round's CI tests it). Idempotent: files already in main → nothing is pushed.
   */
  publishCore(slug: string, cycleId: number, update: CoreUpdate, signal?: AbortSignal): Promise<void>;
  /** Merge of the round's role branches (`agent/<slug>/<cycle>/<role>`, L5) onto the iteration branch. */
  integrate(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<IntegrationResult>;
  /** Per-role diff check then squash into main by the orchestrator account; throws on a technical failure. */
  merge(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<MergeResult>;
  /**
   * E4, watcher (§8.16 M8): result of the main CI started by the round's squash, or null while it runs. Read from the
   * forge's runs, jobs and registry, never from commit statuses (an agent can write some, M6). Optional:
   * without it, the fake watcher sends the CI (E0).
   */
  ciFinished?(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<CiResult | null>;
  /**
   * E5f: starts the Preview pipeline with the Preview URL; returns the highest run id before the start (the run to read is
   * the first above it). Optional: without it, the fake watcher sends `preview_pipeline_finished`.
   */
  launchPreviewPipeline?(slug: string, url: string, signal?: AbortSignal): Promise<number>;
  /** E5f: result of the first Preview pipeline run above `since`, or null while there is none or it runs. */
  previewPipelineFinished?(slug: string, since: number, signal?: AbortSignal): Promise<{ outcome: 'green' | 'red'; checks: CiResult['checks'] } | null>;
  /**
   * Diagnosis (ADR-027): commits ahead of main on each code role's branch of the cycle (`agent/<slug>/<cycle>/<role>`);
   * 0 when the branch does not exist. Optional: without it, the diagnosis does not know the branches.
   */
  roleBranchCommits?(slug: string, cycleId: number, signal?: AbortSignal): Promise<Record<RoleCode, number>>;
  /**
   * Gate 1 (D-E5): names the admin needs to write the tool's `core-tools.yml` entry, read from `main` (`openapi.yaml`
   * `x-roles`, `db/purge.sql` periods; `src/registration.ts`). A missing file gives the names it can. Optional: without
   * it, the Gate 1 page shows no entry to paste.
   */
  registration?(slug: string, signal?: AbortSignal): Promise<Registration>;
}

// ── Deployment (W4) ───────────────────────────────────────────────────────────────────────────────

export type Environment = 'mockup' | 'preview' | 'prod';
export interface DeploymentResult {
  /** Deployed digest (for the mock-up, the one the CI has just built). */
  digest: string;
  url: string;
  health: 'ok' | 'failed';
  reason?: string;
}

export interface Deployer {
  /**
   * Deploys for cycle `cycleId` (the deployment carries the cycle's id, G4), waits for availability then checks
   * health (runtime contract E11). Idempotent for (environment, tool, digest): M9, an abandoned attempt
   * that succeeds later in the background serves nothing other than what was asked. `signal`: cancellation, timeout.
   * Returns the digest ACTUALLY served (M5: it may differ from the requested one).
   */
  deploy(env: Environment, slug: string, cycleId: number, digest: string | null, signal?: AbortSignal): Promise<DeploymentResult>;
  /** Pause: the cycle's container stopped, restartable; no effect if what runs belongs to another cycle (G4). */
  stop(env: Environment, slug: string, cycleId: number): Promise<void>;
  /** End of cycle: container and subdomain removed if they belong to THIS cycle, never those of another cycle (G4). Idempotent. */
  remove(env: Environment, slug: string, cycleId: number): Promise<void>;
  /** What is served for this environment (digest and the cycle that deployed it), or null: monitoring checks it. */
  served(env: Environment, slug: string): Promise<{ digest: string; cycleId: number } | null>;
}

// ── Notifications (mail / dashboard) ──────────────────────────────────────────────────────────────

/**
 * E1: mail address (requester, admin, sender): a single address, with no display name or separator, domain with a
 * dot. ponytail: simple form, not the full RFC 5322 grammar; the OIDC identity will replace it (Keycloak).
 */
export const MAIL_ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export interface Notifications {
  /**
   * M9: `key` = idempotency key of the effect (workflow + step): a notification whose attempt exceeded its timeout
   * but succeeds in the background, then is retried, is sent only once.
   */
  notify(recipient: 'admin' | 'requester', cycleId: number, subject: string, content: string, key?: string): Promise<void>;
}

export interface External {
  engine: AgentEngine;
  forge: Forge;
  deployer: Deployer;
  notifications: Notifications;
}
