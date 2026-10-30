// SEC-* kit on "requests": the core's test Compose stack (two instances in production posture behind Caddy,
// PostgreSQL, a real Keycloak with the test realm) started on this tool; the category reference list and the drafts
// working on the real database; the two-user specs (SEC-IDOR, SEC-URL) with the three people of the realm, each in
// their own Playwright context; then the twelve SEC-* generated from openapi.yaml, all green. Docker is required;
// Caddy listens on port 3000 (addresses of the test realm). KIT_KEEP=1 leaves the stack up at the end.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { REQUEST_HEADERS, signIn, httpBrowser } from '@eupadev/core/kit';
import { anonymous, callFrom, signedInContext } from '@eupadev/core/kit/two-users.js';
import { query } from '@eupadev/core/kit/throwaway-postgres.js';
import { argsK6, argsSchemathesis } from '@eupadev/core/kit/test-tools.js';
import { call, exampleFile, generateCases } from '@eupadev/core/kit/sec.js';
import { mailpit } from '@eupadev/core/kit/mailpit.js';
import { BASE, ROOT, compose, mailpitUrl, people, person, resetRateLimits, startStack, stopStack } from './stack.js';

let admin = '';
const reset = async () => { await resetRateLimits(admin); };

before(() => { admin = startStack(); });
after(stopStack);

