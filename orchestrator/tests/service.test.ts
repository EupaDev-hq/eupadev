// E0: the engine as a service — automatic fake outside world, only the humans
// answer; real DBOS + throwaway PostgreSQL. I0 (ADR-017): the API requires an access token from the fake IdP
// (tests/helpers/fake-oidc.ts); the hats come from the token, the identity never from the body.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '../src/api.ts';
import type { Hat } from '../src/auth.ts';
import { automaticFakes, launchFakeWatcher, type FakeEngine } from '../src/external/fakes.ts';
import { STATES } from '../src/machine/states.ts';
import type { Message } from '../src/messages.ts';
import { Orchestrator } from '../src/orchestrator.ts';
import { startPostgres, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';
import { ADMIN, ADMIN_MAIL, hats, REQUESTER, REQUESTER_MAIL, ENV_TEST, insertTestActors, SUBJECTS } from './helpers/bench.ts';
import { CLIENT_WEB_TEST, startFakeOidc, TEST_ISSUER, WEB_TEST_PASSWORD, type Account, type FakeOidc } from './helpers/fake-oidc.ts';
import { LOGIN_COOKIE, SESSION_COOKIE } from '../src/web-session.ts';

let postgres: ThrowawayPostgres;
let oidc: FakeOidc;
let orch: Orchestrator;
let stopWatcher: () => void;
let api: http.Server;
let port: number;
/** Tokens of the two test humans (subjects `admin` and `requester` at the fake IdP, linked to the actors ADMIN and REQUESTER). */
let TOKEN: Record<string, string>;

async function start(variablesEnPlus: Record<string, string> = {}): Promise<void> {
  // Chat step 2: the web client is configured (the fake IdP serves its token endpoint beside the JWKS); the redirect URL
  // is the page's origin, not this test server's port: the engine never compares it with the request's Host.
  const web = { OIDC_WEB_CLIENT_ID: CLIENT_WEB_TEST, OIDC_WEB_CLIENT_SECRET: WEB_TEST_PASSWORD, OIDC_WEB_REDIRECT_URL: 'http://localhost:8080/auth/callback' };
  const variables: Record<string, string> = { ...ENV_TEST, OIDC_JWKS_URL: oidc.jwksUrl, ...web, ...variablesEnPlus, ORCH_DATABASE_URL: postgres.engineUrl };
  orch = await Orchestrator.start(automaticFakes(variables['TOOL_DOMAIN']!), variables, { onLockLoss: () => {} });
  await insertTestActors(orch.base.pool);
  stopWatcher = launchFakeWatcher(orch, 50);
  api = createApi(orch).listen(0, '127.0.0.1');
  await once(api, 'listening');
  port = (api.address() as AddressInfo).port;
}
async function stop(): Promise<void> {
  stopWatcher();
  api.close();
  await orch.stop();
}

interface Response { status: number; type: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }
/**
 * Request to the local API like `curl`; default headers: Host localhost, X-EupaDev: 1, Authorization of the requester
 * (or of the message's actor, `who`). `null` removes a header.
 */
function call(method: string, path: string, body?: unknown, headers: Record<string, string | null> = {}, who: string = REQUESTER.id): Promise<Response> {
  const all: Record<string, string | null> = { Host: `localhost:${port}`, 'X-EupaDev': '1', Authorization: `Bearer ${TOKEN[who] ?? TOKEN[REQUESTER.id]}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
  const chosen = Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== null));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: method, path: path, headers: chosen }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'] ?? '', body: text === '' ? {} : JSON.parse(text) as Record<string, unknown>, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
/** `POST /messages` body of a human message: without identity (it comes from the token), sent by the message's actor. */
const posterMessage = (cycle: number, m: Message, headers: Record<string, string | null> = {}, who?: string) => {
  const { actor_id: actor_id, ...rest } = m as Message & { actor_id?: string };
  return call('POST', '/messages', { cycle_id: cycle, message: rest }, headers, who ?? actor_id);
};
let keyCounter = 0;
const newKey = () => `test-${process.pid}-${++keyCounter}`;
const PROBLEM = /^application\/problem\+json/;

before(async () => {
  [postgres, oidc] = await Promise.all([startPostgres(), startFakeOidc()]);
  const token = (id: string, mail: string, roles: readonly Hat[]) => oidc.token({ subject: SUBJECTS[id]!, mail, name: mail, roles });
  TOKEN = { [REQUESTER.id]: await token(REQUESTER.id, REQUESTER_MAIL, REQUESTER.roles), [ADMIN.id]: await token(ADMIN.id, ADMIN_MAIL, ADMIN.roles) };
  await start();
}, { timeout: 180_000 });

after(async () => {
  await stop().catch(() => {});
  await oidc?.stop();
  postgres?.remove();
});

const GATES = new Set<string>(STATES.filter((e) => e.kind === 'gate').map((e) => e.id));

/** What an "all is well" human answers in a state waiting for them, otherwise undefined (the rest of the world answers alone). */
function humanAnswer(state: string, candidateDigest: string | null): Message | undefined {
  if (state === 'waiting_scoping_feedback') return { type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id };
  if (state === 'waiting_preview_feedback') return { type: 'preview_feedback', outcome: 'satisfied', actor_id: REQUESTER.id };
  if (GATES.has(state)) return { type: 'decision', gate: state as never, outcome: 'approved', actor_id: ADMIN.id, ...(state === 'gate_2' && candidateDigest !== null ? { digest: candidateDigest } : {}) };
  return undefined;
}

/** Drives a cycle as a human up to its end: `read` gives the state, `send` drops off the answer (once per pass). */
async function driveAsHuman(
  read: () => Promise<{ state: string; visit: number; finished: boolean; candidate_digest: string | null }>,
  send: (m: Message) => Promise<void>,
  timeoutMs = 90_000,
): Promise<string> {
  const limit = Date.now() + timeoutMs;
  const handled = new Set<string>();
  for (;;) {
    const c = await read();
    if (c.finished) return c.state;
    if (Date.now() > limit) throw new Error(`cycle stuck in ${c.state}`);
    const m = humanAnswer(c.state, c.candidate_digest);
    if (m !== undefined && !handled.has(`${c.state}#${c.visit}`)) {
      handled.add(`${c.state}#${c.visit}`);
      await send(m);
    }
    await sleep(50);
  }
}
/** Reads the state through the API, as the admin by default (an admin reads every cycle; a requester only her own). */
const readByApi = (cycle: number, who: string = ADMIN.id) => async () => {
  const e = await call('GET', `/requests/${cycle}`, undefined, {}, who);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  return { state: e.body['state'] as string, visit: e.body['visit'] as number, finished: e.body['finished_at'] !== null, candidate_digest: e.body['candidate_digest'] as string | null };
};

