/**
 * "Pushing fake" (E3, ROADMAP no. 18): an agent engine WITHOUT AI that really pushes
 * to the forge, with the `svc-agent` token, a set of files prepared per role, on the task's branch
 * (`agent/<tool>/<cycle>/<role>`, L5), then returns a compliant report. Enough to exercise real integration, merge and CI
 * without an agent. Lab only: in production, the `svc-agent` token belongs to the launcher alone (separate process).
 *
 * Set chosen by the end of the tool's slug: `-faulty` (an `eval()` in `api/`, like `verify-template`: red CI, E4),
 * `-out-of-scope` (the builder also writes into `tests/acceptance/`), `-conflict` (the builder creates `web/common.js`, which
 * `main` received in the meantime: the builder's branch conflicts with `main`, a real risk of ADR-021; the trial
 * `scripts/trial-integration.ts` pushes that commit to `main`); `-example` (the free cycle before any paid one,
 * `infra/ansible/verify-engine-deployment.yml -e free_cycle=true`): the reference tool of `examples/requests/` (the
 * folder `example`, `EXAMPLE_PATH` in the engine image) — the contract role pushes its `openapi.yaml`, the tests role a
 * Preview-shaped acceptance suite (one sign-in scenario per role of the contract, people found by role as in
 * `infra/ansible/files/trial-acceptance`; the example's own suite runs on the core's local stack, not on a Preview), the
 * builder its `api/`, `db/`, `web/`, `tests/unit/` and `README.md` (the example has no dependency the template lacks:
 * the tool's package files stay the template's); otherwise `normal`. Each task of the normal sets writes a NEW file
 * (named after the task) and never changes those of previous rounds: after a squash into main, a role branch that
 * rewrites its own lines conflicts with main on the next round (common base from before the squash). The example set
 * writes the same files at every round (identical to main after the squash: no conflict), and an unchanged round is an
 * empty commit. The real launcher (`claude-engine.ts`, E7), for its part, merges main into the branch before working.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { PATHS_BY_ROLE, CODE_ROLES, type TaskInput, type AgentEngine, type Role, type RoleCode, type TaskOutput } from './contracts.ts';
import { GitRepo, ForgeError, verifyAddress } from './gitea-forge.ts';
import { compliantReport, happyResponse } from './fakes.ts';

export const FILE_SETS = ['normal', 'faulty', 'out-of-scope', 'conflict', 'example'] as const;
export type FileSet = (typeof FILE_SETS)[number];

export function fileSetOfSlug(slug: string): FileSet {
  return FILE_SETS.find((j) => j !== 'normal' && slug.endsWith(`-${j}`)) ?? 'normal';
}

/** Files written by a code role for a task (path → content). */
export function fileSetFiles(fileSet: FileSet, role: RoleCode, task: string): Record<string, string> {
  const name = task.replace(/[^A-Za-z0-9-]/g, '-');
  const header = `// Task ${task} (pushing fake, set ${fileSet}).\n`;
  const module = `${header}export const trial = () => 'ok';\n`;
  if (role === 'tests') {
    return {
      [`tests/acceptance/trial-${name}.test.js`]: `${header}import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('trial of the fake', () => assert.equal(1 + 1, 2));\n`,
    };
  }
  return {
    [`api/lib/trial-${name}.js`]: fileSet === 'faulty' ? `${header}eval(process.argv[2]);\n` : module,
    [`web/trial-${name}.js`]: module,
    ...(fileSet === 'out-of-scope' ? { [`tests/acceptance/stolen-${name}.js`]: module } : {}),
    ...(fileSet === 'conflict' ? { 'web/common.js': '// builder\n' } : {}),
  };
}

// ── Example set: the reference tool, pushed role by role ────────────────────────────────────────────────────────────

/** Roles named by the contract (`x-roles` of every operation), in order of first appearance; a contract without any = []. */
export function contractRoles(openapi: string): string[] {
  const doc = parse(openapi) as { paths?: Record<string, Record<string, { 'x-roles'?: unknown }>> } | null;
  const roles: string[] = [];
  for (const path of Object.values(doc?.paths ?? {})) {
    for (const op of Object.values(path ?? {})) {
      const r = op?.['x-roles'];
      if (Array.isArray(r)) for (const x of r) if (typeof x === 'string' && !roles.includes(x)) roles.push(x);
    }
  }
  return roles;
}

