---
paths:
  - "api/**"
  - "db/**"
  - "**/*.sql"
---

# Backend rules

The builder's handlers and data. The reference tool (`api/`, `db/`) shows each pattern.

## Handlers
- One file per operation, `api/<operationId>.js`, exporting
  `async (ctx) => ({ status, body })`. `ctx` holds the validated `params`,
  `query` and `body`, the `session` (`actorId`, `roles`), `log`, `db.tx`
  and `fetch`. `api/lib/` holds only this tool's shared code.
- Answer only what the contract declares: an undeclared status or field fails at run time.
- A file body arrives as `ctx.body = { type, body }`; a download returns
  `{ status: 200, file: { name, type, body } }`.

## Data
- Never read-then-write a counter, quota or status: one atomic statement, or
  `SELECT … FOR UPDATE` in the same transaction.
- Invariants live in the schema too: `CHECK`, unique and foreign keys,
  triggers for the legal status changes.
- History is append-only and written by the database; deletion is logical
  (`deleted_at`) with a restore path; `db/purge.sql` erases what retention allows.
- Migrations are numbered SQL files under `db/migrations/`.

## Configuration
- The tool's own settings are environment variables, none with a default for
  a secret or a retention, listed in `.env.example` and `README.md`.
- Absolute links are built from `APP_URL`, never from the request.

## Integrations
- Another system only through its documented, authenticated API, by `ctx.fetch`; never its database.