test('E0: automatic fakes — a request goes all the way to end_success, only the humans answer', { timeout: 120_000 }, async () => {
  const { cycle_id } = await orch.newRequest({ type: 'creation', name: 'Car fleet', slug: 'car-fleet', owner_service: 'logistics', need: 'Track the department’s vehicles' }, REQUESTER);
  const end = await driveAsHuman(async () => {
    const c = await orch.base.readCycle(cycle_id);
    return { state: c.state, visit: c.visit, finished: c.finished_at !== null, candidate_digest: await orch.base.candidateDigest(cycle_id) };
  }, async (m) => { await orch.send(cycle_id, m, hats(m)); });
  assert.equal(end, 'end_success');
  // The fake watcher sent the green CI and the green Preview pipeline; the agent engine answered every role on its own.
  const h = await orch.base.pool.query<{ trigger: string }>('SELECT trigger FROM tool_history WHERE cycle_id = $1 ORDER BY id', [cycle_id]);
  const triggers = h.rows.map((r) => r.trigger);
  assert.ok(triggers.includes('event:ci_finished:green'));
  assert.ok(triggers.includes('event:preview_pipeline_finished:green'));
  assert.equal((orch.external.engine as FakeEngine).switchboard.pending.length, 0, 'no task waiting for a scripted answer');
});

test('E0: local API — a request through POST /requests, driven by GET /requests/<id> and POST /messages all the way to end_success', { timeout: 120_000 }, async () => {
  assert.deepEqual((await call('GET', '/health', undefined, { Authorization: null })).body, { status: 'ok', pause_agents: false });
  const request = { type: 'creation', name: 'Key register', slug: 'key-register', owner_service: 'security', need: 'Track the department’s vehicles' };
  const key = newKey();
  const r = await call('POST', '/requests', request, { 'Idempotency-Key': key });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cycle = r.body['cycle_id'] as number;
  // Replay of the same key: same response, no duplicate (a single tool, a single cycle).
  const replay = await call('POST', '/requests', request, { 'Idempotency-Key': key });
  assert.deepEqual([replay.status, replay.body], [201, r.body]);
  const n = await orch.base.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM cycles c JOIN tools o ON o.id = c.tool_id WHERE o.slug = $1', ['key-register']);
  assert.equal(n.rows[0]!.n, 1);
  // The tool's requester is the authenticated person, never a field of the body.
  assert.equal((await orch.base.readCycle(cycle)).requester_id, REQUESTER.id);

  const end = await driveAsHuman(readByApi(cycle), async (m) => {
    const messageKey = newKey();
    const sending = await posterMessage(cycle, m, { 'Idempotency-Key': messageKey });
    assert.equal(sending.status, 202, JSON.stringify(sending.body));
    // Replay of the same key: same result, the message is not dropped off again (the cycle may have changed state meanwhile).
    const messageReplay = await posterMessage(cycle, m, { 'Idempotency-Key': messageKey });
    assert.deepEqual([messageReplay.status, messageReplay.body], [202, sending.body]);
  });
  assert.equal(end, 'end_success');
  const decisions = await orch.base.pool.query<{ n: number; actors: string[]; roles: string[] }>('SELECT count(*)::int AS n, array_agg(actor) AS actors, array_agg(role) AS roles FROM approvals WHERE cycle_id = $1', [cycle]);
  assert.equal(decisions.rows[0]!.n, 2, 'Gate 1 and Gate 2, one approval each despite the replays');
  assert.deepEqual([decisions.rows[0]!.actors, decisions.rows[0]!.roles], [[ADMIN_MAIL, ADMIN_MAIL], ['admin', 'admin']], 'actor and hat read from the token');
});

test('E0: local API — guard-rails (Host, required header, Idempotency-Key, strict body, RFC 9457)', { timeout: 60_000 }, async () => {
  const request = { type: 'creation', name: 'Guard', slug: 'guard', owner_service: 'security', need: 'Track the department’s vehicles' };
  const noHeader = await call('POST', '/requests', request, { 'Idempotency-Key': newKey(), 'X-EupaDev': null });
  assert.equal(noHeader.status, 403);
  assert.match(noHeader.type, PROBLEM);
  assert.equal(noHeader.body['status'], 403);
  assert.equal((await call('GET', '/health', undefined, { 'X-EupaDev': null })).status, 403);
  const host = await call('GET', '/health', undefined, { Host: 'attacker.example:8080' });
  assert.equal(host.status, 421);
  assert.match(host.type, PROBLEM);
  assert.equal((await call('GET', '/health', undefined, { Host: 'localhost.attacker.example' })).status, 421);
  assert.equal((await call('GET', '/health', undefined, { Host: '127.0.0.1' })).status, 200);
  assert.equal((await call('GET', '/health', undefined, { Host: '[::1]:9' })).status, 200);
  // Chat step 5: the page's own name (DASHBOARD_URL, here https://forge.example.test/dashboard) is accepted too, nothing else.
  assert.equal((await call('GET', '/health', undefined, { Host: 'forge.example.test' })).status, 200);
  assert.equal((await call('GET', '/health', undefined, { Host: 'Forge.Example.Test:443' })).status, 200);
  assert.equal((await call('GET', '/health', undefined, { Host: 'evil-forge.example.test' })).status, 421);
  assert.equal((await call('GET', '/health', undefined, { Host: 'forge.example.test.attacker.example' })).status, 421);
  // Without the variable: loopback only (the page `/` is served before any call to the orchestrator).
  const local = createApi(Object.create(orch, { config: { value: { ...orch.config, dashboardUrl: '' } } }) as Orchestrator).listen(0, '127.0.0.1');
  await once(local, 'listening');
  try {
    const p = (local.address() as AddressInfo).port;
    const page = (host: string) => new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: p, path: '/', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject);
    });
    assert.equal(await page('forge.example.test'), 421);
    assert.equal(await page(`localhost:${p}`), 200);
  } finally {
    local.close();
  }

  const noKey = await call('POST', '/requests', request);
  assert.equal(noKey.status, 400);
  assert.match(String(noKey.body['detail']), /Idempotency-Key/);
  // I0: the identity never comes from the body — `requester`, `author`, `actor` are unknown properties (400).
  for (const body of [{ ...request, unknown: 1 }, { ...request, requester: REQUESTER_MAIL }, { ...request, slug: 'Not A Slug' }, { type: 'creation' }, { ...request, name: '   ' }, { ...request, need: undefined }, { ...request, need: '   ' }, { type: 'evolution', tool_id: 1 }, '{ not json']) {
    const r = await call('POST', '/requests', body, { 'Idempotency-Key': newKey() });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.type, PROBLEM);
  }
  for (const message of [{ type: 'cancellation', actor: ADMIN_MAIL }, { type: 'scoping_feedback', outcome: 'satisfied', author: REQUESTER_MAIL }, { type: 'decision', gate: 'gate_1', outcome: 'approved', actor_id: ADMIN.id }, { type: 'cancellation', hat: 'admin' }, { type: 'decision', gate: 'gate_2', outcome: 'approved', four_eyes_exemption: true }]) {
    assert.equal((await call('POST', '/messages', { cycle_id: 1, message }, { 'Idempotency-Key': newKey() }, ADMIN.id)).status, 400, JSON.stringify(message));
  }
  assert.equal((await call('POST', '/requests', JSON.stringify(request), { 'Idempotency-Key': newKey(), 'Content-Type': 'text/plain' })).status, 415);
  // A forge signal never comes in through the API: nobody can declare a green CI there.
  const ci = await call('POST', '/messages', { cycle_id: 1, message: { type: 'ci_finished', outcome: 'green', digest: `sha256:${'0'.repeat(64)}`, checks: [] } }, { 'Idempotency-Key': newKey() });
  assert.equal(ci.status, 400);
  // Same key, other content or other route: refused (422), without creating anything.
  const key = newKey();
  assert.equal((await call('POST', '/requests', request, { 'Idempotency-Key': key })).status, 201);
  const other = await call('POST', '/requests', { ...request, name: 'Other' }, { 'Idempotency-Key': key });
  assert.equal(other.status, 422);
  assert.match(other.type, PROBLEM);
  assert.equal((await call('POST', '/messages', { cycle_id: 1, message: { type: 'cancellation' } }, { 'Idempotency-Key': key })).status, 422);
  const guard = await orch.base.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM tools WHERE name = $1', ['Other']);
  assert.equal(guard.rows[0]!.n, 0);
  // Refusal by the engine: unknown cycle (404), message pointless in the current state (409), exact text returned.
  assert.equal((await call('GET', '/requests/999999')).status, 404);
  const unknown = await call('POST', '/messages', { cycle_id: 999999, message: { type: 'cancellation' } }, { 'Idempotency-Key': newKey() }, ADMIN.id);
  assert.equal(unknown.status, 404);
  const noObject = await call('POST', '/messages', { cycle_id: 1, message: { type: 'decision', gate: 'gate_1', outcome: 'approved' } }, { 'Idempotency-Key': newKey() }, ADMIN.id);
  assert.equal(noObject.status, 409);
  assert.match(String(noObject.body['detail']), /finished|no decision expected/);
  assert.equal((await call('DELETE', '/requests')).status, 405);
  assert.equal((await call('GET', '/elsewhere')).status, 404);
});

