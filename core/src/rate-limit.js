// Rate limiting in the database: table `rate_limits(key, window_start, count)` of 0001_core.sql and a single
// `INSERT … ON CONFLICT DO UPDATE … RETURNING count` statement; fixed one-minute window (burst ≤ 2× at the
// boundary, accepted); shared by every instance of a tool. The time comes from the process (SQL parameter).
import { Problem } from './errors.js';

/** Per operation and person, without `x-rate-limit`: writes 20, reads (GET) 120 (a screen makes several reads). */
export const DEFAULT_THRESHOLD_PER_MINUTE = 20;
export const READ_THRESHOLD_PER_MINUTE = 120;
/** `/auth/login` per IP: a wide threshold, a client site often shares one IP; brute force is handled by Keycloak. */
export const LOGIN_THRESHOLD_PER_IP = 60;
const WINDOW_MS = 60_000;
const RETENTION_MS = 3_600_000;
const PURGE_STEP_MS = 60_000;

/**
 * @param {import('./http.js').Db} db
 * @param {import('pino').Logger | import('fastify').FastifyBaseLogger} logger
 */
export function createLimiter(db, logger) {
  let lastPurge = 0;
  return {
    /**
     * Counts the request; above the threshold, throws 429 `RATE_LIMITED` with `Retry-After` (seconds until the end
     * of the window). Windows older than one hour are purged at most once a minute per instance.
     * @param {string} key `<operationId>|<actor_id>` or `login|ip:<address>`
     * @param {number} threshold requests per minute
     * @param {Date} [now]
     */
    async count(key, threshold, now = new Date()) {
      const t = now.getTime();
      const start = new Date(t - (t % WINDOW_MS));
      const r = await db.query(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
         ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`, [key, start]);
      const n = Number(r.rows[0]?.count);
      if (!Number.isFinite(n)) throw new Error('rate_limits: count missing');
      if (lastPurge + PURGE_STEP_MS <= t) {
        lastPurge = t;
        // ponytail: DELETE by sequential scan (the primary key starts with key); index on window_start if the table grows.
        db.query('DELETE FROM rate_limits WHERE window_start < $1', [new Date(t - RETENTION_MS)])
          .catch((e) => logger.warn({ err: e }, 'rate_limits purge failed'));
      }
      if (n > threshold) {
        const wait = Math.ceil((start.getTime() + WINDOW_MS - t) / 1000);
        throw new Problem(429, 'RATE_LIMITED', 'Too many requests; retry later', { headers: { 'retry-after': String(Math.max(wait, 1)) } });
      }
    },
  };
}
