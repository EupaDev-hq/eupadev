/**
 * Migration of the orchestrator's db (step 6), run by the owner account, never by the engine: versioned migrations
 * (node-pg-migrate "up"), then the DBOS system schema through the official function `DBOS.migrate`, which grants the
 * engine's account (`orch_engine`) rights on that schema only. The engine starts with `runMigrations: false`: DBOS
 * then checks the schema version and refuses to start if it is missing or behind.
 * Usage: ORCH_MIGRATION_DATABASE_URL=postgres://orch_owner:…@host/db node src/migrate.ts
 * (or ORCH_MIGRATION_DATABASE_URL_FILE=<file>: secret read from a file, `readSecret`)
 */
import { fileURLToPath } from 'node:url';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { runner } from 'node-pg-migrate';
import { readSecret } from './config.ts';

export const ENGINE_ROLE = 'orch_engine';
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

export async function migrateDatabase(url: string, options: { dir?: string; log?: (m: string) => void } = {}): Promise<void> {
  await runner({ databaseUrl: url, dir: options.dir ?? MIGRATIONS, direction: 'up', migrationsTable: 'pgmigrations', count: Infinity, log: options.log ?? console.log });
  await DBOS.migrate(url, { schemaName: 'dbos', applicationRole: ENGINE_ROLE });
}

// Run as a script (not imported by the tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let url: string;
  try {
    url = readSecret(process.env, 'ORCH_MIGRATION_DATABASE_URL');
  } catch (e) {
    console.error(`Invalid configuration: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  try {
    await migrateDatabase(url);
    console.log('Database migrated (versioned migrations and DBOS schema).');
  } catch (e) {
    console.error(`Migration impossible: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
