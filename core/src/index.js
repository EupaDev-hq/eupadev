// Public API of @eupadev/core. A tool imports only `Problem`; `bin/start.js` calls `start`.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authConfigFromEnv, createAuth } from './auth.js';
import { readContract } from './contract.js';
import { dbConfigFromEnv, createDb } from './db.js';
import { createServer } from './http.js';
import { createLogger } from './logger.js';

export { Problem } from './errors.js';
export { ContractError, parseContract, readContract } from './contract.js';
export { createServer, SECURITY_HEADERS, securityHeaders } from './http.js';
export { createDb, dbConfigFromEnv } from './db.js';
export { createLogger } from './logger.js';
export { createAuth, assembleAuth, authConfigFromEnv } from './auth.js';
export { createSessions, durationsFromEnv } from './sessions.js';
export { safeReturnTo, safeEqual, fetchNoFollow, originRefusal, STATIC_HEADER_VALUE } from './protections.js';
export { DEFAULT_THRESHOLD_PER_MINUTE, READ_THRESHOLD_PER_MINUTE, LOGIN_THRESHOLD_PER_IP } from './rate-limit.js';

/**
 * Loads `api/<operationId>.js` for each operation; an extra file or an operation without a file = refusal.
 * @param {string} dir
 * @param {import('./contract.js').Contract} contract
 * @returns {Promise<Record<string, import('./http.js').Handler>>}
 */
export async function loadHandlers(dir, contract) {
  const expected = new Set(contract.operations.map((op) => op.operationId));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')) : [];
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, import('./http.js').Handler>} */
  const handlers = {};
  for (const f of files) {
    const id = f.slice(0, -3);
    if (!expected.has(id)) { errors.push(`api/${f}: no operation ${id} in the contract`); continue; }
    const module = await import(pathToFileURL(join(dir, f)).href);
    if (typeof module.default !== 'function') { errors.push(`api/${f}: default export expected: async (ctx) => ({ status, body })`); continue; }
    handlers[id] = module.default;
  }
  for (const id of expected) if (!(id in handlers)) errors.push(`api/${id}.js missing for operation ${id}`);
  if (errors.length > 0) throw new Error(`handlers refused (${errors.length}):\n- ${errors.join('\n- ')}`);
  return handlers;
}

/**
 * Entry point of the tool: contract, handlers, database, server, clean shutdown. `verifyOnly` reads the contract
 * and the handlers without a database or a port (the tool's CI).
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, verifyOnly?: boolean }} [o]
 */
export async function start(o = {}) {
  const env = o.env ?? process.env;
  const root = resolve(o.root ?? process.cwd());
  const logger = createLogger({ level: env.LOG_LEVEL ?? 'info' });
  const contract = readContract(join(root, env.CONTRACT ?? 'openapi.yaml'));
  const handlers = await loadHandlers(join(root, 'api'), contract);
  logger.info({ routes: contract.operations.map((op) => `${op.method} ${op.path} → ${op.operationId} [${op.roles.join(' ')}]`) }, 'route table');
  if (o.verifyOnly) return null;

  const authConfig = authConfigFromEnv(env);
  // `ctx.fetch` goes through the environment proxy (Smokescreen) only if Node read NODE_USE_ENV_PROXY=1 at start.
  const proxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].find((n) => env[n]);
  if (proxy && env.NODE_USE_ENV_PROXY !== '1') throw new Error(`${proxy} set without NODE_USE_ENV_PROXY=1: ctx.fetch would bypass the egress proxy`);
  const db = createDb(dbConfigFromEnv(env));
  const auth = await createAuth({ config: authConfig, db });
  const web = join(root, 'web');
  const app = await createServer({
    contract, handlers, db, logger, auth, appUrl: authConfig.appUrl,
    ...(existsSync(web) ? { web } : {}),
    ...(env.TRUST_PROXY ? { trustProxy: env.TRUST_PROXY } : {}),
  });
  const stop = async () => {
    const limit = setTimeout(() => process.exit(1), 10_000);
    limit.unref();
    await app.close();
    await db.close();
    logger.info('clean shutdown');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await app.listen({ port: Number(env.PORT ?? 3000), host: env.HOST ?? '0.0.0.0' });
  return app;
}
