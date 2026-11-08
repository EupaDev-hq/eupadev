---
adr: 028
title: One-step installation by a signed, versioned script, in discovery or enterprise mode
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-005, ADR-010, ADR-017, ADR-018, ADR-024]
check: planned
---
## Context
Installing EupaDev today means following the ten numbered steps of
`infra/README.md`: LXD, Terraform, Ansible and its collections on the host,
a dedicated SSH key, `terraform apply`, `init-vault.sh` (random secrets,
the installation's cosign key, the Anthropic key pasted into a file),
`site.yml`, then about fifteen `verify-*.yml` playbooks. The result is a
five-VM lab (forge, CI, orchestrator, AI agents, tools) estimated at 14 to
16 vCPU and 42 to 46 GB of RAM (`docs/deployment.md`); measured on the lab
on 2026-11-08, the five VMs idle use about 4.7 GB of RAM in total, so the
documented figures are the sizes given to the VMs, not what the engine
needs: the obstacle is the number of pieces, not the memory. Every cycle
calls a paid model. That is the right shape for a company, and the wrong
first contact for the open-source launch: someone who wants to see what
EupaDev does cannot give it an afternoon, five VMs and an AI key. The
engine already runs without any of that: in the lab, its adapters (forge,
deployer, agent engine) are fakes unless switched on (`EUPADEV_EXTERNAL`,
`orchestrator_real_world`), and the Gherkin suite drives whole cycles on
the fake engine. Two pieces still stand between a newcomer and that
cycle. Sign-in: the engine refuses every call without a token of its OIDC
issuer (ADR-017, `OIDC_ISSUER` and `OIDC_JWKS_URL` required at startup,
`orchestrator/src/config.ts`), and that issuer is Keycloak, one more
container, a realm to import and an admin console to learn; the tests
already run the whole API against a fake issuer that speaks Keycloak's
protocol (`orchestrator/tests/helpers/fake-oidc.ts`: Keycloak's paths
under a realm, authorization code with PKCE, `typ at+jwt`, audience and
client roles). The image: the images of the platform are signed by cosign
with a key created per installation by `init-vault.sh` (ADR-018,
`images/engine/README.md`) and built by the installation's own forge
(`images/engine/.gitea/workflows/publish.yml`): that key and that forge
do not exist before the installation, so they can sign neither the script
that starts it nor the image it runs. The project is aimed at security
teams: `curl … | sh` as the only entry runs code nobody has seen, which is
the opposite of what the rest of the repository promises.

## Decision
Publish, with each release, one versioned installation script, signed by
the release pipeline, that installs EupaDev in one of two modes.
- **One artefact per release**: `install.sh`, `install.sh.sha256` and
  their Sigstore signatures (`cosign sign-blob`, keyless: the identity is
  the release workflow of the public repository, recorded in the public
  transparency log). No long-lived project key to protect; the
  installation's own key keeps signing the images (ADR-018).
- **Verification first**: `docs/install.md` shows, in this order, how to
  download the script, check its signature against the repository's
  workflow identity and its checksum, read it, then run it. A one-line
  command may be given afterwards for convenience, never as the only path.
- **Discovery mode** (`install.sh discovery`): one machine, Docker
  Compose, the engine with its PostgreSQL, the requester page and a local
  mail catcher, the fake forge, deployer and agent engine; no AI key, no
  cost, about ten minutes. It shows the cycle (request, mock-up, gates,
  Preview, Production) with made-up agents. It does **not** give: real
  agents, their isolation (gVisor, one network per task, egress proxy), a
  separate forge, CI or tools VM, Keycloak, TLS, backups. It binds to the
  loopback address only, refuses a domain or a public address, and its
  page and API carry a visible "discovery, not for production" notice.
- **Discovery sign-in by a local issuer, not Keycloak**: a small OIDC
  issuer derived from the test helper `fake-oidc.ts`, run as one container
  of the discovery Compose file, on the loopback address only. It serves
  Keycloak's layout under one realm (`/protocol/openid-connect/auth`,
  `token`, `certs`, `logout`), the authorization code with PKCE and the
  confidential web client (ADR-024), and issues the access token the
  engine already verifies (ES256, `typ at+jwt`, `aud eupadev-api`,
  `resource_access.eupadev-api.roles`, `email`, `name`). It holds exactly
  two accounts, `requester` and `admin`, one hat each, with passwords
  generated at installation and shown once on the installer's terminal,
  never written to a log; two accounts are what the four-eyes rule of
  Gate 2 needs. **The engine does not change**: `OIDC_ISSUER`,
  `OIDC_JWKS_URL` and the `OIDC_WEB_*` variables point to the local issuer,
  and every rule of ADR-017 (token verified, identity by `(issuer,
  subject)`, hats from the token, 401 and 403) applies as in a company.
  ADR-017 names Keycloak as the only issuer and rejected a temporary local
  issuer because it would be a second identity contract to migrate
  afterwards; this decision is a **scoped exception, for the discovery
  mode only**: the identity contract is the same (same claims, same
  verification code, same hats), the issuer URL was already a per-
  installation setting, and nothing is migrated because a discovery
  installation is thrown away by `uninstall`. Enterprise mode keeps
  Keycloak, ADR-017 unchanged.
