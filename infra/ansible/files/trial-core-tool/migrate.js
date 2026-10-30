// Throwaway stand-in for the core's bin/migrate.js (verify-deployer-core.yml):
// owner account from DATABASE_URL_FILE, TLS checked against DATABASE_CA_FILE.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = process.env;
const read = (v) => readFileSync(env[v], 'utf8').trim();
const c = new pg.Client({ connectionString: read('DATABASE_URL_FILE'), ssl: { ca: read('DATABASE_CA_FILE') } });
await c.connect();
await c.query('CREATE TABLE IF NOT EXISTS app.trial (id serial PRIMARY KEY, created timestamptz NOT NULL DEFAULT now())');
// Like the core's migrations/0001_core.sql: the group roles get the schema.
await c.query('GRANT USAGE ON SCHEMA app TO core_app, core_purge');
await c.query('GRANT SELECT ON app.trial TO core_app');
await c.query('GRANT SELECT, DELETE ON app.trial TO core_purge');
await c.query("INSERT INTO app.trial (created) VALUES (now() - interval '10 days'), (now())");
console.log(JSON.stringify({ msg: 'migrated', role: (await c.query('SELECT current_user AS r')).rows[0].r }));
await c.end();
