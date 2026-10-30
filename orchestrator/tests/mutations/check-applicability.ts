// Quick check (no test run): each text to mutate appears exactly once in its file.
import { readFileSync } from 'node:fs';
import { MUTATIONS } from './mutations.ts';
let ko = 0;
for (const m of MUTATIONS) {
  const text = readFileSync(m.file, 'utf8');
  for (const [before] of m.replacements) {
    const n = text.split(before).length - 1;
    if (n !== 1) { ko++; console.log(`${m.id} (${m.file}): found ${n} times: ${before.slice(0, 90).replace(/\n/g, '⏎')}`); }
  }
}
console.log(`${MUTATIONS.length} mutations, ${ko} not applicable`);
process.exit(ko === 0 ? 0 : 1);
