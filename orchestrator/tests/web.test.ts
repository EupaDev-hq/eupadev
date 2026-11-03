/**
 * Chat step 3 (ADR-024): the requester's page in a real Chromium (Playwright), served by the engine
 * with the fake IdP (sign-in through the browser, the `__Host-session` cookie) and a disposable PostgreSQL, the automatic
 * fakes driving the cycle up to "your opinion on the mock-up is expected". Checked: the static files and their headers,
 * the vendored deep-chat pinned by content hash, zero `securitypolicyviolation`, XSS payloads in messages inert, axe-core
 * zero violation (list, conversation, refusal), a text typed in deep-chat lands in `messages`, a double click on an
 * opinion = one request, requester B cannot open A's cycle (403 shown nicely), the FR/EN switch.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createApi } from '../src/api.ts';
import { automaticFakes, launchFakeWatcher } from '../src/external/fakes.ts';
import { Orchestrator } from '../src/orchestrator.ts';
import { startPostgres, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ADMIN, ADMIN_MAIL, REQUESTER, REQUESTER_MAIL, ENV_TEST, insertTestActors, SUBJECTS } from './helpers/bench.ts';
import { CLIENT_WEB_TEST, startFakeOidc, TEST_ISSUER, WEB_TEST_PASSWORD, type Account, type FakeOidc } from './helpers/fake-oidc.ts';

// Browser globals used inside `page.evaluate` callbacks (the engine's tsconfig has no DOM lib): declared for this module only.
declare const window: { __violations?: string[]; __xss?: number };
declare const document: { documentElement: { lang: string } };
declare const localStorage: { getItem(k: string): string | null };
declare function addEventListener(type: 'securitypolicyviolation', cb: (e: { violatedDirective: string; blockedURI: string; sourceFile: string; lineNumber: number }) => void): void;

/** deep-chat 2.5.1, `dist/deepChat.bundle.js` (ADR-024): the only hash the page may serve. */
const SHA256_DEEP_CHAT = '6844eaf354e19d50dcdd8ee78968d6ae32ccd4b9f15a883902d60e93d69caf84';
const SCREENSHOTS_DIR = process.env['WEB_SCREENSHOTS'] ?? '';
const A: Account = { subject: SUBJECTS[REQUESTER.id]!, mail: REQUESTER_MAIL, name: REQUESTER_MAIL, roles: ['requester'] };
const B: Account = { subject: 'web-b', mail: 'b@example.test', roles: ['requester'] };
/** The IT admin, another person than A: the four-eyes rule of Gate 2 lets them approve A's tool. */
const ADM: Account = { subject: SUBJECTS[ADMIN.id]!, mail: ADMIN_MAIL, name: ADMIN_MAIL, roles: ['admin'] };

let postgres: ThrowawayPostgres;
let oidc: FakeOidc;
let orch: Orchestrator;
let stopWatcher: () => void;
let api: http.Server;
let base: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;
/** Who signs in when the browser reaches the fake IdP. */
let account: Account = A;
const violations: string[] = [];
const pageErrors: string[] = [];
const posts: string[] = [];
let cycle = 0;

const initViolations = () => {
  addEventListener('securitypolicyviolation', (e) => {
    (window.__violations ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
  });
};
const collect = async (p: Page) => {
  violations.push(...await p.evaluate(() => { const v = window.__violations ?? []; window.__violations = []; return v; }));
};
/** Polls `read` until it is truthy (deadline in ms, never without one). */
async function until<T>(read: () => Promise<T | false | null | undefined>, timeoutMs: number, what: string): Promise<T> {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > limit) throw new Error(`timeout (${timeoutMs} ms): ${what}`);
    await sleep(100);
  }
}
const state = async (id: number) => (await orch.base.readCycle(id)).state;
const raw = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
/**
 * A browser context: the CSP listener, and the fake IdP played in-process. Playwright does not route the hops of a
 * redirect chain, so `/auth/login` itself is fetched (the engine's 303 to Keycloak, with its transaction cookie) and
 * answered with the same cookie and a 303 to the callback URL Keycloak would send `account` back to, on this port.
 */