/**
 * Acceptance suite the Preview check can run (`.gitea/checks/acceptance.sh`: `tests/acceptance/playwright.config.js`,
 * people found by role in `KIT_REALM_FILE`): one scenario per role, "signs in and reads their roles".
 */
export function signInSuite(roles: readonly string[]): Record<string, string> {
  const scenarios = roles.map((r) => `  Scenario: A ${r} signs in and reads their roles\n    Given a "${r}" signs in\n    Then their roles are "${r}"\n`).join('\n');
  return {
    'tests/acceptance/playwright.config.js': [
      '// Acceptance suite of the example set of the pushing fake (not the example\'s own suite, which runs on the core\'s local',
      '// stack): one sign-in scenario per role of the contract, against the deployed Preview, people found by role.',
      "import { defineConfig } from '@playwright/test';",
      "import { defineBddConfig } from 'playwright-bdd';",
      '',
      'export default defineConfig({',
      "  testDir: defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.js' }),",
      '  workers: 1,',
      '  timeout: 60_000,',
      '});',
      '',
    ].join('\n'),
    'tests/acceptance/features/sign-in.feature': `Feature: Signing in on the Preview\n\n${scenarios}`,
    'tests/acceptance/steps/sign-in.js': [
      '// The n-th person holding a role (never a name), signed in through the real Keycloak form of the Preview, then the',
      '// API read with that session.',
      "import { expect } from '@playwright/test';",
      "import { createBdd } from 'playwright-bdd';",
      "import { readRealm } from '@eupadev/core/kit/realm.js';",
      "import { callFrom, signedInContext } from '@eupadev/core/kit/two-users.js';",
      '',
      'const BASE = /** @type {string} */ (process.env.ACCEPTANCE_BASE_URL);',
      'const { people } = readRealm(process.env.KIT_REALM_FILE);',
      'const person = (/** @type {string} */ role, n = 1) => people.filter((p) => p.roles.includes(role))[n - 1];',
      'const { Given, Then } = createBdd();',
      '/** @type {import(\'@playwright/test\').BrowserContext} */ let session;',
      '',
      "Given('a {string} signs in', async ({ browser }, /** @type {string} */ role) => {",
      '  session = await signedInContext(browser, BASE, person(role));',
      '});',
      '',
      "Then('their roles are {string}', async ({}, /** @type {string} */ role) => {",
      "  const r = await callFrom(session, BASE, 'GET', '/api/me');",
      '  expect(r.status, r.text).toBe(200);',
      '  expect(r.json.roles).toEqual([role]);',
      '});',
      '',
    ].join('\n'),
  };
}

