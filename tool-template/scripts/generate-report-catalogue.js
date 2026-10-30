#!/usr/bin/env node
// Generates the closed lists of `rule` and `category` of agents/report.schema.json
// from the rule files, so a reviewer cannot invent a label (EupaDev ROADMAP §8.13 D20, M1):
//   rule     = every SEC-* entry of .claude/rules/tests.md + every `<file>#<section>` heading
//   category = every `<file>#<section>` heading + the two synthetic categories of the quality reviewer
// Never edit the enums by hand: tests/unit/report-schema.test.js fails when they are stale.
// Usage: node scripts/generate-report-catalogue.js
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const RULES_DIR = new URL('.claude/rules/', ROOT);
const SCHEMA = new URL('agents/report.schema.json', ROOT);
/** Verdict categories of agents/quality-reviewer.md that are not a section of a rule file. */
const SYNTHETIC_CATEGORIES = ['mechanical', 'data'];

export function catalogue() {
  const sections = [];
  const sec = [];
  for (const file of readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const text = readFileSync(new URL(file, RULES_DIR), 'utf8');
    for (const line of text.split('\n')) {
      const title = line.match(/^## (.+?)\s*$/);
      if (title) sections.push(`${file}#${title[1]}`);
      const entry = line.match(/^- \*\*(SEC-[A-Z]+)\*\*/);
      if (entry) sec.push(entry[1]);
    }
  }
  return {
    rule: [...sec, ...sections],
    category: [...sections, ...SYNTHETIC_CATEGORIES],
  };
}

export function apply(schema) {
  const { rule, category } = catalogue();
  schema.$defs.rule.enum = rule;
  schema.$defs.category.enum = category;
  return schema;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const schema = apply(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  writeFileSync(SCHEMA, JSON.stringify(schema, null, 2) + '\n');
  console.log(`agents/report.schema.json: ${schema.$defs.rule.enum.length} rules, ${schema.$defs.category.enum.length} categories`);
}