async function newContext(colorScheme: 'light' | 'dark' = 'light'): Promise<BrowserContext> {
  const c = await browser.newContext({ baseURL: base, locale: 'en-US', colorScheme, viewport: { width: 1100, height: 850 } });
  await c.addInitScript(initViolations);
  await c.route('**/auth/login**', async (route) => {
    const r = await route.fetch({ maxRedirects: 0 });
    const location = r.headers()['location'] ?? '';
    assert.ok(location.startsWith(`${TEST_ISSUER}/protocol/openid-connect/auth?`), `the engine sends the browser to Keycloak: ${r.status()} ${location}`);
    const back = oidc.authorize(location, account);
    await route.fulfill({ response: r, status: 303, headers: { ...r.headers(), location: new URL(back.pathname + back.search, base).href } });
  });
  return c;
}
/** A test run alone (mutation campaign): sign in and open a fresh cycle of A's, as the sign-in test would have done. */
async function openCycle(): Promise<void> {
  if (cycle !== 0) return;
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 15_000 });
  cycle = (await orch.newRequest({ type: 'creation', name: 'Key loans', slug: 'key-loans', owner_service: 'Facilities', need: 'Track the department’s key loans by site' }, REQUESTER)).cycle_id;
  await page.goto(`/cycles/${cycle}`);
  await page.locator('deep-chat').getByText('Track the department’s key loans by site').waitFor({ timeout: 10_000 });
}
const capture = async (p: Page, name: string) => { if (SCREENSHOTS_DIR !== '') await p.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: true }); };
const axe = async (p: Page, what: string) => {
  const r = await new AxeBuilder({ page: p }).analyze();
  assert.deepEqual(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), [], `axe: ${what}`);
};

