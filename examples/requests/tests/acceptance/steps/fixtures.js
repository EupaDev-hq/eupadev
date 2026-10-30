// Fixtures of the acceptance suite: one signed-in page per realm person (own browser context, real Keycloak login),
// watched for page errors, CSP violations and unexpected dialogs; an axe audit of every page at the end of a scenario
// (zero critical or serious violation); the scenario's own data, named with a per-scenario suffix so runs never collide.
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createBdd, test as base } from 'playwright-bdd';
import { callFrom, signedInContext } from '@eupadev/core/kit/two-users.js';
import { BASE, person, resetRateLimits } from '../../stack.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ suffix: string, id?: string, title?: string, categories: Map<string, { code: string, label: string }>, csv?: string }} World */

/** @param {Page} page */
export async function audit(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

export const test = base.extend(/** @type {any} */ ({
  /** @type {World} */
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  world: async ({}, /** @type {(w: World) => Promise<void>} */ use) => {
    await use({ suffix: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), categories: new Map() });
  },
  as: async (/** @type {{ browser: import('@playwright/test').Browser }} */ { browser }, /** @type {(f: (name: string) => Promise<Page>) => Promise<void>} */ use) => {
    await resetRateLimits(/** @type {string} */ (process.env.REQUESTS_ADMIN_URL));
    /** @type {Map<string, Page>} */ const pages = new Map();
    /** @type {string[]} */ const problems = [];
    await use(async (name) => {
      let page = pages.get(name);
      if (page) return page;
      page = await (await signedInContext(browser, BASE, person(name))).newPage();
      page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
      page.on('console', (m) => { if (m.text().startsWith('CSP ')) problems.push(`${name}: ${m.text()}`); });
      // A confirm() is the app asking before a delete; any other dialog (alert) is unexpected, an XSS among others.
      page.on('dialog', (d) => { if (d.type() !== 'confirm') problems.push(`${name}: ${d.type()} ${d.message()}`); void d.accept(); });
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.log(`CSP ${e.violatedDirective} ${e.blockedURI}`)));
      pages.set(name, page);
      return page;
    });
    for (const page of pages.values()) {
      if (page.url().startsWith(BASE)) await audit(page);
      await page.context().close();
    }
    expect(problems).toEqual([]);
  },
}));

export const { Given, When, Then } = createBdd(test);

/** Opens a screen by its hash path and waits for its heading. @param {Page} page @param {string} path @param {string | RegExp} heading */
export async function visit(page, path, heading) {
  const url = `${BASE}/#${path}`;
  if (page.url() === url) await page.reload(); // same hash: goto would not navigate
  else await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/**
 * API call as a person (setup steps only: what a scenario is about goes through the screens).
 * @param {Page} page @param {string} method @param {string} path @param {unknown} [body]
 */
export async function call(page, method, path, body) {
  const r = await callFrom(page.context(), BASE, method, path, body);
  expect(r.status, r.text).toBeLessThan(300);
  return r.json;
}
