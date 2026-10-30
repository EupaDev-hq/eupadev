// Escapes a value to insert it into HTML. The WHOLE value given to `innerHTML` / `insertAdjacentHTML` goes through
// it (Opengrep rule `innerhtml-variable-text`); with Trusted Types, prefer `html` from render.js.
const ESCAPES = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/** @param {unknown} value @returns {string} */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}
