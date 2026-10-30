// Database: migrations from scratch and replayed, catalogue (ADR-003 D-8), rights of the three roles, tx() and audit
// (NULLIF on the empty string, unknown actor, rollback), tamper-proof audit_log and purge. Real PostgreSQL in a
// container (tests/helpers/throwaway-postgres.js): Docker is required.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../bin/migrate.js';
import { purge } from '../bin/purge.js';
import { createDb } from '../src/index.js';
import { TOOL, startPostgres, query } from './helpers/throwaway-postgres.js';

const TOOL_MIGRATIONS = fileURLToPath(new URL('./example/db/migrations', import.meta.url));
const REQ = (/** @type {string} */ c) => `00-${c.repeat(32)}-${c.repeat(16)}-01`;
/** @type {Awaited<ReturnType<typeof startPostgres>>} */ let s;
/** @type {ReturnType<typeof createDb>} */ let db;
/** @type {string} */ let actor;
before(async () => {
  s = await startPostgres();
  db = createDb({ url: s.app, tls: false, max: 1 });
  actor = (await query(s.app, "INSERT INTO actors (type, display_name) VALUES ('human', 'Test') RETURNING id")).rows[0].id;
});
after(async () => { await db?.close(); s?.remove(); });
const ctx = (requestId = REQ('a')) => ({ actorId: actor, roles: ['manager'], requestId });
const REFUSED = { code: '42501' };

describe('migrations', () => {
  test('from scratch then replayed: idempotent, two tracking tables in app, nothing in public', async () => {
    await migrate(s.owner, { toolDir: TOOL_MIGRATIONS });
    const tracking = await query(s.owner, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('core_migrations', 'pgmigrations') ORDER BY 1");
    assert.deepEqual(tracking.rows.map((r) => r.table_name), ['core_migrations', 'pgmigrations']);
    assert.deepEqual((await query(s.owner, 'SELECT name FROM core_migrations')).rows.map((r) => r.name), ['0001_core', '0002_sessions_token_version', '0003_audit_key', '0004_audit_purge']);
    assert.deepEqual((await query(s.owner, 'SELECT name FROM pgmigrations')).rows.map((r) => r.name), ['0001_items']);
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0].n, 0);
  });
  test('the core\'s migration is an immutable SQL without Down, timeouts first (ADR-004)', () => {
    const sql = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
    assert.ok(!sql.includes('Down Migration'));
    assert.match(sql, /^-- Up Migration\n(?:--.*\n)*SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';/);
  });
});