test('Need of the request: first message of the chat (requester hat), read by scoping from iteration 1, never doubled on replay', { timeout: 60_000 }, async () => {
  const need = 'I want to track badge loans: who, when, returned or not.';
  const request = { type: 'creation', name: 'Badge loans', slug: 'badge-loans', owner_service: 'security', need: need };
  const key = newKey();
  const r = await call('POST', '/requests', request, { 'Idempotency-Key': key });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call('POST', '/requests', request, { 'Idempotency-Key': key })).status, 201);
  const { cycle_id: cycle, tool_id: tool } = r.body as { cycle_id: number; tool_id: number };
  const engine = orch.external.engine as FakeEngine;
  let first: Record<string, unknown> | undefined;
  for (let i = 0; i < 400 && first === undefined; i++) {
    first = engine.switchboard.log.find((j) => j.input.role === 'scoping' && j.input.task_id.startsWith(`${tool}-${cycle}-`))?.input.context;
    if (first === undefined) await sleep(50);
  }
  assert.ok(first !== undefined, 'no scoping task launched');
  const chat = first['chat'] as { author_type: string; content: string }[];
  assert.deepEqual({ author_type: chat[0]?.author_type, content: chat[0]?.content }, { author_type: 'requester', content: need });
  const n = await orch.base.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE cycle_id = $1 AND content = $2', [cycle, need]);
  assert.equal(n.rows[0]!.n, 1, 'replay of the same key: the need is written only once');
  await call('POST', '/messages', { cycle_id: cycle, message: { type: 'cancellation' } }, { 'Idempotency-Key': newKey() }, ADMIN.id);
});

test('E0: local API — identity (I0): no token 401, token of another issuer 401, no hat 403, requester who decides 403; /health stays open', { timeout: 60_000 }, async () => {
  const noToken = await call('GET', '/requests/1', undefined, { Authorization: null });
  assert.equal(noToken.status, 401);
  assert.match(noToken.type, PROBLEM);
  assert.match(String(noToken.headers['www-authenticate']), /^Bearer realm="eupadev-api"/);
  assert.equal((await call('POST', '/requests', { type: 'creation', name: 'X', slug: 'x-no-token', owner_service: 's', need: 'Track the department’s vehicles' }, { 'Idempotency-Key': newKey(), Authorization: null })).status, 401);
  assert.equal((await call('GET', '/requests/1', undefined, { Authorization: 'Basic YWRtaW46YWRtaW4=' })).status, 401);
  const other = await call('GET', '/requests/1', undefined, { Authorization: `Bearer ${await oidc.token({ subject: 'admin', roles: ['admin'] }, { issuer: 'https://other.example.test/realms/eupadev' })}` });
  assert.equal(other.status, 401);
  assert.match(String(other.headers['www-authenticate']), /error="invalid_token"/);
  assert.equal((await call('GET', '/requests/1', undefined, { Authorization: `Bearer ${await oidc.token({ subject: 'admin', roles: ['admin'] }, { typ: 'JWT' })}` })).status, 401);
  assert.equal((await call('GET', '/health', undefined, { Authorization: null })).status, 200, '/health: health check of the container, without a token');
  // Valid token but no hat (neither requester nor admin of the eupadev-api client): 403, nothing is created.
  const nobody = await oidc.token({ subject: 'nobody', roles: [] }, { claims: { realm_access: { roles: ['admin'] } } });
  const refuse = await call('POST', '/requests', { type: 'creation', name: 'Nobody', slug: 'nobody', owner_service: 's', need: 'Track the department’s vehicles' }, { 'Idempotency-Key': newKey(), Authorization: `Bearer ${nobody}` });
  assert.equal(refuse.status, 403, JSON.stringify(refuse.body));
  assert.match(String(refuse.body['detail']), /no EupaDev hat/);
  assert.equal((await orch.base.pool.query(`SELECT 1 FROM tools WHERE slug = 'nobody'`)).rowCount, 0);
  assert.equal((await call('GET', '/requests/1', undefined, { Authorization: `Bearer ${nobody}` })).status, 403, 'reading a cycle needs a hat too');
  // The actor was resolved all the same (first visit), by (issuer, subject).
  assert.equal((await orch.base.pool.query(`SELECT 1 FROM actor_identities WHERE subject = 'nobody'`)).rowCount, 1);
  // A requester neither decides nor cancels (403), whatever the state: authorisation comes before the state check.
  const r = await call('POST', '/requests', { type: 'creation', name: 'Decision', slug: 'requester-decision', owner_service: 's', need: 'Track the department’s vehicles' }, { 'Idempotency-Key': newKey() });
  assert.equal(r.status, 201);
  const cycle = r.body['cycle_id'] as number;
  const decision = await posterMessage(cycle, { type: 'decision', gate: 'gate_1', outcome: 'refused', actor_id: REQUESTER.id }, { 'Idempotency-Key': newKey() });
  assert.equal(decision.status, 403, JSON.stringify(decision.body));
  assert.match(String(decision.body['detail']), /admin hat required/);
  const cancellation = await posterMessage(cycle, { type: 'cancellation', actor_id: REQUESTER.id }, { 'Idempotency-Key': newKey() });
  assert.equal(cancellation.status, 403);
  assert.equal((await readByApi(cycle)()).finished, false, 'nothing was cancelled');
  assert.equal((await posterMessage(cycle, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() })).status, 202);
});

