// "No dead end" traceability: every transition of states.ts is covered by at least one EXECUTED Gherkin scenario
// (neither a scenario nor an Examples table tagged `TO_WIRE`), and every tag @t:<from>--<trigger>--><to>
// names a real transition. On a Scenario Outline, the <columns> of the tag are replaced by each
// row of the Examples. Minimal parsing of the .feature files, no dependency. That the announced transition really
// happens during the scenario is checked by features/support/hooks.ts, when Cucumber runs (database history).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRANSITIONS, triggerKey } from '../src/machine/states.ts';
import { TO_WIRE, DIR, featureFiles, executionCount, executedScenarios, allScenarios, type Scenario } from './helpers/features.ts';

const key = (from: string, trigger: string, to: string) => `${from}--${trigger}-->${to}`;
const expected = new Set(TRANSITIONS.map((t) => key(t.from, triggerKey(t.trigger), t.to)));

const files = featureFiles();
const scenarios = allScenarios();
const executes = executedScenarios();

/** @t: tags of a scenario, placeholders replaced by the given Examples rows. */
function coveredTransitions(s: Scenario, examples: Record<string, string>[]): string[] {
  return s.tags.filter((e) => e.startsWith('@t:')).flatMap((e) => {
    const reason = e.slice(3);
    if (!reason.includes('<')) return [reason];
    assert.ok(s.examples.length > 0, `${s.file} "${s.title}": tag ${e} with a <column> but no Examples`);
    return examples.map((line) => reason.replace(/<([^>]+)>/g, (_, col: string) => {
      const v = line[col];
      assert.ok(v !== undefined, `${s.file} "${s.title}": column <${col}> missing from the Examples`);
      return v;
    }));
  });
}

test('every .feature file is in English Gherkin and holds at least one scenario', () => {
  assert.ok(files.length >= 6, `files found: ${files.join(', ')}`);
  for (const f of files) {
    const text = readFileSync(join(DIR, f), 'utf8');
    assert.doesNotMatch(text, /^\s*#\s*language:/m, `${f}: no "# language:" line expected (English is Cucumber's default)`);
    assert.match(text, /^Feature:/m, `${f}: no Feature keyword`);
    assert.ok(scenarios.some((s) => s.file === f), `${f}: no scenario`);
  }
});

test('every @t: tag names a real transition of states.ts', () => {
  for (const s of scenarios) {
    for (const t of coveredTransitions(s, s.examples)) assert.ok(expected.has(t), `${s.file} "${s.title}": unknown transition ${t}`);
  }
});

test('count of the scenarios wired to the engine (Cucumber): shown', () => {
  console.log(`scenarios wired to the DBOS engine: ${executes.length}/${scenarios.length} (${scenarios.length - executes.length} ${TO_WIRE}), that is ${executionCount()} executions`);
  assert.ok(executes.length > 0);
});

test('every transition of states.ts is covered by at least one EXECUTED scenario (neither tagged nor in Examples tagged TO_WIRE)', () => {
  const covered = new Set(executes.flatMap((s) => coveredTransitions(s, s.executedExamples)));
  const missing = [...expected].filter((t) => !covered.has(t));
  assert.deepEqual(missing, [], `transitions without an executed scenario (${missing.length}/${expected.size})`);
});
