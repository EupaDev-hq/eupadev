/**
 * Real forge: Gitea 28 through its REST API, with the token of the `svc-orchestrator` account (E2).
 * Native `fetch` and the `git` client (integration and diff check, E3), no dependency (this file imports only the
 * contracts: the lab playbooks that verify E2 and E3 run it alone). The token goes
 * out only in a header, never in a URL, an argument, a log or an error message; redirects are refused (the
 * token follows no other address: a 3xx is a refusal).
 *
 * Errors: `ForgeError.transient` = transient fault (5xx, 429, network, timeout) already retried here, since the operation is
 * started only once by DBOS (`toolCycle.ts`, `externalOperation`); otherwise a definitive refusal (unexpected 4xx, unreadable
 * answer, repository state contrary to what is expected).
 *
 * Answers of Gitea 28.1.0 read from its code (`routers/api/v1`): generation 201 / 409 (name taken); collaborator
 * check 204 / 404; adding a repository to a team 204, 403 "Must be a team member" if the requester is not a
 * member of the team, 403 "Must have permission to manage team repository access" if it is not admin of the repository or if
 * the organisation does not have `repo_admin_change_team_access`; merge 200, 405 "Please try again later" (mergeability being computed) or "The PR is already merged".
 * Watcher (E4): runs, jobs and registry.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CODE_ROLES, inScope, type Forge, type CoreUpdate, type CiResult, type MergeResult, type IntegrationResult, type Role, type PublishedRole } from './contracts.ts';

export class ForgeError extends Error {
  override name = 'ForgeError';
  readonly transient: boolean;
  readonly status: number | undefined;
  constructor(message: string, transient: boolean, status?: number) {
    super(message);
    this.transient = transient;
    this.status = status;
  }
}

export interface GiteaForgeOptions {
  /** The forge's address, without `/api/v1` (e.g. `https://git.example.fr`). */
  url: string;
  token: string;
  organisation?: string;
  model?: string;
  agentsTeam?: string;
  account?: string;
  /** Timeout of one HTTP call. */
  timeoutMs?: number;
  /** Attempts of a call hitting a transient fault (and of a merge whose mergeability Gitea is still computing). */
  attempts?: number;
  /** Wait before the 2nd attempt, doubled afterwards. */
  intervalMs?: number;
  /** Timeout of one Git command (clone, merge, push). */
  gitTimeoutMs?: number;
}

/** The forge's address and token, checked (shared by the API and Git, by every robot). */
export function verifyAddress(address: string, token: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error('FORGE_URL invalid');
  }
  if (url.username !== '' || url.password !== '') throw new Error('FORGE_URL: no credentials in the address (token through a *_TOKEN_FILE file)');
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('FORGE_URL: https required (the token never travels in clear)');
  if (token.trim() === '' || /\s/.test(token)) throw new Error('forge token empty or invalid');
  return url;
}

type Response = { status: number; body: unknown; headers: Headers; text: string };
/** Call outside the API (registry): other origin, other authentication; `text`: body read as is (a job's log). */
type Elsewhere = { origin?: string; auth?: string; accept?: string; text?: true };
interface Repo { private?: boolean; template?: boolean; archived?: boolean; permissions?: { admin?: boolean } }
interface PR { number: number; state: string; merged: boolean; merge_commit_sha?: string | null }
interface Run { id: number; head_sha: string; status: string; conclusion?: string }
/** The template's check pipeline (`tool-template/.gitea/workflows/check.yml`): publishes main's image. */
const WORKFLOW_CI = 'check.yml';
/** E5f: checks against the deployed Preview (`tool-template/.gitea/workflows/preview-check.yml`), started by the engine. */
const WORKFLOW_PREVIEW = 'preview-check.yml';
const MANIFESTS = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json';

/**
 * Failing tests in the log of an `acceptance` job: Playwright failure headers (`  1) [chromium] › …`) and failed platform
 * SEC-* checks (`✖ SEC-…` of node --test), each line's timestamp and colours removed; deduplicated, 20 at most.
 */
export function acceptanceFailures(log: string): string[] {
  const failures = new Set<string>();
  for (const brute of log.split('\n')) {
    const l = brute.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d{4}-\d\d-\d\dT\S+Z /, '').trimEnd();
    const m = /^\s+\d+\) (.+?)[\s─]*$/.exec(l) ?? /^\s*✖ (SEC-.+?)(?: \([\d.]+m?s\))?$/.exec(l);
    if (m) failures.add(m[1]!.slice(0, 200));
  }
  return [...failures].slice(0, 20);
}

