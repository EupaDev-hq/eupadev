// Web protections (§2.7 of the "common core" research, D4): home-made "hybrid on top of Go 1.25" CSRF
// (`net/http.CrossOriginProtection`) without a token, static header on /api/**, `csrf_blocked` counter,
// `safeReturnTo`, `safeEqual`, `ctx.fetch`.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Problem } from './errors.js';
import { SESSION_COOKIE } from './sessions.js';

/** Value of the `X-Requested-With` header required on every /api/** request (RFC 10017 §6.1.3.3.2). */
export const STATIC_HEADER_VALUE = 'eupadev';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @typedef {'x-requested-with' | 'sec-fetch-site' | 'origin' | 'no-headers'} CsrfRule */

/**
 * Origin rule of a write. Returns the rule that refuses, or `null` if the request passes.
 * 1. GET/HEAD/OPTIONS: no check (Go).
 * 3. `Sec-Fetch-Site: same-origin` → ok; `same-site`, `cross-site`, `none`, other → refusal (stricter than Go
 *    on `none`, than Rails on `same-site`).
 * 4. Without `Sec-Fetch-Site`: `Origin` compared with `APP_URL` (never with `Host`), no `Referer` fallback.
 * 5. Neither: refusal if a session cookie is present, allowed otherwise (home-made rule, between Go and Rails).
 * @param {{ method: string, headers: Record<string, string | string[] | undefined>, cookies?: Record<string, string | undefined> }} req
 * @param {string} appUrl public origin of the tool
 * @returns {CsrfRule | null}
 */
export function originRefusal(req, appUrl) {
  if (SAFE.has(req.method)) return null;
  const sfs = req.headers['sec-fetch-site'];
  if (sfs !== undefined) return sfs === 'same-origin' ? null : 'sec-fetch-site';
  const origin = req.headers.origin;
  if (origin !== undefined) return origin === appUrl ? null : 'origin';
  return req.cookies?.[SESSION_COOKIE] !== undefined ? 'no-headers' : null;
}

/**
 * `onRequest` hook of the core: static header on /api/** (reads included, rule 2) then the origin rule on the
 * writes of /api/** and of the routes marked `config.origin` (`POST /auth/logout`); under /files/ (downloads,
 * rule 7, D3: a navigation sends neither `Origin` nor `X-Requested-With`), every request carries
 * `Sec-Fetch-Site: same-origin`, reads included. Each refusal is counted (`csrf_blocked`, like Rails'
 * `csrf_request_blocked`): the precise rule goes to the log, never to the response.
 * @param {string} appUrl
 */
export function createOriginGuard(appUrl) {
  let n = 0;
  /**
   * @param {import('fastify').FastifyRequest} req
   * @param {CsrfRule} rule
   */
  const refuse = (req, rule) => {
    n++;
    req.log.warn({ event: 'csrf_blocked', rule, n, method: req.method, url: req.url.split('?', 1)[0] }, 'cross-origin request refused');
    return new Problem(403, 'CSRF_BLOCKED', rule === 'x-requested-with' ? `X-Requested-With: ${STATIC_HEADER_VALUE} required on /api/` : 'Cross-origin request blocked');
  };
  // The route pattern and the raw URL: find-my-way decodes `%61pi` into `api` before routing, the raw URL alone
  // would let `/%61pi/items` through; the raw URL alone covers paths without a route (404 under /api/).
  /** @param {import('fastify').FastifyRequest} req @param {string} prefix */
  const under = (req, prefix) => req.url.startsWith(prefix) || (req.routeOptions.url?.startsWith(prefix) ?? false);
  /** @param {import('fastify').FastifyRequest} req */
  return async (req) => {
    if (under(req, '/files/')) {
      if (req.headers['sec-fetch-site'] !== 'same-origin') throw refuse(req, 'sec-fetch-site');
      return;
    }
    const api = under(req, '/api/');
    if (api && req.headers['x-requested-with'] !== STATIC_HEADER_VALUE) throw refuse(req, 'x-requested-with');
    const marked = /** @type {{ origin?: boolean }} */ (req.routeOptions.config).origin === true;
    if (!api && !marked) return;
    const rule = originRefusal(req, appUrl);
    if (rule !== null) throw refuse(req, rule);
  };
}

/**
 * Return after sign-in (§2.7): a relative path with a single `/` (neither `//`, nor `/\`, nor a scheme, nor a blank),
 * `/` otherwise.
 * @param {unknown} next
 */
export function safeReturnTo(next) {
  return typeof next === 'string' && /^\/(?![/\\])[^\s\p{Cc}]*$/u.test(next) ? next : '/';
}

/**
 * Constant-time equality of two strings or buffers (invitation token, webhook signature): the SHA-256 digests are
 * compared, so it does not depend on the length and never returns early.
 * @param {string | Uint8Array} a @param {string | Uint8Array} b
 */
export function safeEqual(a, b) {
  const h = (/** @type {string | Uint8Array} */ v) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(a), h(b));
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * `ctx.fetch`: native `fetch` that never follows a redirect (the handler sees the 3xx), accepts only http(s)
 * (neither `file:` nor `data:`), times out after 10 s unless `init.signal`, and goes out through the environment
 * proxy when Node runs with `NODE_USE_ENV_PROXY=1` (Smokescreen, §2.7; the network without egress remains the real
 * barrier, ADR-014).
 * @param {string | URL} url @param {RequestInit} [init]
 */
export async function fetchNoFollow(url, init = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TypeError(`ctx.fetch: scheme ${u.protocol} refused`);
  const rest = /** @type {RequestInit & { dispatcher?: unknown }} */ ({ ...init });
  delete rest.dispatcher; // undici extension: a home-made agent would bypass the environment proxy
  return fetch(u, { ...rest, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}
