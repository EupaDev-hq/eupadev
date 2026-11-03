// Front modules in a real Chromium (Playwright), on the example tool's demonstration page, under the core's CSP
// (Trusted Types enforced): zero `securitypolicyviolation`, zero page error, SEC-XSS (payload written through the
// API then shown), contract constraints, double click = one request, ETag → If-Match, router and focus, accessible
// chart, DOMPurify under its policy, axe-core without a violation, 401 → sign-in, texts in English and French.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';
import { call, testServer } from './helpers/server.js';

const XSS = '<img src=x onerror="window.__xss=1">';

/** @type {Awaited<ReturnType<typeof testServer>>} */
let s;
/** @type {import('playwright').Browser} */
let browser;
/** @type {import('playwright').BrowserContext} */
let context;
/** @type {import('playwright').Page} */
let page;
/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const pageErrors = [];
/** @type {string[]} */
const consoleErrors = [];
/** @type {{ method: string, url: string, headers: Record<string, string> }[]} */
const requests = [];

const initViolations = () => {
  addEventListener('securitypolicyviolation', (e) => {
    (/** @type {any} */ (window).__violations ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
  });
};
/** @param {import('playwright').Page} p */
const collect = async (p) => {
  violations.push(...await p.evaluate(() => { const w = /** @type {any} */ (window); const v = w.__violations ?? []; w.__violations = []; return v; }));
};
/** @param {string} fragment @param {string} expected selector present once the view is rendered */
async function go(fragment, expected) {
  await collect(page);
  await page.goto(`${s.base}/${fragment}`);
  await page.waitForSelector(expected);
  await collect(page);
}
const posts = () => s.lines().filter((l) => l.method === 'POST' && l.url === '/api/items').length;

before(async () => {
  s = await testServer();
  browser = await chromium.launch();
  context = await browser.newContext({ extraHTTPHeaders: { 'x-test-session': 'manager' } });
  await context.addInitScript(initViolations);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text()); });
  page.on('request', (r) => { if (r.url().includes('/api/')) requests.push({ method: r.method(), url: new URL(r.url()).pathname, headers: r.headers() }); });
});
after(async () => { await browser?.close(); await s?.close(); });

describe('modules served from the package', () => {
  test('/core/*.js, dictionaries, DOMPurify, contract.json; nothing above', async () => {
    for (const f of ['api.js', 'router.js', 'form.js', 'render.js', 'svg-chart.js', 'escape-html.js', 'i18n.js', 'vendor/purify.js']) {
      const r = await call(`${s.base}/core/${f}`);
      assert.equal(r.status, 200, f);
      assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');
      assert.match(r.headers.get('etag') ?? '', /^"[A-Za-z0-9_-]{27}"$/);
    }
    for (const f of ['lang/en.json', 'lang/fr.json']) assert.equal((await call(`${s.base}/core/${f}`)).headers.get('content-type'), 'application/json', f);
    // D6.1: the contract describes the tool, it is read with a session (401 otherwise).
    const anonymous = await call(`${s.base}/core/contract.json`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, 'UNAUTHENTICATED');
    const c = await call(`${s.base}/core/contract.json`, { role: 'reader' });
    assert.equal(c.status, 200);
    assert.equal(c.body.createItem.method, 'POST');
    assert.equal(c.body.createItem.path, '/api/items');
    assert.equal(c.body.createItem.body.properties.name.maxLength, 80);
    assert.equal(c.body.deleteItem.body, null);
    assert.equal(c.body.exportItems.path, '/files/items.csv');
    assert.equal((await call(`${s.base}/core/`)).status, 404);
    assert.equal((await call(`${s.base}/core/../package.json`)).status, 404);
    assert.equal((await call(`${s.base}/core/%2e%2e/package.json`)).status, 404);
  });
});

