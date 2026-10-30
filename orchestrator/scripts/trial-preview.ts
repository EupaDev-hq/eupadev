// Real test of the Preview pipeline (E5f, run by the lab's Preview verify playbook), run in the engine image: the
// engine's GiteaForge starts `preview-check.yml` on main with the Preview URL, then reads it like the watcher does
// (first run above the id returned at the start) until it is finished.
//   FORGE_URL=… FORGE_TOKEN_FILE=… node scripts/trial-preview.ts <slug> <url> [max wait in s]
// Output: one JSON line `{ since, result, wait_s }`. Exit 0 = result read; 1 = error or never finished; 2 = usage.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { GiteaForge } from '../src/external/gitea-forge.ts';

const [slug, url, maxText = '1800'] = process.argv.slice(2);
const file = process.env['FORGE_TOKEN_FILE'] ?? '';
const max = Number(maxText);
if (slug === undefined || url === undefined || !(max > 0) || file === '') {
  console.error('usage: FORGE_URL=… FORGE_TOKEN_FILE=… node scripts/trial-preview.ts <slug> <url> [max wait in s]');
  process.exit(2);
}
try {
  const forge = new GiteaForge({ url: process.env['FORGE_URL'] ?? '', token: readFileSync(file, 'utf8').trim() });
  const start = Date.now();
  const since = await forge.launchPreviewPipeline(slug, url);
  let result = await forge.previewPipelineFinished(slug, since);
  while (result === null) {
    if (Date.now() - start > max * 1000) throw new Error(`Preview pipeline not finished after ${max} s`);
    await sleep(15_000);
    result = await forge.previewPipelineFinished(slug, since);
  }
  console.log(JSON.stringify({ since: since, result: result, wait_s: Math.round((Date.now() - start) / 1000) }));
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
