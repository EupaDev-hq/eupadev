---
adr: 012
title: Forge, stay on Gitea while keeping the door open to Forgejo
status: accepted
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-007, ADR-008]
check: partial
---
## Context
The forge hosts the tools' repositories, their CI and their registry, and
carries the governance guard-rails (an agent does not merge alone, does not
weaken a gate, does not touch the check files; every exception goes through
a designated human). It is Gitea 28.1.0 (MIT) with Gitea Runner 5.0.0.
Forgejo, a community fork (Codeberg e.V., GPLv3 since its v9), was compared
on 2026-10-13 by reading the code of both forges, on the fifteen features
used: ten identical, one renamed, one partial, and four missing from
Forgejo, all about governance — the **Bot account** (token only, no
interactive login), the **audit log** `audit_event` (protections, tokens,
teams), the **named bypass** (a non-administrator human merges a PR that
touches a protected file) and the **explicit order of protection rules**
(`priority`, which Forgejo loses when generating from a template). The rest
carries over without loss. Forgejo offers a 15-month LTS and a sovereignty
argument; Gitea has only a paid LTS, fixes only its latest version,
publishes many security advisories (including a flaw exploited in 2026),
but the flaws of the common code hit both, and Forgejo fixed a critical one
months after Gitea. No direct upgrade from a recent Gitea to Forgejo:
switching = reinstalling and porting the recipes. Sources:
`docs/reflexions/recherche-2026-10-13/recherche-forgejo-gitea.md`,
`docs/reflexions/2026-10-13-adr-details.md`.

## Decision
Keep Gitea as EupaDev's forge, and depend on Gitea only where Forgejo
offers no equivalent, with a documented fallback for each dependency.
- **Forgejo fallbacks**: Bot → ordinary account with a discarded random
  password (login possible if it leaks); audit → scheduled drift check
  through the API (protections, teams, tokens) and proxy logs, without "who
  did what"; named bypass → the human becomes administrator of the
  repositories, or the instance administrator decides; `priority` → the
  orchestrator recreates the `**` rule after generation;
  `EGRESS_MODE=strict`, `block_admin_merge_override` and `docker_host` →
  their Forgejo equivalents (list in the detail note).
- **Common ground first**: the orchestrator's "forge" contract uses only
  routes and settings present in both; the workflows use
  `${{ github.* }}`, not `${{ gitea.* }}`.
- **Licence**: Forgejo's GPLv3 is neither AGPL, nor SSPL, nor BSL
  (ADR-007); a forge run alongside, talked to over HTTP and Git: a switch
  would remain allowed.
- **Follow every version quickly** of Gitea and its runner, majors
  included, for lack of a free LTS.
- **Re-evaluate** if: Gitea changes licence or removes a used feature from
  the free edition; a client requires Forgejo; Forgejo ships audit and named
  bypass; Gitea's majors become too frequent or too breaking for one person;
  the lack of LTS becomes blocking; an exploited critical flaw remains
  without a Gitea fix 14 days after its exploitation is made public (listing
  in CISA's KEV, for example). 14 days: deadline imposed by CISA on US
  government agencies (BOD 22-01) and twice Gitea's observed pace.

## Rejected alternatives
- Migrate to Forgejo now — 7 to 10 days of porting, and above all the
  lasting loss of the four governance building blocks.
- Migrate at Forgejo's next LTS — same loss as long as it has neither audit
  nor named bypass: it is a trigger, not a date.
- Gitea Enterprise for the LTS — would tie the appliance to a third-party
  commercial licence.
- Code common to both forges right now — double maintenance for a switch
  with no date; the list of fallbacks is enough to cost it.

## Consequences
- The four governance building blocks remain available and provable.
- No LTS: every version, breaking majors included, is applied quickly;
  automatic version tracking gives them priority.
- Dependence on a company (Gitea Ltd); the observed movement goes from
  Enterprise to the free edition (audit arrived in free Gitea 28).
- The audit is read in SQL from `audit_event` (no free REST API): a schema
  change can break this reading.
- A switch remains costed (7 to 10 days), known traps (`docker_host`
  inverted, order of rules, configuration moved in v15), with no new licence
  obligation.

## Verification
- `infra/ansible/verify-forge.yml` proves on the real forge that the
  service accounts are of Bot type and that token creation is recorded in
  `audit_event`; a Gitea version that removed either one makes it fail
  (first re-evaluation trigger).
- Quick tracking will rely on Renovate, once its app is installed:
  `renovate.json` makes Gitea, Gitea Runner and the image of its jobs a
  group proposed as soon as they are released; each PR, reviewed and merged
  by a human, will be proven by the lab's `verify-*`. Without the app,
  nothing goes out.
- Not mechanically checkable: the exclusive use of common routes, that of
  `${{ github.* }}` and the triggers (including the 14 days); review at each
  Gitea major and at each critical advisory.
