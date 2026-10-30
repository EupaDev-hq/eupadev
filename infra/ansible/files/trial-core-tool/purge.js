// Throwaway stand-in for the core's bin/purge.js (verify-deployer-core.yml):
// purge account, durations from RETENTION_* (no default), one JSON line.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = process.env;
const read = (v) => readFileSync(env[v], 'utf8').trim();
for (const v of ['RETENTION_AUDIT', 'RETENTION_TRIAL']) {
  if (!env[v]) { console.error(`${v} missing`); process.exit(1); }
}
const c = new pg.Client({ connectionString: read('DATABASE_URL_FILE'), ssl: { ca: read('DATABASE_CA_FILE') } });
await c.connect();
const r = await c.query('DELETE FROM app.trial WHERE created < now() - $1::interval', [env.RETENTION_TRIAL]);
console.log(JSON.stringify({ msg: 'purge', role: (await c.query('SELECT current_user AS r')).rows[0].r, trial: r.rowCount }));
await c.end();
