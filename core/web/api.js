// Calls to the tool's API, same origin only: `credentials: 'same-origin'`, static header
// `X-Requested-With: eupadev` on every request (anti-CSRF, §2.7 rule 2: the server refuses its absence on /api/**),
// `AbortSignal.timeout`, `application/problem+json` errors (RFC 9457) → `ApiError`, `ETag` remembered per URL and
// sent back as `If-Match` on PUT/PATCH/DELETE, 401 → the core's sign-in page with a return to the current page.
import { t } from './i18n.js';

/** @typedef {{ query?: Record<string, unknown>, signal?: AbortSignal, timeout?: number, redirect?: boolean }} Options */
/** @typedef {{ method: string, path: string, body: Record<string, any> | null, upload: { types: string[], maxBytes: number } | null }} ContractOperation */

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {any} body problem+json (or null if the response had none)
   * @param {number | null} [retryAfter] seconds before trying again (429 `RATE_LIMITED`, 503)
   */
  constructor(status, body, retryAfter = null) {
    super(body?.detail ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    /** @type {string} */ this.code = body?.code ?? 'HTTP_ERROR';
    /** @type {string} */ this.detail = body?.detail ?? t('api.httpError', { status });
    /** @type {string | null} */ this.error_id = body?.error_id ?? null;
    /** @type {{ pointer: string, message: string }[]} */ this.errors = Array.isArray(body?.errors) ? body.errors : [];
  }
}

/**
 * `Retry-After` (seconds or HTTP date) → whole seconds, at least 1; `null` if missing or unreadable. Pure.
 * @param {string | null} value
 * @param {number} [now] ms
 */
export function retryAfterSeconds(value, now = Date.now()) {
  if (value === null || value.trim() === '') return null;
  const n = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : null;
}

/** @type {Map<string, string>} path → last ETag received */
const etags = new Map();
const WITH_IF_MATCH = new Set(['PUT', 'PATCH', 'DELETE']);

/**
 * @param {string} method
 * @param {string} url absolute path of the same origin (`/api/items`)
 * @param {Options & { body?: unknown, file?: Blob }} [o] `file`: sent raw, with its own type as Content-Type
 * @returns {Promise<any>} JSON body, `null` for 204
 */
