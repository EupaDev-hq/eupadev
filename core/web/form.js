// Forms bound to an operation of the contract: native HTML constraints set from the body schema (the browser
// validates and explains, `reportValidity()`), values typed by the schema, button disabled from the first click to
// the response (a double click never sends two requests), state announced (`aria-live`). The server stays the real
// guard (Ajv): a 400 error comes back on the faulty field through `setCustomValidity`.
import { ApiError, api, errorMessage } from './api.js';
import { t } from './i18n.js';

/** @typedef {Record<string, any>} Schema */

/** Main JSON type of a property (`['string', 'null']` → `string`). @param {Schema} p */
const typeOf = (p) => (Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type);

/**
 * HTML constraint attributes for a property of the schema. Pure.
 * @param {Schema} p
 * @param {boolean} required
 * @returns {Record<string, string>}
 */
export function constraints(p, required) {
  /** @type {Record<string, string>} */
  const a = {};
  if (required) a.required = '';
  const type = typeOf(p);
  if (type === 'integer' || type === 'number') {
    if (p.minimum !== undefined) a.min = String(p.minimum);
    if (p.maximum !== undefined) a.max = String(p.maximum);
    a.step = type === 'integer' ? '1' : 'any';
  }
  if (type === 'string') {
    if (p.maxLength !== undefined) a.maxlength = String(p.maxLength);
    if (p.minLength !== undefined) a.minlength = String(p.minLength);
    if (typeof p.pattern === 'string') a.pattern = p.pattern; // HTML anchors it itself: ^(?:…)$
  }
  return a;
}

/**
 * Value an emptied field sends, if its schema accepts one: `null` for a nullable property, `''` for a string that
 * allows it (so an optional text can be cleared), otherwise none (`undefined`: the property stays absent).
 * @param {Schema} p
 * @returns {null | '' | undefined}
 */
function emptyValue(p) {
  const types = [p.type].flat();
  const allowed = (/** @type {unknown} */ v) => !Array.isArray(p.enum) || p.enum.includes(v);
  if (types.includes('null') && allowed(null)) return null;
  if (types.includes('string') && !(p.minLength > 0) && allowed('') && (typeof p.pattern !== 'string' || new RegExp(p.pattern, 'u').test(''))) return '';
  return undefined;
}

/**
 * JSON body from the fields of a form: a field outside the schema is ignored, numbers and booleans converted; an
 * empty field sends the empty value its schema accepts (`emptyValue`), otherwise it is absent; an unchecked required
 * boolean is `false`. Pure.
 * @param {Schema} schema object schema of the body
 * @param {Iterable<[string, FormDataEntryValue]>} entries `new FormData(form).entries()`
 * @returns {Record<string, unknown>}
 */
export function values(schema, entries) {
  /** @type {Record<string, Schema>} */
  const props = schema.properties ?? {};
  /** @type {Record<string, unknown>} */
  const body = {};
  for (const [name, raw] of entries) {
    if (!Object.hasOwn(props, name) || typeof raw !== 'string') continue; // `__proto__`, `constructor`: outside the schema
    const p = /** @type {Schema} */ (props[name]);
    const v = raw.trim();
    if (v === '') {
      const empty = emptyValue(p);
      if (empty !== undefined) body[name] = empty;
      continue;
    }
    const type = typeOf(p);
    if (type === 'integer' || type === 'number') body[name] = Number(v);
    else if (type === 'boolean') body[name] = v === 'true' || v === 'on';
    else body[name] = v;
  }
  for (const name of /** @type {string[]} */ (schema.required ?? [])) {
    if (typeOf(props[name] ?? {}) === 'boolean' && !(name in body)) body[name] = false;
  }
  return body;
}

/**
 * @param {HTMLFormElement} form one control per property of the body, named like it (`name="…"`)
 * @param {string} operationId operation of the contract with a request body
 * @param {{ params?: Record<string, unknown>, after?: (result: any) => void | Promise<void>, state?: Element | null }} [o]
 *   `params`: path parameters; `after`: called with the response; `state`: message area
 *   (default: the form's `[data-state]`, `aria-live="polite"` recommended)
 */
export async function bindForm(form, operationId, o = {}) {
  const op = (await api.contract())[operationId];
  const schema = op?.body;
  if (!schema) throw new Error(`${operationId}: no request body in the contract`);
  const required = new Set(/** @type {string[]} */ (schema.required ?? []));
  /** @type {Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>} */
  const fields = new Map();
  for (const [name, p] of Object.entries(/** @type {Record<string, Schema>} */ (schema.properties ?? {}))) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) continue;
    fields.set(name, field);
    for (const [a, v] of Object.entries(constraints(p, required.has(name)))) field.setAttribute(a, v);
    field.addEventListener('input', () => field.setCustomValidity(''));
  }
  const button = form.querySelector('button:not([type]), button[type="submit"], input[type="submit"]');
  const area = o.state === undefined ? form.querySelector('[data-state]') : o.state;
  /** @param {'in-progress' | 'success' | 'error' | ''} state @param {string} text */
  const announce = (state, text) => {
    if (!area) return;
    area.setAttribute('data-state', state);
    area.textContent = text;
  };
  let busy = false;

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) button.disabled = true;
    announce('in-progress', t('form.sending'));
    (async () => {
      try {
        const result = await api.call(operationId, { params: o.params ?? {}, body: values(schema, new FormData(form).entries()) });
        announce('success', t('form.saved'));
        form.reset();
        await o.after?.(result);
      } catch (e) {
        announce('error', errorMessage(e));
        if (e instanceof ApiError) {
          for (const { pointer, message } of e.errors) {
            const field = fields.get(pointer.replace(/^\/body\//, ''));
            if (field) { field.setCustomValidity(message); field.reportValidity(); break; }
          }
        }
      } finally {
        busy = false;
        if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) button.disabled = false;
      }
    })();
  });
}
