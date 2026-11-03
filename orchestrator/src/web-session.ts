/**
 * Browser sign-in for the requester's web page (ADR-024; RFC 10017 §6.1 "BFF"): the engine is the OIDC client —
 * authorization code + PKCE S256 + state + nonce with `openid-client` (the core's library and model,
 * `core/src/auth.js`), confidential client `eupadev-web`. The browser never sees a token:
 * it gets a `__Host-session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/) whose random value is looked up by hash in
 * the `sessions` table (migration 0014, `Database.createSession`…). The access token Keycloak returns at the callback is
 * verified exactly like a CLI Bearer (`Authenticator.verifier`: at+jwt, audience `eupadev-api`, hats from the
 * client roles), so cookie and Bearer give the same `Actor` by the same rules; no token is kept afterwards.
 *
 * The login transaction (PKCE verifier, state, nonce, return path) lives in a short `__Host-oidc` cookie, read once at the
 * callback. Server metadata is static (Keycloak's fixed paths under the realm): no network at startup, the token endpoint
 * on the internal route (`OIDC_JWKS_URL`'s sibling), the browser-facing endpoints under the public issuer.
 */
import type http from 'node:http';
import * as oidc from 'openid-client';

export const SESSION_COOKIE = '__Host-session';
export const LOGIN_COOKIE = '__Host-oidc';
/** 30 min idle, 8 h at most (the core's bounds). ponytail: constants; environment variables the day a client asks. */
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_MAX_MS = 8 * 3_600_000;
const LOGIN_MAX_AGE_S = 600;
/** A relative path on this host only (no `//host`, no scheme, printable ASCII); anything else goes to `/`. */
const RETURN_PATH = /^\/(?![/\\])[\x21-\x7e]*$/;

export interface OptionsOidcWeb {
  /** `OIDC_WEB_CLIENT_ID`: `eupadev-web`. */
  clientId: string;
  /** `OIDC_WEB_CLIENT_SECRET` (or `_FILE`). */
  clientSecret: string;
  /** `OIDC_WEB_REDIRECT_URL`: `<page origin>/auth/callback`, registered on the client. */
  redirectUrl: string;
  /** Token endpoint on the internal route (derived from `OIDC_JWKS_URL`). */
  tokenUrl: string;
}

/** The callback cannot be completed (missing or foreign transaction, state or nonce mismatch, IdP error): 400, start again. */
export class SignInRefused extends Error {
  override name = 'SignInRefused';
}

export const safeReturnPath = (p: unknown): string => (typeof p === 'string' && RETURN_PATH.test(p) ? p : '/');

/** `Cookie` header → name → value (first occurrence wins). */
export function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (name !== '' && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** `Set-Cookie` value with the `__Host-` attributes (ASVS 3.3.1-3.3.4); `maxAgeS = 0` clears it. */
export const setCookie = (name: string, value: string, maxAgeS: number): string => `${name}=${value}; Max-Age=${maxAgeS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = (name: string): string => setCookie(name, '', 0);

export class WebSignIn {
  readonly #client: oidc.Configuration;
  readonly #options: OptionsOidcWeb;

  constructor(options: OptionsOidcWeb, issuer: string) {
    this.#options = options;
    this.#client = new oidc.Configuration({
      issuer, authorization_endpoint: `${issuer}/protocol/openid-connect/auth`, token_endpoint: options.tokenUrl, end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
    }, options.clientId, options.clientSecret);
    // Internal route in plain http (lab: Keycloak and the engine on the same Docker network); the public issuer stays https.
    if (new URL(options.tokenUrl).protocol === 'http:') oidc.allowInsecureRequests(this.#client);
  }

  /** `GET /auth/login`: where to send the browser (`uiLocale`: the page's language, for Keycloak's own screens), and the transaction cookie to set. */
  async start(returnPath: string, uiLocale?: 'fr' | 'en'): Promise<{ location: string; cookie: string }> {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(this.#client, {
      redirect_uri: this.#options.redirectUrl, scope: 'openid', response_mode: 'query', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      ...(uiLocale === undefined ? {} : { ui_locales: uiLocale }),
    });
    const transaction = Buffer.from(JSON.stringify({ v: verifier, s: state, n: nonce, r: safeReturnPath(returnPath) })).toString('base64url');
    return { location: url.href, cookie: setCookie(LOGIN_COOKIE, transaction, LOGIN_MAX_AGE_S) };
  }

  /**
   * `GET /auth/callback`: checks state, exchanges the code (PKCE verifier, client secret) and checks the ID token (iss, aud,
   * nonce, exp — by openid-client). Renders the access token, to be verified by `Authenticator`, and the return path.
   */
  async finish(transaction: string | undefined, query: URLSearchParams): Promise<{ accessToken: string; returnPath: string }> {
    const refuse = (why: string) => new SignInRefused(`sign-in could not be completed (${why}); start again at /auth/login`);
    if (transaction === undefined) throw refuse('no transaction cookie');
    let tx: { v?: unknown; s?: unknown; n?: unknown; r?: unknown } = {};
    try { tx = JSON.parse(Buffer.from(transaction, 'base64url').toString()) as typeof tx; } catch { /* unreadable: refused below */ }
    if (typeof tx.v !== 'string' || typeof tx.s !== 'string' || typeof tx.n !== 'string') throw refuse('unreadable transaction cookie');
    // The registered redirect URL plus the query actually received: what the IdP redirected to, and what the token request repeats.
    const current = new URL(this.#options.redirectUrl);
    current.search = query.toString();
    let tokens;
    try {
      tokens = await oidc.authorizationCodeGrant(this.#client, current, { pkceCodeVerifier: tx.v, expectedState: tx.s, expectedNonce: tx.n });
    } catch (e) {
      // Detail in the engine's log only: the browser gets a generic refusal.
      const d = e as { message?: string; code?: string; error?: string; cause?: { message?: string } };
      console.warn(`OIDC callback refused: ${d.message ?? String(e)}${d.code ? ` [${d.code}]` : ''}${d.error ? ` (${d.error})` : ''}${d.cause?.message ? `: ${d.cause.message}` : ''}`);
      throw refuse('authorization response or token exchange rejected');
    }
    return { accessToken: tokens.access_token, returnPath: safeReturnPath(tx.r) };
  }

  /** RP-initiated logout at Keycloak (ends the SSO session too), back to the page's origin. No ID token kept: Keycloak asks to confirm. */
  endSessionUrl(): string {
    return oidc.buildEndSessionUrl(this.#client, { client_id: this.#options.clientId, post_logout_redirect_uri: new URL('/', this.#options.redirectUrl).href }).href;
  }
}
