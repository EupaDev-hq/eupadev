// Security test kit of the tools (§2.10 of the "common core" research): reading the contract, static headers,
// valid and invalid data drawn from the schemas, sign-in through the Keycloak form. The SEC-* checks are in
// `sec.js`, the two-user helpers (Playwright) in `two-users.js`.
// The oracle is independent of the code under test: Ajv is instantiated here, never imported from `src/`.
import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

export { readContract } from '../src/contract.js';
export { httpBrowser } from './http-browser.js';
export { REQUEST_HEADERS } from './headers.js';

/** @typedef {Record<string, any>} Schema */

/** @param {boolean} text */
function ajv(text) {
  const a = new Ajv2020({ strict: false, allErrors: false, coerceTypes: text ? 'array' : false, allowUnionTypes: true });
  /** @type {(a: Ajv2020) => unknown} */ (/** @type {any} */ (ajvFormats).default ?? ajvFormats)(a);
  // A uuid is what PostgreSQL's `uuid` reads: ajv-formats' `urn:uuid:` prefix is not (INJ-3).
  a.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return a;
}
const AJV = { text: ajv(true), json: ajv(false) };

/**
 * Does the value match the schema? `text`: path and query string (everything arrives there as text).
 * @param {Schema} schema @param {unknown} value @param {boolean} [text]
 */
export function isCompliant(schema, value, text = false) {
  return (text ? AJV.text : AJV.json).validate(schema, structuredClone(value)) === true;
}

/** @param {Schema} s */
const typeOf = (s) => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) ?? (s.properties ? 'object' : undefined);

/**
 * Minimal valid value: the contract's `example`/`examples` if any, otherwise `const`, the first `enum` value,
 * `default`, then by type (object: required properties only). The `pattern` is not solved:
 * `compliantExample` says when the contract needs an `example`.
 * @param {Schema} s @returns {unknown}
 */
export function example(s) {
  if (s.example !== undefined) return structuredClone(s.example);
  if (Array.isArray(s.examples) && s.examples.length > 0) return structuredClone(s.examples[0]);
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.default !== undefined) return structuredClone(s.default);
  switch (typeOf(s)) {
    case 'object': {
      /** @type {Record<string, unknown>} */ const o = {};
      for (const name of s.required ?? []) o[name] = example(s.properties?.[name] ?? {});
      return o;
    }
    case 'array': return Array.from({ length: s.minItems ?? 0 }, () => example(s.items ?? {}));
    case 'integer':
    case 'number': {
      const min = s.minimum ?? (s.exclusiveMinimum === undefined ? undefined : s.exclusiveMinimum + 1);
      if (min !== undefined) return min;
      return s.maximum !== undefined && s.maximum < 1 ? s.maximum : 1;
    }
    case 'boolean': return true;
    case 'string': {
      const byFormat = { uuid: randomUUID(), date: '2026-01-01', 'date-time': '2026-01-01T00:00:00Z', time: '00:00:00Z', email: 'kit@example.test', uri: 'https://example.test/', ipv4: '192.0.2.1', ipv6: '2001:db8::1' };
      if (s.format in byFormat) return byFormat[/** @type {keyof typeof byFormat} */ (s.format)];
      return 'a'.repeat(Math.min(Math.max(s.minLength ?? 1, 1), s.maxLength ?? Infinity));
    }
    default: return null;
  }
}

/**
 * `example(s)` checked: throws if the schema asks for more than the generator can do (never a false green).
 * @param {Schema} s @param {string} where @param {boolean} [text]
 */
export function compliantExample(s, where, text = false) {
  const v = example(s);
  if (!isCompliant(s, v, text)) throw new Error(`${where}: the kit cannot produce a valid value (${JSON.stringify(v)}): add \`example\` to the contract's schema`);
  return v;
}