- **Discovery runs a published engine image**: the release workflow of
  the public repository (`.github/workflows/release-engine-image.yml`,
  on a `v*` tag only, never on a push, actions pinned by digest per
  ADR-005, permissions `contents: read`, `packages: write`, `id-token:
  write`) builds `orchestrator/Dockerfile`, pushes the image to
  `ghcr.io/eupadev-hq/eupadev-engine`, records its digest and signs it
  keyless with cosign: the identity is that workflow at that tag, the
  certificate issuer is GitHub's token service, the signature goes to the
  public transparency log. The discovery Compose file names the image by
  digest, and the installer runs `cosign verify` against the workflow
  identity before `docker compose up`; a signature that does not verify
  stops the installation. One identity to check, for the script and for
  the image. **Enterprise mode keeps building and signing its own
  images** with the installation's key, on its own forge, without any
  public service (ADR-018 and `images/engine/publish.yml` unchanged).
- **Enterprise mode** (`install.sh enterprise`): today's recipe, driven
  from the host: prerequisites, `terraform apply` when the VMs are to be
  created locally (LXD, ADR-010 rejected the move to Incus), or an
  inventory of VMs provided by the IT department (ADR-001), `init-vault.sh`,
  `site.yml`, the `verify-*.yml` playbooks. Nothing the recipe does today
  is removed or hidden; the script orders it.
- **Both modes**: a prerequisites check that stops before changing
  anything (Docker and its Compose plugin, cosign; or LXD, Terraform or
  OpenTofu, Ansible, free RAM and disk); idempotent (a second run reports
  no change); secrets generated locally, written to files readable by the
  owner only or to the vault, never printed, except the two discovery
  passwords shown once; `install.sh uninstall` removes what the chosen
  mode created, data included after an explicit confirmation, and nothing
  else.

## Rejected alternatives
- A distribution package (apt, brew, snap) — EupaDev is a set of VMs and
  containers configured by Ansible, not a binary; a package would install
  the installer.
- `curl … | sh` as the only path — unseen code at the first contact, no
  version, no signature: a bad signal for a security-first project.
- Signing the script or the published image with the installation's
  cosign key — created by `init-vault.sh`, so it does not exist before the
  installation.
- A long-lived project signing key — one more secret to protect and rotate
  in a public project; a keyless signature names the workflow that made
  the release and anyone can check it in the public log.
- Two scripts (demo, production) — two code paths to keep equal; the
  prerequisites check, the idempotence and the uninstall path are the same
  work in both.
- Discovery mode with real agents and a user-provided key — a first
  contact that costs money and reaches the model's API from an unisolated
  machine; the fakes already exist and show the cycle.
- A hosted demo instead of a discovery mode — a service to run and
  protect; it shows nothing about installing on one's own machines.
- Keycloak in discovery mode — one more container, a realm import and an
  admin console at the first contact, for two accounts that never change.
- Discovery without sign-in — the engine would need a bypass of ADR-017,
  a code path that no company runs and that would have to stay harmless
  forever; the local issuer keeps the engine identical in both modes.
- Building the engine image on the newcomer's machine — ten minutes
  become thirty, and what has to be verified becomes a source tree instead
  of one digest and one signature.

## Consequences
A newcomer sees a cycle in ten minutes without an AI key, without five VMs
and without Keycloak; a security team checks who built the script and the
image before running them, by one identity; the enterprise path stays the
documented recipe, with its own key and no public service. The cost: a
release pipeline to build (image, signatures, checksums), a local issuer
to keep (the test helper plus a sign-in form and two accounts, one more
piece of code that must never listen beyond the loopback), a Compose file
for the discovery mode and a CI job that installs, re-runs and uninstalls
it on every change; the one-liner remains possible and some will use it.
Discovery mode trusts GitHub's token service and Sigstore's public
services for the signatures, which enterprise mode does not; the published
image is public, which an engine meant to be open source accepts.
Discovery mode will be mistaken for the product: its limits are listed in
the docs and on its page, and it refuses a public address; it cannot stop
someone from exposing it behind their own proxy, and the two shown
passwords are then the only lock. Verifying needs cosign installed,
fetched from its own release with its published checksum. To build, in
this order: the release workflow with the keyless signatures of the script
and of the image; the script with its prerequisites check, the two modes
and the uninstall path; the local issuer; the discovery Compose file and
the notice in the engine; `docs/install.md`; the CI job.

## Verification
A GitHub workflow will run the script in discovery mode on a runner with
Docker: install, open the requester page and read the discovery notice,
sign in as `requester` then as `admin` through the local issuer with the
passwords the installer printed, approve one delivery with `admin` (four
eyes), check that the issuer and the engine listen on the loopback address
only, run a second time and check that nothing changed, run `uninstall`
and check that no container, volume or network of EupaDev remains; it will
refuse `discovery` with a domain or a public address, and refuse an image
whose signature does not match the workflow identity. The release
workflow will verify its own signatures and checksums before publishing:
`cosign verify-blob` for the script, `cosign verify` with the workflow
identity and GitHub's certificate issuer for the image; its actions pass
`verify-digests.py` like every workflow of the repository. The engine's
tests keep proving, on the fake issuer, the rules of ADR-017 that the
local issuer relies on. For the enterprise mode, `verify-*.yml` stays the
proof, run by hand on the lab, and `ansible-playbook site.yml` run twice
reports `changed=0`. Not mechanically checkable: that the documentation
shows the verification before the one-liner, that no secret other than
the two passwords is printed by a path the CI did not exercise, and that
the published image is the one the release tag describes beyond what the
signature states.
