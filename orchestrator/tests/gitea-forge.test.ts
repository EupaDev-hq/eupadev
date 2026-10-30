// Real forge (E2, E3) against a FAKE local Gitea 28 (node:http, no fetch mock): it mimics the responses found in
// the Gitea 28.1.0 code (`routers/api/v1`) for the routes the adapter uses, and serves real Git repositories
// (`git http-backend`, `Authorization: token` header required) with the robots' push rules from
// `group_vars/forge/vars.yml` mimicked by a `pre-receive` hook (main and any branch outside `agent/**`: svc-orchestrator
// only; never a deletion or a force push). E4: CI runs and jobs, registry (`/v2/token`, `read:package` scope
// required, then `HEAD` of the manifest). Without a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CODE_ROLES, type TaskInput } from '../src/external/contracts.ts';
import { ForgeError, GiteaForge, acceptanceFailures, opengrepSarif, SARIF_MARKER } from '../src/external/gitea-forge.ts';
import { opengrepDeviations, SARIF_CHECK } from '../src/hardening/stagnation.ts';
import { PushingEngine } from '../src/external/pushing-engine.ts';

const ORCHESTRATOR_PAT = 'test-token-0123456789';
const AGENT_PAT = 'agent-test-token-9876543210';
const ACCOUNTS: Record<string, string> = { [ORCHESTRATOR_PAT]: 'svc-orchestrator', [AGENT_PAT]: 'svc-agent' };
const ORG = 'eupadev';
const TEAM = { id: 7, name: 'agents' };
const IDENTITY = { GIT_AUTHOR_NAME: 'fake', GIT_AUTHOR_EMAIL: 'fake@test', GIT_COMMITTER_NAME: 'fake', GIT_COMMITTER_EMAIL: 'fake@test', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

/** Git in a directory of the fake (exit code 0 required). */
function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...IDENTITY, ...env }, encoding: 'utf8' });
}

// Push rules of the robots (vars.yml, gitea_branch_protections); the log records who pushed what.
const PRE_RECEIVE = `#!/bin/sh
z=0000000000000000000000000000000000000000
while read old new ref; do
  b=\${ref#refs/heads/}
  echo "$REMOTE_USER $b" >> "$GIT_DIR/push-log"
  [ "$new" = "$z" ] && { echo "deletion of $b refused"; exit 1; }
  case "$b" in agent/*) ;; *) [ "$REMOTE_USER" = svc-orchestrator ] || { echo "push to $b refused for $REMOTE_USER"; exit 1; } ;; esac
  if [ "$old" != "$z" ] && ! git merge-base --is-ancestor "$old" "$new"; then echo "forced push to $b refused"; exit 1; fi
done
`;

interface FakeRepo { private: boolean; template: boolean; archived: boolean; collaborator: boolean; team: boolean; protectedMain: boolean; rule?: string }
interface FakePR { number: number; head: string; state: 'open' | 'closed'; merged: boolean; merged_by?: string; merge_commit_sha?: string }
interface FakeRun { id: number; slug: string; head_sha: string; status: string; conclusion?: string; jobs: { id?: number; name: string; conclusion: string }[] }
type Response = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> };

/** Fake Gitea: minimal state + faults injectable per route (`faults['POST /repos/eupadev/tool-template/generate']`). */
class FakeGitea {
  repos = new Map<string, FakeRepo>();
  prs: FakePR[] = [];
  /** Forced responses, consumed one by one; `'silent'` = never answers. */
  faults = new Map<string, (Response | 'silent')[]>();
  /** Member of the agents team (otherwise PUT /teams → 403 "Must be a team member"). */
  teamMember = true;
  /** 405 "Please try again later" responses before the merge goes through. */
  notReady = 0;
  /** Admin rights coming from somewhere other than the collaboration (e.g. a team with admin rights): removal is not enough. */
  adminElsewhere = false;
  log: { method: string; path: string; auth: string | undefined; body: unknown }[] = [];
  /** E4: runs of `check.yml` (all on main), registry images (`<slug>:<tag>` → digest), token scope. */
  runs: FakeRun[] = [];
  /** E5f: runs of `preview-check.yml` (started by workflow_dispatch). */
  runsPreview: FakeRun[] = [];
  /** Job logs by job id (text, as Gitea serves them). */
  logs = new Map<number, string>();
  images = new Map<string, string>();
  packageScope = true;
  /** Bare Git repositories: `<root>/eupadev/<slug>.git`. */
  readonly root = mkdtempSync(join(tmpdir(), 'fake-gitea-'));
  readonly #server = createServer((req, res) => void this.#handle(req, res));
  url = '';

