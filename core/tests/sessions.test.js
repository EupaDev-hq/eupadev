// Sessions in the database (§2.3): cases of Lucia's reference file (malformed token, wrong secret, expiry,
// extension), `token_version`, destruction by id / sid / actor, CVE-2024-35220 (a destroyed token never reopens
// a session). Real PostgreSQL in a container: Docker is required. The time is passed explicitly.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createDb } from '../src/index.js';
import { createSessions, durationsFromEnv } from '../src/sessions.js';
import { startPostgres, query } from './helpers/throwaway-postgres.js';

/** @type {Awaited<ReturnType<typeof startPostgres>>} */ let s;
/** @type {ReturnType<typeof createDb>} */ let db;
/** @type {ReturnType<typeof createSessions>} */ let sessions;
/** @type {string} */ let actor;
const T0 = new Date('2026-10-18T10:00:00Z');
const plus = (/** @type {number} */ ms) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const fresh = (/** @type {Partial<import('../src/sessions.js').NewSession>} */ o = {}) =>
  ({ actorId: actor, roles: ['reader'], sid: 'sid-1', idToken: 'token', tokenVersion: 1, ...o });

before(async () => {
  s = await startPostgres();
  db = createDb({ url: s.app, tls: false, max: 2 });
  sessions = createSessions(db, durationsFromEnv({}));
  actor = (await query(s.app, "INSERT INTO actors (type, display_name) VALUES ('human', 'Alice') RETURNING id")).rows[0].id;
});
after(async () => { await db?.close(); s?.remove(); });

describe('durations', () => {
  test('defaults 30 min / 8 h, bounds refused', () => {
    assert.deepEqual(durationsFromEnv({}), { idleMs: 30 * MIN, maxMs: 8 * 60 * MIN });
    assert.deepEqual(durationsFromEnv({ SESSION_IDLE_MINUTES: '5', SESSION_MAX_HOURS: '1' }), { idleMs: 5 * MIN, maxMs: 60 * MIN });
    for (const env of [{ SESSION_IDLE_MINUTES: '31' }, { SESSION_IDLE_MINUTES: '4' }, { SESSION_MAX_HOURS: '9' }, { SESSION_MAX_HOURS: '0' }, { SESSION_IDLE_MINUTES: '1.5' }, { SESSION_MAX_HOURS: 'x' }]) {
      assert.throws(() => durationsFromEnv(env), /integer between/);
    }
  });
});

describe('id.secret token', () => {
  test('creation then read: roles, sid, id_token; cookie of at least 128 bits of secret', async () => {
    const { id, token } = await sessions.create(fresh(), T0);
    assert.match(token, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    const loaded = await sessions.read(token, plus(MIN / 2));
    assert.deepEqual(loaded, { session: { id, actorId: actor, roles: ['reader'], sid: 'sid-1', idToken: 'token' }, extended: false });
    const row = (await query(s.app, 'SELECT octet_length(secret_hash) n, token_version FROM sessions WHERE id = $1', [id])).rows[0];
    assert.deepEqual(row, { n: 32, token_version: '1' });
  });
  test('malformed token: null without a query; wrong secret or unknown id: null, the session stays', async () => {
    const { id, token } = await sessions.create(fresh(), T0);
    for (const j of [undefined, '', 'abc', `${id}`, `${id}.`, `${id}.short`, `${'x'.repeat(22)}.${'y'.repeat(43)}`, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), `${token}.extra`]) {
      assert.equal(await sessions.read(j, T0), null, String(j));
    }
    assert.equal((await query(s.app, 'SELECT count(*)::int n FROM sessions WHERE id = $1', [id])).rows[0].n, 1);
    assert.ok(await sessions.read(token, T0));
  });
});

