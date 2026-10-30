---
adr: 014
title: Tool deployer, forced-command SSH to a platform Compose model
status: superseded by ADR-022
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-009]
check: planned
---
## Context
The EupaDev engine deploys every generated tool in three places: the
scoping mock-up (ADR-009), a Preview that the requester judges, then
Prod. A tool's image holds code written by agents, untrusted by principle;
the engine, for its part, is the most exposed part of the platform.
A compromised engine must therefore be able neither to run an image from
elsewhere, nor to get Docker or a shell on a target, and a hostile image
must be locked in. There is no Kubernetes: VMs provided by the IT
department (ADR-001). Facts noted on 2026-10-14: on a VM without
Kubernetes, Kamal and Coolify push over SSH, but as root or with the
`docker` group, and the Docker documentation points out that access to the
socket amounts to root; OpenSSH (sshd(8)) allows, per key, a forced command
(`command=`, the client's request arrives in `SSH_ORIGINAL_COMMAND`), an
imposed source address (`from=`) and `restrict` (no forwarding, no
terminal); Docker Content Trust is retired, nothing checks a signature
outside Kubernetes except an explicit call to cosign; Caddy's internal
authority issues a wildcard certificate and Caddy accepts a placeholder
(`{labels.N}`) in the upstream address, evaluated at each request (local
trial of Caddy 2.11.6). Preview platforms (Vercel, Netlify, GitHub Pages)
serve untrusted content under a separate domain listed on the Public
Suffix List: otherwise a Preview can set cookies on the parent domain,
which `SameSite` does not block. Sources:
`docs/reflexions/2026-10-14-note-e5-deployeur.md` (state of the art, sources),
`ROADMAP.md` §8.16 (decision M3 of 2026-10-13).

## Decision
Deploy the tools through a forced-command SSH connection to a platform
script, which runs only signed images, by digest, in a Compose model fixed
by the platform, behind a generic Caddy.
- **Access**: dedicated SSH key of the engine, accepted only from the
  engine VM, on an account outside the `docker` group, with `restrict` and
  a forced `sudo -n` command to a single script; a single sudo rule, that
  script without arguments (the request goes through `SSH_ORIGINAL_COMMAND`).
  Key files owned by root. The engine itself stays deployed by Ansible.
- **Script** (EupaDev code, the same on every target): commands
  `deploy`, `stop`, `remove`, `served`; line split without a shell,
  every argument validated by a strict pattern before any action;
  environments limited to those of the VM; tool name bounded (40 characters)
  and outside the platform's reserved names; image accepted only as
  `<configured registry>/eupadev/<tool>@sha256:<64 hex>` (the
  registry is never an argument). Every call writes to `journald`.
  `flock` lock per (environment, tool), state read from Docker (labels),
  no state file: every command can be replayed. `stop` and `remove`
  only touch what the calling cycle deployed.
- **Signature**: cosign checked by the script before the download, with
  a **key specific to the tools**, distinct from the one of the platform's
  images (engine, agents).
- **Platform Compose model**: the target never reads the tool's Compose or
  Dockerfile. It runs the image in a fixed model: non-root, read-only
  filesystem, no capability, `no-new-privileges`, memory, CPU and process
  caps, no published port or host volume, internal network without egress,
  one network per Preview.
- **Routing**: a single generic Caddy block per VM, `*.preview.<domain>`
  to the container `preview-<tool>` and `*.<domain>` to `prod-<tool>`,
  the name coming from the requested host; one wildcard certificate per
  block; no Caddy file written by the script, no reload, administration
  API off.
- **Places**: mock-up and Previews on the CI VM, Prod on a dedicated
  "tools" VM, never next to the Previews or the agents' code. In the
  lab, this VM has 2 vCPU and 2 to 3 GiB.
- **Prod without downtime**, the way Kamal does it: the new version starts
  alongside, gets traffic only once healthy, then the old one is drained and
  stopped; if the new one fails, the old one never stopped serving. The
  previous version stays stopped in place for a rollback. Preview: plain
  replacement.
- **`served` field**: on a failure, the answer gives the attempted digest
  and, separately, the one still answering; "healthy" means that the
  returned digest is the one served.
- **Previews**: no automatic time to live; a quota of Previews per VM,
  refusal beyond it with the reason. The tool's cycle decides their removal.
- **Preview domain**: session cookies with the `__Host-` prefix mandatory
  in the tool template; a separate domain for the Previews and the mock-up
  is recommended, not required, in the client's prerequisites sheet.

## Rejected alternatives
- Kamal, Coolify — root access or Docker socket on the target.
- Komodo, Portainer — an agent with Docker access on each target.
- Dokploy — proprietary part. Watchtower — archived, follows tags.
- "Pull" model (Argo CD, Flux, doco-cd) — a root agent per target, and
  writing to the deployment repository becomes the right to deploy;
  doco-cd remains the fallback for a client without inbound connections.
- Running the tool's Compose — an agent could ask for `privileged`, the
  Docker socket or a port.
- One Caddy file per tool, then a reload — configuration produced from
  arguments, for the same result.
- Prod on the CI VM — one same kernel for unapproved code and Prod.
- Time to live of the Previews — the cycle already drives their life; the
  quota bounds the space.
- Separate domain required — not every client can get one.
- A single signing key — a CI that builds agent code could sign an
  engine image.

## Consequences
- A compromised engine can deploy, stop or remove images signed by the
  tools' CI, nothing else: no other registry, no shell, no Docker, no
  environment of another VM.
- A hostile image runs non-root, without capabilities, without write
  access or network egress, capped, isolated from the other Previews; on
  the CI VM, already the zone of unapproved code.
- One more VM in the lab and at the client; internal wildcard DNS and
  certificate needed (`*.preview.<domain>`, `*.<domain>`).
- **Limit**: without a separate domain, a Preview stays *same-site* with
  the forge and Prod; `__Host-` protects the tools' cookies, not those of
  Gitea, which stays exposed: to be told to the client.
- **Limit**: no sign-in in front of the Previews before the identity
  provider arrives; they can be reached only from the internal network.
- **Limit**: fixed SSH key, regenerated by the installation; no
  short-lived SSH certificates.
- A forgotten Preview holds a quota slot until the admin's decision.
- The engine's `Deployer` contract gains the `served` field.

## Verification
- A real test `verify-deployer-access.yml` will prove, with the engine's
  key, that shell, injection, path, environment of another VM, reserved or
  too long name, image by tag or from another registry, forwarding, scp and
  sftp are refused, that the same key is refused from another VM, that the
  account is outside the `docker` group with a single sudo rule, and that
  every call is in `journald`; unit tests of the script will replay the
  input validation.
- A real deployment test will refuse an image that is unsigned, signed by
  another key or by the platform key; will check the model (non-root,
  read-only, without capabilities, without network egress), idempotence,
  the quota, resuming after an abrupt stop of the script, `remove` without
  effect on another cycle, and that the `served` command reads the real
  digest.
- A real switch test will send continuous requests during a Prod
  deployment (no error answer expected) and an unhealthy version (the old
  one still serves, `served` field filled in).
- The template's tests will refuse a session cookie without `__Host-`.
- Not mechanically checkable: the separate domain at the client, and the
  completeness of the Compose model against a new Docker option
  (review).