  async start(): Promise<this> {
    await new Promise<void>((r) => this.#server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this;
  }
  stop(): Promise<void> {
    this.#server.closeAllConnections();
    rmSync(this.root, { recursive: true, force: true });
    return new Promise((r) => this.#server.close(() => r()));
  }
  calls(reason: RegExp): number {
    return this.log.filter((j) => reason.test(`${j.method} ${j.path}`)).length;
  }
  bare(slug: string): string {
    return join(this.root, ORG, `${slug}.git`);
  }
  /** Files of `ref` in the bare repository (null if the branch does not exist). */
  files(slug: string, ref = 'main'): string[] | null {
    const r = spawnSync('git', ['ls-tree', '-r', '--name-only', `refs/heads/${ref}`], { cwd: this.bare(slug), encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n').filter((f) => f !== '') : null;
  }
  head(slug: string, ref = 'main'): string {
    return git(this.bare(slug), ['rev-parse', `refs/heads/${ref}`]).trim();
  }
  /** Who pushed which branch (pre-receive hook). */
  pushes(slug: string): string[] {
    try {
      return readFileSync(join(this.bare(slug), 'push-log'), 'utf8').split('\n').filter((l) => l !== '');
    } catch {
      return [];
    }
  }
  /** Commits pushed directly into the bare repository, as an agent would on its branch (file → content, null = deleted). */
  commits(slug: string, branch: string, ...commits: Record<string, string | null>[]): void {
    this.#commits('svc-agent', slug, branch, commits);
  }
  /** Commits pushed to main by the orchestrator account (the state of main after a previous squash). */
  commitsMain(slug: string, ...commits: Record<string, string | null>[]): void {
    this.#commits('svc-orchestrator', slug, 'main', commits);
  }
  #commits(account: string, slug: string, branch: string, commits: Record<string, string | null>[]): void {
    const work = mkdtempSync(join(tmpdir(), 'fake-agent-'));
    try {
      git(work, ['clone', '-q', this.bare(slug), '.']);
      const exists = spawnSync('git', ['rev-parse', '--verify', '-q', `origin/${branch}`], { cwd: work }).status === 0;
      git(work, ['checkout', '-q', '-B', branch, exists ? `origin/${branch}` : 'origin/main']);
      for (const c of commits) {
        for (const [f, content] of Object.entries(c)) {
          if (content === null) git(work, ['rm', '-q', f]);
          else { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), content); git(work, ['add', f]); }
        }
        git(work, ['commit', '-q', '-m', `trial ${Object.keys(c).join(' ')}`]);
      }
      git(work, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { REMOTE_USER: account });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** Bare repository generated "from the template": one file per directory, a protected pipeline; push rules hook. */
  #generate(slug: string): void {
    const work = mkdtempSync(join(tmpdir(), 'fake-model-'));
    try {
      for (const [f, content] of Object.entries({ 'README.md': '# tool\n', '.gitea/workflows/check.yml': 'on: push\n', 'api/lib/body.js': 'export {};\n', 'web/lib/escape-html.js': 'export {};\n', 'tests/unit/body.test.js': '\n' })) {
        mkdirSync(dirname(join(work, f)), { recursive: true });
        writeFileSync(join(work, f), content);
      }
      git(work, ['init', '-q', '-b', 'main']);
      git(work, ['add', '-A']);
      git(work, ['commit', '-q', '-m', 'Template']);
      git(this.root, ['clone', '-q', '--bare', work, this.bare(slug)]);
      writeFileSync(join(this.bare(slug), 'hooks', 'pre-receive'), PRE_RECEIVE);
      chmodSync(join(this.bare(slug), 'hooks', 'pre-receive'), 0o755);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const piece of req) chunks.push(piece as Buffer);
    const raw = Buffer.concat(chunks);
    if (/^\/eupadev\/[^/]+\.git\//.test(req.url ?? '')) return this.#git(req, res, raw);
    if ((req.url ?? '').startsWith('/v2/')) return this.#registry(req, res);
    const text = raw.toString('utf8');
    const path = (req.url ?? '').replace(/^\/api\/v1/, '');
    const key = `${req.method} ${path.split('?')[0]}`;
    this.log.push({ method: req.method!, path, auth: req.headers.authorization, body: text === '' ? null : JSON.parse(text) });
    const enforced = this.faults.get(key)?.shift();
    if (enforced === 'silent') return; // never any response
    const r = enforced ?? (req.headers.authorization === `token ${ORCHESTRATOR_PAT}` ? this.#router(req.method!, path, text === '' ? null : JSON.parse(text)) : { status: 401, body: { message: 'token is required' } });
    res.writeHead(r.status, { 'Content-Type': r.raw === undefined ? 'application/json' : 'text/html', ...r.headers });
    res.end(r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body)));
  }

  /**
   * Git over HTTP (CGI `git http-backend`): token required in a header; repository invisible (404) to an account without
   * access (svc-agent: only the tools assigned to the agents team; svc-orchestrator: all of them, like its team).
   */
  async #git(req: IncomingMessage, res: ServerResponse, body: Buffer): Promise<void> {
    const account = ACCOUNTS[(req.headers.authorization ?? '').replace(/^token /, '')];
    const [path = '', request = ''] = (req.url ?? '').split('?');
    const d = this.repos.get(path.match(/^\/eupadev\/([^/]+)\.git\//)![1]!);
    if (account === undefined) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Gitea"' });
      return void res.end();
    }
    if (d === undefined || (account === 'svc-agent' && !d.team)) {
      res.writeHead(404);
      return void res.end();
    }
    const child = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env['PATH'], HOME: this.root, GIT_CONFIG_NOSYSTEM: '1', GIT_PROJECT_ROOT: this.root, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: path, QUERY_STRING: request, REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '',
        CONTENT_LENGTH: String(body.length), HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        HTTP_GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''), REMOTE_USER: account, REMOTE_ADDR: '127.0.0.1',
      },
    });
    const output: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => output.push(c));
    child.stdin.end(body);
    await new Promise((r) => child.on('close', r));
    const all = Buffer.concat(output);
    const end = all.indexOf('\r\n\r\n');
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of all.subarray(0, end).toString('latin1').split('\r\n')) {
      const i = line.indexOf(': ');
      if (line.slice(0, i).toLowerCase() === 'status') status = Number.parseInt(line.slice(i + 2), 10);
      else headers[line.slice(0, i)] = line.slice(i + 2);
    }
    res.writeHead(status, headers);
    res.end(all.subarray(end + 4));
  }

  /**
   * Registry (Gitea 28.1.0, `routers/api/packages/container`): `/v2/token` with Basic (account + token), 401 if the token
   * lacks the `read:package` scope; then the manifest with the registry token, `Docker-Content-Digest` in a header.
   */
  #registry(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '';
    this.log.push({ method: req.method!, path: url, auth: req.headers.authorization, body: null });
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && url.startsWith('/v2/token?')) {
      const ok = req.headers.authorization === `Basic ${Buffer.from(`svc-orchestrator:${ORCHESTRATOR_PAT}`).toString('base64')}` && this.packageScope;
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify(ok ? { token: 'fake-registry-token' } : { errors: [{ code: 'UNAUTHORIZED' }] }));
    }
    if (req.method === 'HEAD' && req.headers.authorization === 'Bearer fake-registry-token' && (m = url.match(/^\/v2\/eupadev\/([^/]+)\/manifests\/([^/]+)$/))) {
      const d = this.images.get(`${m[1]}:${m[2]}`);
      res.writeHead(d === undefined ? 404 : 200, d === undefined ? {} : { 'Docker-Content-Digest': d });
      return void res.end();
    }
    res.writeHead(401);
    res.end();
  }

  #router(method: string, path: string, body: any): Response {
    const notFound = { status: 404, body: { message: 'The target couldn\'t be found.' } };
    let m: RegExpMatchArray | null;
    if (method === 'POST' && path === `/repos/${ORG}/tool-template/generate`) {
      if (this.repos.has(body.name)) return { status: 409, body: { message: 'The repository with the same name already exists.' } };
      this.#generate(body.name);
      this.repos.set(body.name, { private: body.private, template: false, archived: false, collaborator: true, team: false, protectedMain: body.protected_branch });
      return { status: 201, body: { name: body.name, private: body.private } };
    }
    if (method === 'GET' && path === `/orgs/${ORG}/teams?limit=50`) return { status: 200, body: [{ id: 3, name: 'orchestrator' }, TEAM] };
    if ((m = path.match(/^\/teams\/(\d+)\/repos\/eupadev\/([^/]+)$/))) {
      const d = this.repos.get(m[2]!);
      if (d === undefined || Number(m[1]) !== TEAM.id) return notFound;
      if (method === 'GET') return d.team ? { status: 200, body: { name: m[2] } } : notFound;
      if (!this.teamMember) return { status: 403, body: { message: 'Must be a team member' } };
      if (!d.collaborator) return { status: 403, body: { message: 'Must have permission to manage team repository access' } };
      d.team = true;
      return { status: 204 };
    }
    if (!(m = path.match(/^\/repos\/eupadev\/([^/?]+)(.*)$/))) return notFound;
    const slug = m[1]!;
    const d = this.repos.get(slug);
    if (d === undefined) return notFound;
    const rest = m[2]!;
    if (method === 'GET' && rest === '') return { status: 200, body: { name: slug, private: d.private, template: d.template, archived: d.archived, permissions: { admin: d.collaborator || this.adminElsewhere, push: true, pull: true } } };
    if (rest === '/collaborators/svc-orchestrator') {
      if (method === 'GET') return d.collaborator ? { status: 204 } : notFound;
      if (method === 'DELETE') {
        if (!d.collaborator) return { status: 403, body: { message: 'user should be an owner or a collaborator with admin write of a repository' } };
        d.collaborator = false;
        return { status: 204 };
      }
    }
    // Like Gitea (services/convert ToBranch): the rule name is only given to an admin of the repository.
    if (method === 'GET' && rest === '/branches/main') {
      const admin = d.collaborator || this.adminElsewhere;
      return { status: 200, body: { name: 'main', protected: d.protectedMain, effective_branch_protection_name: d.protectedMain && admin ? (d.rule ?? 'main') : '' } };
    }
    if (method === 'GET' && (m = rest.match(/^\/pulls\/main\/(.+)$/))) {
      const pr = this.prs.find((p) => p.head === m![1]);
      return pr === undefined ? notFound : { status: 200, body: pr };
    }
    if (method === 'POST' && rest === '/pulls') {
      if (this.files(slug, body.head) === null) return notFound; // head branch missing
      const pr: FakePR = { number: this.prs.length + 1, head: body.head, state: 'open', merged: false };
      this.prs.push(pr);
      return { status: 201, body: pr };
    }
    if (method === 'POST' && (m = rest.match(/^\/pulls\/(\d+)\/merge$/))) {
      const pr = this.prs.find((p) => p.number === Number(m![1]));
      if (pr === undefined) return notFound;
      if (pr.merged) return { status: 405, body: { message: 'The PR is already merged' } };
      if (this.notReady-- > 0) return { status: 405, body: { message: 'Please try again later' } };
      if (body.force_merge === true) return { status: 400, body: { message: 'force_merge forbidden in this fake' } };
      if (body.Do !== 'squash') return { status: 400, body: { message: 'squash only in this fake' } };
      // Real squash; a PR in conflict stays "not mergeable" (ErrNotMergeableState → 405, as while being computed).
      const merge = spawnSync('git', ['merge-tree', '--write-tree', 'refs/heads/main', `refs/heads/${pr.head}`], { cwd: this.bare(slug), encoding: 'utf8' });
      if (merge.status !== 0) return { status: 405, body: { message: 'Please try again later' } };
      const commit = git(this.bare(slug), ['commit-tree', merge.stdout.split('\n')[0]!, '-p', 'refs/heads/main', '-m', `Squash ${pr.head}`]).trim();
      git(this.bare(slug), ['update-ref', 'refs/heads/main', commit]);
      Object.assign(pr, { merged: true, state: 'closed', merged_by: 'svc-orchestrator', merge_commit_sha: commit });
      return { status: 200 };
    }
    // Like Gitea (shared.ListRuns): filter by head_sha and branch, most recent first.
    if (method === 'GET' && (m = rest.match(/^\/actions\/workflows\/check\.yml\/runs\?(.*)$/))) {
      const q = new URLSearchParams(m[1]);
      const runs = this.runs.filter((r) => r.slug === slug && q.get('branch') === 'main' && (!q.has('head_sha') || r.head_sha === q.get('head_sha'))).sort((a, b) => b.id - a.id);
      return { status: 200, body: { workflow_runs: runs.map(({ jobs: _j, slug: _s, ...r }) => r), total_count: runs.length } };
    }
    if (method === 'POST' && rest === '/actions/workflows/preview-check.yml/dispatches') return { status: 204 };
    if (method === 'GET' && rest === '/actions/workflows/preview-check.yml/runs?limit=50') {
      const runs = this.runsPreview.filter((r) => r.slug === slug).sort((a, b) => b.id - a.id);
      return { status: 200, body: { workflow_runs: runs.map(({ jobs: _j, slug: _s, ...r }) => r), total_count: runs.length } };
    }
    if (method === 'GET' && (m = rest.match(/^\/actions\/runs\/(\d+)\/jobs\?limit=50$/))) {
      const run = [...this.runs, ...this.runsPreview].find((r) => r.slug === slug && r.id === Number(m![1]));
      return run === undefined ? notFound : { status: 200, body: { jobs: run.jobs, total_count: run.jobs.length } };
    }
    if (method === 'GET' && (m = rest.match(/^\/actions\/jobs\/(\d+)\/logs$/))) {
      const log = this.logs.get(Number(m[1]));
      return log === undefined ? notFound : { status: 200, raw: log };
    }
    return notFound;
  }
}