/** Line printed by the template's `analysis` job before its Opengrep SARIF results, one JSON result per line (check.yml). */
export const SARIF_MARKER = 'opengrep-sarif-results';

/**
 * Opengrep SARIF of a red `analysis` job, rebuilt from its log: the JSON lines after the LAST marker line (the agent's
 * code shown earlier by the scan cannot fake it: the results step runs after the scan, each result on one escaped line);
 * timestamps removed, 50 results at most. No marker → null (the scan did not produce its SARIF).
 */
export function opengrepSarif(log: string): { runs: { results: unknown[] }[] } | null {
  const lines = log.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT\S+Z /, '').trimEnd());
  const start = lines.lastIndexOf(SARIF_MARKER);
  if (start === -1) return null;
  const results: unknown[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith('{')) continue;
    try { results.push(JSON.parse(l)); } catch { /* not a result line */ }
  }
  return { runs: [{ results: results.slice(0, 50) }] };
}

export class GiteaForge implements Forge {
  readonly #api: string;
  readonly #token: string;
  readonly #org: string;
  readonly #template: string;
  readonly #team: string;
  readonly #account: string;
  readonly #timeoutMs: number;
  readonly #attempts: number;
  readonly #intervalMs: number;
  readonly #url: string;
  readonly #gitTimeoutMs: number;

  constructor(o: GiteaForgeOptions) {
    const url = verifyAddress(o.url, o.token);
    this.#url = o.url;
    this.#api = `${url.origin}${url.pathname.replace(/\/+$/, '')}/api/v1`;
    this.#token = o.token;
    this.#org = o.organisation ?? 'eupadev';
    this.#template = o.model ?? 'tool-template';
    this.#team = o.agentsTeam ?? 'agents';
    this.#account = o.account ?? 'svc-orchestrator';
    this.#timeoutMs = o.timeoutMs ?? 30_000;
    this.#attempts = o.attempts ?? 4;
    this.#intervalMs = o.intervalMs ?? 1000;
    this.#gitTimeoutMs = o.gitTimeoutMs ?? 120_000;
  }

