// Database of "requests" on a throwaway PostgreSQL (the core's kit, Docker required): migrations from scratch and
// replayed, ADR-003 catalogue, privileges of the three roles, legal and illegal transitions refused by the database,
// append-only history written by the trigger alone, audit of the tables keyed by `code` and `request_id`.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { createDb } from '@eupadev/core';
import { startPostgres, migrate, query } from '@eupadev/core/kit/throwaway-postgres.js';

const TOOL = 'requests';
const REFUSAL = { code: '42501' };
const TRANSITION = { code: '23514', constraint: 'requests_transition' };
/** @type {Awaited<ReturnType<typeof startPostgres>>} */ let s;
/** @type {ReturnType<typeof createDb>} */ let db;
/** @type {Record<'alice' | 'bruno', string>} */ const actors = { alice: '', bruno: '' };

before(async () => {
  s = await startPostgres({ tool: TOOL });
  db = createDb({ url: s.app, tls: false, max: 1 });
  for (const name of /** @type {const} */ (['alice', 'bruno'])) {
    actors[name] = (await query(s.app, "INSERT INTO actors (type, display_name) VALUES ('human', $1) RETURNING id", [name])).rows[0].id;
  }
  await db.tx(ctx('bruno'), (t) => t.query("INSERT INTO categories (code, label) VALUES ('locksmith', 'Locksmith')"));
});
after(async () => { await db?.close(); s?.remove(); });

/** @param {'alice' | 'bruno'} who */
function ctx(who) { return { actorId: actors[who], roles: [], requestId: `test-${who}` }; }

/** A draft request of alice's, with its details. */
async function draft() {
  return db.tx(ctx('alice'), async (t) => {
    const id = (await t.query("INSERT INTO requests (category_code, urgency, requester_id) VALUES ('locksmith', 'high', $1) RETURNING id", [actors.alice])).rows[0].id;
    await t.query("INSERT INTO request_details (request_id, title, description, location) VALUES ($1, 'Door of dock 3', 'Does not close properly', 'Dock 3')", [id]);
    return /** @type {string} */ (id);
  });
}

/** @param {'alice' | 'bruno'} who @param {string} id @param {string} status @param {string} [note] */
function move(who, id, status, note) {
  return db.tx(ctx(who), async (t) => {
    if (note !== undefined) await t.query('UPDATE request_details SET closing_note = $2 WHERE request_id = $1', [id, note]);
    await t.query('UPDATE requests SET status = $2 WHERE id = $1', [id, status]);
  });
}

/** @param {string} id */
async function history(id) {
  return (await query(s.owner, 'SELECT from_status, to_status, actor_id FROM request_history WHERE request_id = $1 ORDER BY id', [id])).rows
    .map((r) => [r.from_status, r.to_status, r.actor_id]);
}

describe('migrations', () => {
  test('from scratch then replayed: idempotent, nothing in public', async () => {
    await migrate(s.owner, { toolDir: 'db/migrations' });
    assert.deepEqual((await query(s.owner, 'SELECT name FROM pgmigrations')).rows.map((r) => r.name), ['0001_requests']);
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0].n, 0);
  });
  test('immutable SQL without Down, timeouts first (ADR-004)', () => {
    const sql = readFileSync(new URL('../db/migrations/0001_requests.sql', import.meta.url), 'utf8');
    assert.ok(!sql.includes('Down Migration'));
    assert.match(sql, /^-- Up Migration\n(?:--.*\n)*SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';/);
  });
});