const FAST = { attempts: 3, intervalMs: 10, timeoutMs: 300 };
async function withFake(fn: (g: FakeGitea, forge: GiteaForge) => Promise<void>, options = FAST): Promise<void> {
  const g = await new FakeGitea().start();
  try {
    await fn(g, new GiteaForge({ url: g.url, token: ORCHESTRATOR_PAT, ...options }));
  } finally {
    await g.stop();
  }
}
/** The expected error, typed, never with the token in its message. */
async function refusal(p: Promise<unknown>, reason: RegExp, transient: boolean): Promise<ForgeError> {
  const e = await p.then(() => assert.fail('error expected'), (x: unknown) => x);
  assert.ok(e instanceof ForgeError, `ForgeError expected, got ${String(e)}`);
  assert.match(e.message, reason);
  assert.equal(e.transient, transient, e.message);
  assert.ok(![ORCHESTRATOR_PAT, AGENT_PAT].some((j) => e.message.includes(j) || (e.stack ?? '').includes(j)), 'the token appears in no error');
  return e;
}

test('E2 forge: creation — generated from the template (private, protections), assigned to the agents, admin removed then checked', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('car-fleet');
    const d = g.repos.get('car-fleet')!;
    assert.deepEqual([d.private, d.collaborator, d.team, d.protectedMain], [true, false, true, true]);
    const gen = g.log.find((j) => j.path.endsWith('/generate'))!;
    assert.deepEqual(gen.body, { owner: ORG, name: 'car-fleet', private: true, git_content: true, protected_branch: true });
    // Order: assigning to the team still requires admin rights, hence before the removal.
    const order = g.log.map((j) => `${j.method} ${j.path}`);
    assert.ok(order.indexOf(`PUT /teams/7/repos/${ORG}/car-fleet`) < order.indexOf(`DELETE /repos/${ORG}/car-fleet/collaborators/svc-orchestrator`));
    assert.ok(g.log.every((j) => j.auth === `token ${ORCHESTRATOR_PAT}` && !j.path.includes(ORCHESTRATOR_PAT)), 'token in a header only');
    // Idempotent: run again, it no longer changes anything.
    const before = g.log.length;
    await forge.createRepo('car-fleet');
    assert.equal(g.calls(/^(PUT|DELETE) /), 2, 'neither assignment nor removal done again');
    assert.ok(g.log.length > before);
  });
});

test('E2 forge: 409 — resume of a creation stopped between the generation and the removal; a repository that is not ours is refused without changing anything', async () => {
  await withFake(async (g, forge) => {
    g.repos.set('resumed', { private: true, template: false, archived: false, collaborator: true, team: false, protectedMain: true });
    await forge.createRepo('resumed');
    assert.deepEqual([g.repos.get('resumed')!.collaborator, g.repos.get('resumed')!.team], [false, true]);

    g.repos.set('human', { private: true, template: false, archived: false, collaborator: false, team: false, protectedMain: false });
    await refusal(forge.createRepo('human'), /exists without being assigned to team agents/, false);
    g.repos.set('public', { private: false, template: false, archived: false, collaborator: true, team: false, protectedMain: true });
    await refusal(forge.createRepo('public'), /already exists and is not a tool created by the engine/, false);
    assert.equal(g.calls(/^(PUT|DELETE) .*(human|public)/), 0, 'nothing changed on a repository that is not ours');
  });
});

test('E2 forge: 403 — permanent refusal, no retry (team the robot is not a member of; no longer admin)', async () => {
  await withFake(async (g, forge) => {
    g.teamMember = false;
    const e = await refusal(forge.createRepo('no-team'), /refusal 403 Must be a team member/, false);
    assert.equal(e.status, 403);
    assert.equal(g.calls(/^PUT \/teams/), 1, 'a refusal is not retried');
    assert.equal(g.repos.get('no-team')!.collaborator, true, 'admin not removed until the assignment is done (resume possible)');
    // After the fix (robot added to the team), the same creation resumes and succeeds.
    g.teamMember = true;
    await forge.createRepo('no-team');
    assert.equal(g.repos.get('no-team')!.team, true);
  });
});