async function request(method, url, o = {}) {
  const u = new URL(url, location.origin);
  if (u.origin !== location.origin) throw new TypeError(`api: same origin only (${url})`);
  for (const [k, v] of Object.entries(o.query ?? {})) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
    else u.searchParams.set(k, String(v));
  }
  const headers = new Headers({ 'x-requested-with': 'eupadev', accept: 'application/json, application/problem+json' });
  if (o.body !== undefined) headers.set('content-type', 'application/json');
  if (o.file !== undefined) headers.set('content-type', o.file.type);
  const etag = etags.get(u.pathname);
  if (etag && WITH_IF_MATCH.has(method)) headers.set('if-match', etag);
  const signals = [AbortSignal.timeout(o.timeout ?? 15_000)];
  if (o.signal) signals.push(o.signal);

  const res = await fetch(u, {
    method, headers, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any(signals),
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    ...(o.file === undefined ? {} : { body: o.file }),
  });
  const received = res.headers.get('etag');
  if (received) etags.set(u.pathname, received);
  const body = res.status === 204 || !(res.headers.get('content-type') ?? '').includes('json') ? null : await res.json();
  if (res.ok) return body;
  if (res.status === 401 && o.redirect !== false) {
    location.assign(`/auth/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }
  throw new ApiError(res.status, body, retryAfterSeconds(res.headers.get('retry-after')));
}

/** Sign-out: same-origin `POST /auth/logout` through a form; the browser follows the redirect to the IdP. */
function signOut() {
  const f = document.createElement('form');
  f.method = 'post';
  f.action = '/auth/logout';
  f.hidden = true;
  document.body.append(f);
  f.submit();
}

/** @type {Promise<Record<string, ContractOperation>> | null} */
let contractPromise = null;

/** Operations of the contract (`operationId` → method, path, body schema), read once from `/core/contract.json`. */
function contract() {
  contractPromise ??= request('GET', '/core/contract.json').catch((e) => { contractPromise = null; throw e; });
  return contractPromise;
}

/**
 * Operation of the contract and its path, `params` filling the `{id}`s.
 * @param {string} operationId @param {Record<string, unknown>} params
 */
async function operation(operationId, params) {
  const op = (await contract())[operationId];
  if (!op) throw new Error(`unknown operation in the contract: ${operationId}`);
  const url = op.path.replace(/\{([^}]+)\}/g, (_, name) => {
    const v = params[name];
    if (v === undefined || v === null) throw new Error(`${operationId}: parameter ${name} missing`);
    return encodeURIComponent(String(v));
  });
  return { op, url };
}

/**
 * Calls an operation by its `operationId`: the method and the path come from the contract, never from a URL written
 * by hand. `params` fills the `{id}`s of the path.
 * @param {string} operationId
 * @param {Options & { params?: Record<string, unknown>, body?: unknown }} [o]
 */
async function call(operationId, o = {}) {
  const { params = {}, ...rest } = o;
  const { op, url } = await operation(operationId, params);
  return request(op.method, url, rest);
}

/**
 * Uploads one file to an operation whose contract declares a file body: refused here, before sending, when its type
 * is not declared or it is over `x-max-bytes` (the server checks both again, and the content's signature).
 * @param {string} operationId
 * @param {Options & { params?: Record<string, unknown>, file: File | Blob }} o
 */
async function upload(operationId, o) {
  const { params = {}, file, ...rest } = o;
  const { op, url } = await operation(operationId, params);
  if (!op.upload) throw new Error(`${operationId}: no file body in the contract`);
  if (!op.upload.types.includes(file.type)) throw new ApiError(415, { code: 'UNSUPPORTED_MEDIA_TYPE', detail: `Accepted files: ${op.upload.types.join(', ')}` });
  if (file.size > op.upload.maxBytes) throw new ApiError(413, { code: 'PAYLOAD_TOO_LARGE', detail: `File over ${Math.floor(op.upload.maxBytes / 1_048_576)} MiB` });
  return request(op.method, url, { ...rest, file });
}

/**
 * Link to a download (`/files/…`): to set on an `<a href>`, never to `fetch` (the server expects a same-origin
 * navigation and answers `Content-Disposition: attachment`).
 * @param {string} operationId @param {{ params?: Record<string, unknown>, query?: Record<string, unknown> }} [o]
 * @returns {Promise<string>} absolute path with its query string
 */
async function link(operationId, o = {}) {
  const { url } = await operation(operationId, o.params ?? {});
  const u = new URL(url, location.origin);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.pathname + u.search;
}

export const api = {
  /** @param {string} url @param {Options} [o] */
  get: (url, o) => request('GET', url, o),
  /** @param {string} url @param {unknown} body @param {Options} [o] */
  post: (url, body, o) => request('POST', url, { ...o, body }),
  /** @param {string} url @param {unknown} body @param {Options} [o] */
  put: (url, body, o) => request('PUT', url, { ...o, body }),
  /** @param {string} url @param {unknown} body @param {Options} [o] */
  patch: (url, body, o) => request('PATCH', url, { ...o, body }),
  /** @param {string} url @param {Options} [o] */
  delete: (url, o) => request('DELETE', url, o),
  call,
  upload,
  link,
  contract,
  signOut,
};

/**
 * Message to show for a failed call: the server's detail and reference, timeout, network.
 * @param {unknown} e
 */
export function errorMessage(e) {
  if (e instanceof ApiError && e.status === 429) return t('api.tooManyRequests', { seconds: e.retryAfter ?? 60 });
  if (e instanceof ApiError) return e.error_id ? t('api.withReference', { detail: e.detail, id: e.error_id }) : e.detail;
  if (e instanceof Error && e.name === 'TimeoutError') return t('api.noResponse');
  return t('api.networkError');
}