before(async () => {
  if (SCREENSHOTS_DIR !== '') mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  [postgres, oidc] = await Promise.all([startPostgres(), startFakeOidc()]);
  // Human delays long enough for a browser: reminders every minute (ENV_TEST: 400 ms, which pauses the cycle in 1.6 s), pause archived after 10 min.
  const variables: Record<string, string> = {
    ...ENV_TEST, OIDC_JWKS_URL: oidc.jwksUrl, ORCH_DATABASE_URL: postgres.engineUrl, REMINDER_DELAY_MS: '60000', PAUSE_ARCHIVE_DELAY_MS: '600000',
    OIDC_WEB_CLIENT_ID: CLIENT_WEB_TEST, OIDC_WEB_CLIENT_SECRET: WEB_TEST_PASSWORD, OIDC_WEB_REDIRECT_URL: 'http://localhost:8080/auth/callback',
  };
  orch = await Orchestrator.start(automaticFakes(variables['TOOL_DOMAIN']!), variables, { onLockLoss: () => {} });
  await insertTestActors(orch.base.pool);
  stopWatcher = launchFakeWatcher(orch, 50);
  api = createApi(orch).listen(0, '127.0.0.1');
  await once(api, 'listening');
  base = `http://localhost:${(api.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  context = await newContext();
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/messages') posts.push(r.postData() ?? ''); });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  stopWatcher?.();
  api?.close();
  await orch?.stop().catch(() => {});
  await oidc?.stop();
  postgres?.remove();
});

test('static files: the page and its headers, deep-chat pinned by content hash, nothing else before the API guards', async () => {
  const index = await raw('/');
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(index.headers.get('content-security-policy'), `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self' https://auth.example.test; frame-ancestors 'none'`);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(index.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const html = await index.text();
  const m = /src="(\/vendor\/deep-chat\.([0-9a-f]{8})\.js)"/.exec(html);
  assert.ok(m, 'index.html names the vendored bundle');
  assert.equal(m[2], SHA256_DEEP_CHAT.slice(0, 8));
  const vendor = await raw(m[1]!);
  assert.equal(vendor.status, 200);
  assert.equal(vendor.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(createHash('sha256').update(Buffer.from(await vendor.arrayBuffer())).digest('hex'), SHA256_DEEP_CHAT);
  // The conversation page is the same file; conditional requests; HEAD.
  const conv = await raw('/cycles/42');
  assert.equal(conv.status, 200);
  assert.equal(await conv.text(), html);
  assert.equal((await raw('/', { headers: { 'If-None-Match': index.headers.get('etag')! } })).status, 304);
  assert.equal((await raw('/app.js', { method: 'HEAD' })).status, 200);
  for (const f of ['/app.js', '/app.css', '/lang/fr.json', '/lang/en.json']) assert.equal((await raw(f)).status, 200, f);
  // Anything else is the API: X-EupaDev still required (403), the page never shadows a route.
  for (const path of ['/requests', '/cycles/abc', '/cycles/1/', '/web/index.html', '/vendor/deep-chat.js']) assert.equal((await raw(path)).status, 403, path);
  assert.equal((await raw('/', { method: 'POST' })).status, 403);
});

test('sign-in from the page, the list, a new request opens its conversation; zero CSP violation; axe clean', { timeout: 90_000 }, async () => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Sign in' });
  await link.waitFor({ timeout: 10_000 });
  await collect(page);
  await axe(page, 'sign-in');
  await link.click();
  await page.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 15_000 });
  assert.equal(new URL(page.url()).pathname, '/');
  assert.ok((await context.cookies(base)).some((c) => c.name === '__Host-session' && c.httpOnly && c.secure), 'the session cookie is set in the browser');
  await page.getByText('No request yet.').waitFor({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 5_000 });
  await collect(page);
  await axe(page, 'list (empty)');
  await capture(page, 'list-empty-light');

  await page.getByLabel('Tool name').fill('Key loans');
  // The short name follows the tool name (accents and spaces folded) until the requester edits it.
  assert.equal(await page.getByLabel('Short name', { exact: false }).inputValue(), 'key-loans');
  await page.getByLabel('Tool name').fill('Prêts de clés !');
  assert.equal(await page.getByLabel('Short name', { exact: false }).inputValue(), 'prets-de-cles');
  await page.getByLabel('Tool name').fill('Key loans');
  await page.getByLabel('Short name', { exact: false }).fill('key-loans');
  await page.getByLabel('Owning service').fill('Facilities');
  await page.getByLabel('What you need').fill('Track the department’s key loans by site');
  await page.getByRole('button', { name: 'Submit the request' }).click();
  await page.waitForURL(/\/cycles\/\d+$/, { timeout: 15_000 });
  cycle = Number(/\/cycles\/(\d+)$/.exec(page.url())![1]);
  await page.getByRole('heading', { name: /Key loans/ }).waitFor({ timeout: 10_000 });
  // The need is the first message of the history; the request is listed, marked as the open one.
  const chat = page.locator('deep-chat');
  await chat.getByText('Track the department’s key loans by site').waitFor({ timeout: 10_000 });
  await page.locator('#requests a[aria-current="page"]', { hasText: 'Key loans' }).waitFor({ timeout: 5_000 });
  await collect(page);
  assert.deepEqual(violations, []);
  assert.deepEqual(pageErrors, []);
});

