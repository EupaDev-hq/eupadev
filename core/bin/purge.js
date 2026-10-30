#!/usr/bin/env node
// Scheduled purge (ADR-003, decision E8 of step 8), with the purge account (`DATABASE_URL` of `<tool>_purge`:
// SELECT, DELETE), outside the web process, in one transaction: first the core's (expired sessions, rate-limit
// windows older than one hour, audit_log beyond RETENTION_AUDIT), then the tool's `db/purge.sql`. The periods come
// from the environment, without a default (they are set at Gate 1): `purge.sql` reads each period with
// `current_setting('purge.retention_<x>')`, set from the variable `RETENTION_<X>`; if one is missing, nothing runs.
// The purge role's deletions are not audited (migrations/0004_audit_purge.sql): the trace is the JSON line written
// here.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbConfigFromEnv, createDb } from '../src/db.js';

/** Environment variable of each period read by `purge.sql` (`purge.retention_requests` → `RETENTION_REQUESTS`). */
const PERIOD = /current_setting\('purge\.(retention_[a-z_]+)'\)/g;

/**
 * @param {ReturnType<typeof createDb>} db
 * @param {{ env: NodeJS.ProcessEnv, toolFile?: string }} o
 * @returns {Promise<{ core: Record<string, number>, tool: number[] }>} rows deleted per statement
 */
export async function purge(db, o) {
  const file = resolve(o.toolFile ?? 'db/purge.sql');
  const sql = existsSync(file) ? readFileSync(file, 'utf8') : null;
  /** @type {Map<string, string>} setting → period */ const periods = new Map([['core.audit_retention', 'RETENTION_AUDIT']]);
  for (const [, name = ''] of sql?.matchAll(PERIOD) ?? []) periods.set(`purge.${name}`, name.toUpperCase());
  const missing = [...periods.values()].filter((v) => !o.env[v]);
  if (missing.length) throw new Error(`retention periods missing (set at Gate 1, no default): ${missing.join(', ')}`);
  return db.tx(null, async (t) => {
    for (const [setting, variable] of periods) {
      const { rows } = await t.query('SELECT set_config($1, $2, true), $2::interval > interval \'0\' AS positive', [setting, o.env[variable]]);
      if (!rows[0].positive) throw new Error(`${variable}: strictly positive period expected`);
    }
    // ponytail: one transaction, each statement capped at 15 s by the pool; in batches the day a purge exceeds it.
    const core = {
      sessions: (await t.query('DELETE FROM sessions WHERE absolute_expires_at < now() OR idle_expires_at < now()')).rowCount ?? 0,
      rate_limits: (await t.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'")).rowCount ?? 0,
      audit_log: (await t.query("DELETE FROM audit_log WHERE at < now() - current_setting('core.audit_retention')::interval")).rowCount ?? 0,
    };
    /** @type {any} */ const r = sql === null ? [] : await t.query(sql);
    const tool = (Array.isArray(r) ? r : [r]).filter((x) => x.command === 'DELETE').map((x) => x.rowCount ?? 0);
    return { core, tool };
  });
}

// Run as a command: argv[1] often goes through the node_modules symbolic link (pnpm), import.meta.url never does.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = createDb({ ...dbConfigFromEnv(process.env), max: 1 });
  try {
    process.stdout.write(`${JSON.stringify({ msg: 'purge', ...(await purge(db, { env: process.env })) })}\n`);
  } catch (e) {
    process.stderr.write(`purge refused: ${/** @type {Error} */ (e).message}\n`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
