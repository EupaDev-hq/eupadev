// Core of the tools in the agent's container (ADR-023, "Agents' access"): the launcher fills the task volume's pnpm
// store in a SEPARATE container that holds the read badge on its stdin only, before the agent's container starts.
// Fake `docker` and `cosign` on the PATH (log of every call, stdin included), real Git (forge = bare repositories
// in `file://`): no Docker needed. The real pnpm behaviour (fetch, then frozen install without any route to the
// forge, badge nowhere in the volume) was proven by a local trial with Docker.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskInput } from '../src/external/contracts.ts';
import { ClaudeCodeEngine, coreFromLockfile, lockfileRefused, packageJsonRefused } from '../src/external/claude-engine.ts';

const HERE = new URL('.', import.meta.url).pathname;
const SCHEMA = readFileSync(join(HERE, '..', '..', 'tool-template', 'agents', 'report.schema.json'), 'utf8');
const REGISTRY = 'https://forge.test/api/packages/eupadev-core/npm/';
const BADGE = 'read-badge-core-0123456789abcdef';
const root = mkdtempSync(join(tmpdir(), 'engine-core-'));
after(() => rmSync(root, { recursive: true, force: true }));

// Fake docker: one log line per call (arguments, then stdin for `run`, both base64). `run` of the fetch container
// answers like pnpm (or fails, echoing the badge, when FAKE_CORE_FAILURE is set); `run` of the agent answers with a framed
// successful result and an empty bundle (nothing pushed).
const bin = join(root, 'bin');
mkdirSync(bin);
const RESULT = Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, structured_output: { ok: true } })).toString('base64');
writeFileSync(join(bin, 'docker'), `#!/bin/sh
a=$(for x in "$@"; do printf '%s\\037' "$x"; done | base64 -w0)
if [ "$1" != run ]; then printf '%s\\t\\n' "$a" >> "$FAKE_LOG"; exit 0; fi
printf '%s\\t%s\\n' "$a" "$(base64 -w0)" >> "$FAKE_LOG"
case " $* " in
  *" --name fa-core-update-"*) if [ -n "\${FAKE_CORE_FAILURE:-}" ]; then echo "ERR_PNPM_META_FETCH_FAIL GET ${REGISTRY}@eupadev%2Fcore ($FAKE_CORE_FAILURE)"; exit 1; fi
    printf '\\nEUPADEV-PACKAGE %s\\nEUPADEV-LOCKFILE %s\\n' "$FAKE_CORE_UPDATE_PACKAGE" "$FAKE_CORE_UPDATE_LOCKFILE"; exit 0 ;;
  *" --name fa-core-"*) if [ -n "\${FAKE_CORE_FAILURE:-}" ]; then echo "ERR_PNPM_FETCH_404 GET ${REGISTRY}@eupadev/core/-/core.tgz ($FAKE_CORE_FAILURE)"; exit 1; fi
    echo 'Packages: +70'; exit 0 ;;
esac
printf '\\nEUPADEV-CODE 0\\nEUPADEV-RESULT ${RESULT}\\nEUPADEV-ERRORS \\nEUPADEV-BUNDLE \\n'
`);
writeFileSync(join(bin, 'cosign'), '#!/bin/sh\nexit 0\n');
chmodSync(join(bin, 'docker'), 0o755);
chmodSync(join(bin, 'cosign'), 0o755);
process.env['PATH'] = `${bin}:${process.env['PATH']}`;

const lockfile = (version: string, tarball = `${REGISTRY}@eupadev/core/-/core-${version}.tgz`) => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@eupadev/core':
        specifier: ${version}
        version: ${version}

packages:

  '@eupadev/core@${version}':
    resolution: {integrity: sha512-AAAA, tarball: ${tarball}}

snapshots:

  '@eupadev/core@${version}': {}
