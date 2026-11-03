# Maintenance requests — the example tool

The first complete tool on `@eupadev/core`. Someone reports a maintenance
need, a manager handles it, an administrator keeps the list of categories. It
is the reference the agents copy, the target of the kit's SEC-* checks and of
the scanners, and the tutorial below. It was written by hand, one phase at a
time; its decisions are in `docs/DECISIONS.md`, referred to below by number.

**State: step 8 done.** Every story of `docs/spec.md` works on the real
database and is covered by a Gherkin scenario; the twelve SEC-* checks,
Schemathesis (zero failures) and k6 (thresholds) block the CI; a ZAP pass was
run once locally.

## Run it

```sh
pnpm install
pnpm verify            # contract and handlers, no database, no port
pnpm test:unit         # rules, no Docker
pnpm test:db           # disposable PostgreSQL (Docker)
pnpm test:kit          # the core's test stack: kit SEC-*, two-user specs, k6, Schemathesis (port 3000 free)
pnpm test:acceptance   # Gherkin scenarios, axe, SEC-XSS, on the same stack
```

`KIT_KEEP=1` keeps the stack between two runs (restart `eupadev-kit-tool-1-1`
and `-2-1` after changing code: files under `web/` and `api/` are read at
start). The CI runs the same commands, plus Squawk on the migrations
(`.github/workflows/examples-requests.yml`, jobs `tests` and `kit`).

Roles come from the client `trial-tool` of the test realm
(`core/tests/keycloak/realm-test.json`): **`reader` is the requester**
(alice), `manager` the manager (bruno), `admin` the administrator
(chloe). No change to the realm the lab shares (E2).

## The tool, file by file

Read in this order: it is the order the tool was built in, and the order an
agent builds a new one in.

### 1. `package.json`, `pnpm-workspace.yaml`

One runtime dependency, the core (`file:../../core`, E12), plus
`nodemailer` for mail (the ADR-019 exception, below). No `index.js`: the entry
point is the core's `bin/start.js`, which reads the contract, loads one
handler per operation from `api/`, connects to the database and serves
`web/` (migrations run before, with the owner account: `bin/migrate.js`). The workspace file copies the core's supply-chain settings (exact
versions, a package must be a day old, no build scripts).

### 2. `docs/spec.md`, `docs/DECISIONS.md`

What the tool must do, in the scoping role's format: capabilities, then
stories S1 to S7 in Given/When/Then, each with what must not change. Every
story becomes one feature file in `tests/acceptance/features/`.
`DECISIONS.md` holds the tool's technical decisions and the **retention
periods**, proposed for the client to fix with their DPO: the code has no
default, the periods come from the environment.

### 3. `openapi.yaml` — the contract

Everything starts here: the core derives routes, validation (Ajv, closed
schemas), roles (`x-roles`), rate limits (`x-rate-limit`) and the screens'
form constraints from it, and refuses to start on a contract its linter
refuses. What the linter requires, learned the hard way:

- every object `additionalProperties: false`, every request string a
  `maxLength`, every array a `maxItems`, every request number a `minimum` and
  a `maximum` within ±2^53 (an unbounded `version` overflowed `bigint`: a 500
  found by Schemathesis; hence the shared `Version` schema);
- the error responses the core itself produces are declared on every
  operation: 401, 403, 429, plus 400 with parameters or a body, 415 with a
  body, 404 with a path parameter, 413 with a file body;
- a download lives under `/files/` and answers 200 in a closed list of
  types; a file body declares only `application/pdf`, `image/png`,
  `image/jpeg` and its `x-max-bytes`.

`schemathesis.toml` says what the schema cannot: 422 is the expected answer of
a business rule, the list cursor is opaque (400 when unreadable), an upload
of random bytes is refused (415).

### 4. `db/migrations/0001_requests.sql` — the database

Five tables. `categories` (a code list, never deleted, deactivated);
`requests` (identifiers, status, version — no free text); `request_details`
and `request_attachments` (the personal data, purged with the request);
`request_history` (append only). The rules a mistake in a handler must not be
able to break live here, as triggers: a request is born a draft; a status
change outside the seven legal pairs is refused (`requests_transition`);
resolving or rejecting needs a closing note; the history is written by the
database itself. The core's triggers add the audit log and the version
counter. Squawk checks the migration in CI. Since nothing is deployed yet,
the file is rewritten rather than amended; after the first deployment,
migrations only add.

### 5. `api/lib/requests.js` — what the request handlers share

The columns read (`SELECTION`) and the visibility rule (`SCOPE`,
`VISIBLE`): one's own requests, or everything but others' drafts for whoever
manages, **written into the SQL** of every query, never filtered afterwards.
Out of scope answers 404, like a request that does not exist (SEC-IDOR).

### 6. `api/<operationId>.js` — one handler per operation

A handler gets `ctx` (validated `params`, `query`, `body`, the `session`, a
logger, `ctx.db.tx`) and returns `{ status, body }`; every refusal is a
`throw new Problem(status, CODE, detail)`. Roles, validation, rate limits,
CSRF and headers are done by the core before the handler runs. The pattern,
from `deleteRequest.js`:

```js
const { rowCount } = await ctx.db.tx((t) => t.query(
  `UPDATE requests r SET deleted_at = now(), deleted_by = $1 WHERE r.id = $3 AND ${VISIBLE}`,
  [...scope(ctx.session), id]));
if (rowCount === 0) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
return { status: 204 };
```

