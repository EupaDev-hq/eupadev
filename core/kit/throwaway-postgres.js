// Throwaway PostgreSQL for the tests of a tool and of the core: a postgres:18.6-alpine container (digest, ADR-005) on
// a free port, roles of sql/roles.sql set by psql (local superuser), database migrated by <tool>_owner through
// bin/migrate.js (core then `toolDir`), removed at the end, even on failure. Docker is required.
// Same image and same approach as the engine's throwaway PostgreSQL test helper.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import pg from 'pg';
import { migrate } from '../bin/migrate.js';

export { migrate };

export const IMAGE = 'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const PASSWORDS = { admin: 'test-admin', owner: 'test-owner', app: 'test-app', purge: 'test-purge' };
const docker = (/** @type {string[]} */ ...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/** @typedef {{ admin: string, owner: string, app: string, purge: string, container: string, remove(): void }} ThrowawayPostgres */

/**
 * @param {{ tool: string, toolDir?: string }} o `tool`: database name and role prefix; `toolDir`: the tool's
 * migrations (default `db/migrations` of the current directory, like bin/migrate.js)
 * @returns {Promise<ThrowawayPostgres>}
 */
export async function startPostgres({ tool, toolDir = 'db/migrations' }) {
  let container = docker('run', '-d', '--rm', '-e', `POSTGRES_PASSWORD=${PASSWORDS.admin}`, '-e', `POSTGRES_DB=${tool}`, '-p', '127.0.0.1::5432', IMAGE);
  const remove = () => {
    if (container === '') return;
    try { execFileSync('docker', ['rm', '-f', '-v', container], { stdio: 'ignore' }); } catch { /* already gone */ }
    container = '';
  };
  process.once('SIGINT', () => { remove(); process.exit(130); });
  process.once('SIGTERM', () => { remove(); process.exit(143); });
  process.once('exit', remove);
  const port = docker('port', container, '5432/tcp').split('\n')[0]?.split(':').pop();
  const url = (/** @type {keyof typeof PASSWORDS} */ role) => `postgres://${role === 'admin' ? 'postgres' : `${tool}_${role}`}:${PASSWORDS[role]}@127.0.0.1:${port}/${tool}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const c = new pg.Client({ connectionString: url('admin') });
      await c.connect();
      await c.query('select 1');
      await c.end();
      break;
    } catch (e) {
      if (Date.now() > deadline) { remove(); throw new Error(`PostgreSQL unreachable: ${String(e)}`); }
      await wait(500);
    }
  }
  execFileSync('docker', ['exec', '-i', container, 'psql', '-q', '-U', 'postgres', '-d', tool, '-v', 'ON_ERROR_STOP=1',
    '-v', `tool=${tool}`, '-v', `owner_password=${PASSWORDS.owner}`, '-v', `app_password=${PASSWORDS.app}`, '-v', `purge_password=${PASSWORDS.purge}`, '-f', '-'],
    { input: readFileSync(new URL('../sql/roles.sql', import.meta.url)), stdio: ['pipe', 'ignore', 'inherit'] });
  await migrate(url('owner'), { toolDir: resolve(toolDir) });
  return { admin: url('admin'), owner: url('owner'), app: url('app'), purge: url('purge'), container, remove };
}

/**
 * One query on a fresh connection of this role (outside the pool, outside tx()).
 * @param {string} url @param {string} sql @param {unknown[]} [values]
 */
export async function query(url, sql, values = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await c.query(sql, values); } finally { await c.end(); }
}
