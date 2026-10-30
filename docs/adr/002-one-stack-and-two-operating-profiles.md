---
adr: 002
title: One stack that grows and two operating profiles
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-003]
check: planned
---
## Context
Generated tools are born simple (one screen, one user) and then grow:
users, roles, reference data, consumers; some become critical. Levels (N1,
N2, N3) with different stacks would make a tool change technology at each
step up, through a migration by agents on a tool in production; and a
level chosen at scoping does not survive the tool's life. Source:
`docs/reflexions/recherche-2026-10-11/05-revision-croissance-fable.md`.

## Decision
Keep a single technical stack for every tool, which never changes
technology as it grows, and distinguish two operating profiles.
- **What grows**: the share of the kit used and the profile, never the
  tech.
- **Both profiles**: database backup copied off the VM by restic
  (encrypted repository, storage that outlives the VM), restore tested.
- **Standard**: shared tools VM, one instance, daily backup.
- **Reinforced** (sensitive data or criticality): dedicated VM, two
  instances, written RPO and RTO, continuous archiving of the PostgreSQL
  logs mandatory (PITR) on top of the full backup, point-in-time restore
  tested.
- The profile is decided at Gate 1 and reassessed at each cycle.
- **Changing profile = Ansible and inventory, never code**; moving to
  reinforced moves the database (`pg_dump` / `pg_restore`), announced
  downtime.
- **Every tool is stateless** in its process (sessions and counters in the
  database, files on a declared volume), to move to two instances without
  a rewrite.

## Rejected alternatives
- N1/N2/N3 levels with different stacks or kits — recreate the rewrite at
  each step up; three variants of template, CI and rules are two too many
  for operation by a single person.
- "Stateless" for the reinforced profile only — a tool that changes
  profile would have to be rewritten.

## Consequences
- No rewrite when a tool grows.
- **Accepted costs**: a small tool embeds what it uses little (the
  "richer" part sleeps in the kit); every tool pays for "stateless"
  (session in the database, no local cache, lock in the database against
  the double run of a scheduled task), even if it will never have two
  instances.
- **Two instances on one VM are not high availability**: they cover a
  process crash and progressive deployment, not a VM or host failure; cost:
  one Node process (about 100 MB, order of magnitude not measured).
- **PostgreSQL remains a single point of failure** (one database per VM,
  no replica): RPO and RTO depend on the backup. Standard: up to 24 h lost;
  reinforced: a few minutes, at the price of storing the logs and a longer
  restore.
- Changing profile costs downtime (seconds to minutes); the off-VM copy
  costs external storage, without which the backup would die with the VM.

## Verification
- A kit test will run two instances behind a proxy: session recognised by
  the other instance, concurrent write detected.
- The profile will be an inventory variable; a change will be proven by
  the inventory, a deployment and the restore of the database, without a
  commit in the tool's repository.
- A real restore test from the off-VM copy will prove each profile; in
  reinforced, point-in-time restore, loss and duration compared with the
  written RPO and RTO.
- The choice of profile is not mechanically checkable (Gate 1, human).
