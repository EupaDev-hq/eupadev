---
adr: 024
title: Requester web page served by the engine, server-side OIDC session with client eupadev-web, deep-chat vendored by content hash, CSP without Trusted Types on that page
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-005, ADR-017, ADR-018, ADR-019]
check: planned
---
## Context
A requester today talks to the engine through the CLI
`orchestrator/scripts/eupadev.py` behind an SSH tunnel: she submits a
request, answers the scoping agent, gives her opinion on the mock-up and the
Preview. The conversation already exists in the engine: the `messages` table
is append-only, keyed by cycle, written before any e-mail, and read by the
scoping agent as the cycle's chat. The engine's API (`node:http`, no
framework) is bound to `127.0.0.1:8080`, requires `Host` on localhost and the
header `X-EupaDev: 1` (a browser cannot send it cross-origin: a CSRF
control), and authenticates every call with a Keycloak access token checked
by `jose` (ADR-017: `(iss, sub)` → actor, hats from the roles of the client
`eupadev-api`). Facts gathered on 2026-10-25 (note
`docs/reflexions/2026-10-25-note-chat.md`): RFC 10017 (OAuth 2.0 for
Browser-Based Apps) names three architectures and recommends the
backend-for-frontend for business applications handling personal data; a
public client in the browser keeps a token in JavaScript memory, where any
XSS steals it. deep-chat 2.5.1 (MIT, 387 KB single bundle, sha256 pinned) is
the only maintained framework-free chat web component found: it preloads a
history, replaces its HTTP call by a handler, accepts pushed messages, and
renders Markdown with `html: false`; but it has 30 `innerHTML` sinks and
reads function-typed attributes with `new Function()`, so it cannot run under
`require-trusted-types-for 'script'`, the policy of generated tools
(ADR-019). The core (`core/`) already holds a proven server-side OIDC
sign-in with `openid-client`, a `__Host-session` cookie backed by a PostgreSQL
table, and the pattern "a dependency served from `node_modules`, pinned,
never copied into the repository" (DOMPurify). Alternatives were measured
against them: a token-mediating backend, an OAuth proxy in front (oauth2-proxy
with Caddy `forward_auth`), Caddy serving the page, a separate static
container, NLUX and the React chat kits.

## Decision
Give requesters a web page served by the engine process, signed in by the
engine itself, built on a vendored deep-chat, with a CSP of its own.
- **Served by the engine**: the page's few static files (HTML, JavaScript,
  dictionaries, vendored component) ship inside the signed engine image and
  are served by the same `node:http` process as the API, on the same origin:
  no CORS, same-site cookie, one place for security headers. No second
  container, no file copied to the VM outside the image. The API's `Host`
  guard accepts the page's own name (`DASHBOARD_URL`) besides the
  loopback names; nothing else.
