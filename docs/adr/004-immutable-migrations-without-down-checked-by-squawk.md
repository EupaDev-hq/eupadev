---
adr: 004
title: Immutable migrations, without Down, checked by Squawk
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-003]
check: partial
---
## Context
Agents, sometimes in parallel, evolve the tools' database with
node-pg-migrate. Risks: a DDL that waits for a lock blocks the tool; a
migration modified after being applied leaves different databases under
the same number; a "Down" never run does not work when the day comes; two
branches take the same number. Measured (node-pg-migrate 9.0.0):
`checkOrder` refuses a file sorted before an already applied file, not the
reverse; SQL always runs in a transaction, outside a transaction only in
JavaScript (`pgm.noTransaction()`), where `SET LOCAL` has no effect. Squawk
(Apache 2.0) reports dangerous statements. Sources:
`docs/reflexions/recherche-2026-10-11/brut/K-experiences-bdd.md`,
`docs/reflexions/2026-10-13-adr-details.md`.

## Decision
Write the tools' migrations as immutable SQL files, without rollback,
checked by Squawk.
- **Files** `db/migrations/NNNN_intention.sql` (4 digits, one intention),
  immutable once on the main branch, without `-- Down Migration`,
  `SET LOCAL lock_timeout` and `statement_timeout` at the top. Number
  already taken: the branch merged second renumbers before its merge.
- **Squawk**: protected `.squawk.toml`; `prefer-robust-stmts` and
  `require-concurrent-index-*` disabled, the others blocking (including
  `ban-drop-*`, `renaming-*`); `squawk-ignore` forbidden outside an
  exception.
- **Expand/contract**: add the new while keeping the old; delete or rename
  in a later cycle, through a `NNNN_contract-intention.sql` file analysed
  by a dedicated, protected Squawk configuration that additionally allows
  only deletion and renaming. The field left the OpenAPI contract in an
  earlier cycle; the acceptance tests pass on the migrated database; the
  file requires its line in `.gitea/exceptions.txt`, written by a human
  through the exceptions route (`exception/**` branch that they merge).
- **Non-transactional exception** (index on a large table):
  `NNNN_intention.js` with `pgm.noTransaction()` and only
  `SET lock_timeout = '5s'`, a single `CREATE` or `DROP INDEX CONCURRENTLY`,
  `RESET lock_timeout`; no `statement_timeout`; registry line required.

## Rejected alternatives
- Mandatory Down — never tested, and triggers `ban-drop-*` everywhere.
- `squawk-ignore` on deletions — the agent would put it anywhere.
- `CONCURRENTLY` for every index — forbidden in a transaction, useless on
  a small table; the `.js` exception covers the large one.
- Refusing a `-contract-` if the name stays in the code — wrong on `name`,
  `status`…, blind to dynamic names: a mere aid to the reviewer.
- `SET LOCAL` in the `.js` exception — without a transaction, ignored.
- Timestamp instead of the number — order of writing and not of merging:
  `checkOrder` would refuse in production rather than in review.

## Consequences
- An applied file no longer changes; `checkOrder` refuses at deployment a
  migration sorted before the last applied one. Two agents in parallel
  take the same number: the diff check sees it before the merge, the
  second renumbers and goes through the CI again.
- Expand/contract is not a rollback: going back is a new migration. A
  migration that damages data can only be repaired by a restore, with the
  loss since the backup (24 h in standard, ADR-002).
- Every deletion or renaming goes through a human: intended. The registry
  line expires (one year at most) without breaking anything, since only
  new files are checked.
- Without `CONCURRENTLY`, an index locks writes during its build
  (negligible on a small table; `lock_timeout` fails rather than blocks).
  A failed `CONCURRENTLY` leaves an invalid index to drop.

## Verification
In the CI of each tool:
- every new file of `db/migrations/` will be analysed by Squawk (general
  configuration, or the dedicated one for a `-contract-`); the guard-rails
  job will refuse a `squawk-ignore` without a registry line;
- a diff check will refuse a migration of the main branch modified or
  deleted, a taken number, a Down, an SQL file without
  `SET LOCAL lock_timeout` at the top, a new `-contract-` or `.js` without
  a line in `.gitea/exceptions.txt` (read on the main branch), and a `.js`
  beyond the three permitted statements;
- for a `-contract-`, oasdiff (Apache 2.0) will refuse a removal of a
  field from the contract in the same PR, and the acceptance tests on the
  migrated database will fail if the API still reads the column, on the
  covered routes;
- a kit test will apply the migrations from scratch on a throwaway
  database.
