// Claude Code engine (E4) against the REAL local Docker and real Git repositories (forge = bare repositories in `file://`),
// with a FAKE `claude` (tests/helpers/fake-claude) that mimics the documented JSON output: no AI call. `runc` runtime here
// (gVisor is only on the agents VM); the rest of the hardening is the production one and is checked from the inside.
// Signature (ADR-013): REAL cosign (on the PATH, as in production) and a throwaway registry on localhost; the fake image is
// pushed there and signed with a throwaway key, a variant is pushed there without a signature.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { REVIEW_ROLES, type TaskInput, type Role, type TaskOutput } from '../src/external/contracts.ts';
import { ClaudeCodeEngine, schemaDraft07, type ClaudeEngineOptions } from '../src/external/claude-engine.ts';

const HERE = new URL('.', import.meta.url).pathname;
const SCHEMA = readFileSync(join(HERE, '..', '..', 'tool-template', 'agents', 'report.schema.json'), 'utf8');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'claude-engine-'));
const REGISTRY_IMAGE = 'registry:3@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8';
let image = '';
let unsigned = '';
let key = '';
let otherKey = '';
let registry = '';
let n = 0;

/** Pushes a local image to the throwaway registry and returns its reference by digest (`localhost:<port>/…@sha256:…`). */
function push(id: string, repo: string): string {
  const label = `localhost:${registry}/eupadev/${repo}:test`;
  docker('tag', id, label);
  docker('push', '-q', label);
  const ref = (JSON.parse(docker('image', 'inspect', '--format', '{{json .RepoDigests}}', label)) as string[]).find((d) => d.startsWith(`localhost:${registry}/eupadev/${repo}@`));
  assert.ok(ref !== undefined, `digest of ${label} not found`);
  return ref;
}