  /**
   * Generates the tool from the template (protections copied, `protected_branch`), assigns it to the agents' team, then
   * removes its own administration (Gitea makes the creator admin of the repository) and checks the final state. Resume
   * (existing repository, 409): if the account is still a collaborator, the creation had stopped midway and is completed;
   * otherwise the final state must already be there, otherwise the repository is not ours (clear error, nothing is changed).
   */
  async createRepo(slug: string, signal?: AbortSignal): Promise<void> {
    verifierSlug(slug);
    const repo = `/repos/${this.#org}/${slug}`;
    const gen = await this.#call('POST', `/repos/${this.#org}/${this.#template}/generate`, [201, 409], signal,
      { owner: this.#org, name: slug, private: true, git_content: true, protected_branch: true });
    if (gen.status === 409) {
      const d = (await this.#call('GET', repo, [200], signal)).body as Repo;
      if (d?.private !== true || d.template === true || d.archived === true) throw new ForgeError(`repository ${this.#org}/${slug} already exists and is not a tool created by the engine (public, template or archived)`, false);
    }
    const collaborator = await this.#call('GET', `${repo}/collaborators/${this.#account}`, [204, 404], signal);
    if (collaborator.status === 204) {
      // Still admin: the only moment when Gitea shows the name of the rule protecting main, and when assigning to the team is
      // possible (Gitea requires administration for both).
      await this.#verifierMain(slug, true, signal);
      const team = await this.#teamId(signal);
      await this.#call('PUT', `/teams/${team}/repos/${this.#org}/${slug}`, [204], signal);
      await this.#call('DELETE', `${repo}/collaborators/${this.#account}`, [204], signal);
    }
    await this.#checkRepo(slug, signal);
  }

  /** Required final state: private, not archived, account no longer admin nor collaborator, assigned to the team, `main` protected. */
  async #checkRepo(slug: string, signal?: AbortSignal): Promise<void> {
    const repo = `/repos/${this.#org}/${slug}`;
    const name = `${this.#org}/${slug}`;
    const d = (await this.#call('GET', repo, [200], signal)).body as Repo;
    if (d?.private !== true || d.archived === true) throw new ForgeError(`repository ${name} is not private or is archived`, false);
    if (d.permissions?.admin !== false) throw new ForgeError(`${this.#account} is still an administrator of ${name}`, false);
    if ((await this.#call('GET', `${repo}/collaborators/${this.#account}`, [204, 404], signal)).status !== 404) throw new ForgeError(`${this.#account} is still a collaborator of ${name}`, false);
    const team = await this.#teamId(signal);
    if ((await this.#call('GET', `/teams/${team}/repos/${this.#org}/${slug}`, [200, 404], signal)).status !== 200) {
      throw new ForgeError(`repository ${name} exists without being assigned to team ${this.#team}: not created by the engine, or resume impossible without administration (to be fixed by a human)`, false);
    }
    await this.#verifierMain(slug, false, signal);
  }

  /**
   * `main` protected; and by the template's "main" rule if `requireRule`. Gitea gives the rule's name
   * (`effective_branch_protection_name`) only to an admin of the repository (services/convert ToBranch): checkable only
   * before the account removes its own administration.
   */
  async #verifierMain(slug: string, requireRule: boolean, signal?: AbortSignal): Promise<void> {
    const main = (await this.#call('GET', `/repos/${this.#org}/${slug}/branches/main`, [200, 404], signal));
    const b = main.body as { protected?: boolean; effective_branch_protection_name?: string } | null;
    if (main.status !== 200 || b?.protected !== true || (requireRule && b.effective_branch_protection_name !== 'main')) {
      throw new ForgeError(`repository ${this.#org}/${slug} lacks the template's "main" protection on its main branch`, false);
    }
  }

  async #teamId(signal?: AbortSignal): Promise<number> {
    const teams = (await this.#call('GET', `/orgs/${this.#org}/teams?limit=50`, [200], signal)).body;
    const e = Array.isArray(teams) ? teams.find((x: { name?: unknown }) => x?.name === this.#team) : undefined;
    if (!Number.isInteger(e?.id)) throw new ForgeError(`team ${this.#team} not found in ${this.#org}`, false);
    return e.id as number;
  }

  /**
   * The validated work of a step enters main before the next role starts from main (the base of a task without a
   * branch): the scoping branch when the contract starts, the contract branch when tests and builder start. Local Git
   * (like `integrate`): a `--no-ff` merge commit pushed by this account (push whitelist of main), never a squash: the
   * branch stays an ancestor of main, so a later pass of the same role (Gate 1 `scope_change`) merges cleanly
   * instead of conflicting with its own squashed lines. `[skip ci]`: nothing runnable changes, the CI of main is for
   * the squash of a round (E4). Idempotent: branch absent (the role pushed nothing) → nothing; already in main → the
   * merge is up to date, nothing is pushed.
   * The diff the merge brings in (`main...branch`) must stay in the role's perimeter (same `inScope` as the
   * launcher and `merge`); a conflict with main is a definitive error (perimeters are disjoint: it cannot be normal).
   */
  async publish(slug: string, cycleId: number, role: PublishedRole, signal?: AbortSignal): Promise<void> {
    verifierSlug(slug, cycleId);
    const b = `agent/${slug}/${cycleId}/${role}`;
    await this.#withClone(slug, signal, async (repo) => {
      if (!(await repo.branches()).has(b)) return;
      const outside = withoutEmpty((await repo.git(['diff', '--name-only', '-z', '--no-renames', `origin/main...origin/${b}`])).output).filter((f) => !inScope(role, f));
      if (outside.length > 0) throw new ForgeError(`branch ${b} outside the scope of role ${role}: ${outside.sort().slice(0, 10).join(', ')}`, false);
      await repo.git(['checkout', '-q', '-B', 'main', 'origin/main']);
      const m = await repo.git(['merge', '-q', '--no-ff', '--no-edit', '-m', `Publish ${role} (cycle ${cycleId}) [skip ci]`, `origin/${b}`], [0, 1]);
      if (m.code !== 0) {
        const files = withoutEmpty((await repo.git(['diff', '--name-only', '-z', '--diff-filter=U'])).output);
        throw new ForgeError(`merging ${b} into main impossible: ${files.length > 0 ? `conflict on ${files.sort().join(', ')}` : m.errors.slice(0, 200)}`, false);
      }
      await repo.push('main');
    });
  }

  /**
   * Decision A: the core bump computed by the engine enters main as one commit of this account (`[skip ci]` like
   * `publish`: the round's CI tests it). Only `package.json` and `pnpm-lock.yaml` are written; nothing to commit
   * (replay after a push that succeeded) → nothing is pushed.
   */
  async publishCore(slug: string, cycleId: number, update: CoreUpdate, signal?: AbortSignal): Promise<void> {
    verifierSlug(slug, cycleId);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(update.to)) throw new ForgeError(`core version refused: ${JSON.stringify(update.to).slice(0, 40)}`, false);
    await this.#withClone(slug, signal, async (repo) => {
      await repo.git(['checkout', '-q', '-B', 'main', 'origin/main']);
      await writeFile(join(repo.dir, 'package.json'), update.package_json);
      await writeFile(join(repo.dir, 'pnpm-lock.yaml'), update.lockfile);
      if ((await repo.git(['status', '--porcelain', '--', 'package.json', 'pnpm-lock.yaml'])).output.trim() === '') return;
      await repo.git(['add', '--', 'package.json', 'pnpm-lock.yaml']);
      await repo.git(['commit', '-q', '-m', `Core @eupadev/core ${update.to} (cycle ${cycleId}) [skip ci]`]);
      await repo.push('main');
    });
  }

  /**
   * E3, local Git: `integration/<cycle>/<round>` starts from main (or from itself if it already
   * exists: resume), then each role branch present is merged into it (`--no-ff`). A conflict: its files are noted,
   * the merge aborted, next role; if there was one, nothing is pushed. Otherwise push, never forced (Gitea: only this account
   * writes outside `agent/**` and `exception/**`). Not through the API: Gitea merges one branch into another only through a
   * PR, and a conflicting PR answers there like a PR being computed (405 "Please try again later", without the files).
   */
  async integrate(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<IntegrationResult> {
    verifierSlug(slug, cycleId, iteration);
    const head = `integration/${cycleId}/${iteration}`;
    return this.#withClone(slug, signal, async (repo) => {
      const branches = await repo.branches();
      await repo.git(['checkout', '-q', '-B', head, branches.has(head) ? `origin/${head}` : 'origin/main']);
      const conflicts = new Set<string>();
      for (const role of CODE_ROLES) {
        const b = `agent/${slug}/${cycleId}/${role}`;
        if (!branches.has(b)) continue; // the role pushed nothing
        const m = await repo.git(['merge', '-q', '--no-ff', '--no-edit', '-m', `Integrate ${role} (cycle ${cycleId}, round ${iteration})`, `origin/${b}`], [0, 1]);
        if (m.code === 0) continue;
        const files = withoutEmpty((await repo.git(['diff', '--name-only', '-z', '--diff-filter=U'])).output);
        if (files.length === 0) throw new ForgeError(`merging ${b} into ${head} impossible: ${m.errors.slice(0, 200)}`, false);
        for (const f of files) conflicts.add(f);
        await repo.git(['merge', '--abort']);
      }
      if (conflicts.size > 0) return { result: 'conflict', files: [...conflicts].sort() };
      await repo.push(head);
      return { result: 'ok' };
    });
  }