test('XSS payloads written in the chat are shown as text: no element, no script, zero CSP violation', { timeout: 60_000 }, async () => {
  await openCycle();
  const c = await orch.base.readCycle(cycle);
  const IMG = '<img src=x onerror="window.__xss=1">';
  const LINK = '[x](javascript:window.__xss=1)';
  await orch.base.writeMessage(c, 'agent', REQUESTER.id, `Question: ${IMG}`);
  await orch.base.writeMessage(c, 'agent', REQUESTER.id, `Link ${LINK}`);
  const chat = page.locator('deep-chat');
  // The page polls every 10 s.
  await chat.getByText('Question:', { exact: false }).waitFor({ timeout: 15_000 });
  await chat.getByText('Link', { exact: false }).waitFor({ timeout: 15_000 });
  assert.ok((await chat.getByText('Question:', { exact: false }).textContent())?.includes(IMG), 'the img tag is shown as text');
  assert.equal(await chat.locator('img').count(), 0);
  await collect(page);
  assert.deepEqual(violations, []);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  // A javascript: link, if the Markdown renders one, is blocked by the CSP (script-src 'self'); nothing runs either way.
  const link = chat.locator('a[href^="javascript:"]');
  if (await link.count() > 0) {
    await link.first().click();
    await sleep(300);
    await page.evaluate(() => { window.__violations = []; });
  }
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(pageErrors, []);
});

/** Types `text` in deep-chat and presses Enter. */
async function type(p: Page, text: string): Promise<void> {
  const input = p.locator('deep-chat #text-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}
/** The cycle is back at `s` in another passage than `visit`, and the page (polling every 10 s) has seen it. Returns the new visit. */
async function newVisit(s: string, visit: number, timeoutMs = 60_000): Promise<number> {
  const c = await until(async () => { const c = await orch.base.readCycle(cycle); return c.state === s && c.visit !== visit && c; }, timeoutMs, `${s} again`);
  await page.locator(`#main[data-state="${s}"][data-visit="${c.visit}"]`).waitFor({ timeout: 20_000 });
  return c.visit;
}

test('just chat: a text typed is the correction; an acceptance word is confirmed first, only the confirmation POSTs; a double click = one request', { timeout: 200_000 }, async () => {
  // The automatic fakes (scoping, mock-up) bring the cycle to the requester's first wait.
  await openCycle();
  await until(async () => (await state(cycle)) === 'waiting_scoping_feedback', 60_000, 'waiting_scoping_feedback (1)');
  let visit = (await orch.base.readCycle(cycle)).visit;
  const abandon = page.getByRole('button', { name: 'Abandon the request' });
  await abandon.waitFor({ timeout: 15_000 });
  await page.locator('.conv-head').getByText('Your opinion on the mock-up is expected').waitFor({ timeout: 5_000 });
  // deep-chat's own strings come from the dictionary (placeholder per state, names, button label); no opinion buttons any more.
  assert.equal(await page.locator('deep-chat #text-input').getAttribute('deep-chat-placeholder-text'), 'Mock-up fine? Say so. Something to change? Describe it here');
  assert.equal(await page.locator('deep-chat .input-button').first().getAttribute('aria-label'), 'Send');
  assert.equal(await page.locator('.opinions button').count(), 1);
  await collect(page);
  await axe(page, 'conversation');
  await capture(page, 'conversation-light');

  // Ordinary text: the correction, sent at once.
  const text = 'The site filter is missing';
  await type(page, text);
  const line = await until(async () => (await orch.base.pool.query<{ author_type: string }>('SELECT author_type FROM messages WHERE cycle_id = $1 AND content = $2', [cycle, text])).rows[0], 20_000, 'typed text in messages');
  assert.equal(line.author_type, 'requester');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0]!), { cycle_id: cycle, message: { type: 'scoping_feedback', outcome: 'correction', text: text } });
  await page.locator('deep-chat').getByText('Sent. The agents are on it.').first().waitFor({ timeout: 5_000 });
  // Shown once: deep-chat's own bubble, not a second one from the poll.
  await sleep(11_000);
  assert.equal(await page.locator('deep-chat').getByText(text, { exact: true }).count(), 1);

  // The correction relaunches the scoping; the fakes bring the cycle back to the same wait (a new passage).
  visit = await newVisit('waiting_scoping_feedback', visit);
  posts.length = 0;
  // An acceptance word is not a correction: the page asks, nothing is sent; "No, it was a change" sends it as the correction.
  await type(page, 'Fine');
  const confirmBox = page.getByRole('group', { name: 'Did you mean to approve? Confirm below.' });
  await confirmBox.getByRole('button', { name: 'Approve this mock-up' }).waitFor({ timeout: 5_000 });
  await sleep(500);
  assert.equal(posts.length, 0);
  await collect(page);
  await axe(page, 'acceptance confirmation');
  await capture(page, 'accept-confirm');
  await confirmBox.getByRole('button', { name: 'No, it was a change' }).click();
  await until(async () => posts.length === 1, 5_000, 'the change POSTed');
  assert.deepEqual(JSON.parse(posts[0]!), { cycle_id: cycle, message: { type: 'scoping_feedback', outcome: 'correction', text: 'Fine' } });
  await until(async () => (await page.getByRole('group').count()) === 0, 5_000, 'the question answered');

  await newVisit('waiting_scoping_feedback', visit);
  posts.length = 0;
  await type(page, 'ok');
  const ok = page.getByRole('button', { name: 'Approve this mock-up' });
  await ok.waitFor({ timeout: 5_000 });
  await ok.dblclick();
  await sleep(1_500);
  assert.equal(posts.length, 1, `one POST /messages for a double click: ${JSON.stringify(posts)}`);
  assert.deepEqual(JSON.parse(posts[0]!), { cycle_id: cycle, message: { type: 'scoping_feedback', outcome: 'satisfied' } });
  await until(async () => (await state(cycle)) !== 'waiting_scoping_feedback', 30_000, 'the opinion moved the cycle on');
  await collect(page);
  assert.deepEqual(violations, []);
  assert.deepEqual(pageErrors, []);
});

