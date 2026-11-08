// Contract check of the launcher (`agent-engine/contract.ts`): the core's own linter on the `openapi.yaml` the contract
// role leaves, the YAML parsed first. Pure, no Git: the engine's side is in claude-engine.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractRefused } from '../src/agent-engine/contract.ts';

const HERE = new URL('.', import.meta.url).pathname;
const read = (...p: string[]) => readFileSync(join(HERE, '..', '..', ...p), 'utf8');

test('the reference tool\'s contract and the template\'s placeholder read: nothing to refuse', () => {
  assert.equal(contractRefused(read('examples', 'requests', 'openapi.yaml')), null);
  assert.equal(contractRefused(read('tool-template', 'openapi.yaml')), null);
});

test('a contract the core refuses: the linter\'s message, every reason, in the refusal', () => {
  const r = contractRefused('openapi: 3.1.0\npaths:\n  /api/items:\n    get:\n      operationId: listItems\n      responses:\n        "200": { description: ok }\n');
  assert.ok(r !== null);
  assert.match(r, /^openapi\.yaml: contract refused \(4\):\n- GET \/api\/items: x-roles required/);
  assert.match(r, /declare the error responses 401, 403, 429/);
  assert.equal(contractRefused(''), 'openapi.yaml: contract refused (2):\n- openapi must be 3.1.x\n- no operation in paths');
});

test('YAML that does not parse: the parser\'s message with its line, never an exception', () => {
  const r = contractRefused('openapi: 3.1.0\npaths:\n  /api/x: [\n');
  assert.ok(r !== null);
  assert.match(r, /^openapi\.yaml does not parse: .* at line 4, column 1/);
  // Duplicate keys: YAML forbids them and the core would read one of the two; refused here too.
  assert.match(contractRefused('openapi: 3.1.0\nopenapi: 3.0.0\npaths: {}\n') ?? '', /does not parse: Map keys must be unique/);
});
