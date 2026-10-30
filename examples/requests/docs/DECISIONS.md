# Decisions of the "requests" tool

Decisions specific to this tool, one line each with its reason. The details
are in `docs/reflexions/2026-10-19-note-exemple-demandes.md` (§12, Ilan's
decisions of 2026-10-19).

## Technical

- Core referenced by `file:../../core`: same repository, the CI always tests the current core; `.tgz` archive at step 9 (E12).
- Contract `openapi.yaml` at the root: default of `start()` (E13).
- Realm role `reader` = requester: no change to the test realm shared with the lab (E2).
- Concurrency by `version` in the `PATCH` body: `ctx` does not expose the headers (E11).
- History and legality of the transitions by an SQL trigger in the tool's migration: a trigger cannot be forgotten (E7).
- Attachment in the database (`bytea`), one per request, 5 MiB, declared binary body, PDF/PNG/JPEG checked by signature: no volume, no path, no dependency (E4, E5).
- `nodemailer` in the tool (`api/lib/mail.js`): an ADR-019 exception, the core has no mail module (E9).
- Acceptance tests by `@playwright/test` + `playwright-bdd`: the template's `tests.md` rules (E10).

## Retention

Periods **proposed**, **to be fixed by the client with their DPO at Gate 1**.
The code has no default value: the periods come from the environment, and
these values are set only in the test and demo environment (E3). The core's
`bin/purge.js` (E8) refuses to run if one is missing; it runs `db/purge.sql`
with the purge account.

A soft-deleted request can be restored for **`RETENTION_DELETED`** after its
deletion, then the purge erases it (30 days in the test and demo
environment only; the client fixes the delay at Gate 1, never in code).
Each duration is a maximum: a row goes at the first one that applies (deleting
a request updates its `updated_at`).

| Data | Category | Proposed period | Variable | Reason |
|---|---|---|---|---|
| Requests: details (title, description, location, closing note), attachment, `requests` row | personal data (free text, photo) | 2 years after a final state (resolved, rejected, cancelled) | `RETENTION_REQUESTS` | operational follow-up |
| Abandoned drafts (never submitted): details, attachment, `requests` row | personal data (free text, photo) | **none: Gate 1 question** (how long may a draft nobody submits stay?) | `RETENTION_DRAFTS` (counted from the draft's last change) | a draft is never final, so `RETENTION_REQUESTS` never reaches it |
| Soft-deleted requests: details, attachment, `requests` row | personal data (free text, photo) | **Gate 1 question** (restore delay; 30 days in test and demo) | `RETENTION_DELETED` (counted from the deletion) | the time an administrator has to undo a deletion |
| `request_history` (history of the transitions, no free text) | business history | 5 years | `RETENTION_HISTORY` | general statute of limitations (ADR-003) |
| The core's `audit_log` (who changed which row) | traceability log | 1 year | `RETENTION_AUDIT` (read by the core's `bin/purge.js`) | CNIL recommendation, 6 months to 1 year (ADR-003) |
