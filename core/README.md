# @eupadev/core

Common core of the generated tools (ADR-019): what the agents use without
rewriting it. Design and scope:
`docs/reflexions/2026-10-17-note-socle-coeur-http-base.md` (steps 2 and 3),
`docs/reflexions/2026-10-18-note-socle-oidc-sessions.md` (step 4),
`docs/reflexions/2026-10-18-note-socle-protections.md` (step 5),
`docs/reflexions/2026-10-18-note-socle-front.md` (step 6),
`docs/reflexions/2026-10-19-note-socle-kit.md` (step 7);
specification: `docs/reflexions/2026-10-17-recherche-socle-commun.md`.

**Status: steps 2 (HTTP core), 3 (database), 4 (OIDC, sessions, sign-outs), 5
(web protections), 6 (front modules) and 7 (security test kit) in 0.1.0;
0.1.1: node-pg-migrate as a runtime dependency, ADR-023; 0.1.2: fixes from an
audit of a generated tool (sign-out reaches the IdP, IdP name capped at 200,
strict uuid, finite query numbers, invisible characters stripped from free
text, 120 reads a minute); 0.2.0: every name in English (breaking API).**
Plugged into the tool template (step 9, exact version from the forge's npm
registry); download route `/files/` built (D3, 19/10), `/core/contract.json`
behind a session (D6.1), uploads added in step 8; kit shipped by the package
(`@eupadev/core/kit`, `@eupadev/core/kit/*`, K1).

