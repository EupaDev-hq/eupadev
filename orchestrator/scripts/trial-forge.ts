// Real trial of the forge (E2, run by the lab's E2 verify playbook): the engine's code creates a tool on the real forge,
// or renames one (Gate 1: repository, then agent branches carried over under the new slug).
//   FORGE_URL=https://git.<domain> FORGE_TOKEN_FILE=<file> node scripts/trial-forge.ts create <slug>
//   FORGE_URL=https://git.<domain> FORGE_TOKEN_FILE=<file> node scripts/trial-forge.ts rename <from> <to>
// Depends only on `src/external/{contracts,gitea-forge}.ts` (no node_modules); never prints the token.
// Exit 0 = final state checked by the adapter; 1 = error (adapter's message, without secret); 2 = usage.
import { readFileSync } from 'node:fs';
import { ForgeError, GiteaForge } from '../src/external/gitea-forge.ts';

const [action, slug, to] = process.argv.slice(2);
const url = process.env['FORGE_URL'] ?? '';
const file = process.env['FORGE_TOKEN_FILE'] ?? '';
if (!((action === 'create' && to === undefined) || (action === 'rename' && to !== undefined)) || slug === undefined || url === '' || file === '') {
  console.error('usage: FORGE_URL=… FORGE_TOKEN_FILE=… node scripts/trial-forge.ts create <slug> | rename <from> <to>');
  process.exit(2);
}
try {
  const forge = new GiteaForge({ url, token: readFileSync(file, 'utf8').trim() });
  if (action === 'create') {
    await forge.createRepo(slug);
    console.log(`OK: ${slug} created or resumed, final state checked`);
  } else {
    await forge.renameTool(slug, to!);
    console.log(`OK: ${slug} renamed to ${to}, agent branches carried over`);
  }
} catch (e) {
  const type = e instanceof ForgeError ? (e.transient ? 'transient fault' : 'refusal') : 'error';
  console.error(`FAILED (${type}): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
