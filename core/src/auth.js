// Server-side OIDC authentication (BFF, ADR-019, ADR-017): code + PKCE S256 +
// state + nonce with openid-client (certified), confidential client, callback by GET, transaction cookie
// `__Host-oidc`, `id.secret` session (sessions.js), RP-initiated and back-channel logout (jose), `(iss, sub)` → actor.
// The `/auth/*` routes are served by the core, never declared in the contract.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as oidc from 'openid-client';
import { LOGIN_THRESHOLD_PER_IP, createLimiter } from './rate-limit.js';
import { Problem } from './errors.js';
import { safeReturnTo } from './protections.js';
import { SESSION_COOKIE, createSessions, durationsFromEnv, cookieOptions } from './sessions.js';
import { cleanText } from './validation.js';

export const TRANSACTION_COOKIE = '__Host-oidc';
const TRANSACTION_DURATION_S = 600;
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const ALGORITHMS = ['RS256', 'ES256'];
/** Replay protection of the logout tokens' `jti`, bounded by `iat` (10 min). */
const JTI_WINDOW_MS = 600_000;
const FIRST_SIGN_IN_REASON = 'first sign-in';

/**
 * @typedef {object} AuthConfig
 * @property {string} appUrl public origin of the tool (`https://tool.example`), base of `redirect_uri`
 * @property {string} issuer OIDC issuer (`https://auth.<domain>/realms/tools`)
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {boolean} tlsOff `OIDC_TLS=off`: issuer and `APP_URL` over http (development, tests)
 * @property {import('./sessions.js').Durations} durations
 */
/** @typedef {import('./sessions.js').LoadedSession} LoadedSession */

/**
 * `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (or `_FILE`), `OIDC_TLS=off`, session durations.
 * @param {NodeJS.ProcessEnv} env
 * @returns {AuthConfig}
 */
export function authConfigFromEnv(env) {
  const tlsOff = env.OIDC_TLS === 'off';
  const require = (/** @type {string} */ name) => {
    const v = env[name];
    if (!v) throw new Error(`${name} missing`);
    return v;
  };
  const url = (/** @type {string} */ name) => {
    const raw = require(name);
    let u;
    try { u = new URL(raw); } catch { throw new Error(`${name}=${raw}: absolute URL expected`); }
    if (u.protocol !== 'https:' && !(tlsOff && u.protocol === 'http:')) throw new Error(`${name}: https required (OIDC_TLS=off only in development)`);
    if (u.username || u.password || u.search || u.hash) throw new Error(`${name}: no credentials, no query, no fragment`);
    return u;
  };
  const app = url('APP_URL');
  if (app.pathname !== '/') throw new Error('APP_URL: origin only, without a path (a tool is served at the root of its host)');
  const issuer = url('OIDC_ISSUER');
  const clientSecret = env.OIDC_CLIENT_SECRET ?? (env.OIDC_CLIENT_SECRET_FILE ? readFileSync(env.OIDC_CLIENT_SECRET_FILE, 'utf8').trim() : undefined);
  if (!clientSecret) throw new Error('OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE) missing');
  return { appUrl: app.origin, issuer: issuer.href.replace(/\/$/, ''), clientId: require('OIDC_CLIENT_ID'), clientSecret, tlsOff, durations: durationsFromEnv(env) };
}

/**
 * Client roles read from the ID token (`resource_access.<client_id>.roles`, ADR-017: never the realm roles).
 * @param {Record<string, unknown>} claims @param {string} clientId @returns {string[]}
 */
export function rolesFromClaims(claims, clientId) {
  const access = /** @type {Record<string, { roles?: unknown }> | undefined} */ (claims.resource_access);
  const roles = access?.[clientId]?.roles;
  return Array.isArray(roles) ? roles.filter((r) => typeof r === 'string' && r !== '') : [];
}

/** @param {string} seed */
const nonceFrom = (seed) => createHash('sha256').update(seed).digest('base64url');
const CLEARED_COOKIE = { httpOnly: true, secure: true, sameSite: /** @type {const} */ ('lax'), path: '/' };