/**
 * Invalid variants of a schema, each breaking only one constraint of an otherwise valid value: wrong type,
 * outside `enum`, required property missing, length, bounds, number of items, format. Recursive over objects and
 * arrays. Variants the schema would accept anyway (type unions…) are dropped by Ajv.
 * @param {Schema} s @param {boolean} [text] path or query: a string has no "wrong type" there
 * @returns {{ what: string, value: unknown }[]}
 */
export function invalidValues(s, text = false) {
  /** @type {{ what: string, value: unknown }[]} */
  const v = [];
  const t = typeOf(s);
  const bad = { string: 12345, integer: 'not-a-number', number: 'not-a-number', boolean: 'not-a-boolean', object: text ? undefined : 'not-an-object', array: text ? undefined : 'not-an-array' };
  if (t !== undefined && !(text && t === 'string') && bad[/** @type {keyof typeof bad} */ (t)] !== undefined) v.push({ what: `expected type ${t}`, value: bad[/** @type {keyof typeof bad} */ (t)] });
  if (Array.isArray(s.enum)) v.push({ what: 'outside enum', value: typeof s.enum[0] === 'number' ? -987654 : 'outside-enum-kit' });
  if (t === 'string' && s.enum === undefined) {
    if (Number.isInteger(s.maxLength)) v.push({ what: `more than ${s.maxLength} characters`, value: 'a'.repeat(s.maxLength + 1) });
    if ((s.minLength ?? 0) > 0) v.push({ what: `fewer than ${s.minLength} characters`, value: 'a'.repeat(s.minLength - 1) });
    if (s.format !== undefined) v.push({ what: `format ${s.format}`, value: 'not-kit-format' });
    if (s.format === 'uuid') v.push({ what: 'format uuid (urn:uuid:)', value: `urn:uuid:${randomUUID()}` });
  }
  if (t === 'integer' || t === 'number') {
    if (s.minimum !== undefined) v.push({ what: `below the minimum ${s.minimum}`, value: s.minimum - 1 });
    if (s.maximum !== undefined) v.push({ what: `above the maximum ${s.maximum}`, value: s.maximum + 1 });
  }
  if (t === 'array') {
    const item = example(s.items ?? {});
    if (Number.isInteger(s.maxItems)) v.push({ what: `more than ${s.maxItems} items`, value: Array.from({ length: s.maxItems + 1 }, () => structuredClone(item)) });
    for (const i of invalidValues(s.items ?? {}, text)) v.push({ what: `item: ${i.what}`, value: [i.value] });
  }
  if (t === 'object') {
    const base = /** @type {Record<string, unknown>} */ (example(s));
    for (const name of s.required ?? []) {
      const { [name]: _removed, ...without } = base;
      v.push({ what: `${name} missing`, value: without });
    }
    for (const [name, sp] of Object.entries(/** @type {Record<string, Schema>} */ (s.properties ?? {}))) {
      for (const i of invalidValues(sp, text)) v.push({ what: `${name}: ${i.what}`, value: { ...base, [name]: i.value } });
    }
  }
  return v.filter((i) => !isCompliant(s, i.value, text));
}

/** @typedef {{ name: string, password: string, roles: string[] }} Person */

/**
 * Signs in like a browser: `/auth/login` → Keycloak (form, unless an SSO session is already open) → callback →
 * `next`. Returns every step (the core's `Set-Cookie` headers can be read there: SEC-COOKIE).
 * @param {ReturnType<typeof import('./http-browser.js').httpBrowser>} client
 * @param {string} base origin of the tool
 * @param {{ name: string, password: string }} person
 * @param {string} [next]
 */
export async function signIn(client, base, person, next) {
  const steps = await client.go(`${base}/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  const last = /** @type {import('./http-browser.js').Step} */ (steps[steps.length - 1]);
  if (last.status !== 200 || !last.text.includes('kc-form-login')) return steps;
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(last.text)?.[1]?.replaceAll('&amp;', '&');
  if (!action) throw new Error(`Keycloak form not found on ${last.url}`);
  const rest = await client.go(action, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: person.name, password: person.password, credentialId: '' }).toString(),
  });
  return [...steps, ...rest];
}