describe('catalogue (ADR-003) and privileges', () => {
  test('no ENUM, no timestamp without time zone, a primary key everywhere, uuid by uuidv7, a single owner', async () => {
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typtype = 'e'")).rows[0].n, 0);
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'app' AND data_type = 'timestamp without time zone' AND table_name NOT IN ('core_migrations', 'pgmigrations')")).rows[0].n, 0);
    assert.deepEqual((await query(s.owner, "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT EXISTS (SELECT FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'p')")).rows, []);
    assert.deepEqual((await query(s.owner, "SELECT table_name FROM information_schema.columns WHERE table_schema = 'app' AND column_name = 'id' AND data_type = 'uuid' AND column_default IS DISTINCT FROM 'uuidv7()'")).rows, []);
    assert.deepEqual((await query(s.owner, "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'app'")).rows, [{ tableowner: `${TOOL}_owner` }]);
  });
  test('web process: no physical DELETE (except the attachment), no direct write of the history', async () => {
    const id = await draft();
    for (const table of ['categories', 'requests', 'request_details']) await assert.rejects(query(s.app, `DELETE FROM ${table}`), REFUSAL, table);
    await query(s.app, 'DELETE FROM request_attachments');
    await assert.rejects(query(s.app, "UPDATE request_history SET to_status = 'resolved'"), REFUSAL);
    await assert.rejects(query(s.app, 'DELETE FROM request_history'), REFUSAL);
    await assert.rejects(query(s.app, 'TRUNCATE request_history'), REFUSAL);
    await assert.rejects(db.tx(ctx('alice'), (t) => t.query("INSERT INTO request_history (request_id, to_status, actor_id, actor_type) VALUES ($1, 'resolved', $2, 'human')", [id, actors.alice])),
      /written only by the trigger/);
  });
  test('purge: read and delete only', async () => {
    await assert.rejects(query(s.purge, "INSERT INTO categories (code, label) VALUES ('x', 'x')"), REFUSAL);
    await assert.rejects(query(s.purge, "UPDATE requests SET urgency = 'low'"), REFUSAL);
    await assert.rejects(query(s.purge, "UPDATE request_history SET to_status = 'resolved'"), REFUSAL);
    assert.ok((await query(s.purge, 'SELECT count(*)::int n FROM request_history')).rows[0].n > 0);
  });
});

describe('transitions', () => {
  test('legal path: every status reached adds a history row with its actor', async () => {
    const id = await draft();
    await move('alice', id, 'submitted');
    await move('bruno', id, 'in_progress');
    await move('bruno', id, 'resolved', 'Strike plate replaced');
    assert.deepEqual(await history(id), [
      [null, 'draft', actors.alice], ['draft', 'submitted', actors.alice],
      ['submitted', 'in_progress', actors.bruno], ['in_progress', 'resolved', actors.bruno],
    ]);
    const r = (await query(s.owner, 'SELECT status, version FROM requests WHERE id = $1', [id])).rows[0];
    assert.deepEqual([r.status, r.version], ['resolved', '4']);
  });
  test('unchanged status: neither history nor refusal', async () => {
    const id = await draft();
    await move('alice', id, 'draft');
    assert.equal((await history(id)).length, 1);
  });
  test('illegal transitions refused by the database, nothing is written', async () => {
    const id = await draft();
    await assert.rejects(move('bruno', id, 'in_progress'), TRANSITION);
    await assert.rejects(move('bruno', id, 'resolved', 'x'), TRANSITION);
    await move('alice', id, 'cancelled');
    for (const status of ['draft', 'submitted', 'in_progress', 'resolved', 'rejected']) await assert.rejects(move('bruno', id, status, 'x'), TRANSITION, status);
    assert.deepEqual((await history(id)).map((h) => h[1]), ['draft', 'cancelled']);
    const birth = db.tx(ctx('alice'), (t) => t.query("INSERT INTO requests (category_code, urgency, requester_id, status) VALUES ('locksmith', 'low', $1, 'submitted')", [actors.alice]));
    await assert.rejects(birth, TRANSITION);
  });
  test('resolving or rejecting requires the closing note', async () => {
    const id = await draft();
    await move('alice', id, 'submitted');
    await assert.rejects(move('bruno', id, 'rejected'), /requires a closing note/);
    await move('bruno', id, 'rejected', 'Outside the scope of the service');
    assert.equal((await history(id)).at(-1)?.[1], 'rejected');
  });
  test('outside tx(): refused', async () => {
    const id = await draft();
    await assert.rejects(query(s.app, "UPDATE requests SET status = 'submitted' WHERE id = $1", [id]), REFUSAL);
  });
});

describe('audit (core, key as argument)', () => {
  test('categories by code, details and attachment by request_id, without any value', async () => {
    const id = await draft();
    await db.tx(ctx('bruno'), (t) => t.query("UPDATE categories SET label = 'Locksmith and doors' WHERE code = 'locksmith'"));
    await db.tx(ctx('alice'), (t) => t.query("INSERT INTO request_attachments (request_id, name, media_type, content) VALUES ($1, 'door.png', 'image/png', '\\x89504e47')", [id]));
    const rows = (await query(s.owner, "SELECT table_name, row_id, row_key, op FROM audit_log WHERE (table_name = 'categories' AND op = 'UPDATE') OR row_id = $1 ORDER BY id", [id])).rows
      .map((r) => [r.table_name, r.row_id ?? r.row_key, r.op]);
    assert.deepEqual(rows, [
      ['requests', id, 'INSERT'], ['request_details', id, 'INSERT'],
      ['categories', 'locksmith', 'UPDATE'], ['request_attachments', id, 'INSERT'],
    ]);
    const all = JSON.stringify((await query(s.owner, 'SELECT * FROM audit_log')).rows);
    for (const value of ['Door of dock 3', 'door.png', 'Locksmith and doors']) assert.ok(!all.includes(value), value);
  });
});

