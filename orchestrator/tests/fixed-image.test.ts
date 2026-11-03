// A-R0: a tool's image comes from the platform's FIXED Dockerfile
// (.gitea/image/ of the template), never from a file of the agent. Reads the template's files (no Docker: the real
// build is proven by verify-template on the lab) and runs check 4 of the guard-rails (the package check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- JavaScript module of the template, without type declarations
import { findings, lockfileFindings as lockfile } from '../../tool-template/.gitea/checks/package.mjs';

const TEMPLATE = new URL('../../tool-template/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, TEMPLATE), 'utf8');
/** Lines outside comments (`#`): what runs, not what explains it. */
const instructions = (text: string) => text.split('\n').filter((l) => !/^\s*#/.test(l));
const findingsOf = (p: unknown) => (findings as (t: string) => string[])(JSON.stringify(p));
const lockfileFindingsOf = lockfile as (t: string) => string[];

test('fixed image: platform Dockerfile — no script or .pnpmfile on install or prune, code owned by root', () => {
  const d = instructions(read('.gitea/image/Dockerfile')).join('\n');
  const pnpm = d.split('\n').filter((l) => /^RUN\s.*\bpnpm\b/.test(l));
  assert.ok(pnpm.some((l) => /\bpnpm install\b/.test(l)) && pnpm.some((l) => /\bpnpm prune\b/.test(l)), 'install and prune present');
  for (const l of pnpm) assert.ok(/\s--ignore-scripts\b/.test(l) && /\s--ignore-pnpmfile\b/.test(l), `missing flags: ${l}`);
  assert.doesNotMatch(d, /--chown/, '/app must stay owned by root');
  assert.match(d, /^COPY --from=build \/app \.$/m);
  assert.match(d, /^CMD \["node", "node_modules\/@eupadev\/core\/bin\/start\.js"\]$/m, 'the core is the server');
  assert.match(d, /^LABEL eupadev\.core=\$\{CORE_VERSION\}$/m, 'core mode of the deployer');
});

test('fixed image: build context — no node_modules, at any depth', () => {
  const lines = read('.gitea/image/Dockerfile.dockerignore').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('**/node_modules'));
});

test('fixed image: CI builds with -f and BuildKit; no Dockerfile or .dockerignore at the root of the template', () => {
  const ci = instructions(read('.gitea/workflows/check.yml')).join('\n');
  const build = ci.split('\n').filter((l) => /docker build\b/.test(l));
  assert.equal(build.length, 1, 'a single build');
  assert.match(build[0]!, /^\s*DOCKER_BUILDKIT=1 docker build .*-f \.gitea\/image\/Dockerfile /);
  assert.doesNotMatch(ci, /hadolint/, 'hadolint judged the agent’s Dockerfile: it runs in EupaDev’s CI');
  assert.match(ci, /--entrypoint node "\$IMAGE"[\s\S]*"\/app\/package\.json", "\/app\/write-trial"[\s\S]*EACCES/, '/app not writable, checked');
  assert.match(ci, /^\s*run: sh \.gitea\/checks\/boot-check\.sh "\$IMAGE"$/m, 'the image boots read-only against a migrated database (step 9.7)');
  const boot = instructions(read('.gitea/checks/boot-check.sh')).join('\n');
  assert.match(boot, /--read-only --tmpfs \/tmp\S* --cap-drop ALL --security-opt no-new-privileges --user 1000:1000/, 'deployer posture');
  assert.match(boot, /"\$IMAGE" node node_modules\/@eupadev\/core\/bin\/migrate\.js/, 'migration by the same image');
  assert.ok(!existsSync(new URL('Dockerfile', TEMPLATE)) && !existsSync(new URL('.dockerignore', TEMPLATE)));
});

test('guard-rails 4: package.json without lifecycle script or devEngines', () => {
  assert.deepEqual(findingsOf({ scripts: { start: 'node index.js', test: 'node --test', verify: 'sh scripts/verify.sh', prestart: 'x' } }), []);
  assert.deepEqual(findingsOf({ name: 'tool' }), []);
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'dependencies', 'pnpm:devPreinstall']) {
    assert.deepEqual(findingsOf({ scripts: { [name]: 'node -e 1' } }), [`package.json: lifecycle script "${name}" refused`], name);
  }
  assert.match(findingsOf({ devEngines: { packageManager: { name: 'pnpm', version: '10.20.0', onFail: 'download' } } }).join(), /"devEngines" refused/);
  assert.match(findingsOf({ scripts: [] }).join(), /"scripts" must be an object/);
  assert.match((findings as (t: string) => string[])('{').join(), /unreadable/);
  assert.match(read('.gitea/checks/guard-rails.sh'), /^ {2}node \.gitea\/checks\/package\.mjs package\.json \|\| red=1$/m, 'the guard-rails run the check');
  assert.deepEqual(findingsOf(JSON.parse(read('package.json'))), [], 'the template’s package.json passes');
});

