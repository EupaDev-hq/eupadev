// Paths forbidden to the agents (instructions analysis §3.2-3.3): a single constant, three uses — launcher, managed
// settings of the agent image, Gitea protected files (vars.yml). Without a database or Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORBIDDEN_DIRS, FORBIDDEN_FILES, forbiddenPath, giteaPatterns, managedDenyRules } from '../src/agent-engine/forbidden-paths.ts';
import { PATHS_BY_ROLE, inScope, ownerRole } from '../src/external/contracts.ts';

test('forbidden paths: root and subfolders, folders and files; the rest passes', () => {
  for (const c of ['.claude/settings.json', 'api/.claude/settings.json', '.gitea/workflows/ci.yml', '.github/x', 'agents/backend.md', 'AGENTS.md', 'docs/AGENTS.md',
    'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', 'web/.mcp.json', '.npmrc', 'api/.npmrc', '.pnpmfile.cjs', 'pnpm-workspace.yaml', '.gitmodules', '.gitattributes',
    '.husky/pre-commit', '.vscode/settings.json', '.idea/x.xml', '.devcontainer/devcontainer.json', '.devcontainer.json', '.git', 'sub/.git', '.opengrep/r.yml',
    '.gitleaksignore', '.semgrepignore', '.trivyignore.yaml']) {
    assert.ok(forbiddenPath(c), c);
  }
  for (const c of ['api/x.js', 'web/index.html', 'README.md', 'package.json', 'pnpm-lock.yaml', 'docs/DECISIONS.md', 'tests/unit/x.test.js', 'agents.md', 'api/agents-list.js', 'my.claude/x']) {
    assert.ok(!forbiddenPath(c), c);
  }
});

test('A-R0: the image belongs to the platform — Dockerfile, .dockerignore and .pnpmfile.mjs forbidden everywhere, Dockerfile to no role', () => {
  for (const c of ['Dockerfile', 'api/Dockerfile', '.dockerignore', 'web/.dockerignore', '.pnpmfile.mjs', 'api/.pnpmfile.mjs', '.pnpmfile.cjs']) assert.ok(forbiddenPath(c), c);
  for (const c of ['docs/Dockerfile.md', 'api/dockerfile.js', 'Dockerfile.dockerignore']) assert.ok(!forbiddenPath(c), c);
  assert.equal(ownerRole('Dockerfile'), undefined);
  assert.ok(!inScope('builder', 'Dockerfile') && !inScope('tests', 'Dockerfile'));
  assert.ok(!PATHS_BY_ROLE.builder.includes('Dockerfile'));
});

test('G4: vendor/ and node_modules/ forbidden at the root and in any subfolder (dependencies come from the registry)', () => {
  for (const c of ['vendor/eupadev-core-0.1.0.tgz', 'web/vendor/x.js', 'node_modules/@eupadev/core/src/index.js', 'api/node_modules/x/index.js', 'vendor', 'node_modules']) assert.ok(forbiddenPath(c), c);
  for (const c of ['api/vendor.js', 'web/vendors/x.js', 'docs/node_modules.md', 'lib/core/index.js']) assert.ok(!forbiddenPath(c), c);
});

test('scope per role (table of AGENTS.md, ADR-021): builder = api, db, web, tests/unit + commons; tests = tests/acceptance; contract; scoping free (except forbidden paths); read-only = nothing', () => {
  for (const f of ['api/x.js', 'db/0001.sql', 'web/app.js', 'tests/unit/x.test.js']) assert.equal(ownerRole(f), 'builder', f);
  assert.equal(ownerRole('public/logo.svg'), undefined, 'the core serves web/ only');
  assert.equal(ownerRole('tests/acceptance/steps/x.js'), 'tests');
  for (const f of ['README.md', 'tests/other.js', 'tests/unit', 'docs/spec.md', 'web']) assert.equal(ownerRole(f), undefined, f);
  assert.ok(inScope('builder', 'api/x.js') && inScope('builder', 'db/0001.sql') && inScope('builder', 'web/app.js') && !inScope('builder', 'public/logo.svg') && inScope('builder', 'tests/unit/x.test.js'));
  assert.ok(inScope('builder', 'README.md') && inScope('builder', '.env.example') && inScope('builder', 'docs/DECISIONS.md') && inScope('builder', 'package.json') && inScope('builder', 'pnpm-lock.yaml'));
  assert.ok(!inScope('builder', 'tests/acceptance/x.js') && !inScope('builder', 'tests/other/x.js') && !inScope('builder', 'docs/spec.md') && !inScope('builder', 'tests/unit') && !inScope('builder', 'openapi.yaml'));
  assert.ok(inScope('tests', 'tests/acceptance/steps/x.js') && !inScope('tests', 'tests/unit/x.js') && !inScope('tests', 'api/x.js'));
  assert.ok(inScope('contract', 'openapi.yaml') && inScope('contract', 'tests/acceptance/features/a.feature') && !inScope('contract', 'tests/acceptance/steps/a.js') && !inScope('contract', 'docs/spec.md'));
  assert.ok(inScope('scoping', 'docs/spec.md') && inScope('scoping', 'api/x.js'));
  for (const r of ['overlap', 'security-reviewer', 'quality-reviewer'] as const) assert.ok(!inScope(r, 'README.md'), r);
});

test('the same list everywhere: gitea_protected_files (vars.yml) = giteaPatterns(); every forbidden path has its managed deny rule', () => {
  const vars = readFileSync(new URL('../../infra/ansible/group_vars/forge/vars.yml', import.meta.url), 'utf8');
  const block = /^gitea_protected_files_list:\n((?:  - "[^"\n]*"\n)+)gitea_protected_files: "\{\{ gitea_protected_files_list \| join\(';'\) \}\}"$/m.exec(vars);
  assert.ok(block !== null, 'gitea_protected_files_list not found (one line per pattern, then the join by ";")');
  const m = [null, [...block[1]!.matchAll(/  - "([^"\n]*)"/g)].map((x) => x[1]).join(';')] as const;
  assert.equal(m[1], giteaPatterns(), 'copy giteaPatterns() (one pattern per line) into infra/ansible/group_vars/forge/vars.yml');
  const deny = managedDenyRules();
  for (const d of FORBIDDEN_DIRS) assert.ok(deny.includes(`Edit(${d}/**)`) && deny.includes(`Edit(**/${d}/**)`) && m[1].split(';').includes(`${d}/**`) && m[1].split(';').includes(`**/${d}/**`), d);
  for (const f of FORBIDDEN_FILES) assert.ok(deny.includes(`Edit(${f})`) && deny.includes(`Edit(**/${f})`) && m[1].split(';').includes(f) && m[1].split(';').includes(`**/${f}`), f);
  // The old patterns stay covered.
  for (const old of ['.gitea/**', '.opengrep/**', '.claude/**', 'agents/**', 'AGENTS.md', 'AGENTS.fr.md', 'CLAUDE.md', '.gitleaksignore', '.semgrepignore', '.trivyignore.yaml']) assert.ok(m[1].split(';').includes(old), old);
});