describe('purge (ADR-003, the core\'s bin/purge.js on db/purge.sql)', () => {
  const TABLES = ['categories', 'requests', 'request_details', 'request_attachments', 'request_history', 'audit_log', 'actors'];
  // Test and demo values only: the client fixes each one at Gate 1 (docs/DECISIONS.md).
  const PERIODS = { RETENTION_REQUESTS: '2 years', RETENTION_DRAFTS: '6 months', RETENTION_DELETED: '30 days', RETENTION_HISTORY: '5 years', RETENTION_AUDIT: '1 year' };
  /** The command as the scheduler runs it, from the tool's root. @param {Record<string, string>} periods */
  const run = (periods) => promisify(execFile)(process.execPath, ['node_modules/@eupadev/core/bin/purge.js'], {
    cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, DATABASE_URL: s.purge, DATABASE_TLS: 'off', ...periods },
  });
  /** Every row, as text, per table: the comparison is byte for byte. */
  const snapshot = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) =>
    [t, (await query(s.owner, `SELECT x::text AS l FROM ${t} x ORDER BY 1`)).rows.map((r) => r.l)])));
  /** Moves dates back without triggers (no version, no audit, no append-only refusal): makes a past, tests only. */
  const backdate = (/** @type {string} */ sql, /** @type {unknown[]} */ values) => query(s.admin,
    `WITH r AS (SELECT set_config('session_replication_role', 'replica', true)) ${sql}`, values);

  test('refused when one of the periods is missing, without deleting anything', async () => {
    const before = await snapshot();
    for (const missing of Object.keys(PERIODS)) {
      const periods = { ...PERIODS };
      delete periods[/** @type {keyof typeof PERIODS} */ (missing)];
      await assert.rejects(run(periods), (/** @type {any} */ e) => e.code === 1 && e.stderr.includes(missing));
    }
    assert.deepEqual(await snapshot(), before);
  });

  test('deletes the soft-deleted beyond RETENTION_DELETED and the expired finished request with their personal data, the expired history and audit; nothing else moves', async () => {
    const deleted = await draft();
    await db.tx(ctx('alice'), async (t) => {
      await t.query("INSERT INTO request_attachments (request_id, name, media_type, content) VALUES ($1, 'door.png', 'image/png', '\\x89504e47')", [deleted]);
      await t.query('UPDATE requests SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [deleted, actors.alice]);
    });
    await backdate("UPDATE app.requests SET deleted_at = now() - interval '31 days' FROM r WHERE id = $1", [deleted]);
    const restorable = await draft(); // deleted a day ago: still within RETENTION_DELETED
    await db.tx(ctx('alice'), (t) => t.query('UPDATE requests SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [restorable, actors.alice]));
    await backdate("UPDATE app.requests SET deleted_at = now() - interval '1 day' FROM r WHERE id = $1", [restorable]);
    const old = await draft();
    const recent = await draft();
    const open = await draft();
    for (const id of [old, recent]) {
      await move('alice', id, 'submitted');
      await move('bruno', id, 'in_progress');
      await move('bruno', id, 'resolved', 'Strike plate replaced');
    }
    await move('alice', open, 'submitted');
    await backdate("UPDATE app.requests SET updated_at = now() - interval '3 years' FROM r WHERE id = ANY($1)", [[old, open]]);
    await backdate("UPDATE app.request_history SET at = now() - interval '6 years' FROM r WHERE request_id = $1", [open]);
    await query(s.admin, `INSERT INTO app.audit_log (at, actor_id, actor_type, request_id, txid, table_name, row_id, op, changed_columns)
      VALUES (now() - interval '13 months', $1, 'human', 'old', 1, 'requests', $2, 'INSERT', '{}')`, [actors.alice, open]);
    const before = await snapshot();

    const output = JSON.parse((await run(PERIODS)).stdout);
    assert.equal(output.core.audit_log, 1);
    assert.deepEqual(output.tool, [2, 1, 2, 2], 'details, attachment, requests, history');

    const after = await snapshot();
    const gone = (/** @type {string} */ l) => [deleted, old].some((id) => l.startsWith(`(${id},`));
    for (const t of ['requests', 'request_details', 'request_attachments']) assert.deepEqual(after[t], before[t].filter((l) => !gone(l)), t);
    assert.equal(after.request_details.length, before.request_details.length - 2);
    assert.equal(after.request_attachments.length, before.request_attachments.length - 1);
    assert.deepEqual(after.request_history, before.request_history.filter((l) => !l.includes(open)), 'history older than 5 years gone, that of a purged request stays until its own period');
    assert.ok(after.requests.some((l) => l.startsWith(`(${open},`)), 'the open request stays');
    assert.ok(after.requests.some((l) => l.startsWith(`(${restorable},`)), 'deleted a day ago: kept, still restorable');
    assert.deepEqual(after.audit_log, before.audit_log.filter((l) => !l.includes(',old,')), 'audit identical byte for byte except the expired row');
    for (const t of ['categories', 'actors']) assert.deepEqual(after[t], before[t], t);
  });

  test('abandoned draft: purged with its details RETENTION_DRAFTS after its last change; a recent draft stays', async () => {
    const abandoned = await draft();
    const active = await draft();
    await backdate("UPDATE app.requests SET updated_at = now() - interval '7 months' FROM r WHERE id = $1", [abandoned]);
    const output = JSON.parse((await run(PERIODS)).stdout);
    assert.deepEqual(output.tool, [1, 0, 1, 0], 'details, attachment, requests, history');
    const left = (await query(s.owner, 'SELECT id FROM requests WHERE id = ANY($1)', [[abandoned, active]])).rows.map((r) => r.id);
    assert.deepEqual(left, [active]);
    assert.equal((await query(s.owner, 'SELECT count(*)::int n FROM request_details WHERE request_id = $1', [abandoned])).rows[0].n, 0);
  });
});

describe('demo seed (ADR-032, db/seed/demo.sql: the Preview\'s data, loaded by the platform after the migrations)', () => {
  const DEMO = "id::text LIKE 'd0000000-%'";
  test('applies as the owner in one transaction; every status, every category and every table of the tool gets rows', async () => {
    const sql = readFileSync(new URL('../db/seed/demo.sql', import.meta.url), 'utf8');
    // Same refusal as the platform's seed step: comments and quoted texts set aside, INSERT and UPDATE only.
    const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, '');
    assert.doesNotMatch(code, /\\|\$[A-Za-z_]*\$|\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE|MERGE|COPY|DO)\b/i);
    assert.ok(/@example\.com/.test(sql) && !/@(?!example\.com)[a-z-]+\.(com|fr|org|net)/i.test(sql), 'fictional mails only');
    await query(s.owner, `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';\n${sql}\n; COMMIT;`);
    const statuses = (await query(s.owner, `SELECT status, count(*)::int n FROM requests WHERE ${DEMO} GROUP BY status ORDER BY status`)).rows;
    assert.deepEqual(statuses.map((r) => r.status), ['cancelled', 'draft', 'in_progress', 'rejected', 'resolved', 'submitted']);
    assert.equal(statuses.reduce((n, r) => n + r.n, 0), 15);
    assert.equal((await query(s.owner, `SELECT count(*)::int n FROM requests WHERE ${DEMO} AND deleted_at IS NOT NULL`)).rows[0].n, 2);
    assert.deepEqual((await query(s.owner, 'SELECT code FROM categories c WHERE NOT EXISTS (SELECT FROM requests r WHERE r.category_code = c.code)')).rows, []);
    assert.ok((await query(s.owner, `SELECT count(*)::int n FROM request_history h JOIN requests r ON r.id = h.request_id WHERE r.${DEMO}`)).rows[0].n >= 15 + 12);
    // The boot check's rule: no table of the tool (schema app less the core's, the ledgers and *_history) left empty.
    const migrations = new URL('../node_modules/@eupadev/core/migrations/', import.meta.url);
    const core = readdirSync(migrations).map((f) => readFileSync(new URL(f, migrations), 'utf8')).join('\n');
    const excluded = [...core.matchAll(/^CREATE TABLE ([a-z_]+)/gm)].map((m) => m[1]).concat('core_migrations', 'pgmigrations');
    const empty = (await query(s.owner, `SELECT string_agg(table_name, ', ') FROM information_schema.tables
      WHERE table_schema = 'app' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '%\\_history' AND table_name <> ALL($1)
      AND (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM app.%I', table_name), false, true, '')))[1]::text = '0'`, [excluded])).rows[0].string_agg;
    assert.equal(empty, null);
  });
});