test('E0: local API — identity (I0): another requester does not judge the tool (403), an admin can; same idempotency key from two people = two requests', { timeout: 120_000 }, async () => {
  const key = newKey();
  const body = { type: 'creation', name: 'Two people', slug: 'two-people', owner_service: 's', need: 'Track the department’s vehicles' };
  const thirdParty = await oidc.token({ subject: 'third-party', mail: 'third-party@example.test', roles: ['requester'] });
  const byRequester = await call('POST', '/requests', body, { 'Idempotency-Key': key });
  assert.equal(byRequester.status, 201);
  const cycle = byRequester.body['cycle_id'] as number;
  // The `two-people` tool belongs to the requester: a third party with only the requester hat is refused, an admin is
  // accepted under their hat (short window: the bench's reminders go fast, hence the wait just before).
  const limit = Date.now() + 60_000;
  while ((await readByApi(cycle)()).state !== 'waiting_scoping_feedback') {
    if (Date.now() > limit) throw new Error('waiting_scoping_feedback never reached');
    await sleep(25);
  }
  const refuse = await call('POST', '/messages', { cycle_id: cycle, message: { type: 'scoping_feedback', outcome: 'satisfied' } }, { 'Idempotency-Key': newKey(), Authorization: `Bearer ${thirdParty}` });
  assert.equal(refuse.status, 403, JSON.stringify(refuse.body));
  assert.match(String(refuse.body['detail']), /reserved for the requester of tool/);
  const accepted = await posterMessage(cycle, { type: 'scoping_feedback', outcome: 'correction', text: 'The admin’s clarification', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  await sleep(300);
  const chat = await orch.base.pool.query<{ author_type: string; author: string }>(`SELECT author_type, author FROM messages WHERE cycle_id = $1 AND content = 'The admin’s clarification'`, [cycle]);
  assert.deepEqual(chat.rows, [{ author_type: 'admin', author: ADMIN_MAIL }], 'hat and name at the time of the facts');
  // Same key, another person: another request, neither a replay nor a conflict.
  const byAdmin = await call('POST', '/requests', { ...body, slug: 'two-people-bis' }, { 'Idempotency-Key': key }, ADMIN.id);
  assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
  assert.notEqual(byAdmin.body['cycle_id'], cycle, 'one person’s key is not the other’s');
  for (const c of [cycle, byAdmin.body['cycle_id'] as number]) assert.equal((await posterMessage(c, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() })).status, 202);
});

test('Chat step 1: a cycle and its chat are read only by the tool’s requester or an admin; "my requests"; since cursor', { timeout: 60_000 }, async () => {
  const stranger = { Authorization: `Bearer ${await oidc.token({ subject: 'third-party-reader', mail: 'third-party-reader@example.test', roles: ['requester'] })}` };
  const need = 'Track the department’s key loans';
  const create = async (slug: string, headers: Record<string, string> = {}, who?: string) => {
    const r = await call('POST', '/requests', { type: 'creation', name: slug, slug, owner_service: 's', need: need }, { 'Idempotency-Key': newKey(), ...headers }, who);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body['cycle_id'] as number;
  };
  const mine = await create('requester-chat');
  const theirs = await create('chat-third-party', stranger);
  const admins = await create('chat-admin', {}, ADMIN.id);

  // The requester reads her cycle and its chat (the need first); another requester is refused (403); the admin reads all.
  assert.equal((await call('GET', `/requests/${mine}`)).status, 200);
  const chat = await call('GET', `/requests/${mine}/messages`);
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const messages = chat.body['messages'] as { id: number; author_type: string; author: string; content: string; created_at: string }[];
  assert.deepEqual({ author_type: messages[0]?.author_type, author: messages[0]?.author, content: messages[0]?.content }, { author_type: 'requester', author: REQUESTER_MAIL, content: need });
  for (const [path, headers] of [[`/requests/${mine}`, stranger], [`/requests/${mine}/messages`, stranger], [`/requests/${admins}`, {}], [`/requests/${admins}/messages?since=0`, {}]] as const) {
    const refused = await call('GET', path, undefined, headers);
    assert.equal(refused.status, 403, `${path}: ${JSON.stringify(refused.body)}`);
    assert.match(refused.type, PROBLEM);
    assert.match(String(refused.body['detail']), /reserved for the requester of tool/);
  }
  for (const c of [mine, theirs, admins]) assert.equal((await call('GET', `/requests/${c}/messages`, undefined, {}, ADMIN.id)).status, 200);

  // Cursor: only messages with an id above `since`; a message written later is the only new one at the next poll.
  const last = messages.at(-1)!.id;
  await orch.base.writeMessage(await orch.base.readCycle(mine), 'admin', ADMIN.id, 'Clarification for the chat');
  const next = (await call('GET', `/requests/${mine}/messages?since=${last}`)).body['messages'] as { id: number; content: string }[];
  assert.deepEqual(next.map((x) => x.content).filter((x) => x === 'Clarification for the chat'), ['Clarification for the chat']);
  assert.ok(next.every((x) => x.id > last));
  for (const since of ['-1', 'abc', '1.5', '']) assert.equal((await call('GET', `/requests/${mine}/messages?since=${since}`)).status, 400, since);
  assert.equal((await call('GET', '/requests/999999/messages')).status, 404);
  assert.equal((await call('POST', `/requests/${mine}/messages`, {})).status, 405);

  // "My requests": one's own only; the admin sees all.
  const list = async (headers: Record<string, string> = {}, who?: string) => {
    const r = await call('GET', '/requests', undefined, headers, who);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body['requests'] as { cycle_id: number; slug: string; state: string; last_message_at: string | null }[];
  };
  const requester = await list();
  assert.ok(requester.some((d) => d.cycle_id === mine && d.slug === 'requester-chat' && d.last_message_at !== null));
  assert.ok(!requester.some((d) => d.cycle_id === theirs || d.cycle_id === admins));
  assert.deepEqual((await list(stranger)).map((d) => d.cycle_id), [theirs]);
  const admin = (await list({}, ADMIN.id)).map((d) => d.cycle_id);
  assert.ok([mine, theirs, admins].every((c) => admin.includes(c)));
  assert.equal((await call('DELETE', '/requests')).headers['allow'], 'GET, POST');
  for (const c of [mine, theirs, admins]) assert.equal((await posterMessage(c, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() })).status, 202);
});

