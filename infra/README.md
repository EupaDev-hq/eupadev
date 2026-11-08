# EupaDev infra

**Rule: everything that exists on the machines is described here.** No
manual configuration, no click in an interface. A change goes through these
files, then the recipe is run again. If it is not in `infra/`, it does not
exist: a machine can be destroyed and recreated identically at any time.

| Directory | Tool | Role |
|---|---|---|
| `terraform/` | Terraform | Creates the machines (VMs) and their network — the "building". |
| `ansible/` | Ansible | Configures the inside of the machines — the "fitting-out". |
| `compose/` | Docker Compose | Describes the services that run on each machine. |
| `lab/` | — | Files specific to the local lab (Docker + LXD on the same machine). |

Current machines:

| VM | Address (lab) | Content |
|---|---|---|
| `eupadev-forge` | `10.42.0.10` | Gitea + PostgreSQL + Caddy; organisation `eupadev` (template, robot accounts) and `eupadev-core` (npm registry of the core) |
| `eupadev-ci` | `10.42.0.11` | Mock-ups and Previews of the tools (generic Caddy, account `deployment`, ADR-022); two CI runners (Gitea Runner 5), registered with the organisation `eupadev`: `ci-standard` (secrets, tests, analysis — runs the agents' code, **without access to Docker**) and `ci-image` (build, scan, publication of the images — the only one with Docker) |
| `eupadev-orch` | `10.42.0.12` | Orchestrator: its dedicated PostgreSQL database, never exposed, and the DBOS engine (signed image, pulled by digest; local API on `127.0.0.1:8080` only; fake forge and deployer by default, the real ones with `-e orchestrator_real_world=true`); Keycloak (identity, `https://auth.<domain>`) — see "Keycloak" below |
| `eupadev-agents` | `10.42.0.13` | Containers of the AI agents: Docker with the gVisor runtime (`runsc`), Smokescreen egress proxy, AI proxy (Caddy, adds the Anthropic key), one internal Docker network per task — see "Agents VM" below |
| `eupadev-tools` | `10.42.0.14` | Prod of the generated tools: generic Caddy `*.<domain>`, account `deployment` — see "Deployment targets" below |

## Rebuild everything from scratch (local lab)

Prerequisites on the host machine: LXD (snap), Terraform (OpenTofu reads the
same files, untested here), Ansible and the
collections of `ansible/requirements.yml` (from `infra/ansible`:
`ansible-galaxy collection install -r requirements.yml -p .ansible/collections`).

```sh
# 1. Dedicated SSH key (once) — Ansible enters the VMs with it.
ssh-keygen -t ed25519 -N '' -C 'eupadev-lab' -f ~/.ssh/eupadev_lab
cp ~/.ssh/eupadev_lab.pub infra/terraform/ssh_lab.pub

# 2. Create the network and the VMs.
cd infra/terraform && terraform init && terraform apply

# 3. Internet access of the VMs from the host machine (Docker + LXD).
cd ../ansible && ansible-playbook lab-host.yml --ask-become-pass --skip-tags forge-ca

# 4. Vaults of the secrets: generated at random, encrypted, outside the repository.
#    Run again after adding a machine: only the missing vault is created.
#    Also creates the engine's signing key (Docker required) and writes
#    images/engine/cosign.pub: commit it (git add + commit); and the engine's
#    SSH key to the deployment targets (in the vault, never ~/.ssh).
#    Anthropic key of the AI proxy (the only key provided, not generated): paste
#    it into a file (cat > ~/anthropic-key, Ctrl-D), then
#    ANTHROPIC_KEY_FILE=~/anthropic-key ./init-vault.sh, then delete the file.
./init-vault.sh

# 5. Configure every VM (forge, organisation, robot accounts, template).
#    Without OVH credentials, set caddy_tls: internal and caddy_image: ""
#    in group_vars/all/vars.yml first (section "Public certificates").
ansible-playbook site.yml

# 6. Host machine: address and certificate of the forge, authorities of the
#    targets' Caddys, DNS of the domain to the lab network (run again after
#    each recreation of a VM that has a Caddy: its certificate changes).
ansible-playbook lab-host.yml --ask-become-pass

# 7. Check in real conditions: rights of the robot accounts, then CI.
#    verify-base-image first: it waits for the first build of the golden
#    images, including the CI image without which no ci-standard job starts.
ansible-playbook verify-forge.yml      # rights of the robots, protected files, branches outside agent/**
ansible-playbook verify-base-image.yml # golden images build/run/ci: checks, registry, digest
ansible-playbook verify-ci.yml         # two runners: standard without Docker, image with it
ansible-playbook verify-template.yml   # template pipelines: green, red on a fault, Docker
                                       # out of reach of an agent's tests, publication
ansible-playbook verify-orchestrator.yml # orchestrator database: answers, accounts with limited rights, unreachable from outside
ansible-playbook verify-storage.yml     # Docker storage on the separate disk, capped cache, daily prune of the CI VM
ansible-playbook verify-backup.yml   # backup on demand, then a real restore
                                         # in throwaway containers (stops Gitea ≈ 30 s)
ansible-playbook verify-system.yml      # swap, security updates, SSH, needrestart,
                                         # maintenance slot, no restart pending > 7 days

# 8. Orchestrator engine (section "Orchestrator engine"):
#    digest published by the pipeline of the `engine` repository → orchestrator_image,
#    then site.yml, then:
ansible-playbook verify-engine.yml       # signature, secrets in memory, local API, complete cycle,
                                         # resumption after docker kill (+ -e restart_vm=true)
ansible-playbook verify-engine-mails.yml # E1: real mails to Mailpit; engine killed right after
                                         # a gate's mail → no second mail

# 9. Deployment targets (section "Deployment targets"):
ansible-playbook verify-deployer-access.yml # DNS and HTTPS of the targets; forced-command SSH:
                                            # refusals, forwardings, from=, single sudo, journald
ansible-playbook verify-deployer.yml       # E5d: real Preview (signature, Compose model,
                                            # idempotence, other cycle, egress cut, Domain removed,
                                            # script killed then replayed, complete removal)
ansible-playbook verify-deployer-core.yml # d5: core mode (Gate 1 entry required, migration before
                                            # traffic, database over TLS, egress to Keycloak only,
                                            # purge timer, Prod backup); throwaway stand-in image

# 10. Agents VM (section "Agents VM"):
ansible-playbook verify-agents.yml       # gVisor, network per task, Smokescreen, AI proxy (key invisible
                                         # to the tasks); pnpm install measured under runc and under runsc;
                                         # -e ai_call=true: real minimal call (a few cents)
ansible-playbook verify-image-agent.yml  # agents image (`agent` repository): green and signed pipeline,
                                         # then on the agents VM neither docker nor sudo, non-root, pinned
                                         # claude, Trivy, cosign signature checked (other key refused)
```

Check that a second run changes nothing (`changed=0`): it proves that the
recipe really describes the actual state.

**Automatic review of the recipes**: `ansible-lint` runs on GitHub on every change of `infra/`
(`.github/workflows/infra-lint.yml`). Locally, from `infra/ansible`:
`ansible-galaxy collection install -r requirements.yml -p .ansible/collections`
then `ANSIBLE_COLLECTIONS_PATH=$PWD/.ansible/collections ansible-lint`.
Every public image is named by digest (`name:tag@sha256:…`); checked on
GitHub (`.github/workflows/image-digests.yml`), locally:
`python3 .github/scripts/verify-digests.py` from the repository root.

## Operations: system base and maintenance

Role `base`, on every VM:

- **Swap file** `/swapfile` (`swap_size`, 2 GB, in
  `group_vars/all/vars.yml`), enabled by the systemd unit `swapfile.swap`;
  `vm.swappiness=10` (swap as a last resort). Changing the size does not
  resize an existing file: `systemctl stop swapfile.swap`, delete
  `/swapfile`, run `site.yml` again.
- **Automatic security updates**: Ubuntu's `unattended-upgrades`, every day
  (timer `apt-daily-upgrade.timer`), "security" origins only
  (`/etc/apt/apt.conf.d/52eupadev-unattended-upgrades`), no restart by
  unattended-upgrades (restarts go through the slot below). Log:
  `/var/log/unattended-upgrades/`.
- **needrestart in list mode** (`/etc/needrestart/conf.d/eupadev.conf`,
  `$nrconf{restart} = 'l'`): after an update, no service (neither Docker nor
  containerd…) is restarted on its own; they load the new libraries when the
  VM restarts.
- **SSH** (`/etc/ssh/sshd_config.d/10-eupadev.conf`): key only, no root
  login. Effective configuration: `sshd -T`.

**Restarts**: when an update requires one (kernel…), Ubuntu creates
`/var/run/reboot-required`.

**Maintenance slot (automatic)**: every night, the timer
`eupadev-maintenance.timer` of each VM restarts the VM **if and only if**
that file exists, at an hour specific to the VM (`maintenance_hour`,
inventory `inventory/lab.yml`): forge 03:15, CI 03:30, orchestrator 03:45,
agents 04:00, tools 04:15 UTC — after the backup (02:30), the forge and the CI
before the golden images (Monday 04:00), never two VMs at the same time (checked by `verify-system.yml`). The
containers come back on their own (`restart: unless-stopped`). A CI pipeline
running during the slot fails: run it again. Next runs:
`systemctl list-timers eupadev-maintenance.timer`; log:
`journalctl -u eupadev-maintenance`. The timer does not check that the
containers came back: that is the job of the `verify-*` (and of Gatus, later).

**Alert**: `verify-system.yml` fails if a restart has been pending for more
than 7 days (the slot no longer runs). At login, Ubuntu already shows
"*** System restart required ***".

**Docker disk of the CI VM (automatic)**: every night at 01:00 UTC, the
timer `eupadev-docker-prune.timer` (role `docker_prune`) removes what is
older than 72 h (`docker_prune_age`) and used by no container: the build
cache, the tool images (one `check/<tool>:<sha>` per CI run, label
`eupadev.core` of the fixed Dockerfile; also the Preview images the deployer
pulled) and the dangling images. A Preview or mock-up in service or paused
keeps its image (Docker never prunes an image a container references); the
pulled reference images (runner, Playwright, ZAP, Trivy, PostgreSQL) carry
no label and stay; the anonymous volumes no container uses (left by the CI
jobs) go; no container nor named volume is ever touched. Log:
`journalctl -u eupadev-docker-prune`; checked by `verify-storage.yml`.

**Immediate restart, by hand** (outside the slot), from `infra/ansible`:

```sh
ansible-playbook maintenance.yml
```

One VM at a time, and only those waiting for it; before moving to the next
one, the recipe waits until the containers that were running are back (and
"healthy"). Downtime ≈ 1 min per VM; do not run it during the nightly backup
(02:30 UTC) nor during a running CI pipeline (it would fail).

## Agents VM: sandbox of the AI agents

Role (ROADMAP §8.16 L1-L4): run the code written by the agents far from
everything valuable (token that writes to `main`, databases, images being
built). Ansible roles: `base`, `docker_disk`, `gvisor`, `docker`, `lab_ca`,
`executor`, `agent_proxies`; Compose: `compose/agents/`.

**Paid engine only after a free cycle.** The executor runs the fake agent
engine by default; `executor_claude_engine: true` switches it to the real
Claude Code (paid). The role refuses that switch unless a free full cycle
has proved today's platform: `verify-engine-deployment.yml -e
free_cycle=true` (the pushing fake pushes the reference tool
`examples/requests`, up to a healthy Preview with its four checks green,
no AI call) writes `/opt/eupadev/executor/free-cycle.json` on the agents
VM with what it proved (engine image digest, commit of the template's
`main`, latest published core). On `executor_claude_engine: true` the role
reads the same three identifiers on the forge (`roles/executor/tasks/fingerprint.yml`)
and fails, naming what differs and the commands to run, when the marker
does not match; a second `site.yml` run with nothing changed asks for no
new free cycle. Only override, printed as `OVERRIDE` in the run output:
`-e executor_free_cycle_skip=true` (used by `verify-executor-claude.yml`,
a single capped task). Order, from `infra/ansible`:

```sh
ansible-playbook site.yml --limit orchestrator,agents -e orchestrator_real_world=true </dev/null   # executor on the pushing fake
ansible-playbook verify-engine-deployment.yml -e free_cycle=true </dev/null                        # free cycle, marker written
ansible-playbook site.yml --limit orchestrator,agents -e orchestrator_real_world=true -e executor_claude_engine=true </dev/null   # paid engine
```

- **gVisor** (`runsc` 20261005.0, official APT repository, systrap platform:
  no hardware virtualisation needed in the VM). Declared to Docker under the
  name `runsc`, **never the default runtime**: an agent container asks for
  it with `--runtime=runsc`. Version: `gvisor_version`
  (`roles/gvisor/defaults`), outside the automatic updates (only Ubuntu's
  "security" origins are): upgrade it by hand.
- **One internal network per task** (`--internal`, no VM address on the
  bridge), created by the launcher, which connects the two proxies to it
  (`compose/agents/compose.yml`, header): a task container reaches only
  them, and two tasks do not see each other.
- **AI proxy** (Caddy, `compose/agents/ai-proxy/Caddyfile`):
  `ANTHROPIC_BASE_URL=http://<IP>:8080` and a fake key on the container's
  side; Caddy replaces `x-api-key` by the real key (secret in a file,
  `systemd-creds`, vault `group_vars/agents/vault-ai.yml`) and removes
  `Authorization`. Stopping this container cuts the AI for every agent.
  Safety net outside our code: a dedicated Anthropic workspace, with a monthly
  spending limit, and a key restricted to it (L4, Anthropic console).
- **Smokescreen** (Stripe, MIT), proxy `HTTPS_PROXY=http://<IP>:4750`
  for the containers: only `registry.npmjs.org` is allowed
  (`compose/agents/smokescreen/acl.yaml`), private IPs refused even behind an
  allowed name, `api.anthropic.com` refused (it goes through the AI proxy).
  Its decisions are in its log (`docker logs agents-smokescreen-1`,
  `CANONICAL-PROXY-DECISION` lines).
- Firewall: 22 only inbound (Docker publishes nothing).

**Size**: 2 vCPU / 4 GiB in the lab; 4 vCPU / 8 GiB targeted once two agents run at the
same time with Playwright. Before `terraform apply`, check `free -g` on the
host: 4 more GiB must be free.

**Recreate this VM only**, from `infra/`:

```sh
cd terraform && terraform apply -replace='lxd_instance.vm["agents"]' -replace='lxd_volume.docker["agents"]'
# Remove the old SSH host key of 10.42.0.13 from ~/.eupadev-known-hosts.
cd ../ansible && ansible-playbook site.yml --limit agents
ansible-playbook verify-agents.yml
```

Nothing to back up on this VM: everything there is disposable and recreated
by the recipe (no data; the AI key comes from the vault).

## Deployment targets: CI VM and tools VM (ADR-022)

The engine deploys the generated tools over SSH, with its own key, to the
script `eupadev-deployer` (role `deployer`): mock-ups and Previews on the
CI VM, Prod on the tools VM (2 vCPU / 3 GiB in the lab).

- **Generic DNS**: the dnsmasq of the LXD network (`raw.dnsmasq`,
  `terraform/main.tf`) answers `*.<domain>` → tools VM,
  `*.preview.<domain>` and `mockup.<domain>` → CI VM, `git.<domain>` →
  forge, `auth.<domain>` and `chat.<domain>` (requesters' page,
  `chat_domain`) → orchestrator VM. The host machine: `lab-host.yml` sends the
  domain to this dnsmasq (service `eupadev-lxd-dns`, `resolvectl`), the rest
  of the DNS does not change; the bare domain then answers with the tools VM
  on that machine too.
- **Caddy** (`compose/deployer/`, Caddyfile written by Ansible): one generic
  block per environment; the requested name gives the container
  (`preview-<tool>`, `prod-<tool>`), an unknown name gives 502. Admin API
  turned off: a change goes through `site.yml`, which recreates the
  container. Let's Encrypt certificates by DNS-01 (section "Public
  certificates"); with `caddy_tls: internal`, an internal authority specific
  to each Caddy, installed by `lab_ca` (`lab_ca_targets`) on the CI VM, the
  orchestrator, the tools VM and the host machine. Firewall: 22 and 443.
- **Engine access**: account `deployment` (outside `docker`, directory and
  keys owned by root), key of the vault `group_vars/all/vault-deployer.yml` as
  `restrict,from="<orchestrator>",command="sudo -n /usr/local/sbin/eupadev-deployer"`,
  a single sudo rule (the script, without argument; the request goes through
  `SSH_ORIGINAL_COMMAND`). Configuration: `/etc/eupadev/deployer.json`.
  Log: `journalctl -t eupadev-deployer`.
- **Commands of the script**: `served`, `deploy`, `stop`, `remove`, `purge`.
  Tests of its validation, without a VM:
  `python3 ansible/roles/deployer/files/test_deployer.py`.
- **Rotation of the engine's SSH key**: delete the vault
  `vault-deployer.yml`, `./init-vault.sh`, then `site.yml`.
- **Core tools (d5, ADR-022)**: each target VM also runs `tools-db`
  (PostgreSQL 18, role `postgres_tools`, TLS by the database authority, never
  published) and a Smokescreen (`deployer-smokescreen-1`) allowing only
  `auth.<domain>`. A tool built on the core is registered after Gate 1:
  add its entry (slug, roles, retentions) to
  `ansible/group_vars/all/core-tools.yml`, then
  `ansible-playbook register-tools.yml </dev/null` (Keycloak clients
  `<slug>` and `<slug>-preview`, database and roles on both VMs, secrets
  with systemd-creds, entry `/etc/eupadev/tools/<slug>.json`). Without
  it the deployer refuses the tool's image. After a VM rebuild: `site.yml`,
  then `register-tools.yml`, then restore the dumps
  (`tools-<slug>-*.dump`). Purge: `eupadev-purge.timer` (03:30 UTC,
  tools VM only).

From the host machine, after `lab-host.yml`: `curl -sS -o /dev/null -w
'%{http_code}\n' https://trial.preview.<domain>/` must answer `502`
(valid certificate, no tool of that name).

**Add the tools VM to an existing lab**, from `infra/` (check `free -g` on
the host: 3 more GiB free):

```sh
cd terraform && terraform plan   # expected: 2 to add (VM, disk), 1 to change (network: raw.dnsmasq), 0 to destroy
terraform apply
cd ../ansible && ./init-vault.sh   # creates only the missing vault (the engine's SSH key)
ansible-playbook site.yml </dev/null
ansible-playbook site.yml </dev/null   # second run: changed=0 expected
ansible-playbook lab-host.yml --ask-become-pass
ansible-playbook verify-deployer-access.yml </dev/null
ansible-playbook verify-deployer.yml </dev/null
ansible-playbook verify-mockup.yml </dev/null
ansible-playbook verify-engine-preview.yml </dev/null
ansible-playbook verify-prod-switch.yml </dev/null
ansible-playbook verify-deployer-core.yml </dev/null
```

## Backups and restore

Every night at 02:30 UTC (systemd timer `eupadev-backup.timer`, role
`backup`), by the native method of each service:

| VM | Method | Content | File |
|---|---|---|---|
| forge | `gitea dump` | Git repositories, image registry (packages), Gitea database, `app.ini`, data | `gitea-<date>.tar.gz` |
| orchestrator | `pg_dump --format=custom` | orchestrator database; `keycloak` database (private keys signing the tokens and the clients' secrets: protect it like the vault) | `orchestrator-<date>.dump`, `keycloak-<date>.dump` |
| tools | `pg_dump --format=custom` | one dump per core tool database (Production) | `tools-<slug>-<date>.dump` |

- Directory `/var/lib/docker/backups` (separate Docker disk), root only (the
  files contain `app.ini`, hence secrets); the **7 most recent** are kept
  (**4 on the forge**: each archive contains the image registry; by count: a
  series of failures never deletes the last good ones).
- The Gitea docs require **Gitea to be stopped** during the dump (consistency
  of database and repositories): ≈ 30 s per night; PostgreSQL and Caddy keep
  running, Gitea restarts even if the dump fails.
- Backup on demand: `systemctl start eupadev-backup` (as root on the VM).
  A failure shows: `systemctl --failed`, `journalctl -u eupadev-backup`.
- Not backed up (rebuilt by Terraform/Ansible): VMs, public images, Docker
  cache, CI runners.
- **No copy outside the VM yet** (off-site copy planned, restic): in the lab,
  `terraform destroy` of a VM also destroys its backups. The vaults
  (`group_vars/*/vault*.yml`) and `~/.eupadev-vault-pass` are essential to a
  restore (Gitea's `SECRET_KEY` encrypts the organisation's secrets): keep
  them somewhere else than on the lab machine.

Proof: `verify-backup.yml` restores the last backup into throwaway containers
(same image, isolated network, no port) and compares it with the running
service: repositories, users, packages, sha256 integrity of every registry
blob, `git clone` + `git fsck` + commit of the template's `main`; tables and
rows of the orchestrator database.

### Cleaning the forge's image registry

Each backup of the forge copies the whole registry: old images are deleted
every **Sunday at 01:30 UTC** by a systemd timer of the forge (role
`registry_cleanup`), and on demand by `registry-cleanup.yml`; same script,
same kept images. Only Gitea's official API is used.

```sh
cd infra/ansible
ansible-playbook registry-cleanup.yml </dev/null                # trial mode: lists what would be deleted and the space freed
ansible-playbook registry-cleanup.yml -e apply=true </dev/null  # deletes, after reviewing the list
```

- **Always kept**: `orchestrator_image`, `agents_image`, `keycloak_image`
  (read in the `group_vars`), the build of the movable tags of `base-node`
  (`build-24`, `run-24`, `ci-24`, read in `gitea_org_variables`), and the
  signature `sha256-<digest>` of each; in addition, the **last 3 builds** of
  each variant (`build-24`, `run-24`, `ci-24` for base-node; a single one for
  the other packages) (a build = a digest, with all its tags).
- **Deleted**: the rest, orphan signatures, untagged manifests (`sha256:…`:
  per-platform image, BuildKit attestation, cosign bundle) that no kept
  version references (except those less than an hour old: build in
  progress), and the `check-*` packages entirely. Then Gitea's cleanup
  (`cleanup_packages`, started through the API) removes the blobs no longer
  needed (those older than 24 h: right away; the others, the next night).
- Nothing is deleted if an image in service or a movable tag cannot be
  found, or if a manifest cannot be read.
- **Timer** `eupadev-registry-cleanup.timer` → unit
  `eupadev-registry-cleanup@registry.service`, apply mode. Slot: one hour
  before the backup (02:30, which then copies a lighter registry), away from
  the golden images (Monday 04:00) and the maintenance (03:15-04:15); stopped
  after 45 min. Settings without secret in
  `/etc/eupadev-registry-cleanup/registry.json`, rewritten by `site.yml`
  from `group_vars/forge` (`registry_in_service`, `registry_movable`); the
  API password in `password` in the same directory (0600 root), handed to
  the script by `LoadCredential=`; the script runs as a throwaway account
  (`DynamicUser=`). Result: `journalctl -u 'eupadev-registry-cleanup@*'`
  (one summary line + the details in JSON); failure: `systemctl --failed`.
- Gitea 28 **never removes** an untagged manifest on its own: its nightly
  cleanup deletes only expired uploads, empty packages and unreferenced
  blobs; only the cleanup rules (web interface, no API) delete versions.

Proof: `verify-forge.yml` pushes a trial package (5 signed builds, the oldest
in service), sorts it with the playbook (trial mode), cleans it with the
timer's unit (instance `@trial`, that package only), checks that the unit
deleted what the playbook listed and that the last 3 + the one in service
remain, each with its signature; then that the timer is active, its
settings equal to the `group_vars` and the password file 0600 root.

### Restoring the forge (Gitea docs: manual restore)

On a rebuilt forge (`terraform apply`, then `site.yml` **with the same
vaults**), as root on the VM, one command at a time. The steps are those
that `verify-backup.yml` runs in throwaway containers; resetting the
database in place (step 3) is not covered by that test.

```sh
cd /opt/eupadev/forge
docker compose stop gitea
mkdir /root/restore && tar xzf /path/gitea-<date>.tar.gz -C /root/restore
# Database: start from an empty database, then reload the SQL of the dump.
docker compose exec -T db psql -U gitea -d postgres -c 'DROP DATABASE gitea' -c 'CREATE DATABASE gitea OWNER gitea'
docker compose exec -T db psql -U gitea -d gitea -v ON_ERROR_STOP=1 -q < /root/restore/gitea-db.sql
# Files (rootless image): data → /var/lib/gitea, repos → /var/lib/gitea/git/repositories.
V=$(docker volume inspect -f '{{.Mountpoint}}' forge_gitea-data)
find "$V" -mindepth 1 -delete
cp -a /root/restore/data/. "$V"/
mkdir -p "$V/git" && cp -a /root/restore/repos "$V/git/repositories"
chown -R 1000:1000 "$V"
docker compose start gitea
docker compose exec -T gitea gitea admin regenerate hooks
rm -rf /root/restore
```

The dump's `app.ini` is not copied back: the configuration comes from the
variables set by Ansible (vault). It is a fallback if the vault is lost
(`SECRET_KEY`, `INTERNAL_TOKEN`, `JWT_SECRET`, database password).
Then: `ansible-playbook site.yml`, then the `verify-*`.

### Restoring the orchestrator database (PostgreSQL docs: `pg_restore`)

Engine stopped (`docker compose stop engine`, or emergency stop level 2), as
root on the VM. The accounts `orch_owner` and `orch_engine` must exist first
(`pg_dump` does not back up the accounts, global to the server): on a rebuilt
VM, `site.yml` creates them.

```sh
cd /opt/eupadev/orchestrator
docker compose exec -T db pg_restore -U orchestrator -d orchestrator --clean --if-exists --exit-on-error < /path/orchestrator-<date>.dump
```

## Orchestrator engine

**Image** (ROADMAP §8.16 M2, ADR-005): built, scanned (Trivy), published and
signed with cosign by the forge CI, never on the VM. The organisation's
`engine` repository is synchronised by `site.yml` (`gitea_platform_repos`):
`images/engine/` at its root and the build context of
`orchestrator/Dockerfile`. Signing key: vault
`group_vars/forge/vault-cosign.yml` (created by `init-vault.sh`), stored in
the secrets **of the platform repositories** (`engine`, `agent`, `keycloak`,
`caddy`; no tool repository sees it);
public key committed as `images/engine/cosign.pub`. Signature without a
public transparency log (nothing leaves the forge).

**Putting into service** (from `infra/ansible`):

```sh
# 1. Synchronise the engine repository and set its key: the "Engine image" pipeline starts.
ansible-playbook site.yml
# 2. Read the digest: last line "Engine digest: …" of the job, in
#    Gitea (repository eupadev/engine, Actions tab), then put it in
#    group_vars/orchestrator/vars.yml: orchestrator_image: "<registry>/eupadev/engine@sha256:…"
# 3. Deploy: image pulled by digest, signature checked, migrate, engine.
ansible-playbook site.yml
ansible-playbook verify-engine.yml
```

A missing or wrong signature stops `site.yml` before anything starts (the
image is removed). Updating the engine = new digest in `orchestrator_image`,
then `site.yml`: `docker compose up` stops the old engine before starting
the new one (never two at once, D23).

**Secrets on the VM** (ROADMAP §8.16 M1): never in plain text on the disk.
Ansible encrypts each secret of the vault on the VM with `systemd-creds`
(`--with-key=auto`: host key, plus the TPM chip if there is one) in
`/etc/eupadev/credstore.encrypted/`. The service `eupadev-secrets`
(before Docker, at every boot, nightly restart included) decrypts them into
`/run/eupadev/secrets/` (memory), one file per secret owned by the user of
the container that reads it, `0400`; Compose mounts them as secrets, the
engine reads them through `<VARIABLE>_FILE`. The Compose `.env` file now holds
configuration only. List: `orchestrator_secrets`
(`group_vars/orchestrator/vars.yml`). Accepted limit: root on the VM reads
everything; a copy of the disk alone gives nothing if the key is in the TPM
(otherwise the host key is on the same disk).

- **Rotation**: change the value in the vault (the administrator,
  `ansible-vault edit` in a separate terminal), then `site.yml`: the secret is encrypted again, the
  service restarted, the containers recreated (they read their secrets only
  at start).
- **Rotation of the cosign key**: delete the `COSIGN_*` secrets of the
  `engine` repository in Gitea and the vault `vault-cosign.yml`,
  `init-vault.sh`, commit the new `cosign.pub`, `site.yml`, run the pipeline
  again, new digest in `orchestrator_image`.

**Local API**: `127.0.0.1:8080` of the VM only, through an SSH tunnel from
the administrator's workstation (headers `X-EupaDev: 1` and, for a POST,
`Idempotency-Key`). Log: `docker compose logs engine` in
`/opt/eupadev/orchestrator`; the real trace is in the database.

## Keycloak (identity of people)

Decisions: ADR-017.

- **Image**: `keycloak` repository of the forge (`images/keycloak/`), built
  for PostgreSQL, scanned, signed by the installation's cosign key; digest
  read by `ansible-playbook engine-digest.yml -e repo=keycloak` →
  `keycloak_image` (`group_vars/orchestrator/vars.yml`).
- **On the orch VM** (role `keycloak`, Compose of the orchestrator): database
  `keycloak` on the orchestrator's PostgreSQL (account `keycloak` without
  privilege, verified TLS), `caddy-auth` on `https://auth.<domain>` (only
  `/realms/eupadev/*`, `/realms/tools/*` and `/resources/*`), read-only container, log in
  journald (`journalctl CONTAINER_NAME=orchestrator-keycloak-1`).
