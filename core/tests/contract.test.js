// Contract linter (R11): the example passes; each rule refuses a trapped contract; start refused.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import { parse } from 'yaml';
import { connection } from '../bin/migrate.js';
import { ContractError, parseContract, loadHandlers, dbConfigFromEnv, start } from '../src/index.js';
import { EXAMPLE } from './helpers/server.js';

const text = readFileSync(`${EXAMPLE}openapi.yaml`, 'utf8');
/** @param {(doc: any) => void} [mutation] */
const doc = (mutation) => { const d = parse(text); mutation?.(d); return d; };
/** @param {(doc: any) => void} mutation @param {RegExp} pattern */
function refuse(mutation, pattern) {
  assert.throws(() => parseContract(doc(mutation)), (e) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.ok(e.errors.some((m) => pattern.test(m)), `expected ${pattern}, got:\n${e.errors.join('\n')}`);
    return true;
  });
}

describe('the example contract', () => {
  test('passes and gives the route table', () => {
    const c = parseContract(doc());
    assert.deepEqual(c.operations.map((o) => `${o.method} ${o.url} ${o.operationId}`), [
      'GET /api/items listItems', 'POST /api/items createItem', 'GET /api/items/:id getItem', 'DELETE /api/items/:id deleteItem',
      'PUT /api/items/:id/attachment putItemAttachment', 'GET /files/items/:id/attachment getItemAttachment', 'GET /files/items.csv exportItems',
    ]);
    assert.deepEqual([...c.paths], [['/api/items', ['GET', 'POST']], ['/api/items/{id}', ['GET', 'DELETE']], ['/api/items/{id}/attachment', ['PUT']],
      ['/files/items/{id}/attachment', ['GET']], ['/files/items.csv', ['GET']]]);
    assert.deepEqual(c.operations.map((o) => o.types), [null, null, null, null, null, ['image/png', 'application/pdf'], ['text/csv']]);
    assert.deepEqual(c.operations.map((o) => o.upload), [null, null, null, null, { types: ['image/png', 'application/pdf'], maxBytes: 1024 }, null, null]);
    assert.equal(c.operations[4]?.schemas.body, null);
    assert.deepEqual([...(c.operations[6]?.responses ?? [])], [[200, null]]);
    const post = c.operations[1];
    assert.deepEqual(post?.roles, ['manager']);
    assert.equal(post?.rateLimit, 10);
    assert.equal(post?.schemas.body?.properties.name.maxLength, 80, '$ref dereferenced');
    assert.deepEqual([...(c.operations[3]?.responses ?? [])], [[204, null]]);
    assert.equal(c.operations[0]?.responses.get(200)?.properties.items.items.properties.id.format, 'uuid', 'nested $ref dereferenced');
  });
});

