// Real trial of the forge (E2, run by the lab's E2 verify playbook): the engine's code creates a tool on the real forge.
//   FORGE_URL=https://git.<domain> FORGE_TOKEN_FILE=<file> node scripts/trial-forge.ts create <slug>
// Depends only on `src/external/{contracts,gitea-forge}.ts` (no node_modules); never prints the token.
// Exit 0 = final state checked by the adapter; 1 = error (adapter's message, without secret); 2 = usage.
import { readFileSync } from 'node:fs';
import { ForgeError, GiteaForge } from '../src/external/gitea-forge.ts';

const [action, slug] = process.argv.slice(2);
const url = process.env['FORGE_URL'] ?? '';
const file = process.env['FORGE_TOKEN_FILE'] ?? '';
if (action !== 'create' || slug === undefined || url === '' || file === '') {
  console.error('usage: FORGE_URL=… FORGE_TOKEN_FILE=… node scripts/trial-forge.ts create <slug>');
  process.exit(2);
}
try {
  await new GiteaForge({ url, token: readFileSync(file, 'utf8').trim() }).createRepo(slug);
  console.log(`OK: ${slug} created or resumed, final state checked`);
} catch (e) {
  const type = e instanceof ForgeError ? (e.transient ? 'transient fault' : 'refusal') : 'error';
  console.error(`FAILED (${type}): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