/** Example files a role pushes (path → content), read from the example folder. */
function exampleFiles(folder: string, role: Role): Record<string, string> {
  const read = (...files: string[]): Record<string, string> => Object.fromEntries(files.map((f) => [f, readFileSync(join(folder, f), 'utf8')]));
  const tree = (dir: string): string[] => (existsSync(join(folder, dir)) ? readdirSync(join(folder, dir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(folder, join(e.parentPath, e.name))) : []);
  switch (role) {
    case 'contract': return read('openapi.yaml');
    case 'tests': return signInSuite(contractRoles(readFileSync(join(folder, 'openapi.yaml'), 'utf8')));
    case 'builder': return read('README.md', ...['api', 'db', 'web', 'tests/unit'].flatMap(tree));
    default: return {};
  }
}

export interface PushingEngineOptions {
  url: string; token: string; organisation?: string; account?: string; attempts?: number; intervalMs?: number; gitTimeoutMs?: number;
  /** Folder of the reference tool (`examples/requests`, `/app/example` in the engine image): required by the `example` set only. */
  example?: string;
}

export class PushingEngine implements AgentEngine {
  readonly #o: Required<Omit<PushingEngineOptions, 'example'>>;
  readonly #example: string | undefined;

  constructor(o: PushingEngineOptions) {
    verifyAddress(o.url, o.token);
    const { example, ...rest } = o;
    this.#o = { organisation: 'eupadev', account: 'svc-agent', attempts: 4, intervalMs: 1000, gitTimeoutMs: 120_000, ...rest };
    this.#example = example;
  }

  async execute(input: TaskInput): Promise<TaskOutput> {
    const start = Date.now();
    await input.launched(); // no container here, but the same contract as the real launcher (counted before the work)
    const role = input.role;
    const duration = () => Math.round((Date.now() - start) / 1000);
    if (role === 'scoping') return this.#mockup(input, start);
    const fileSet = fileSetOfSlug(input.tool);
    if (fileSet === 'example' && (role === 'contract' || (CODE_ROLES as readonly Role[]).includes(role))) {
      if (this.#example === undefined) throw new ForgeError('example set: no example folder (EXAMPLE_PATH)', false);
      const folder = this.#example;
      const code = (CODE_ROLES as readonly Role[]).includes(role) ? (role as RoleCode) : null;
      const files = exampleFiles(folder, role);
      const tree = await this.#push(input, files, code === null ? null : PATHS_BY_ROLE[code]);
      return { report: compliantReport(role, input.task_id, { files_changed: Object.keys(files) }), cost_usd: 0, duration_s: duration(), tree_hash: tree };
    }
    if (!(CODE_ROLES as readonly Role[]).includes(role)) {
      const r = happyResponse(input);
      return { report: r.type === 'report' ? r.report : null, cost_usd: 0, duration_s: 0, tree_hash: null };
    }
    const code = role as RoleCode;
    const files = fileSetFiles(fileSet, code, input.task_id);
    const tree = await this.#push(input, files, PATHS_BY_ROLE[code]);
    return { report: compliantReport(role, input.task_id, { files_changed: Object.keys(files) }), cost_usd: 0, duration_s: duration(), tree_hash: tree };
  }

  /** E5e: the scoping role pushes one self-contained mock-up page under web/ (the mock-up is that branch's web/ folder). */
  async #mockup(input: TaskInput, start: number): Promise<TaskOutput> {
    const name = input.task_id.replace(/[^A-Za-z0-9-]/g, '-');
    const files = { [`web/mockup-${name}.html`]: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock-up</title><h1>Mock-up of task ${name}</h1></html>\n` };
    await this.#push(input, files, null);
    return { report: compliantReport('scoping', input.task_id, { files_changed: Object.keys(files) }), cost_usd: 0, duration_s: Math.round((Date.now() - start) / 1000), tree_hash: null };
  }

  /** Clone, commit the files on the task's branch (never elsewhere than an agent branch of THIS tool), push; tree hash of `paths`. */
  async #push(input: TaskInput, files: Record<string, string>, paths: readonly string[] | null): Promise<string | null> {
    // Guard: never anywhere but an agent branch of THIS tool.
    if (!input.branch.startsWith(`agent/${input.tool}/`)) throw new ForgeError(`branch ${input.branch} refused: not an agent branch of ${input.tool}`, false);
    const role = input.role;
    const o = this.#o;
    const repo = await GitRepo.clone({ url: o.url, organisation: o.organisation, slug: input.tool, token: o.token, account: o.account, attempts: o.attempts, intervalMs: o.intervalMs, timeoutMs: o.gitTimeoutMs }, input.signal);
    let tree: string | null = null;
    try {
      const exists = (await repo.branches()).has(input.branch);
      await repo.git(['checkout', '-q', '-B', input.branch, exists ? `origin/${input.branch}` : 'origin/main']);
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(repo.dir, path)), { recursive: true });
        await writeFile(join(repo.dir, path), content);
      }
      await repo.git(['add', '--', ...Object.keys(files)]);
      // The example set writes the same files at every round: an unchanged round is an empty commit, never a failure.
      await repo.git(['commit', '-q', '--allow-empty', '-m', `${role}: task ${input.task_id}`]);
      await repo.push(input.branch);
      if (paths !== null) tree = createHash('sha256').update((await repo.git(['ls-tree', '-r', 'HEAD', '--', ...paths])).output).digest('hex');
    } finally {
      await repo.release();
    }
    return tree;
  }
}