describe('demonstration page under CSP + Trusted Types', () => {
  test('list loaded; static header on every /api/ call', async () => {
    const response = await page.goto(`${s.base}/`);
    assert.match(response?.headers()['content-security-policy'] ?? '', /require-trusted-types-for 'script'; trusted-types eupadev dompurify/);
    await page.waitForSelector('#items', { state: 'attached' });
    assert.equal(await page.textContent('h1'), 'Example');
    assert.ok(requests.length > 0);
    for (const r of requests) assert.equal(r.headers['x-requested-with'], 'eupadev', `${r.method} ${r.url}`);
  });

  test('form: constraints set from the contract, native validation without a request', async () => {
    await go('#/new', '#form-item');
    const name = page.locator('#name');
    assert.equal(await name.getAttribute('required'), '');
    assert.equal(await name.getAttribute('maxlength'), '80');
    assert.equal(await name.getAttribute('pattern'), '^[^<>]*$');
    assert.equal(await page.locator('#note').getAttribute('maxlength'), '500');
    const before = posts();
    await name.fill('<script>');
    await page.evaluate(() => /** @type {HTMLFormElement} */ (document.querySelector('#form-item')).requestSubmit());
    assert.equal(await name.evaluate((e) => /** @type {HTMLInputElement} */ (e).validity.patternMismatch), true);
    await name.fill('');
    await page.evaluate(() => /** @type {HTMLFormElement} */ (document.querySelector('#form-item')).requestSubmit());
    assert.equal(await name.evaluate((e) => /** @type {HTMLInputElement} */ (e).validity.valueMissing), true);
    assert.equal(posts(), before);
  });

  test('SEC-XSS: payload written by the form, shown as text, no script run', async () => {
    const before = posts();
    await page.fill('#name', 'Screw');
    await page.fill('#note', XSS);
    await page.click('button[type="submit"]');
    await page.waitForSelector('#items li');
    assert.equal(posts(), before + 1);
    assert.equal(await page.locator('#items .note').first().textContent(), XSS);
    assert.equal(await page.locator('#items img').count(), 0);
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__xss), undefined);
  });

  test('double click: a single request', async () => {
    await go('#/new', '#form-item');
    const before = posts();
    await page.fill('#name', 'Two clicks');
    await page.evaluate(() => {
      const f = /** @type {HTMLFormElement} */ (document.querySelector('#form-item'));
      f.requestSubmit(); f.requestSubmit(); f.requestSubmit();
    });
    await page.waitForSelector('#items li:nth-child(2)');
    assert.equal(posts(), before + 1);
  });

  test('server error: detail and reference shown, in the page\'s language; faulty field flagged', async () => {
    const r = await page.evaluate(async () => {
      const { api, ApiError, errorMessage } = await import(/** @type {string} */ ('/core/api.js'));
      try { await api.call('getItem', { params: { id: '00000000-0000-0000-0000-000000000500' } }); return null; } catch (/** @type {any} */ e) {
        const english = errorMessage(e);
        document.documentElement.lang = 'fr';
        const french = errorMessage(e);
        document.documentElement.lang = 'en';
        return { is: e instanceof ApiError, status: e.status, code: e.code, english, french };
      }
    });
    assert.equal(r?.is, true);
    assert.equal(r?.status, 500);
    assert.equal(r?.code, 'INTERNAL_ERROR');
    assert.match(r?.english ?? '', /^An unexpected error occurred \(ref\. [0-9a-f-]{36}\)$/);
    const fr = JSON.parse(readFileSync(new URL('../web/lang/fr.json', import.meta.url), 'utf8'));
    assert.equal(r?.french, fr['api.withReference'].replace('{detail}', 'An unexpected error occurred').replace('{id}', r?.english.slice(-37, -1)), 'lang/fr.json when <html lang="fr">');
    // 400 of the contract (the browser was bypassed) → message in the state area and setCustomValidity on the field.
    await go('#/new', '#form-item');
    await page.evaluate(() => { const n = /** @type {HTMLInputElement} */ (document.querySelector('#name')); n.removeAttribute('pattern'); n.value = '<b>'; });
    await page.evaluate(() => /** @type {HTMLFormElement} */ (document.querySelector('#form-item')).requestSubmit());
    await page.waitForSelector('[data-state="error"]');
    assert.match(await page.textContent('[data-state="error"]') ?? '', /Request does not match the contract \(ref\. /);
    assert.equal(await page.locator('#name').evaluate((e) => /** @type {HTMLInputElement} */ (e).validationMessage), 'must match pattern "^[^<>]*$"');
  });

  test('router: detail, focus on main, page not found; ETag remembered → If-Match on DELETE', async () => {
    await go('#/', '#items li');
    const before = await page.locator('#items li').count();
    await page.click('#items li a');
    await page.waitForSelector('dl');
    assert.equal(await page.textContent('h2'), 'Screw');
    assert.match(page.url(), /#\/items\/[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
    const id = page.url().split('/').pop() ?? '';
    await page.click('text=Back to the list');
    await page.waitForSelector('#items li');
    requests.length = 0;
    await page.click(`[data-key="${id}"] [data-action="delete"]`);
    await page.waitForFunction((n) => document.querySelectorAll('#items li').length === n - 1, before);
    const deletion = requests.find((r) => r.method === 'DELETE');
    assert.equal(deletion?.url, `/api/items/${id}`);
    assert.equal(deletion?.headers['if-match'], `"${id.slice(0, 8)}"`);
    await go('#/whatever/path', 'h2');
    assert.equal(await page.textContent('h2'), 'Page not found');
    assert.equal(await page.textContent('code'), '/whatever/path');
  });

  test('rich text: html`…` escapes, DOMPurify sanitises under its policy', async () => {
    await go('#/new', '#form-item');
    await page.fill('#name', 'Rich');
    await page.fill('#note', `${XSS}<b>bold</b>`);
    await page.click('button[type="submit"]');
    await page.waitForSelector('#items li');
    await go('#/rich', '#sanitized');
    assert.equal(await page.textContent('#escaped strong'), `${XSS}<b>bold</b>`);
    assert.equal(await page.locator('#escaped img, #escaped b').count(), 0);
    assert.equal(await page.locator('#sanitized b').count(), 1);
    assert.equal(await page.locator('#sanitized img, #sanitized [onerror]').count(), 0);
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__xss), undefined);
  });

  test('chart: accessible SVG, colour read from the CSS variable, equivalent table', async () => {
    await go('#/stats', 'svg[role="img"]');
    const svg = page.locator('svg[role="img"]');
    assert.ok(await svg.getAttribute('aria-labelledby'));
    assert.equal(await page.textContent('svg[role="img"] > title'), 'Items by status');
    assert.match(await page.textContent('svg[role="img"] > desc') ?? '', /^Bar chart, 1 series over 2 categories;/);
    assert.equal(await page.locator('svg[role="img"] rect').count(), 2);
    assert.equal(await page.locator('svg[role="img"] rect').first().evaluate((e) => getComputedStyle(e).fill), 'rgb(42, 120, 214)');
    assert.equal(await page.textContent('.chart-data caption'), 'Items by status');
    assert.equal(await page.textContent('.chart-data thead th'), 'Series');
    assert.deepEqual(await page.locator('.chart-data tbody td').allTextContents(), ['2', '0']);
  });

  test('axe-core: zero violation, every severity', async () => {
    for (const [fragment, expected] of /** @type {[string, string][]} */ ([['#/', '#items li'], ['#/new', '#form-item'], ['#/stats', 'svg[role="img"]'], ['#/rich', '#sanitized']])) {
      await go(fragment, expected);
      const { violations: v } = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(v.map((x) => `${x.impact} ${x.id} ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`), [], fragment);
    }
  });

  test('summary: zero securitypolicyviolation, zero page error, zero console error', async () => {
    await collect(page);
    // Only exception: Chromium reports `script-src-attr` when DOMPurify parses (inert
    // document, `DOMParser`) a payload carrying an inline handler, before removing it; nothing runs (`window.__xss`
    // stays undefined). Once per rendering of the trapped note ("rich" view: 2 passes, axe included).
    const purify = violations.filter((v) => /^script-src-attr inline http:\/\/[^ ]+\/core\/vendor\/purify\.js:\d+ $/.test(v));
    assert.equal(purify.length, 2);
    assert.deepEqual(violations.filter((v) => !purify.includes(v)), []);
    assert.deepEqual(pageErrors, []);
    // Console: the echo of these same reports, and the 400/500 caused by the error tests; nothing else.
    assert.equal(consoleErrors.filter((m) => m.startsWith('Executing inline event handler')).length, purify.length);
    assert.deepEqual(consoleErrors.filter((m) => !m.startsWith('Executing inline event handler') && !/^Failed to load resource: .* (400|500) /.test(m)), []);
  });
});