test('Chat step 2: web sign-in — code + PKCE + state, cookie or Bearer = the same actor, X-EupaDev still required, unknown or expired = 401, logout', { timeout: 60_000 }, async () => {
  // Browser navigations: no Bearer, no custom header.
  const nav = { Authorization: null, 'X-EupaDev': null };
  const setCookies = (r: Response): string[] => ([] as string[]).concat(r.headers['set-cookie'] ?? []);
  const cookieOf = (r: Response, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`)) ?? null;
  const bare = (c: string) => c.split(';')[0]!;
  const requester: Account = { subject: SUBJECTS[REQUESTER.id]!, mail: REQUESTER_MAIL, name: REQUESTER_MAIL, roles: REQUESTER.roles };
  /** Starts a sign-in: the engine's redirect to Keycloak (checked), the transaction cookie, and the callback URL Keycloak would send `account` back to. */
  const start = async (account: Account, next = '/', lang?: string) => {
    const login = await call('GET', `/auth/login?next=${encodeURIComponent(next)}${lang === undefined ? '' : `&lang=${lang}`}`, undefined, nav);
    assert.equal(login.status, 303, JSON.stringify(login.body));
    const url = new URL(String(login.headers['location']));
    const q = url.searchParams;
    assert.equal(url.href.split('?')[0], `${TEST_ISSUER}/protocol/openid-connect/auth`);
    assert.deepEqual([q.get('client_id'), q.get('response_type'), q.get('scope'), q.get('code_challenge_method'), q.get('redirect_uri')], [CLIENT_WEB_TEST, 'code', 'openid', 'S256', 'http://localhost:8080/auth/callback']);
    // Chat step 5: the page's language reaches Keycloak as `ui_locales` (fr or en only; anything else is dropped).
    assert.equal(q.get('ui_locales'), lang === 'fr' || lang === 'en' ? lang : null, `lang=${lang}`);
    for (const p of ['code_challenge', 'state', 'nonce']) assert.match(q.get(p) ?? '', /^[A-Za-z0-9_-]{22,}$/, p);
    const transaction = cookieOf(login, LOGIN_COOKIE);
    assert.match(transaction ?? '', /^__Host-oidc=[A-Za-z0-9_-]+; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    return { callback: oidc.authorize(url.href, account), transaction: bare(transaction!) };
  };
  const finish = (callback: URL, transaction?: string) => call('GET', callback.pathname + callback.search, undefined, { ...nav, ...(transaction === undefined ? {} : { Cookie: transaction }) });

  // Forged state and missing transaction cookie are refused before any session exists.
  const first = await start(requester, '/cycles/1', 'fr');
  const forged = new URL(first.callback.href);
  forged.searchParams.set('state', 'forged-by-an-attacker');
  const refused = await finish(forged, first.transaction);
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.type, PROBLEM);
  assert.equal(cookieOf(refused, SESSION_COOKIE), null);
  assert.equal((await finish(first.callback)).status, 400, 'no transaction cookie');

  // The real callback: session cookie with the __Host- attributes, transaction cookie cleared, back to `next`; only the hash is stored.
  const ok = await finish(first.callback, first.transaction);
  assert.equal(ok.status, 303, JSON.stringify(ok.body));
  assert.equal(ok.headers['location'], '/cycles/1');
  const session = cookieOf(ok, SESSION_COOKIE);
  assert.match(session ?? '', /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=28800; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(setCookies(ok).some((c) => c.startsWith(`${LOGIN_COOKIE}=; Max-Age=0;`)), 'transaction cookie cleared');
  const value = bare(session!).split('=')[1]!;
  const stored = async (v: string) => (await orch.base.pool.query<{ raw: number; hashed: number }>(
    `SELECT count(*) FILTER (WHERE token_hash = convert_to($1, 'UTF8'))::int AS raw, count(*) FILTER (WHERE token_hash = sha256(convert_to($1, 'UTF8')) AND actor_id = $2)::int AS hashed FROM sessions`, [v, REQUESTER.id])).rows[0]!;
  assert.deepEqual(await stored(value), { raw: 0, hashed: 1 });
  const cookie = { Authorization: null, Cookie: bare(session!) };

  // Cookie = the same actor as the Bearer: a request made from the page belongs to REQUESTER and the CLI lists it.
  const created = await call('POST', '/requests', { type: 'creation', name: 'From the page', slug: 'from-the-page', owner_service: 's', need: 'Signed in with the cookie' }, { ...cookie, 'Idempotency-Key': newKey() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cycle = created.body['cycle_id'] as number;
  assert.equal((await orch.base.readCycle(cycle)).requester_id, REQUESTER.id);
  assert.ok(((await call('GET', '/requests')).body['requests'] as { cycle_id: number }[]).some((d) => d.cycle_id === cycle), 'the Bearer sees the request made with the cookie');
  assert.equal((await call('GET', `/requests/${cycle}/messages`, undefined, cookie)).status, 200);

  // CSRF control kept: with the cookie, a POST (and a GET) without X-EupaDev is refused.
  const post = await call('POST', '/messages', { cycle_id: cycle, message: { type: 'requester_message', text: 'no header' } }, { ...cookie, 'X-EupaDev': null, 'Idempotency-Key': newKey() });
  assert.equal(post.status, 403, JSON.stringify(post.body));
  assert.equal((await call('GET', '/requests', undefined, { ...cookie, 'X-EupaDev': null })).status, 403);

  // Requester A's cookie does not read B's cycle (same rule as the Bearer).
  const admins = await call('POST', '/requests', { type: 'creation', name: 'Admin tool', slug: 'admin-tool-web', owner_service: 's', need: 'Not the requester’s' }, { 'Idempotency-Key': newKey() }, ADMIN.id);
  assert.equal(admins.status, 201);
  const other = admins.body['cycle_id'] as number;
  for (const path of [`/requests/${other}`, `/requests/${other}/messages`]) assert.equal((await call('GET', path, undefined, cookie)).status, 403, path);

  // Unknown or malformed cookie: 401 and the cookie is cleared; expired session: 401 and the row is gone.
  for (const bad of [`${SESSION_COOKIE}=${'A'.repeat(43)}`, `${SESSION_COOKIE}=garbage`]) {
    const r = await call('GET', '/requests', undefined, { Authorization: null, Cookie: bad });
    assert.equal(r.status, 401, bad);
    assert.match(cookieOf(r, SESSION_COOKIE) ?? '', /^__Host-session=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  }
  const second = await start(requester, '/', 'de');
  const secondValue = bare(cookieOf(await finish(second.callback, second.transaction), SESSION_COOKIE)!).split('=')[1]!;
  assert.notEqual(secondValue, value, 'a new session identifier at each sign-in');
  await orch.base.pool.query(`UPDATE sessions SET idle_expires_at = now() - interval '1 second' WHERE token_hash = sha256(convert_to($1, 'UTF8'))`, [secondValue]);
  assert.equal((await call('GET', '/requests', undefined, { Authorization: null, Cookie: `${SESSION_COOKIE}=${secondValue}` })).status, 401);
  assert.deepEqual(await stored(secondValue), { raw: 0, hashed: 0 }, 'expired row deleted');

  // Logout (a plain form POST): session deleted, cookie cleared, on to Keycloak's end-session page; the old value is dead.
  const out = await call('POST', '/auth/logout', undefined, { ...cookie, 'X-EupaDev': null });
  assert.equal(out.status, 303, JSON.stringify(out.body));
  const end = new URL(String(out.headers['location']));
  assert.equal(end.href.split('?')[0], `${TEST_ISSUER}/protocol/openid-connect/logout`);
  assert.deepEqual([end.searchParams.get('client_id'), end.searchParams.get('post_logout_redirect_uri')], [CLIENT_WEB_TEST, 'http://localhost:8080/']);
  assert.ok(cookieOf(out, SESSION_COOKIE)?.startsWith(`${SESSION_COOKIE}=; Max-Age=0;`));
  assert.equal((await call('GET', '/requests', undefined, cookie)).status, 401);
  assert.deepEqual(await stored(value), { raw: 0, hashed: 0 });

  // A person without any hat signs in at Keycloak but gets no session (403), like a Bearer without roles.
  const noHat = await start({ subject: 'web-no-hat', roles: [] }, '/', 'en');
  const hatless = await finish(noHat.callback, noHat.transaction);
  assert.equal(hatless.status, 403, JSON.stringify(hatless.body));
  assert.equal(cookieOf(hatless, SESSION_COOKIE), null);

  // Fail closed: without the web client configured, /auth/* answers 503 (RFC 9457) and nothing else changes.
  const withoutWeb = createApi(Object.create(orch, { config: { value: { ...orch.config, oidcWeb: null } } }) as Orchestrator).listen(0, '127.0.0.1');
  await once(withoutWeb, 'listening');
  try {
    const p = (withoutWeb.address() as AddressInfo).port;
    const r = await new Promise<{ status: number; type: string }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: p, path: '/auth/login', headers: { Host: `localhost:${p}` } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'] ?? '' }); }).on('error', reject);
    });
    assert.equal(r.status, 503);
    assert.match(r.type, PROBLEM);
  } finally {
    withoutWeb.close();
  }
  for (const c of [cycle, other]) assert.equal((await posterMessage(c, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() })).status, 202);
});

test('E0: local API — four eyes (I0): the tool’s requester does not approve their Gate 2 (403), except with a configured exemption, traced in approvals', { timeout: 180_000 }, async () => {
  // The admin requests a tool: they are its requester; at Gate 2, their approval is refused, by the engine…
  const r = await call('POST', '/requests', { type: 'creation', name: 'Four eyes', slug: 'four-eyes', owner_service: 's', need: 'Track the department’s vehicles' }, { 'Idempotency-Key': newKey() }, ADMIN.id);
  assert.equal(r.status, 201);
  const cycle = r.body['cycle_id'] as number;
  const read = readByApi(cycle);
  const handled = new Set<string>();
  const limit = Date.now() + 90_000;
  for (;;) {
    const c = await read();
    if (c.state === 'gate_2') break;
    if (c.finished || Date.now() > limit) throw new Error(`cycle ${cycle} in ${c.state}`);
    const m = humanAnswer(c.state, c.candidate_digest);
    if (m !== undefined && !handled.has(`${c.state}#${c.visit}`)) {
      handled.add(`${c.state}#${c.visit}`);
      assert.equal((await posterMessage(cycle, m, { 'Idempotency-Key': newKey() }, ADMIN.id)).status, 202);
    }
    await sleep(50);
  }
  const digest = (await read()).candidate_digest!;
  const approval: Message = { type: 'decision', gate: 'gate_2', outcome: 'approved', digest: digest, actor_id: ADMIN.id };
  const refusal = await posterMessage(cycle, approval, { 'Idempotency-Key': newKey() });
  assert.equal(refusal.status, 403, JSON.stringify(refusal.body));
  assert.match(String(refusal.body['detail']), /four eyes/);
  assert.equal((await read()).state, 'gate_2');
  // …and by the database itself, without the exemption flag (defence in depth).
  const c = await orch.base.readCycle(cycle);
  await assert.rejects(orch.base.pool.query(`INSERT INTO approvals (tool_id, cycle_id, gate, digest, decision, actor_id, role) VALUES ($1, $2, 'gate_2', $3, 'approved', $4, 'admin')`, [c.tool_id, cycle, digest, ADMIN.id]), /four eyes/);
  // Exemption: only the designated subject is covered — another configured subject changes nothing for the admin…
  await stop();
  await start({ FOUR_EYES_EXEMPTION_SUBJECT: SUBJECTS[REQUESTER.id]! });
  const always = await posterMessage(cycle, approval, { 'Idempotency-Key': newKey() });
  assert.equal(always.status, 403, JSON.stringify(always.body));
  // …then the admin's subject at the issuer is designated; same engine, cycle resumed in place (DBOS).
  await stop();
  await start({ FOUR_EYES_EXEMPTION_SUBJECT: SUBJECTS[ADMIN.id]! });
  const accepted = await posterMessage(cycle, approval, { 'Idempotency-Key': newKey() });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  // Gate 2 already answered: wait for the engine to leave it, or the helper would send it again (409).
  while ((await read()).state === 'gate_2') await sleep(50);
  const end = await driveAsHuman(read, async (m) => { assert.equal((await posterMessage(cycle, m, { 'Idempotency-Key': newKey() })).status, 202); });
  assert.equal(end, 'end_success');
  const trace = await orch.base.pool.query(`SELECT actor, role, four_eyes_exemption FROM approvals WHERE cycle_id = $1 AND gate = 'gate_2'`, [cycle]);
  assert.deepEqual(trace.rows, [{ actor: ADMIN_MAIL, role: 'admin', four_eyes_exemption: true }], 'the exemption is traced');
  // Another designated subject does not cover the admin: checked by the Gherkin scenario on a refused self-approval, and above
  // (empty subject).
  await stop();
  await start();
});

