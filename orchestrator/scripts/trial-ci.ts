// Real trial of step E4 (run by the lab's E4 verify playbook), after `trial-integration.ts` on the same tool: the
// watcher's code (`GiteaForge.ciFinished`, svc-orchestrator token) waits for the end of the real CI of main started by the
// squash of round 1, then reads it again (resume: same result).
//   FORGE_URL=https://git.<domain> FORGE_TOKEN_FILE=<file> node scripts/trial-ci.ts <slug> <cycle> [max wait in s]
// Depends only on `src/external/{contracts,gitea-forge}.ts`; never prints a token. Output: one JSON line
// `{ ci, resume, wait_s }`. Exit 0 = result read; 1 = error or CI never finished; 2 = usage.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { ForgeError, GiteaForge } from '../src/external/gitea-forge.ts';

const [slug, cycleText, maxText = '1500'] = process.argv.slice(2);
const url = process.env['FORGE_URL'] ?? '';
const file = process.env['FORGE_TOKEN_FILE'] ?? '';
const cycle = Number(cycleText);
const max = Number(maxText);
if (slug === undefined || !Number.isSafeInteger(cycle) || cycle < 1 || !(max > 0) || url === '' || file === '') {
  console.error('usage: FORGE_URL=… FORGE_TOKEN_FILE=… node scripts/trial-ci.ts <slug> <cycle> [max wait in s]');
  process.exit(2);
}
try {
  const forge = new GiteaForge({ url, token: readFileSync(file, 'utf8').trim() });
  const start = Date.now();
  let ci = await forge.ciFinished(slug!, cycle, 1);
  // Same pace as the watcher in service (WATCHER_CRON: 30 s), a little tighter for the trial.
  while (ci === null) {
    if (Date.now() - start > max * 1000) throw new Error(`main CI not finished after ${max} s`);
    await sleep(15_000);
    ci = await forge.ciFinished(slug!, cycle, 1);
  }
  console.log(JSON.stringify({ ci, resume: await forge.ciFinished(slug!, cycle, 1), wait_s: Math.round((Date.now() - start) / 1000) }));
} catch (e) {
  const type = e instanceof ForgeError ? (e.transient ? 'transient fault' : 'refusal') : 'error';
  console.error(`FAILED (${type}): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