describe('the linter refuses', () => {
  test('version, security, paths', () => {
    refuse((d) => { d.openapi = '3.0.3'; }, /3\.1\.x/);
    refuse((d) => { d.security = []; }, /global security/);
    refuse((d) => { d.paths['/api/items'].get.security = []; }, /security forbidden/);
    refuse((d) => { d.paths['/items'] = d.paths['/api/items']; delete d.paths['/api/items']; }, /starts with \/api\//);
    refuse((d) => { d.paths['/api/health'] = d.paths['/api/items']; }, /starts with|reserved|duplicated/);
    refuse((d) => { d.paths['/health'] = d.paths['/api/items']; }, /reserved/);
    refuse((d) => { d.paths['/api/items'].parameters = []; }, /on each operation/);
    refuse((d) => { d.paths['/api/items'].options = d.paths['/api/items'].get; }, /method options/);
    refuse((d) => { d.paths = {}; }, /no operation/);
  });
  test('operationId and x-roles', () => {
    refuse((d) => { delete d.paths['/api/items'].get.operationId; }, /operationId missing/);
    refuse((d) => { d.paths['/api/items'].get.operationId = 'list-items'; }, /operationId missing or invalid/);
    refuse((d) => { d.paths['/api/items'].get.operationId = 'createItem'; }, /duplicated/);
    refuse((d) => { delete d.paths['/api/items'].get['x-roles']; }, /x-roles required/);
    refuse((d) => { d.paths['/api/items'].get['x-roles'] = []; }, /x-roles required/);
    refuse((d) => { d.paths['/api/items'].get['x-roles'] = ['Admin Role']; }, /x-roles required/);
    refuse((d) => { d.paths['/api/items'].post['x-rate-limit'] = 0; }, /x-rate-limit/);
  });
  test('parameters', () => {
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'x', in: 'header', schema: { type: 'string', maxLength: 1 } }); }, /in=header/);
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'x', in: 'cookie', schema: { type: 'string', maxLength: 1 } }); }, /in=cookie/);
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'q', in: 'query', schema: { type: 'string' } }); }, /string without maxLength/);
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'q', in: 'query', schema: { type: 'object', additionalProperties: false } }); }, /scalar/);
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'q', in: 'query', schema: { type: 'array', items: { type: 'string', maxLength: 3 } } }); }, /array without maxItems/);
    refuse((d) => { d.paths['/api/items'].get.parameters.push({ name: 'q', in: 'query', content: { 'application/json': {} } }); }, /without schema/);
    refuse((d) => { d.paths['/api/items/{id}'].get.parameters[0].required = false; }, /required: true/);
    refuse((d) => { d.paths['/api/items/{id}'].get.parameters = []; }, /not declared/);
    refuse((d) => { d.paths['/api/items/{id}'].get.parameters.push({ name: 'other', in: 'path', required: true, schema: { type: 'string', maxLength: 5 } }); }, /missing from the path/);
  });
  test('body', () => {
    refuse((d) => { d.paths['/api/items'].post.requestBody.required = false; }, /required must be true/);
    refuse((d) => { d.paths['/api/items'].post.requestBody.content = { 'text/plain': { schema: { type: 'string', maxLength: 5 } } }; }, /application\/json only/);
    refuse((d) => { d.paths['/api/items'].post.requestBody.content['application/json'].schema = { type: 'array', maxItems: 1, items: { type: 'string', maxLength: 1 } }; }, /body is an object/);
    refuse((d) => { d.paths['/api/items'].get.requestBody = d.paths['/api/items'].post.requestBody; }, /no body on GET/);
    refuse((d) => { delete d.components.schemas.NewItem.additionalProperties; }, /without additionalProperties: false/);
    refuse((d) => { d.components.schemas.NewItem.properties.note = { type: 'object', properties: { a: { type: 'string', maxLength: 1 } } }; }, /note: object without additionalProperties/);
    refuse((d) => { delete d.components.schemas.NewItem.properties.name.maxLength; }, /name: string without maxLength/);
    refuse((d) => { d.components.schemas.NewItem.properties.tags = { type: 'array', items: { type: 'string', maxLength: 1 } }; }, /tags: array without maxItems/);
    refuse((d) => { d.components.schemas.NewItem.properties.name.pattern = '^(a+)+$'; }, /pattern/);
    refuse((d) => { d.components.schemas.NewItem.properties.name.pattern = '^(a)\\1$'; }, /pattern/);
    refuse((d) => { d.components.schemas.NewItem.patternProperties = {}; }, /patternProperties/);
  });
  test('responses', () => {
    refuse((d) => { d.paths['/api/items'].get.responses['400'] = { description: 'x', content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }; }, /400 in application\/problem\+json/);
    refuse((d) => { d.paths['/api/items'].get.responses.default = { description: 'x' }; }, /default in application\/problem\+json/);
    refuse((d) => { d.paths['/api/items'].get.responses['200'].content = { 'text/csv': { schema: { type: 'string' } } }; }, /200 in application\/json/);
    refuse((d) => { d.paths['/api/items'].get.responses['200'].content['application/json'].schema = { type: 'array', items: { type: 'string' } }; }, /object expected at the root/);
    refuse((d) => { delete d.components.schemas.Item.additionalProperties; }, /response 200.*without additionalProperties/);
    refuse((d) => { d.paths['/api/items/{id}'].delete.responses['204'].content = {}; }, /204 without content/);
    refuse((d) => { d.paths['/api/items'].get.responses['302'] = { description: 'x' }; }, /302 refused/);
    refuse((d) => { d.paths['/api/items'].get.responses = { '404': { $ref: '#/components/responses/Problem' } }; }, /at least one 2xx response/);
    refuse((d) => { delete d.paths['/api/items'].get.responses; }, /responses missing/);
  });
  test('error responses the core produces must be declared (K9), with errors on the 400 problem', () => {
    for (const s of ['401', '403', '429']) refuse((d) => { delete d.paths['/api/items'].get.responses[s]; }, new RegExp(`GET /api/items: declare the error responses ${s}\\b`));
    refuse((d) => { delete d.paths['/api/items'].get.responses['400']; }, /GET \/api\/items: declare the error responses 400/);
    refuse((d) => { delete d.paths['/api/items'].post.responses['415']; }, /POST \/api\/items: declare the error responses 415/);
    refuse((d) => { delete d.paths['/api/items/{id}'].get.responses['404']; }, /GET \/api\/items\/\{id\}: declare the error responses 404/);
    refuse((d) => { delete d.components.schemas.Problem.properties.errors; }, /400 problem schema declares errors/);
    // A number in a request is bounded on both sides, within the safe-integer range; enum and responses are exempt.
    refuse((d) => { delete d.paths['/api/items'].get.parameters[0].schema.maximum; }, /parameter limit: number without minimum and maximum/);
    refuse((d) => { d.paths['/api/items'].get.parameters[0].schema.maximum = 2 ** 60; }, /number without minimum and maximum/);
    refuse((d) => { d.components.schemas.NewItem.properties.rank = { type: 'number', minimum: 0 }; }, /body\.rank: number without minimum and maximum/);
    assert.doesNotThrow(() => parseContract(doc((d) => { d.components.schemas.Item.properties.rank = { type: 'integer' }; d.components.schemas.Item.required = ['id', 'name', 'status']; })));
    // Nothing to validate in the request, no 400 to declare.
    assert.doesNotThrow(() => parseContract(doc((d) => { delete d.paths['/api/items'].get.parameters; delete d.paths['/api/items'].get.responses['400']; })));
  });
  test('downloads (/files/): GET only, 200 only, types of the closed list', () => {
    const csv = (/** @type {any} */ d) => d.paths['/files/items.csv'];
    refuse((d) => { csv(d).post = d.paths['/api/items'].post; }, /GET only under \/files\//);
    refuse((d) => { csv(d).delete = d.paths['/api/items/{id}'].delete; }, /GET only under \/files\//);
    refuse((d) => { csv(d).get.responses['200'].content = { 'application/json': { schema: { type: 'object', additionalProperties: false } } }; }, /download answers 200 in text\/csv/);
    refuse((d) => { csv(d).get.responses['200'].content = { 'image/svg+xml': {} }; }, /download answers 200/);
    refuse((d) => { csv(d).get.responses['200'].content = { 'text/csv': {}, 'text/html': {} }; }, /download answers 200/);
    refuse((d) => { csv(d).get.responses['200'].content = {}; }, /download answers 200/);
    refuse((d) => { csv(d).get.responses['204'] = { description: 'x' }; }, /response 204: a download/);
    refuse((d) => { delete csv(d).get['x-roles']; }, /x-roles required/);
    refuse((d) => { d.paths['/files'] = csv(d); delete d.paths['/files/items.csv']; }, /starts with \/api\//);
    assert.deepEqual(parseContract(doc((d) => { csv(d).get.responses['200'].content = { 'application/pdf': {}, 'application/zip': {} }; })).operations[6]?.types, ['application/pdf', 'application/zip']);
  });
  test('file body (upload): closed list of types, x-max-bytes, PUT or POST, 413 declared', () => {
    const put = (/** @type {any} */ d) => d.paths['/api/items/{id}/attachment'].put;
    refuse((d) => { delete put(d)['x-max-bytes']; }, /x-max-bytes required with a file body/);
    refuse((d) => { put(d)['x-max-bytes'] = 10 * 1_048_576 + 1; }, /x-max-bytes required with a file body/);
    refuse((d) => { put(d)['x-max-bytes'] = 1.5; }, /x-max-bytes required/);
    refuse((d) => { d.paths['/api/items'].post['x-max-bytes'] = 1024; }, /POST \/api\/items: x-max-bytes without a file body/);
    refuse((d) => { put(d).requestBody.content['image/svg+xml'] = {}; }, /application\/json only, or one file in application\/pdf, image\/png, image\/jpeg/);
    refuse((d) => { put(d).requestBody.content['application/json'] = { schema: { type: 'object', additionalProperties: false } }; }, /application\/json only, or one file/);
    refuse((d) => { d.paths['/api/items/{id}/attachment'].patch = put(d); delete d.paths['/api/items/{id}/attachment'].put; }, /a file is uploaded by PUT or POST/);
    refuse((d) => { delete put(d).responses['413']; }, /PUT \/api\/items\/\{id\}\/attachment: declare the error responses 413/);
    assert.deepEqual(parseContract(doc((d) => { put(d).requestBody.content = { 'image/jpeg': {} }; })).operations[4]?.upload, { types: ['image/jpeg'], maxBytes: 1024 });
  });
  test('external, missing, cyclic $ref', () => {
    refuse((d) => { d.components.schemas.NewItem.properties.p = { $ref: 'other.yaml#/X' }; }, /external \$ref/);
    refuse((d) => { d.components.schemas.NewItem.properties.p = { $ref: '#/components/schemas/Missing' }; }, /\$ref not found/);
    refuse((d) => { d.components.schemas.NewItem.properties.p = { $ref: '#/components/schemas/NewItem' }; }, /cyclic \$ref/);
  });
  test('a single pass returns every error', () => {
    try {
      parseContract(doc((d) => { delete d.paths['/api/items'].get['x-roles']; delete d.paths['/api/items'].post.operationId; }));
      assert.fail('should have refused');
    } catch (e) {
      assert.ok(e instanceof ContractError);
      assert.equal(e.errors.length, 2);
    }
  });
});

describe('handlers and start', () => {
  // Copies next to the example (same depth: the handlers import ../../../src/index.js), removed afterwards.
  /** @type {string[]} */
  const copies = [];
  after(() => { for (const c of copies) rmSync(c, { recursive: true, force: true }); });
  /** @param {(dir: string) => void} [prepare] */
  const tool = (prepare) => {
    const dir = mkdtempSync(fileURLToPath(new URL('./tmp-', import.meta.url)));
    copies.push(dir);
    cpSync(EXAMPLE, dir, { recursive: true });
    prepare?.(dir);
    return dir;
  };
  test('an api/ file without an operation, an operation without a file, an export that is not a function', async () => {
    const c = parseContract(doc());
    await assert.rejects(loadHandlers(join(tool((d) => writeFileSync(join(d, 'api/orphan.js'), 'export default async () => ({ status: 200 })')), 'api'), c), /orphan\.js: no operation/);
    await assert.rejects(loadHandlers(join(tool((d) => writeFileSync(join(d, 'api/getItem.js'), 'export const x = 1;')), 'api'), c), /getItem\.js: default export/);
    await assert.rejects(loadHandlers(join(tool(), 'api', 'lib'), c), /listItems\.js missing/);
  });
  test('start refuses an invalid contract and a missing handler, without touching the database or the port', async () => {
    await assert.rejects(start({ root: tool((d) => writeFileSync(join(d, 'openapi.yaml'), text.replace('x-roles: [manager]\n      x-rate-limit', 'x-rate-limit'))), env: { LOG_LEVEL: 'silent' } }), /x-roles required/);
    await assert.rejects(start({ root: tool((d) => { mkdirSync(join(d, 'api2')); writeFileSync(join(d, 'api/getItem.js'), 'export default 1;'); }), env: { LOG_LEVEL: 'silent' } }), /default export/);
    assert.equal(await start({ root: tool(), env: {}, verifyOnly: true }), null);
    await assert.rejects(start({ root: tool(), env: { LOG_LEVEL: 'silent' } }), /APP_URL missing/);
    const oidc = { APP_URL: 'https://tool.example', OIDC_ISSUER: 'https://auth.example/realms/tools', OIDC_CLIENT_ID: 'tool', OIDC_CLIENT_SECRET: 'x' };
    await assert.rejects(start({ root: tool(), env: { LOG_LEVEL: 'silent', ...oidc } }), /DATABASE_URL/);
  });
});

describe('bin/migrate.js: connection read from the environment', () => {
  test('URL file and CA file give verified TLS; DATABASE_TLS=off gives none; a URL string passes as is', () => {
    const d = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.migrate-'));
    try {
      writeFileSync(join(d, 'url'), 'postgres://o:p@db.internal:5432/tool\n');
      writeFileSync(join(d, 'ca.pem'), 'CA');
      const env = { DATABASE_URL_FILE: join(d, 'url'), DATABASE_CA_FILE: join(d, 'ca.pem') };
      assert.deepEqual(connection(dbConfigFromEnv(env)),
        { connectionString: 'postgres://o:p@db.internal:5432/tool', ssl: { ca: 'CA', rejectUnauthorized: true, servername: 'db.internal' } });
      assert.equal(/** @type {any} */ (connection(dbConfigFromEnv({ ...env, DATABASE_TLS_SERVERNAME: 'pg.internal' }))).ssl.servername, 'pg.internal');
      assert.deepEqual(connection(dbConfigFromEnv({ DATABASE_URL_FILE: env.DATABASE_URL_FILE, DATABASE_TLS: 'off' })),
        { connectionString: 'postgres://o:p@db.internal:5432/tool', ssl: false });
      assert.throws(() => dbConfigFromEnv({ DATABASE_URL_FILE: env.DATABASE_URL_FILE }), /DATABASE_CA_FILE missing/);
      assert.equal(connection('postgres://x@h/b'), 'postgres://x@h/b');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
