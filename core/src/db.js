// Database: `pg` pool and `tx()`, the handlers' only access to the database (§2.5). Each transaction starts with
// `set_config(…, true)` (same as SET LOCAL): `audit_row()` and the RLS policies read `app.actor_id`, `app.roles`,
// `app.request_id`. After the transaction, the connection given back to the pool carries an empty string (not NULL):
// hence the `NULLIF(current_setting(…, true), '')` guard on the SQL side.
import { readFileSync } from 'node:fs';
import pg from 'pg';

/** @typedef {{ url: string, tls: false | { ca: string, servername?: string }, max?: number }} DbConfig */

/**
 * `ssl` option of `pg` for this configuration, shared by the pool and bin/migrate.js: verified TLS (internal CA,
 * server name defaulting to the URL's host) or none.
 * @param {DbConfig} config
 * @returns {false | import('node:tls').ConnectionOptions}
 */
export function sslOptions(config) {
  return config.tls === false ? false : { ca: config.tls.ca, rejectUnauthorized: true, servername: config.tls.servername ?? new URL(config.url).hostname };
}

/** @param {DbConfig} config */
export function createDb(config) {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    maxLifetimeSeconds: 1_800,
    query_timeout: 15_000,
    ssl: sslOptions(config),
  });
  pool.on('error', () => { /* idle connection lost: the pool replaces it */ });
  return {
    /**
     * Transaction of a handler (identity set) or of the core itself (`context` null: sessions, actors, no audited
     * table; `audit_row()` would refuse a business write without an identity anyway).
     * @template T
     * @param {{ actorId: string, roles: string[], requestId: string } | null} context
     * @param {(t: import('./http.js').Transaction) => Promise<T>} fn
     */
    async tx(context, fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (context) {
          await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)',
            ['app.actor_id', context.actorId, 'app.roles', context.roles.join(','), 'app.request_id', context.requestId]);
        }
        const r = await fn({
          query: (text, values = []) => {
            if (typeof text !== 'string') throw new TypeError('tx: the SQL is a string, the values are parameters');
            return client.query(text, values);
          },
        });
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    /**
     * One query outside a transaction, reserved for the core (reading and extending a session): never exposed to
     * the handlers, which only have `ctx.db.tx()`.
     * @param {string} text @param {unknown[]} [values]
     */
    query: (text, values = []) => pool.query(text, values),
    async health() {
      try { await pool.query('SELECT 1'); return true; } catch { return false; }
    },
    close: () => pool.end(),
  };
}

/**
 * Configuration read from the environment: `DATABASE_URL` (or `DATABASE_URL_FILE`), TLS verified with
 * `DATABASE_CA_FILE` (internal authority, D11) unless `DATABASE_TLS=off` is explicit (development, tests).
 * @param {NodeJS.ProcessEnv} env
 * @returns {DbConfig}
 */
export function dbConfigFromEnv(env) {
  const url = env.DATABASE_URL ?? (env.DATABASE_URL_FILE ? readFileSync(env.DATABASE_URL_FILE, 'utf8').trim() : undefined);
  if (!url) throw new Error('DATABASE_URL (or DATABASE_URL_FILE) missing');
  if (env.DATABASE_TLS === 'off') return { url, tls: false };
  if (!env.DATABASE_CA_FILE) throw new Error('DATABASE_CA_FILE missing (TLS to PostgreSQL required; DATABASE_TLS=off only in development)');
  return { url, tls: { ca: readFileSync(env.DATABASE_CA_FILE, 'utf8'), ...(env.DATABASE_TLS_SERVERNAME ? { servername: env.DATABASE_TLS_SERVERNAME } : {}) } };
}
