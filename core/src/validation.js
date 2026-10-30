// Ajv 2020-12 of the core (§2.1.4 "common settings"): strict, allErrors:false ("Do NOT use allErrors in
// production"), removeAdditional:false (an unknown key = 400, never removed), useDefaults, ajv-formats.
// Two instances: type coercion for the path and the query string (everything there is text), none for the body
// and the responses. The schemas come from the contract only (Ajv compiles with `new Function()`).
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

/** OpenAPI 3.1 keywords tolerated in a schema (annotations, no effect on validation). */
const OAS_KEYWORDS = ['example', 'xml', 'externalDocs', 'discriminator'];
/** RFC 9562 text form only: ajv-formats also takes `urn:uuid:…`, which PostgreSQL's `uuid` refuses (a 500, INJ-3). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Invisible characters: controls (`\p{Cc}`) except tab and line feed, and format characters (`\p{Cf}`: bidi
 * overrides, zero-width…), which make a text display something else than what it holds (INJ-5).
 */
const INVISIBLE_CHARS = /[\p{Cf}\0-\x08\x0B-\x1F\x7F-\x9F]/gu;

/** The core's one free-text normaliser: request strings (below) and the IdP display name (auth.js). @param {string} text */
export const cleanText = (text) => text.replace(INVISIBLE_CHARS, '');

/** @param {boolean} coerce */
function instance(coerce) {
  const ajv = new Ajv2020({
    strict: true, allErrors: false, removeAdditional: false, useDefaults: true,
    coerceTypes: coerce ? 'array' : false, allowUnionTypes: true,
  });
  /** @type {(a: Ajv2020) => unknown} */ (/** @type {any} */ (ajvFormats).default ?? ajvFormats)(ajv);
  ajv.addFormat('uuid', UUID);
  for (const word of OAS_KEYWORDS) ajv.addKeyword({ keyword: word });
  return ajv;
}

export const ajvRequest = instance(true);
export const ajvBody = instance(false);

const NUL = 'must not contain the NUL character (U+0000)';

/**
 * First value the schema accepted that the database cannot take, or null: a string (value or key) holding U+0000
 * (PostgreSQL `text` cannot store it; found by Schemathesis, step 8), or a number that query coercion made infinite
 * (`Infinity`, `1e309`: INJ-4). Without this check such a request reaches the database and ends in a 500.
 * @param {unknown} v @param {string} path
 * @returns {import('./errors.js').ErrorDetail | null}
 */
function dbDeviation(v, path) {
  if (typeof v === 'string') return v.includes('\u0000') ? { pointer: path, message: NUL } : null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : { pointer: path, message: 'must be a finite number' };
  if (v === null || typeof v !== 'object') return null;
  for (const [k, x] of Object.entries(v)) {
    const here = `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (k.includes('\u0000')) return { pointer: here, message: NUL };
    const found = dbDeviation(x, here);
    if (found !== null) return found;
  }
  return null;
}

/** Strips invisible characters from every string value inside `v`, in place; true if one changed. @param {unknown} v @returns {boolean} */
function cleanInPlace(v) {
  if (v === null || typeof v !== 'object') return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  let changed = false;
  for (const [k, x] of Object.entries(o)) {
    if (typeof x !== 'string') changed = cleanInPlace(x) || changed;
    else if (cleanText(x) !== x) { o[k] = cleanText(x); changed = true; }
  }
  return changed;
}

/**
 * Compiles a schema and returns a function that validates `data` and returns the list of errors (empty if valid)
 * in the RFC 9457 `{ pointer, message }` format. With `clean` (query string and body), strings lose their invisible
 * characters in place and are validated again: a text of invisible characters only is then refused like an empty one.
 * @param {Ajv2020} ajv
 * @param {object} schema
 * @param {boolean} [clean]
 * @returns {(data: unknown) => import('./errors.js').ErrorDetail[]}
 */
export function compile(ajv, schema, clean = false) {
  const validate = ajv.compile(schema);
  const errors = () => (validate.errors ?? []).map((e) => ({
    pointer: e.instancePath,
    message: e.keyword === 'additionalProperties'
      ? `unexpected property "${String(e.params.additionalProperty)}"`
      : (e.message ?? e.keyword),
  }));
  // Ajv first: the walks are recursive and only see data the schema accepted, so their depth is bounded by the
  // contract (a body of 50 000 nested arrays overflowed the stack: a 500 instead of a 400).
  return (data) => {
    if (!validate(data)) return errors();
    const deviation = dbDeviation(data, '');
    if (deviation !== null) return [deviation];
    return clean && cleanInPlace(data) && !validate(data) ? errors() : [];
  };
}
