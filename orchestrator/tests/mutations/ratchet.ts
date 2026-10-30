// Mutation ratchet (M4, ROADMAP §8.15): their count can only go up. Fails (code 1) when the compared count is below the
// highest of the given references. The CI passes the reference of `main` (read on `main`, out of the tested branch's
// reach) and the branch's own: removing a mutation, or lowering the reference, does not pass without a human commit on
// `main`. Raising the reference when a mutation is added = changing reference.json in the same commit.
//
// Usage: node tests/mutations/ratchet.ts [--killed N] reference.json…
//   without --killed: compares the number of mutations declared in mutations.ts (on every push);
//   --killed N:       compares the number of mutations killed by the campaign (weekly job).
import { readFileSync } from 'node:fs';
import { MUTATIONS } from './mutations.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--killed');
const files = args.filter((_, j) => i === -1 || (j !== i && j !== i + 1));
const count = i === -1 ? MUTATIONS.length : Number(args[i + 1]);
const what = i === -1 ? 'mutations declared' : 'mutations killed';
const references = files.map((f) => (JSON.parse(readFileSync(f, 'utf8')) as { mutations: unknown }).mutations);

if (files.length === 0 || !references.every((r) => Number.isInteger(r)) || !Number.isInteger(count)) {
  console.error(`ratchet: unreadable reference or count (references ${JSON.stringify(references)}, ${what} "${i === -1 ? count : args[i + 1]}")`);
  process.exit(2);
}
const reference = Math.max(...(references as number[]));
if (count < reference) {
  console.error(`ratchet: ${count} ${what} < reference ${reference}: a mutation disappeared or survives. Removing a mutation = a human commit on main that lowers reference.json.`);
  process.exit(1);
}
console.log(`ratchet: ${count} ${what} ≥ reference ${reference}${count > reference ? ' (raise reference.json to this count)' : ''}`);
