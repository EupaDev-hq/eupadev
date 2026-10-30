---
adr: 019
title: Common core of generated tools and allowed dependencies
status: accepted
date: 2026-10-17
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-003, ADR-004, ADR-007, ADR-014, ADR-016, ADR-017]
check: planned
---
## Context
The tool template (`tool-template/`) provides 206 lines (headers, error
envelope, JSON body reading, role guards, logger) and no dependency; its
rules ask the agents to write OIDC, sessions, CSRF, rate limiting, contract
validation and audit themselves, which are the classes of code that studies
measure as the ones models get wrong most (authentication and identity up
to 83% of vulnerable programs, ICSE 2026). Facts gathered on 2026-10-17:
the template's `Dockerfile` belongs to the backend role and installs
without `--ignore-scripts`, so an agent can execute code when the delivered
image is built, CI green; the image runs with `/app` writable by the
process; agent containers reach only `registry.npmjs.org`, never a private
address, and carry no token. Measurements: full Fastify 5 installs 69
packages against 26 for `node:http` with the same building blocks; its four
HIGH advisories of September 2026 do not apply to a frozen configuration;
openapi-backend is 1,972 lines for the contract-derived routing alone;
Lucia (deprecated in 2025) points to a 190-line reference file for
sessions; Rails 8.2 (`:header_only`) is not released; Mantle does not
support geographic inference profiles. Detail, sources and
reviews: `docs/reflexions/2026-10-17-recherche-socle-commun.md`.

## Decision
Deliver to every generated tool a versioned common core, closed by default,
that agents use without being able to rewrite it or bypass it without a
mechanical check seeing it.
- **Versioned package** `@eupadev/core` (Apache-2.0, semver, migrations
  included, expansion only, separate tracking table): router derived
  from `openapi.yaml`, Ajv 2020-12 validation of requests and responses
  (closed schemas), RFC 9457 errors, OIDC through `openid-client` (code +
  PKCE, GET callback, back-channel logout), sessions in PostgreSQL (hashed
  `id.secret` token, 30 min / 8 h, `token_version`), CSRF by
  `Sec-Fetch-Site` and a static header without token, CSP with Trusted
  Types, rate limiting in the database, audit without `jsonb`, front-end
  modules served from the package, core entry point (fixed `CMD`).
- **Closed by default**: the process refuses to start if an operation of
  the contract has no `x-roles` or `security`, or if a handler has no
  `operationId`; a route outside the contract does not exist; parameterised
  `tx()` is the only access to the database; RLS optional per table,
  plumbing always in place, mandatory in the reinforced profile.
- **Allowed dependencies**: closed list of the lockfile's `name@version`
  (core: ajv, ajv-formats, yaml, openid-client, pg, `@fastify/busboy`, then
  `fastify` 5.12.5 or later, `@fastify/cookie`, pino;
  node-pg-migrate outside the web image; `nodemailer`, `dompurify`,
  `file-type` by exception, when the contract needs them), direct
  dependencies of the tool = core ∪ exceptions, ratchet on the count, cap of
  85 on the web image, empty `allowBuilds`, exact `packageManager`,
  `devEngines` refused.
- **Distribution**: archive `vendor/eupadev-core-<version>.tgz`
  (`file:`) protected in each repository, reference checked by the CI;
  published publicly on `registry.npmjs.org` when the project is published;
  ADR-016 mirror as a cache afterwards; never the forge's registry.
- **Image**: the platform's fixed `Dockerfile` (`.gitea/image/`), outside
  the agents' scope, `--ignore-scripts --ignore-pnpmfile`, `/app` not
  writable, read-only execution with `tmpfs` and a `/data` volume.
- **HTTP server**: Fastify 5 (5.12.5 or later) with a closed configuration
  frozen in the package: validator and serializer replaced by Ajv 2020-12
  for each part of the request and for the responses, `removeAdditional`
  disabled, `requestTimeout` and `connectionTimeout` set, explicit
  `trustProxy`, pino as the log. The `(ctx) → {status, body}` handlers never
  see Fastify; changing server does not touch the tools.

## Rejected alternatives
- Code copied into each tool — fixes do not propagate (Laravel:
  "no need to update the starter kit itself").
- `node:http` and a home-made router (comparative trial proposed by the
  research, not retained by Ilan) — more home-made security code, a single
  maintainer, nobody fuzzes it; Fastify is audited and its defaults are
  frozen once.
- Zero dependencies — months of work for one person, and security code
  nobody fuzzes.
- Hono, openapi-backend — one maintainer, 7 HIGH advisories including the
  routing for the one, 38 packages including lodash and no audit for the
  other.
- ORM or query builder — all have identifier-escaping CVEs in 2026;
  `postgres` is under the Unlicense, off the list.
- CSRF token — state and key that agents handle badly; Go 1.25 does without
  it.
- OIDC gateway in front of the tool (oauth2-proxy) — two critical CVEs in
  2026, session outside the tool's database.
- The forge's npm registry, or the core in the golden image — unreachable
  for agents without opening a private address and a token; version tied to
  the image.
- Mantle for the EU — no geographic profile, absent from Paris.

## Consequences
- Agents now write only handlers, parameterised SQL, migrations and front
  end; the rules go from "write this" to "use this".
- The core has a single maintainer and no audit: maintenance of about six
  days per quarter, external audit before 1.0, Fastify 6 migration to plan
  if this server is retained.
- A core bug affects every tool; it is fixed by one release and one
  maintenance cycle per tool.
- The package lock guarantees test/delivery equivalence and a visible
  diff, not correct use of the core: business authorisation and code
  written "from scratch" remain with the SEC-* kit, the reviewers and the
  gates.
- Fabrication in the EU possible through `bedrock-runtime` and an `eu.`
  profile, not with Fable 5.1 today.
- Construction estimated at 30-33 person-days (without comparative trial),
  then 7.5 to 9 weeks in
  parallel with the agents strand before the first real cycle.

## Verification
In each tool's CI: the guard-rails job will refuse any dependency off the
list, any increase in the number of packages, a core reference other than
the expected archive (lockfile specifier and integrity), a `Dockerfile` or
an `index.js` at the root, a lifecycle script, a `.pnpmfile`, a
`devEngines`; Opengrep will refuse in the tool's code the reserved imports
(`pg`, `openid-client`, `jose`, `cookie`, `ajv`, `node:http`, `fastify`),
`createRequire`, `import.meta.resolve`, `createServer`, `Set-Cookie`,
interpolated SQL and, in `db/`, the disabling of RLS and of the audit
triggers, and `GRANT`/`ALTER ROLE`; the image job will build with the platform's
`Dockerfile`, start the container read-only and run in it the SEC-* kit
and Schemathesis against a test Keycloak. In the core's CI: unit tests,
permanent replay of the Fastify and find-my-way advisories, PostgreSQL
catalogue test, "two instances" test, complete example tool. In the lab:
`verify-template` will install a tool from the archive under Smokescreen,
build the image and test the core in it. Not mechanically checkable:
correct use of the core by a handler (business authorisation), reviewed at
the gates.
