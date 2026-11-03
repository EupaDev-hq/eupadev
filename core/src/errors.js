// HTTP errors in the RFC 9457 format (application/problem+json).
// A handler throws `new Problem(status, code, detail)`; anything else becomes a generic 500.
import { randomUUID } from 'node:crypto';

const TITLES = /** @type {Record<number, string>} */ ({
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  408: 'Request Timeout', 409: 'Conflict', 412: 'Precondition Failed', 413: 'Content Too Large',
  415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  431: 'Request Header Fields Too Large', 500: 'Internal Server Error', 503: 'Service Unavailable',
});

/** @typedef {{ pointer: string, message: string }} ErrorDetail */

export class Problem extends Error {
  /**
   * @param {number} status 4xx or 5xx
   * @param {string} code stable extension, UPPER_SNAKE, listed in the contract
   * @param {string} detail sentence the client may show (never an internal detail for a 5xx)
   * @param {{ errors?: ErrorDetail[], headers?: Record<string, string> }} [options]
   */
  constructor(status, code, detail, options = {}) {
    super(detail);
    this.name = 'Problem';
    this.status = status;
    this.code = code;
    this.errors = options.errors;
    this.headers = options.headers ?? {};
  }
}

/**
 * problem+json body of an error. An error that is not a `Problem` (or a 5xx `Problem`) gives a 500 with a generic
 * detail: its message never leaves the server, it is logged under `error_id`.
 * @param {unknown} err
 * @param {string} [errorId]
 */
export function problemBody(err, errorId = randomUUID()) {
  const known = err instanceof Problem && err.status < 500;
  const status = known ? err.status : 500;
  const body = {
    type: 'about:blank',
    title: TITLES[status] ?? 'Error',
    status,
    detail: known ? err.message : 'An unexpected error occurred',
    instance: `urn:uuid:${errorId}`,
    code: known ? err.code : 'INTERNAL_ERROR',
    error_id: errorId,
    ...(known && err.errors ? { errors: err.errors } : {}),
  };
  return { status, body, headers: known ? err.headers : {} };
}
