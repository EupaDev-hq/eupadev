// DOM rendering of the core: `textContent` by default (`clone`, `fill`, `list`), and a single door to `innerHTML`
// (`render`), which accepts only the result of the `html` template (escaped values) or a `TrustedHTML` from DOMPurify.
// The `eupadev` Trusted Types policy is created here, once: the core's CSP says
// `require-trusted-types-for 'script'; trusted-types eupadev dompurify`. Without Trusted Types (old browser),
// the same code renders the escaped string: degraded without breaking.
import { escapeHtml } from './escape-html.js';

/** @typedef {import('trusted-types/lib/index.js').TrustedHTML} TrustedHTML */
const tt = /** @type {import('trusted-types/lib/index.js').TrustedTypesWindow} */ (/** @type {unknown} */ (globalThis)).trustedTypes;
const policy = tt ? tt.createPolicy('eupadev', { createHTML: (/** @type {string} */ s) => s }) : null;

/** Already safe HTML, produced by `html`. */
export class SafeHtml {
  /** @param {string} text */
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

/**
 * Tagged template: `html\`<p>${name}</p>\``. Each interpolated value is escaped, except a `SafeHtml` (nesting) or a
 * `TrustedHTML` (DOMPurify); an array is concatenated, `null`/`undefined` renders nothing. The escaping covers text
 * and quoted attributes; a URL interpolated into `href`/`src` still needs checking (`new URL(...)`, `https:` scheme
 * or relative path): the CSP blocks `javascript:`, not a redirect to a third-party site.
 * @param {TemplateStringsArray} parts
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(parts, ...values) {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += parts[i] ?? '';
    if (i < values.length) out += safe(values[i]);
  }
  return new SafeHtml(out);
}

/** @param {unknown} v @returns {string} */
function safe(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof SafeHtml) return v.text;
  if (tt && tt.isHTML(v)) return String(v);
  if (Array.isArray(v)) return v.map(safe).join('');
  return escapeHtml(v);
}

/**
 * The application's only `innerHTML` write.
 * @param {Element} el
 * @param {SafeHtml | TrustedHTML} content
 */
export function render(el, content) {
  /** @type {unknown} */
  let value;
  if (content instanceof SafeHtml) value = policy ? policy.createHTML(content.text) : content.text;
  else if (tt && tt.isHTML(content)) value = content;
  else throw new TypeError('render(): give html`…` or DOMPurify.sanitize(…, { RETURN_TRUSTED_TYPE: true })');
  el.innerHTML = /** @type {string} */ (value);
}

/** @param {unknown} v */
const text = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Fills each `[data-field="name"]` of `root` with `values.name` as `textContent`.
 * @param {ParentNode} root
 * @param {Record<string, unknown>} values
 */
export function fill(root, values) {
  for (const el of root.querySelectorAll('[data-field]')) {
    const name = el.getAttribute('data-field') ?? '';
    if (name in values) el.textContent = text(values[name]);
  }
}

/**
 * Clones `<template id="…">` and fills it; returns the template's root element.
 * @param {string} id
 * @param {Record<string, unknown>} [values]
 * @returns {Element}
 */
export function clone(id, values = {}) {
  const t = document.getElementById(id);
  if (!(t instanceof HTMLTemplateElement)) throw new Error(`template #${id} not found`);
  const fragment = /** @type {DocumentFragment} */ (t.content.cloneNode(true));
  fill(fragment, values);
  const root = fragment.firstElementChild;
  if (!root) throw new Error(`template #${id}: a single root element expected`);
  return root;
}

/**
 * Targeted update of a list: one child per item, found by `data-key`; existing nodes are reused (and `update`
 * applied), new ones created by `render`, missing ones removed, the order follows `items`.
 * @template T
 * @param {Element} container
 * @param {Iterable<T>} items
 * @param {{ key: (item: T) => string | number, render: (item: T) => Element, update?: (el: Element, item: T) => void }} o
 */
export function list(container, items, o) {
  /** @type {Map<string, Element>} */
  const existing = new Map();
  for (const el of container.children) {
    const k = el.getAttribute('data-key');
    if (k !== null) existing.set(k, el);
  }
  for (const item of items) {
    const k = String(o.key(item));
    let el = existing.get(k);
    if (el) {
      existing.delete(k);
      (o.update ?? ((e, i) => fill(e, /** @type {Record<string, unknown>} */ (Object(i)))))(el, item);
    } else {
      el = o.render(item);
      el.setAttribute('data-key', k);
    }
    container.append(el); // `append` moves a node already present: the final order is that of the items
  }
  for (const el of existing.values()) el.remove();
}