test('E2 forge: main without the template\'s protection, or robot still admin by another way → permanent refusal', async () => {
  await withFake(async (g, forge) => {
    g.repos.set('bare', { private: true, template: false, archived: false, collaborator: true, team: false, protectedMain: false });
    await refusal(forge.createRepo('bare'), /lacks the template's "main" protection/, false);
    g.repos.set('other-rule', { private: true, template: false, archived: false, collaborator: true, team: false, protectedMain: true, rule: 'other' });
    await refusal(forge.createRepo('other-rule'), /lacks the template's "main" protection/, false);
    g.adminElsewhere = true;
    await refusal(forge.createRepo('admin-elsewhere'), /svc-orchestrator is still an administrator of eupadev\/admin-elsewhere/, false);
    assert.equal(g.repos.get('admin-elsewhere')!.collaborator, false, 'the removal did happen, but is not enough');
  });
});

test('E2 forge: 5xx and 429 — retried; persistent → transient error', async () => {
  await withFake(async (g, forge) => {
    const generate = `POST /repos/${ORG}/tool-template/generate`;
    g.faults.set(generate, [{ status: 503, raw: '<html>Bad Gateway</html>' }, { status: 429, body: { message: 'too many requests' } }]);
    await forge.createRepo('after-fault');
    assert.equal(g.calls(/generate$/), 3);
    g.faults.set(generate, [{ status: 500, body: {} }, { status: 502, body: {} }, { status: 503, body: { message: 'under maintenance' } }]);
    const e = await refusal(forge.createRepo('still-faulty'), /transient fault after 3 attempts \(503 under maintenance\)/, true);
    assert.equal(e.status, 503);
  });
});

test('E2 forge: timeout exceeded — retried then transient error; cancellation stops at once', { timeout: 10_000 }, async () => {
  await withFake(async (g, forge) => {
    g.faults.set(`POST /repos/${ORG}/tool-template/generate`, ['silent', 'silent', 'silent']);
    await refusal(forge.createRepo('silent'), /timeout of 300 ms exceeded/, true);
    assert.equal(g.calls(/generate$/), 3);
    g.faults.set(`POST /repos/${ORG}/tool-template/generate`, ['silent', 'silent', 'silent']);
    const cancellation = new AbortController();
    const start = Date.now();
    setTimeout(() => cancellation.abort(new Error('cycle cancelled')), 50);
    await assert.rejects(forge.createRepo('cancelled', cancellation.signal), /cycle cancelled/);
    assert.ok(Date.now() - start < 250, 'stop without waiting for the timeout');
  });
});

test('E2 forge: malformed answer, redirect, 401 — permanent refusals', async () => {
  await withFake(async (g, forge) => {
    g.faults.set(`POST /repos/${ORG}/tool-template/generate`, [{ status: 201, raw: '<html>portail captif</html>' }]);
    await refusal(forge.createRepo('html'), /unreadable answer \(201, not JSON\)/, false);
    g.faults.set(`POST /repos/${ORG}/tool-template/generate`, [{ status: 302, headers: { Location: 'http://elsewhere.example/' } }]);
    await refusal(forge.createRepo('redirected'), /refusal 302/, false);
    assert.equal(g.calls(/generate$/), 2, 'no redirect followed, no retry');
  });
  const g = await new FakeGitea().start();
  try {
    await refusal(new GiteaForge({ url: g.url, token: 'bad-token', ...FAST }).createRepo('x1'), /refusal 401 token is required/, false);
  } finally {
    await g.stop();
  }
});

test('E2 forge: configuration — https required off the local machine, no credentials in the address, slug checked', async () => {
  assert.throws(() => new GiteaForge({ url: 'http://git.example.fr', token: ORCHESTRATOR_PAT }), /https required/);
  assert.throws(() => new GiteaForge({ url: `https://robot:${ORCHESTRATOR_PAT}@git.example.fr`, token: ORCHESTRATOR_PAT }), (e: Error) => /no credentials/.test(e.message) && !e.message.includes(ORCHESTRATOR_PAT));
  assert.throws(() => new GiteaForge({ url: 'not a url', token: ORCHESTRATOR_PAT }), /FORGE_URL invalid/);
  assert.throws(() => new GiteaForge({ url: 'https://git.example.fr', token: ' ' }), /forge token empty/);
  await refusal(new GiteaForge({ url: 'https://git.example.fr', token: ORCHESTRATOR_PAT }).createRepo('../admin'), /invalid slug/, false);
});

test('E2 forge: merge — diff checked per role, PR opened then squash (retry while Gitea computes), resume of a PR already merged', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('tool');
    // Every commit of the role counts, not only the last one; a directory is recognised at the root only
    // (tests/acceptance/api/ belongs to the tests role).
    g.commits('tool', 'agent/tool/4/builder', { 'tests/acceptance/api/stolen.js': 'x\n' }, { 'api/a.js': 'a\n' });
    g.commits('tool', 'agent/tool/4/tests', { 'tests/acceptance/b.js': 'b\n' });
    assert.deepEqual(await forge.integrate('tool', 4, 1), { result: 'ok' });
    assert.deepEqual(await forge.merge('tool', 4, 1), { result: 'out_of_scope', files: [{ file: 'tests/acceptance/api/stolen.js', role: 'builder' }] });
    assert.equal(g.prs.length, 0, 'no PR while the diff goes out of scope');

    // A shared file (README.md) modified by a code role passes the merge as it passes the launcher (same `inScope`).
    g.commits('tool', 'agent/tool/5/builder', { 'api/a.js': 'a\n', 'README.md': 'doc\n' });
    g.commits('tool', 'agent/tool/5/tests', { 'tests/acceptance/a.test.js': 't\n' });
    assert.deepEqual(await forge.integrate('tool', 5, 2), { result: 'ok' });
    g.notReady = 2;
    assert.deepEqual(await forge.merge('tool', 5, 2), { result: 'ok' });
    assert.deepEqual(g.prs.map((p) => [p.head, p.merged]), [['integration/5/2', true]]);
    assert.ok(['api/a.js', 'README.md', 'tests/acceptance/a.test.js'].every((f) => g.files('tool')!.includes(f)), 'real squash into main');
    const merges = g.log.filter((j) => j.path.endsWith('/merge'));
    assert.equal(merges.length, 3);
    assert.ok(merges.every((j) => JSON.stringify(j.body) === '{"Do":"squash"}'), 'squash, never force_merge');
    // Resume: the PR is already merged → ok without a new merge.
    assert.deepEqual(await forge.merge('tool', 5, 2), { result: 'ok' });
    assert.equal(g.calls(/\/merge$/), 3);
    // Still not mergeable after the attempts → transient error.
    g.commits('tool', 'agent/tool/6/builder', { 'api/c.js': 'c\n' });
    await forge.integrate('tool', 6, 1);
    g.notReady = 10;
    await refusal(forge.merge('tool', 6, 1), /still not mergeable after 3 attempts/, true);
  });
});

// ── E3: fake that pushes, integration, merge (real Git behind the fake Gitea) ──────────────────────────────────────────

const FAST_GIT = { attempts: 3, intervalMs: 10 };

function input(tool: string, cycle: number, role: TaskInput['role'], round = 1): TaskInput {
  return {
    task_id: `t${cycle}-${round}-${role}`, tool, role, instructions: `Role ${role}`, context: {}, cap: { duration_min: 5, turns: 10, budget_usd: 1 },
    model: 'fake-model', effort: 'low', branch: `agent/${tool}/${cycle}/${role}`, signal: new AbortController().signal,
  };
}
/** The code roles push their set (svc-agent token), in queue order: tests then builder. */
async function rolesPush(g: FakeGitea, tool: string, cycle: number, round = 1) {
  const engine = new PushingEngine({ url: g.url, token: AGENT_PAT, ...FAST_GIT });
  const outputs = [];
  for (const role of CODE_ROLES) outputs.push(await engine.execute(input(tool, cycle, role, round)));
  return outputs;
}
test('E5e pushing fake: scoping pushes a mock-up page under web/ on its branch; a role without code pushes nothing', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    const engine = new PushingEngine({ url: g.url, token: AGENT_PAT, ...FAST_GIT });
    const s = await engine.execute(input('fleet', 2, 'scoping'));
    assert.deepEqual((s.report as { files_changed: string[] }).files_changed, ['web/mockup-t2-1-scoping.html']);
    assert.ok(g.files('fleet', 'agent/fleet/2/scoping')!.includes('web/mockup-t2-1-scoping.html'));
    await engine.execute(input('fleet', 2, 'overlap'));
    assert.equal(g.files('fleet', 'agent/fleet/2/overlap'), null);
  });
});
const content = (g: FakeGitea, slug: string, file: string) => git(g.bare(slug), ['show', `refs/heads/main:${file}`]);

