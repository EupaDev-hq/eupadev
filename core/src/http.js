// HTTP heart of the core: Fastify 5 with a closed configuration (§2.1.4 "if B wins"), routing by operationId, glue
// `(ctx) → {status, body}`. The handlers see neither Fastify, nor the raw request, nor the reply.
import { randomUUID } from 'node:crypto';
import { Readable, Transform, pipeline } from 'node:stream';
import fastifyCookie from '@fastify/cookie';
import Fastify, { LogController } from 'fastify';
import { DEFAULT_THRESHOLD_PER_MINUTE, READ_THRESHOLD_PER_MINUTE, createLimiter } from './rate-limit.js';
import { Problem, problemBody } from './errors.js';
import { createLogger, requestIdFrom } from './logger.js';
import { TYPES_UPLOAD } from './contract.js';
import { createOriginGuard, fetchNoFollow } from './protections.js';
import { addCore, buildStatic, serveStatic } from './static.js';
import { ajvBody, ajvRequest, compile } from './validation.js';

/** @typedef {{ actorId: string, roles: string[] }} Session */
/** @typedef {(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<Session|null>} SessionProvider */
/** Fastify instance as `createServer` builds it (pino logger): the type of the core's routes. */
/** @typedef {import('fastify').FastifyInstance<any, any, any, any, any>} App */
/** @typedef {{ query(text: string, values?: unknown[]): Promise<import('pg').QueryResult> }} Transaction */
/** @typedef {{ tx<T>(context: { actorId: string, roles: string[], requestId: string } | null, fn: (t: Transaction) => Promise<T>): Promise<T>, query(text: string, values?: unknown[]): Promise<import('pg').QueryResult>, health(): Promise<boolean> }} Db */
/**
 * @typedef {object} Ctx
 * @property {Record<string, unknown>} params
 * @property {Record<string, unknown>} query
 * @property {unknown} body JSON body, or `{ type, body }` (declared media type, Buffer) for an upload operation
 * @property {Session} session
 * @property {{ tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> }} db
 * @property {import('fastify').FastifyBaseLogger} log
 * @property {string} request_id
 * @property {typeof fetchNoFollow} fetch outgoing HTTP without redirect following, http(s) only, 10 s (protections.js)
 */
/** Download (`/files/…`): `body` Buffer or stream; `type` among those declared for the operation. */
/** @typedef {{ name: string, type: string, body: Buffer | Readable }} FileDownload */
/** @typedef {(ctx: Ctx) => Promise<{ status: number, body?: unknown, headers?: Record<string, string>, file?: FileDownload }>} Handler */

/** Eight fixed headers of §2.7 (no Helmet); without OIDC (tests), `form-action` only has `'self'`. */
export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types eupadev dompurify",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});
/**
 * The headers with the IdP's origin as a form action too: sign-out is a form whose answer is a 303 to the IdP's
 * end-session page, and Chromium checks `form-action` on redirects (INJ-2, as the engine's chat page, ADR-024).
 * @param {string} [idpOrigin]
 */
export const securityHeaders = (idpOrigin) => (idpOrigin === undefined ? SECURITY_HEADERS : Object.freeze({
  ...SECURITY_HEADERS,
  'content-security-policy': SECURITY_HEADERS['content-security-policy'].replace("form-action 'self'", `form-action 'self' ${idpOrigin}`),
}));
const ALL_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
/** Headers a handler may set; any other (Set-Cookie…) is a handler error. */
const HANDLER_HEADERS = new Set(['etag', 'location', 'last-modified']);
const JSON_UTF8 = /^application\/json(?:\s*;\s*charset="?utf-8"?\s*)?$/i;
/** Largest download (D3): 50 MiB, sent as a stream, cut beyond. */
export const FILE_CAP = 50 * 1024 * 1024;
/** Only the core's routes marked `config.form` (sign-outs) accept a form, never the contract. */
const FORM = /^application\/x-www-form-urlencoded(?:\s*;\s*charset="?utf-8"?\s*)?$/i;
/** First bytes of each upload type (§2.7 rule 7): the content must be what its Content-Type says. */
const SIGNATURES = /** @type {Record<string, number[]>} */ ({
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
});

/** Does `body` start with the signature of `type`? Pure. @param {string} type @param {Buffer} body */
export function signatureMatches(type, body) {
  const sig = SIGNATURES[type];
  return sig !== undefined && body.length >= sig.length && sig.every((b, i) => body[i] === b);
}

