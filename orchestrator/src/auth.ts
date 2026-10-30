/**
 * Authentication of the API's callers (I0, ADR-017; Keycloak analysis D2, D4, D7): an OIDC access token issued by
 * Keycloak, verified with `jose` and nothing else — signature by a key of the internal JWKS (`createRemoteJWKSet`: cache
 * 10 min, an unknown `kid` triggers ONE re-read then a 30 s pause), `alg` in a closed list (RS256, ES256; never `none`
 * nor HMAC), header `typ: at+jwt` (RFC 9068: an ID or refresh token is not an access token), `iss` equal to the fixed
 * public issuer, `aud` containing the audience `eupadev-api`, not expired. A token that carries `cnf` (bound to a
 * key, DPoP) is refused as long as the proof is not verified: closed by default.
 *
 * The returned principal holds only what the engine uses: the stable key `(issuer, subject)` (OpenID Connect Core
 * §5.7: the e-mail can change and be reassigned), the e-mail and the name as contact attributes, and the hats read from
 * the roles OF THE CLIENT `eupadev-api` (`resource_access.eupadev-api.roles`) — never the realm roles, which leak
 * into every token.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { MAIL_ADDRESS } from './external/contracts.ts';

export const HATS = ['requester', 'admin'] as const;
export type Hat = (typeof HATS)[number];

export interface Principal {
  issuer: string;
  subject: string;
  mail: string | null;
  name: string;
  roles: readonly Hat[];
}

export interface OptionsOidc {
  /** `OIDC_ISSUER`: expected `iss`, the public URL of the realm (never the internal URL). */
  issuer: string;
  /** `OIDC_JWKS_URL`: where to read the public keys, preferably over the internal network. */
  jwksUrl: string;
  /** `OIDC_AUDIENCE`: `eupadev-api`. */
  audience: string;
  /** Pause between two JWKS re-reads triggered by an unknown `kid` (30 s; shortened by the tests). */
  pauseJwksMs?: number;
}

/** Token missing, unreadable or refused: 401 (`WWW-Authenticate: Bearer error="invalid_token"`). */
export class TokenRefused extends Error {
  override name = 'TokenRefused';
}

const ALGORITHMS = ['RS256', 'ES256'];
const MAX_NAME = 200;

export class Authenticator {
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;
  readonly #options: OptionsOidc;

  constructor(options: OptionsOidc) {
    this.#options = options;
    this.#jwks = createRemoteJWKSet(new URL(options.jwksUrl), { cacheMaxAge: 600_000, cooldownDuration: options.pauseJwksMs ?? 30_000, timeoutDuration: 5_000 });
  }

  /** Verifies an access token and returns the principal; any fault = `TokenRefused` (the detail stays in the message, never the token). */
  async verifier(token: string): Promise<Principal> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.#jwks, { issuer: this.#options.issuer, audience: this.#options.audience, algorithms: ALGORITHMS, typ: 'at+jwt' }));
    } catch (e) {
      throw new TokenRefused(e instanceof errors.JOSEError ? `${e.code}: ${e.message}` : 'unreadable token');
    }
    if (payload['cnf'] !== undefined) throw new TokenRefused('token bound to a key (cnf): proof of possession not supported');
    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') throw new TokenRefused('sub absent');
    const subject = payload.sub;
    const mail = typeof payload['email'] === 'string' && MAIL_ADDRESS.test(payload['email']) ? payload['email'] : null;
    const raw = [payload['name'], payload['preferred_username']].find((v): v is string => typeof v === 'string' && v.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(v)) ?? subject;
    const access = (payload['resource_access'] as Record<string, { roles?: unknown }> | undefined)?.[this.#options.audience]?.roles;
    const roles = Array.isArray(access) ? HATS.filter((c) => access.includes(c)) : [];
    return { issuer: this.#options.issuer, subject: subject, mail, name: raw.slice(0, MAX_NAME), roles };
  }
}

/** Value of an `Authorization: Bearer <token>` header; null if missing or of another scheme. */
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(header ?? '');
  return m === null ? null : m[1]!;
}