test('E3 forge: normal case — the roles push (svc-agent), integration by svc-orchestrator, squash: the files are in main; replayed without effect; 2nd round without conflict', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    const outputs = await rolesPush(g, 'fleet', 3);
    const expected = [['tests/acceptance/trial-t3-1-tests.test.js'], ['api/lib/trial-t3-1-builder.js', 'web/trial-t3-1-builder.js']];
    assert.deepEqual(outputs.map((s) => (s.report as { files_changed: string[] }).files_changed), expected);
    assert.ok(outputs.every((s) => /^[0-9a-f]{64}$/.test(s.tree_hash ?? '') && (s.report as { status: string }).status === 'done'));
    assert.ok(!g.files('fleet')!.includes(expected[0]![0]!), 'nothing in main before the merge');

    assert.deepEqual(await forge.integrate('fleet', 3, 1), { result: 'ok' });
    assert.deepEqual(await forge.merge('fleet', 3, 1), { result: 'ok' });
    assert.ok(expected.flat().every((f) => g.files('fleet')!.includes(f)), 'the files of both roles are in main');
    assert.equal(g.prs[0]!.merged_by, 'svc-orchestrator');
    assert.deepEqual(g.pushes('fleet'), ['svc-agent agent/fleet/3/tests', 'svc-agent agent/fleet/3/builder', 'svc-orchestrator integration/3/1']);

    // Replayed (resume after a hard stop): same results, nothing more.
    const head = g.head('fleet');
    assert.deepEqual(await forge.integrate('fleet', 3, 1), { result: 'ok' });
    assert.deepEqual(await forge.merge('fleet', 3, 1), { result: 'ok' });
    assert.equal(g.head('fleet'), head);
    assert.equal(g.pushes('fleet').length, 3, 'no new push');

    // Round 2 after the squash: new pushes to the same branches, integration without conflict, 2nd squash.
    await rolesPush(g, 'fleet', 3, 2);
    assert.deepEqual(await forge.integrate('fleet', 3, 2), { result: 'ok' });
    assert.deepEqual(await forge.merge('fleet', 3, 2), { result: 'ok' });
    assert.ok(g.files('fleet')!.includes('api/lib/trial-t3-2-builder.js'));
  });
});

test('E3 forge: out of scope — the builder writes into tests/acceptance/: nothing in main; a rollback pushed after the integration hides nothing', async () => {
  await withFake(async (g, forge) => {
    const slug = 'fleet-out-of-scope';
    await forge.createRepo(slug);
    await rolesPush(g, slug, 2);
    const before = g.head(slug);
    assert.deepEqual(await forge.integrate(slug, 2, 1), { result: 'ok' });
    const expected = { result: 'out_of_scope', files: [{ file: 'tests/acceptance/stolen-t2-1-builder.js', role: 'builder' }] };
    assert.deepEqual(await forge.merge(slug, 2, 1), expected);
    g.commits(slug, `agent/${slug}/2/builder`, { 'tests/acceptance/stolen-t2-1-builder.js': null });
    assert.deepEqual(await forge.merge(slug, 2, 1), expected, 'the integrated content prevails, not the role\'s current branch');
    assert.equal(g.head(slug), before, 'main unchanged');
    assert.equal(g.prs.length, 0);
  });
});

test('E7 publication: the validated scoping then the contract enter main (merge by svc-orchestrator, [skip ci]); chained bases for contract, tests and builder; idempotent; scope checked; the round\'s merge still strict', async () => {
  await withFake(async (g, forge) => {
    const slug = 'chain';
    await forge.createRepo(slug);
    const scoping = { 'docs/spec.md': '# spec\n', 'docs/DECISIONS.md': 'decisions\n', 'web/mockup.html': '<p>mock-up</p>\n' };
    g.commits(slug, `agent/${slug}/7/scoping`, scoping);
    const before = g.head(slug);
    // Role that pushed nothing: nothing changes.
    await forge.publish(slug, 7, 'contract');
    assert.equal(g.head(slug), before);
    await forge.publish(slug, 7, 'scoping');
    assert.ok(Object.keys(scoping).every((f) => g.files(slug)!.includes(f)), 'the scoping is in main');
    assert.deepEqual(g.pushes(slug), [`svc-agent agent/${slug}/7/scoping`, 'svc-orchestrator main']);
    assert.match(git(g.bare(slug), ['log', '-1', '--format=%s %P', 'refs/heads/main']).trim(), /^Publish scoping \(cycle 7\) \[skip ci\] [0-9a-f]{40} [0-9a-f]{40}$/, 'merge commit, never a squash');
    // Replayed: already in main, no new push.
    const afterScoping = g.head(slug);
    await forge.publish(slug, 7, 'scoping');
    assert.equal(g.head(slug), afterScoping);
    assert.equal(g.pushes(slug).length, 2);
    // The contract starts from main (its base: no branch yet), hence from the scoping; published in turn.
    const contract = { 'openapi.yaml': 'openapi: 3.1.0\n', 'tests/acceptance/features/list.feature': 'Feature: list\n' };
    g.commits(slug, `agent/${slug}/7/contract`, contract);
    assert.ok(Object.keys(scoping).every((f) => g.files(slug, `agent/${slug}/7/contract`)!.includes(f)), 'the contract\'s base holds the scoping');
    await forge.publish(slug, 7, 'contract');
    assert.ok([...Object.keys(scoping), ...Object.keys(contract)].every((f) => g.files(slug)!.includes(f)), 'scoping and contract in main');
    // Out of scope: a contract that writes code does not get into main.
    g.commits(slug, `agent/${slug}/8/contract`, { 'openapi.yaml': 'x\n', 'api/stolen.js': 'x\n' });
    await refusal(forge.publish(slug, 8, 'contract'), /outside the scope of role contract: api\/stolen\.js$/, false);
    assert.equal(g.pushes(slug).filter((p) => p.endsWith(' main')).length, 2, 'nothing more in main');
    // Tests and builder start from main (scoping + contract); the merge's diff check only attributes their own files to them.
    const outputs = await rolesPush(g, slug, 7);
    assert.ok(outputs.every((s) => (s.report as { status: string }).status === 'done'));
    assert.ok(g.files(slug, `agent/${slug}/7/builder`)!.includes('openapi.yaml'), 'the builder\'s base holds the contract');
    assert.deepEqual(await forge.integrate(slug, 7, 1), { result: 'ok' });
    assert.deepEqual(await forge.merge(slug, 7, 1), { result: 'ok' });
    assert.ok([...Object.keys(scoping), ...Object.keys(contract), 'api/lib/trial-t7-1-builder.js', 'tests/acceptance/trial-t7-1-tests.test.js'].every((f) => g.files(slug)!.includes(f)), 'main holds everything');
    // Just as strict: the builder touching the specification (outside its scope) is refused at the merge.
    g.commits(slug, `agent/${slug}/7/builder`, { 'docs/spec.md': '# rewritten\n' });
    assert.deepEqual(await forge.integrate(slug, 7, 2), { result: 'ok' });
    assert.deepEqual(await forge.merge(slug, 7, 2), { result: 'out_of_scope', files: [{ file: 'docs/spec.md', role: 'builder' }] });
    // Gate 1 `scope_change` (scope change): the contract goes back onto its branch after the round's squash; its
    // publication merges without conflict.
    g.commits(slug, `agent/${slug}/7/contract`, { 'openapi.yaml': 'openapi: 3.1.0\n# v2\n' });
    await forge.publish(slug, 7, 'contract');
    assert.equal(content(g, slug, 'openapi.yaml'), 'openapi: 3.1.0\n# v2\n');
    assert.ok(g.files(slug)!.includes('api/lib/trial-t7-1-builder.js'), 'the round\'s code stays in main');
    // A conflict with main (never normal) is a named permanent error, nothing is pushed.
    g.commitsMain(slug, { 'openapi.yaml': 'openapi: 3.1.0\n# main\n' });
    g.commits(slug, `agent/${slug}/7/contract`, { 'openapi.yaml': 'openapi: 3.1.0\n# v3\n' });
    const head = g.head(slug);
    await refusal(forge.publish(slug, 7, 'contract'), /merging agent\/chain\/7\/contract into main impossible: conflict on openapi\.yaml/, false);
    assert.equal(g.head(slug), head);
  });
});