test('the admin decides from the page: "Waiting for you", the decision card, a correction needs a comment, the approval moves the cycle on; axe clean', { timeout: 200_000 }, async () => {
  await openCycle();
  // Contract, hardening, merge, CI (fake watcher), candidate image: Gate 1.
  await until(async () => (await state(cycle)) === 'gate_1', 150_000, 'gate_1');
  account = ADM;
  const other = await newContext();
  const p = await other.newPage();
  const sent: string[] = [];
  p.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/messages') sent.push(r.postData() ?? ''); });
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    await p.goto('/');
    await p.getByRole('link', { name: 'Sign in' }).click();
    await p.getByRole('heading', { name: 'Waiting for you' }).waitFor({ timeout: 15_000 });
    await p.locator('#requests a', { hasText: 'Key loans' }).first().click();
    const card = p.getByRole('region', { name: 'Your decision' });
    await card.getByRole('heading', { name: 'Gate 1: name and domain of the tool' }).waitFor({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Refuse' }).waitFor({ timeout: 5_000 });
    assert.equal(await p.locator('.opinions button').count(), 4, 'approve, correction, scope change, refuse; no abandon for the admin');
    await collect(p);
    await axe(p, 'decision card');
    await capture(p, 'admin-gate');
    // A correction without its comment is refused by the page (the engine would refuse it too).
    await card.getByRole('button', { name: 'Ask for a correction' }).click();
    await card.getByRole('alert').getByText('Write a comment, then click again.').waitFor({ timeout: 5_000 });
    assert.deepEqual(sent, []);
    // The approval's comment is the tool's catalogue description.
    await card.getByLabel('Short description of the tool for the catalogue', { exact: false }).fill('Key loans per site');
    await card.getByRole('button', { name: 'Approve' }).click();
    await until(async () => sent.length === 1, 5_000, 'the decision POSTed');
    assert.deepEqual(JSON.parse(sent[0]!), { cycle_id: cycle, message: { type: 'decision', gate: 'gate_1', outcome: 'approved', comment: 'Key loans per site' } });
    await until(async () => (await state(cycle)) !== 'gate_1', 30_000, 'the decision moved the cycle on');
    // The side list follows the state: nothing waits for the admin any more.
    await p.getByText('Nothing waiting.').waitFor({ timeout: 15_000 });
    assert.equal((await orch.base.pool.query<{ comment: string }>(`SELECT comment FROM approvals WHERE cycle_id = $1 AND gate = 'gate_1'`, [cycle])).rows[0]?.comment, 'Key loans per site');
    await collect(p);
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
  } finally {
    account = A;
    await other.close();
  }
});

test('Preview: a text asks "wrong or new?", an acceptance word confirms; Gate 2 cites the candidate digest', { timeout: 200_000 }, async () => {
  await openCycle();
  await until(async () => (await state(cycle)) === 'waiting_preview_feedback', 120_000, 'waiting_preview_feedback');
  await page.locator('.conv-head').getByText('Your opinion on the Preview is expected').waitFor({ timeout: 15_000 });
  const visit = (await orch.base.readCycle(cycle)).visit;
  posts.length = 0;
  await type(page, 'The export button does nothing');
  const kind = page.getByRole('group', { name: 'Is it something wrong, or something new? Choose below.' });
  await kind.getByRole('button', { name: 'Something new (new capability)' }).waitFor({ timeout: 5_000 });
  assert.equal(posts.length, 0);
  await kind.getByRole('button', { name: 'Something is wrong (fix)' }).click();
  await until(async () => posts.length === 1, 5_000, 'the bug POSTed');
  assert.deepEqual(JSON.parse(posts[0]!), { cycle_id: cycle, message: { type: 'preview_feedback', outcome: 'bug', text: 'The export button does nothing' } });
  // A bug goes back to the hardening; the fakes bring a new digest to the Preview again.
  await until(async () => (await page.getByRole('group').count()) === 0, 5_000, 'the question answered');
  await newVisit('waiting_preview_feedback', visit, 150_000);
  posts.length = 0;
  await type(page, "c'est bon");
  await page.getByRole('button', { name: 'Approve this Preview' }).click();
  await until(async () => (await state(cycle)) === 'gate_2', 30_000, 'gate_2');
  assert.deepEqual(JSON.parse(posts[0]!), { cycle_id: cycle, message: { type: 'preview_feedback', outcome: 'satisfied' } });

  const digest = await orch.base.candidateDigest(cycle);
  assert.ok(digest);
  account = ADM;
  const other = await newContext();
  const p = await other.newPage();
  const sent: string[] = [];
  p.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/messages') sent.push(r.postData() ?? ''); });
  try {
    await p.goto(`/cycles/${cycle}`);
    await p.getByRole('link', { name: 'Sign in' }).click();
    const card = p.getByRole('region', { name: 'Your decision' });
    await card.getByRole('heading', { name: 'Gate 2: go to production' }).waitFor({ timeout: 15_000 });
    // The short digest is shown, the full one sent.
    await card.locator('code', { hasText: digest!.slice(0, 12) }).waitFor({ timeout: 5_000 });
    await card.getByRole('button', { name: 'Approve' }).click();
    await until(async () => sent.length === 1, 5_000, 'the decision POSTed');
    assert.deepEqual(JSON.parse(sent[0]!), { cycle_id: cycle, message: { type: 'decision', gate: 'gate_2', outcome: 'approved', digest } });
    await until(async () => (await state(cycle)) !== 'gate_2', 30_000, 'Gate 2 passed');
    await collect(p);
    assert.deepEqual(violations, []);
  } finally {
    account = A;
    await other.close();
  }
  assert.deepEqual(pageErrors, []);
});

test('an expired session says so, with a sign-in link, and keeps the page', { timeout: 60_000 }, async () => {
  account = B;
  const other = await newContext();
  const p = await other.newPage();
  try {
    await p.goto('/');
    await p.getByRole('link', { name: 'Sign in' }).click();
    await p.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 15_000 });
    await other.clearCookies();
    await p.getByLabel('Tool name').fill('Badges');
    await p.getByLabel('Owning service').fill('Facilities');
    await p.getByLabel('What you need').fill('Lend visitor badges');
    await p.getByRole('button', { name: 'Submit the request' }).click();
    const banner = p.locator('#expired');
    await banner.getByText('Your session has expired').waitFor({ timeout: 10_000 });
    await banner.getByRole('link', { name: 'Sign in' }).waitFor({ timeout: 5_000 });
    assert.equal(await p.getByLabel('What you need').inputValue(), 'Lend visitor badges');
  } finally {
    account = A;
    await other.close();
  }
});

