// The "browser" of the authentication tests: one cookie jar per host, like a real browser (two instances of the tool
// on two `localhost` ports share their cookies; Keycloak on 127.0.0.1 does not), redirects followed by hand (each
// step is observable), bodies read. Cookie attributes are not interpreted beyond `Max-Age=0` (deletion): the tests
// check the attributes on the headers themselves.

/** @typedef {{ status: number, headers: Headers, url: string, text: string }} Step */

export function httpBrowser() {
  /** @type {Map<string, Map<string, string>>} host → name → value */
  const jars = new Map();
  const jar = (/** @type {string} */ host) => {
    let j = jars.get(host);
    if (!j) { j = new Map(); jars.set(host, j); }
    return j;
  };
  /** `Cookie` header a browser would send to this host. @param {string} host */
  const cookieHeader = (host) => [...jar(host)].map(([k, v]) => `${k}=${v}`).join('; ');
  /** @param {URL} u @param {Headers} h */
  const retain = (u, h) => {
    for (const sc of h.getSetCookie()) {
      const [pair = '', ...attributes] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const maxAge = attributes.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith('max-age='));
      if (maxAge !== undefined && Number(maxAge.slice(8)) <= 0) jar(u.hostname).delete(name);
      else jar(u.hostname).set(name, pair.slice(i + 1).trim());
    }
  };

  /**
   * One request, redirects not followed; the origin's cookies sent and retained.
   * @param {string | URL} url @param {RequestInit} [init] @returns {Promise<Step>}
   */
  async function request(url, init = {}) {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const cookies = cookieHeader(u.hostname);
    if (cookies) headers.set('cookie', cookies);
    const res = await fetch(u, { ...init, headers, redirect: 'manual' });
    retain(u, res.headers);
    return { status: res.status, headers: res.headers, url: u.href, text: await res.text() };
  }

  /**
   * One request then its redirects (GET), 10 hops at most; returns every step.
   * @param {string | URL} url @param {RequestInit} [init] @returns {Promise<Step[]>}
   */
  async function go(url, init = {}) {
    const steps = [await request(url, init)];
    for (;;) {
      const last = /** @type {Step} */ (steps[steps.length - 1]);
      const location = last.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(last.status) || location === null || steps.length > 10) return steps;
      steps.push(await request(new URL(location, last.url)));
    }
  }

  return {
    request,
    go,
    /** @param {string} host @param {string} name */
    cookie: (host, name) => jar(host).get(name),
    cookies: cookieHeader,
    /** @param {string} host @param {string} name @param {string} [value] missing: deletion */
    set(host, name, value) {
      if (value === undefined) jar(host).delete(name);
      else jar(host).set(name, value);
    },
  };
}