before(async () => {
  const build = (...a: string[]) => docker('build', '-q', ...a, join(HERE, 'helpers', 'fake-claude')).split('\n').pop()!;
  const cosign = (...a: string[]) => execFileSync('cosign', a, { cwd: root, env: { ...process.env, COSIGN_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const container = docker('run', '-d', '--rm', '--name', `fa-trial-registry-${process.pid}`, '-p', '127.0.0.1::5000', REGISTRY_IMAGE);
  registry = docker('port', container, '5000/tcp').split('\n')[0]!.split(':').pop()!;
  // The registry takes a moment to listen: pushing too early fails ("connection reset").
  for (let i = 0; ; i++) {
    if (await fetch(`http://127.0.0.1:${registry}/v2/`).then((r) => r.ok, () => false)) break;
    if (i >= 100) throw new Error('throwaway registry unreachable after 10 s');
    await sleep(100);
  }
  image = push(build('-t', 'eupadev-fake-claude:test'), 'agent');
  unsigned = push(build('--label', 'eupadev.trial=unsigned'), 'agent-unsigned');
  cosign('generate-key-pair', '--output-key-prefix', 'good');
  cosign('generate-key-pair', '--output-key-prefix', 'other');
  key = join(root, 'good.pub');
  otherKey = join(root, 'other.pub');
  // Like the forge's CI: without a transparency log or a timestamp authority.
  cosign('signing-config', 'create', '--out', 'signature.json');
  cosign('sign', '--yes', '--key', join(root, 'good.key'), '--signing-config', 'signature.json', image);
});
after(() => {
  docker('rm', '-f', '-v', `fa-trial-registry-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
});

/** Throwaway forge: `<dir>/eupadev/trial-tool.git` with a main (README, api/, web/). */
function forge(): { url: string; repo: string; git: (...a: string[]) => string; main: string } {
  const dir = join(root, `forge-${++n}`);
  const repo = join(dir, 'eupadev', 'trial-tool.git');
  const work = join(dir, 'work');
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=trial', '-c', 'user.email=trial@example.test', ...a], { cwd, encoding: 'utf8' }).trim();
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '--bare', '-b', 'main');
  mkdirSync(join(work, 'api'), { recursive: true });
  mkdirSync(join(work, 'web'));
  writeFileSync(join(work, 'README.md'), 'tool\n');
  writeFileSync(join(work, 'AGENTS.md'), '# charter (copy for humans)\n');
  writeFileSync(join(work, 'api', 'existing.js'), 'export {};\n');
  writeFileSync(join(work, 'web', 'index.html'), '<p>tool</p>\n');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'template');
  git(work, 'push', '-q', repo, 'main');
  // Integration branch of round 1 (what the reviewers review), still equal to main.
  git(repo, 'update-ref', 'refs/heads/integration/1/1', 'main');
  return { url: `file://${dir}`, repo: repo, git: (...a) => git(repo, ...a), main: git(repo, 'rev-parse', 'main') };
}
/** Pushes a commit (files → content) to `branch` of the throwaway forge, from a working clone. */
function pushTo(f: ReturnType<typeof forge>, branch: string, files: Record<string, string>): string {
  const work = join(root, `work-${++n}`);
  execFileSync('git', ['clone', '-q', '-b', branch, f.repo, work]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=trial', '-c', 'user.email=trial@example.test', ...a], { cwd: work, encoding: 'utf8' }).trim();
  g('add', '.');
  g('commit', '-q', '-m', `on ${branch}`);
  g('push', '-q', 'origin', branch);
  return f.git('rev-parse', branch);
}

function engine(url: string, o: Partial<ClaudeEngineOptions> = {}): ClaudeCodeEngine {
  return new ClaudeCodeEngine({ forgeUrl: url, token: 'token-svc-agent-test', image, publicKey: key, reportSchema: SCHEMA, runtime: 'runc', ...o });
}

function input(scenario: string, o: Partial<TaskInput> & { role?: Role } = {}): TaskInput {
  const role = o.role ?? 'builder';
  return {
    task_id: `trial-tool-${process.pid}-${role}-${++n}`, tool: 'trial-tool', role, instructions: `Instructions of the ${role} role: add api/ping.js.`,
    context: { scenario }, cap: { duration_min: 15, turns: 40, budget_usd: 3 }, model: 'claude-opus-5-5', effort: 'medium',
    branch: (REVIEW_ROLES as readonly Role[]).includes(role) ? 'integration/1/1' : `agent/trial-tool/1/${role}`, signal: new AbortController().signal, ...o,
  };
}

/** Nothing must be left behind a task: no container, no network, no volume. */
function leftovers(task: string): string {
  const f = ['--filter', `label=eupadev.task=${task}`, '-q'];
  return [docker('ps', '-a', ...f), docker('network', 'ls', ...f), docker('volume', 'ls', ...f)].join('').trim();
}
const branchExists = (f: ReturnType<typeof forge>, b: string) => f.git('for-each-ref', `refs/heads/${b}`) !== '';

test('E4 claude: successful task — documented options, hardened container, report, cost, tokens, commit pushed to the branch, tree', async () => {
  const f = forge();
  const e = input('success');
  const s = await engine(f.url).execute(e);
  assert.ok(s.report !== null, s.error);
  const fake = (s.report as { fake: { argv: string; state: string; instructions: string } }).fake;
  const argv = Buffer.from(fake.argv, 'base64').toString('utf8').split('\n').filter((l) => l !== '');
  assert.deepEqual(argv, [
    '--bare', '--restricted', '-p', argv[3]!, '--append-system-prompt-file', '/tmp/task/instructions.md', '--model', 'claude-opus-5-5', '--effort', 'medium',
    '--tools', 'Bash,Read,Edit', '--permission-mode', 'dontAsk', '--allowedTools', 'Read(//tmp/task/**)', 'Bash', 'Edit',
    '--add-dir', '/tmp/task', '--strict-mcp-config', '--max-turns', '40', '--max-budget-usd', '2.50',
    '--output-format', 'json', '--json-schema', `schema:${sha256(schemaDraft07(SCHEMA))}`, '--no-session-persistence',
  ]);
  assert.match(argv[3]!, /\/tmp\/task\/task\.md/);
  assert.ok(!argv.some((a) => /bypass|dangerously/i.test(a)), 'never bypassPermissions');
  assert.equal(fake.instructions, sha256(e.instructions), 'instructions passed on as they are');
  assert.match(fake.state, /^uid=10001 caps=0000000000000000 nnp=1 root_ro=yes internet=no key=fake-key-added-by-the-proxy base= https_proxy=\| http_proxy= no_proxy=\| cwd=\/home\/agent\/repo git=yes files=/);
  assert.equal(s.cost_usd, 0.42);
  assert.deepEqual(s.tokens, { input: 1160, output: 22 });
  assert.ok(Number.isInteger(s.duration_s) && s.duration_s >= 0);
  assert.equal(f.git('log', '--format=%s %an', `${f.main}..agent/trial-tool/1/builder`), 'ping agent-builder');
  assert.equal(f.git('rev-parse', 'agent/trial-tool/1/builder^'), f.main, 'the commit descends from main');
  assert.equal(s.tree_hash, sha256(`${f.git('ls-tree', 'agent/trial-tool/1/builder', '--', 'api', 'db', 'web', 'tests/unit')}\n`));
  assert.equal(f.git('rev-parse', 'main'), f.main, 'main untouched');
  assert.equal(leftovers(e.task_id), '');
});

test('E4 claude: replay — leftovers of a cut-off run removed, base = the task branch, fast-forward push, no duplicate', async () => {
  const f = forge();
  const e = input('success');
  await engine(f.url).execute(e);
  const first = f.git('rev-parse', e.branch);
  // Previous run cut off dead: its container, its network and its volume are still lying around.
  docker('network', 'create', '--internal', '--label', `eupadev.task=${e.task_id}`, `fa-net-${e.task_id}`);
  docker('volume', 'create', '--label', `eupadev.task=${e.task_id}`, `fa-ws-${e.task_id}`);
  docker('run', '-d', '--name', `fa-${e.task_id}`, '--label', `eupadev.task=${e.task_id}`, image, 'sleep', '300');
  const s = await engine(f.url).execute({ ...e, signal: new AbortController().signal });
  assert.ok(s.report !== null, s.error);
  assert.equal(f.git('rev-parse', `${e.branch}^`), first, 'the replay starts again from the branch already pushed');
  assert.equal(f.git('rev-list', '--count', `${f.main}..${e.branch}`), '2');
  assert.equal(leftovers(e.task_id), '');
});

test('E7 claude: base of a following round — the task branch receives main (scoping and contract published, squash of the round) through a merge commit of the launcher; only the agent\'s work is checked and pushed', async () => {
  const f = forge();
  const e = input('success');
  await engine(f.url).execute(e);
  const first = f.git('rev-parse', e.branch);
  // main moves on (publication of the scoping, of the contract, squash of a round) after the first task.
  const main = pushTo(f, 'main', { 'docs/spec.md': '# validated spec\n', 'openapi.yaml': 'openapi: 3.1.0\n' });
  const s = await engine(f.url).execute({ ...e, signal: new AbortController().signal });
  assert.ok(s.report !== null, s.error);
  const fake = (s.report as { fake: { state: string } }).fake;
  assert.match(fake.state, /files=[^ ]*docs,/, 'the agent sees the work published in main');
  assert.match(fake.state, /files=[^ ]*openapi\.yaml,/);
  // History: first commit of the agent ← merge of main by the launcher ← second commit of the agent; fast-forward push.
  assert.equal(f.git('log', '--format=%s %an', `${main}..${e.branch}`), `ping agent-builder\nMerge main into ${e.branch} launcher\nping agent-builder`);
  assert.deepEqual(f.git('rev-parse', `${e.branch}^^1`, `${e.branch}^^2`).split('\n'), [first, main], 'merge: branch then main');
  assert.equal(f.git('merge-base', '--is-ancestor', first, e.branch), '');
  assert.equal(f.git('rev-parse', 'main'), main, 'main untouched');
  assert.equal(leftovers(e.task_id), '');
});

test('ADR-021: the builder gets the tests role\'s acceptance suite read-only under /tmp/task/suite/, never in its clone; nothing without a tests branch', async () => {
  const f = forge();
  const m = engine(f.url);
  const state = (s: TaskOutput) => (s.report as { fake: { state: string; task: string } }).fake;
  // Before the tests role has pushed: no suite, task.md does not mention it.
  const without = await m.execute(input('success', { role: 'builder' }));
  assert.ok(without.report !== null, without.error);
  assert.match(state(without).state, / suite=$/);
  assert.doesNotMatch(Buffer.from(state(without).task, 'base64').toString('utf8'), /\/tmp\/task\/suite/);
  // The tests role pushes its suite to its branch (same cycle).
  const t = await m.execute(input('suite', { role: 'tests' }));
  assert.ok(t.report !== null, t.error);
  assert.equal(f.git('ls-tree', '--name-only', 'agent/trial-tool/1/tests', 'tests/acceptance/'), 'tests/acceptance/list.feature');
  // The builder (replay on its branch) sees it under /tmp/task/suite/, not in its repository; task.md tells it so.
  const withSuite = await m.execute(input('success', { role: 'builder' }));
  assert.ok(withSuite.report !== null, withSuite.error);
  assert.match(state(withSuite).state, / suite=\/tmp\/task\/suite\/tests\/acceptance\/list\.feature,$/);
  assert.doesNotMatch(state(withSuite).state, /files=[^ ]*tests/, 'the suite does not enter the clone');
  assert.match(Buffer.from(state(withSuite).task, 'base64').toString('utf8'), /\/tmp\/task\/suite\/tests\/acceptance\/ \(read-only/);
  assert.equal(f.git('ls-tree', '--name-only', 'agent/trial-tool/1/builder', 'tests/'), '', 'nothing of the suite pushed by the builder');
});

test('D3 (A-R6): contract, tests and builder get the reference tool read-only under /tmp/task/example/, reviewers do not', async () => {
  const f = forge();
  const m = engine(f.url, { example: new URL('../../examples/requests/', import.meta.url).pathname });
  const fake = (s: TaskOutput) => (s.report as { fake: { state: string; task: string } }).fake;
  for (const role of ['contract', 'builder'] as const) {
    const s = await m.execute(input('no_commit', { role }));
    assert.ok(s.report !== null, s.error);
    assert.match(fake(s).state, / example=README\.md,api,db,openapi\.yaml,tests,web, /, role);
    assert.match(Buffer.from(fake(s).task, 'base64').toString('utf8'), /\/tmp\/task\/example\/ \(read-only\)/, role);
  }
  const r = await m.execute(input('success', { role: 'security-reviewer' }));
  assert.doesNotMatch(fake(r).state, / example=/);
});

test('E4 claude: read-only role — read tools, dontAsk, reading the task allowed, nothing pushed, no tree digest', async () => {
  const f = forge();
  const e = input('success', { role: 'security-reviewer', effort: 'high' });
  const s = await engine(f.url).execute(e);
  const argv = Buffer.from((s.report as { fake: { argv: string } }).fake.argv, 'base64').toString('utf8');
  assert.match(argv, /^--bare\n--restricted\n-p\n/);
  // A-R4 (ADR-020): Bash exposed for searching, but never allowed: dontAsk reduces it to the read-only set.
  assert.match(argv, /--effort\nhigh\n--tools\nBash,Read\n--permission-mode\ndontAsk\n/);
  // dontAsk refuses any read outside the working directory: without this rule, the agent does not read its task (paid
  // trial of 2026-10-15).
  // Nothing else allowed (neither Bash, nor Edit, nor Write): the rule is followed by --add-dir.
  assert.match(argv, /--permission-mode\ndontAsk\n--allowedTools\nRead\(\/\/tmp\/task\/\*\*\)\n--add-dir\n\/tmp\/task\n--strict-mcp-config\n/);
  assert.ok(!/bypass|dangerously/i.test(argv));
  assert.equal(s.tree_hash, null);
  assert.equal(f.git('rev-parse', 'main'), f.main, 'main untouched');
  assert.equal(f.git('rev-parse', e.branch), f.main, 'nothing pushed to the integration branch');
});

test('ADR-020: a reviewer reviews the round\'s integration branch (the integrated code, absent from main), never main; missing branch = clear failure, no container', async () => {
  const f = forge();
  const head = pushTo(f, 'integration/1/1', { 'INTEGRATED.md': 'code of the round\n', 'api/tools.js': 'export {};\n' });
  const e = input('success', { role: 'quality-reviewer' });
  const s = await engine(f.url).execute(e);
  assert.ok(s.report !== null, s.error);
  const state = (s.report as { fake: { state: string } }).fake.state;
  assert.match(state, /files=[^ ]*INTEGRATED\.md,/, 'the reviewer sees the round\'s integrated code');
  assert.equal(f.git('rev-parse', 'integration/1/1'), head, 'integration branch untouched');
  assert.equal(f.git('rev-parse', 'main'), f.main, 'main untouched');
  assert.equal(leftovers(e.task_id), '');
  const missing = input('success', { role: 'security-reviewer', branch: 'integration/1/2' });
  await assert.rejects(engine(f.url).execute(missing), /integration branch integration\/1\/2 missing: nothing to review for security-reviewer/);
  assert.equal(leftovers(missing.task_id), '');
  await assert.rejects(engine(f.url).execute(input('success', { role: 'security-reviewer', branch: 'agent/trial-tool/1/security-reviewer' })), /branch refused for trial-tool\/security-reviewer/);
});

test('E4 claude: overlap without a repository — the forge has no repository yet, neither clone nor bundle, empty working directory, catalogue in task.md and never in the instructions, nothing pushed', async () => {
  // Forge WITHOUT the tool's repository (overlap runs before `repo_creation`): any clone would fail.
  const dir = join(root, `empty-forge-${++n}`);
  mkdirSync(join(dir, 'eupadev'), { recursive: true });
  const catalogue = [{ slug: 'car-fleet', name: 'Car fleet', owner_service: 'logistics', state: 'end_success', archived: false, description: 'Booking of the service vehicles' }];
  const e = input('no_commit', { role: 'overlap', context: { scenario: 'no_commit', tool_catalogue: catalogue }, instructions: 'Instructions of the overlap role: compare the request with the catalogue received as data.' });
  const s = await engine(`file://${dir}`).execute(e);
  assert.ok(s.report !== null, s.error);
  const fake = (s.report as { fake: { argv: string; state: string; instructions: string; task: string } }).fake;
  assert.match(fake.state, / cwd=\/home\/agent\/work git=no files= suite=$/, 'empty working directory, neither repository nor suite');
  const task = Buffer.from(fake.task, 'base64').toString('utf8');
  assert.match(task, /"tool_catalogue"/);
  assert.match(task, /Booking of the service vehicles/);
  assert.match(task, /You have no repository/);
  assert.equal(fake.instructions, sha256(e.instructions), 'instructions as they are, without the catalogue');
  assert.ok(!e.instructions.includes('car-fleet'));
  assert.match(Buffer.from(fake.argv, 'base64').toString('utf8'), /--tools\nRead\n/);
  assert.equal(s.tree_hash, null);
  assert.equal(s.cost_usd, 0.42);
  assert.equal(leftovers(e.task_id), '');
});

test('E4 claude: Claude Code capped (turns, budget) — its commits are checked and pushed to the task branch, the task still fails, the next attempt starts from them; refused content stays unpushed', async () => {
  for (const [scenario, error] of [['max_turns', /turns cap reached \(error_max_turns.*; its commits are kept on agent\/trial-tool\/1\/builder$/], ['budget', /budget cap reached \(error_max_budget_usd.*; its commits are kept on agent\/trial-tool\/1\/builder$/]] as const) {
    const f = forge();
    const m = engine(f.url);
    const e = input(scenario);
    const s = await m.execute(e);
    assert.equal(s.report, null, scenario);
    assert.match(s.error ?? '', error, `${scenario}: ${s.error}`);
    assert.equal(s.cost_usd, 0.42, scenario);
    assert.equal(s.tree_hash, null, scenario);
    assert.equal(f.git('log', '-1', '--format=%s', e.branch), 'unfinished', `${scenario}: pushed`);
    assert.equal(leftovers(e.task_id), '', scenario);
    // The next attempt starts from the branch: the finished work sits on top of the unfinished commit, fast-forward.
    assert.ok((await m.execute(input('success'))).report !== null, scenario);
    assert.deepEqual(f.git('log', '--format=%s', e.branch).split('\n'), ['ping', 'unfinished', 'template'], scenario);
  }
  // Capped with content outside the role's scope: nothing pushed, the cap and the refusal both reported.
  const f = forge();
  const e = input('budget_out_of_scope');
  const s = await engine(f.url).execute(e);
  assert.equal(s.report, null);
  assert.match(s.error ?? '', /budget cap reached \(error_max_budget_usd.*; agent's work refused: outside the scope of role builder "tests\/acceptance\/attacker\.js"/, s.error);
  assert.equal(branchExists(f, e.branch), false, 'nothing pushed');
  assert.equal(leftovers(e.task_id), '');
});

test('E4 claude: Claude Code stops (unreadable output, no report) — reason read, cost kept or unknown, nothing pushed', async () => {
  const f = forge();
  const m = engine(f.url);
  const cases: [string, RegExp, number | null][] = [
    ['unreadable', /unreadable Claude Code output.*; errors: error: reason of the refusal at startup/, null],
    ['no_report', /without a structured report/, 0.42],
  ];
  for (const [scenario, error, cost] of cases) {
    const e = input(scenario);
    const s = await m.execute(e);
    assert.equal(s.report, null, scenario);
    assert.match(s.error ?? '', error, scenario);
    assert.equal(s.cost_usd, cost, scenario);
    assert.equal(branchExists(f, e.branch), false, `${scenario}: nothing pushed`);
    assert.equal(leftovers(e.task_id), '', scenario);
  }
});

test('E4 claude: work refused — rewritten history, merge commit, tree containing .git: nothing pushed', async () => {
  const f = forge();
  const m = engine(f.url);
  for (const [scenario, reason] of [['rewritten', /do not descend from the task base/], ['merge', /merge commit/], ['git_tree', /refused: git (fetching the work|checking the objects).*hasDotgit/]] as const) {
    const e = input(scenario);
    const s = await m.execute(e);
    assert.equal(s.report, null, scenario);
    assert.match(s.error ?? '', reason, scenario);
    assert.equal(s.cost_usd, 0.42, scenario);
    assert.equal(branchExists(f, e.branch), false, scenario);
  }
});

test('E4 claude: content refused before the push — forbidden path (Claude Code settings, .npmrc, deletion of AGENTS.md), out of scope, symbolic link, submodule, invisible name: nothing pushed', async () => {
  const f = forge();
  const m = engine(f.url);
  const cases: [string, Role, RegExp][] = [
    ['writes_claude_settings', 'builder', /refused: forbidden path "\.claude\/settings\.json"/],
    ['writes_npmrc', 'scoping', /refused: forbidden path "\.npmrc"/],
    ['deletes_protected', 'scoping', /refused: forbidden path "AGENTS\.md"/],
    ['out_of_scope', 'builder', /refused: outside the scope of role builder "tests\/acceptance\/attacker\.js"/],
    ['symbolic_link', 'builder', /refused: symbolic link "api\/link"/],
    ['submodule', 'scoping', /refused: submodule "vendor\/x"/],
    ['invisible_path', 'builder', /refused: file name with an invisible or control character "api\/a.b\.js" \(U\+200B/],
  ];
  for (const [scenario, role, reason] of cases) {
    const e = input(scenario, { role });
    const s = await m.execute(e);
    assert.equal(s.report, null, scenario);
    assert.match(s.error ?? '', reason, `${scenario}: ${s.error}`);
    assert.equal(s.cost_usd, 0.42, scenario);
    assert.equal(branchExists(f, e.branch), false, `${scenario}: nothing pushed`);
    assert.equal(leftovers(e.task_id), '', scenario);
  }
  // The same role, within its scope: accepted (the check does not block normal work).
  const e = input('success', { role: 'builder' });
  assert.ok((await m.execute(e)).report !== null);
  assert.equal(branchExists(f, e.branch), true);
});

test('E4 claude: cancellation in the middle of a task — no container left within 15 s, cleanup done', async () => {
  const f = forge();
  const check = new AbortController();
  const e = input('sleep', { signal: check.signal });
  const execution = engine(f.url).execute(e);
  const expired = execution.then(() => 'returned', (err: unknown) => `rejected: ${String(err)}`);
  for (let i = 0; i < 200 && docker('ps', '-q', '--filter', `name=^fa-${e.task_id}$`) === ''; i++) await sleep(100);
  assert.notEqual(docker('ps', '-q', '--filter', `name=^fa-${e.task_id}$`), '', 'the container started');
  const t0 = Date.now();
  check.abort('cycle cancellation');
  assert.equal(await expired, 'rejected: cycle cancellation');
  assert.equal(docker('ps', '-a', '-q', '--filter', `name=^fa-${e.task_id}$`), '');
  assert.ok(Date.now() - t0 < 15_000, `stopped in ${Date.now() - t0} ms`);
  assert.equal(leftovers(e.task_id), '');
});

test('E4 claude: proxies plugged into the task\'s internal network during the task, unplugged afterwards (the proxy goes on)', async () => {
  const f = forge();
  const proxy = `fa-trial-proxy-${process.pid}-${++n}`;
  docker('run', '-d', '--rm', '--name', proxy, image, 'sleep', '300');
  try {
    const check = new AbortController();
    const e = input('sleep', { signal: check.signal });
    const expired = engine(f.url, { proxies: [proxy] }).execute(e).catch(() => 'rejected');
    for (let i = 0; i < 200 && docker('ps', '-q', '--filter', `name=^fa-${e.task_id}$`) === ''; i++) await sleep(100);
    assert.match(docker('network', 'inspect', '--format', '{{range .Containers}}{{.Name}} {{end}}', `fa-net-${e.task_id}`), new RegExp(`\\b${proxy}\\b`));
    assert.equal(docker('network', 'inspect', '--format', '{{.Internal}} {{index .Options "com.docker.network.bridge.inhibit_ipv4"}}', `fa-net-${e.task_id}`), 'true true');
    check.abort('end');
    assert.equal(await expired, 'rejected');
    assert.equal(leftovers(e.task_id), '');
    assert.notEqual(docker('ps', '-q', '--filter', `name=^${proxy}$`), '', 'the proxy still runs');
  } finally {
    docker('rm', '-f', '-v', proxy);
  }
});

test('E4 claude: AI proxy named by its IP on the task network (no name resolution under gVisor), plugged even outside AGENT_PROXIES', async () => {
  const f = forge();
  const proxy = `fa-trial-ai-${process.pid}-${++n}`;
  docker('run', '-d', '--rm', '--name', proxy, image, 'sleep', '300');
  try {
    const e = input('success');
    const s = await engine(f.url, { aiProxy: `${proxy}:8080` }).execute(e);
    assert.ok(s.report !== null, s.error);
    const state = (s.report as { fake: { state: string } }).fake.state;
    assert.match(state, / base=http:\/\/\d{1,3}(\.\d{1,3}){3}:8080 https_proxy=\| http_proxy= no_proxy=\| cwd=/, 'without an egress proxy: no proxy variable');
    assert.equal(leftovers(e.task_id), '');
  } finally {
    docker('rm', '-f', '-v', proxy);
  }
  assert.throws(() => engine(f.url, { aiProxy: 'http://proxy:8080' }), /container:port/);
  await assert.rejects(engine(f.url, { aiProxy: 'fa-trial-missing:8080' }).execute(input('success')), /proxy fa-trial-missing/);
});

test('E4 claude: egress proxy named by its IP (HTTPS_PROXY), NO_PROXY = AI proxy and loopback, no HTTP_PROXY', async () => {
  const f = forge();
  const ai = `fa-trial-ai-${process.pid}-${++n}`;
  const output = `fa-trial-egress-${process.pid}-${++n}`;
  docker('run', '-d', '--rm', '--name', ai, image, 'sleep', '300');
  docker('run', '-d', '--rm', '--name', output, image, 'sleep', '300');
  try {
    const e = input('success');
    const s = await engine(f.url, { aiProxy: `${ai}:8080`, egressProxy: `${output}:4750` }).execute(e);
    assert.ok(s.report !== null, s.error);
    const state = (s.report as { fake: { state: string } }).fake.state;
    const m = / base=http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):8080 https_proxy=(\S*)\|(\S*) http_proxy=(\S*) no_proxy=(\S*)\|(\S*) cwd=/.exec(state);
    assert.ok(m !== null, state);
    const [, aiIp, uppercase, lowercase, http, noUpper, noLower] = m;
    assert.match(uppercase!, /^http:\/\/\d{1,3}(\.\d{1,3}){3}:4750$/);
    assert.notEqual(uppercase, `http://${aiIp}:4750`, 'the egress proxy is not the AI proxy');
    assert.equal(lowercase, uppercase);
    assert.equal(http, '', 'no HTTP_PROXY');
    assert.equal(noUpper, `${aiIp},localhost,127.0.0.1`);
    assert.equal(noLower, noUpper);
    assert.equal(leftovers(e.task_id), '');
  } finally {
    docker('rm', '-f', '-v', ai, output);
  }
  assert.throws(() => engine(f.url, { egressProxy: 'http://smokescreen:4750' }), /AGENT_EGRESS_PROXY: container:port/);
  await assert.rejects(engine(f.url, { egressProxy: 'fa-trial-missing:4750' }).execute(input('success')), /proxy fa-trial-missing/);
});

test('E4 claude: container killed from outside — no report, unknown cost', async () => {
  const f = forge();
  const e = input('sleep');
  const execution = engine(f.url).execute(e);
  for (let i = 0; i < 200 && docker('ps', '-q', '--filter', `name=^fa-${e.task_id}$`) === ''; i++) await sleep(100);
  docker('kill', `fa-${e.task_id}`);
  const s = await execution;
  assert.equal(s.report, null);
  assert.equal(s.cost_usd, null);
  assert.match(s.error ?? '', /container stopped before the end \(code 137\)/);
  assert.equal(leftovers(e.task_id), '');
});

test('E4 claude: inputs refused before any launch — other branch, model or image out of format', async () => {
  const f = forge();
  const m = engine(f.url);
  for (const branch of ['agent/trial-tool/1/tests', 'agent/other-tool/1/builder', 'main', 'agent/trial-tool/1/builder/x', 'agent/trial-tool/x/builder']) {
    await assert.rejects(m.execute(input('success', { branch })), /branch refused/, branch);
  }
  await assert.rejects(m.execute(input('success', { model: 'opus --tools Bash' })), /invalid model/);
  assert.throws(() => engine(f.url, { image: 'eupadev-fake-claude:test' }), /by digest/);
  assert.throws(() => engine(f.url, { image: `sha256:${'a'.repeat(64)}` }), /by digest/, 'local id: cosign cannot verify it');
  assert.throws(() => engine(f.url, { publicKey: ' ' }), /AGENT_COSIGN_PUB/);
  assert.throws(() => engine('http://forge.example.test'), /https required/);
  assert.equal(f.git('for-each-ref', 'refs/heads/agent'), '');
});

test('E4 claude: signature — image unsigned or signed by another key refused, the agent does not start', async () => {
  const f = forge();
  const cases: [string, Partial<ClaudeEngineOptions>, RegExp][] = [
    ['unsigned', { image: unsigned }, /no signatures found/],
    ['other key', { publicKey: otherKey }, /failed to verify signature/],
  ];
  for (const [what, o, reason] of cases) {
    const e = input('success');
    await assert.rejects(engine(f.url, o).execute(e), (err: Error) => /agents' image refused, cosign signature not verified/.test(err.message) && reason.test(err.message), what);
    // The `success` scenario pushes a commit: nothing pushed = the agent did not run.
    assert.equal(branchExists(f, e.branch), false, what);
    assert.equal(leftovers(e.task_id), '', what);
  }
});

test('E4 claude: gVisor runtime (runsc) by default', async (t) => {
  if (docker('info', '--format', '{{json .Runtimes}}').includes('"runsc"')) return t.skip('runsc installed here: checked on the agents VM');
  const f = forge();
  const e = input('success');
  const s = await engine(f.url, { runtime: undefined as unknown as string }).execute(e);
  assert.equal(s.report, null);
  assert.match(s.error ?? '', /runsc/);
  assert.equal(leftovers(e.task_id), '');
});