test('requester B cannot open A’s cycle: 403 shown nicely; axe clean', { timeout: 60_000 }, async () => {
  account = B;
  const other = await newContext();
  const p = await other.newPage();
  try {
    await p.goto(`/cycles/${cycle}`);
    await p.getByRole('link', { name: 'Sign in' }).click();
    await p.waitForURL(`**/cycles/${cycle}`, { timeout: 15_000 });
    await p.getByRole('alert').filter({ hasText: 'This request is not yours' }).waitFor({ timeout: 15_000 });
    assert.equal(await p.locator('deep-chat').count(), 0);
    await p.getByRole('link', { name: 'All my requests' }).click();
    await p.getByText('No request yet.').waitFor({ timeout: 10_000 });
    await collect(p);
    await axe(p, 'refusal');
  } finally {
    account = A;
    await other.close();
  }
});

test('FR/EN switch: dictionary, <html lang>, deep-chat strings, remembered across reloads', { timeout: 60_000 }, async () => {
  // The French strings come from the page's own French dictionary.
  const fr = JSON.parse(readFileSync(new URL('../web/lang/fr.json', import.meta.url), 'utf8')) as Record<'list.title' | 'new.title' | 'chat.send' | 'ai.notice' | 'lang.label', string>;
  await page.goto(`/cycles/${cycle}`);
  await page.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 10_000 });
  await page.getByLabel('Language').selectOption('fr');
  await page.getByRole('heading', { name: fr['list.title'] }).waitFor({ timeout: 15_000 });
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'fr');
  assert.equal(await page.evaluate(() => localStorage.getItem('lang')), 'fr');
  await page.getByRole('link', { name: fr['new.title'] }).waitFor({ timeout: 10_000 });
  await page.locator(`deep-chat .input-button[aria-label="${fr['chat.send']}"]`).waitFor({ timeout: 10_000 });
  assert.ok((await page.locator('footer').innerText()).includes(fr['ai.notice'].split('.')[0]!));
  await page.reload();
  await page.getByRole('heading', { name: fr['list.title'] }).waitFor({ timeout: 15_000 });
  await page.goto('/');
  await page.getByRole('heading', { name: fr['list.title'] }).waitFor({ timeout: 10_000 });
  await capture(page, 'list-fr-light');
  await page.getByLabel(fr['lang.label']).selectOption('en');
  await page.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 15_000 });
  await collect(page);
  assert.deepEqual(violations, []);
  assert.deepEqual(pageErrors, []);
});

test('dark mode renders (screenshots when WEB_SCREENSHOTS is set)', { timeout: 60_000 }, async () => {
  const dark = await newContext('dark');
  const p = await dark.newPage();
  try {
    await p.goto('/');
    await p.getByRole('link', { name: 'Sign in' }).click();
    await p.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: 15_000 });
    await capture(p, 'list-dark');
    await p.goto(`/cycles/${cycle}`);
    await p.locator('deep-chat').getByText('Track the department’s key loans by site').waitFor({ timeout: 10_000 });
    await capture(p, 'conversation-dark');
    await collect(p);
  } finally {
    await dark.close();
  }
});
