// Logger: pino (D17), one JSON object per line on stdout, secrets redacted, `request_id` in the W3C Trace Context
// format (§2.9): taken from `traceparent` when valid, generated otherwise; sent back as a header and set in `app.request_id`.
import { randomBytes } from 'node:crypto';
import { pino } from 'pino';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO = /^0+$/;

/**
 * @param {{ level?: string, destination?: import('pino').DestinationStream }} [o]
 */
export function createLogger(o = {}) {
  const options = {
    level: o.level ?? 'info',
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
        '*.password', '*.secret', '*.token', '*.authorization', '*.cookie'],
      censor: '[masked]',
    },
  };
  return o.destination ? pino(options, o.destination) : pino(options);
}

/** @param {unknown} header value of the incoming `traceparent` header */
export function requestIdFrom(header) {
  if (typeof header === 'string') {
    const m = TRACEPARENT.exec(header);
    if (m && !ZERO.test(m[1] ?? '') && !ZERO.test(m[2] ?? '')) return header;
  }
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}