test('E0: local API — actor merge (0010): the same person back under a new subject, linked by the admin, acts as their first actor; four eyes and idempotency on the canonical actor', { timeout: 180_000 }, async () => {
  // The `requester` person comes back with a new subject (AD connector recreated) BEFORE any linking: her first call
  // creates a second actor B, under which she requests a tool. Her token also carries the admin hat: that is what would
  // let her approve her own delivery if B and A remained two people.
  const tokenB = await oidc.token({ subject: 'requester-new-sub', mail: REQUESTER_MAIL, name: REQUESTER_MAIL, roles: ['requester', 'admin'] });
  const byB = (method: string, path: string, body?: unknown, headers: Record<string, string | null> = {}) => call(method, path, body, { ...headers, Authorization: `Bearer ${tokenB}` });
  const r = await byB('POST', '/requests', { type: 'creation', name: 'Merge', slug: 'merge', owner_service: 's', need: 'Track the department’s vehicles' }, { 'Idempotency-Key': newKey() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cycle = r.body['cycle_id'] as number;
  const b = (await orch.base.pool.query<{ actor_id: string }>(`SELECT actor_id FROM actor_identities WHERE subject = 'requester-new-sub'`)).rows[0]!.actor_id;
  assert.notEqual(b, REQUESTER.id, 'before the merge: two actors');
  assert.equal((await orch.base.readCycle(cycle)).requester_id, b);
  assert.equal((await call('GET', `/requests/${cycle}/messages`)).status, 403, 'before the merge, A cannot read B’s chat');
  // Merge B → A through the API: admin hat required; the admin does not link their own identity; strict body; replay = 200.
  const merge = { absorbed_actor: b, target_actor: REQUESTER.id, reason: 'AD connector recreated on 2026-10-16, ticket 44' };
  const requesterRefusal = await call('POST', '/actors/merges', merge);
  assert.equal(requesterRefusal.status, 403, JSON.stringify(requesterRefusal.body));
  assert.equal((await byB('POST', '/actors/merges', merge)).status, 409, 'B (admin) does not link their own identity');
  assert.equal((await call('POST', '/actors/merges', { ...merge, target_actor: ADMIN.id }, {}, ADMIN.id)).status, 409, 'the admin absorbs nobody into their own identity');
  assert.equal((await call('POST', '/actors/merges', { ...merge, absorbed_actor: 'text' }, {}, ADMIN.id)).status, 400);
  assert.equal((await call('POST', '/actors/merges', { ...merge, decided_by: ADMIN.id }, {}, ADMIN.id)).status, 400, 'who decides comes from the token, never from the body');
  assert.equal((await orch.base.pool.query('SELECT count(*)::int AS n FROM actor_merges')).rows[0]!.n, 0);
  const created = await call('POST', '/actors/merges', merge, {}, ADMIN.id);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body['decided_by'], ADMIN.id);
  const replay = await call('POST', '/actors/merges', merge, {}, ADMIN.id);
  assert.deepEqual([replay.status, replay.body], [200, created.body], 'same merge asked again: the existing row, no duplicate');
  assert.equal((await call('GET', `/requests/${cycle}/messages`)).status, 200, 'after the merge, A reads the chat of the tool requested as B');
  assert.ok(((await call('GET', '/requests')).body['requests'] as { cycle_id: number }[]).some((d) => d.cycle_id === cycle), 'A’s "my requests" include B’s');
  assert.equal((await call('POST', '/actors/merges', { ...merge, target_actor: ADMIN.id }, {}, ADMIN.id)).status, 409, 'another target for the same absorbed actor');
  // The tool's requester now reads as A: her feedback on the tool requested as B is accepted (202) up to Gate 2;
  // the table keeps B (the history is not rewritten).
  const read = readByApi(cycle);
  const handled = new Set<string>();
  const limit = Date.now() + 90_000;
  for (;;) {
    const c = await read();
    if (c.state === 'gate_2') break;
    if (c.finished || Date.now() > limit) throw new Error(`cycle ${cycle} in ${c.state}`);
    const m = humanAnswer(c.state, c.candidate_digest);
    if (m !== undefined && !handled.has(`${c.state}#${c.visit}`)) {
      handled.add(`${c.state}#${c.visit}`);
      const sending = await posterMessage(cycle, m, { 'Idempotency-Key': newKey() });
      assert.equal(sending.status, 202, `${c.state}: ${JSON.stringify(sending.body)}`);
    }
    await sleep(50);
  }
  assert.ok([...handled].some((f) => f.startsWith('waiting_scoping_feedback#')), 'A did judge the scoping of the tool requested as B');
  assert.deepEqual((await orch.base.pool.query('SELECT requester_id FROM tools WHERE id = $1', [r.body['tool_id']])).rows, [{ requester_id: b }]);
  // Four eyes on the canonical actor: B (admin hat) does not approve the delivery the same person requested.
  const digest = (await read()).candidate_digest!;
  const approval = { type: 'decision', gate: 'gate_2', outcome: 'approved', digest: digest };
  const refusal = await byB('POST', '/messages', { cycle_id: cycle, message: approval }, { 'Idempotency-Key': newKey() });
  assert.equal(refusal.status, 403, JSON.stringify(refusal.body));
  assert.match(String(refusal.body['detail']), /four eyes/);
  assert.equal((await read()).state, 'gate_2');
  // Idempotency per person: the key set by B is A's (same person, same Keycloak hats whatever the
  // subject) — same response, a single cycle.
  const key = newKey();
  const body = { type: 'creation', name: 'Same person', slug: 'same-person', owner_service: 's', need: 'Track the department’s vehicles' };
  const d1 = await byB('POST', '/requests', body, { 'Idempotency-Key': key });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  const tokenA = await oidc.token({ subject: SUBJECTS[REQUESTER.id]!, mail: REQUESTER_MAIL, name: REQUESTER_MAIL, roles: ['requester', 'admin'] });
  const d2 = await call('POST', '/requests', body, { 'Idempotency-Key': key, Authorization: `Bearer ${tokenA}` });
  assert.deepEqual([d2.status, d2.body], [201, d1.body]);
  assert.equal((await posterMessage(d1.body['cycle_id'] as number, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() })).status, 202);
  // A third-party admin approves; the cycle goes all the way.
  assert.equal((await posterMessage(cycle, { ...approval, actor_id: ADMIN.id } as Message, { 'Idempotency-Key': newKey() })).status, 202);
  // Gate 2 already answered: wait for the engine to leave it, or the helper would send it again (409).
  while ((await read()).state === 'gate_2') await sleep(50);
  const end = await driveAsHuman(read, async (m) => { assert.equal((await posterMessage(cycle, m, { 'Idempotency-Key': newKey() })).status, 202); });
  assert.equal(end, 'end_success');
});

