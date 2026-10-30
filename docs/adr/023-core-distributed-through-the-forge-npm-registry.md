---
adr: 023
title: Core distributed through the forge's npm registry
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-016, ADR-019]
check: planned
---
## Context
ADR-019 (accepted) makes `@eupadev/core` the common base of every
generated tool and, in its *Distribution* point, ships it as a protected
archive `vendor/eupadev-core-<version>.tgz` in each tool repository,
referenced by `file:` and checked by CI, "never the forge's registry". It
rejected the forge's npm registry because the agents could not reach it:
their containers go out only through Smokescreen, which allows
`registry.npmjs.org` and refuses private addresses even behind an allowed
name, and they carry no token. The archive costs a copy per tool, a byte
check and a maintenance script to roll a new core out.

Gitea, our forge, has a built-in npm registry
(`https://<forge>/api/packages/<org>/npm/`). Checked on Gitea 28.1.0 (the
lab's version) on 2026-10-22: a version is never overwritten (republication
answers 409); reading needs a member badge with `read:package` (anonymous and
non-members get 401); a `read:package` badge cannot publish (401); the
tarball URL has the npmjs shape, and pnpm 12 writes it into the tool's
lockfile with its integrity. pnpm 12 also refuses, even with
`--frozen-lockfile`, a version published less than 24 hours ago (default
`minimumReleaseAge`). Gitea has no per-package right: a package belongs to
an owner, and writing is granted per owner (owners, or teams whose packages
unit writes; docs "Packages, Access Restrictions", issue go-gitea/gitea#19270,
`services/context/package.go` in v28.1.0), so the tools' write badge (it
publishes their images) could publish `@eupadev/core` in `eupadev`.
The npm scope is not compared to the owner (`/api/packages/{owner}/npm/`,
`modules/packages/npm/creator.go`): checked locally, a `@eupadev/core`
published under another owner is accepted there. A "limited" organisation is
readable by any signed-in account. Renovate, used for dependency updates, supports
a private npm registry through host rules. Installing private packages
before an agent starts, with the secrets gone when it does, is the documented
pattern of hosted coding agents (OpenAI Codex setup scripts, GitHub Copilot
`copilot-setup-steps.yml`, Claude Code cloud setup scripts); pnpm documents
`pnpm fetch` (packages from the lockfile alone, into the store) followed by an
offline install (https://pnpm.io/cli/fetch). None documents an internal
registry behind an egress proxy with a badge the agent never sees: a local
trial (Gitea 28.1.0, pnpm 12.9.1) showed that a store filled by `pnpm fetch`
in another container lets a container without any route to the forge run
`pnpm install --frozen-lockfile`, with the badge nowhere in its files.
Detail and sources: `docs/reflexions/2026-10-22-note-socle-registry.md`.

## Decision
Distribute the core through the forge's npm registry, at an exact version
per tool; this replaces the *Distribution* point of ADR-019 (and its rejected
option "forge npm registry"), the rest of ADR-019 stands.
- **Owner**: the core is published under its own organisation
  `eupadev-core` (limited), whose only member with package write is the
  robot `svc-core`; `svc-core` is in no team of `eupadev`.
- **Publication**: a `core` platform repository whose pipeline tests the
  core, then publishes the version of its `package.json` unless it already
  exists. Badge of `svc-core` (`write:package`), stored in the secrets of
  that repository only, never in the organisation's.
- **Reference**: the tool's `package.json` names `@eupadev/core` at an
  exact version; its lockfile resolves it from the forge's registry only
  (integrity, tarball under `/api/packages/eupadev-core/npm/`, the scope
  registry of every consumer: CI, image build, launcher, Renovate). No `vendor/`
  archive, no `file:` reference.
- **Tool CI**: the read-only badge (`read:package`) is given only to the
  steps that install, in a temporary pnpm user config keyed by the
  registry's address; never to the step that runs the agent's code. The
  image build receives it as a BuildKit secret, never in a layer.
- **Release age**: the template's protected `pnpm-workspace.yaml` exempts
  `@eupadev/core`, and only it, from pnpm's minimum release age.
- **Updates**: Renovate proposes each new core version as a branch tested by
  the tool's CI, never merged automatically. Decision A (Ilan, 2026-10-27,
  after cycle 43 lost a round to a mid-task bump by the builder): at the
  start of each **evolution** cycle, before any agent works, the platform
  itself moves the tool to the latest published version (engine side, in a
  container like the fetch one: read badge, route to the registry, `pnpm add
  @eupadev/core@latest --lockfile-only`; the forge commits the two files
  into main, `[skip ci]`). Only the core entry changes; already on the
  latest version → no commit; registry unreachable → the cycle goes on with
  its current version, requester and admin told. Accepted trade-off: an
  evolution may carry a core change nobody asked for; the round's tests, CI
  and Preview check it before Prod.