/**
 * Logout token verifier (Back-Channel Logout 1.0 §2.6): signature by the issuer's JWKS, `alg` ∈ {RS256, ES256},
 * `iss`, `aud`, `iat` < 10 min, `exp` if present, `events`, no `nonce`, `jti` not replayed, `sid` or `sub`.
 * @param {{ jwks: import('jose').JWTVerifyGetKey, issuer: string, clientId: string }} o
 * @returns {(jwt: string) => Promise<{ sid: string | null, sub: string | null }>}
 */
export function createLogoutVerifier(o) {
  /** @type {Map<string, number>} jti → end of the replay window. ponytail: memory per instance, a table if > 2 instances and logout by sub only. */
  const seen = new Map();
  const reject = (/** @type {string} */ m) => new Problem(400, 'INVALID_LOGOUT_TOKEN', `Logout token rejected: ${m}`);
  return async (jwt) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(jwt, o.jwks, { issuer: o.issuer, audience: o.clientId, algorithms: ALGORITHMS, maxTokenAge: '10 minutes', requiredClaims: ['iat', 'jti', 'events'] }));
    } catch {
      throw reject('signature or claims');
    }
    if (payload.nonce !== undefined) throw reject('nonce present');
    const events = payload.events;
    if (typeof events !== 'object' || events === null || !(LOGOUT_EVENT in events)) throw reject('events');
    const sid = typeof payload.sid === 'string' && payload.sid !== '' ? payload.sid : null;
    const sub = typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : null;
    if (sid === null && sub === null) throw reject('sid or sub required');
    const jti = payload.jti ?? '';
    const t = Date.now();
    for (const [k, end] of seen) if (end <= t) seen.delete(k);
    if (seen.has(jti)) throw reject('replayed jti');
    seen.set(jti, t + JTI_WINDOW_MS);
    return { sid, sub };
  };
}

/**
 * `(iss, sub)` → actor (ADR-017): existing link, otherwise creation of the actor and of its link (reason "first
 * sign-in"); contact attributes refreshed; `token_version` read. Race between two instances: the primary key makes
 * the second insert fail, the transaction is rolled back and the link read again.
 * @param {import('./http.js').Db} db
 * @param {{ iss: string, sub: string, email?: unknown, name?: unknown, preferred_username?: unknown }} claims
 * @returns {Promise<{ id: string, tokenVersion: number }>}
 */
export async function resolveActor(db, claims) {
  const raw = [claims.name, claims.preferred_username].find((v) => typeof v === 'string' && v.trim() !== '');
  // Invisible characters stripped (INJ-5), then 200 code points at most, like a contract's `maxLength` (INJ-1): a
  // longer IdP name would make every response carrying it fail its contract (500).
  const name = [...(typeof raw === 'string' ? cleanText(raw).trim() : '') || claims.sub].slice(0, 200).join('').trim();
  // Same shape as the CHECK constraint of actors.mail: a malformed mail becomes NULL rather than a 500 at sign-in.
  const mail = typeof claims.email === 'string' && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(claims.email) ? claims.email : null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.tx(null, async (t) => {
        let id = (await t.query('SELECT actor_id FROM actor_identities WHERE issuer = $1 AND subject = $2', [claims.iss, claims.sub])).rows[0]?.actor_id;
        if (!id) {
          id = (await t.query("INSERT INTO actors (type, mail, display_name) VALUES ('human', $1, $2) RETURNING id", [mail, name])).rows[0].id;
          await t.query('INSERT INTO actor_identities (issuer, subject, actor_id, reason) VALUES ($1, $2, $3, $4)', [claims.iss, claims.sub, id, FIRST_SIGN_IN_REASON]);
        }
        const r = await t.query('UPDATE actors SET mail = $2, display_name = $3, last_sign_in_at = $4 WHERE id = $1 RETURNING token_version', [id, mail, name, new Date()]);
        return { id, tokenVersion: Number(r.rows[0].token_version) };
      });
    } catch (e) {
      if (/** @type {{ code?: string }} */ (e)?.code !== '23505' || attempt > 0) throw e;
    }
  }
}