  /**
   * Diff check of each role (same scope as the launcher, `inScope`: the commons pass), then PR `integration/<cycle>/<round>` → main (resumed if it exists), squash by the
   * orchestrator account, never `force_merge`. An already merged PR returns `ok` (resume). Diff checked (local Git): what
   * the role brought to the integration (its integrated commit = common base of the two branches), from its common base with
   * main (`main...commit`): the net content the squash brings in. Not the role's branch as it is
   * now (a revert pushed after the integration hides nothing), nor commit by commit (Gitea counts a commit
   * merging main into the branch as changing main's files: `git log -m --first-parent`).
   */
  async merge(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<MergeResult> {
    verifierSlug(slug, cycleId, iteration);
    const repo = `/repos/${this.#org}/${slug}`;
    const head = `integration/${cycleId}/${iteration}`;
    const outside = await this.#withClone(slug, signal, async (git) => {
      const branches = await git.branches();
      if (!branches.has(head)) throw new ForgeError(`branch ${head} missing: integrate before merging`, false);
      const found = new Map<string, { file: string; role: Role }>();
      for (const role of CODE_ROLES) {
        const b = `agent/${slug}/${cycleId}/${role}`;
        if (!branches.has(b)) continue;
        const integrated = (await git.git(['merge-base', `origin/${head}`, `origin/${b}`], [0, 1])).output.trim();
        if (integrated === '') continue; // nothing from this role in the integration
        for (const f of withoutEmpty((await git.git(['diff', '--name-only', '-z', '--no-renames', `origin/main...${integrated}`])).output)) {
          if (!inScope(role, f)) found.set(`${role}:${f}`, { file: f, role });
        }
      }
      return [...found.values()];
    });
    if (outside.length > 0) return { result: 'out_of_scope', files: outside };