`;

let n = 0;
/** Forge with one tool whose main holds `files`; log of the fake docker; engine with the core configured. */
function bench(files: Record<string, string>) {
  const dir = join(root, `trial-${++n}`);
  const repo = join(dir, 'eupadev', 'trial-tool.git');
  const work = join(dir, 'work');
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=trial', '-c', 'user.email=trial@example.test', ...a], { cwd, encoding: 'utf8' }).trim();
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '--bare', '-b', 'main');
  mkdirSync(work);
  writeFileSync(join(work, 'README.md'), 'tool\n');
  for (const [f, t] of Object.entries(files)) writeFileSync(join(work, f), t);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'template');
  git(work, 'push', '-q', repo, 'main');
  git(repo, 'update-ref', 'refs/heads/integration/1/1', 'main'); // what a reviewer reads
  const log = join(dir, 'log');
  writeFileSync(log, '');
  process.env['FAKE_LOG'] = log;
  delete process.env['FAKE_CORE_FAILURE'];
  delete process.env['FAKE_CORE_UPDATE_PACKAGE'];
  delete process.env['FAKE_CORE_UPDATE_LOCKFILE'];
  const engine = new ClaudeCodeEngine({
    forgeUrl: `file://${dir}`, token: 'svc-agent-token', image: `registry.test/eupadev/agent@sha256:${'a'.repeat(64)}`, publicKey: '/key.pub',
    reportSchema: SCHEMA, runtime: 'runc', core: { registry: REGISTRY, token: BADGE },
  });
  const calls = () => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => {
    const [a, input = ''] = l.split('\t');
    return { args: Buffer.from(a!, 'base64').toString('utf8').split('\x1f').slice(0, -1), input: Buffer.from(input, 'base64') };
  });
  return { engine, calls };
}

const task = (role: TaskInput['role'] = 'builder'): TaskInput => ({
  task_id: `trial-tool-core-${++n}`, tool: 'trial-tool', role, instructions: 'Instructions.', context: {}, cap: { duration_min: 15, turns: 10, budget_usd: 1 },
  model: 'claude-opus-5-5', effort: 'medium', branch: role === 'security-reviewer' ? 'integration/1/1' : `agent/trial-tool/1/${role}`, signal: new AbortController().signal,
});

test('core store: the fetch container runs before the agent, the read badge only on its stdin, never seen by the agent', async () => {
  const b = bench({ 'package.json': '{"dependencies":{"@eupadev/core":"0.1.0"}}', 'pnpm-lock.yaml': lockfile('0.1.0') });
  const e = task();
  const s = await b.engine.execute(e);
  assert.ok(s.report !== null, s.error);
  const calls = b.calls();
  const runs = calls.filter((a) => a.args[0] === 'run');
  const name = (a: { args: string[] }) => a.args[a.args.indexOf('--name') + 1];
  assert.deepEqual(runs.map(name), [`fa-core-${e.task_id}`, `fa-${e.task_id}`], 'fetch container first, then the agent');
  const [fetch, agent] = runs as [typeof runs[0], typeof runs[0]];
  assert.ok(calls.findIndex((a) => a.args[0] === 'volume' && a.args[1] === 'create') < calls.indexOf(fetch), 'the task volume exists before the fetch');
  const volume = `--mount=type=volume,src=fa-ws-${e.task_id},dst=/home/agent`;
  assert.ok(fetch.args.includes(volume) && agent.args.includes(volume), 'same task volume for both containers');
  assert.ok(fetch.args.includes(`FA_CORE_REGISTRY=${REGISTRY}`));
  assert.ok(fetch.input.includes(BADGE), 'badge given to the fetch container on its stdin');
  for (const a of calls) assert.ok(!a.args.some((x) => x.includes(BADGE)), `badge in the arguments of docker ${a.args[0]}`);
  assert.ok(!agent.input.includes(BADGE), 'badge in the agent’s archive');
  assert.ok(!agent.args.some((x) => /npmrc|_authToken|FA_CORE/.test(x)), 'nothing of the badge mechanism in the agent’s container');
});

