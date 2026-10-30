// Pure functions of the kit (kit/index.js): valid values and invalid variants drawn from the schemas of the example
// tool's contract, judged by the core's real validator (what the server will refuse).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { isCompliant, REQUEST_HEADERS, example, compliantExample, invalidValues, readContract } from '../kit/index.js';
import { ajvBody, ajvRequest, compile } from '../src/validation.js';
import { EXAMPLE } from './helpers/server.js';

const contract = readContract(`${EXAMPLE}openapi.yaml`);
const op = (/** @type {string} */ id) => contract.operations.find((o) => o.operationId === id) ?? assert.fail(id);

describe('kit: data drawn from the contract', () => {
  test('static headers: X-Requested-With: eupadev and Sec-Fetch-Site: same-origin, frozen', () => {
    assert.deepEqual({ ...REQUEST_HEADERS }, { 'x-requested-with': 'eupadev', 'sec-fetch-site': 'same-origin' });
    assert.ok(Object.isFrozen(REQUEST_HEADERS));
  });

  test('example: createItem body valid for the core, required properties only', () => {
    const body = op('createItem').schemas.body ?? assert.fail();
    const v = compliantExample(body, 'createItem');
    assert.deepEqual(v, { name: 'a' });
    assert.deepEqual(compile(ajvBody, body)(v), []);
  });

  test('example: uuid, bounds, enum, the contract\'s example first', () => {
    assert.match(String(example({ type: 'string', format: 'uuid' })), /^[0-9a-f-]{36}$/);
    assert.equal(example({ type: 'integer', minimum: 5, maximum: 9 }), 5);
    assert.equal(example({ type: 'integer', maximum: -3 }), -3);
    assert.equal(example({ type: 'string', enum: ['open', 'closed'] }), 'open');
    assert.equal(example({ type: 'string', minLength: 3, maxLength: 80 }), 'aaa');
    assert.equal(example({ type: 'string', pattern: '^[A-Z]{3}$', maxLength: 3, example: 'ABC' }), 'ABC');
    assert.deepEqual(example({ type: 'array', minItems: 2, maxItems: 4, items: { type: 'boolean' } }), [true, true]);
  });

  test('compliantExample: an unsolved pattern fails the kit (never a false green)', () => {
    assert.throws(() => compliantExample({ type: 'string', pattern: '^[A-Z]{3}$', maxLength: 3 }, 'op body.code'), /add `example`/);
  });

  test('invalidValues: each variant of the createItem body is refused by the core', () => {
    const body = op('createItem').schemas.body ?? assert.fail();
    const v = invalidValues(body);
    const validate = compile(ajvBody, body);
    assert.deepEqual(v.map((i) => i.what), [
      'expected type object', 'name missing',
      'name: expected type string', 'name: more than 80 characters', 'name: fewer than 1 characters',
      'status: expected type string', 'status: outside enum',
      'note: expected type string', 'note: more than 500 characters',
    ]);
    for (const i of v) assert.notDeepEqual(validate(structuredClone(i.value)), [], i.what);
  });

  test('invalidValues as text (query): no "wrong type" for a string, bounds and arrays', () => {
    const q = op('listItems').schemas.query;
    const v = invalidValues(q, true);
    assert.deepEqual(v.map((i) => i.what), [
      'limit: expected type integer', 'limit: below the minimum 1', 'limit: above the maximum 100',
      'status: outside enum', 'tags: more than 5 items', 'tags: item: more than 20 characters',
    ]);
    const validate = compile(ajvRequest, q);
    for (const i of v) {
      // What the kit sends: strings (URLSearchParams).
      const text = Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (i.value)).map(([k, x]) => [k, Array.isArray(x) ? x.map(String) : String(x)]));
      assert.notDeepEqual(validate(text), [], i.what);
    }
    const p = invalidValues(op('getItem').schemas.params, true);
    assert.deepEqual(p.map((i) => i.what), ['id missing', 'id: format uuid', 'id: format uuid (urn:uuid:)']);
    for (const i of p) assert.notDeepEqual(compile(ajvRequest, op('getItem').schemas.params)(i.value), [], i.what);
  });

  test('shipped by the package (K1): @eupadev/core/kit and its modules, kit/ in files', async () => {
    const kit = await import('@eupadev/core/kit');
    assert.equal(typeof kit.signIn, 'function');
    assert.equal(typeof (await import('@eupadev/core/kit/sec.js')).generateCases, 'function');
    assert.equal(typeof (await import('@eupadev/core/kit/two-users.js')).twoUsers, 'function');
    assert.equal(typeof (await import('@eupadev/core/kit/test-tools.js')).argsSchemathesis, 'function');
    assert.equal((await import('@eupadev/core/kit/headers.js')).REQUEST_HEADERS, REQUEST_HEADERS);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(pkg.files.includes('kit'));
  });

  test('isCompliant: union with null accepted, variant dropped', () => {
    assert.ok(isCompliant({ type: ['string', 'null'], maxLength: 2 }, null));
    // "not-a-number" is a valid string of the union: the "wrong type" variant is dropped.
    assert.deepEqual(invalidValues({ type: ['integer', 'string'], maxLength: 20 }), []);
  });
});
