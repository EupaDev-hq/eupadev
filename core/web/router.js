// Fragment router (`#/items/42`): no server route, no URL that does not exist on the core's side. On each
// navigation, the focus moves to `<main>` (screen readers and keyboard: the page really "changes").

/** @typedef {(params: Record<string, string>, path: string) => void | Promise<void>} View */

/**
 * Match of a pattern (`/items/:id`) and a path; returns the parameters or `null`. Pure.
 * @param {string} pattern
 * @param {string} path
 * @returns {Record<string, string> | null}
 */
export function match(pattern, path) {
  const p = pattern.split('/');
  const c = path.split('/');
  if (p.length !== c.length) return null;
  /** @type {Record<string, string>} */
  const params = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] ?? '';
    const val = c[i] ?? '';
    if (seg.startsWith(':')) {
      if (val === '') return null;
      try { params[seg.slice(1)] = decodeURIComponent(val); } catch { return null; }
    } else if (seg !== val) return null;
  }
  return params;
}

/** Path carried by the fragment (`#/items/42?x` → `/items/42`), `/` by default. Pure. @param {string} hash */
export function fragmentPath(hash) {
  const h = hash.replace(/^#/, '');
  return h.startsWith('/') ? (h.split('?', 1)[0] ?? '/') : '/';
}

/**
 * @param {Record<string, View>} routes patterns → view; `'*'` = page not found (otherwise back to `/`)
 * @param {{ focus?: HTMLElement | null }} [o] element focused after navigation (default: `<main>`)
 */
export function createRouter(routes, o = {}) {
  const patterns = Object.keys(routes).filter((r) => r !== '*');
  const focus = o.focus === undefined ? document.querySelector('main') : o.focus;
  if (focus instanceof HTMLElement && !focus.hasAttribute('tabindex')) focus.tabIndex = -1;

  /** @param {boolean} initial */
  async function resolveRoute(initial) {
    const path = fragmentPath(location.hash);
    const pattern = patterns.find((p) => match(p, path) !== null);
    if (pattern !== undefined) await routes[pattern]?.(match(pattern, path) ?? {}, path);
    else if (routes['*']) await routes['*']({}, path);
    else { location.replace('#/'); return; }
    if (!initial && focus instanceof HTMLElement) focus.focus({ preventScroll: false });
  }

  addEventListener('hashchange', () => { void resolveRoute(false); });
  return {
    /** Starts on the current fragment (without stealing the focus). */
    start: () => resolveRoute(true),
    /** @param {string} path */
    go(path) {
      if (location.hash === `#${path}`) return resolveRoute(false);
      location.hash = path;
      return Promise.resolve();
    },
    path: () => fragmentPath(location.hash),
  };
}