describe('catalogue (ADR-003 D-8) and roles', () => {
  test('no ENUM, no timestamp without time zone, primary key everywhere, uuid by uuidv7', async () => {
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typtype = 'e'")).rows[0].n, 0);
    // (node-pg-migrate's tracking tables, out of our hands, have a `run_on timestamp`)
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'app' AND data_type = 'timestamp without time zone' AND table_name NOT IN ('core_migrations', 'pgmigrations')")).rows[0].n, 0);
    assert.deepEqual((await query(s.owner, "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT EXISTS (SELECT FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'p')")).rows, []);
    assert.deepEqual((await query(s.owner, "SELECT table_name FROM information_schema.columns WHERE table_schema = 'app' AND column_name = 'id' AND data_type = 'uuid' AND column_default IS DISTINCT FROM 'uuidv7()'")).rows, []);
    assert.deepEqual((await query(s.owner, "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'app'")).rows, [{ tableowner: `${TOOL}_owner` }]);
  });
  test('roles: no dangerous attribute, groups without login, memberships, session settings', async () => {
    const roles = (await query(s.admin, "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname LIKE 'example\\_%' OR rolname LIKE 'core\\_%' ORDER BY 1")).rows;
    assert.deepEqual(roles.map((r) => r.rolname), ['core_app', 'core_purge', 'example_app', 'example_owner', 'example_purge']);
    for (const r of roles) {
      assert.deepEqual([r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls], [false, false, false, false], r.rolname);
      assert.equal(r.rolcanlogin, !r.rolname.startsWith('core_'), r.rolname);
    }
    const m = (await query(s.admin, "SELECT pg_has_role('example_app', 'core_app', 'MEMBER') a, pg_has_role('example_app', 'core_purge', 'MEMBER') b, pg_has_role('example_purge', 'core_purge', 'MEMBER') c")).rows[0];
    assert.deepEqual([m.a, m.b, m.c], [true, false, true]);
    const r = (await query(s.app, 'SELECT current_setting(\'search_path\') sp, current_setting(\'statement_timeout\') st, current_setting(\'lock_timeout\') lt, current_setting(\'idle_in_transaction_session_timeout\') it')).rows[0];
    assert.deepEqual(r, { sp: 'app', st: '10s', lt: '3s', it: '10s' });
    // REVOKE CONNECT … FROM PUBLIC: a role of the server that is not one of the three does not connect to the database.
    await query(s.admin, "CREATE ROLE intruder LOGIN PASSWORD 'intruder'");
    await assert.rejects(query(s.admin.replace('postgres:test-admin', 'intruder:intruder'), 'SELECT 1'), REFUSED);
  });
  test('web process: no DDL, no triggers, no TRUNCATE, no replica, no physical DELETE, no change of the audit', async () => {
    await assert.rejects(query(s.app, 'CREATE TABLE x (id int)'), REFUSED);
    await assert.rejects(query(s.app, 'ALTER TABLE items DISABLE TRIGGER items_audit'), REFUSED);
    await assert.rejects(query(s.app, 'DROP TRIGGER items_audit ON items'), REFUSED);
    await assert.rejects(query(s.app, 'TRUNCATE items'), REFUSED);
    await assert.rejects(query(s.app, 'SET session_replication_role = replica'), REFUSED);
    await assert.rejects(query(s.app, "UPDATE audit_log SET op = 'DELETE'"), REFUSED);
    await assert.rejects(query(s.app, 'DELETE FROM audit_log'), REFUSED);
    await assert.rejects(query(s.app, 'DELETE FROM items'), REFUSED);
    await assert.rejects(query(s.app, "UPDATE actors SET type = 'machine'"), REFUSED);
    await assert.rejects(query(s.app, 'DELETE FROM actors'), REFUSED);
    await query(s.app, "INSERT INTO actor_identities (issuer, subject, actor_id, reason) VALUES ('https://idp', 'sub-1', $1, 'login')", [actor]);
    await assert.rejects(query(s.app, "UPDATE actor_identities SET subject = 'sub-2'"), REFUSED);
    await assert.rejects(query(s.app, "INSERT INTO sessions (id, secret_hash, actor_id, roles, idle_expires_at, absolute_expires_at) VALUES ('short', '\\x00', $1, '{}', now(), now())", [actor]), { code: '23514' });
  });
  test('purge: read and delete only', async () => {
    await assert.rejects(query(s.purge, "INSERT INTO items (name) VALUES ('x')"), REFUSED);
    await assert.rejects(query(s.purge, "UPDATE items SET name = 'x'"), REFUSED);
    assert.equal((await query(s.purge, 'SELECT count(*)::int n FROM items')).rows[0].n, 0);
    await query(s.purge, 'DELETE FROM sessions');
  });
});

