// Reading and linting of the openapi.yaml contract (OpenAPI 3.1), R11 of the "common core" research: the contract
// drives the core, a contract that is not closed by default stops the process from starting. Local `$ref`s are
// dereferenced once here: Fastify sees no schema, Ajv 2020-12 compiles these.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** @typedef {Record<string, any>} Schema */
/**
 * @typedef {object} Operation
 * @property {string} operationId
 * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @property {string} path OpenAPI path (`/api/items/{id}`)
 * @property {string} url Fastify path (`/api/items/:id`)
 * @property {string[]} roles `x-roles`
 * @property {number|null} rateLimit `x-rate-limit` (requests per minute), read in step 5
 * @property {{ params: Schema, query: Schema, body: Schema|null }} schemas
 * @property {Map<number, Schema|null>} responses 2xx status → body schema (`null` for 204)
 * @property {string[]|null} types download (`/files/…`): media types declared for the 200, otherwise `null`
 * @property {{ types: string[], maxBytes: number }|null} upload binary request body (one file): declared media types and
 *   `x-max-bytes`, otherwise `null`
 */
/** @typedef {{ operations: Operation[], paths: Map<string, string[]> }} Contract */

export class ContractError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`contract refused (${errors.length}):\n- ${errors.join('\n- ')}`);
    this.name = 'ContractError';
    this.errors = errors;
  }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const NO_BODY = new Set(['get', 'delete']);
