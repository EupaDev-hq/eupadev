/**
 * The requester's web page (ADR-024): a handful of static files served by the engine process on
 * the API's origin. A fixed `Map` URL → file built once at startup (the core's `static.js` model): the request path is
 * only a key of that table, never a filesystem path (`..`, `%2F`… find nothing → not static). deep-chat's bundle is
 * vendored from `node_modules` (dev) or the image's `vendor/` and served under a path carrying its sha256: pinned by
 * content, cached for a year, never fetched elsewhere at run time; `index.html` receives that path at startup.
 *
 * Headers of the page: a CSP without Trusted Types (deep-chat's `innerHTML` sinks, ADR-024) — scripts and styles from
 * this origin only, `javascript:` links inert, nothing framed; the IdP's origin is allowed as a form action because the
 * sign-out form is redirected to Keycloak's end-session page (Chromium checks `form-action` on redirects too).
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
/** The conversation's URL, the one already written in e-mails (`<DASHBOARD_URL>/cycles/<id>`). */
const PAGE_CYCLE = /^\/cycles\/[1-9][0-9]{0,15}$/;
const PLACEHOLDER_DEEP_CHAT = '__DEEP_CHAT__';

export const cspPage = (idpOrigin: string): string =>
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self' ${idpOrigin}; frame-ancestors 'none'`;

export interface StaticFile { type: string; content: Buffer; etag: string; immutable: boolean }

const file = (content: Buffer, type: string, immutable = false): StaticFile =>
  ({ type, content: content, etag: `"${createHash('sha256').update(content).digest('base64url').slice(0, 27)}"`, immutable });

/**
 * `webDir` (index.html, app.js, app.css, lang/*.json) and the deep-chat bundle → table. A symbolic link or an unknown
 * extension under `web/` is refused at startup (unexpected content is an error, not a served file).
 */
export function buildStatic(webDir: string, deepChatPath: string): Map<string, StaticFile> {
  const table = new Map<string, StaticFile>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) throw new Error(`web/: symbolic link refused: ${prefix}${name}`);
      if (st.isDirectory()) { walk(path, `${prefix}${name}/`); continue; }
      const type = TYPES[extname(name).toLowerCase()];
      if (type === undefined) throw new Error(`web/: extension not served: ${prefix}${name}`);
      table.set(`/${prefix}${name}`, file(readFileSync(path), type));
    }
  };
  walk(webDir, '');
  const bundle = readFileSync(deepChatPath);
  const urlDeepChat = `/vendor/deep-chat.${createHash('sha256').update(bundle).digest('hex').slice(0, 8)}.js`;
  table.set(urlDeepChat, file(bundle, TYPES['.js']!, true));
  const index = table.get('/index.html');
  if (index === undefined) throw new Error(`web/: index.html missing in ${webDir}`);
  const page = file(Buffer.from(index.content.toString('utf8').replaceAll(PLACEHOLDER_DEEP_CHAT, urlDeepChat)), index.type);
  table.set('/index.html', page);
  table.set('/', page);
  return table;
}

/** The static file for this path, if any: the table's keys, plus the conversation pages (`/cycles/<id>`), which are the same page. */
export function staticFile(table: Map<string, StaticFile>, path: string): StaticFile | undefined {
  return table.get(path) ?? (PAGE_CYCLE.test(path) ? table.get('/') : undefined);
}

export function serveStatic(f: StaticFile, csp: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': f.type, ETag: f.etag, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cache-Control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(f.type.startsWith('text/html') ? { 'Content-Security-Policy': csp } : {}),
  };
  if (req.headers['if-none-match'] === f.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': f.content.length });
  res.end(req.method === 'HEAD' ? undefined : f.content);
}