describe('tx() and audit', () => {
  test('write through tx(): audit with actor, request_id, changed columns, no value', async () => {
    const id = await db.tx(ctx(), async (t) => (await t.query('INSERT INTO items (name) VALUES ($1) RETURNING id', ['confidential-value'])).rows[0].id);
    await db.tx(ctx(REQ('c')), (t) => t.query("UPDATE items SET name = $2, status = 'closed' WHERE id = $1", [id, 'other-value']));
    await db.tx(ctx(), (t) => t.query('UPDATE items SET name = name WHERE id = $1', [id]));
    const rows = (await query(s.owner, 'SELECT * FROM audit_log WHERE row_id = $1 ORDER BY id', [id])).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual([rows[0].op, rows[0].actor_id, rows[0].actor_type, rows[0].request_id, rows[0].table_name, rows[0].changed_columns],
      ['INSERT', actor, 'human', REQ('a'), 'items', []]);
    assert.deepEqual([rows[1].op, rows[1].request_id, rows[1].changed_columns], ['UPDATE', REQ('c'), ['name', 'status', 'updated_at', 'version']]);
    assert.deepEqual(rows[2].changed_columns, ['updated_at', 'version']);
    assert.equal((await query(s.owner, 'SELECT version FROM items WHERE id = $1', [id])).rows[0].version, '3');
    assert.ok(!JSON.stringify(rows).includes('value'), 'the audit carries no value');
    const ok = await db.tx(ctx(), (t) => t.query("SELECT current_actor() a, current_setting('app.roles') r, current_setting('app.request_id') q"));
    assert.deepEqual(ok.rows[0], { a: actor, r: 'manager', q: REQ('a') });
  });
  test('outside tx(): refused; after a transaction, the variable holds the empty string, not NULL: refused too', async () => {
    await assert.rejects(query(s.app, "INSERT INTO items (name) VALUES ('outside tx')"), /app\.actor_id and app\.request_id required/);
    const c = new pg.Client({ connectionString: s.app });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.actor_id', $1, true), set_config('app.request_id', 'r', true)", [actor]);
      await c.query("INSERT INTO items (name) VALUES ('in the transaction')");
      await c.query('COMMIT');
      assert.equal((await c.query("SELECT current_setting('app.actor_id', true) v")).rows[0].v, '', 'the trap: empty string');
      await assert.rejects(c.query("INSERT INTO items (name) VALUES ('after the transaction')"), /app\.actor_id/);
    } finally { await c.end(); }
  });
  test('unknown actor refused; exception in tx(): everything rolled back; non-literal SQL refused', async () => {
    await assert.rejects(db.tx({ actorId: randomUUID(), roles: [], requestId: 'r' }, (t) => t.query("INSERT INTO items (name) VALUES ('x')")), /unknown actor/);
    await assert.rejects(db.tx(ctx(), async (t) => { await t.query("INSERT INTO items (name) VALUES ('rolled-back')"); throw new Error('boom'); }), /boom/);
    assert.equal((await query(s.owner, "SELECT count(*)::int n FROM items WHERE name = 'rolled-back'")).rows[0].n, 0);
    await assert.rejects(db.tx(ctx(), (t) => t.query(/** @type {any} */ ({ text: 'SELECT 1' }))), TypeError);
    assert.equal(await db.health(), true);
  });
  test('key as an argument (0003): text key in row_key, named uuid key in row_id, missing column refused', async () => {
    await query(s.owner, "CREATE TABLE refs (code text PRIMARY KEY, label text NOT NULL)");
    await query(s.owner, "CREATE TRIGGER refs_audit AFTER INSERT OR UPDATE ON refs FOR EACH ROW EXECUTE FUNCTION audit_row('code')");
    await query(s.owner, 'CREATE TABLE refs_uuid (item_id uuid PRIMARY KEY REFERENCES items (id))');
    await query(s.owner, "CREATE TRIGGER refs_uuid_audit AFTER INSERT ON refs_uuid FOR EACH ROW EXECUTE FUNCTION audit_row('item_id')");
    await query(s.owner, 'CREATE TABLE refs_wrong (code text PRIMARY KEY)');
    await query(s.owner, "CREATE TRIGGER refs_wrong_audit AFTER INSERT ON refs_wrong FOR EACH ROW EXECUTE FUNCTION audit_row()");
    const item = await db.tx(ctx(), async (t) => {
      await t.query("INSERT INTO refs (code, label) VALUES ('plumbing', 'Plumbing')");
      await t.query("UPDATE refs SET label = 'Plumbing and sanitation' WHERE code = 'plumbing'");
      const id = (await t.query("INSERT INTO items (name) VALUES ('key') RETURNING id")).rows[0].id;
      await t.query('INSERT INTO refs_uuid (item_id) VALUES ($1)', [id]);
      return id;
    });
    const rows = (await query(s.owner, "SELECT table_name, row_id, row_key, op, changed_columns FROM audit_log WHERE table_name LIKE 'refs%' ORDER BY id")).rows;
    assert.deepEqual(rows, [
      { table_name: 'refs', row_id: null, row_key: 'plumbing', op: 'INSERT', changed_columns: [] },
      { table_name: 'refs', row_id: null, row_key: 'plumbing', op: 'UPDATE', changed_columns: ['label'] },
      { table_name: 'refs_uuid', row_id: item, row_key: null, op: 'INSERT', changed_columns: [] },
    ]);
    await assert.rejects(db.tx(ctx(), (t) => t.query("INSERT INTO refs_wrong (code) VALUES ('x')")), /key column id missing from refs_wrong/);
    await assert.rejects(query(s.owner, "INSERT INTO audit_log (actor_id, actor_type, request_id, txid, table_name, op, changed_columns) VALUES ($1, 'human', 'r', 1, 't', 'INSERT', '{}')", [actor]), { code: '23514' });
  });
});

