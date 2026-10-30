// A-R6 checks: C1, refused words in the message the requester reads; C2, no code in the evidence the tests role receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jargon } from '../src/agent-engine/jargon.ts';
import { RETAINED_EVIDENCE, transmissibleEvidence } from '../src/agent-engine/report.ts';

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
