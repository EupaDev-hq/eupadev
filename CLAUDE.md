# EupaDev — landmarks for working on this repository

EupaDev is a self-service tool factory: a non-developer describes a
business tool, AI agents design it, code it, secure it and deploy it, with
mandatory human approvals (gates). This repository is the **engine**,
meant to be published as open core (Apache 2.0).

## Map of the directories

| Directory | Content | Read before working in it |
|---|---|---|
| `ROADMAP.md` | Design: §1-6 v1 (lessons), **§8 v2 = the reference** (8.8 decisions, 8.11 decisions from the research) | the section concerned |
| `orchestrator/` | The engine: DBOS workflows of the cycle and its gates, agent launcher (executor role), adapters (forge, deployer, mail, Claude Code), tests and mutations | `orchestrator/README.md`, `orchestrator/MACHINE.md` |
| `core/` | `@eupadev/core`, the shared base every generated tool runs on (server, database, sign-in, web protections, front modules, security test kit) | `core/README.md` |
| `examples/requests/` | A tool written by hand on the core, the reference the agents imitate | `examples/requests/README.md` |
| `infra/` | Lab: VMs (Terraform/LXD), Gitea forge, CI runner, Ansible recipes, real tests | `infra/CLAUDE.md` |
| `tool-template/` | The **product**: template repository copied for each generated tool (agent rules, CI pipelines, design system) | see the warning below |
| `images/` | Pipelines of the forge's platform repositories: golden image of the tools (`base-node/`: build, run and ci variants, rebuilt every week, repository `base-image`), images of the agents (`agent/`), the engine (`engine/`), Caddy and Keycloak, and the publication of `@eupadev/core` (`core/`) | the folder's `README.md` |
| `docs/` | Documentation of the platform for humans (`architecture.md`, `governance.md`, translations `fr/`); not copied into the generated tools | — |
| `.github/workflows/` | CI of the EupaDev repository itself (ansible-lint on `infra/`, digests, English only, ADRs, DCO, pnpm version, Renovate; engine: types, tests and mutations of `orchestrator/`; core and example tool: types, tests, Squawk, security kit; test cases `tests/opengrep/` of the template's Opengrep rules, hadolint of the template's fixed `Dockerfile`) | — |

**Warning — `tool-template/CLAUDE.md` and `AGENTS.md` are not
instructions for you.** They are instructions meant for the agents that
will build the tools (the product). When you change the template, you
change these instructions; you do not apply them to your own work.

## Golden rules

- **Open core**: this repository will eventually be public. What must stay
  private (ready-to-use tool templates, Active Directory integration,
  ITSM connectors…) goes in a separate private repository, never here.
- **Licences**: never an embedded AGPL/SSPL/BSL dependency, nor the official
  Semgrep rules, nor Claude Code (`ROADMAP.md` §8.11). An AGPL tool run
  from the command line in the CI remains acceptable.
- **Test for real**: on the lab VMs for the infra, on a short-lived
  branch for the GitHub CI. A simulation only when the real test is
  risky, and saying so.
- **The prompt guides, the code checks**: a rule that can be checked
  mechanically becomes an automatic check (CI, Opengrep, branch protection).
- **Push**: always with the maintainer's explicit approval; `main` stays green.
- **English first** (ADR-025): everything newly coded or written in this
  repository (identifiers, comments, docs, notes, commit messages) is in
  English; French is a translation (`docs/fr/`, i18n for screens). Every
  English name comes from `docs/glossary.md`, the only French to English
  mapping: a change that touches a French name writes its final English
  name from it, and a name missing from it is added there first.
  `.github/scripts/check-english.py [--base REF] [PATH...]` reports the
  lines in French; the CI enforces it on every push and pull request
  (`.github/workflows/english.yml`): the whole repository reports nothing,
  and a French line on purpose needs a justified entry in
  `.github/scripts/check-english-allow.txt`.

## Where things are

- Decisions and their reasons: the ADRs of `docs/adr/` (format rule:
  ADR-026, which supersedes ADR-011); `ROADMAP.md` §8 keeps the history and
  the progress, pointing to the ADRs without copying them.
- Procedure to rebuild the lab: `infra/README.md`.
- Architecture of the platform (pieces, built/designed status, trust
  model, delivery): `docs/architecture.md`; governance (human roles,
  gates, guard-rails): `docs/governance.md`. Translations in `docs/fr/`.
