// A-R6 checks: C1, refused words in the message the requester reads; C2, no code in the evidence the tests role receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jargon } from '../src/agent-engine/jargon.ts';
import { RETAINED_EVIDENCE, ReportValidator, transmissibleEvidence } from '../src/agent-engine/report.ts';
import { compliantReport } from '../src/external/fakes.ts';

test('C1: a technical word is found, as written, in any case and plural', () => {
  assert.equal(jargon('Do you need a JSON export?'), 'JSON');
  assert.equal(jargon('The Migrations will be done tomorrow'), 'Migrations');
  assert.equal(jargon('The data schema'), 'schema');
  assert.equal(jargon('An error code 404 shows up'), 'code 404');
  assert.equal(jargon('through the API.'), 'API');
  assert.equal(jargon('(token)'), 'token');
});

test('C1: the French list is checked too, accents and case included', () => {
  assert.equal(jargon('Le schéma des données'), 'schéma');
  assert.equal(jargon('Le SCHÉMA'), 'SCHÉMA');
});

test('C1: business words and words that only contain a refused one pass', () => {
  for (const t of ['Do you need an export to a spreadsheet?', 'quickly', 'capital', 'tokenisation', 'postcode 75001',
    'A request moves to the "closed" status.', 'schematic', 'beekeeper', '']) assert.equal(jargon(t), null, t);
});

test('C2: evidence naming a code file or holding a code fence is withheld; test and contract lines pass', () => {
  for (const e of ['api/tools.js:12 if (site)', 'see `web/app.js`', '(db/migrations/0001.sql) CHECK', 'x\n```js\nconst a = 1;\n```'])
    assert.equal(transmissibleEvidence(e), RETAINED_EVIDENCE, e);
  for (const e of ['tests/acceptance/steps/list.js:14 expects 404; openapi.yaml /api/tools/{id} declares 200',
    '/tools/{id}: the test reads the tool of another site', 'GET /api/categories answers 200 in the contract'])
    assert.equal(transmissibleEvidence(e), e, e);
});

test('capabilities: a scoping report says which platform capabilities it relies on, from the closed list; without the field or outside the list it is invalid; other roles are not concerned', () => {
  const v = new ReportValidator(new URL('../../tool-template/agents/report.schema.json', import.meta.url).pathname);
  const expected = { role: 'scoping', task_id: 't-1' };
  const scoping = (extra: Record<string, unknown>) => ({ ...compliantReport('scoping', 't-1'), ...extra });
  assert.ok(v.validate(scoping({ capabilities_used: ['sign-in', 'csv-export'], capabilities_missing: ['Email to the technician at each status change'] }), expected).valid);
  assert.ok(v.validate(scoping({ capabilities_used: [], capabilities_missing: [] }), expected).valid);
  assert.match((v.validate(scoping({ capabilities_used: ['email-notification'] }), expected) as { errors: string }).errors, /capabilities_used\/0 must be equal to one of the allowed values/);
  assert.match((v.validate(scoping({ capabilities_used: null }), expected) as { errors: string }).errors, /scoping without capabilities_used/);
  const { capabilities_used: _, ...without } = compliantReport('scoping', 't-1');
  assert.match((v.validate(without, expected) as { errors: string }).errors, /scoping without capabilities_used/);
  assert.ok(v.validate(compliantReport('contract', 't-2'), { role: 'contract', task_id: 't-2' }).valid, 'no capabilities_used for the other roles');
});
