import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue } from '../../scripts/generate-report-catalogue.js';

const schema = JSON.parse(readFileSync(new URL('../../agents/report.schema.json', import.meta.url), 'utf8'));

test('the closed lists of rule and category match the rule files (regenerate: node scripts/generate-report-catalogue.js)', () => {
  const expected = catalogue();
  assert.deepEqual(schema.$defs.rule.enum, expected.rule);
  assert.deepEqual(schema.$defs.category.enum, expected.category);
  assert.ok(expected.rule.includes('SEC-IDOR'));
  assert.ok(expected.rule.includes('security.md#Requests'));
  assert.ok(expected.category.includes('mechanical'));
  assert.equal(new Set(expected.rule).size, expected.rule.length, 'duplicate rule');
  assert.equal(new Set(expected.category).size, expected.category.length, 'duplicate category');
});

test('findings reference the closed lists and carry previous_id (nullable, required)', () => {
  const f = schema.properties.findings.items;
  assert.equal(f.properties.rule.$ref, '#/$defs/rule');
  assert.equal(f.properties.category.$ref, '#/$defs/category');
  assert.equal(schema.properties.category_verdicts.items.properties.category.$ref, '#/$defs/category');
  assert.ok(f.required.includes('previous_id'));
  assert.deepEqual(f.properties.previous_id.type, ['string', 'null']);
  assert.equal(f.additionalProperties, false);
});

test('the overlap verdict is a closed list, optional for every role (EupaDev C1: missing or invalid = to be checked)', () => {
  const v = schema.properties.verdict;
  assert.equal(v.type, 'string');
  assert.deepEqual(v.enum, ['plausible', 'not_plausible']);
  assert.ok(!schema.required.includes('verdict'));
  assert.equal(schema.additionalProperties, false);
});
