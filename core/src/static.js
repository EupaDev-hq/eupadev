// Static files of the tool (`web/`): a URL → file `Map` built at start (Safe Coding); the received URL is only
// a key of this table, never a path: `..`, `%2F`, `%5C` find nothing → 404.
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Problem } from './errors.js';

const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
});
/** File versioned by its content in its name (`app.3f9a1c2d.js`): long cache. */
const DIGEST_IN_NAME = /\.[0-9a-f]{8,}\.[a-z0-9]+$/;

/** @typedef {{ path: string, type: string, etag: string, size: number }} Entry */

/**
 * Walks `root` and builds the table. Symbolic link or file of an unknown extension: refused at start (unexpected
 * content in `web/` is an error, not a file served).
 * @param {string} root
 * @returns {Map<string, Entry>}
 */
export function buildStatic(root) {
  /** @type {Map<string, Entry>} */
  const table = new Map();
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) throw new Error(`web/: symbolic link refused: ${prefix}${name}`);
      if (st.isDirectory()) { walk(path, `${prefix}${name}/`); continue; }
      if (!st.isFile()) continue;
      if (!(extname(name).toLowerCase() in TYPES)) throw new Error(`web/: extension not served: ${prefix}${name}`);
      table.set(`/${prefix}${name}`, entry(path));
    }
  };
  walk(root, '');
  const index = table.get('/index.html');
  if (index) table.set('/', index);
  return table;
}

/** @param {string} path regular file of a known extension @returns {Entry} */
function entry(path) {
  const content = readFileSync(path);
  const type = /** @type {string} */ (TYPES[extname(path).toLowerCase()]);
  return { path, type, etag: `"${createHash('sha256').update(content).digest('base64url').slice(0, 27)}"`, size: content.length };
}

/**
 * Front modules of the core (R15): the package's `web/` under `/core/…` (dictionaries `lang/*.json`
 * included), DOMPurify under `/core/vendor/purify.js`, served from `node_modules`, never copied into the tool's `web/`.
 * @param {Map<string, Entry>} table
 */
export function addCore(table) {
  for (const [key, e] of buildStatic(fileURLToPath(new URL('../web/', import.meta.url)))) table.set(`/core${key}`, e);
  table.set('/core/vendor/purify.js', entry(fileURLToPath(import.meta.resolve('dompurify'))));
}

/**
 * @param {Map<string, Entry>} table
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
export function serveStatic(table, req, reply) {
  /** @type {string} */
  let key;
  // No `new URL()`: it would resolve `..`; the key is the received path, decoded once, as is.
  try { key = decodeURIComponent(req.url.split('?', 1)[0] ?? ''); } catch { throw new Problem(400, 'BAD_REQUEST', 'Malformed path'); }
  const e = table.get(key);
  if (!e) throw new Problem(404, 'NOT_FOUND', 'No such file');
  reply.header('etag', e.etag)
    .header('cache-control', DIGEST_IN_NAME.test(key) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.headers['if-none-match'] === e.etag) return reply.code(304).send();
  return reply.type(e.type).header('content-length', String(e.size)).send(createReadStream(e.path));
}
