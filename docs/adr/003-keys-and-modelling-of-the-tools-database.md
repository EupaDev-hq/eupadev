---
adr: 003
title: Keys and modelling of the tools database
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-004]
check: planned
---
## Context
Agents write, cycle after cycle, the schema of each tool's PostgreSQL
database. Without common rules, known mistakes repeat (internal identifier
exposed, uniqueness that prevents recreating a deleted row, value
impossible to remove from a list). These databases keep personal data: the
GDPR requires a retention period set by the client and its DPO, and an
identifier that can be linked to a person (through the directory) remains
pseudonymised personal data. An append-only audit that copied names would
have to be kept forever or rewritten.
PostgreSQL 18 provides `uuidv7()`: prefixed by the time to the
millisecond, strictly increasing within a connection, with no guaranteed
order between two.

## Decision
Model the database of each generated tool by the following rules.
- **Keys**: contract entities as `id uuid DEFAULT uuidv7()`, the only
  internal and public identifier; append-only tables as `bigint` identity;
  coded reference data with a `text` key. PostgreSQL 18 minimum.
- **Naming** in English, `snake_case`, plural tables, `<singular>_id`.
  **Columns** `timestamptz`, `created_at`, `updated_at`, `deleted_at`,
  `deleted_by`, `version bigint`; `updated_at` and `version` by a trigger.
- **Types**: closed lists as `CHECK (... IN ...)`, never `ENUM`; `jsonb`
  for the contract's free-form objects and outgoing events only.
- **Constraints**: partial uniqueness `WHERE deleted_at IS NULL`; audit as
  `SELECT, INSERT` for the application account. Lists sorted by
  `created_at, id`.
- **Personal data kept apart** (names, contact details, free text), in
  tables referenced by identifier: soft delete, then a real scheduled purge
  (soft-deleted or period exceeded).
- **Audit without personal data in clear**: `actor_id` (stable OIDC
  identifier), entities, action, timestamp, closed lists; no name, no free
  text, no `jsonb`. Never modified, even when a person is purged. This is
  pseudonymisation, not anonymisation.
- **Periods** set by the client and its DPO for each category, and two for
  the traces: the **traceability log** `audit_log` (who did what, when; 6
  to 12 months proposed, CNIL recommendation on logging) and the **business
  history** `<entity>_history` (successive states; 5 years proposed,
  ordinary limitation period): mandatory questions of Gate 1, parameters
  without a default value (Ilan's decision of 2026-10-19).
- **Dedicated purge account**: deletes rows, never modifies the audit.

## Rejected alternatives
- `bigint` + separate public identifier — doubled joins, "wrong one
  exposed".
- `uuid` v4 — does not sort by date, scatters inserts across the index.
- `ENUM` — can neither remove nor rename a value.
- Full `UNIQUE` with soft delete — blocks recreation.
- Direct physical deletion — no restore after a mistake.
- Audit kept forever — it remains personal data.
- Names in the audit erased by `UPDATE` — breaks append-only, and only
  achieves pseudonymisation.
- Erasing a person's audit when they are purged — loses "who approved
  what".
- Silent default period — decides in place of the data controller.

## Consequences
- One identifier everywhere (URL, `If-Match`, audit, other tool), unique,
  time-sorted, not enumerable in practice.
- **Limits of `uuidv7`**: it reveals the creation time (approved
  exception, random `uuid`, if that is sensitive); its order is strict only
  per connection, hence the `created_at, id` sort and the `bigint` of the
  logs.
- PostgreSQL 18 excludes an older PostgreSQL of the IT department: the
  database lives on the VM's own, maintained by EupaDev.
- **Purge**: a purged row only comes back from a backup, and backups count
  in the real retention period; one more account and task per tool.
- **The audit remains personal data** as long as it is kept (record of
  processing activities); the directory can still name a purged actor.
- Gate 1 of a tool with personal data often waits for the DPO: intended
  delay.

## Verification
A kit test will apply the migrations on a throwaway PostgreSQL 18 database
and query the catalogue: `uuidv7()` as default, neither `ENUM` nor
`timestamp` without time zone, the core's columns and trigger, partial
uniqueness, audit rights (`SELECT, INSERT` for the application;
`SELECT, DELETE`, never `UPDATE`, for the purge), audit without `jsonb`
nor text outside closed lists and `actor_id`. An Opengrep rule will refuse
`serial`, `gen_random_uuid()` and `uuid_generate_v4()` outside an
exception. A purge test, required of every tool, will check what
disappears and that the rest of the audit is identical byte for byte.
The orchestrator will refuse a Gate 1 without periods. Naming, sorting,
use of `jsonb` and classification of personal columns are only partly
checkable; the rest falls to the quality reviewer, the value of the
periods to the client.