test('E0: local API — two simultaneous first sends of the same key with different contents: only one is handled, the other refused (422)', { timeout: 60_000 }, async () => {
  // Unknown cycle: the engine refuses the message (404) without changing anything; only the fate of the key matters.
  for (let trial = 0; trial < 5; trial++) {
    const key = newKey();
    const answers = await Promise.all([999999, 999998].map((cycle_id) =>
      call('POST', '/messages', { cycle_id, message: { type: 'cancellation' } }, { 'Idempotency-Key': key }, ADMIN.id)));
    assert.deepEqual(answers.map((r) => r.status).sort(), [404, 422], JSON.stringify(answers.map((r) => r.body)));
  }
});

test('E0: emergency stop (PAUSE_AGENTS=1) — no agent task launched, the cycle waits; without the pause, it resumes and finishes', { timeout: 120_000 }, async () => {
  await stop();
  await start({ PAUSE_AGENTS: '1' });
  assert.deepEqual((await call('GET', '/health')).body, { status: 'ok', pause_agents: true });
  const { cycle_id } = await orch.newRequest({ type: 'creation', name: 'Pause', slug: 'pause', owner_service: 'logistics', need: 'Track the department’s vehicles' }, REQUESTER);
  await sleep(1500);
  const c = await orch.base.readCycle(cycle_id);
  assert.equal(c.state, 'overlap_search', 'the cycle waits for its task, it is neither dead nor in incident');
  assert.equal((orch.external.engine as FakeEngine).switchboard.log.length, 0, 'no agent called during the pause');
  const tasks = await orch.base.pool.query<{ status: string }>("SELECT status FROM dbos.workflow_status WHERE queue_name = 'agent-tasks' AND status <> 'SUCCESS'");
  // This cycle's one, and the one of the `guard` cycle of the previous test, started just before the stop.
  assert.ok(tasks.rows.length >= 1 && tasks.rows.every((r) => r.status === 'ENQUEUED'), `the tasks stay queued: ${JSON.stringify(tasks.rows)}`);

  await stop();
  await start();
  const end = await driveAsHuman(async () => {
    const x = await orch.base.readCycle(cycle_id);
    return { state: x.state, visit: x.visit, finished: x.finished_at !== null, candidate_digest: await orch.base.candidateDigest(cycle_id) };
  }, async (m) => { await orch.send(cycle_id, m, hats(m)); });
  assert.equal(end, 'end_success');
});

