// Real trial of step E3 (run by the lab's E3 verify playbook): the engine's code creates the tool
// (svc-orchestrator token), the pushing fake (PushingEngine) pushes the file set of each code role into it (svc-agent token,
// set chosen by the end of the slug), then integration and merge; both are replayed (resume: same result, nothing more).
// Set `conflict`: before the integration, svc-orchestrator pushes a `web/common.js` onto main (like the squash of an earlier
// round), which the builder's branch also creates: conflict between the builder's branch and main (ADR-021).
//   FORGE_URL=https://git.<domain> FORGE_TOKEN_FILE=<file> AGENT_TOKEN_FILE=<file> node scripts/trial-integration.ts <slug> <cycle>
// Depends only on `src/external/{contracts,fakes,gitea-forge,pushing-engine}.ts` (no node_modules) and the git client;
// never prints a token. Output: one JSON line of the results. Exit 0 = ran to the end; 1 = error; 2 = usage.
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CODE_ROLES } from '../src/external/contracts.ts';
import { GitRepo, ForgeError, GiteaForge } from '../src/external/gitea-forge.ts';
import { fileSetOfSlug, PushingEngine } from '../src/external/pushing-engine.ts';

const [slug, cycleText] = process.argv.slice(2);
const url = process.env['FORGE_URL'] ?? '';
const orchestrator = process.env['FORGE_TOKEN_FILE'] ?? '';
const agent = process.env['AGENT_TOKEN_FILE'] ?? '';
const cycle = Number(cycleText);
if (slug === undefined || !Number.isSafeInteger(cycle) || cycle < 1 || url === '' || orchestrator === '' || agent === '') {
  console.error('usage: FORGE_URL=… FORGE_TOKEN_FILE=… AGENT_TOKEN_FILE=… node scripts/trial-integration.ts <slug> <cycle>');
  process.exit(2);
}
// Gitea computes mergeability in the background: a little more patience than in service.
const settings = { attempts: 6, intervalMs: 2000 };
try {
  const forgeToken = readFileSync(orchestrator, 'utf8').trim();
  const forge = new GiteaForge({ url, token: forgeToken, ...settings });
  const engine = new PushingEngine({ url, token: readFileSync(agent, 'utf8').trim(), ...settings });
  await forge.createRepo(slug!);
  const files: Record<string, unknown> = {};
  for (const role of CODE_ROLES) {
    const s = await engine.execute({
      task_id: `e3-${cycle}-${role}`, tool: slug!, role, instructions: `Role ${role} (trial E3)`, context: {},
      cap: { duration_min: 5, turns: 1, budget_usd: 0 }, model: 'pushing-fake', effort: 'low',
      branch: `agent/${slug}/${cycle}/${role}`, signal: AbortSignal.timeout(300_000),
      launched: async () => {},
    });
    files[role] = (s.report as { files_changed?: unknown } | null)?.files_changed;
  }
  if (fileSetOfSlug(slug!) === 'conflict') {
    const repo = await GitRepo.clone({ url, organisation: 'eupadev', slug: slug!, token: forgeToken, account: 'svc-orchestrator', ...settings, timeoutMs: 120_000 });
    try {
      await repo.git(['checkout', '-q', '-B', 'main', 'origin/main']);
      await writeFile(join(repo.dir, 'web/common.js'), '// main (previous round)\n');
      await repo.git(['add', '--', 'web/common.js']);
      await repo.git(['commit', '-q', '-m', 'Trial E3: main receives web/common.js']);
      await repo.push('main');
    } finally {
      await repo.release();
    }
  }
  const pass = async () => {
    const integration = await forge.integrate(slug!, cycle, 1);
    return { integration, merge: integration.result === 'ok' ? await forge.merge(slug!, cycle, 1) : null };
  };
  const first = await pass();
  console.log(JSON.stringify({ set: fileSetOfSlug(slug!), files: files, ...first, resume: await pass() }));
} catch (e) {
  const type = e instanceof ForgeError ? (e.transient ? 'transient fault' : 'refusal') : 'error';
  console.error(`FAILED (${type}): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