/**
 * Discovery of the issuer at start (failure = the process does not start), then assembly.
 * @param {{ config: AuthConfig, db: import('./http.js').Db }} o
 */
export async function createAuth(o) {
  const client = await oidc.discovery(new URL(o.config.issuer), o.config.clientId, o.config.clientSecret, undefined,
    o.config.tlsOff ? { execute: [oidc.allowInsecureRequests] } : undefined);
  const jwksUri = client.serverMetadata().jwks_uri;
  if (!jwksUri) throw new Error(`${o.config.issuer}: jwks_uri missing from the discovery`);
  return assembleAuth({ ...o, client, jwks: createRemoteJWKSet(new URL(jwksUri)) });
}

/**
 * Session provider and `/auth/*` routes from an already configured OIDC client (the unit tests build one without
 * a network).
 * @param {{ config: AuthConfig, db: import('./http.js').Db, client: oidc.Configuration, jwks: import('jose').JWTVerifyGetKey }} o
 */
export function assembleAuth(o) {
  const { config, db, client } = o;
  const sessions = createSessions(db, config.durations);
  const verifyLogout = createLogoutVerifier({ jwks: o.jwks, issuer: config.issuer, clientId: config.clientId });
  const redirectUri = new URL('/auth/callback', config.appUrl).href;
  const idleS = Math.floor(config.durations.idleMs / 1000);

  /**
   * Session provider of `createServer`: cookie missing or session invalid → `null` (cookie cleared); session
   * extended → cookie sent again with its `Max-Age`.
   * @param {import('fastify').FastifyRequest} req @param {import('fastify').FastifyReply} reply
   * @returns {Promise<LoadedSession | null>}
   */
  async function session(req, reply) {
    const token = req.cookies[SESSION_COOKIE];
    if (token === undefined) return null;
    const loaded = await sessions.read(token);
    if (!loaded) { reply.clearCookie(SESSION_COOKIE, CLEARED_COOKIE); return null; }
    if (loaded.extended) reply.setCookie(SESSION_COOKIE, token, cookieOptions(idleS));
    return loaded.session;
  }

  /** @param {import('./http.js').App} app */
  function routes(app) {
    const limiter = createLimiter(db, app.log);
    // Limit per IP (set by Caddy, TRUST_PROXY), wide threshold: the route only redirects to Keycloak.
    app.get('/auth/login', { exposeHeadRoute: false }, async (req, reply) => {
      await limiter.count(`login|ip:${req.ip}`, LOGIN_THRESHOLD_PER_IP);
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const seed = oidc.randomNonce();
      const next = safeReturnTo(/** @type {Record<string, unknown>} */ (req.query).next);
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: redirectUri, scope: 'openid', response_mode: 'query', state, nonce: nonceFrom(seed),
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      });
      const transaction = Buffer.from(JSON.stringify({ v: verifier, s: state, n: seed, r: next })).toString('base64url');
      reply.setCookie(TRANSACTION_COOKIE, transaction, cookieOptions(TRANSACTION_DURATION_S));
      return reply.redirect(url.href, 303);
    });

    app.get('/auth/callback', { exposeHeadRoute: false }, async (req, reply) => {
      const raw = req.cookies[TRANSACTION_COOKIE];
      reply.clearCookie(TRANSACTION_COOKIE, CLEARED_COOKIE);
      const startAgain = 'Login could not be completed; start again at /auth/login';
      if (raw === undefined) throw new Problem(400, 'OIDC_TRANSACTION_MISSING', startAgain);
      /** @type {{ v?: unknown, s?: unknown, n?: unknown, r?: unknown }} */
      let tx = {};
      try { tx = JSON.parse(Buffer.from(raw, 'base64url').toString()); } catch { /* unreadable cookie: refused below */ }
      if (typeof tx.v !== 'string' || typeof tx.s !== 'string' || typeof tx.n !== 'string') throw new Problem(400, 'OIDC_TRANSACTION_MISSING', startAgain);
      let tokens;
      try {
        tokens = await oidc.authorizationCodeGrant(client, new URL(req.url, config.appUrl), { pkceCodeVerifier: tx.v, expectedState: tx.s, expectedNonce: nonceFrom(tx.n) });
      } catch (e) {
        const d = /** @type {{ code?: string, error?: string }} */ (e);
        req.log.warn({ error: e instanceof Error ? e.message : String(e), code: d?.code, oauth_error: d?.error }, 'OIDC callback refused');
        throw new Problem(400, 'OIDC_CALLBACK_REJECTED', startAgain);
      }
      const claims = tokens.claims();
      // openid-client checked iss, aud, azp, exp, iat, nonce; equality with OIDC_ISSUER is the key of actor_identities.
      if (!claims || claims.iss !== config.issuer) throw new Problem(400, 'OIDC_CALLBACK_REJECTED', startAgain);
      const roles = rolesFromClaims(claims, config.clientId);
      if (roles.length === 0) throw new Problem(403, 'FORBIDDEN', 'No role for this tool');
      const actor = await resolveActor(db, claims);
      // ASVS 7.2.4: a different session identifier before and after sign-in.
      const previous = await sessions.read(req.cookies[SESSION_COOKIE]);
      if (previous) await sessions.destroy(previous.session.id);
      const sid = typeof claims.sid === 'string' ? claims.sid : null;
      const { token } = await sessions.create({ actorId: actor.id, roles, sid, idToken: tokens.id_token ?? null, tokenVersion: actor.tokenVersion });
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(idleS));
      req.log.info({ event: 'sign_in', actor_id: actor.id, sid }, 'sign-in');
      return reply.redirect(safeReturnTo(tx.r), 303);
    });

    // POST only (a link does not sign out); `config.origin`: origin rule of protections.js on top of
    // SameSite=Lax. Empty body or empty form accepted.
    app.post('/auth/logout', { config: { form: true, origin: true } }, async (req, reply) => {
      const loaded = await sessions.read(req.cookies[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, CLEARED_COOKIE);
      if (!loaded) return reply.redirect('/', 303);
      const s = loaded.session;
      await sessions.destroy(s.id);
      req.log.info({ event: 'sign_out', actor_id: s.actorId, sid: s.sid }, 'sign-out');
      const end = oidc.buildEndSessionUrl(client, { ...(s.idToken ? { id_token_hint: s.idToken } : {}), post_logout_redirect_uri: new URL('/', config.appUrl).href });
      return reply.redirect(end.href, 303);
    });

    // Back-Channel Logout 1.0: called by Keycloak, without a cookie or a session; `logout_token` as a form. Outside the
    // origin rule: the authentication is the token's signature, not a cookie.
    app.post('/auth/backchannel-logout', { config: { form: true }, bodyLimit: 16_384 }, async (req, reply) => {
      const jwt = req.body instanceof URLSearchParams ? req.body.get('logout_token') : null;
      if (!jwt) throw new Problem(400, 'INVALID_REQUEST', 'logout_token required');
      const { sid, sub } = await verifyLogout(jwt);
      let n = 0;
      if (sid !== null) n = await sessions.destroyBySid(sid);
      else if (sub !== null) {
        const id = (await db.query('SELECT actor_id FROM actor_identities WHERE issuer = $1 AND subject = $2', [config.issuer, sub])).rows[0]?.actor_id;
        if (id) n = await sessions.destroyByActor(id);
      }
      req.log.info({ event: 'backchannel_logout', sid, sessions: n }, 'back-channel logout');
      return reply.code(200).send();
    });
  }

  // `form-action` of the CSP (http.js): the sign-out form's 303 goes to the IdP's end-session page.
  return { session, routes, sessions, idpOrigin: new URL(config.issuer).origin };
}
