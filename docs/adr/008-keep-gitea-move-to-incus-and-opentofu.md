---
adr: 008
title: Keep Gitea (not Forgejo), move to Incus and OpenTofu before publication
status: rejected
date: 2026-10-12
decision-makers: Ilan
supersedes:
related: [ADR-007, ADR-010]
---
## Context
The forge is Gitea 1.27.3 and the lab runs on LXD 5.21 with Terraform. LXD
moved from Apache 2.0 to AGPLv3 with a Canonical CLA (5.20) and Terraform
has been under BSL since 1.6 (`docs/reflexions/recherche-2026-10-12/recherche-forge-labo.md`;
`ROADMAP.md` §8.14 C and §8.15, "Forge and lab").

## Decision
Stay on Gitea, and move the lab to Incus with OpenTofu in a single
"free-software lab" project, before publication.
- Gitea (MIT) goes up to 28, which brings bot accounts, an audit log and
  CODEOWNERS approval.
- Forgejo remains pluggable behind the orchestrator's "forge" contract, for
  a client who would require it.
- Incus (Apache 2.0) replaces LXD by rebuilding (IaC), not by
  `lxd-to-incus`; OpenTofu replaces Terraform.
- Order: for a real client, then before publication, after Gitea 28
  (§8.15, work order no. 5).

## Rejected alternatives
- Migrating to Forgejo — direct migration blocked since Gitea 1.23
  (reinstallation and migration repository by repository); GPLv3 since v9,
  which some legal departments are warier of than MIT.
- Keeping LXD — driven by Canonical (AGPL + CLA), the community ecosystem
  (provider `lxc/*`, OpenTofu) has switched to the Incus side; a public
  recipe that requires an AGPL snap is a bad signal for an open-core
  repository.
- Keeping Terraform — under the BSL licence since 1.6 (§8.14 C).

## Consequences
- Rewrite of `infra/terraform` (`incus_*` resources) and rebuild of the
  lab; the Docker/network trap of the VMs to retest with Incus (nftables).
- Re-evaluation point for Gitea: if Gitea Ltd withdraws a feature into its
  Enterprise offering or changes licence.

## Verification
No automatic check to date (the `verify-*` will prove the forge and the
lab after each step).

## Rejection
Rejected on 2026-10-13 as written above (text of the proposal kept, in the
format of the time), for three reasons:
- it joined two independent decisions, the choice of the forge (Gitea
  or Forgejo) and that of the lab's tools (Incus and OpenTofu), which have
  neither the same schedule nor the same degree of certainty;
- it tied the change of the lab to the arrival of a real client, whereas
  at the client's the IT department provides the VMs (no LXD nor Incus) and
  OpenTofu is optional there: this change concerns only the publication of
  the repository;
- the choice between Gitea and Forgejo requires a comparative research that
  this proposal did not contain.

The lab is the subject of ADR-010. The choice of the forge will be the
subject of a separate ADR, after this research.