/** Media type of a Content-Type header, lowercased, without its parameters. @param {string | undefined} ct */
const mediaType = (ct) => (ct ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
/** 4xx errors of the framework: fixed code and detail, never Fastify's message. */
const FRAMEWORK = /** @type {Record<number, [string, string]>} */ ({
  400: ['BAD_REQUEST', 'Malformed request'], 404: ['NOT_FOUND', 'No such route'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body too large'], 415: ['UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json'],
  431: ['HEADERS_TOO_LARGE', 'Request headers too large'],
});

/**
 * @param {object} o
 * @param {import('./contract.js').Contract} o.contract
 * @param {Record<string, Handler>} o.handlers one handler per operationId (checked by `start`)
 * @param {Db} o.db
 * @param {string} o.appUrl public origin of the tool (`APP_URL`): `Origin` fallback of the CSRF rule, never `Host`
 * @param {SessionProvider} [o.session] fake session provider (tests); without `auth` or it, everything is 401
 * @param {{ session: SessionProvider, routes(app: App): void, idpOrigin: string }} [o.auth] real OIDC and sessions (auth.js)
 * @param {string} [o.web] folder of the static files
 * @param {string|false} [o.trustProxy] Caddy's IP address or CIDR subnet (`TRUST_PROXY`), never a number of hops
 * @param {import('pino').Logger} [o.logger]
 * @param {{ requestTimeout?: number, connectionTimeout?: number }} [o.timeouts] tests only
 */
export async function createServer(o) {
  const session = o.auth?.session ?? o.session ?? (async () => null);
  const headers = securityHeaders(o.auth?.idpOrigin);
  const app = Fastify({
    loggerInstance: o.logger ?? createLogger(),
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    genReqId: (raw) => requestIdFrom(raw.headers.traceparent),
    bodyLimit: 1_048_576,
    requestTimeout: o.timeouts?.requestTimeout ?? 60_000,
    connectionTimeout: o.timeouts?.connectionTimeout ?? 30_000,
    trustProxy: o.trustProxy ?? false,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    return503OnClosing: true,
    forceCloseConnections: 'idle',
    routerOptions: { ignoreTrailingSlash: false, caseSensitive: true, maxParamLength: 100 },
    exposeHeadRoutes: true,
    http: { maxHeaderSize: 16_384 },
  });
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16_384 }, (_req, body, done) => {
    try { done(null, new URLSearchParams(String(body))); } catch (e) { done(/** @type {Error} */ (e)); }
  });
  // Upload bodies are read whole (bounded per route by x-max-bytes); only routes that declare the type accept it (onRequest).
  app.addContentTypeParser([...TYPES_UPLOAD], { parseAs: 'buffer' }, (_req, body, done) => { done(null, body); });
  await app.register(fastifyCookie);
  const guard = createOriginGuard(new URL(o.appUrl).origin);
  const limiter = createLimiter(o.db, app.log);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('traceparent', req.id);
    for (const [name, value] of Object.entries(headers)) reply.header(name, value);
    await guard(req);
    // 405 route: refused before the body is read (Fastify requires a Content-Type for QUERY and would answer 400).
    const allow = /** @type {{ allow?: string }} */ (req.routeOptions.config).allow;
    if (allow !== undefined) throw new Problem(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { headers: { allow } });
    // Over the route's limit by its declared length: answered here, before any read. Fastify's own check answers with
    // `Connection: close` while a reverse proxy may still be writing the body, and Caddy turns that into a 502; from
    // here, Node reads and drops the rest of the body itself, as for any early answer. (Fastify's check stays, for a
    // body sent without Content-Length.)
    if (Number(req.headers['content-length']) > req.routeOptions.bodyLimit) throw new Problem(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    const ct = req.headers['content-type'];
    if (ct === undefined) return;
    const upload = /** @type {{ upload?: string[] }} */ (req.routeOptions.config).upload;
    if (upload !== undefined) {
      if (!upload.includes(mediaType(ct))) throw new Problem(415, 'UNSUPPORTED_MEDIA_TYPE', `Request body must be one file of type ${upload.join(', ')}`);
      return;
    }
    const form = /** @type {{ form?: boolean }} */ (req.routeOptions.config).form === true;
    if (!JSON_UTF8.test(ct) && !(form && FORM.test(ct))) {
      throw new Problem(415, 'UNSUPPORTED_MEDIA_TYPE', form ? 'Request body must be application/x-www-form-urlencoded or application/json' : 'Request body must be application/json (utf-8)');
    }
  });
  app.addHook('onResponse', (req, reply, done) => {
    req.log.info({ method: req.method, url: req.routeOptions.url ?? req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime), ip: req.ip }, 'request');
    done();
  });
  app.setErrorHandler((err, req, reply) => sendProblem(err, req, reply));
  app.setNotFoundHandler((req, reply) => sendProblem(new Problem(404, 'NOT_FOUND', 'No such route'), req, reply));

  for (const op of o.contract.operations) {
    const handler = o.handlers[op.operationId];
    if (typeof handler !== 'function') throw new Error(`handler missing for ${op.operationId}`);
    // A download has no derived HEAD (the handler would produce the file for nothing): 405 like the other methods.
    app.route({
      method: op.method, url: op.url, exposeHeadRoute: op.types === null, handler: wrap(op, handler, o.db, session, limiter),
      ...(op.upload ? { bodyLimit: op.upload.maxBytes, config: { upload: op.upload.types } } : {}),
    });
  }
  for (const [path, methods] of o.contract.paths) {
    const allowed = methods.includes('GET') && !path.startsWith('/files/') ? [...methods, 'HEAD'] : methods;
    const allow = ALL_METHODS.filter((m) => allowed.includes(m)).join(', ');
    app.route({
      // Every method Fastify can route (QUERY, TRACE included), not only the seven usual ones; refused in onRequest.
      method: /** @type {any} */ (app.supportedMethods.filter((m) => !allowed.includes(m))),
      url: path.replace(/\{([^}]+)\}/g, ':$1'),
      config: { allow },
      handler: (req, reply) => sendProblem(new Problem(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { headers: { allow } }), req, reply),
    });
  }
  if (o.auth) o.auth.routes(app);
  app.get('/health', async (_req, reply) => {
    const ok = await o.db.health();
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable' });
  });
  if (o.web) {
    const table = buildStatic(o.web);
    addCore(table);
    // Operations of the contract for `api.call`, `api.link` and `form.js` (method, path, body schema): session
    // required (D6.1), the contract describes the tool and is not read anonymously, unlike `web/`.
    const contractJson = JSON.stringify(Object.fromEntries(o.contract.operations.map((op) => [op.operationId, { method: op.method, path: op.path, body: op.schemas.body, upload: op.upload }])));
    app.get('/core/contract.json', async (req, reply) => {
      if (await session(req, reply) === null) throw new Problem(401, 'UNAUTHENTICATED', 'Authentication required');
      return reply.type('application/json; charset=utf-8').send(contractJson);
    });
    app.get('/*', (req, reply) => serveStatic(table, req, reply));
    app.get('/', (req, reply) => serveStatic(table, req, reply));
  }
  return app;
}

