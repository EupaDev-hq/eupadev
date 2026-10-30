// "Two users" helpers of the kit (§2.10) for the SEC-IDOR, SEC-URL, SEC-XSS specs the `tests` agent writes tool by
// tool: one isolated Playwright context (cookies, storage) per person, signed in through the real Keycloak form; an
// anonymous context; an API call from a context (its cookies, the static headers).
import { REQUEST_HEADERS } from './index.js';

/**
 * Fresh Playwright context, signed in as `person` through the Keycloak form.
 * @param {import('playwright').Browser} browser @param {string} base @param {{ name: string, password: string }} person
 */
export async function signedInContext(browser, base, person) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/auth/login`);
  await page.fill('#username', person.name);
  await page.fill('#password', person.password);
  const origin = new URL(base).origin;
  await Promise.all([
    page.waitForURL((u) => u.origin === origin && !u.pathname.startsWith('/realms/') && !u.pathname.startsWith('/auth/')),
    page.click('#kc-login'),
  ]);
  await page.close();
  return context;
}

/**
 * A and B, each in their own context: what one sees is never the other's session.
 * @param {import('playwright').Browser} browser @param {string} base
 * @param {{ name: string, password: string }} a @param {{ name: string, password: string }} b
 */
export async function twoUsers(browser, base, a, b) {
  const [ca, cb] = await Promise.all([signedInContext(browser, base, a), signedInContext(browser, base, b)]);
  return { a: ca, b: cb };
}

/** Fresh context with no session (SEC-URL: a copied URL opened by a stranger). @param {import('playwright').Browser} browser */
export const anonymous = (browser) => browser.newContext();

/**
 * API call with the context's cookies and the static headers; redirects not followed.
 * @param {import('playwright').BrowserContext} context @param {string} base
 * @param {string} method @param {string} path @param {unknown} [body]
 */
export async function callFrom(context, base, method, path, body) {
  const r = await context.request.fetch(`${base}${path}`, { method, headers: { ...REQUEST_HEADERS }, ...(body === undefined ? {} : { data: body }), maxRedirects: 0 });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status(), json, text };
}