/** Paths served by the core itself, never by the contract (§2.4 rule 1). */
export const RESERVED_PATHS = /^\/(health|auth\/|core\/)/;
/** Downloads (§2.7 rule 7, D3): `GET` only under `/files/`, 200 response in this closed list. */
export const DOWNLOAD_TYPES = new Set(['text/csv', 'application/pdf', 'application/zip', 'image/png', 'image/jpeg']);
/** Uploads (decision E5): one file as the raw request body, in this closed list, checked by its signature bytes. */
export const TYPES_UPLOAD = new Set(['application/pdf', 'image/png', 'image/jpeg']);
/** Highest `x-max-bytes` an operation may declare: a file is read whole into memory. */
export const MAX_UPLOAD_BYTES = 10 * 1_048_576;
const OPERATION_ID = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
const ROLE = /^[a-z][a-z0-9_-]{0,63}$/;
const SCALARS = new Set(['string', 'integer', 'number', 'boolean']);
/** Formats whose length is bounded by the format itself (no `maxLength` required). */
const BOUNDED_FORMATS = new Set(['uuid', 'date', 'date-time', 'time', 'ipv4', 'ipv6']);
/** Quantifier applied to a group that itself holds a quantifier, or a backreference: ReDoS. */
const DANGEROUS_PATTERN = /\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)[*+{?]|\\[1-9]/;

/** @param {string} path */
export function readContract(path) {
  return parseContract(parse(readFileSync(path, 'utf8')));
}

/**
 * Analyses an already parsed OpenAPI document; throws `ContractError` with every reason.
 * @param {any} doc
 * @returns {Contract}
 */
export function parseContract(doc) {
  /** @type {string[]} */
  const errors = [];
  const refuse = (/** @type {string} */ m) => { errors.push(m); };
  if (typeof doc?.openapi !== 'string' || !doc.openapi.startsWith('3.1.')) refuse('openapi must be 3.1.x');
  if (doc?.security !== undefined) refuse('global security forbidden: x-roles on every operation');
  const deref = dereferencer(doc, refuse);
  /** @type {Operation[]} */
  const operations = [];
  /** @type {Map<string, string[]>} */
  const paths = new Map();
  const ids = new Set();

  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    const download = path.startsWith('/files/');
    if (!path.startsWith('/api/') && !download) refuse(`${path}: every path of the contract starts with /api/ (or /files/ for a download)`);
    if (RESERVED_PATHS.test(path)) refuse(`${path}: path reserved for the core`);
    if (!/^\/[A-Za-z0-9_\-/{}.]*$/.test(path) || path.includes('//')) refuse(`${path}: path characters not allowed`);
    const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '');
    if (item?.parameters !== undefined) refuse(`${path}: declare the parameters on each operation, not on the path`);
    /** @type {string[]} */
    const methods = [];
    for (const [key, raw] of Object.entries(item ?? {})) {
      if (key === 'parameters' || key === 'summary' || key === 'description') continue;
      if (!METHODS.includes(key)) { refuse(`${path}: method ${key} not supported`); continue; }
      if (download && key !== 'get') { refuse(`${path}: GET only under /files/`); continue; }
      methods.push(key.toUpperCase());
      const where = `${key.toUpperCase()} ${path}`;
      const op = deref(raw);
      if (!OPERATION_ID.test(op.operationId ?? '')) refuse(`${where}: operationId missing or invalid`);
      else if (ids.has(op.operationId)) refuse(`${where}: operationId ${op.operationId} duplicated`);
      ids.add(op.operationId);
      if (op.security !== undefined) refuse(`${where}: security forbidden (public paths are served by the core), x-roles only`);
      const roles = op['x-roles'];
      if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => typeof r === 'string' && ROLE.test(r))) {
        refuse(`${where}: x-roles required (non-empty list of Keycloak client roles)`);
      }
      const rateLimit = op['x-rate-limit'];
      if (rateLimit !== undefined && !(Number.isInteger(rateLimit) && rateLimit >= 1)) refuse(`${where}: x-rate-limit must be an integer ≥ 1`);

      // Parameters: path and query only, bounded scalar schemas.
      /** @type {Schema} */ const pathProps = {};
      /** @type {Schema} */ const queryProps = {};
      /** @type {string[]} */ const requiredQuery = [];
      for (const p of op.parameters ?? []) {
        const name = String(p?.name);
        if (p?.in !== 'path' && p?.in !== 'query') { refuse(`${where}: parameter ${name} in=${p?.in} refused (path or query)`); continue; }
        if (!p.schema || p.content) { refuse(`${where}: parameter ${name} without schema`); continue; }
        const s = p.schema;
        const t = s.type;
        const ok = SCALARS.has(t) || (t === 'array' && SCALARS.has(s.items?.type));
        if (!ok) refuse(`${where}: parameter ${name}: scalar type or array of scalars expected`);
        checkSchema(s, `${where} parameter ${name}`, { request: true, refuse });
        if (p.in === 'path') {
          if (p.required !== true) refuse(`${where}: path parameter ${name} must be required: true`);
          if (!pathNames.includes(name)) refuse(`${where}: path parameter ${name} missing from the path`);
          pathProps[name] = s;
        } else {
          if (p.in === 'query' && t === 'array' && p.explode === false) refuse(`${where}: parameter ${name}: explode: false not supported`);
          queryProps[name] = s;
          if (p.required === true) requiredQuery.push(name);
        }
      }
      for (const name of pathNames) if (!(name in pathProps)) refuse(`${where}: path parameter ${name} not declared`);

      // Body: application/json required, closed object; or one file, raw, of the upload types, with x-max-bytes.
      /** @type {Schema|null} */ let body = null;
      /** @type {Operation['upload']} */ let upload = null;
      const maxBytes = op['x-max-bytes'];
      if (op.requestBody !== undefined) {
        if (NO_BODY.has(key)) refuse(`${where}: no body on ${key.toUpperCase()}`);
        const types = Object.keys(op.requestBody.content ?? {});
        if (op.requestBody.required !== true) refuse(`${where}: requestBody.required must be true`);
        if (types.length > 0 && types.every((t) => TYPES_UPLOAD.has(t))) {
          if (key !== 'put' && key !== 'post') refuse(`${where}: a file is uploaded by PUT or POST`);
          if (!(Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= MAX_UPLOAD_BYTES)) {
            refuse(`${where}: x-max-bytes required with a file body (integer, 1 to ${MAX_UPLOAD_BYTES})`);
          }
          upload = { types, maxBytes: Number(maxBytes) };
        } else {
          if (types.length !== 1 || types[0] !== 'application/json') {
            refuse(`${where}: requestBody in application/json only, or one file in ${[...TYPES_UPLOAD].join(', ')}`);
          }
          body = op.requestBody.content?.['application/json']?.schema ?? null;
          if (!body || body.type !== 'object') refuse(`${where}: the body is an object`);
          else checkSchema(body, `${where} body`, { request: true, refuse });
        }
      }
      if (maxBytes !== undefined && upload === null) refuse(`${where}: x-max-bytes without a file body`);

      // Responses: 2xx in closed application/json (204 without a body), 4xx/5xx/default in problem+json;
      // download: 200 only, one or more types of DOWNLOAD_TYPES, without a schema.
      /** @type {Map<number, Schema|null>} */ const responses = new Map();
      /** @type {string[]|null} */ let downloadTypes = null;
      const statuses = Object.keys(op.responses ?? {});
      if (statuses.length === 0) refuse(`${where}: responses missing`);
      for (const status of statuses) {
        const resp = op.responses[status];
        const n = Number(status);
        if (status === 'default' || (n >= 400 && n <= 599)) {
          const types = Object.keys(resp?.content ?? {});
          if (types.length !== 1 || types[0] !== 'application/problem+json') refuse(`${where}: response ${status} in application/problem+json`);
          continue;
        }
        if (!(Number.isInteger(n) && n >= 200 && n <= 299)) { refuse(`${where}: response ${status} refused (2xx, 4xx, 5xx or default)`); continue; }
        if (download) {
          const types = Object.keys(resp?.content ?? {});
          if (n !== 200 || types.length === 0 || !types.every((t) => DOWNLOAD_TYPES.has(t))) {
            refuse(`${where}: response ${status}: a download answers 200 in ${[...DOWNLOAD_TYPES].join(', ')}`);
            continue;
          }
          downloadTypes = types;
          responses.set(200, null);
          continue;
        }
        if (n === 204) {
          if (resp?.content !== undefined) refuse(`${where}: 204 without content`);
          responses.set(204, null);
          continue;
        }
        const types = Object.keys(resp?.content ?? {});
        const schema = resp?.content?.['application/json']?.schema;
        if (types.length !== 1 || types[0] !== 'application/json' || !schema) { refuse(`${where}: response ${status} in application/json with schema`); continue; }
        if (schema.type !== 'object') refuse(`${where}: response ${status}: object expected at the root (never an array)`);
        else checkSchema(schema, `${where} response ${status}`, { request: false, refuse });
        responses.set(n, schema);
      }
      if (responses.size === 0) refuse(`${where}: at least one 2xx response`);

      // Error responses the core or the request itself can produce must be declared (decision K9/E6): Schemathesis
      // and ZAP read this file as is, so a response missing here is a response outside the contract.
      const required = ['401', '403', '429'];
      if ((op.parameters ?? []).length > 0 || op.requestBody !== undefined) required.push('400');
      if (op.requestBody !== undefined) required.push('415');
      if (pathNames.length > 0) required.push('404');
      if (upload !== null) required.push('413');
      const missing = required.filter((s) => !statuses.includes(s));
      if (missing.length > 0) refuse(`${where}: declare the error responses ${missing.join(', ')} (application/problem+json)`);
      if (statuses.includes('400')) {
        const item = op.responses['400']?.content?.['application/problem+json']?.schema?.properties?.errors?.items;
        if (!item?.properties?.pointer || !item?.properties?.message) {
          refuse(`${where}: the 400 problem schema declares errors: [{ pointer, message }] (filled by VALIDATION_FAILED)`);
        }
      }

      operations.push({
        operationId: String(op.operationId),
        method: /** @type {Operation['method']} */ (key.toUpperCase()),
        path,
        url: path.replace(/\{([^}]+)\}/g, ':$1'),
        roles: Array.isArray(roles) ? roles.map(String) : [],
        rateLimit: rateLimit ?? null,
        schemas: {
          params: { type: 'object', properties: pathProps, required: Object.keys(pathProps), additionalProperties: false },
          query: { type: 'object', properties: queryProps, required: requiredQuery, additionalProperties: false },
          body,
        },
        responses,
        types: downloadTypes,
        upload,
      });
    }
    if (methods.length === 0) refuse(`${path}: no operation`);
    paths.set(path, methods);
  }
  if (operations.length === 0) refuse('no operation in paths');
  if (errors.length > 0) throw new ContractError(errors);
  return { operations, paths };
}

