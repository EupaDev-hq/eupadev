---
adr: 032
title: Demo data on the Preview, a seed shipped with the tool and loaded by the platform after the migrations
status: accepted
date: 2026-11-10
decision-makers: Ilan
supersedes:
related: [ADR-004, ADR-017, ADR-022]
check: partial
---
## Context
A requester who opens the Preview of a core tool for the first time sees
empty lists, dashboards and charts: nothing tells whether the tool answers
the need before someone has typed data in by hand. The Preview database is
emptied at every new image digest (decision of 2026-10-26, kept: the
deployer drops and recreates the `app` schema, then runs the migration as
a one-shot Compose service with the tool's own image and owner account,
before any traffic, ADR-022; Prod is never emptied). Every business write
needs an actor and a request id (`audit_row()`, ADR-004), and a person gets
an actor only at first sign-in (ADR-017), so no file can attach rows to
the personas of the Preview; persona-scoped screens ("my requests") can
only be filled by the acceptance suite's rows or by the requester's
clicks. In cycle 9 the tests agent invented a teardown that deleted its
rows after each run, while the template already said "each scenario makes
its own data". The tool's `db/` folder is copied into the signed image, so
a data file shipped there is part of what was checked, and inert in Prod.
Changing the core's `bin/migrate.js` means a core release and a new pin
(ADR-023).

## Decision
Every core tool ships its demo data as `db/seed/demo.sql`, written by the
builder, loaded by the platform on the Preview right after the migrations
of a schema it has just emptied, never on Prod.
- **Content**: the builder writes it after the migrations, on the model of
  the reference tool: one `machine` actor `demo-seed` and the
  `set_config('app.actor_id' …)` / `set_config('app.request_id' …)`
  preamble, then 10 to 20 rows per main entity, every reference row used,
  every status of every flow represented, walked through the transition
  triggers, dates relative to `now()`. INSERT and UPDATE only. People,
  suppliers and addresses are obviously fictional (names from the
  reference seed's list, mails `@example.com`, no real company).
- **Loading**: the deployer runs the one-shot service `seed` of the core
  Compose model when, and only when, it has just emptied the schema (new
  digest on the Preview): same image, same uid, same owner account as the
  migration, never the superuser used to empty the schema. The script is
  the platform's (`seed.mjs`, installed by Ansible, mounted read-only), it
  uses the image's own core and `pg`, applies the file as one transaction
  with the migrations' timeouts, and refuses a file that visibly changes
  the schema, deletes rows, runs a block or a psql meta-command: a
  discipline check (a keyword filter, which escaped quotes can fool), not a
  boundary; the privilege boundary is the owner account, the same as for
  the migrations the agents already write. A failed Preview keeps the old
  image's schema migrated but not seeded. Without the
  file, nothing is done. A failed seed follows the failed-migration path:
  nothing started, the previous Preview keeps serving. Prod never empties,
  so Prod never seeds; a same-digest redeploy keeps its data.
- **Checked at push**: the template's boot check (same image, throwaway
  PostgreSQL) is red when a tool has migrations and no seed, when the seed
  is refused, when it fails, or when a table of the tool (schema `app`
  less the core's tables, the migration ledgers and `*_history`) is left
  without a row.
- **Tests never reset the Preview**: no teardown, no cleanup fixture; the
  suite's rows stay (they are what fills the persona-scoped screens), the
  demo rows are not the suite's to read; scenarios assert on the rows
  they created, never on an empty list or a total.
- Discovery mode (ADR-028) runs a fake deployer: nothing to seed.

## Rejected alternatives
- Seed inside the core's `bin/migrate.js` — a core release and a new pin
  for every tool before the first Preview shows data; kept for a later
  release, when `seed.mjs` disappears into it.
- Let the acceptance suite fill the Preview — it only creates the rows its
  scenarios need, in the personas' names, and nothing on the first visit
  before the suite has run.
- A teardown after the suite — it would empty the persona-scoped screens
  the seed cannot fill, and the shared Preview is already reset at every
  digest.
- Attach demo rows to the personas — a persona has no actor before its
  first sign-in (ADR-017); creating actors by mail would bypass the
  (issuer, subject) identity.
- Keep the Preview's data across digests instead — a migration written
  against an empty schema would meet old rows, and a stale Preview would
  show data the new contract no longer has.
- Faker-style generated data — random names look real, cannot be grepped
  for, and differ at every deployment; a fixed file is reviewed like code.

## Consequences
- A first-time admin or manager persona sees rows on every list, dashboard
  and chart; the accessibility and performance checks of the Preview audit
  populated pages.
- Rows a requester types in on the Preview still vanish at every new
  digest (today's behaviour, unchanged).
- A suite that asserted on emptiness or on a count goes red on its first
  Preview run and is fixed by the finding loop: one round at most.
- A seed that violates a trigger or a constraint is caught at push by the
  boot check, never on the Preview.
- The fictional-data rule is prose: a real-looking mail outside
  `example.com` is not caught mechanically.
- The Preview does not fill persona-scoped screens on the first visit; the
  requester's own clicks or the suite's rows do.

## Verification
`infra/ansible/roles/deployer/files/test_deployer.py` checks that a new
digest on the Preview runs empty, migrate, seed, then up; that a
same-digest redeploy and a Prod deployment never run the seed; that a
failed seed answers like a failed migration, nothing started.
`tool-template/.gitea/checks/boot-check.sh`, run by the tool's `check.yml`
and by `.github/workflows/template-rules.yml`, applies the seed of a tool
with migrations as the owner on the throwaway database, refuses a seed
with schema changes or deletions, and is red when a table of the tool has
no row. `examples/requests/tests/db.test.js` applies the reference seed on
the kit's throwaway PostgreSQL and checks every status, every category and
every table. Not mechanically checked: that the rows appear on every
screen of a deployed Preview (the free cycle on the lab shows it), the
fictional-data rule, and that a suite never resets the Preview.
