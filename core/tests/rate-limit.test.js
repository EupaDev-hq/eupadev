// Rate limiting (§2.7) against a real PostgreSQL: the `INSERT … ON CONFLICT` statement, the one-minute window that
// turns (clock passed as a parameter), SEC-RATE with two instances (two pools on the same database), purge of
// windows older than one hour, rights of the application role. Docker is required.
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { after, before, describe, test } from 'node:test';
import { createLimiter } from '../src/rate-limit.js';
import { Problem } from '../src/errors.js';
import { createDb, createLogger } from '../src/index.js';
import { startPostgres, query } from './helpers/throwaway-postgres.js';

/** @type {Awaited<ReturnType<typeof startPostgres>>} */ let pgt;
/** @type {ReturnType<typeof createDb>} */ let dbA;
/** @type {ReturnType<typeof createDb>} */ let dbB;
const logger = createLogger({ level: 'silent' });
const T0 = new Date('2026-10-18T10:00:15Z');
const plus = (/** @type {number} */ ms) => new Date(T0.getTime() + ms);

before(async () => {
  pgt = await startPostgres();
  dbA = createDb({ url: pgt.app, tls: false, max: 2 });
  dbB = createDb({ url: pgt.app, tls: false, max: 2 });
});
after(async () => { await dbA?.close(); await dbB?.close(); pgt?.remove(); });

/** @param {Promise<unknown>} p */
async function expect429(p) {
  try { await p; } catch (e) {
    assert.ok(e instanceof Problem);
    assert.equal(e.status, 429);
    assert.equal(e.code, 'RATE_LIMITED');
    return e.headers['retry-after'];
  }
  assert.fail('429 expected');
}

describe('one instance', () => {
  test('threshold 5: five pass, the sixth → 429 with Retry-After until the end of the minute; one row per (key, window)', async () => {
    const l = createLimiter(dbA, logger);
    for (let i = 0; i < 5; i++) await l.count('op|a', 5, T0);
    assert.equal(await expect429(l.count('op|a', 5, T0)), '45');
    assert.equal(await expect429(l.count('op|a', 5, plus(44_000))), '1');
    const rows = await query(pgt.owner, "SELECT key, window_start, count FROM rate_limits WHERE key = 'op|a' ORDER BY window_start");
    assert.deepEqual(rows.rows.map((r) => [r.key, r.window_start.toISOString(), Number(r.count)]), [['op|a', '2026-10-18T10:00:00.000Z', 7]]);
  });
  test('other key and next minute: independent counters', async () => {
    const l = createLimiter(dbA, logger);
    await l.count('op|b', 1, T0);
    await expect429(l.count('op|b', 1, T0));
    await l.count('op|b', 1, plus(45_000));
    await l.count('other|b', 1, T0);
  });
});

describe('SEC-RATE with two instances (same database, two pools)', () => {
  test('ten on A then ten on B: the 21st is refused on A as on B', async () => {
    const a = createLimiter(dbA, logger);
    const b = createLimiter(dbB, logger);
    for (let i = 0; i < 10; i++) await a.count('list|c', 20, T0);
    for (let i = 0; i < 10; i++) await b.count('list|c', 20, T0);
    await expect429(a.count('list|c', 20, T0));
    await expect429(b.count('list|c', 20, T0));
  });
  test('concurrent increments: 30 parallel calls on the two pools give exactly 30', async () => {
    const a = createLimiter(dbA, logger);
    const b = createLimiter(dbB, logger);
    await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).count('par|d', 1000, T0)));
    const r = await query(pgt.owner, "SELECT count FROM rate_limits WHERE key = 'par|d'");
    assert.equal(Number(r.rows[0].count), 30);
  });
});

describe('purge', () => {
  test('windows older than one hour disappear at the instance\'s first count, recent ones stay', async () => {
    await query(pgt.owner, "INSERT INTO rate_limits (key, window_start, count) VALUES ('old', $1, 3), ('recent', $2, 3)", [plus(-2 * 3_600_000), plus(-30 * 60_000)]);
    const l = createLimiter(dbA, logger);
    await l.count('purge|e', 20, T0);
    for (let i = 0; i < 50; i++) {
      if ((await query(pgt.owner, "SELECT 1 FROM rate_limits WHERE key = 'old'")).rowCount === 0) break;
      await wait(100);
    }
    assert.equal((await query(pgt.owner, "SELECT 1 FROM rate_limits WHERE key = 'old'")).rowCount, 0);
    assert.equal((await query(pgt.owner, "SELECT 1 FROM rate_limits WHERE key = 'recent'")).rowCount, 1);
  });
});

describe('rights', () => {
  test('the application role writes and purges rate_limits; the purge role cannot insert into it', async () => {
    await assert.rejects(query(pgt.purge, "INSERT INTO rate_limits (key, window_start, count) VALUES ('x', now(), 1)"), /permission denied/);
    assert.equal((await query(pgt.app, "DELETE FROM rate_limits WHERE key = 'recent'")).rowCount, 1);
  });
});