- **Agents' access**: the agents' egress stays unchanged (Smokescreen, no
  private address, no badge in a task container). Before an agent that
  installs dependencies starts on a tool whose lockfile names the core, the
  launcher checks that lockfile (registry resolutions only, tarballs only
  under the forge's registry) and runs `pnpm fetch` in a separate
  short-lived container: same verified agent image and hardening, its own
  network with a direct route to the forge, a dedicated read-only badge on
  its stdin only. It fills the pnpm store of the task's volume; the agent
  then installs from it, the forge being unreachable for any other core
  version. A fetch failure stops the task with a clear message.
- **Migration tool**: `node-pg-migrate` is a runtime dependency of the
  core (Ilan, 2026-10-21, step-9 note), the same image running
  `bin/migrate.js` before traffic switches; this replaces "node-pg-migrate
  outside the web image" in ADR-019's *Allowed dependencies* point. The
  production package cap checked by `core.yml` goes from 85 to 95 (91
  measured with node-pg-migrate and `pg`, 2026-10-24).

## Rejected alternatives
- Archive `vendor/*.tgz` per tool (ADR-019) — a copy, a byte check and a
  roll-out script per tool, where a registry gives immutability and Renovate
  updates for free.
- Core inside the golden image — the core version would follow the image's
  weekly rebuild instead of the tool's lockfile.
- Public `registry.npmjs.org` now — publishes before the project is public;
  stays possible at publication.
- Publication badge in the organisation's secrets — every tool pipeline
  would receive it.
- A dedicated publishing robot inside `eupadev` — the tools' write badge
  would still publish the core (rights per owner, not per package).
- Forge reachable from the agents (Smokescreen allowing its private
  address, badge in the task container) — what ADR-019 refused; an agent
  could read every package of the organisation.
- Verdaccio (ADR-016) proxying the forge for `@eupadev/*` — a second
  upstream and a badge in a long-running service, for one package.
- Agents never installing the core (CI only) — the builder could not run the
  tests it writes against the core.
- Keeping the 24-hour minimum release age for the core — it guards against
  compromised public packages; the core comes from our own CI, and the delay
  would turn every tool's CI red for a day after each release.

## Consequences
- One copy of each core version, immutable; a tool changes version by a
  reviewed lockfile change, like any dependency.
- Lockfiles carry the forge's domain: a tool moved to another installation
  regenerates its lockfile.
- An agent installs the core version of its task's base only; changing
  that version is a reviewed lockfile change made outside the agent (its
  install fails clearly). The fetch container fetches the whole lockfile
  through a direct route, outside Smokescreen: its requests are limited to
  the registries the checked lockfile names.
- Only `svc-core`, the owners of `eupadev-core` and the forge's site
  administrators can publish a core version (accepted: they administer the
  forge anyway). A fake `@eupadev/core` published under `eupadev` by
  a tool pipeline is never installed: the scope registry names the core's
  owner, and guard G4 refuses a lockfile resolving it elsewhere.
- A second organisation to administer; its name is fixed by convention
  (`<org>-core`), pipelines derive it from their repository.
- Renovate must run against the forge for updates to be proposed; until
  then, core updates are manual lockfile changes.
- The registry is in the forge's backup (`gitea dump` includes packages).

## Verification
The core pipeline will fail on a failing test and will skip, without error,
a version already published; Gitea refuses any overwrite (409).
`verify-core.yml` will check, on the lab: green pipeline; version present
with a tarball under the forge's registry; read badge reads but cannot
publish; anonymous read refused; republication refused (409); publication
badge present in the `core` repository's secrets and absent from the
organisation's; rerun green without publishing; `svc-core` member of no
team of `eupadev`; the tools' write badge refused under the core's
owner; a fake published under `eupadev` never served by it. In each
tool's CI, guard G4 (`.gitea/checks/package.mjs`, guard-rails job) will
refuse a core reference that is not an exact version or not resolved from
`/api/packages/eupadev-core/npm/`. In the engine's tests (fake Docker), the fetch container will run
before the agent's, the badge will appear only on its stdin, a failed fetch
will stop the task with the badge masked, and a lockfile with a tarball
elsewhere will be refused before any container; one mutation per rule.
Not mechanically verifiable: that no future workflow hands the
read badge to a step running agent code (review of the protected `.gitea/`).