describe('category reference list on the real database', () => {
  let cookie = '';
  before(async () => {
    await reset();
    const nav = httpBrowser();
    await signIn(nav, BASE, person('admin'));
    cookie = nav.cookies('localhost');
  });

  test('create, list, rename, deactivate; duplicate, stale version and unknown code refused', async () => {
    const created = await call(BASE, { method: 'POST', path: '/api/categories', body: { code: 'electricity', label: 'Electricity' }, cookie });
    assert.equal(created.status, 201, created.text);
    assert.deepEqual(created.json, { code: 'electricity', label: 'Electricity', active: true, version: 1 });
    assert.equal(created.headers.get('location'), '/api/categories/electricity');
    const duplicate = await call(BASE, { method: 'POST', path: '/api/categories', body: { code: 'electricity', label: 'Other' }, cookie });
    assert.equal(duplicate.json?.code, 'CATEGORY_EXISTS');

    const change = (/** @type {object} */ body) => call(BASE, { method: 'PATCH', path: '/api/categories/electricity', body, cookie });
    assert.deepEqual((await change({ label: 'General electricity', version: 1 })).json, { code: 'electricity', label: 'General electricity', active: true, version: 2 });
    const stale = await change({ active: false, version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json?.code, 'VERSION_CONFLICT');
    assert.equal((await change({ active: false, version: 2 })).json?.active, false);
    const unknown = await call(BASE, { method: 'PATCH', path: '/api/categories/unknown', body: { active: false, version: 1 }, cookie });
    assert.equal(unknown.status, 404);

    const codes = async (/** @type {Record<string, unknown>} */ q) => (await call(BASE, { path: '/api/categories', query: q, cookie })).json?.items.map((/** @type {{ code: string }} */ c) => c.code);
    assert.ok(!(await codes({})).includes('electricity'), 'deactivated: absent by default');
    assert.ok((await codes({ active: false })).includes('electricity'), 'deactivated: present with active=false');
  });
});

describe('draft requests and two-user specs (real Chromium, one context per person)', () => {
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Record<'alice' | 'bruno' | 'chloe', import('playwright').BrowserContext>} */ const ctx = /** @type {any} */ ({});
  before(async () => {
    browser = await chromium.launch();
    for (const [name, role] of /** @type {const} */ ([['alice', 'reader'], ['bruno', 'manager'], ['chloe', 'admin']])) ctx[name] = await signedInContext(browser, BASE, person(role));
    await reset();
    const r = await callFrom(ctx.chloe, BASE, 'POST', '/api/categories', { code: 'locksmith', label: 'Locksmith' });
    assert.ok([201, 409].includes(r.status), r.text);
  });
  after(async () => { await browser?.close(); });

  /** @param {import('playwright').BrowserContext} c @param {string} title @param {object} [more] */
  const create = async (c, title, more = {}) => {
    const r = await callFrom(c, BASE, 'POST', '/api/requests', { title, location: 'Dock 3', category: 'locksmith', urgency: 'high', ...more });
    assert.equal(r.status, 201, r.text);
    return r.json;
  };
  /** @param {import('playwright').BrowserContext} c @param {{ id: string, version: number }} d @param {object} body */
  const patch = (c, d, body) => callFrom(c, BASE, 'PATCH', `/api/requests/${d.id}`, { version: d.version, ...body });
  /** @param {import('playwright').BrowserContext} c @param {string} [q] */
  const ids = async (c, q = '') => (await callFrom(c, BASE, 'GET', `/api/requests?limit=200${q}`)).json.items.map((/** @type {{ id: string }} */ d) => d.id);

  test('create, read, edit a draft; stale version and inactive category refused', async () => {
    await reset();
    const d = await create(ctx.alice, 'Door of dock 3', { description: 'Does not close properly' });
    assert.deepEqual([d.status, d.version, d.category, d.description, d.requester_name], ['draft', 1, 'locksmith', 'Does not close properly', 'Alice Reader']);
    const read = (await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).json;
    assert.deepEqual({ ...read, history: undefined }, { ...d, attachment: null, history: undefined });
    assert.deepEqual(read.history.map((/** @type {any} */ h) => [h.from_status, h.to_status, h.actor_name]), [[null, 'draft', 'Alice Reader']]);
    const edited = await callFrom(ctx.alice, BASE, 'PATCH', `/api/requests/${d.id}`, { title: 'Door of dock 4', urgency: 'normal', version: 1 });
    assert.deepEqual([edited.status, edited.json.title, edited.json.urgency, edited.json.version], [200, 'Door of dock 4', 'normal', 2]);
    const stale = await callFrom(ctx.alice, BASE, 'PATCH', `/api/requests/${d.id}`, { title: 'x', version: 1 });
    assert.deepEqual([stale.status, stale.json.code], [409, 'VERSION_CONFLICT']);
    const inactive = await callFrom(ctx.alice, BASE, 'POST', '/api/requests', { title: 'x', location: 'y', category: 'electricity', urgency: 'low' });
    assert.deepEqual([inactive.status, inactive.json.code], [422, 'UNKNOWN_CATEGORY']);
  });

  test('list: newest first, cursor without duplicate or gap, filter by category, unreadable cursor refused', async () => {
    await reset();
    const created = [];
    for (const n of [1, 2, 3, 4, 5]) created.push((await create(ctx.bruno, `Leak ${n}`)).id);
    const seen = [];
    let rest = '';
    for (let page = 0; page < 10; page++) {
      const r = await callFrom(ctx.bruno, BASE, 'GET', `/api/requests?limit=2&category=locksmith${rest}`);
      assert.equal(r.status, 200, r.text);
      seen.push(...r.json.items.map((/** @type {{ id: string }} */ d) => d.id));
      if (r.json.next === null) break;
      rest = `&cursor=${r.json.next}`;
    }
    const mine = seen.filter((id) => created.includes(id));
    assert.deepEqual(mine, [...created].reverse(), 'descending order, each request once');
    assert.equal(new Set(seen).size, seen.length, 'no duplicate');
    assert.deepEqual(await ids(ctx.bruno, '&category=plumbing'), []);
    const unreadable = await callFrom(ctx.bruno, BASE, 'GET', '/api/requests?cursor=not-a-cursor');
    assert.deepEqual([unreadable.status, unreadable.json.code, unreadable.json.errors?.[0]?.pointer], [400, 'VALIDATION_FAILED', '/query/cursor']);
  });

  test('SEC-IDOR: bruno\'s draft cannot be found by chloe (manager, admin) nor by alice, to read or to write', async () => {
    await reset();
    const d = await create(ctx.bruno, 'Private draft of bruno');
    for (const name of /** @type {const} */ (['chloe', 'alice'])) {
      const read = await callFrom(ctx[name], BASE, 'GET', `/api/requests/${d.id}`);
      assert.deepEqual([read.status, read.json.code], [404, 'NOT_FOUND'], `${name} reads bruno's draft`);
      const written = await callFrom(ctx[name], BASE, 'PATCH', `/api/requests/${d.id}`, { title: 'hacked', version: 1 });
      assert.deepEqual([written.status, written.json.code], [404, 'NOT_FOUND'], `${name} edits bruno's draft`);
      assert.ok(!(await ids(ctx[name])).includes(d.id), `${name} sees bruno's draft in their list`);
    }
    assert.equal((await callFrom(ctx.bruno, BASE, 'GET', `/api/requests/${d.id}`)).json.title, 'Private draft of bruno');
  });

  test('SEC-IDOR: alice (requester) sees only her own requests, even those submitted by others; someone else\'s submitted request stays read-only', async () => {
    await reset();
    const d = await create(ctx.chloe, 'Request of chloe');
    assert.equal((await patch(ctx.chloe, d, { status: 'submitted' })).status, 200);
    const alice = await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`);
    assert.deepEqual([alice.status, alice.json.code], [404, 'NOT_FOUND']);
    const aliceId = (await create(ctx.alice, 'Request of alice')).requester_id;
    const aliceList = (await callFrom(ctx.alice, BASE, 'GET', '/api/requests?limit=200')).json.items;
    assert.ok(aliceList.every((/** @type {{ requester_id: string }} */ x) => x.requester_id === aliceId), 'alice sees only her own');
    const bruno = await callFrom(ctx.bruno, BASE, 'GET', `/api/requests/${d.id}`);
    assert.deepEqual([bruno.status, bruno.json.status], [200, 'submitted'], 'a manager sees the submitted request');
    const edit = await callFrom(ctx.bruno, BASE, 'PATCH', `/api/requests/${d.id}`, { title: 'x', version: 2 });
    assert.deepEqual([edit.status, edit.json.code], [422, 'NOT_EDITABLE']);
  });

  test('life cycle by PATCH: submit, take on, resolve with a note; roles, note, version and illegal pair refused; history', async () => {
    await reset();
    let d = await create(ctx.alice, 'Leaking tap');
    const refusal = async (/** @type {import('playwright').BrowserContext} */ c, /** @type {object} */ body) => {
      const r = await patch(c, d, body);
      return [r.status, r.json.code];
    };
    assert.deepEqual(await refusal(ctx.alice, { status: 'in_progress' }), [403, 'FORBIDDEN'], 'the requester does not take on');
    assert.deepEqual(await refusal(ctx.alice, { status: 'resolved', note: 'x' }), [403, 'FORBIDDEN']);
    assert.deepEqual(await refusal(ctx.alice, { note: 'x' }), [422, 'NOTE_UNEXPECTED']);
    d = (await patch(ctx.alice, d, { status: 'submitted' })).json;
    assert.deepEqual([d.status, d.version], ['submitted', 2], 'one transition = one version');
    assert.deepEqual(await refusal(ctx.bruno, { status: 'cancelled' }), [403, 'FORBIDDEN'], 'only the author cancels');
    assert.deepEqual(await refusal(ctx.alice, { title: 'x' }), [422, 'NOT_EDITABLE'], 'a submitted request can no longer be edited');
    d = (await patch(ctx.bruno, d, { status: 'in_progress' })).json;
    assert.equal(d.status, 'in_progress');
    assert.deepEqual(await refusal(ctx.bruno, { status: 'resolved' }), [422, 'NOTE_REQUIRED']);
    assert.deepEqual(await refusal(ctx.alice, { status: 'cancelled' }), [422, 'INVALID_TRANSITION'], 'in progress can no longer be cancelled (refused by the database)');
    const stale = await callFrom(ctx.bruno, BASE, 'PATCH', `/api/requests/${d.id}`, { status: 'resolved', note: 'x', version: 2 });
    assert.deepEqual([stale.status, stale.json.code], [409, 'VERSION_CONFLICT']);
    d = (await patch(ctx.bruno, d, { status: 'resolved', note: 'Seal replaced' })).json;
    assert.deepEqual([d.status, d.closing_note], ['resolved', 'Seal replaced']);
    assert.deepEqual(await refusal(ctx.bruno, { status: 'rejected', note: 'x' }), [422, 'INVALID_TRANSITION'], 'a final state no longer moves');
    const read = (await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).json;
    assert.deepEqual(read.history.map((/** @type {any} */ h) => [h.from_status, h.to_status, h.actor_name]),
      [[null, 'draft', 'Alice Reader'], ['draft', 'submitted', 'Alice Reader'], ['submitted', 'in_progress', 'Bruno Manager'], ['in_progress', 'resolved', 'Bruno Manager']]);
  });

  test('soft delete and restore: admin only; deleted = 404 everywhere, listed for the admin with deleted=true', async () => {
    await reset();
    let d = await create(ctx.alice, 'Hall lamp');
    d = (await patch(ctx.alice, d, { status: 'submitted' })).json;
    const remove = (/** @type {import('playwright').BrowserContext} */ c) => callFrom(c, BASE, 'DELETE', `/api/requests/${d.id}`);
    assert.deepEqual([(await remove(ctx.bruno)).status, (await remove(ctx.alice)).status], [403, 403], 'manager and requester do not delete');
    assert.equal((await remove(ctx.chloe)).status, 204);
    for (const name of /** @type {const} */ (['alice', 'chloe'])) {
      assert.equal((await callFrom(ctx[name], BASE, 'GET', `/api/requests/${d.id}`)).status, 404, `${name} reads a deleted request`);
      assert.ok(!(await ids(ctx[name])).includes(d.id), `${name} sees it in their list`);
    }
    assert.equal((await remove(ctx.chloe)).status, 404, 'already deleted');
    assert.deepEqual((await patch(ctx.alice, d, { title: 'x' })).status, 404);
    assert.deepEqual((await callFrom(ctx.bruno, BASE, 'GET', '/api/requests?deleted=true')).status, 403);
    const deleted = (await callFrom(ctx.chloe, BASE, 'GET', '/api/requests?deleted=true&limit=200')).json.items.find((/** @type {any} */ x) => x.id === d.id);
    assert.equal(deleted.version, d.version + 1, 'deleting changes the version');
    assert.equal((await patch(ctx.bruno, deleted, { restore: true })).status, 403);
    const restored = await patch(ctx.chloe, deleted, { restore: true });
    assert.deepEqual([restored.status, restored.json.status], [200, 'submitted']);
    assert.equal((await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).status, 200);
    const nothing = await patch(ctx.chloe, restored.json, { restore: true });
    assert.deepEqual([nothing.status, nothing.json.code], [422, 'NOT_DELETED'], 'nothing to restore');
  });

  test('streamed CSV export: manager and admin, scope and filters of the list, escaped cells, more than one page', async () => {
    await reset();
    const r = await callFrom(ctx.chloe, BASE, 'POST', '/api/categories', { code: 'export', label: 'Export' });
    assert.ok([201, 409].includes(r.status), r.text);
    const trap = await create(ctx.bruno, '=HYPERLINK("x") "dock", 3', { category: 'export', description: 'line 1\nline 2' });
    // 520 drafts of bruno in one statement, same created_at (one transaction): the cursor breaks ties by id.
    await query(admin, `WITH who AS (SELECT set_config('search_path', 'app', true), set_config('app.actor_id', $1, true), set_config('app.request_id', 'bench', true)),
      n AS (INSERT INTO app.requests (category_code, urgency, requester_id) SELECT 'export', 'low', $1::uuid FROM who, generate_series(1, 520) RETURNING id)
      INSERT INTO app.request_details (request_id, title, description, location) SELECT id, 'Batch', '', 'Dock' FROM n`, [trap.requester_id]);
    const download = (/** @type {import('playwright').BrowserContext} */ c, /** @type {string} */ q) => c.request.fetch(`${BASE}/files/requests.csv${q}`, { headers: { ...REQUEST_HEADERS }, maxRedirects: 0 });

    const res = await download(ctx.bruno, '?category=export');
    assert.equal(res.status(), 200);
    assert.equal(res.headers()['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.headers()['content-disposition'], "attachment; filename*=UTF-8''requests.csv");
    const text = (await res.body()).toString('utf8');
    assert.ok(text.startsWith('﻿id,created_at,updated_at,status,urgency,category,title,description,location,requester_name,closing_note\r\n'));
    const lines = text.split('\r\n').filter((l) => /^"[0-9a-f-]{36}"/.test(l));
    assert.equal(lines.length, 521, 'one line per request, no duplicate or gap between the pages');
    assert.equal(new Set(lines.map((l) => l.slice(1, 37))).size, 521);
    assert.ok(text.includes(`"${trap.id}"`) && text.includes('"\'=HYPERLINK(""x"") ""dock"", 3","line 1\nline 2"'), 'formula neutralised, quotes doubled');

    const semicolon = await (await download(ctx.bruno, '?category=export&separator=semicolon')).text();
    assert.ok(semicolon.startsWith('﻿id;created_at;updated_at;status;'), 'semicolon header');
    assert.ok(semicolon.includes('"\'=HYPERLINK(""x"") ""dock"", 3";"line 1\nline 2"'), 'same cells, other separator');
    assert.equal((await download(ctx.chloe, '?category=export')).status(), 200);
    assert.ok(!(await (await download(ctx.chloe, '?category=export')).text()).includes(trap.id), 'bruno\'s drafts stay private, export included');
    assert.ok(!(await (await download(ctx.bruno, '?category=export&status=submitted')).text()).includes(trap.id), 'filter by status');
    assert.equal((await download(ctx.alice, '')).status(), 403, 'the requester does not export');
    assert.equal((await download(ctx.bruno, '?status=unknown')).status(), 400);
  });

  test('attachment: one file per request, who may change it and when, downloaded as an attachment', async () => {
    await reset();
    const d = await create(ctx.alice, 'Photo of the leak');
    /** @param {import('playwright').BrowserContext} c @param {string} method @param {{ type: string, body: Buffer }} [f] @param {string} [name] */
    const send = async (c, method, f, name) => {
      const r = await c.request.fetch(`${BASE}/api/requests/${d.id}/attachment${name ? `?name=${encodeURIComponent(name)}` : ''}`,
        { method, headers: { ...REQUEST_HEADERS, ...(f ? { 'content-type': f.type } : {}) }, ...(f ? { data: f.body } : {}), maxRedirects: 0 });
      return { status: r.status(), json: r.status() === 204 ? null : await r.json() };
    };
    const png = { type: 'image/png', body: exampleFile('image/png', 2048) };
    const pdf = { type: 'application/pdf', body: exampleFile('application/pdf', 300) };

    // A non-ASCII file name (an en dash): the download header encodes it (RFC 8187).
    const put = await send(ctx.alice, 'PUT', png, 'leak – hall.png');
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.deepEqual({ ...put.json, created_at: undefined }, { name: 'leak – hall.png', media_type: 'image/png', size: 2048, created_at: undefined });
    assert.equal((await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).json.attachment.name, 'leak – hall.png');
    const dl = await ctx.alice.request.fetch(`${BASE}/files/requests/${d.id}/attachment`, { headers: { ...REQUEST_HEADERS } });
    assert.equal(dl.status(), 200);
    assert.equal(dl.headers()['content-type'], 'image/png');
    assert.equal(dl.headers()['content-disposition'], "attachment; filename*=UTF-8''leak%20%E2%80%93%20hall.png");
    assert.deepEqual(await dl.body(), png.body);

    assert.equal((await send(ctx.bruno, 'PUT', pdf)).status, 404, 'a draft is invisible to the manager');
    assert.equal((await send(ctx.alice, 'PUT', { type: 'image/png', body: Buffer.from('<html>') })).json.code, 'FILE_TYPE_MISMATCH');
    await reset(); // uploadAttachment allows 5 a minute
    for (const name of ['a/b.png', 'a\u001fb.png', 'a\u0085b.png', 'a\u009fb.png']) assert.equal((await send(ctx.alice, 'PUT', png, name)).json?.code, 'VALIDATION_FAILED', JSON.stringify(name));
    await reset();
    const submitted = (await patch(ctx.alice, (await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).json, { status: 'submitted' })).json;
    const replaced = await send(ctx.bruno, 'PUT', pdf);
    assert.deepEqual([replaced.status, replaced.json.name, replaced.json.media_type], [200, 'attachment.pdf', 'application/pdf'], 'the manager replaces it');
    assert.deepEqual([(await send(ctx.bruno, 'DELETE')).json.code], ['FORBIDDEN'], 'the manager never removes');
    assert.equal((await send(ctx.alice, 'DELETE')).status, 204, 'the author removes while submitted');
    assert.equal((await send(ctx.alice, 'DELETE')).status, 204, 'removing it again is done already');
    assert.equal((await callFrom(ctx.alice, BASE, 'GET', `/api/requests/${d.id}`)).json.attachment, null);
    await patch(ctx.bruno, submitted, { status: 'in_progress' });
    assert.equal((await send(ctx.alice, 'PUT', png)).json.code, 'NOT_EDITABLE', 'the author no longer changes it once in progress');
    assert.equal((await send(ctx.chloe, 'PUT', png)).status, 200, 'the administrator still does');
    assert.equal((await send(ctx.chloe, 'DELETE')).status, 204);
  });

  test('mail: a submission goes to the managers\' mailbox, a rejection to the requester with its reason and a link', async () => {
    await reset();
    const box = mailpit(mailpitUrl());
    const d = await create(ctx.alice, `Mail check ${Date.now()}`);
    const submitted = (await patch(ctx.alice, d, { status: 'submitted' })).json;
    const toManagers = await box.waitFor((m) => m.subject === `New request: ${d.title}`);
    assert.deepEqual(toManagers.to, ['maintenance@example.test']);
    assert.equal((await patch(ctx.bruno, submitted, { status: 'rejected', note: 'Not our scope' })).status, 200);
    const rejection = await box.waitFor((m) => m.subject === `Your request is rejected: ${d.title}`);
    assert.deepEqual(rejection.to, ['alice@example.test']);
    assert.match(rejection.text, /Reason: Not our scope/);
    assert.ok(rejection.text.includes(`http://localhost:3000/#/requests/${d.id}`), rejection.text);
    assert.equal((await box.list()).filter((m) => m.subject.endsWith(d.title)).length, 2, 'nobody else, nothing more');
  });

  test('mail: SMTP down, the change is made all the same, logged with an error_id, never a 500', async () => {
    await reset();
    const d = await create(ctx.alice, `Mail down ${Date.now()}`);
    compose(['stop', 'mailpit']);
    try {
      const r = await patch(ctx.alice, d, { status: 'submitted' });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.status, 'submitted');
      const logged = async () => compose(['logs', '--no-log-prefix', 'tool-1', 'tool-2']).split('\n')
        .find((l) => l.includes('"event":"mail_failed"') && l.includes(d.id));
      let line;
      for (let i = 0; i < 50 && !(line = await logged()); i++) await new Promise((ok) => { setTimeout(ok, 200); });
      assert.ok(line, 'mail_failed logged for this request');
      assert.match(JSON.parse(line).error_id, /^[0-9a-f-]{36}$/);
    } finally {
      compose(['start', 'mailpit']);
    }
  });

  test('SEC-URL: the attachment link opened without a session → 401, by another person → 404', async () => {
    await reset();
    const d = await create(ctx.alice, 'Shared attachment link');
    const r = await ctx.alice.request.fetch(`${BASE}/api/requests/${d.id}/attachment`, { method: 'PUT', headers: { ...REQUEST_HEADERS, 'content-type': 'image/png' }, data: exampleFile('image/png') });
    assert.equal(r.status(), 200);
    const link = `${BASE}/files/requests/${d.id}/attachment`;
    const stranger = await anonymous(browser);
    assert.equal((await stranger.request.fetch(link, { headers: { ...REQUEST_HEADERS }, maxRedirects: 0 })).status(), 401);
    await stranger.close();
    assert.equal((await ctx.bruno.request.fetch(link, { headers: { ...REQUEST_HEADERS } })).status(), 404);
  });

  test('SEC-URL: the address of a request opened without a session → 401, by another person → 404', async () => {
    await reset();
    const d = await create(ctx.alice, 'Link shared by alice');
    const stranger = await anonymous(browser);
    const r = await callFrom(stranger, BASE, 'GET', `/api/requests/${d.id}`);
    assert.deepEqual([r.status, r.json.code], [401, 'UNAUTHENTICATED']);
    await stranger.close();
    assert.equal((await callFrom(ctx.bruno, BASE, 'GET', `/api/requests/${d.id}`)).status, 404);
  });
});