/**
 * Glue of one operation: session and roles, rate limiting per (operation, actor), Ajv 2020-12 validation of the
 * three parts, then of the response.
 * @param {import('./contract.js').Operation} op
 * @param {Handler} handler
 * @param {Db} db
 * @param {SessionProvider} session
 * @param {ReturnType<typeof createLimiter>} limiter
 * @returns {import('fastify').RouteHandlerMethod}
 */
function wrap(op, handler, db, session, limiter) {
  const vParams = compile(ajvRequest, op.schemas.params);
  const vQuery = compile(ajvRequest, op.schemas.query, true);
  const vBody = op.schemas.body ? compile(ajvBody, op.schemas.body, true) : null;
  const threshold = op.rateLimit ?? (op.method === 'GET' ? READ_THRESHOLD_PER_MINUTE : DEFAULT_THRESHOLD_PER_MINUTE);
  const vResponses = new Map([...op.responses].map(([status, s]) => [status, s ? compile(ajvBody, s) : null]));
  return async (req, reply) => {
    if (vBody === null && op.upload === null && req.body !== undefined) throw new Problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'This operation takes no body');
    const s = await session(req, reply);
    if (s === null) throw new Problem(401, 'UNAUTHENTICATED', 'Authentication required');
    if (!op.roles.some((r) => s.roles.includes(r))) throw new Problem(403, 'FORBIDDEN', 'Access denied');
    await limiter.count(`${op.operationId}|${s.actorId}`, threshold);
    const params = { .../** @type {Record<string, unknown>} */ (req.params) };
    const query = { .../** @type {Record<string, unknown>} */ (req.query) };
    let errors = vParams(params).map((e) => ({ ...e, pointer: `/params${e.pointer}` }));
    if (errors.length === 0) errors = vQuery(query).map((e) => ({ ...e, pointer: `/query${e.pointer}` }));
    if (errors.length === 0 && vBody !== null) {
      if (req.body === undefined) throw new Problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json');
      errors = vBody(req.body).map((e) => ({ ...e, pointer: `/body${e.pointer}` }));
    }
    if (errors.length > 0) throw new Problem(400, 'VALIDATION_FAILED', 'Request does not match the contract', { errors });
    let body = req.body;
    if (op.upload !== null) {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Problem(400, 'FILE_REQUIRED', 'Request body must be the file');
      const type = mediaType(req.headers['content-type']);
      if (!signatureMatches(type, req.body)) throw new Problem(415, 'FILE_TYPE_MISMATCH', `File content is not ${type}`);
      body = { type, body: req.body };
    }

    const context = { actorId: s.actorId, roles: s.roles, requestId: req.id };
    const result = await handler({
      params, query, body, session: { actorId: s.actorId, roles: s.roles }, log: req.log, request_id: req.id,
      db: { tx: (fn) => db.tx(context, fn) }, fetch: fetchNoFollow,
    });

    if (op.types !== null) return sendFile(op, result, req, reply);
    const status = result?.status;
    if (!Number.isInteger(status)) throw new Error(`${op.operationId}: the handler returns no status`);
    const validate = vResponses.get(status);
    if (validate === undefined) throw new Error(`${op.operationId}: status ${status} missing from the contract`);
    for (const name of Object.keys(result.headers ?? {})) {
      if (!HANDLER_HEADERS.has(name.toLowerCase())) throw new Error(`${op.operationId}: header ${name} refused`);
    }
    reply.code(status).headers(result.headers ?? {});
    if (validate === null) {
      if (result.body !== undefined) throw new Error(`${op.operationId}: ${status} without a body`);
      return reply.send();
    }
    const deviations = validate(result.body);
    if (deviations.length > 0) throw new Error(`${op.operationId}: response ${status} outside the contract (${deviations[0]?.pointer} ${deviations[0]?.message})`);
    return reply.type('application/json; charset=utf-8').send(JSON.stringify(result.body));
  };
}