test('Decision A publishCore: the core update enters main as one commit of svc-orchestrator ([skip ci]), only package.json and pnpm-lock.yaml; replayed without effect; version refused', async () => {
  await withFake(async (g, forge) => {
    const slug = 'core-update';
    await forge.createRepo(slug);
    g.commitsMain(slug, { 'package.json': '{"dependencies":{"@eupadev/core":"0.1.1"}}\n', 'pnpm-lock.yaml': "  '@eupadev/core@0.1.1':\n", 'api/index.js': 'x\n' });
    const before = g.head(slug);
    const pushed = g.pushes(slug).length;
    const update = { from: '0.1.1', to: '0.1.2', package_json: '{"dependencies":{"@eupadev/core":"0.1.2"}}\n', lockfile: "  '@eupadev/core@0.1.2':\n" };
    await forge.publishCore(slug, 43, update);
    assert.equal(content(g, slug, 'package.json'), update.package_json);
    assert.equal(content(g, slug, 'pnpm-lock.yaml'), update.lockfile);
    assert.equal(content(g, slug, 'api/index.js'), 'x\n', 'the rest of main is intact');
    assert.match(git(g.bare(slug), ['log', '-1', '--format=%s %P', 'refs/heads/main']).trim(), /^Core @eupadev\/core 0\.1\.2 \(cycle 43\) \[skip ci\] [0-9a-f]{40}$/, 'a single commit on main');
    assert.equal(git(g.bare(slug), ['diff', '--name-only', before, 'refs/heads/main']).trim(), 'package.json\npnpm-lock.yaml');
    assert.deepEqual(g.pushes(slug).slice(pushed), ['svc-orchestrator main']);
    // Replayed (the push went through, the step was not recorded): nothing to commit, nothing pushed.
    const after = g.head(slug);
    await forge.publishCore(slug, 43, update);
    assert.equal(g.head(slug), after);
    assert.equal(g.pushes(slug).length, pushed + 1);
    await refusal(forge.publishCore(slug, 43, { ...update, to: '../x' }), /core version refused/, false);
  });
});

test('E3 forge: conflict — role branches in conflict with main: conflict named, nothing pushed, main unchanged; merge refused without integration', async () => {
  await withFake(async (g, forge) => {
    const slug = 'fleet-conflict';
    await forge.createRepo(slug);
    await rolesPush(g, slug, 1);
    // ADR-021: the real risk is the conflict between a role branch and main (squash of another round, after the base of the
    // branches): main receives web/common.js, which the builder creates too (`conflict` set). The tests branch is put in
    // conflict as well, by hand: without a conflict on the first role, the abort of its merge could not be observed.
    g.commits(slug, `agent/${slug}/1/tests`, { 'web/common.js': '// tests\n' });
    g.commitsMain(slug, { 'web/common.js': '// main\n' });
    const before = g.head(slug);
    // Both roles conflict with main; the merge of the first (tests) is aborted before trying the second (builder); nothing
    // is pushed.
    for (let i = 0; i < 2; i++) assert.deepEqual(await forge.integrate(slug, 1, 1), { result: 'conflict', files: ['web/common.js'] });
    assert.equal(g.files(slug, 'integration/1/1'), null, 'no integration branch pushed');
    await refusal(forge.merge(slug, 1, 1), /integration\/1\/1 missing: integrate before merging/, false);
    assert.equal(g.head(slug), before);
  });
});

test('E3 forge: faulty set — the eval() is integrated and merged into main (the CI will refuse it, E4)', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet-faulty');
    await rolesPush(g, 'fleet-faulty', 1);
    assert.deepEqual(await forge.integrate('fleet-faulty', 1, 1), { result: 'ok' });
    assert.deepEqual(await forge.merge('fleet-faulty', 1, 1), { result: 'ok' });
    assert.match(content(g, 'fleet-faulty', 'api/lib/trial-t1-1-builder.js'), /^eval\(process\.argv\[2\]\);$/m);
  });
});

