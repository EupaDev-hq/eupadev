---
adr: 010
title: Lab on Incus and OpenTofu before publication
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-007]
check: planned
---
## Context
The development lab runs on one machine: LXD 5.21 VMs (Canonical snap)
created by Terraform (provider `terraform-lxd/lxd`), configured by Ansible,
rebuildable from scratch. Its recipe will be part of the published
repository: it is the one a contributor will follow. LXD moved from Apache
2.0 to AGPLv3 with a Canonical CLA (5.20, December 2023); its fork Incus
(Apache 2.0, 7.0 LTS until June 2031, provider `lxc/incus` under MPL 2.0)
is followed by the community ecosystem, but rests on a small team, whereas
LXD has Canonical behind it. Terraform has been under BSL since 1.6 (August
2023); OpenTofu (MPL 2.0, Linux Foundation) reads the same files. The
licence rule (ADR-007) tolerates a lab-only tool: **the licence alone does
not force a change**. At a client, the IT department provides the VMs
(ADR-001): neither LXD nor Incus. Source:
`docs/reflexions/recherche-2026-10-12/recherche-forge-labo.md`.

## Decision
Move the lab from LXD to Incus and from Terraform to OpenTofu, in a single
piece of work, before the repository is published.
- By rebuilding from the code (OpenTofu creates the Incus VMs, Ansible
  configures them, the backups are restored), not by `lxd-to-incus`.
- Tied to publication, not to the first client.
- `infra/terraform` becomes `infra/tofu` in the same piece of work: the
  directory names the real tool, and the check does not have to tolerate a
  stale name.

## Rejected alternatives
- Keep LXD and Terraform — allowed, but two single-vendor tools that have
  already changed licence, and a bad signal in the public recipe.
- Convert in place (`lxd-to-incus`) — does not prove the rebuild from
  scratch, which publication must guarantee.
- Do it before the first client — no effect at the client (VMs provided).

## Consequences
- **Honest reason**: not the licence, but longevity and the signal of a
  public repository. The risk "a vendor changes the rules" is traded for "a
  small team stops"; this second risk can be monitored (release pace,
  contributors) and going back remains a change of provider.
- Why not the tolerance granted to k6 or Renovate (AGPL, run alongside):
  Incus and OpenTofu are near-identical forks, cheap to adopt; replacing k6
  or Renovate would change tool and method.
- Rewrite of `infra/tofu` (`incus_*` instead of `lxd_*`), of the paths that
  cite it and of the procedure (`infra/README.md`), full rebuild.
- The trap "Docker's firewall cuts the VMs off from the Internet" must be
  retested: Incus uses nftables.

## Verification
- A full rebuild of the lab from scratch (OpenTofu, Ansible, restore),
  followed by the `verify-*` workflows (forge, CI, backups), will prove the
  change.
- A pattern check in the GitHub CI will refuse, in `infra/`, what runs the
  old tools: provider `terraform-lxd/lxd`, resources `lxd_*`, a call of the
  `terraform` binary at the start of a command, installation of the `lxd`
  snap; not the word "terraform" in general (state, `terraform {}` block
  kept by OpenTofu, documentation).
