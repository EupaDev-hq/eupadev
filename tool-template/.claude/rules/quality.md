---
paths:
  - "api/**"
  - "web/**"
  - "db/**"
---

# Quality rules

## API
- Every unbounded list is paginated (`limit` 50 by default, 200 at most, and
  a cursor), both written in the contract.
- Every column a paginated list sorts or filters on has an index; no query inside a loop.

## Data and migrations
- Once deployed, migrations only expand: add, switch the code, remove in a later release.
- Every history row records who acted: the session's actor, or `system`.

## Personal data
- Personal data lives in dedicated tables, purged with their entity; history
  holds ids and closed values only, never names or free text.
- Each retention period is a `RETENTION_*` variable read by `db/purge.sql`,
  without default, fixed at Gate 1; never choose one.
- The purge and the restore of a soft-deleted row each have a test.

## Dependencies
- The lockfile comes from `pnpm install`, never edited by hand. Licences from
  the allow-list only: MIT, BSD-2/3, Apache-2.0, ISC, MPL-2.0, 0BSD, CC0, BlueOak-1.0.0 (CI checks it).

## Accessibility
- Main pages pass an axe audit with zero critical or serious violation (acceptance suite).

## Tests
- A concurrency test fires its requests with `Promise.all`; no test double
  for what can run in CI.