describe('guard-rails observed', () => {
  test('Trusted Types enforced: innerHTML with a string is refused and reported', async () => {
    const p = await context.newPage();
    await p.goto(`${s.base}/`);
    const r = await p.evaluate(() => {
      try { document.body.innerHTML = '<b>x</b>'; return 'accepted'; } catch (e) { return e instanceof TypeError ? 'TypeError' : String(e); }
    });
    assert.equal(r, 'TypeError');
    // Both policies exist (a second `createPolicy` of the same name is refused); no other is allowed.
    assert.deepEqual(await p.evaluate(() => ['eupadev', 'dompurify', 'other'].map((n) => {
      try { /** @type {any} */ (window).trustedTypes.createPolicy(n, {}); return `${n} created`; } catch { return `${n} refused`; }
    })), ['eupadev refused', 'dompurify created', 'other refused']); // DOMPurify creates its own at the first sanitize
    const v = await p.evaluate(() => /** @type {any} */ (window).__violations ?? []);
    assert.deepEqual(v.map((/** @type {string} */ x) => x.split(' ')[0]), ['require-trusted-types-for', 'trusted-types', 'trusted-types']);
    await p.close();
  });

  test('sign-out: same-origin POST /auth/logout through a form', async () => {
    const p = await context.newPage();
    await p.goto(`${s.base}/`);
    const [req] = await Promise.all([
      p.waitForRequest((r) => r.url().endsWith('/auth/logout')),
      p.evaluate(async () => { const { api } = await import(/** @type {string} */ ('/core/api.js')); api.signOut(); }),
    ]);
    assert.equal(req.method(), 'POST');
    assert.equal(req.isNavigationRequest(), true); // top-level navigation: `Sec-Fetch-Site: same-origin` over HTTPS
    await p.waitForURL(/\/auth\/logout$/); // closing a page during a POST navigation blocks Chromium
    await p.close();
  });

  test('download (D3): click on the link → same-origin navigation, file received, right content; cross-site and address bar → 403', async () => {
    await go('#/', '#items li');
    const exportLink = page.locator('#export');
    assert.equal(await exportLink.getAttribute('href'), '/files/items.csv');
    const [dl, req] = await Promise.all([
      page.waitForEvent('download'),
      page.waitForRequest((r) => r.url().endsWith('/files/items.csv')),
      exportLink.click(),
    ]);
    assert.equal((await req.allHeaders())['sec-fetch-site'], 'same-origin');
    assert.equal((await req.allHeaders())['x-requested-with'], undefined);
    assert.equal(dl.suggestedFilename(), 'items.csv');
    const csv = readFileSync(await dl.path(), 'utf8');
    assert.match(csv, /^id,name,status\r\n/);
    assert.ok(csv.includes(',"Two clicks",open\r\n'), csv);
    assert.equal(csv.trimEnd().split('\r\n').length - 1, await page.locator('#items li').count());
    // Foreign page (served by Playwright as https://evil.test): the same link, clicked, leaves with
    // `Sec-Fetch-Site: cross-site` → 403. Playwright does not show the Sec-Fetch-* headers of a navigation
    // (`allHeaders()` omits them): the refusal is read in the response and in the server's log.
    const refusalsBefore = s.lines().filter((l) => l.event === 'csrf_blocked').length;
    const p = await context.newPage();
    await p.route('https://evil.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<a id="l" href="${s.base}/files/items.csv">csv</a>` }));
    await p.goto('https://evil.test/');
    const [refusal] = await Promise.all([p.waitForResponse((r) => r.url().endsWith('/files/items.csv')), p.click('#l')]);
    assert.equal(refusal.status(), 403);
    assert.equal((await refusal.json()).code, 'CSRF_BLOCKED');
    // URL typed in the address bar: `Sec-Fetch-Site: none` → 403 too (decision D3: same-origin only).
    const direct = await p.goto(`${s.base}/files/items.csv`);
    assert.equal(direct?.status(), 403);
    const refusals = s.lines().filter((l) => l.event === 'csrf_blocked').slice(refusalsBefore);
    assert.deepEqual(refusals.map((l) => `${l.rule} ${l.url}`), ['sec-fetch-site /files/items.csv', 'sec-fetch-site /files/items.csv']);
    await p.close();
  });

  test('without a session: 401 from the API → /auth/login?next=<current page>', async () => {
    const anonymous = await browser.newContext();
    const p = await anonymous.newPage();
    await p.goto(`${s.base}/#/stats`);
    await p.waitForURL(/\/auth\/login\?next=%2F%23%2Fstats$/);
    await anonymous.close();
  });
});