- `listCategories`, `createCategory`, `updateCategory`: the code list.
- `createRequest`, `getRequest` (with its history and attachment),
  `listRequests` (newest first, keyset cursor on `(created_at, id)`, filters;
  `deleted=true` for the administrator).
- `updateRequest`: draft fields by the author, a status change, or a
  restore, always at the version read (409 otherwise, E11); the row is locked
  for the transaction; the database judges the pair (from, to).
- `deleteRequest`: soft delete by the administrator; the purge erases the
  request once `RETENTION_DELETED` is over, unless restored first.
- `getMe`: the caller's name and roles, so the screens show only what the
  caller may use.

### 7. `api/lib/transitions.js`, `api/lib/attachments.js` — the rules

Pure functions, unit tested: who may ask for which status (the author submits
and cancels, whoever manages handles), when a note is required; who may change
an attachment and when. What the database already knows (the legal pairs)
is not repeated here.

### 8. `api/exportRequests.js` — a download

`GET /files/requests.csv`, for managers and administrators: the handler
returns `{ status: 200, file: { name, type, body } }` where `body` is a
stream read page by page, each page in its own short transaction (no long
transaction for a big export). Cells are quoted, and a cell starting with
`= + - @` is prefixed with `'` against formula injection. Comma by default,
`separator=semicolon` for a spreadsheet set to a decimal-comma language.

### 9. `api/uploadAttachment.js`, `deleteAttachment.js`, `downloadAttachment.js` — a file

One photo or PDF per request, stored in the database (E4, E5): no volume, no
path. The core refuses an undeclared type, content whose first bytes are not
its type (an HTML page renamed `.png`), an empty body and anything over 5 MiB,
before the handler, which gets `ctx.body = { type, body }`. The handler only
decides who and when. Removing is idempotent (204 when there is none). The
download is always `Content-Disposition: attachment`, never shown inline.

### 10. `api/lib/mail.js` — mail

`nodemailer` in the tool (E9): a submission goes to the managers' shared
mailbox (`MAIL_MANAGERS`), a status change made by someone else to the
requester, with the reason of a rejection and a link built from `APP_URL`,
never from the request. The subject stays on one line whatever the title
holds. Sent after the commit, without delaying the answer; a failure is logged
as `mail_failed` with an `error_id` and never undoes or fails the change.

### 11. `db/purge.sql` — retention

What the purge erases and after how long (`RETENTION_REQUESTS`,
`RETENTION_DRAFTS`, `RETENTION_DELETED`, `RETENTION_HISTORY`, read by the core's `bin/purge.js` with the purge
account, which refuses to run without them). The purge's own deletions are
not journaled, so the audit log stays identical byte for byte (ADR-003).

### 12. `web/` — the screens

`index.html` holds the layout (`.app-shell`, `.sidebar` of the design
system) and one `<template>` per block; `app.js` is a hash router with one
view per screen: list (filters, paging, CSV links), detail (fields, history,
attachment, the buttons the caller may use), new request and draft edit
(`bindForm`: HTML constraints taken from the contract), categories and
deleted requests for the administrator. Every call goes through an
`operationId` (`api.call`, `api.link`, `api.upload`), every text through
`textContent`: no `innerHTML`, no inline style, so the core's CSP with
Trusted Types holds. `styles/design-system.css` is copied as is from the
template; `styles/app.css` only adds classes (one lesson: the design system's
`display: flex` overrides `[hidden]`, so `app.css` restores it). Screens are
in English; the French translation comes with i18n.

### 13. `tests/` — five layers

| Layer | Files | What it proves |
|---|---|---|
| Unit | `tests/unit/` | the rules (transitions, attachments, mail recipients, CSV cell), no database |
| Database | `tests/db.test.js` | catalogue, rights of the three accounts, legal and illegal transitions, audit, purge |
| Kit | `tests/kit.test.js`, `tests/stack.js`, `tests/stack.vars` | the core's stack (two instances behind Caddy, PostgreSQL, Keycloak, Mailpit): the API on the real database, two-user specs (SEC-IDOR, SEC-URL), mail and SMTP down, the twelve SEC-* generated from the contract, k6, Schemathesis |
| Load | `tests/perf/load.k6.js` | the list and the read, one VU per person, p(95) under 300 ms |
| Acceptance | `playwright.config.js`, `tests/acceptance/` | one Gherkin feature per story (`features/`, steps in `steps/`), axe on every page, page errors, CSP violations and unexpected dialogs fail a scenario; `security/xss.spec.js` SEC-XSS |

Each scenario makes its own data, named with a per-scenario suffix, and
signs in through the real Keycloak form: no test bypass exists.

## Pitfalls found in review

- Check a reference (a category) only when the request changes it: the
  edit form sends the current value back, and a since-deactivated one must
  not block an unrelated edit.
- Every state a row can stay in needs a retention, drafts included; a soft
  delete keeps its restore delay (`RETENTION_DELETED`) before the purge.
- A file name pattern excludes C1 controls (U+0080-U+009F) as well as C0
  and DEL; cut a text by code points (`[...s].slice()`), not UTF-16 units.

## What the tool does not do (yet)

- Office and OpenDocument attachments (`.docx`, `.xlsx`, `.odt`, `.ods`):
  deferred; they need a check of the archive's content, not only its first
  bytes.
- A French translation of the screens (i18n), and a check at start that the
  mail settings are present.
- The dashboard (`getStats`): optional, not built.
