// Test server on the example tool: fake session (header `x-test-session: <role>`), fake database (no PostgreSQL
// for the HTTP tests), logger captured line by line.
import { fileURLToPath } from 'node:url';
import { loadHandlers, createLogger, createServer, readContract } from '../../src/index.js';

export const EXAMPLE = fileURLToPath(new URL('../example/', import.meta.url));
export const ACTOR = '00000000-0000-0000-0000-000000000001';
/** Fake public origin: `Origin` fallback of the CSRF rule (the test server's port changes every time). */
export const APP_URL = 'https://tool.test';

/** @type {(req: import('fastify').FastifyRequest) => Promise<import('../../src/http.js').Session|null>} */
export const fakeSession = async (req) => {
  const role = req.headers['x-test-session'];
  return typeof role === 'string' ? { actorId: ACTOR, roles: [role] } : null;
};

/**
 * @param {{ health?: boolean }} [o]
 * @returns {import('../../src/http.js').Db & { transactions: unknown[], queries: string[], counters: Map<string, number> }}
 */
export function fakeDb(o = {}) {
  /** @type {unknown[]} */
  const transactions = [];
  /** @type {string[]} SQL of the core's queries (outside tx) */
  const queries = [];
  /** @type {Map<string, number>} `rate_limits` in memory: (key, window) → count */
  const counters = new Map();
  return {
    transactions,
    queries,
    counters,
    async tx(context, fn) {
      transactions.push(context);
      return fn({ query: async () => /** @type {any} */ ({ rows: [], rowCount: 0 }) });
    },
    async query(text, values = []) {
      queries.push(text);
      if (text.includes('INSERT INTO rate_limits')) {
        const k = `${values[0]}@${/** @type {Date} */ (values[1]).toISOString()}`;
        const n = (counters.get(k) ?? 0) + 1;
        counters.set(k, n);
        return /** @type {any} */ ({ rows: [{ count: String(n) }], rowCount: 1 });
      }
      return /** @type {any} */ ({ rows: [], rowCount: 0 });
    },
    async health() { return o.health ?? true; },
  };
}

/**
 * @param {Omit<Partial<Parameters<typeof createServer>[0]>, 'web'> & { web?: string|false }} [options]
 */
export async function testServer(options = {}) {
  const contract = readContract(`${EXAMPLE}openapi.yaml`);
  const handlers = await loadHandlers(`${EXAMPLE}api`, contract);
  /** @type {string[]} */
  const raw = [];
  const logger = createLogger({ level: 'info', destination: { write: (/** @type {string} */ l) => { raw.push(l); } } });
  const { web, ...rest } = options;
  const db = rest.db ?? fakeDb();
  const app = await createServer({
    contract, handlers, logger, db, session: fakeSession, appUrl: APP_URL,
    ...(web === false ? {} : { web: web ?? `${EXAMPLE}web` }),
    ...rest,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = /** @type {import('node:net').AddressInfo} */ (app.server.address());
  return {
    app,
    port: address.port,
    base: `http://127.0.0.1:${address.port}`,
    /** Parsed log lines. */
    lines: () => raw.map((l) => /** @type {Record<string, any>} */ (JSON.parse(l))),
    close: () => app.close(),
  };
}

/**
 * The static header `X-Requested-With: eupadev` is set by default (as `web/api.js` does); an empty value in
 * `headers` removes it.
 * @param {string} url
 * @param {RequestInit & { role?: string }} [init]
 */
export async function call(url, init = {}) {
  const { role, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (role) headers.set('x-test-session', role);
  if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'eupadev');
  else if (headers.get('x-requested-with') === '') headers.delete('x-requested-with');
  const res = await fetch(url, { ...rest, headers, redirect: 'manual' });
  const text = await res.text();
  /** @type {any} */
  let body = null;
  try { body = text === '' ? null : JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body, text };
}
