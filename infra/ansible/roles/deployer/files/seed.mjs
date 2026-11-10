// Demo data of a core tool on the Preview (ADR-032). Run by eupadev-deployer as the one-shot service `seed` of
// core-tool.compose.yml, right after bin/migrate.js, only on a schema the script has just emptied: same image,
// same owner account as the migration (never the superuser). Installed on the VM by Ansible (role deployer) and
// mounted read-only; it uses the image's own core and `pg`, so nothing is installed on the VM and the tool's
// code never runs here. WORKDIR = the tool's root (image contract).
// The tool's db/seed/demo.sql is applied as ONE transaction, with the migrations' timeouts. DML only: a statement
// that visibly changes the schema, deletes rows, runs a block or a psql meta-command is refused before anything
// runs (comments and quoted texts set aside: a description may say "create"). A discipline check, not a boundary:
// escaped quotes can fool this filter; the boundary is the owner account, as for migrations. Same refusal in the template's
// boot-check.sh, at push time. Without the file there is nothing to do (a tool without demo data).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FILE = resolve('db/seed/demo.sql');
if (!existsSync(FILE)) {
  process.stdout.write('no demo seed (db/seed/demo.sql absent): nothing to do\n');
  process.exit(0);
}
const sql = readFileSync(FILE, 'utf8');
// One left-to-right pass: a `--` inside a quoted text, or an apostrophe inside a comment, is read as such.
const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, '');
const refused = code.match(/\\|\$[A-Za-z_]*\$|\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE|MERGE|COPY|DO)\b/i);
if (refused) {
  process.stderr.write(`demo seed refused: "${refused[0]}" in db/seed/demo.sql (INSERT and UPDATE only; schema changes belong in db/migrations, deletions never)\n`);
  process.exit(1);
}

// The core and `pg` of the image: resolved from the core's real path (pnpm layout), like the core itself does.
const core = realpathSync(resolve('node_modules/@eupadev/core'));
const { dbConfigFromEnv, sslOptions } = await import(pathToFileURL(`${core}/src/db.js`).href);
const pg = createRequire(`${core}/package.json`)('pg');
let config;
try { config = dbConfigFromEnv(process.env); } catch (e) { process.stderr.write(`${/** @type {Error} */ (e).message} (owner account)\n`); process.exit(1); }

const client = new pg.Client({ connectionString: config.url, ssl: sslOptions(config) });
await client.connect();
try {
  // One simple-protocol query (no parameters): every statement in the same transaction, set_config(…, true) included.
  await client.query(`BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n${sql}\n;\nCOMMIT;`);
  process.stdout.write('demo seed applied (db/seed/demo.sql)\n');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  process.stderr.write(`demo seed failed: ${/** @type {Error} */ (e).message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
