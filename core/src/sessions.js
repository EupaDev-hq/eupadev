// Sessions in PostgreSQL (§2.3 of the "common core" research, ADR-019): `id.secret` token following Lucia's reference
// model (`auth_session.ts`); `id` = 16 random bytes (lookup key), `secret` = 32 bytes of which only the SHA-256 is
// stored, compared in constant time; 30 min sliding inactivity, 8 h absolute; `actors.token_version` compared in the
// same SQL query as the session (ASVS 7.4.2). The time comes from the process (SQL parameter), never from `now()`:
// the tests move it forward with `mock.timers`.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-session';
/** `<id>.<secret>`: 16 bytes and 32 bytes in base64url. Any other shape: no query. */
const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
/** Extension written to the database at most once a minute (Lucia: once an hour for 30 days). */
const EXTENSION_STEP_MS = 60_000;

/** @typedef {{ idleMs: number, maxMs: number }} Durations */
/** @typedef {{ id: string, actorId: string, roles: string[], sid: string | null, idToken: string | null }} LoadedSession */
/** @typedef {{ actorId: string, roles: string[], sid: string | null, idToken: string | null, tokenVersion: number }} NewSession */

/**
 * `SESSION_IDLE_MINUTES` ∈ [5, 30] (default 30), `SESSION_MAX_HOURS` ∈ [1, 8] (default 8); out of bounds → refusal (D7).
 * @param {NodeJS.ProcessEnv} env
 * @returns {Durations}
 */
export function durationsFromEnv(env) {
  const read = (/** @type {string} */ name, /** @type {number} */ fallback, /** @type {number} */ min, /** @type {number} */ max) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}=${raw}: integer between ${min} and ${max} expected`);
    return n;
  };
  return { idleMs: read('SESSION_IDLE_MINUTES', 30, 5, 30) * 60_000, maxMs: read('SESSION_MAX_HOURS', 8, 1, 8) * 3_600_000 };
}

/**
 * Attributes of the session cookie and of the transaction cookie (ASVS 3.3.1-3.3.4, ADR-014: `__Host-` prefix).
 * @param {number} maxAgeS
 * @returns {import('@fastify/cookie').CookieSerializeOptions}
 */
export function cookieOptions(maxAgeS) {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeS };
}

/** @param {string} secret */
const hash = (secret) => createHash('sha256').update(secret).digest();

/**
 * @param {import('./http.js').Db} db
 * @param {Durations} durations
 */
export function createSessions(db, durations) {
  return {
    durations,
    /**
     * Creates a session and returns the token to set in the cookie.
     * @param {NewSession} s
     * @param {Date} [now]
     */
    async create(s, now = new Date()) {
      const id = randomBytes(16).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO sessions (id, secret_hash, actor_id, roles, sid, id_token, token_version, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)`,
        [id, hash(secret), s.actorId, s.roles, s.sid, s.idToken, s.tokenVersion, now,
          new Date(now.getTime() + durations.idleMs), new Date(now.getTime() + durations.maxMs)]);
      return { id, token: `${id}.${secret}` };
    },

    /**
     * Reads a session from the cookie's token. `null` if the token is malformed, unknown, has a wrong secret, has
     * expired (the row is then deleted) or is outdated by `token_version` (same). `extended`: the cookie must be sent again.
     * @param {unknown} token
     * @param {Date} [now]
     * @returns {Promise<{ session: LoadedSession, extended: boolean } | null>}
     */
    async read(token, now = new Date()) {
      const m = typeof token === 'string' ? TOKEN.exec(token) : null;
      if (!m) return null;
      const id = m[1] ?? '';
      const secret = m[2] ?? '';
      const r = await db.query(
        `SELECT s.secret_hash, s.actor_id, s.roles, s.sid, s.id_token, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
                a.token_version = s.token_version AS version_ok
         FROM sessions s JOIN actors a ON a.id = s.actor_id WHERE s.id = $1`, [id]);
      const l = r.rows[0];
      if (!l) return null;
      if (!timingSafeEqual(hash(secret), l.secret_hash)) return null;
      const t = now.getTime();
      if (!l.version_ok || l.idle_expires_at.getTime() <= t || l.absolute_expires_at.getTime() <= t) {
        await this.destroy(id);
        return null;
      }
      let extended = false;
      if (l.last_seen_at.getTime() + EXTENSION_STEP_MS <= t) {
        await db.query('UPDATE sessions SET last_seen_at = $2, idle_expires_at = LEAST($3, absolute_expires_at) WHERE id = $1',
          [id, now, new Date(t + durations.idleMs)]);
        extended = true;
      }
      return { session: { id, actorId: l.actor_id, roles: l.roles, sid: l.sid, idToken: l.id_token }, extended };
    },

    /** @param {string} id */
    async destroy(id) {
      await db.query('DELETE FROM sessions WHERE id = $1', [id]);
    },
    /** Back-channel logout by `sid`. @param {string} sid @returns {Promise<number>} sessions deleted */
    async destroyBySid(sid) {
      return (await db.query('DELETE FROM sessions WHERE sid = $1', [sid])).rowCount ?? 0;
    },
    /** Back-channel logout by `(iss, sub)` → actor. @param {string} actorId @returns {Promise<number>} */
    async destroyByActor(actorId) {
      return (await db.query('DELETE FROM sessions WHERE actor_id = $1', [actorId])).rowCount ?? 0;
    },
  };
}
