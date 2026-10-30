---
adr: 007
title: Licences, no embedded AGPL, SSPL or BSL component
status: accepted
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-010]
check: planned
---
## Context
EupaDev will be published as open core under Apache 2.0, installed at
clients' sites, perhaps resold. Some licences are incompatible with that: the
**AGPL** requires distributing the work that integrates the component under
AGPL and giving the code of a modified version to its network users; the
**SSPL** extends the obligation to all the software that serves the
service; the **BSL** forbids some uses (often competing commercial use)
until a switch to a free licence years later. These obligations arise
mostly when the component is **embedded** (redistributed, linked,
modified), not when a separate program is run alongside, without modifying
it.

## Decision
Never embed in EupaDev an AGPL, SSPL or BSL component, nor the
components listed below; such a component remains tolerated if it is run
alongside.
- **Embedded = forbidden**: in the repository or a shipped image, a
  dependency of our code, or a modified version.
- **Run alongside = tolerated**: a separate program, unmodified, on the
  command line or as a separate service (k6, Renovate in the CI), or a tool
  of the lab only, never shipped.
- **Never embedded, whatever their licence**: an ITSM (GLPI, iTop,
  Zammad); Claude Code or Anthropic's Agent SDK (commercial terms); the
  official Semgrep rules (forbidden in a resold product).
- **Claude Code**: never in an image shipped by EupaDev; the launcher
  image is built by the client's forge, which downloads it from npm,
  accepts the terms and provides its key. The repository contains only this
  Dockerfile.
- Each new component is checked (licence and terms of use) when it is
  adopted.

## Rejected alternatives
- Semgrep and its official rules — replaced by Opengrep (LGPL, same format)
  with our own rules.
- Zitadel — AGPL since v3; Keycloak (Apache 2.0) chosen.
- SonarQube in the agents' loop — its licence excludes the analysis of its
  results by an outside AI.
- Also forbidding AGPL run alongside — would deprive the CI of k6 or
  Renovate for an obligation that does not apply to this use.

## Consequences
- The repository stays under Apache 2.0, installable without a hidden
  obligation.
- The "embedded / alongside" boundary requires a judgement at each
  adoption: a tolerated tool becomes forbidden again as soon as it enters a
  shipped image or is modified.
- The lab's tools (LXD under AGPL, Terraform under BSL) are allowed;
  replacing them is a matter of other reasons (ADR-010).
- A licence can change with a new version (LXD, Terraform and Zitadel have
  done it): an update can tip an adopted component over.

## Verification
- In the repository's GitHub CI, Trivy will scan the licences
  (`trivy fs --scanners license`) with an allow-list: any dependency
  outside the list will fail the CI.
- The images published by EupaDev will be analysed before publication:
  the presence of `@anthropic-ai/claude-code` will fail the publication.
- The scan sees only declared licences; the terms of use (Claude Code,
  Semgrep, Sonar) and the "embedded / alongside" boundary cannot be checked
  mechanically: human review at each adoption.