test('core store: no fetch container when the lockfile has no core, nor for a read-only role', async () => {
  const none = bench({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
  assert.ok((await none.engine.execute(task())).report !== null);
  assert.deepEqual(none.calls().filter((a) => a.args[0] === 'run').length, 1);
  const reader = bench({ 'pnpm-lock.yaml': lockfile('0.1.0') });
  await reader.engine.execute(task('security-reviewer'));
  assert.equal(reader.calls().filter((a) => a.args[0] === 'run').length, 1);
});

test('core store: a core version the registry cannot serve stops the task before the agent, clear message, badge masked', async () => {
  const b = bench({ 'pnpm-lock.yaml': lockfile('0.2.0') });
  process.env['FAKE_CORE_FAILURE'] = BADGE;
  await assert.rejects(b.engine.execute(task()), (err: Error) => {
    assert.match(err.message, /core: pnpm fetch failed for @eupadev\/core@0\.2\.0 \(code 1\): version absent from the forge registry/);
    assert.match(err.message, /ERR_PNPM_FETCH_404/);
    assert.ok(!err.message.includes(BADGE), 'badge in the error message');
    return true;
  });
  assert.equal(b.calls().filter((a) => a.args[0] === 'run').length, 1, 'the agent never starts');
});

test('core store: a lockfile with a tarball outside the forge registry is refused before any container', async () => {
  const b = bench({ 'pnpm-lock.yaml': lockfile('0.1.0', 'https://elsewhere.test/@eupadev/core/-/core-0.1.0.tgz') });
  await assert.rejects(b.engine.execute(task()), /core: pnpm-lock\.yaml refused before fetching \(tarball outside the forge registry/);
  assert.equal(b.calls().filter((a) => a.args[0] === 'run').length, 0);
});

test('core store: lockfile reading (version, registry-only resolutions)', () => {
  assert.equal(coreFromLockfile(lockfile('1.2.3')), '1.2.3');
  assert.equal(coreFromLockfile("lockfileVersion: '9.0'\n"), null);
  assert.equal(lockfileRefused(lockfile('1.2.3'), REGISTRY), null);
  assert.equal(lockfileRefused('    resolution: {integrity: sha512-x}\n', REGISTRY), null);
  assert.match(lockfileRefused('    resolution: {commit: abc, repo: https://x.test/r.git, type: git}\n', REGISTRY) ?? '', /non-registry resolution/);
  assert.match(lockfileRefused('    resolution: {directory: ../core, type: directory}\n', REGISTRY) ?? '', /non-registry resolution/);
  assert.throws(() => new ClaudeCodeEngine({ forgeUrl: 'file:///x', token: 'j', image: `r/a@sha256:${'a'.repeat(64)}`, publicKey: '/c', reportSchema: SCHEMA, core: { registry: 'http://forge.test/api/packages/eupadev/npm/', token: BADGE } }), /AGENT_CORE_REGISTRY/);
});

// ── Decision A: core bump at the start of an evolution (`coreUpToDate`), same container family as the fetch ──────────

const pkg = (version: string, extra = '') => `{"name":"tool","dependencies":{"@eupadev/core":"${version}"${extra}}}\n`;
/** What the fake bump container answers (the two files pnpm would write). */
function bumpTo(version: string, packageJson = pkg(version), tarball?: string): void {
  process.env['FAKE_CORE_UPDATE_PACKAGE'] = Buffer.from(packageJson).toString('base64');
  process.env['FAKE_CORE_UPDATE_LOCKFILE'] = Buffer.from(lockfile(version, tarball)).toString('base64');
}

test('core bump: the tool moves to the latest version in a container like the fetch one (badge on stdin only, no task volume), the two files come back as data', async () => {
  const b = bench({ 'package.json': pkg('0.1.0'), 'pnpm-lock.yaml': lockfile('0.1.0') });
  bumpTo('0.1.2');
  const update = await b.engine.coreUpToDate('trial-tool');
  assert.ok(update !== null);
  assert.equal(update.from, '0.1.0');
  assert.equal(update.to, '0.1.2');
  assert.equal(update.package_json, pkg('0.1.2'));
  assert.equal(coreFromLockfile(update.lockfile), '0.1.2');
  const calls = b.calls();
  const runs = calls.filter((a) => a.args[0] === 'run');
  assert.equal(runs.length, 1);
  const [run] = runs as [typeof runs[0]];
  const name = run.args[run.args.indexOf('--name') + 1]!;
  assert.match(name, /^fa-core-update-trial-tool-[0-9a-f]{8}$/);
  assert.ok(run.args.includes(`FA_CORE_REGISTRY=${REGISTRY}`) && run.args.includes('HOME=/tmp/home') && run.args.includes('--read-only') && run.args.includes('--cap-drop=ALL'));
  assert.ok(!run.args.some((x) => x.startsWith('--mount=type=volume')), 'no task volume: the repository never enters this container');
  assert.ok(run.input.includes(BADGE) && run.input.includes('"@eupadev/core":"0.1.0"'), 'badge and files on stdin');
  for (const a of calls) assert.ok(!a.args.some((x) => x.includes(BADGE)), `badge in the arguments of docker ${a.args[0]}`);
  assert.deepEqual(calls.at(-1)!.args, ['rm', '-f', name], 'the container is removed whatever happens');
});

test('core bump: already on the latest version → null (nothing to commit); no core, no lockfile or core not configured → null without any container', async () => {
  const upToDate = bench({ 'package.json': pkg('0.1.2'), 'pnpm-lock.yaml': lockfile('0.1.2') });
  bumpTo('0.1.2');
  assert.equal(await upToDate.engine.coreUpToDate('trial-tool'), null);
  assert.equal(upToDate.calls().filter((a) => a.args[0] === 'run').length, 1, 'the registry was asked');
  const none = bench({ 'package.json': '{"dependencies":{}}', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
  assert.equal(await none.engine.coreUpToDate('trial-tool'), null);
  const noLockfile = bench({ 'package.json': pkg('0.1.0') });
  assert.equal(await noLockfile.engine.coreUpToDate('trial-tool'), null);
  assert.equal(none.calls().filter((a) => a.args[0] === 'run').length + noLockfile.calls().filter((a) => a.args[0] === 'run').length, 0, 'no container');
  const noCore = new ClaudeCodeEngine({ forgeUrl: 'file:///x', token: 'j', image: `r/a@sha256:${'a'.repeat(64)}`, publicKey: '/c', reportSchema: SCHEMA });
  assert.equal(await noCore.coreUpToDate('trial-tool'), null);
});

test('core bump: registry unreachable → clear error, badge masked (the cycle goes on with the current version, W1)', async () => {
  const b = bench({ 'package.json': pkg('0.1.0'), 'pnpm-lock.yaml': lockfile('0.1.0') });
  process.env['FAKE_CORE_FAILURE'] = BADGE;
  await assert.rejects(b.engine.coreUpToDate('trial-tool'), (err: Error) => {
    assert.match(err.message, /core: update of @eupadev\/core to the latest version failed \(code 1\): registry unreachable/);
    assert.match(err.message, /ERR_PNPM_META_FETCH_FAIL/);
    assert.ok(!err.message.includes(BADGE), 'badge in the error message');
    return true;
  });
});

test('core bump: files changed beyond the core version, or resolved outside the forge registry, are refused (never committed)', async () => {
  const b = bench({ 'package.json': pkg('0.1.0'), 'pnpm-lock.yaml': lockfile('0.1.0') });
  bumpTo('0.1.2', pkg('0.1.2', ',"left-pad":"1.3.0"'));
  await assert.rejects(b.engine.coreUpToDate('trial-tool'), /core: updated files refused \(package\.json changed beyond the core version\)/);
  const elsewhere = bench({ 'package.json': pkg('0.1.0'), 'pnpm-lock.yaml': lockfile('0.1.0') });
  bumpTo('0.1.2', pkg('0.1.2'), 'https://elsewhere.test/@eupadev/core/-/core-0.1.2.tgz');
  await assert.rejects(elsewhere.engine.coreUpToDate('trial-tool'), /core: updated files refused \(tarball outside the forge registry/);
  const before = bench({ 'package.json': pkg('0.1.0'), 'pnpm-lock.yaml': lockfile('0.1.0', 'https://elsewhere.test/@eupadev/core/-/core-0.1.0.tgz') });
  await assert.rejects(before.engine.coreUpToDate('trial-tool'), /core: pnpm-lock\.yaml refused before the update/);
  assert.equal(before.calls().filter((a) => a.args[0] === 'run').length, 0, 'no container for a refused lockfile');
  // The pure check: same object but the core version → accepted; anything else → refused.
  assert.equal(packageJsonRefused(pkg('0.1.0'), pkg('0.1.2'), '0.1.2'), null);
  assert.equal(packageJsonRefused('{"dependencies":{"@eupadev/core":"0.1.0"},"scripts":{"a":"b"}}', '{"scripts":{"a":"b"},"dependencies":{"@eupadev/core":"0.1.2"}}', '0.1.2'), null, 'key order does not matter');
  assert.match(packageJsonRefused(pkg('0.1.0'), pkg('0.1.2').replace('"name":"tool"', '"name":"other"'), '0.1.2') ?? '', /beyond the core version/);
  assert.match(packageJsonRefused(pkg('0.1.0'), pkg('0.1.2').replace('"dependencies"', '"scripts":{"postinstall":"x"},"dependencies"'), '0.1.2') ?? '', /beyond the core version/);
  assert.match(packageJsonRefused(pkg('0.1.0'), pkg('^0.1.2'), '0.1.2') ?? '', /does not name @eupadev\/core at 0\.1\.2/);
  assert.match(packageJsonRefused(pkg('0.1.0'), '{', '0.1.2') ?? '', /unreadable/);
});