describe('SEC-* kit green (production posture, two instances)', () => {
  // SEC-ERR "forced failure": the database really refuses the read (privilege withdrawn for the time of the check),
  // without any trap in the tool's code.
  const cases = generateCases({ contract: `${ROOT}openapi.yaml`, base: BASE, people, inactivityMinutes: 30, reset, failures: [{ operationId: 'listCategories' }] });
  /** @param {() => Promise<void>} fn */
  const withoutRead = async (fn) => {
    await query(admin, 'REVOKE SELECT ON app.categories FROM core_app');
    try { await fn(); } finally { await query(admin, 'GRANT SELECT ON app.categories TO core_app'); }
  };
  test('the twelve SEC-* are generated', () => {
    assert.deepEqual([...new Set(cases.map((c) => c.sec))].sort(), ['SEC-AUTH', 'SEC-BYPASS', 'SEC-COOKIE', 'SEC-CSRF', 'SEC-ERR', 'SEC-HEAD', 'SEC-MASS', 'SEC-RATE', 'SEC-ROLE', 'SEC-STATIC', 'SEC-UPLOAD', 'SEC-VALID']);
  });
  for (const c of cases) test(c.name, c.name.endsWith('forced failure') ? () => withoutRead(c.verify) : c.verify);
});

describe('k6 on the two main reads (tests/perf/load.k6.js)', () => {
  test('one VU per realm person, 15 lists and 15 reads each, every check passes, p(95) under 300 ms', async () => {
    /** @type {string[]} */ const cookies = [];
    for (const p of people) {
      const nav = httpBrowser();
      await signIn(nav, BASE, p);
      cookies.push(nav.cookies('localhost'));
      // Each person sees at least one request: a submitted one of their own.
      const d = await call(BASE, { method: 'POST', path: '/api/requests', body: { title: `Load ${p.name}`, location: 'Dock 1', category: 'locksmith', urgency: 'low' }, cookie: cookies.at(-1) });
      assert.equal(d.status, 201, d.text);
      assert.equal((await call(BASE, { method: 'PATCH', path: `/api/requests/${d.json.id}`, body: { status: 'submitted', version: 1 }, cookie: cookies.at(-1) })).status, 200);
    }
    await reset();
    const r = await promisify(execFile)('docker', argsK6({ base: BASE, cookies, dir: ROOT, script: 'tests/perf/load.k6.js', options: ['--quiet'] }),
      { maxBuffer: 1 << 26 }).then((x) => ({ code: 0, output: x.stdout }), (/** @type {any} */ e) => ({ code: e.code, output: `${e.stdout}${e.stderr}` }));
    assert.equal(r.code, 0, r.output.slice(-4000));
    assert.match(r.output, /http_reqs\D+90\b/, 'ninety requests');
  });
});

describe('Schemathesis on openapi.yaml, blocking (step 8)', () => {
  test('every default check passes, zero failures', async () => {
    const nav = httpBrowser();
    await signIn(nav, BASE, person('admin'));
    await reset();
    // Rate-limit windows are cleared in the background while it runs (K4): 429 is declared, but a run that only meets
    // 429 would test nothing.
    const clear = setInterval(() => { reset().catch(() => {}); }, 300);
    try {
      const r = await promisify(execFile)('docker', argsSchemathesis({ contract: `${ROOT}openapi.yaml`, config: `${ROOT}schemathesis.toml`, base: BASE, cookie: nav.cookies('localhost'),
        options: ['--seed', '1', '--max-examples', '30'] }), { maxBuffer: 64 * 1024 * 1024 }).then(() => null, (/** @type {any} */ e) => e);
      assert.equal(r, null, `${r?.stdout?.slice(-12000)}${r?.stderr?.slice(-2000)}`);
    } finally {
      clearInterval(clear);
    }
  });
});