test('E3 real trial: the playbook\'s script runs creation, pushes, integration, merge and resume (JSON output, no token shown)', async () => {
  await withFake(async (g) => {
    const dir = mkdtempSync(join(tmpdir(), 'trial-e3-'));
    writeFileSync(join(dir, 'orch'), `${ORCHESTRATOR_PAT}\n`);
    writeFileSync(join(dir, 'agent'), `${AGENT_PAT}\n`);
    const launch = (slug: string) => new Promise<{ code: number | null; output: string; errors: string }>((resolve) => {
      const p = spawn(process.execPath, ['scripts/trial-integration.ts', slug, '1'], { env: { ...process.env, FORGE_URL: g.url, FORGE_TOKEN_FILE: join(dir, 'orch'), AGENT_TOKEN_FILE: join(dir, 'agent') } });
      let output = '';
      let errors = '';
      p.stdout.on('data', (c) => (output += c));
      p.stderr.on('data', (c) => (errors += c));
      p.on('close', (code) => resolve({ code, output: output, errors: errors }));
    });
    try {
      const normal = await launch('trial-e3');
      assert.equal(normal.code, 0, normal.errors);
      assert.ok(![ORCHESTRATOR_PAT, AGENT_PAT].some((j) => normal.output.includes(j) || normal.errors.includes(j)));
      const r = JSON.parse(normal.output);
      assert.deepEqual([r.set, r.integration, r.merge, r.resume], ['normal', { result: 'ok' }, { result: 'ok' }, { integration: { result: 'ok' }, merge: { result: 'ok' } }]);
      assert.ok(g.files('trial-e3')!.includes('api/lib/trial-e3-1-builder.js'));
      const conflict = JSON.parse((await launch('trial-e3-conflict')).output);
      assert.deepEqual([conflict.integration, conflict.merge], [{ result: 'conflict', files: ['web/common.js'] }, null]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('E3 pushing fake: never outside an agent branch of the tool; svc-agent sees only its team\'s tools; roles without code push nothing', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    const engine = new PushingEngine({ url: g.url, token: AGENT_PAT, ...FAST_GIT });
    await refusal(engine.execute({ ...input('fleet', 1, 'builder'), branch: 'integration/1/1' }), /branch integration\/1\/1 refused: not an agent branch of fleet/, false);
    await refusal(engine.execute({ ...input('fleet', 1, 'builder'), branch: 'agent/other/1/builder' }), /refused: not an agent branch of fleet/, false);
    await forge.createRepo('cache');
    g.repos.get('cache')!.team = false;
    await refusal(engine.execute(input('cache', 1, 'builder')), /git clone: failed/, false);
    const review = await engine.execute(input('fleet', 1, 'security-reviewer'));
    assert.deepEqual([review.tree_hash, (review.report as { status: string }).status], [null, 'done']);
    assert.deepEqual(g.pushes('fleet'), [], 'no push');
    assert.throws(() => new PushingEngine({ url: 'http://git.example.fr', token: AGENT_PAT }), /https required/);
  });
});

// ── E4: CI watcher (runs, jobs, registry) ──────────────────────────────────────────────────────────────────────────────

const GREEN = ['secrets', 'tests', 'analysis', 'guard-rails', 'image'].map((name) => ({ name, conclusion: 'success' }));
const DIGEST = `sha256:${'a1'.repeat(32)}`;
/** A tool created, the roles pushed, integrated and merged (round 1): returns the squash commit. */
async function merged(g: FakeGitea, forge: GiteaForge, slug: string, cycle: number): Promise<string> {
  await forge.createRepo(slug);
  await rolesPush(g, slug, cycle);
  await forge.integrate(slug, cycle, 1);
  assert.deepEqual(await forge.merge(slug, cycle, 1), { result: 'ok' });
  return g.prs.at(-1)!.merge_commit_sha!;
}

test('E4 watcher: CI of the squash running → null; finished green → digest read from the registry; another commit is ignored; replayed → same result', async () => {
  await withFake(async (g, forge) => {
    const commit = await merged(g, forge, 'fleet', 3);
    assert.equal(commit, g.head('fleet'));
    assert.equal(await forge.ciFinished('fleet', 3, 1), null, 'no run yet');
    // A more recent run on another commit of main (next squash, human exception) does not count.
    g.runs.push({ id: 1, slug: 'fleet', head_sha: commit, status: 'in_progress', jobs: [] });
    g.runs.push({ id: 9, slug: 'fleet', head_sha: 'f'.repeat(40), status: 'completed', conclusion: 'failure', jobs: [{ name: 'tests', conclusion: 'failure' }] });
    assert.equal(await forge.ciFinished('fleet', 3, 1), null, 'CI of the squash not finished');
    Object.assign(g.runs[0]!, { status: 'completed', conclusion: 'success', jobs: GREEN });
    g.images.set(`fleet:${commit}`, DIGEST);
    g.images.set(`fleet:${'f'.repeat(40)}`, `sha256:${'0'.repeat(64)}`);
    const expected = { outcome: 'green', digest: DIGEST, checks: GREEN.map((j) => ({ check: j.name, result: 'green' })) };
    assert.deepEqual(await forge.ciFinished('fleet', 3, 1), expected);
    assert.deepEqual(await forge.ciFinished('fleet', 3, 1), expected, 'replayed: same result');
    // The registry is read with the registry token; never the commit statuses.
    assert.ok(g.log.some((j) => j.path === `/v2/eupadev/fleet/manifests/${commit}` && j.auth === 'Bearer fake-registry-token'));
    assert.equal(g.calls(/statuses|\/status$/), 0);
  });
});

test('E4 watcher: red CI → red jobs as checks, skipped job left out, no digest asked; the last attempt counts', async () => {
  await withFake(async (g, forge) => {
    const commit = await merged(g, forge, 'fleet-faulty', 1);
    g.runs.push({ id: 4, slug: 'fleet-faulty', head_sha: commit, status: 'completed', conclusion: 'success', jobs: GREEN });
    // Re-run by a human: more recent run on the same commit, red (Opengrep refuses the eval()).
    g.runs.push({ id: 7, slug: 'fleet-faulty', head_sha: commit, status: 'completed', conclusion: 'failure', jobs: [
      { name: 'secrets', conclusion: 'success' }, { name: 'analysis', conclusion: 'failure' }, { name: 'tests', conclusion: 'cancelled' }, { name: 'image', conclusion: 'skipped' }] });
    assert.deepEqual(await forge.ciFinished('fleet-faulty', 1, 1), { outcome: 'red', checks: [
      { check: 'secrets', result: 'green' }, { check: 'analysis', result: 'red' }, { check: 'tests', result: 'red' }] });
    assert.equal(g.calls(/^GET \/v2\//), 0, 'registry never asked for a red CI');
    // Failed run without any red job (all skipped): the pipeline itself is red.
    g.runs.push({ id: 8, slug: 'fleet-faulty', head_sha: commit, status: 'completed', conclusion: 'failure', jobs: [{ name: 'image', conclusion: 'skipped' }] });
    assert.deepEqual(await forge.ciFinished('fleet-faulty', 1, 1), { outcome: 'red', checks: [{ check: 'pipeline', result: 'red' }] });
  });
});

test('E4 watcher: refusals — PR missing or not merged, token without the read:package scope (never the token in the error); image missing from the registry: green CI WITHOUT a digest', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    await rolesPush(g, 'fleet', 2);
    await forge.integrate('fleet', 2, 1);
    await refusal(forge.ciFinished('fleet', 2, 1), /refusal 404/, false);
    g.notReady = 10;
    await refusal(forge.merge('fleet', 2, 1), /still not mergeable/, true);
    await refusal(forge.ciFinished('fleet', 2, 1), /PR integration\/2\/1 not merged into main/, false);
    g.notReady = 0;
    assert.deepEqual(await forge.merge('fleet', 2, 1), { result: 'ok' });
    const commit = g.prs.at(-1)!.merge_commit_sha!;
    g.runs.push({ id: 1, slug: 'fleet', head_sha: commit, status: 'completed', conclusion: 'success', jobs: GREEN });
    assert.deepEqual(await forge.ciFinished('fleet', 2, 1), { outcome: 'green', checks: GREEN.map((j) => ({ check: j.name, result: 'green' })) }, 'image missing: no digest');
    g.images.set(`fleet:${commit}`, DIGEST);
    g.packageScope = false;
    await refusal(forge.ciFinished('fleet', 2, 1), /GET \/v2\/token: refusal 401/, false);
    g.packageScope = true;
    assert.equal((await forge.ciFinished('fleet', 2, 1))?.digest, DIGEST);
  });
});

test('E4 real trial: the playbook\'s script reads the CI of the squash and reads it again (JSON output, no token shown)', async () => {
  await withFake(async (g, forge) => {
    const commit = await merged(g, forge, 'trial-e4', 1);
    g.runs.push({ id: 1, slug: 'trial-e4', head_sha: commit, status: 'completed', conclusion: 'success', jobs: GREEN });
    g.images.set(`trial-e4:${commit}`, DIGEST);
    const dir = mkdtempSync(join(tmpdir(), 'trial-e4-'));
    writeFileSync(join(dir, 'orch'), `${ORCHESTRATOR_PAT}\n`);
    try {
      // Asynchronous: the fake Gitea runs in this process (code ≠ 0 → rejection).
      const p = await promisify(execFile)(process.execPath, ['scripts/trial-ci.ts', 'trial-e4', '1', '60'], { env: { ...process.env, FORGE_URL: g.url, FORGE_TOKEN_FILE: join(dir, 'orch') } });
      assert.ok(!(p.stdout + p.stderr).includes(ORCHESTRATOR_PAT));
      const r = JSON.parse(p.stdout);
      assert.deepEqual([r.ci.outcome, r.ci.digest, r.resume], ['green', DIGEST, r.ci]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── E5f: Preview pipeline started by the engine ────────────────────────────────────────────────────────────────────────

test('E5f Preview pipeline: started on main with the URL (id from before returned); read at the first run above: missing or running → null, finished → checks', async () => {
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    g.runsPreview.push({ id: 5, slug: 'fleet', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', jobs: [{ name: 'perf', conclusion: 'failure' }] });
    assert.equal(await forge.launchPreviewPipeline('fleet', 'https://fleet.preview.example.test'), 5);
    const launch = g.log.find((j) => j.method === 'POST' && j.path.endsWith('/preview-check.yml/dispatches'));
    assert.deepEqual(launch?.body, { ref: 'main', inputs: { url: 'https://fleet.preview.example.test' } });
    assert.equal(await forge.previewPipelineFinished('fleet', 5), null, 'no run above: the old red one does not count');
    g.runsPreview.push({ id: 6, slug: 'fleet', head_sha: 'a'.repeat(40), status: 'in_progress', jobs: [] });
    g.runsPreview.push({ id: 7, slug: 'fleet', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success', jobs: [{ name: 'perf', conclusion: 'success' }] });
    assert.equal(await forge.previewPipelineFinished('fleet', 5), null, 'the first one above still runs');
    Object.assign(g.runsPreview[1]!, { status: 'completed', conclusion: 'success', jobs: [{ name: 'perf', conclusion: 'success' }, { name: 'pentest-dast', conclusion: 'failure' }, { name: 'x', conclusion: 'skipped' }] });
    assert.deepEqual(await forge.previewPipelineFinished('fleet', 5), { outcome: 'red', checks: [{ check: 'perf', result: 'green' }, { check: 'pentest-dast', result: 'red' }] });
    await assert.rejects(forge.launchPreviewPipeline('fleet', 'https://fleet.preview.example.test/$(id)'), /Preview URL refused/);
  });
});

// Shape of a Gitea job log (each line timestamped; the script's own text is in it too).
const LOG_ACCEPTANCE = [
  '2026-10-26T14:02:11.0000000Z   pnpm exec playwright test -c tests/acceptance/playwright.config.js --forbid-only --retries=1 --workers=1 --reporter=list',
  '2026-10-26T14:03:40.1000000Z   ✘  3 [chromium] › tests/acceptance/features/handle.feature.spec.js:12:7 › Handle › The manager closes a request (12.1s)',
  '2026-10-26T14:05:02.2000000Z   1) [chromium] › tests/acceptance/features/handle.feature.spec.js:12:7 › Handle › The manager closes a request ───────',
  '2026-10-26T14:05:02.2100000Z     Error: expect(received).toBe(expected) // Object.is equality',
  '2026-10-26T14:05:02.2200000Z     Retry #1 ───────────────────────────────────',
  '2026-10-26T14:05:02.3000000Z   2) [chromium] › tests/acceptance/security/xss.spec.js:5:3 › SEC-XSS: a title is shown as text ────',
  // Captured on the lab (the Preview pipeline verify playbook, injected fault, 2026-10-26): no project name, the failing step last.
  '2026-10-26T14:55:40.5174631Z   3) tests/acceptance/.features-gen/features/sign-in.feature.spec.js:6:3 › Signing in on the Preview › A user signs in and reads their roles › Then their roles are "user" ',
  '2026-10-26T14:05:03.0000000Z   2 failed',
  '2026-10-26T14:07:10.0000000Z ✔ SEC-AUTH GET /requests without a session → 401 (8.1ms)',
  '2026-10-26T14:07:11.0000000Z \x1b[31m✖ SEC-ROLE DELETE /requests/{id} as reader → 403, nothing written (15.3ms)\x1b[39m',
  '2026-10-26T14:07:12.0000000Z ✖ failing tests:',
  '2026-10-26T14:07:12.1000000Z ✖ SEC-ROLE DELETE /requests/{id} as reader → 403, nothing written (15.3ms)',
].join('\n');

test('3.7 red acceptance job: its failing tests (Playwright headers, SEC-*) read in the job log, as details; other jobs untouched; log gone → none', async () => {
  assert.deepEqual(acceptanceFailures(LOG_ACCEPTANCE), [
    '[chromium] › tests/acceptance/features/handle.feature.spec.js:12:7 › Handle › The manager closes a request',
    '[chromium] › tests/acceptance/security/xss.spec.js:5:3 › SEC-XSS: a title is shown as text',
    'tests/acceptance/.features-gen/features/sign-in.feature.spec.js:6:3 › Signing in on the Preview › A user signs in and reads their roles › Then their roles are "user"',
    'SEC-ROLE DELETE /requests/{id} as reader → 403, nothing written',
  ]);
  assert.equal(acceptanceFailures(Array.from({ length: 30 }, (_, i) => `  ${i + 1}) test ${i}`).join('\n')).length, 20);
  await withFake(async (g, forge) => {
    await forge.createRepo('fleet');
    g.runsPreview.push({ id: 8, slug: 'fleet', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', jobs: [
      { id: 81, name: 'perf', conclusion: 'failure' }, { id: 82, name: 'acceptance', conclusion: 'failure' }] });
    g.logs.set(81, '  1) not an acceptance job');
    g.logs.set(82, LOG_ACCEPTANCE);
    const r = await forge.previewPipelineFinished('fleet', 7);
    assert.deepEqual(r, { outcome: 'red', checks: [{ check: 'perf', result: 'red' },
      { check: 'acceptance', result: 'red', details: { failures: acceptanceFailures(LOG_ACCEPTANCE) } }] });
    g.logs.delete(82);
    assert.deepEqual((await forge.previewPipelineFinished('fleet', 7))?.checks[1], { check: 'acceptance', result: 'red', details: { failures: [] } });
  });
});

// Result line printed by the template's analysis job (check.yml), captured from Opengrep 1.30.0 on the template's rules.
const SARIF_RESULT = { fingerprints: { 'matchBasedId/v1': '8ef5fb06_0' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'web/app.js', uriBaseId: '%SRCROOT%' }, region: { endColumn: 28, endLine: 2, snippet: { text: 'document.body.innerHTML = t;' }, startColumn: 1, startLine: 2 } } }], message: { text: 'innerHTML/outerHTML/insertAdjacentHTML with a non-literal text: XSS risk.' }, properties: {}, ruleId: 'opengrep.innerhtml-variable-text' };
const LOG_ANALYSIS = [
  '2026-10-29T10:00:01.0000000Z             2┆ document.body.innerHTML = t;',
  // Shown by the scan from the agent's code: before the last marker, ignored.
  `2026-10-29T10:00:01.1000000Z ${SARIF_MARKER}`,
  '2026-10-29T10:00:01.2000000Z {"ruleId":"faked","fingerprints":{"matchBasedId/v1":"faked_0"}}',
  '2026-10-29T10:00:02.0000000Z   echo opengrep-sarif-results',
  `2026-10-29T10:00:03.0000000Z ${SARIF_MARKER}`,
  `2026-10-29T10:00:03.1000000Z ${JSON.stringify(SARIF_RESULT)}`,
  '2026-10-29T10:00:04.0000000Z Post job cleanup.',
].join('\n');

test('M5 red analysis job: the Opengrep SARIF results read in its log after the last marker, as details; no marker → no details', async () => {
  assert.deepEqual(opengrepSarif(LOG_ANALYSIS), { runs: [{ results: [SARIF_RESULT] }] });
  assert.deepEqual(opengrepDeviations(opengrepSarif(LOG_ANALYSIS)), [{ rule: 'ci:opengrep:8ef5fb06_0', file: 'web/app.js', source: 'orchestrator' }]);
  assert.equal(opengrepSarif('no marker\n{"ruleId":"r"}'), null);
  await withFake(async (g, forge) => {
    const commit = await merged(g, forge, 'fleet', 2);
    g.runs.push({ id: 3, slug: 'fleet', head_sha: commit, status: 'completed', conclusion: 'failure', jobs: [
      { id: 31, name: 'tests', conclusion: 'failure' }, { id: 32, name: SARIF_CHECK, conclusion: 'failure' }] });
    g.logs.set(31, LOG_ANALYSIS);
    g.logs.set(32, LOG_ANALYSIS);
    assert.deepEqual(await forge.ciFinished('fleet', 2, 1), { outcome: 'red', checks: [{ check: 'tests', result: 'red' },
      { check: SARIF_CHECK, result: 'red', details: { runs: [{ results: [SARIF_RESULT] }] } }] });
    g.logs.delete(32);
    assert.deepEqual((await forge.ciFinished('fleet', 2, 1))?.checks[1], { check: SARIF_CHECK, result: 'red' });
  });
});