describe('tamper-proof audit_log and purge', () => {
  test('owner included: UPDATE, DELETE and TRUNCATE refused', async () => {
    await assert.rejects(query(s.owner, "UPDATE audit_log SET op = 'DELETE'"), /UPDATE refused/);
    await assert.rejects(query(s.owner, 'TRUNCATE audit_log'), /append-only/);
    await assert.rejects(query(s.owner, 'DELETE FROM audit_log'), /reserved for the purge role/);
  });
  test('purge: refused without a setting, refused within the period, deleted beyond', async () => {
    await assert.rejects(query(s.purge, 'DELETE FROM audit_log'), /core\.audit_retention missing/);
    await query(s.admin, `ALTER DATABASE ${TOOL} SET core.audit_retention = '1 day'`);
    await assert.rejects(query(s.purge, 'DELETE FROM audit_log'), /still within the retention period/);
    await query(s.admin, `ALTER DATABASE ${TOOL} SET core.audit_retention = '0 seconds'`);
    const n = (await query(s.owner, 'SELECT count(*)::int n FROM audit_log')).rows[0].n;
    assert.ok(n >= 4);
    assert.equal((await query(s.purge, 'DELETE FROM audit_log')).rowCount, n);
  });
  test('bin/purge.js: refused without a period; deletes the core\'s outdated rows, the rest of the audit identical; its deletions are not audited', async () => {
    const purgeDb = createDb({ url: s.purge, tls: false, max: 1 });
    const noTool = '/nonexistent/purge.sql';
    try {
      await assert.rejects(purge(purgeDb, { env: {}, toolFile: noTool }), /missing.*RETENTION_AUDIT/);
      await assert.rejects(purge(purgeDb, { env: { RETENTION_AUDIT: '0 seconds' }, toolFile: noTool }), /strictly positive/);
      await query(s.admin, `INSERT INTO app.audit_log (at, actor_id, actor_type, request_id, txid, table_name, row_id, op, changed_columns)
        VALUES (now() - interval '2 days', $1, 'human', 'old', 1, 'items', $2, 'INSERT', '{}')`, [actor, randomUUID()]);
      await query(s.admin, `INSERT INTO app.sessions (id, secret_hash, actor_id, roles, idle_expires_at, absolute_expires_at)
        VALUES ($1, $2, $3, '{}', now() - interval '1 minute', now() + interval '1 hour')`, ['expired'.repeat(3), Buffer.alloc(32), actor]);
      await query(s.admin, "INSERT INTO app.rate_limits (key, window_start, count) VALUES ('old', now() - interval '2 hours', 1)");
      const item = await db.tx(ctx(), async (t) => (await t.query("INSERT INTO items (name) VALUES ('to purge') RETURNING id")).rows[0].id);
      const recent = "SELECT * FROM audit_log WHERE at > now() - interval '1 day' ORDER BY id";
      const before = (await query(s.owner, recent)).rows;
      assert.equal((await query(s.purge, 'DELETE FROM items WHERE id = $1', [item])).rowCount, 1);
      const r = await purge(purgeDb, { env: { RETENTION_AUDIT: '1 day' }, toolFile: noTool });
      assert.deepEqual(r, { core: { sessions: 1, rate_limits: 1, audit_log: 1 }, tool: [] });
      assert.deepEqual((await query(s.owner, recent)).rows, before, 'recent audit identical, no row for the purge role\'s deletion');
    } finally {
      await purgeDb.close();
    }
  });
});

describe('bin/migrate.js as a command', () => {
  test('reads the owner URL from DATABASE_URL_FILE and connects over verified TLS (DATABASE_CA_FILE); a wrong CA is refused', async () => {
    const d = mkdtempSync(join(tmpdir(), 'migrate-tls-'));
    try {
      const certificate = (/** @type {string} */ name) => execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(d, `${name}.key`), '-out', join(d, `${name}.crt`)], { stdio: 'ignore' });
      certificate('server');
      certificate('other');
      for (const f of ['server.crt', 'server.key']) execFileSync('docker', ['cp', join(d, f), `${s.container}:/var/lib/postgresql/${f}`]);
      execFileSync('docker', ['exec', '-u', 'root', s.container, 'sh', '-c', 'chown postgres:postgres /var/lib/postgresql/server.* && chmod 600 /var/lib/postgresql/server.key']);
      for (const q of ["ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/server.crt'", "ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/server.key'", 'ALTER SYSTEM SET ssl = on', 'SELECT pg_reload_conf()']) await query(s.admin, q);
      writeFileSync(join(d, 'url'), `${s.owner}\n`);
      const run = (/** @type {Record<string, string>} */ env) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/migrate.js', import.meta.url))],
        { cwd: fileURLToPath(new URL('./example', import.meta.url)), encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', DATABASE_URL_FILE: join(d, 'url'), ...env } });
      const tls = run({ DATABASE_CA_FILE: join(d, 'server.crt'), DATABASE_TLS_SERVERNAME: 'localhost' });
      assert.equal(tls.status, 0, tls.stderr);
      const refused = run({ DATABASE_CA_FILE: join(d, 'other.crt'), DATABASE_TLS_SERVERNAME: 'localhost' });
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /self.signed|certificate/i);
      const noTls = run({ DATABASE_TLS: 'off' });
      assert.equal(noTls.status, 0, noTls.stderr);
      const missing = run({ DATABASE_URL_FILE: '' });
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /DATABASE_URL \(or DATABASE_URL_FILE\) missing \(owner account\)/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
