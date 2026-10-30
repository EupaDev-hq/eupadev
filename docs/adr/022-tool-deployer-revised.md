---
adr: 022
title: Tool deployer, forced-command SSH to a platform Compose model (revision of ADR-014)
status: accepted
date: 2026-10-21
decision-makers: Ilan
supersedes: ADR-014
related: [ADR-009, ADR-015, ADR-019]
check: partial
---
## Context
The EupaDev engine deploys every generated tool three times: the scoping
mock-up (ADR-009), a Preview that the requester judges, then Production.
A tool image holds code written by agents, untrusted by principle; the
engine is the most exposed part of the platform. A compromised engine must
not run an image from elsewhere, nor get Docker or a shell on a target, and
a hostile image must stay locked in. There is no Kubernetes: VMs provided by
the IT department (ADR-001). Facts (2026-10-14): Kamal and Coolify push over
SSH but as root or with the `docker` group, which equals root; OpenSSH
offers per-key forced commands, `from=` and `restrict`; nothing checks a
signature outside Kubernetes unless cosign is called explicitly; Caddy
evaluates a placeholder (`{labels.N}`) in the upstream address at each
request, so one generic block routes every tool without reload.
ADR-014 decided this design on 2026-10-14. Since then: tools built on the
core (ADR-019) need a PostgreSQL database with a migration step run by the
same image, and egress to the identity provider only; the engine already
treats a failed deploy as "attempted digest, failure", so ADR-014's extra
`served` field is not needed; Ilan's decisions of 2026-10-21 (D-E1 to D-E6)
cut the per-cycle mock-up alias and the kept stopped Prod container. The
Preview path was built and measured on the lab on 2026-10-21 (deploy of a
small image ≈ 2 s; a call killed mid-way then replayed converges). Sources:
`docs/reflexions/2026-10-14-note-e5-deployeur.md`,
`docs/reflexions/2026-10-21-note-e5-refresh.md`.

## Decision
Deploy tools through a forced-command SSH connection to one platform
script, which runs only digest-pinned images signed with the tools key, in a
Compose model fixed by the platform, behind a generic Caddy.
- **Access**: dedicated engine key, accepted only from the engine VM, on an
  account outside the `docker` group, with `restrict` and a forced
  `sudo -n` to one script without arguments (the request comes in
  `SSH_ORIGINAL_COMMAND`). The engine checks the targets' host keys
  strictly; key and host keys are encrypted at rest on the engine VM.
- **Script** (same on every target): `deploy`, `stop`, `remove`,
  `served`; line split without a shell, every argument matched by a strict
  pattern before any action; image only as
  `<configured registry>/eupadev/<tool>@sha256:<64 hex>`; one `flock`
  per (environment, tool); state read from Docker labels, no state file;
  `stop` and `remove` only touch what the calling cycle deployed. Exit
  code 2 = refusal (never retried by the engine), 255 = SSH failure
  (bounded retry, safe because every command converges).
- **Signature and pull**: cosign checked with the **tools key** (distinct
  from the platform key) before the pull. The target reads the registry
  with a durable read-only token of its own, encrypted at rest and
  decrypted for one call only.
- **Compose model**: never the tool's Compose or Dockerfile. Non-root,
  read-only root filesystem, no capability, `no-new-privileges`, memory,
  CPU and process limits, no published port, no host volume, one internal
  network per tool without the bridge address. Egress, when a tool needs
  the identity provider, only through a per-VM Smokescreen allowing that
  host. A core tool gets its database on the VM's PostgreSQL, created by
  the script, and its migration runs first as a one-shot service of the
  same image.
- **Routing**: one generic Caddy block per VM (`*.preview.<domain>` →
  `preview-<tool>`, `*.<domain>` → `prod-<tool>`), no file written by the
  script, no reload, admin API off; the Preview block strips `Domain` from
  every `Set-Cookie` (ADR-015).
- **Places**: mock-up and Previews on the CI VM, Prod on a dedicated tools VM.
- **Preview**: plain replacement; a quota per VM, refusal beyond it with the
  reason; no automatic time to live, the tool's cycle removes it.
- **Prod**: the new version starts beside the old one and gets traffic only
  once healthy; on failure the old one never stopped serving and the answer
  is the attempted digest with `failed`. Rollback = redeploy the previous
  digest (still local, or in the registry). No stopped copy kept, no
  zero-error load proof.
- **Answer**: `health: ok` ⇒ `digest` is the digest actually served
  (RepoDigests of the running image); `failed` ⇒ the attempted one.
- **Mock-up** (amends ADR-009): static files of the `web/` folder only, no
  per-cycle alias; the engine mails the digest link at every mock-up.

## Rejected alternatives
- Kamal, Coolify — root or Docker socket on the target.
- Komodo, Portainer — an agent with Docker access on each target.
- Pull model (Argo CD, Flux, doco-cd) — a root agent per target; doco-cd
  stays the fallback for a client without inbound connections.
- Running the tool's Compose — an agent could ask for `privileged`, the
  Docker socket or a port.
- One Caddy file per tool and a reload — configuration produced from
  arguments, for the same result.
- A throwaway registry token per Ansible run on the target — deploys happen
  at any time, outside Ansible.
- A kept stopped Prod container, a 30 s drain, a zero-error load test —
  redeploying the previous digest gives the same rollback with less code;
  a few seconds of overlap are acceptable for internal tools.
- A per-cycle mock-up alias — the engine already sends a fresh link.
- The `served` field — W1 records an unhealthy new Prod as a plain failure.

## Consequences
- A compromised engine can deploy, stop or remove images signed by the
  tools CI, nothing else: no other registry, no shell, no Docker, no
  environment of another VM.
- A hostile image runs non-root, without capabilities, write access or
  egress (except the identity provider through Smokescreen for core
  tools), capped and isolated from other Previews.
- One more VM and wildcard DNS and certificates at the client.
- Limit: without a separate Preview domain, a Preview stays same-site with
  the forge (ADR-015).
- Limit: fixed SSH keys, regenerated by the installation; no short-lived
  SSH certificates.
- Limit: a forgotten Preview holds a quota slot until removed.
- Limit: during a Prod switch, old and new versions both answer for a few
  seconds; migrations must be expand/contract.

## Verification
- `verify-deployer-access.yml`: shell, injection, other environment,
  reserved or long name, tag or foreign registry, forwarding, scp and sftp
  refused; key refused from another VM; one sudo rule; journald entries.
- `verify-deployer.yml`: unsigned, other-key and platform-key images
  refused with nothing started; model applied (uid, read-only, no
  capability, no port, no host mount, no egress); same digest twice touches
  nothing; another cycle has no effect; `Domain` stripped; killed script
  replayed converges; full removal; the same calls made by the engine's
  `SshDeployer` from the engine image.
- Unit tests of the script (`test_deployer.py`) and of `SshDeployer`, with
  mutations (served digest, refusal not retried, strict host keys).
- A Prod switch test will check that an unhealthy image leaves the old one
  serving and that a previous digest redeploys without download; a core
  test will check database creation, migration failure and egress refusal.
- Not mechanically checkable: completeness of the Compose model against a
  new Docker option (review).