test('guard-rails 4 core package.json: registry versions only, core at an exact version (G4)', () => {
  assert.deepEqual(findingsOf({ dependencies: { '@eupadev/core': '0.1.0', pg: '^8.23.1' }, devDependencies: { a: '~1.2', b: 'latest', c: '>=1 <2', d: '1.0.0 || 2.0.0', e: '*' } }), []);
  for (const spec of ['file:lib/core', 'link:lib/core', 'link:../core', 'file:vendor/eupadev-core-0.1.0.tgz', 'git+https://forge.example/x/core.git#v0.1.0',
    'git://x/core', 'git+ssh://git@x/core.git', 'github:x/core', 'x/core', 'https://forge.example/core-0.1.0.tgz', 'http://x/core.tgz',
    './core.tgz', 'core-0.1.0.tgz', '/abs/core', 'workspace:*', 'npm:@eupadev/core@0.1.0', 'catalog:']) {
    for (const name of ['@eupadev/core', 'left-pad']) {
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.match(findingsOf({ [section]: { [name]: spec } }).join(), /refused \(registry version only/, `${section} ${name} ${spec}`);
      }
    }
    assert.match(findingsOf({ pnpm: { overrides: { '@eupadev/core': spec } } }).join(), /pnpm\.overrides .*refused/, `overrides ${spec}`);
    assert.match(findingsOf({ resolutions: { '@eupadev/core': spec } }).join(), /resolutions .*refused/, `resolutions ${spec}`);
  }
  for (const spec of ['^0.1.0', '~0.1.0', '0.1', 'latest', '*', '>=0.1.0']) {
    assert.match(findingsOf({ dependencies: { '@eupadev/core': spec } }).join(), /exact version required/, spec);
  }
  assert.match(findingsOf({ dependencies: ['x'] }).join(), /"dependencies" must be an object/);
});

// Lockfile shapes produced by pnpm 12.9.1 (trial of 2026-10-21) for the redirects, and the expected registry shape.
const REGISTRY_LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@eupadev/core':
        specifier: 0.1.0
        version: 0.1.0(pg@8.23.1)

packages:

  '@eupadev/core@0.1.0':
    resolution: {integrity: sha512-AAAA==, tarball: https://forge.example/api/packages/eupadev-core/npm/%40eupadev%2Fcore/-/0.1.0/core-0.1.0.tgz}
    engines: {node: '>=24'}

snapshots:

  '@eupadev/core@0.1.0(pg@8.23.1)':
    dependencies:
      pg: 8.23.1

  tool-lib@1.0.0:
    dependencies:
      '@eupadev/core': 0.1.0(pg@8.23.1)
`;
const redirection = (spec: string, resolution: string) => `importers:

  .:
    dependencies:
      '@eupadev/core':
        specifier: ${spec}
        version: ${spec}

packages:

  '@eupadev/core@${spec}':
    resolution: ${resolution}

snapshots:

  '@eupadev/core@${spec}': {}
`;

test('guard-rails 4 core pnpm-lock.yaml: @eupadev/core resolved from the registry only', () => {
  assert.deepEqual(lockfileFindingsOf(REGISTRY_LOCKFILE), []);
  assert.deepEqual(lockfileFindingsOf(REGISTRY_LOCKFILE.replace(', tarball: https://forge.example/api/packages/eupadev-core/npm/%40eupadev%2Fcore/-/0.1.0/core-0.1.0.tgz', '')), [], 'integrity only');
  assert.deepEqual(lockfileFindingsOf(read('pnpm-lock.yaml')), [], 'today’s template (no core) passes');
  for (const [spec, resolution] of [['file:lib/core', '{directory: lib/core, type: directory}'],
    ['file:vendor/eupadev-core-0.1.0.tgz', '{integrity: sha512-AAAA==, tarball: file:vendor/eupadev-core-0.1.0.tgz}'],
    ['https://codeload.github.com/x/core/tar.gz/abc', '{tarball: https://codeload.github.com/x/core/tar.gz/abc}'],
    ['git+https://forge.example/x/core.git#abc', '{commit: abc, repo: https://forge.example/x/core.git, type: git}']] as const) {
    assert.ok(lockfileFindingsOf(redirection(spec, resolution)).length >= 3, spec);
  }
  assert.match(lockfileFindingsOf(`importers:\n\n  .:\n    dependencies:\n      '@eupadev/core':\n        specifier: link:lib/core\n        version: link:lib/core\n`).join(), /version: link:lib\/core refused/);
  // Lockfile tampered alone (package.json still says 0.1.0): the resolution decides.
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace('        version: 0.1.0(pg@8.23.1)', '        version: file:lib/core')).join(), /version: file:lib\/core refused/);
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace("'@eupadev/core@0.1.0(pg@8.23.1)':", "'@eupadev/core@file:lib/core':")).join(), /core@file:lib\/core refused/, 'snapshot key');
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace('https://forge.example/api/packages/eupadev-core/npm/', 'https://evil.example/')).join(), /registry resolution only/);
  // ADR-023: same forge, another owner (where the tools' write badge could publish a fake core): refused.
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace('/api/packages/eupadev-core/npm/', '/api/packages/eupadev/npm/')).join(), /registry resolution only/, 'other owner');
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace('integrity: sha512-AAAA==, ', '')).join(), /registry resolution only/, 'no integrity');
  assert.match(lockfileFindingsOf(REGISTRY_LOCKFILE.replace("      '@eupadev/core': 0.1.0(pg@8.23.1)", "      '@eupadev/core': link:../core")).join(), /link:\.\.\/core refused/, 'transitive');
});

test('guard-rails 4 core CLI: the package check reads pnpm-lock.yaml next to package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-rails-core-'));
  try {
    const run = (pj: string) => spawnSync(process.execPath, [fileURLToPath(new URL('.gitea/checks/package.mjs', TEMPLATE)), pj], { encoding: 'utf8' });
    assert.equal(run(fileURLToPath(new URL('package.json', TEMPLATE))).status, 0, 'today’s template passes');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@eupadev/core': '0.1.0' } }));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), REGISTRY_LOCKFILE);
    assert.equal(run(join(dir, 'package.json')).status, 0);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), redirection('file:lib/core', '{directory: lib/core, type: directory}'));
    const r = run(join(dir, 'package.json'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^GUARD-RAIL pnpm-lock\.yaml: @eupadev\/core@file:lib\/core refused/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