- **Server-side OIDC session (BFF)**: the engine is the OIDC client,
  confidential, named `eupadev-web`: authorization code + PKCE S256 +
  `state` + `nonce` with `openid-client` (the core's library and version).
  The access token Keycloak returns is verified by the same rules as a CLI
  Bearer (at+jwt, audience `eupadev-api`, hats from its client roles) and
  resolved to the same actor; then no token is kept. The browser only gets a
  `__Host-session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/) whose
  32-byte random value is stored hashed (SHA-256) in a `sessions` table,
  30 minutes idle, 8 hours at most; sign-out deletes the row and clears the
  cookie. `authenticate()` accepts the cookie or the Bearer: the CLI is
  unchanged. Every API call made with the cookie still needs
  `X-EupaDev: 1`; only the three sign-in navigations
  (`/auth/login`, `/auth/callback`, `/auth/logout`) are exempt. Without the
  web client configured, `/auth/*` answers 503 and the rest of the API works.
  `/auth/login` passes the page's language to Keycloak as `ui_locales`
  (`fr` or `en` only; the realm offers both, French by default).
- **deep-chat vendored by content hash**: `deep-chat` is a development
  dependency at an exact version, with the lockfile's integrity; its bundle
  is copied into the image at build time and served at a path carrying the
  first bytes of its sha256; it is never fetched at run time (ADR-005
  spirit) and never copied into the repository. Messages are plain text:
  the component's `html` message type is never used, Markdown is rendered
  with `html: false`, configuration goes through JavaScript properties,
  never HTML attributes.
- **CSP without Trusted Types on that page**: the chat page gets
  `script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors
  'none'` without `require-trusted-types-for`, unlike generated tools.
  `javascript:` links in an agent's text stay inert under `script-src
  'self'`. Generated tools keep the policy of ADR-019.
- **Reads are owned**: a conversation and a cycle's state are readable by
  the tool's requester or an admin only, the rule the opinions already
  follow; "my requests" lists only the requester's tools.

## Rejected alternatives
- PKCE in the browser (public client, token in JavaScript memory) — every
  XSS steals a token, and the chosen component has `innerHTML` sinks.
- Token-mediating backend (RFC 10017 §6.2) — the backend logs in but still
  hands the token to the page: no gain over the BFF here.
- OAuth proxy in front (oauth2-proxy, Caddy `forward_auth`) — one more
  container, identity carried by headers the engine must trust (a
  misconfiguration makes anyone anyone), two session systems next to the
  CLI's Bearer; Keycloak Gatekeeper is deprecated, `caddy-security` needs a
  custom Caddy build.
- Caddy serving the page, proxying the API — files shipped to the VM outside
  the signed image, two things to version.
- A separate static container — a second image to build, sign and deploy by
  digest, for four files.
- Loading deep-chat from a CDN — a runtime dependency outside the signed
  image (ADR-005).
- Trusted Types on the chat page — deep-chat's `innerHTML` and `new
  Function()` make it impossible without patching the vendored bundle.
- NLUX — licence reported as a modified MPL-2.0 that cannot be pinned down;
  adapter model built around streaming; no documented no-bundler setup.
- assistant-ui, Ant Design X, MUI X Chat, prompt-kit, AI Elements,
  @chatscope — React or framework-bound, need a build step.

## Consequences
- No token ever reaches the browser; a stolen cookie value is useless once
  the row is deleted, and the database never holds a usable cookie.
- A `sessions` table and the engine's first `DELETE` statements (sign-out,
  expiry); hats are frozen for the session's life (8 hours at most).
- The engine process also serves static files and a browser-facing sign-in
  flow: a larger surface in the most exposed component, same origin as the
  API, covered by the API's existing guards.
- The chat page runs a third-party component without Trusted Types:
  accepted for a page whose messages are plain text and whose scripts are
  `'self'` only; the component's accessibility is weak and must be checked
  mechanically.
- Keycloak gets a confidential client with an exact redirect URL; the lab's
  tunnel URL first, the public hostname later (a second `redirect_uris`
  entry, nothing else).
- Limit: no refresh of the hats during a session; a role change applies at
  the next sign-in.
- Limit: a Keycloak-only token endpoint layout is assumed (the token
  endpoint is derived from the JWKS URL).

## Verification
The engine's `node:test` API tests will check, with a fake identity
provider: the sign-in redirect carries `state`, `nonce` and a PKCE S256
challenge; a callback with a forged `state` or without its transaction
cookie is refused; the cookie yields the same actor as a Bearer; an
unknown or expired cookie is 401 and cleared; sign-out invalidates the
cookie value; a POST made with the cookie but without `X-EupaDev` is
refused; a requester's cookie cannot read another requester's cycle (403);
the database holds only the hash of the cookie value; `/auth/*` answers 503
when the web client is not configured — one mutation per rule (`state`
check, expiry, sign-out deletion, header exemption). Playwright (Chromium)
will load the page with the vendored component and check zero
`securitypolicyviolation`, inert XSS payloads (`<img onerror>`,
`[x](javascript:…)`), zero axe-core violation, and that a double click sends
one request. The engine's CI will refuse a `deep-chat` reference that is not
an exact version and a served bundle whose hash differs from the lockfile's
integrity. `verify-keycloak.yml` will compare the realm's clients with the
declared list (`eupadev-web` included, `at+jwt`, PKCE S256, exact
redirect URL). Not mechanically verifiable: that a future page never uses
the component's `html` message type (review of the page's code).
