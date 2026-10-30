#!/usr/bin/env node
// Migrations, with the owner account (`DATABASE_URL` of `<tool>_owner`), outside the web process (D14): the core's
// (table `core_migrations`, expansion only) then the tool's (`db/migrations`, table `pgmigrations`), all in the
// `app` schema. node-pg-migrate is a runtime dependency of the core (the tool's production image runs this
// command); it is imported lazily so the web process never loads it.
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbConfigFromEnv, sslOptions } from '../src/db.js';

/**
 * Connection given to node-pg-migrate: a URL as is (tests, kit), or a configuration read from the environment
 * like the web process (`DATABASE_URL_FILE`, `DATABASE_CA_FILE`, `DATABASE_TLS`), TLS options included.
 * @param {string | import('../src/db.js').DbConfig} target
 * @returns {string | import('pg').ClientConfig}
 */
export function connection(target) {
  return typeof target === 'string' ? target : { connectionString: target.url, ssl: sslOptions(target) };
}

/**
 * @param {string | import('../src/db.js').DbConfig} target
 * @param {{ toolDir?: string, log?: (m: string) => void }} [o]
 */
export async function migrate(target, o = {}) {
  /** @type {typeof import('node-pg-migrate')} */
  let npm;
  try { npm = await import('node-pg-migrate'); } catch { throw new Error('node-pg-migrate missing: it is a dependency of @eupadev/core, install it with `pnpm install --prod`'); }
  const log = o.log ?? (() => {});
  const common = { databaseUrl: connection(target), direction: /** @type {const} */ ('up'), schema: 'app', checkOrder: true, log };
  await npm.runner({ ...common, dir: fileURLToPath(new URL('../migrations/', import.meta.url)), migrationsTable: 'core_migrations' });
  const tool = resolve(o.toolDir ?? 'db/migrations');
  if (existsSync(tool)) await npm.runner({ ...common, dir: tool, migrationsTable: 'pgmigrations' });
}

// Run as a command: argv[1] often goes through the node_modules symbolic link (pnpm), import.meta.url never does.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Owner account, read like the web process and bin/purge.js read theirs.
  /** @type {import('../src/db.js').DbConfig} */ let config;
  try { config = dbConfigFromEnv(process.env); } catch (e) { process.stderr.write(`${/** @type {Error} */ (e).message} (owner account)\n`); process.exit(1); }
  await migrate(config, { log: (m) => process.stdout.write(`${m}\n`) });
}