    const existing = await this.#call('GET', `${repo}/pulls/main/${head}`, [200, 404], signal);
    const pr = (existing.status === 200 ? existing.body
      : (await this.#call('POST', `${repo}/pulls`, [201], signal, { base: 'main', head: head, title: `Cycle ${cycleId}, round ${iteration}` })).body) as PR;
    if (!Number.isInteger(pr?.number)) throw new ForgeError('unreadable PR', false);
    if (pr.merged === true) return { result: 'ok' };
    if (pr.state !== 'open') throw new ForgeError(`PR ${pr.number} (${head}) is closed without a merge`, false);
    for (let i = 1; ; i++) {
      const r = await this.#call('POST', `${repo}/pulls/${pr.number}/merge`, [200, 405], signal, { Do: 'squash' });
      if (r.status === 200) return { result: 'ok' };
      const message = messageGitea(r.body);
      if (message === 'The PR is already merged') return { result: 'ok' };
      if (message !== 'Please try again later') throw new ForgeError(`merge of PR ${pr.number} refused: ${message}`, false, 405);
      if (i >= this.#attempts) throw new ForgeError(`PR ${pr.number} still not mergeable after ${i} attempts`, true, 405);
      await sleep(this.#intervalMs * 2 ** (i - 1), undefined, { signal });
    }
  }

  /**
   * E4, watcher: main CI started by the round's squash — commit read from the PR `integration/<cycle>/<round>`
   * (mergeable by this account only), never main's head nor a commit status (M6). Last run of `check.yml` on
   * main for that commit: not finished → null; jobs `success` → green, `failure`/`cancelled` → red, `skipped` left out (nothing
   * checked); all green → digest asked of the registry (M5: it is authoritative, never the job's log).
   */
  async ciFinished(slug: string, cycleId: number, iteration: number, signal?: AbortSignal): Promise<CiResult | null> {
    verifierSlug(slug, cycleId, iteration);
    const repo = `/repos/${this.#org}/${slug}`;
    const head = `integration/${cycleId}/${iteration}`;
    const pr = (await this.#call('GET', `${repo}/pulls/main/${head}`, [200], signal)).body as PR | null;
    const commit = pr?.merge_commit_sha;
    if (pr?.merged !== true || typeof commit !== 'string' || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
      throw new ForgeError(`PR ${head} not merged into main: no CI to watch`, false);
    }
    const runs = ((await this.#call('GET', `${repo}/actions/workflows/${WORKFLOW_CI}/runs?branch=main&head_sha=${commit}&limit=50`, [200], signal)).body as { workflow_runs?: Run[] } | null)?.workflow_runs;
    if (!Array.isArray(runs)) throw new ForgeError('unreadable CI runs', false);
    const run = runs.filter((r) => r?.head_sha === commit && Number.isSafeInteger(r.id)).sort((a, b) => b.id - a.id)[0];
    if (run === undefined || run.status !== 'completed') return null;
    const checks = await this.#checks(repo, run, signal);
    if (checks.some((k) => k.result === 'red')) return { outcome: 'red', checks: checks };
    // Image missing: green CI WITHOUT a digest, passed on as is; W1 refuses to make it a candidate image (incident).
    const digest = await this.#digest(slug, commit, signal);
    return digest === null ? { outcome: 'green', checks: checks } : { outcome: 'green', digest: digest, checks: checks };
  }

  /**
   * Jobs of a finished run as checks: `success` → green, anything else → red, `skipped` left out; a failed run without a red
   * job adds a red `pipeline`. A red `acceptance` job carries its failing tests read in its log (`details.failures`):
   * the hardening round cannot rerun that suite itself. A red `analysis` job carries its Opengrep
   * SARIF results read in its log (`opengrepSarif`, M5).
   */
  async #checks(repo: string, run: Run, signal?: AbortSignal): Promise<CiResult['checks']> {
    const jobs = ((await this.#call('GET', `${repo}/actions/runs/${run.id}/jobs?limit=50`, [200], signal)).body as { jobs?: { id?: unknown; name?: unknown; conclusion?: unknown }[] } | null)?.jobs;
    if (!Array.isArray(jobs)) throw new ForgeError(`unreadable jobs of run ${run.id}`, false);
    const checks: CiResult['checks'] = [];
    for (const j of jobs.filter((x) => x?.conclusion !== 'skipped')) {
      const k: CiResult['checks'][number] = { check: typeof j?.name === 'string' && j.name.trim() !== '' ? j.name : 'unnamed job', result: j?.conclusion === 'success' ? 'green' : 'red' };
      if (k.check === 'acceptance' && k.result === 'red' && Number.isSafeInteger(j.id)) {
        const log = await this.#call('GET', `${repo}/actions/jobs/${j.id as number}/logs`, [200, 404], signal, undefined, { text: true });
        k.details = { failures: log.status === 200 ? acceptanceFailures(log.text) : [] };
      } else if (k.check === 'analysis' && k.result === 'red' && Number.isSafeInteger(j.id)) {
        const log = await this.#call('GET', `${repo}/actions/jobs/${j.id as number}/logs`, [200, 404], signal, undefined, { text: true });
        const sarif = log.status === 200 ? opengrepSarif(log.text) : null;
        if (sarif !== null) k.details = sarif;
      }
      checks.push(k);
    }
    if (run.conclusion !== 'success' && checks.every((k) => k.result === 'green')) checks.push({ check: 'pipeline', result: 'red' });
    return checks;
  }

  /** Runs of the Preview pipeline (newest first, as Gitea lists them). */
  async #runsPreview(repo: string, signal?: AbortSignal): Promise<Run[]> {
    const runs = ((await this.#call('GET', `${repo}/actions/workflows/${WORKFLOW_PREVIEW}/runs?limit=50`, [200], signal)).body as { workflow_runs?: Run[] } | null)?.workflow_runs;
    if (!Array.isArray(runs)) throw new ForgeError('unreadable Preview pipeline runs', false);
    return runs.filter((r) => Number.isSafeInteger(r?.id));
  }

  /**
   * E5f: dispatches the Preview pipeline on main with the Preview URL. Gitea answers 204 without the run id: returns the
   * highest run id of that workflow BEFORE the dispatch; the run to read is the first one above it (W1 stores it in a step).
   */
  async launchPreviewPipeline(slug: string, url: string, signal?: AbortSignal): Promise<number> {
    verifierSlug(slug);
    if (!/^https:\/\/[a-z0-9.-]+$/.test(url)) throw new ForgeError(`Preview URL refused: ${JSON.stringify(url).slice(0, 80)}`, false);
    const repo = `/repos/${this.#org}/${slug}`;
    const before = Math.max(0, ...(await this.#runsPreview(repo, signal)).map((r) => r.id));
    await this.#call('POST', `${repo}/actions/workflows/${WORKFLOW_PREVIEW}/dispatches`, [204], signal, { ref: 'main', inputs: { url } });
    return before;
  }

  /** E5f: the first Preview pipeline run above `since`: null while absent or running, else its jobs as checks. */
  async previewPipelineFinished(slug: string, since: number, signal?: AbortSignal): Promise<{ outcome: 'green' | 'red'; checks: CiResult['checks'] } | null> {
    verifierSlug(slug);
    if (!Number.isSafeInteger(since) || since < 0) throw new ForgeError(`invalid run id: ${since}`, false);
    const repo = `/repos/${this.#org}/${slug}`;
    const run = (await this.#runsPreview(repo, signal)).filter((r) => r.id > since).sort((a, b) => a.id - b.id)[0];
    if (run === undefined || run.status !== 'completed') return null;
    const checks = await this.#checks(repo, run, signal);
    return { outcome: checks.some((k) => k.result === 'red') ? 'red' : 'green', checks: checks };
  }

  /** Digest of `<org>/<slug>:<commit>` given by the registry (`Docker-Content-Digest`), null if the image is missing; `read:package` scope required. */
  async #digest(slug: string, commit: string, signal?: AbortSignal): Promise<string | null> {
    const image = `${this.#org}/${slug}`;
    const origin = new URL(this.#api).origin;
    const basic = `Basic ${Buffer.from(`${this.#account}:${this.#token}`).toString('base64')}`;
    const token = ((await this.#call('GET', `/v2/token?scope=repository:${image}:pull`, [200], signal, undefined, { origin, auth: basic })).body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '') throw new ForgeError('registry: unreadable read token', false);
    const r = await this.#call('HEAD', `/v2/${image}/manifests/${commit}`, [200, 404], signal, undefined, { origin, auth: `Bearer ${token}`, accept: MANIFESTS });
    if (r.status === 404) return null;
    const digest = r.headers.get('docker-content-digest') ?? '';
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new ForgeError(`registry: unreadable digest for ${image}:${commit.slice(0, 12)}`, false);
    return digest;
  }

  /** Throwaway clone of the tool with this account's token, deleted whatever happens. */
  async #withClone<T>(slug: string, signal: AbortSignal | undefined, fn: (repo: GitRepo) => Promise<T>): Promise<T> {
    const repo = await GitRepo.clone({ url: this.#url, organisation: this.#org, slug, token: this.#token, account: this.#account, attempts: this.#attempts, intervalMs: this.#intervalMs, timeoutMs: this.#gitTimeoutMs }, signal);
    try {
      return await fn(repo);
    } finally {
      await repo.release();
    }
  }

  /**
   * E5e: tar.gz archive of the head of the scoping branch (`agent/<slug>/<cycle>/scoping`), read with the engine's token,
   * capped at 50 MB (ADR-009). The deployer hashes it; the target checks the hash again before extracting `web/`.
   */
  async scopingArchive(slug: string, cycleId: number, signal?: AbortSignal): Promise<Buffer> {
    verifierSlug(slug, cycleId);
    const repo = `/repos/${this.#org}/${slug}`;
    const branch = (await this.#call('GET', `${repo}/branches/agent/${slug}/${cycleId}/scoping`, [200], signal)).body as { commit?: { id?: unknown } } | null;
    const commit = branch?.commit?.id;
    if (typeof commit !== 'string' || !/^[0-9a-f]{40,64}$/.test(commit)) throw new ForgeError(`scoping branch of ${slug} cycle ${cycleId}: unreadable head commit`, false);
    const r = await fetch(`${this.#api}${repo}/archive/${commit}.tar.gz`, {
      headers: { Authorization: `token ${this.#token}` },
      signal: signal === undefined ? AbortSignal.timeout(this.#timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
    });
    if (r.status !== 200) throw new ForgeError(`Gitea GET archive ${commit.slice(0, 12)}: ${r.status}`, r.status >= 500 || r.status === 429, r.status);
    const data = Buffer.from(await r.arrayBuffer());
    if (data.length > 50 * 1024 * 1024) throw new ForgeError(`archive of ${slug} over 50 MB`, false);
    return data;
  }

  /**
   * One API call: retries transient faults (5xx, 429, network, timeout); a status outside `expected` is a
   * definitive refusal. Cancellation (`signal`) stops everything at once. No message contains the token.
   */
  async #call(method: string, path: string, expected: number[], signal?: AbortSignal, body?: unknown, elsewhere?: Elsewhere): Promise<Response> {
    const what = `${method} ${path.split('?')[0]}`;
    for (let i = 1; ; i++) {
      signal?.throwIfAborted();
      let fault: string;
      let status: number | undefined;
      try {
        const r = await fetch((elsewhere?.origin ?? this.#api) + path, {
          method: method,
          headers: { Authorization: elsewhere?.auth ?? `token ${this.#token}`, Accept: elsewhere?.accept ?? 'application/json', 'Content-Type': 'application/json' },
          body: body === undefined ? null : JSON.stringify(body),
          redirect: 'manual',
          signal: signal === undefined ? AbortSignal.timeout(this.#timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
        });
        const text = await r.text();
        let json: unknown = null;
        if (text !== '') {
          try {
            json = JSON.parse(text);
          } catch {
            if (expected.includes(r.status) && !elsewhere?.text) throw new ForgeError(`Gitea ${what}: unreadable answer (${r.status}, not JSON)`, false, r.status);
          }
        }
        if (expected.includes(r.status)) return { status: r.status, body: json, headers: r.headers, text: text };
        status = r.status;
        if (r.status < 500 && r.status !== 429) throw new ForgeError(`Gitea ${what}: refusal ${r.status} ${messageGitea(json)}`.trim(), false, r.status);
        fault = `${r.status} ${messageGitea(json)}`.trim();
      } catch (e) {
        if (e instanceof ForgeError) throw e;
        if (signal?.aborted) throw signal.reason;
        fault = e instanceof Error && e.name === 'TimeoutError' ? `timeout of ${this.#timeoutMs} ms exceeded` : `network: ${networkCause(e)}`;
      }
      if (i >= this.#attempts) throw new ForgeError(`Gitea ${what}: transient fault after ${i} attempts (${fault})`, true, status);
      await sleep(this.#intervalMs * 2 ** (i - 1), undefined, { signal });
    }
  }
}

/** The slug's pattern (`orchestrator.ts`): nothing that could escape the API path or a branch name. */
function verifierSlug(slug: string, ...counts: number[]): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw new ForgeError(`invalid slug: ${JSON.stringify(slug).slice(0, 80)}`, false);
  if (!counts.every((n) => Number.isSafeInteger(n) && n > 0)) throw new ForgeError(`invalid cycle or round: ${counts.join(', ')}`, false);
}

const withoutEmpty = (outputZ: string) => outputZ.split('\0').filter((f) => f !== '');

export interface GitOutput { code: number; output: string; errors: string }

/** Git network faults (clone, push) to retry; everything else is a refusal. */
const GIT_FAULT = /Could not resolve host|Failed to connect|Connection (refused|reset|timed out)|Operation timed out|The requested URL returned error: (5\d\d|429)|RPC failed|early EOF|unexpected disconnect/i;

/**
 * Throwaway clone of a tool (temporary folder, in-memory `/tmp` in the engine's container) and Git with a robot's
 * token. The token goes through Git's ENVIRONMENT (`GIT_CONFIG_*`, header limited to the forge's address), never as an
 * argument (readable by `ps`) nor in the URL; no system or user configuration read; redirects
 * refused; never a forced push. Certificate authority: `GIT_SSL_CAINFO` if given (lab), otherwise the system's.
 */
export class GitRepo {
  readonly dir: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #signal: AbortSignal | undefined;
  readonly #o: GitRepoOptions;

  private constructor(root: string, env: NodeJS.ProcessEnv, o: GitRepoOptions, signal?: AbortSignal) {
    this.dir = join(root, 'repo');
    this.#env = env;
    this.#o = o;
    this.#signal = signal;
  }

  static async clone(o: GitRepoOptions, signal?: AbortSignal): Promise<GitRepo> {
    const forge = new URL(o.url);
    const root = await mkdtemp(join(tmpdir(), 'eupadev-git-'));
    const config: [string, string][] = [
      [`http.${forge.origin}${forge.pathname.replace(/\/*$/, '/')}.extraHeader`, `Authorization: token ${o.token}`],
      ['http.followRedirects', 'false'],
      ['user.name', o.account],
      ['user.email', `${o.account}@eupadev.invalid`],
      ['commit.gpgSign', 'false'],
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: root, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: String(config.length),
      ...(process.env['GIT_SSL_CAINFO'] === undefined ? {} : { GIT_SSL_CAINFO: process.env['GIT_SSL_CAINFO'] }),
    };
    config.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
    const repo = new GitRepo(root, env, o, signal);
    try {
      const url = `${forge.origin}${forge.pathname.replace(/\/+$/, '')}/${o.organisation}/${o.slug}.git`;
      await repo.#network(['clone', '-q', '--no-tags', '--no-checkout', url, repo.dir], root);
    } catch (e) {
      await repo.release();
      throw e;
    }
    return repo;
  }

  /** The forge's branches (tracked by the clone). */
  async branches(): Promise<Set<string>> {
    const r = await this.git(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin']);
    return new Set(r.output.split('\n').filter((b) => b !== '' && b !== 'HEAD'));
  }

  /** Pushes HEAD to `branch`, never forcing (a push refused by the forge is a refusal). */
  async push(branch: string): Promise<void> {
    await this.#network(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], this.dir);
  }

  /** One Git command; an exit code outside `codes` is an error (refusal) with the end of its error output. */
  git(args: string[], codes = [0], cwd = this.dir): Promise<GitOutput> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, env: this.#env, timeout: this.#o.timeoutMs, maxBuffer: 16 * 1024 * 1024, ...(this.#signal === undefined ? {} : { signal: this.#signal }) }, (e, output, errors) => {
        if (this.#signal?.aborted) return reject(this.#signal.reason);
        const code = e === null ? 0 : typeof e.code === 'number' ? e.code : -1;
        if (codes.includes(code)) return resolve({ code, output: output, errors: errors });
        const timeout = e !== null && e.killed === true;
        reject(new ForgeError(`git ${args[0]}: ${timeout ? `timeout of ${this.#o.timeoutMs} ms exceeded` : `failed (${code}) ${errors.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`}`, timeout || GIT_FAULT.test(errors)));
      });
    });
  }

  /** Command that talks to the forge: transient faults retried like the API calls. */
  async #network(args: string[], cwd: string): Promise<void> {
    for (let i = 1; ; i++) {
      try {
        await this.git(args, [0], cwd);
        return;
      } catch (e) {
        if (!(e instanceof ForgeError) || !e.transient || i >= this.#o.attempts) throw e;
        if (args[0] === 'clone') await rm(this.dir, { recursive: true, force: true });
        await sleep(this.#o.intervalMs * 2 ** (i - 1), undefined, { signal: this.#signal });
      }
    }
  }

  async release(): Promise<void> {
    await rm(join(this.dir, '..'), { recursive: true, force: true });
  }
}

export interface GitRepoOptions { url: string; organisation: string; slug: string; token: string; account: string; attempts: number; intervalMs: number; timeoutMs: number }

/** Gitea's error message (`{ message }`), bounded: never a whole response body in an error. */
function messageGitea(json: unknown): string {
  const m = (json as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m.slice(0, 200) : '';
}

/** Cause of a fetch network error (system code), without the URL. */
function networkCause(e: unknown): string {
  const cause = (e as { cause?: { code?: unknown; message?: unknown } })?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.message === 'string' && cause.message !== '') return cause.message.slice(0, 200);
  return e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
}