| Path | Role |
|---|---|
| `bin/start.js` | Entry point of the tool (`--verify`: contract and handlers only) |
| `bin/migrate.js` | Migrations of the core (`core_migrations`) then of the tool (`db/migrations`), owner account |
| `bin/purge.js` | Scheduled purge, purge account, one transaction: expired sessions, rate-limit windows older than one hour, `audit_log` beyond `RETENTION_AUDIT`, then the tool's `db/purge.sql`, which reads its periods through `current_setting('purge.retention_<x>')` from `RETENTION_<X>`. Without a period, nothing runs (no default value). Its deletions are not logged; its trace is the JSON line it writes |
| `src/contract.js` | Reads `openapi.yaml` 3.1, local `$ref`s, contract linter: refuses to start; `/files/…` (downloads: `GET` only, 200 as `text/csv`, `application/pdf` or `application/zip`) |
| `src/http.js` | Frozen Fastify 5, routing by `operationId`, `(ctx) → {status, body}`, Ajv 2020-12 on requests and responses, RFC 9457, 405, 415, headers, `/health`; downloads `{ status: 200, file: { name, type, body } }` (`Content-Disposition: attachment; filename*`, 50 MiB streamed, cut beyond); `/core/contract.json` behind a session |
| `src/db.js` | `pg` pool, `tx()` with `set_config` per transaction |
| `src/auth.js` | OIDC through `openid-client` (code + PKCE, GET callback, transaction cookie `__Host-oidc`), `(iss, sub)` → actor, `/auth/login`, `/auth/callback`, `/auth/logout` (RP-initiated), `/auth/backchannel-logout` (`jose`) |
| `src/sessions.js` | Sessions in the database: hashed `id.secret` token, 30 min / 8 h, `token_version`, cookie `__Host-session` |
| `src/protections.js` | CSRF without a token (hybrid rule on `Sec-Fetch-Site` then `Origin` = `APP_URL`, static header `X-Requested-With: eupadev` on `/api/**`, `Sec-Fetch-Site: same-origin` required under `/files/`, `csrf_blocked` counter), `safeReturnTo`, `safeEqual`, `ctx.fetch` |
| `src/rate-limit.js` | Rate limiting in the database (`rate_limits`, one `INSERT … ON CONFLICT` statement), 429 + `Retry-After`, purge |
| `migrations/*.sql`, `sql/roles.sql` | PostgreSQL tables, functions and roles (expansion only); `audit_row()` on every business table, `audit_row('column')` when the key is not `id` (`uuid` key in `row_id`, other key in `row_key`); a deletion by the purge role does not write to `audit_log` |
| `src/static.js` | The tool's `web/` and the core's `web/` (under `/core/`) in a single `Map` URL → file; DOMPurify served from `node_modules` at `/core/vendor/purify.js` |
| `web/api.js` | `api.get/post/put/patch/delete`, `api.call(operationId, …)` (method and path read from `/core/contract.json`), `api.link(operationId, { params, query })` (path of a download, to set on an `<a href>`), `X-Requested-With: eupadev`, `ETag` → `If-Match`, problem+json → `ApiError` (`retryAfter` on 429), 401 → `/auth/login?next=…`, `api.signOut()` (`POST /auth/logout`) |
| `web/render.js` | Trusted Types policy `eupadev`; `html\`…\`` (escaped values), `render()` (the only `innerHTML` write), `clone()`, `fill()`, `list()` (update by key, `textContent`) |
| `web/router.js` | Fragment router, focus on `<main>` after navigation |
| `web/form.js` | `bindForm(form, operationId)`: HTML constraints from the contract's schema, typed values, button disabled while sending, `aria-live` state, 400 error sent back to the field |
| `web/svg-chart.js` | `barChart()`: accessible SVG bar chart (`role="img"`, `<title>`, equivalent table), colours `--series-N` |
| `web/escape-html.js` | `escapeHtml()` (the template's, moved here) |
| `web/lang/en.json`, `web/lang/fr.json` | The screen texts of the front modules (status messages, errors, chart description); the language is the page's `lang`, English otherwise |
| `kit/mailpit.js` | Kit: `mailpit(base)` reads what the tool sent in the test Compose's Mailpit (`list`, `waitFor`, `clear`); its API is published on 127.0.0.1. SMTP_URL and MAIL_FROM point at it; a tool's own variables go in the file named by `TOOL_VARS` |
| `kit/sec.js` | Kit: the twelve SEC-* (AUTH, ROLE, VALID, MASS, CSRF, HEAD, COOKIE, RATE, ERR, STATIC, BYPASS, UPLOAD) generated from the contract, `generateCases(options)` → `{ sec, name, verify }`, independent of the runner |
| `kit/index.js`, `kit/headers.js`, `kit/http-browser.js` | Kit: reading the contract, static `REQUEST_HEADERS` (for k6 too), valid value and invalid variants of a schema (judged by Ajv), sign-in through the Keycloak form |
| `kit/two-users.js` | Kit: isolated Playwright contexts signed in through Keycloak, anonymous context, API call from a context (SEC-IDOR, SEC-URL, SEC-XSS) |
| `kit/throwaway-postgres.js` | Kit: throwaway PostgreSQL through Docker (pinned image), roles of `sql/roles.sql`, migrations of the core then of the tool, `query(url, sql)` |
| `kit/test-tools.js` | Kit: `docker` arguments of Schemathesis 4.31, ZAP 2.17 api-scan, k6 2.3 (pinned images), static headers and session included |
| `kit/compose.test.yml`, `kit/Caddyfile.test` | Test Compose: tool ×2 (production posture) behind Caddy, PostgreSQL, Keycloak, Mailpit, on `http://localhost:3000`; the example tool by default, another tool through `TOOL_NAME`, `TOOL_DIR`, `TOOL_ROOT`, `TOOL_CORE` |
| `kit/realm.js` | Kit: `readRealm()`, the people of the test realm with their roles of the `trial-tool` client, and the client's secret |
| `tests/example/` | Minimal contract, its handlers and its `web/` page (demonstration of the front modules): the target of the tests |
| `tests/keycloak/realm-test.json` | Test realm `tools` (client `trial-tool`, 3 roles, 3 people; secrets for CI only), also applied to the lab (`verify-keycloak.yml`) |

## Tool side

```
openapi.yaml            contract (3.1), everything under /api/ (or /files/ for a download), x-roles on each operation
api/<operationId>.js    export default async (ctx) => ({ status, body })
                        download: ({ status: 200, file: { name, type, body } }), body a Buffer or Readable
db/migrations/NNNN_*.sql
web/                    static files
```

`ctx = { params, query, body, session, db, log, request_id, fetch }`;
`ctx.db.tx(async (t) => t.query(sql, values))` is the only access to the
database; `ctx.fetch(url)` is the only HTTP egress (http(s) only, redirects
never followed, 10 s, environment proxy); `throw new Problem(404, 'NOT_FOUND',
'detail')` for a business error; `safeEqual(a, b)` (exported by the package)
to compare a secret.

Download (CSV, PDF, ZIP export): a `GET /files/…` operation of the contract,
answer `200` as `text/csv`, `application/pdf` or `application/zip` (closed
list, no schema), `x-roles` as elsewhere; the handler returns
`{ status: 200, file: { name, type, body } }` with `type` among the declared
ones; the core sets `Content-Disposition: attachment; filename*=UTF-8''…`
(sanitised name), `nosniff`, `no-store`, and cuts beyond 50 MiB. The file is
downloaded through a same-origin link (`api.link`), never through `fetch`.
`image/png` and `image/jpeg` are in that list too.

Upload (one file): an operation `PUT` or `POST` whose `requestBody` declares
only types from `application/pdf`, `image/png`, `image/jpeg` (no schema), with
`x-max-bytes` (1 to 10 MiB) and the 413 response declared. The core refuses an
undeclared Content-Type (415 `UNSUPPORTED_MEDIA_TYPE`), content whose first
bytes are not its declared type (415 `FILE_TYPE_MISMATCH`), an empty body (400
`FILE_REQUIRED`) and anything over the cap (413), all before the handler, which
receives `ctx.body = { type, body }` (`body` a Buffer). In the browser,
`api.upload(operationId, { params, query, file })` sends the file raw after
checking its type and size against the contract. The kit generates SEC-UPLOAD
from the declaration.

What the core requires from the client: every `/api/**` request carries
`X-Requested-With: eupadev` (otherwise 403); a write comes from the same
origin (`Sec-Fetch-Site: same-origin`, otherwise `Origin` equal to `APP_URL`;
without either, refused as soon as a session cookie is present); a `/files/**`
request carries `Sec-Fetch-Site: same-origin` (navigation from the tool; a URL
pasted in the address bar is refused); `/core/contract.json` requires a
session; each operation is limited to `x-rate-limit` requests a minute per
person (default 20 for a write, 120 for a `GET` read; 429 + `Retry-After`),
`/auth/login` to 60 a minute per IP.

In the browser, the pages of `web/` import the core's modules by absolute
path, with no build step or copy:

```js
import { api } from '/core/api.js';
import { clone, html, list, render } from '/core/render.js';
import { createRouter } from '/core/router.js';
import { bindForm } from '/core/form.js';
import { barChart } from '/core/svg-chart.js';
import DOMPurify from '/core/vendor/purify.js'; // when the contract needs it (rich text)
```

The core's CSP enforces Trusted Types: `textContent` everywhere, `innerHTML`
only through `render(el, html\`…\`)` or `render(el, DOMPurify.sanitize(x,
{ RETURN_TRUSTED_TYPE: true }))`; no inline style or script. Full example:
`tests/example/web/`. `form-action` names the origin of `OIDC_ISSUER` too:
sign-out (`api.signOut()`) is a form answered by a 303 to the IdP's
end-session page, and Chromium checks `form-action` on that redirect.

Free text: the core strips control characters (except tab and line feed) and
format characters (bidi overrides, zero-width…) from every string of the query
string and the JSON body, after a first validation, then validates again (a
text of invisible characters only is refused like an empty one; `minLength:
1`). A `format: uuid` is the plain RFC 9562 form (`urn:uuid:` refused); a
non-finite number in the query string (`Infinity`, `1e309`) is a 400.

Variables: `PORT`, `HOST`, `DATABASE_URL` (or `_FILE`), `DATABASE_CA_FILE`
(verified TLS) or `DATABASE_TLS=off` (development), `APP_URL` (public origin
of the tool), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (or
`_FILE`), `OIDC_TLS=off` (issuer and `APP_URL` over http: development),
`SESSION_IDLE_MINUTES` (5-30, default 30), `SESSION_MAX_HOURS` (1-8),
`TRUST_PROXY` (Caddy's IP), `LOG_LEVEL`, `CONTRACT`. If `HTTP(S)_PROXY` is
set, `NODE_USE_ENV_PROXY=1` must be too (read by Node at start, otherwise
refusal to start).

## Commands

Prerequisites: Node ≥ 24, pnpm 12.16.1 (`corepack enable`), Docker for
`test:db`, `test:keycloak`, `test:auth` and `test:kit` (the last two listen
on port 3000: one after the other), Playwright's Chromium for `test:front` and
`test:kit` (`pnpm exec playwright install chromium`).

```sh
pnpm install --frozen-lockfile
pnpm typecheck      # tsc --checkJs --strict on src, bin, tests, then web (lib dom, Trusted Types)
pnpm test           # contract linter, HTTP core, auth without network (logout token, cookies), advisory replay, protections (CSRF, Go/Rails cases, rate limit, safeEqual, ctx.fetch), pure front functions
pnpm test:front     # real Chromium: demonstration page under CSP + Trusted Types, SEC-XSS, form, router, chart, axe-core
pnpm test:db        # throwaway PostgreSQL 18.6: migrations, catalogue, rights, audit, purge, sessions, rate limit across two instances
pnpm test:keycloak  # throwaway Keycloak 26.8.1: test realm import, sign-in of each person, roles in the ID token
pnpm test:auth      # throwaway Keycloak + PostgreSQL, two instances: real sign-in, refusals, token_version, clock, RP-initiated (also from Chromium: CSP `form-action`) and back-channel logout
pnpm test:kit       # test Compose: the kit's twelve SEC-* on the example, deliberate mutations killed, two users, Schemathesis, k6
pnpm test:all       # all of the above, in order
```
