/**
 * "Pushing fake" (E3, "engine for real" note §1.6, ROADMAP no. 18): an agent engine WITHOUT AI that really pushes
 * to the forge, with the `svc-agent` token, a set of files prepared per role, on the task's branch
 * (`agent/<tool>/<cycle>/<role>`, L5), then returns a compliant report. Enough to exercise real integration, merge and CI
 * without an agent. Lab only: in production, the `svc-agent` token belongs to the launcher alone (separate process).
 *
 * Set chosen by the end of the tool's slug: `-faulty` (an `eval()` in `api/`, like `verify-template`: red CI, E4),
 * `-out-of-scope` (the builder also writes into `tests/acceptance/`), `-conflict` (the builder creates `web/common.js`, which
 * `main` received in the meantime: the builder's branch conflicts with `main`, a real risk of ADR-021; the trial
 * `scripts/trial-integration.ts` pushes that commit to `main`); otherwise `normal`. Each task writes a NEW file (named after the task) and never changes those of
 * previous rounds: after a squash into main, a role branch that rewrites its own lines conflicts with
 * main on the next round (common base from before the squash). The real launcher (`claude-engine.ts`, E7), for its part,
 * merges main into the branch before working.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PATHS_BY_ROLE, CODE_ROLES, type TaskInput, type AgentEngine, type Role, type RoleCode, type TaskOutput } from './contracts.ts';
import { GitRepo, ForgeError, verifyAddress } from './gitea-forge.ts';
import { compliantReport, happyResponse } from './fakes.ts';

export const FILE_SETS = ['normal', 'faulty', 'out-of-scope', 'conflict'] as const;
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

export interface PushingEngineOptions { url: string; token: string; organisation?: string; account?: string; attempts?: number; intervalMs?: number; gitTimeoutMs?: number }

export class PushingEngine implements AgentEngine {
  readonly #o: Required<PushingEngineOptions>;

  constructor(o: PushingEngineOptions) {
    verifyAddress(o.url, o.token);
    this.#o = { organisation: 'eupadev', account: 'svc-agent', attempts: 4, intervalMs: 1000, gitTimeoutMs: 120_000, ...o };
  }

  async execute(input: TaskInput): Promise<TaskOutput> {
    const start = Date.now();
    const role = input.role;
    if (role === 'scoping') return this.#mockup(input, start);
    if (!(CODE_ROLES as readonly Role[]).includes(role)) {
      const r = happyResponse(input);
      return { report: r.type === 'report' ? r.report : null, cost_usd: 0, duration_s: 0, tree_hash: null };
    }
    const code = role as RoleCode;
    const files = fileSetFiles(fileSetOfSlug(input.tool), code, input.task_id);
    const tree = await this.#push(input, files, PATHS_BY_ROLE[code]);
    return { report: compliantReport(role, input.task_id, { files_changed: Object.keys(files) }), cost_usd: 0, duration_s: Math.round((Date.now() - start) / 1000), tree_hash: tree };
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
      await repo.git(['commit', '-q', '-m', `${role}: task ${input.task_id}`]);
      await repo.push(input.branch);
      if (paths !== null) tree = createHash('sha256').update((await repo.git(['ls-tree', '-r', 'HEAD', '--', ...paths])).output).digest('hex');
    } finally {
      await repo.release();
    }
    return tree;
  }
}