- **Realm as code**: `group_vars/orchestrator/keycloak.yml` (clients, roles,
  groups, people) applied by the client `eupadev-config`; anything not
  declared there makes `verify-keycloak.yml` fail.
- **Realm `tools`** (generated tools): described once in
  `core/tests/keycloak/realm-test.json` (import of the core's CI), applied to
  the lab by its own configuration client `tools-config` (vault
  `vault-keycloak-tools.yml`), without the file's secrets: the client secret
  is generated by Keycloak, test people have no password
  (`verify-keycloak.yml` sets a throwaway one, then removes it). Address of
  each tool in the lab: `keycloak_tool_addresses`.
- **First installation**: `./init-vault.sh` (vaults `vault-keycloak*.yml`),
  `site.yml` (the bootstrap creates temp-admin, each realm and its
  configuration client, then deletes temp-admin), `lab-host.yml` (authority
  of `caddy-auth` on the host machine), `verify-keycloak.yml`.
- **The administrator's account** (lab): `ilan`, groups requesters and admins; temporary
  password in the vault (`ansible-vault view
  group_vars/orchestrator/vault-keycloak.yml`, separate terminal), change
  required at the first sign-in.
- **Admin console**: never published; through an SSH tunnel only
  (`KC_HOSTNAME_ADMIN` and URL of the master realm = `http://127.0.0.1:8180`).
  Named administrator `ilan-admin` (master realm, role `admin`, D5); no
  permanent Ansible account in master: it is configured by an ephemeral
  temp-admin (Keycloak stopped ≈ 30 s), only when its declaration changes
  (`keycloak_master_admins`, `keycloak_master_otp`).
  First sign-in of the named administrator, one command at a time:
  1. Read the temporary password, in a separate terminal, from
     `infra/ansible`:
     `ansible-vault view group_vars/orchestrator/vault-keycloak-admin.yml`
  2. Open the tunnel (leave it running):
     `ssh -i ~/.ssh/eupadev_lab -o UserKnownHostsFile=~/.eupadev-known-hosts -N -L 8180:127.0.0.1:8180 ansible@10.42.0.12`
  3. In a recent Chrome or Firefox (`Secure` cookies accepted on
     `127.0.0.1`): `http://127.0.0.1:8180/admin/master/console/`,
     account `ilan-admin` and the temporary password.
  4. Keycloak requires a new password, then the OTP enrolment: scan the QR
     code with Google Authenticator, Microsoft Authenticator or FreeOTP
     (TOTP SHA1, 6 digits, 30 s), enter the displayed code and a device
     name. Afterwards, each sign-in asks for password + code.
  Five failures lock the account temporarily (1 min, then more, up to
  15 min). Lost phone: no other admin of master; recovery by a temp-admin
  (same mechanism as the bootstrap, `tasks/temp-admin.yml`) that removes
  `ilan-admin`'s OTP.
- **Upgrading**: dump of the `keycloak` database first (no schema rollback,
  D10), then new digest (`images/keycloak/README.md`).

## Emergency stop of the engine

`emergency-stop.yml`, from `infra/ansible`, always with `-e confirm=yes`
(without it, nothing is done). From the mildest to the strongest:

| Level | Command | Effect |
|---|---|---|
| — | message `cancellation` through the API | a single cycle stops (`end_cancellation`) |
| 1 | `ansible-playbook emergency-stop.yml -e level=1 -e confirm=yes` | agents paused: `PAUSE_AGENTS=1` (file `pause-agents.conf` next to the Compose file), engine restarted; no agent task is taken any more, the cycles go on (messages, gates); `/health` answers `pause_agents: true`; the agent containers still running on the agents VM are removed (they belong to dockerd, not to the executor, and would keep spending until the pause is lifted) |
| 2 | `ansible-playbook emergency-stop.yml -e level=2 -e confirm=yes` | engine stopped cleanly (60 s for DBOS) and **kept stopped**: file `EMERGENCY-STOP`, which `site.yml` respects; Docker does not restart it when the VM restarts; agent containers removed as at level 1 |
| 3 | `ansible-playbook emergency-stop.yml -e level=3 -e confirm=yes` | level 2 + **every token** of `svc-orchestrator` and `svc-agent` deleted through the admin API (no write to the forge possible any more); then, by hand: revoke the AI API key in the provider's console |

Deadlines keep running during a stop: reminders sent all at once on return,
"silent" CI if the stop lasts more than 60 min. Nothing is deleted in the
database: everything resumes at restart (DBOS). A task whose container was
removed is re-enqueued by DBOS when its executor restarts and resumes at
level 0 from the tip of its branch (the containers are removed **after** the
executor's restart or stop: removed while the executor still runs the task,
it would record it as failed). Its lost execution is charged the role's cap
(cost unknown), whatever the moment of the removal.

The playbook itself is checked by `verify-emergency-stop.yml` (free, fake
engine): a stand-in container with the task label, level 1, no container
left and the executor paused, a request whose task stays queued, level 0,
the task taken by the executor; the test cycle is cancelled.

**Back to normal**:

```sh
# After a level 3 only: new tokens for the robots.
ansible-playbook site.yml
# After a level 1, 2 or 3: pause and stop lifted, engine restarted, /health checked.
ansible-playbook emergency-stop.yml -e level=0 -e confirm=yes
# Then the proof that everything works.
ansible-playbook verify-engine.yml
```

## Secrets

- The vaults `ansible/group_vars/*/vault*.yml` (forge, orchestrator database
  and its accounts, signing keys of the platform and of the tools, deployer,
  database authority, Keycloak, OVH, AI key: full list in `infra/CLAUDE.md`,
  created by `ansible/init-vault.sh`), and their password
  `~/.eupadev-vault-pass` are specific to each installation and are
  **never committed**, not even encrypted. The only intended exception: the
  **public** key `images/engine/cosign.pub`, committed, and the tools' one,
  `ansible/files/cosign-tools.pub`, committed too.
- On the orchestrator VM, the secrets are encrypted by `systemd-creds` and
  decrypted in memory at boot (section "Orchestrator engine").
- Reading a secret (in a separate terminal, never in a tool that records the
  display): `ansible-vault view group_vars/all/vault.yml`.
- Planned: replace the Ansible vault by OpenBao (paused until the second real
  tool).

## Public certificates: Let's Encrypt by DNS-01 at OVH

Every public Caddy (forge `git.`, `auth.` and the chat page on the
orchestrator VM, Previews and mock-ups on the CI VM, Prod on the tools VM)
obtains its own certificates from Let's Encrypt by the DNS-01 challenge at
OVH (ADR-015, option 1): nothing is exposed to the Internet, wildcard
certificates for `*.preview.<domain>` and `*.<domain>` (no tool name in the
Certificate Transparency logs), each Caddy asks for a distinct set of names,
Caddy renews by itself. The Caddy image with the OVH DNS module
(`images/caddy`) is built, scanned and signed by the forge CI (repository
`caddy`), pulled by digest and verified by Ansible like the engine's image.

- Switch: `caddy_tls` (`ansible/group_vars/all/vars.yml`), `internal` (Caddy's
  own authority, role `lab_ca`) or an email address (Let's Encrypt);
  `caddy_image` (digest of the platform's Caddy); `caddy_acme_staging`
  (Let's Encrypt staging: untrusted certificates, no rate limit).
- OVH credentials: vault `ansible/group_vars/all/vault-ovh.yml`
  (`vault_ovh_application_key`, `vault_ovh_application_secret`,
  `vault_ovh_consumer_key`; an application token restricted to
  `/domain/zone/<domain>`, endpoint `ovh-eu`): `OVH_CREDS=<file>
  ./init-vault.sh`. Forge: environment of its Caddy from the `.env` of the
  Compose; other VMs: `systemd-creds` secrets decrypted in memory
  (`eupadev-secrets.service`), read by Caddy's `{file.*}`.
- A new lab needs two passes: the forge CI builds the Caddy image behind the
  internal certificate first.

```sh
# 1. First pass, caddy_tls: internal, caddy_image empty (official Caddy).
ansible-playbook site.yml
# 2. Digest of the image built by the `caddy` repository.
ansible-playbook engine-digest.yml -e repo=caddy   # → caddy_image (group_vars/all/vars.yml)
# 3. caddy_tls: <email>, caddy_image: <digest>; first run on staging, then production.
#    Staging: site.yml FAILS on the first VM that pulls from the forge
#    ("x509: unknown authority", nobody trusts staging): expected; the forge's
#    staging certificate already proves the DNS-01 issuance.
ansible-playbook site.yml -e caddy_acme_staging=true
ansible-playbook verify-letsencrypt.yml -e caddy_acme_staging=true  # issuer CN contains (STAGING)
ansible-playbook site.yml
ansible-playbook verify-letsencrypt.yml   # issuer Let's Encrypt, wildcards, renewal configuration
```

The lab authority (`lab_ca`, `lab-host.yml`) does nothing once `caddy_tls` is
an email address; what it installed earlier stays harmless (the system store
also trusts Let's Encrypt). The other `verify-*.yml` need production
certificates (staging ones are trusted by nobody).

## Moving from the lab to a hosting provider

`terraform/` changes (VM provider), and with it the inventory addresses and
the data disk's device (`docker_disk_device`); the roles of `ansible/` and
`compose/` stay identical; `caddy_tls` is already an email address (Let's Encrypt by DNS-01,
previous section) and `lab-host.yml` is no longer needed (the domain then
points to the VM through the DNS).