/**
 * Closed schema (§2.1.4): every object carries `additionalProperties: false`; in a request, every string has a
 * `maxLength` (except enum, const or bounded format), every array a `maxItems`; `pattern`s are safe.
 * @param {Schema} s
 * @param {string} where
 * @param {{ request: boolean, refuse: (m: string) => void }} o
 */
function checkSchema(s, where, o) {
  if (!s || typeof s !== 'object') return;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('object') || s.properties !== undefined) {
    if (s.additionalProperties !== false) o.refuse(`${where}: object without additionalProperties: false`);
    if (s.patternProperties !== undefined || s.unevaluatedProperties !== undefined) o.refuse(`${where}: patternProperties/unevaluatedProperties refused`);
    for (const [name, sp] of Object.entries(s.properties ?? {})) checkSchema(sp, `${where}.${name}`, o);
  }
  if (types.includes('string') && o.request) {
    const bounded = s.enum !== undefined || s.const !== undefined || BOUNDED_FORMATS.has(s.format);
    if (!bounded && !(Number.isInteger(s.maxLength) && s.maxLength >= 0)) o.refuse(`${where}: string without maxLength`);
  }
  // An unbounded number reaches PostgreSQL and overflows bigint or numeric columns (a 500, found by Schemathesis).
  if ((types.includes('integer') || types.includes('number')) && o.request && s.enum === undefined && s.const === undefined) {
    const bounded = (/** @type {unknown} */ v) => typeof v === 'number' && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
    if (!bounded(s.minimum) || !bounded(s.maximum)) o.refuse(`${where}: number without minimum and maximum (within ±${Number.MAX_SAFE_INTEGER})`);
  }
  if (typeof s.pattern === 'string' && DANGEROUS_PATTERN.test(s.pattern)) o.refuse(`${where}: pattern with nested quantifiers or a backreference`);
  if (types.includes('array')) {
    if (o.request && !(Number.isInteger(s.maxItems) && s.maxItems >= 0)) o.refuse(`${where}: array without maxItems`);
    if (s.items) checkSchema(s.items, `${where}[]`, o);
    for (const [i, si] of (s.prefixItems ?? []).entries()) checkSchema(si, `${where}[${i}]`, o);
  }
  for (const word of ['allOf', 'anyOf', 'oneOf']) for (const [i, si] of (s[word] ?? []).entries()) checkSchema(si, `${where}.${word}[${i}]`, o);
  if (s.not) checkSchema(s.not, `${where}.not`, o);
}

/**
 * Dereferencing of local `$ref`s (`#/components/...`): external, not found or cyclic → refusal.
 * @param {any} doc
 * @param {(m: string) => void} refuse
 */
function dereferencer(doc, refuse) {
  /** @param {any} node @param {string[]} stack @returns {any} */
  const resolveNode = (node, stack) => {
    if (Array.isArray(node)) return node.map((n) => resolveNode(n, stack));
    if (node === null || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (!ref.startsWith('#/')) { refuse(`external $ref refused: ${ref}`); return {}; }
      if (stack.includes(ref)) { refuse(`cyclic $ref refused: ${ref}`); return {}; }
      const target = ref.slice(2).split('/').map((/** @type {string} */ s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
        .reduce((/** @type {any} */ o, /** @type {string} */ k) => (o !== null && typeof o === 'object' ? o[k] : undefined), doc);
      if (target === undefined) { refuse(`$ref not found: ${ref}`); return {}; }
      return resolveNode(target, [...stack, ref]);
    }
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveNode(v, stack);
    return out;
  };
  return (/** @type {any} */ n) => resolveNode(n, []);
}