describe('durations and clock moved forward', () => {
  test('extension at most once a minute, never beyond the absolute expiry', async () => {
    const { id, token } = await sessions.create(fresh(), T0);
    const before = (await query(s.app, 'SELECT last_seen_at, idle_expires_at FROM sessions WHERE id = $1', [id])).rows[0];
    assert.equal((await sessions.read(token, plus(59_000)))?.extended, false);
    assert.deepEqual((await query(s.app, 'SELECT last_seen_at, idle_expires_at FROM sessions WHERE id = $1', [id])).rows[0], before);
    assert.equal((await sessions.read(token, plus(MIN)))?.extended, true);
    const after = (await query(s.app, 'SELECT last_seen_at, idle_expires_at, absolute_expires_at FROM sessions WHERE id = $1', [id])).rows[0];
    assert.equal(after.last_seen_at.toISOString(), plus(MIN).toISOString());
    assert.equal(after.idle_expires_at.toISOString(), plus(31 * MIN).toISOString());
  });
  test('30 min without activity: null and row deleted; a read slides the window', async () => {
    const { id, token } = await sessions.create(fresh(), T0);
    assert.ok(await sessions.read(token, plus(29 * MIN)));
    assert.ok(await sessions.read(token, plus(58 * MIN)), 'extended at 29 min, so alive at 58');
    assert.equal(await sessions.read(token, plus(88 * MIN)), null, '58 + 30 min: expired');
    assert.equal((await query(s.app, 'SELECT count(*)::int n FROM sessions WHERE id = $1', [id])).rows[0].n, 0);
    assert.equal(await sessions.read(token, plus(88 * MIN + 1)), null);
    const dormant = await sessions.create(fresh(), T0);
    assert.equal(await sessions.read(dormant.token, plus(30 * MIN)), null, 'without a read: dead at 30 min');
  });
  test('8 h of continuous activity: the extension is bounded by the absolute expiry, then null', async () => {
    const { id, token } = await sessions.create(fresh(), T0);
    for (let t = 25 * MIN; t < 480 * MIN; t += 25 * MIN) assert.ok(await sessions.read(token, plus(t)), `${t / MIN} min`);
    const l = (await query(s.app, 'SELECT idle_expires_at, absolute_expires_at FROM sessions WHERE id = $1', [id])).rows[0];
    assert.equal(l.idle_expires_at.toISOString(), l.absolute_expires_at.toISOString());
    assert.equal(l.absolute_expires_at.toISOString(), plus(480 * MIN).toISOString());
    assert.equal(await sessions.read(token, plus(480 * MIN)), null);
  });
});

describe('revocation', () => {
  test('token_version incremented on the actor: all its sessions fall, the other actors\' do not', async () => {
    const revoked = (await query(s.app, "INSERT INTO actors (type, display_name) VALUES ('human', 'Chloe') RETURNING id")).rows[0].id;
    const a1 = await sessions.create(fresh({ actorId: revoked }), T0);
    const a2 = await sessions.create(fresh({ actorId: revoked }), T0);
    const b = await sessions.create(fresh(), T0);
    assert.ok(await sessions.read(a1.token, T0));
    await query(s.app, 'UPDATE actors SET token_version = token_version + 1 WHERE id = $1', [revoked]);
    assert.equal(await sessions.read(a1.token, T0), null);
    assert.equal(await sessions.read(a2.token, T0), null);
    assert.ok(await sessions.read(b.token, T0));
    assert.equal((await query(s.app, 'SELECT count(*)::int n FROM sessions WHERE actor_id = $1', [revoked])).rows[0].n, 0);
    // A session created afterwards with the new version lives normally.
    const a3 = await sessions.create(fresh({ actorId: revoked, tokenVersion: 2 }), T0);
    assert.ok(await sessions.read(a3.token, T0));
  });
  test('destruction by id (CVE-2024-35220: the destroyed token never reopens anything), by sid, by actor', async () => {
    const a = await sessions.create(fresh({ sid: 'sid-A' }), T0);
    await sessions.destroy(a.id);
    assert.equal(await sessions.read(a.token, T0), null);
    await sessions.create(fresh({ sid: 'sid-A' }), T0);
    assert.equal(await sessions.read(a.token, T0), null, 'a new session does not revive the old token');
    const b1 = await sessions.create(fresh({ sid: 'sid-B' }), T0);
    const b2 = await sessions.create(fresh({ sid: 'sid-B' }), T0);
    const c = await sessions.create(fresh({ sid: 'sid-C' }), T0);
    assert.equal(await sessions.destroyBySid('sid-B'), 2);
    assert.equal(await sessions.read(b1.token, T0), null);
    assert.equal(await sessions.read(b2.token, T0), null);
    assert.ok(await sessions.read(c.token, T0));
    assert.ok((await sessions.destroyByActor(actor)) >= 1);
    assert.equal(await sessions.read(c.token, T0), null);
    assert.equal(await sessions.destroyBySid('sid-unknown'), 0);
  });
});