/**
 * `Content-Disposition` of a download: the name becomes a plain file name (no separator, no quote, no control
 * character, no leading dot, 200 characters at most) encoded as `filename*` (RFC 8187), non-ASCII included; every
 * current browser reads it.
 * @param {string} name
 */
export function fileDisposition(name) {
  // `\p{Surrogate}` with `u`: a lone surrogate only (a valid pair is one code point); otherwise `encodeURIComponent` throws.
  const safe = name.replace(/\p{Surrogate}/gu, '\uFFFD').replace(/[\p{Cc}\\/"]+/gu, '_').replace(/^[.\s]+|\s+$/g, '').slice(0, 200) || 'file';
  return `attachment; filename*=UTF-8''${encodeURIComponent(safe).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/**
 * Response of a download (D3): `{ status: 200, file: { name, type, body } }`, `type` declared for the operation,
 * `body` Buffer (refused beyond the cap) or stream (counted on the way, cut at the cap: the response is destroyed,
 * the client sees a truncated file, the log says why). `nosniff` and `no-store` are already set.
 * @param {import('./contract.js').Operation} op
 * @param {Awaited<ReturnType<Handler>>} result
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
function sendFile(op, result, req, reply) {
  const f = result?.file;
  const stream = f?.body instanceof Readable ? f.body : null;
  if (result?.status !== 200 || result.body !== undefined || result.headers !== undefined || typeof f?.name !== 'string' || !op.types?.includes(f.type)) {
    stream?.destroy(); // a stream never read would keep its descriptor or its cursor open
    throw new Error(`${op.operationId}: a download returns { status: 200, file: { name, type (${op.types?.join(' | ')}), body } }, without body or headers`);
  }
  reply.header('content-disposition', fileDisposition(f.name)).type(f.type === 'text/csv' ? 'text/csv; charset=utf-8' : f.type);
  if (Buffer.isBuffer(f.body)) {
    if (f.body.length > FILE_CAP) throw new Error(`${op.operationId}: file of ${f.body.length} bytes, cap ${FILE_CAP}`);
    return reply.send(f.body);
  }
  if (stream === null) throw new Error(`${op.operationId}: file.body must be a Buffer or a Readable`);
  let total = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      cb(total > FILE_CAP ? new Error(`cap of ${FILE_CAP} bytes exceeded`) : null, chunk);
    },
  });
  pipeline(stream, counter, (err) => { if (err) req.log.warn({ event: 'file_truncated', operation: op.operationId, bytes: total, err }, 'download cut'); });
  return reply.send(counter);
}

/**
 * Any error → problem+json. The framework's 4xx (body too large, unreadable JSON, media type) keep their status
 * with a fixed detail; the rest is a 500 logged under `error_id`.
 * @param {unknown} err
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
function sendProblem(err, req, reply) {
  let e = err;
  if (!(e instanceof Problem)) {
    const sc = /** @type {{ statusCode?: unknown }} */ (e)?.statusCode;
    if (typeof sc === 'number' && sc >= 400 && sc < 500) {
      const [code, detail] = FRAMEWORK[sc] ?? ['BAD_REQUEST', 'Malformed request'];
      e = new Problem(sc, code, detail);
    }
  }
  const { status, body, headers } = problemBody(e, randomUUID());
  if (status >= 500) req.log.error({ err, error_id: body.error_id }, 'internal error');
  else req.log.warn({ error_id: body.error_id, status, code: body.code }, 'request refused');
  return reply.code(status).headers(headers).type('application/problem+json').send(JSON.stringify(body));
}