test('ADR-031 S1: POST /requests/<id>/intent reads a sentence against the state and the hat, never posts a decision; header, token, stranger, body, rate limit; row in intents', { timeout: 180_000 }, async () => {
  const r = await call('POST', '/requests', { type: 'creation', name: 'Badge register', slug: 'badge-register', owner_service: 'security', need: 'Track the visitor badges' }, { 'Idempotency-Key': newKey() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cycle = r.body['cycle_id'] as number;
  const waitFor = async (state: string) => {
    for (const limit = Date.now() + 90_000; (await readByApi(cycle)()).state !== state; ) {
      if (Date.now() > limit) throw new Error(`cycle ${cycle} never reached ${state}`);
      await sleep(50);
    }
  };
  const intent = (body: unknown, headers: Record<string, string | null> = {}, who: string = REQUESTER.id) => call('POST', `/requests/${cycle}/intent`, body, headers, who);
  const en = (text: string) => ({ text, lang: 'en' });
  await waitFor('waiting_scoping_feedback');

  // Guards: the header, a token, the tool's requester or an admin, a strict body, a sentence checked like a message text.
  const stranger = { Authorization: `Bearer ${await oidc.token({ subject: 'intent-stranger', mail: 'intent-stranger@example.test', roles: ['requester'] })}` };
  assert.equal((await intent(en('ok'), { 'X-EupaDev': null })).status, 403);
  assert.equal((await intent(en('ok'), { Authorization: null })).status, 401);
  const refused = await intent(en('ok'), stranger);
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.match(String(refused.body['detail']), /reserved for the requester of tool/);
  assert.equal((await intent({ text: 'ok' })).status, 400, 'lang required');
  assert.equal((await intent({ text: 'ok', lang: 'de' })).status, 400);
  assert.equal((await intent({ text: 'ok', lang: 'en', hat: 'admin' })).status, 400, 'no identity from the body');
  assert.equal((await intent(en('ok​'))).status, 400, 'invisible character');
  assert.equal((await call('GET', `/requests/${cycle}/intent`)).status, 405);
  assert.equal((await call('POST', '/requests/999999/intent', en('ok'))).status, 404);

  // The requester at the mock-up wait: a plain yes is "satisfied" (a click: the contract task is paid), another sentence is unclear, an amount is not a top-up here.
  const yes = await intent({ text: "c'est bon", lang: 'fr' });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.deepEqual(yes.body, { cycle_id: cycle, state: 'waiting_scoping_feedback', hat: 'requester', allowed: ['satisfied', 'correction', 'abandon'], intent: 'satisfied', needs_click: true, fallback: false });
  assert.equal((await intent(en('the filter per site is missing'))).body['intent'], 'unclear');
  assert.equal((await intent(en('ok with 20 more'))).body['intent'], 'unclear', 'no top-up at a wait');
  // The admin at a requester's wait has nothing to say: empty set, the reader is not called.
  const admin = await intent(en('ok'), {}, ADMIN.id);
  assert.deepEqual([admin.body['hat'], admin.body['allowed'], admin.body['intent']], ['admin', [], 'unclear']);
  // Nothing was posted: the state is unchanged, no message of the requester beyond the need.
  assert.equal((await readByApi(cycle)()).state, 'waiting_scoping_feedback');
  assert.equal((await orch.base.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE cycle_id = $1 AND author_type = 'requester'", [cycle])).rows[0]!.n, 1);
  // Every sentence is recorded with its reading; the engine can neither change nor delete the rows.
  const rows = await orch.base.pool.query<{ hat: string; allowed: string[]; text: string; lang: string; intent: string; amount_usd: string | null; reader: string; fallback: boolean }>('SELECT hat, allowed, text, lang, intent, amount_usd, reader, fallback FROM intents WHERE cycle_id = $1 ORDER BY id', [cycle]);
  assert.deepEqual(rows.rows.map((x) => [x.hat, x.text, x.intent]), [['requester', "c'est bon", 'satisfied'], ['requester', 'the filter per site is missing', 'unclear'], ['requester', 'ok with 20 more', 'unclear'], ['admin', 'ok', 'unclear']]);
  assert.deepEqual([rows.rows[0]!.lang, rows.rows[0]!.allowed, rows.rows[0]!.reader, rows.rows[0]!.fallback, rows.rows[3]!.allowed], ['fr', ['satisfied', 'correction', 'abandon'], 'words', false, []]);
  await assert.rejects(orch.base.pool.query('UPDATE intents SET intent = $2 WHERE cycle_id = $1', [cycle, 'approved']), /append-only|permission denied/);
  await assert.rejects(orch.base.pool.query('DELETE FROM intents WHERE cycle_id = $1', [cycle]), /append-only|permission denied/);

  // Rate limit per person: a runaway client is slowed down, nobody else is.
  const hurried = { Authorization: `Bearer ${await oidc.token({ subject: 'intent-hurried', mail: 'intent-hurried@example.test', roles: ['admin'] })}` };
  for (let i = 0; i < 20; i++) assert.equal((await intent(en('ok'), hurried)).status, 200, `call ${i + 1}`);
  const slowed = await intent(en('ok'), hurried);
  assert.equal(slowed.status, 429, JSON.stringify(slowed.body));
  assert.match(slowed.type, PROBLEM);
  assert.ok(Number(slowed.headers['retry-after']) >= 1);
  assert.equal((await intent(en('ok'), {}, ADMIN.id)).status, 200, 'another person is not slowed down');

  // The admin at Gate 1 (reached by the automatic fakes once the requester is satisfied): "ok" approves, free (a Preview
  // deployment, no agent); an amount is unclear there (no envelope); the requester has nothing to say at a gate.
  assert.equal((await posterMessage(cycle, { type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id }, { 'Idempotency-Key': newKey() })).status, 202);
  await waitFor('gate_1');
  const gate = await intent(en('ok'), {}, ADMIN.id);
  assert.deepEqual([gate.body['hat'], gate.body['allowed'], gate.body['intent'], gate.body['needs_click']], ['admin', ['approved', 'correction', 'refused', 'scope_change'], 'approved', false]);
  assert.equal((await intent(en('ok with 20 more'), {}, ADMIN.id)).body['intent'], 'unclear');
  assert.deepEqual((await intent(en('ok'))).body['allowed'], [], 'the requester at a gate');
  assert.equal((await readByApi(cycle)()).state, 'gate_1', 'understanding decided nothing');
  await posterMessage(cycle, { type: 'cancellation', actor_id: ADMIN.id }, { 'Idempotency-Key': newKey() });
});
