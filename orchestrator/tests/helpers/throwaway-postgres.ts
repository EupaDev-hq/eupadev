// Throwaway PostgreSQL for the tests: postgres:18.6-alpine container on a free port, accounts of sql/roles.sql created,
// database migrated by orch_owner (src/migrate.ts, as in production), removed at the end (even on failure, even on SIGINT).
// Shared by db.test.ts, Cucumber and the resume test.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { migrateDatabase } from '../../src/migrate.ts';

export const IMAGE = 'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const PASSWORD = 'test-orchestrator';
const OWNER_PASSWORD = 'test-owner';
const ENGINE_PASSWORD = 'test-engine';
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

export interface ThrowawayPostgres {
  /** Superuser: emergency account, test setups. */
  urlAdmin: string;
  /** orch_owner: applies the migrations. */
  ownerUrl: string;
  /** orch_engine: the engine's limited account. */
  engineUrl: string;
  container: string;
  remove(): void;
}

/** Versioned migrations only (node-pg-migrate), in either direction: schema tests. */
export const migrate = (url: string, direction: 'up' | 'down', dir = 'migrations', count = Infinity) =>
  runner({ databaseUrl: url, dir, direction, migrationsTable: 'pgmigrations', count, log: () => {} });

/** Same account, another database of the server. */
export const urlBase = (url: string, name: string) => url.replace(/\/orchestrator$/, `/${name}`);

/** Fresh (empty) database owned by orch_owner, like the one sql/roles.sql prepares. */
export async function createDatabase(server: ThrowawayPostgres, name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: server.urlAdmin });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} OWNER orch_owner`);
  await admin.end();
}

/** Full migration, as in production: versioned ones then the DBOS schema (src/migrate.ts), as orch_owner. */
export const migrateAll = (ownerUrl: string, dir?: string) => migrateDatabase(ownerUrl, { ...(dir !== undefined ? { dir } : {}), log: () => {} });

/**
 * Fresh, migrated database on the same server (one per test: the workflows of one test do not see those of another). Returns
 * the engine's URL (orch_engine): the tests start the orchestrator with it.
 */
export async function migratedDatabase(server: ThrowawayPostgres, name: string): Promise<string> {
  await createDatabase(server, name);
  await migrateAll(urlBase(server.ownerUrl, name));
  return urlBase(server.engineUrl, name);
}

export async function startPostgres(options: { migrations?: boolean; migrationsDir?: string } = {}): Promise<ThrowawayPostgres> {
  let container = docker('run', '-d', '--rm', '-e', `POSTGRES_PASSWORD=${PASSWORD}`, '-e', 'POSTGRES_DB=orchestrator', '-p', '127.0.0.1::5432', IMAGE);
  const remove = () => {
    if (container === '') return;
    try { execFileSync('docker', ['rm', '-f', '-v', container], { stdio: 'ignore' }); } catch { /* already gone */ }
    container = '';
  };
  process.once('SIGINT', () => { remove(); process.exit(130); });
  process.once('SIGTERM', () => { remove(); process.exit(143); });
  process.once('exit', remove);
  const port = docker('port', container, '5432/tcp').split('\n')[0]!.split(':').pop();
  const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/orchestrator`;
  const ownerUrl = `postgres://orch_owner:${OWNER_PASSWORD}@127.0.0.1:${port}/orchestrator`;
  const engineUrl = `postgres://orch_engine:${ENGINE_PASSWORD}@127.0.0.1:${port}/orchestrator`;
  // The image restarts once during init: we wait for a real query that goes through.
  const limit = Date.now() + 90_000;
  for (;;) {
    try {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query('select 1');
      await c.end();
      break;
    } catch (e) {
      if (Date.now() > limit) { remove(); throw new Error(`PostgreSQL unreachable: ${String(e)}`); }
      await sleep(500);
    }
  }
  // Accounts: the production file, through psql in the container (local superuser).
  execFileSync('docker', ['exec', '-i', container, 'psql', '-q', '-U', 'postgres', '-d', 'orchestrator', '-v', 'ON_ERROR_STOP=1',
    '-v', `owner_password=${OWNER_PASSWORD}`, '-v', `engine_password=${ENGINE_PASSWORD}`, '-f', '-'],
    { input: readFileSync(new URL('../../sql/roles.sql', import.meta.url)), stdio: ['pipe', 'ignore', 'inherit'] });
  if (options.migrations !== false) await migrateAll(ownerUrl, options.migrationsDir);
  return { urlAdmin: url, ownerUrl, engineUrl, container, remove };
}

/**
 * Setup only (never in the code): writes data that the protection triggers refuse outside the
 * intended paths (cost of a closed task, memory without a transition, M8), to put a test in a given situation.
 * `session_replication_role = replica` suspends the triggers for the duration of the transaction: reserved for the superuser
 * of the throwaway PostgreSQL, hence a separate ADMIN connection, opened on the database of `url` (the engine's); the engine
 * itself never has this right.
 */
export async function unprotected(url: string, sql: string, values: unknown[] = []): Promise<pg.QueryResult> {
  const admin = new URL(url);
  admin.username = 'postgres';
  admin.password = PASSWORD;
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    const r = await client.query(sql, values);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}
