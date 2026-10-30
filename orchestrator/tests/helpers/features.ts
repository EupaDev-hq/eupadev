// Minimal reading of the .feature files (no dependency): scenarios, @t: tags and Examples rows, noting
// those of an @to-wire table. Shared by tests/feature-coverage.test.ts and features/support/hooks.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DIR = 'features';

export interface Scenario { file: string; title: string; tags: string[]; examples: Record<string, string>[]; executedExamples: Record<string, string>[] }
/** Tag of the scenarios without Cucumber step definitions (excluded from `pnpm test:bdd`). */
export const TO_WIRE = '@to-wire';

/** Reads a .feature: scenarios, @t: tags and Examples rows (header = first row of the table), noting those of an @to-wire table. */
export function readFeature(file: string): Scenario[] {
  const scenarios: Scenario[] = [];
  let tags: string[] = [];
  let current: Scenario | undefined;
  let inExamples = false;
  let examplesToWire = false;
  let header: string[] | undefined;
  const lines = readFileSync(join(DIR, file), 'utf8').split('\n');
  for (const [i, brute] of lines.entries()) {
    const line = brute.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      // A tag set on an "Examples:" table (e.g. @to-wire) is not the tag of the next scenario.
      const next = lines.slice(i + 1).find((l) => l.trim() !== '' && !l.trim().startsWith('#'))?.trim() ?? '';
      if (/^Examples:/.test(next)) examplesToWire = line.split(/\s+/).includes(TO_WIRE);
      else tags.push(...line.split(/\s+/));
      continue;
    }
    const title = /^(?:Scenario|Scenario Outline|Example):\s*(.*)$/.exec(line);
    if (title) {
      current = { file: file, title: title[1] ?? '', tags, examples: [], executedExamples: [] };
      scenarios.push(current);
      tags = [];
      inExamples = false;
      examplesToWire = false;
      continue;
    }
    if (/^Examples:/.test(line)) { inExamples = true; header = undefined; continue; }
    if (inExamples && line.startsWith('|') && current) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (header === undefined) header = cells;
      else {
        const values = Object.fromEntries(header.map((k, i) => [k, cells[i] ?? '']));
        current.examples.push(values);
        if (!examplesToWire) current.executedExamples.push(values);
      }
      continue;
    }
    if (inExamples && !line.startsWith('|')) { inExamples = false; examplesToWire = false; }
  }
  return scenarios;
}

export const featureFiles = (): string[] => readdirSync(DIR).filter((f) => f.endsWith('.feature')).sort();
export const allScenarios = (): Scenario[] => featureFiles().flatMap(readFeature);
export const executedScenarios = (): Scenario[] => allScenarios().filter((s) => !s.tags.includes(TO_WIRE));

/** Exact number of runs of `cucumber-js` without a filter: one per scenario, one per executed Examples row of an Outline. */
export function executionCount(): number {
  return executedScenarios().reduce((n, s) => n + (s.examples.length > 0 ? s.executedExamples.length : 1), 0);
}
