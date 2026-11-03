# infra/ — landmarks

Complete procedure (rebuild, order of the commands): `README.md` of this
directory. This file does not repeat it: it gives what you need to know to
change the infra without breaking or rediscovering anything.

## Principles

- **Everything is here, nothing by hand.** A change goes through Terraform,
  Ansible or Compose, then the recipe is run again.
- **Proof of a right recipe**: a second run of `ansible-playbook
  site.yml` gives `changed=0` everywhere. A "change" that comes back on every
  run is a bug to fix (`changed_when`).
- **Proof of a behaviour**: the real tests `verify-forge.yml`,
  `verify-ci.yml`, `verify-base-image.yml`, `verify-template.yml`, `verify-core.yml`, `verify-orchestrator.yml`,
  `verify-storage.yml`, `verify-backup.yml`, `verify-system.yml`, `verify-engine.yml`,
  `verify-engine-forge.yml`, `verify-engine-mails.yml`, `verify-engine-integration.yml`, `verify-engine-ci.yml`, `verify-agents.yml`, `verify-image-agent.yml`, `verify-deployer-access.yml`, `verify-deployer.yml`, `verify-mockup.yml`, `verify-engine-preview.yml`, `verify-prod-switch.yml`, `verify-deployer-core.yml`, `verify-engine-deployment.yml`, `verify-engine-claude.yml`, `verify-executor-claude.yml`, `verify-keycloak.yml`, `verify-engine-chat.yml`, `verify-letsencrypt.yml`. Every new capability comes with
  its real test, which cleans up after itself (`always` block) and prints the
  useful logs on failure.
- **ansible-lint** must pass, locally and on GitHub
  (`.github/workflows/infra-lint.yml`). Exceptions only through `# noqa`
  with the reason written down.

## Commands (from `infra/ansible`)

```sh
ansible-playbook site.yml </dev/null          # configure the VMs
ansible-playbook verify-forge.yml </dev/null  # rights of the robots; registry cleanup on a trial package (playbook, then the timer's unit)
ansible-playbook verify-ci.yml </dev/null     # CI runner
ansible-playbook verify-base-image.yml </dev/null  # golden image
ansible-playbook verify-template.yml </dev/null  # template pipelines
ansible-playbook verify-core.yml </dev/null  # core in the forge npm registry: green pipeline, read badge reads but cannot publish, republication 409, rerun skips
ansible-playbook template-lockfile.yml </dev/null  # after a core release: regenerates the lockfiles resolving @eupadev/core from the forge registry (template, verify-template scenarios 9 and 13)
ansible-playbook verify-orchestrator.yml </dev/null  # orchestrator database (migrations required; TLS 1.3 + client certificate from the agents VM, filtered port)
ansible-playbook engine-digest.yml </dev/null  # digest published by the pipeline of the engine repository (→ orchestrator_image)
ansible-playbook verify-engine.yml </dev/null  # engine: signature, secrets, API, cycle (W1 at the pilot, tasks at the executor of the agents VM), resumption (-e restart_vm=true)
ansible-playbook verify-engine-forge.yml </dev/null  # E2: the engine's code creates a tool on the real forge, then cleans up
ansible-playbook verify-engine-mails.yml </dev/null  # E1: a gate sends a mail (Mailpit), engine killed right after → no second mail
ansible-playbook verify-engine-integration.yml </dev/null  # E3: pushing fake (svc-agent, roles tests and builder), integration and merge (svc-orchestrator) on the real forge; variant conflict = builder branch in conflict with main; then cleans up
ansible-playbook verify-engine-ci.yml </dev/null  # E4: after a squash, the watcher reads the real CI of main (green → digest from the registry, faulty → red), then cleans up
ansible-playbook verify-storage.yml </dev/null  # Docker storage on the separate disk
ansible-playbook verify-backup.yml </dev/null  # backup + real restore (stops Gitea ≈ 30 s)
ansible-playbook verify-system.yml </dev/null  # swap, updates, SSH, needrestart, slot
ansible-playbook verify-agents.yml </dev/null  # gVisor, network per task, Smokescreen, AI proxy (invisible key), pnpm measure, executor (non-root, Docker, signature read on the forge) (-e ai_call=true: paid call)
ansible-playbook verify-deployer-access.yml </dev/null  # E5a-b: DNS and HTTPS of the targets; forced-command SSH (refusals, forwardings, from=, single sudo, journald)
ansible-playbook verify-deployer.yml </dev/null  # E5d: real Preview from the engine (SSH key): unsigned / other-key / platform-key images refused, Compose model applied, same digest → nothing touched, other cycle without effect, no egress, Domain removed from the cookies, script killed then replayed, complete removal; cleans up (trial packages, throwaway badge)
ansible-playbook verify-mockup.yml </dev/null  # E5e: mock-up archives on the script's stdin (trapped archive and wrong digest refused, only web/, same digest untouched), Caddy headers by Sec-Fetch-Dest (exact CSP, frame page), two mock-ups side by side, removal
ansible-playbook verify-engine-preview.yml </dev/null  # E5f: a template tool (core) — a trivial commit runs its real CI, which publishes the signed image; registered by register-tools.yml; the engine deploys it as Preview, starts preview-check.yml with the URL and reads the run (perf, pa11y, ZAP, acceptance — a one-scenario suite signed in as a persona, then the platform SEC-* — all green); an injected fault turns acceptance red with the failing test in the result; features without Playwright config turn guard-rails red at push; -e orchestrator_image=<digest> tests a candidate engine image; job logs printed on failure
ansible-playbook verify-prod-switch.yml </dev/null  # E5g: Prod on the tools VM: creation, switch beside the old one, unhealthy version refused while the old one keeps serving, rollback = previous digest (still local), removal
ansible-playbook verify-deployer-core.yml </dev/null  # d5: core mode with a throwaway stand-in image (NOT the core): refused before registration, register-tools.yml twice (changed=0), migration then traffic, _app role over TLS, OIDC secret accepted via Smokescreen, other host refused, no secret in inspect, failing migration keeps the old version (Preview and Prod), Preview database emptied on a new digest only (same digest kept, Prod never), purge (command and timer), Prod backup; personas (two per role, one role on the Preview client, PREVIEW_PERSONAS in a throwaway repository); with a core tool served in Prod: its digest as Preview, kit `signIn` signs persona -1 in there, Prod answers 403 with no session row; cleans up (clients, personas, database, roles, secrets, repository, images)
ansible-playbook register-tools.yml </dev/null  # the administrator, after Gate 1 of a core tool (D-E5): entries of group_vars/all/core-tools.yml → Keycloak clients, databases and roles, secrets, /etc/eupadev/tools/<slug>.json, test personas (`<slug>-<role>-<n>`, Preview client only) and the tool repository's Actions secret PREVIEW_PERSONAS
ansible-playbook verify-engine-deployment.yml </dev/null  # E5 full cycle, free (pushing fake): needs site.yml --limit orchestrator,agents -e orchestrator_real_world=true first (real forge + real deployer); drives the cycle with check-requester / check-admin up to Prod, registering the core tool by register-tools.yml at Gate 1; the Preview pipeline (four controls, acceptance suite files/trial-acceptance committed on main by a throwaway svc-orchestrator token) runs before the requester is asked (S5); cleans up (registration and token included); site.yml without -e goes back to the fakes
ansible-playbook verify-engine-claude.yml -e ai_call=true </dev/null  # PAID (cap $1): real Claude Code through the engine's code on the agents VM, commit pushed to the task's branch, nothing left behind
ansible-playbook verify-executor-claude.yml -e ai_call=true </dev/null  # PAID (overlap, Haiku 5.5, cap $4 per task, provisional A-R5): the pilot queues a task, the executor in service runs the real Claude Code; cycle cancelled, executor set back to the fake
ansible-playbook verify-image-agent.yml </dev/null  # published agents image: neither docker nor sudo, non-root, claude version, Trivy, cosign signature (other key refused)
ansible-playbook verify-keycloak.yml </dev/null  # Keycloak: one check per decision D2-D15 (realm, clients, at+jwt tokens, replay, brute force, public paths, PostgreSQL account) + realm inventory == declared; realm tools == core/tests/keycloak/realm-test.json, sign-in of its 3 people (throwaway password removed); master: ilan-admin (role admin), OTP required, brute force (ephemeral temp-admin: stops Keycloak ≈ 1 min); test users deleted
ansible-playbook verify-engine-chat.yml </dev/null  # chat step 6: the requesters' page at https://<chat_domain> through caddy-auth (engine's CSP, HSTS, wrong Host refused), real sign-in of a throwaway user from the CI VM (ui_locales=fr, cookie, GET /requests, sign-out); user deleted
ansible-playbook engine-digest.yml -e repo=keycloak </dev/null  # digest of the Keycloak image (→ keycloak_image)
ansible-playbook engine-digest.yml -e repo=caddy </dev/null  # digest of the platform's Caddy (OVH DNS module, → caddy_image, group_vars/all)
ansible-playbook verify-letsencrypt.yml </dev/null  # Let's Encrypt DNS-01 at OVH: from the CI VM, each public site (git, auth, chat page, mockup, *.preview, *.<domain>) presents a Let's Encrypt certificate (staging with -e caddy_acme_staging=true) for the right names, 7 days left; on each VM, running image = caddy_image, acme_dns ovh and the ACME directory in the Caddyfile
ansible-playbook measure-resources.yml -e mode=<start|end> </dev/null  # memory/CPU/disk peaks per VM and per container during a real cycle (stops by itself after 4 h); end: table + data in ~/eupadev-measures/, nothing left on the VMs
ansible-playbook registry-cleanup.yml </dev/null  # forge registry: trial mode (list + space freed); -e apply=true deletes (keeps the images in service, base-node movable tags, last 3 builds per variant, their signatures); automatically: Sunday 01:30 UTC timer (role registry_cleanup)
ansible-playbook maintenance.yml </dev/null  # immediate restart, one VM at a time (otherwise: nightly slot)
ansible-playbook emergency-stop.yml -e level=<0|1|2|3> -e confirm=yes </dev/null  # the administrator only
ANSIBLE_COLLECTIONS_PATH=$PWD/.ansible/collections ansible-lint
```

`</dev/null`: without it, Ansible refuses to start in the agent's
environment ("non-blocking IO").

## Machines (lab)

| VM | IP | Ansible roles |
|---|---|---|
| `eupadev-forge` | 10.42.0.10 | base, docker_disk, docker, gitea, gitea_org, backup, registry_cleanup, lab_ca (last: trusts its own Caddy, to pull the platform's Caddy image on the next pass) |
| `eupadev-ci` | 10.42.0.11 | base, docker_disk, docker, lab_ca, runner (2 runners: `standard`, `image`), postgres_tools, deployer (mockup, preview) |
| `eupadev-orch` | 10.42.0.12 | base, docker_disk, docker, lab_ca, orchestrator, keycloak, backup (6 GiB: Keycloak) |
| `eupadev-agents` | 10.42.0.13 | base, docker_disk, gvisor, docker, lab_ca, executor, agent_proxies |
| `eupadev-tools` | 10.42.0.14 | base, docker_disk, docker, lab_ca, postgres_tools, deployer (prod), backup |

Gitea API seen from the forge: `http://127.0.0.1:3000/api/v1` (local
service door); admin account `forgeadmin`. Organisation `eupadev`,
robots `svc-agent`, `svc-orchestrator`, `svc-ci`, `svc-deployment`,
`svc-core` (publishes `@eupadev/core`; member of no team of
`eupadev`, only package writer of the separate organisation
`eupadev-core`, `gitea_core_org`; badge `CORE_PUBLISH_TOKEN` in the
secrets of the `core` repository only, `gitea_platform_repos[].badges`).

## Secrets — never display them

- Vaults `ansible/group_vars/all/vault.yml`,
  `ansible/group_vars/orchestrator/vault.yml`,
  `ansible/group_vars/orchestrator/vault-accounts.yml`,
  `ansible/group_vars/forge/vault-cosign.yml`,
  `ansible/group_vars/forge/vault-cosign-tools.yml`,
  `ansible/group_vars/all/vault-deployer.yml`,
  `ansible/group_vars/all/vault-db-pki.yml` (authority of the orchestrator
  database), `ansible/group_vars/orchestrator/vault-keycloak.yml`
  (database, bootstrap temp-admin, configuration client, check clients of
  the lab, temporary password of ilan),
  `ansible/group_vars/orchestrator/vault-keycloak-admin.yml` (temporary
  password of ilan-admin, named admin of the console),
  `ansible/group_vars/orchestrator/vault-keycloak-web.yml` (secret of the
  client `eupadev-web`, web sign-in on the engine side, ADR-024),
  `ansible/group_vars/orchestrator/vault-keycloak-tools.yml` (configuration
  client `tools-config` of the realm tools),
  `ansible/group_vars/all/vault-ovh.yml` (OVH API credentials of the Caddys,
  Let's Encrypt DNS-01, provided by `OVH_CREDS=<file>`) and
  `ansible/group_vars/agents/vault-ai.yml` (Anthropic key, provided by
  `ANTHROPIC_KEY_FILE=<file>`), encrypted, outside the repository,
  created by `init-vault.sh` without ever reading an existing vault (a new
  secret = a new vault added to the script), and their password
  `~/.eupadev-vault-pass`. Read by the administrator only, in a separate terminal.
- Every task that handles a secret has `no_log: true`. Git credentials
  passed in an HTTP header (`http.extraHeader`), never in a URL.
- The `svc-ci` badge lives in the secrets of the Gitea organisation
  (`REGISTRY_TOKEN`), never on disk. The engine's cosign key lives in the
  secrets of the **repositories** `engine`, `agent`, `keycloak` and `caddy` (`gitea_platform_repos[].secrets`),
  not of the organisation: no tool repository sees it. The cosign key **of
  the tools**, a different one, lives in the secrets of the organisation
  (`COSIGN_TOOLS_*`, `gitea_org_secrets`); its public key is committed in
  `ansible/files/cosign-tools.pub` and set on the deployer's targets.
- Orchestrator VM and agents VM: secrets encrypted by `systemd-creds`, decrypted
  in memory (`/run/eupadev/secrets`) by `eupadev-secrets.service`,
  read through `*_FILE`; never in the Compose variables file.
- The agent's guard blocks `~/.ssh`, `*.key`, `.env*` and the commands
  containing an authentication header: go through a script file, never
  work around it.

## Pitfalls already met (do not rediscover them)

- Docker and LXD on the same machine: without `lab/eupadev-lxd-forward.service`,
  the VMs have no Internet.
- Recreated VMs: Ansible uses `~/.eupadev-known-hosts` (empty it after a
  recreation); Caddy's certificate changes → run `lab-host.yml` again.
- Gitea (1.27 as well as 28): the runner registration ticket is requested with **POST**.
- **Gitea 28**: `[server] DOMAIN` is no longer read (the domain comes from `ROOT_URL`);
  network egress in `EGRESS_MODE=strict` (`[security]` and `[migrations]`):
  a future webhook or OAuth2 client (orchestrator, Keycloak) will not go out
  without its address in `ALLOWED_HOST_LIST`.
- **Robot accounts (Gitea 28)**: the `svc-*` are of type `Bot` (token
  only). No conversion API: `gitea admin user change-type -u X
  --user-type Bot` (role `gitea_org`), only if `GET /users/X` does not
  return `type: Bot`. Tokens and teams are kept.
- **Audit log (Gitea 28)**: `[audit] RECORD_OUTPUT=database`, 400 days.
  The read API exists only in the Enterprise edition: SQL read of the table
  `audit_event` (read only, `verify-forge.yml`). It does not record
  `git push`.
- **Gitea Runner 5** (formerly act_runner): image `gitea/runner`, binary
  `gitea-runner`; `runs-on` required in each job; `${NAME}` is expanded in
  `config.yaml` (`$${NAME}` for a literal `$`); act_runner's registration
  file `.runner` stays valid (no new registration).
- **Registry (Gitea 28)**: an untagged manifest (`sha256:…`: per-platform
  image, BuildKit attestation, cosign bundle) stays after the deletion of
  the tag that referenced it; `cron.cleanup_packages` (active by default)
  never deletes it (only the cleanup rules, without API, do) →
  `registry-cleanup.yml`. Deleting a version: `DELETE
  /packages/{org}/container/{name}/{version}` with `:` encoded (`%3A`); a
  whole package: `DELETE /packages/{org}/container/{name}`. The blobs go
  only at the cleanup (`POST /admin/cron/cleanup_packages`). The tools
  generated by `verify-forge.yml` publish their image (`check-protection-orch`):
  the repository deleted, the package stays (hence its explicit deletion in `always`).
  Kept images: `registry_in_service` and `registry_movable`
  (`group_vars/forge`), read by the playbook **and** by the timer (settings
  rewritten by `site.yml`): do not copy them anywhere else.
- **Finished oneshot unit** (without `RemainAfterExit`): systemd forgets it
  at once (`systemctl show` no longer gives an `InvocationID` nor a `Result`)
  → read its log with `journalctl -u <unit> --since @<start>`.
- `apt update_cache` counts as a change: `changed_when: false`.
- GitHub CI: install the tools **outside** the directory ansible-lint reads
  (`$RUNNER_TEMP`), otherwise it reads its own files.
- Branch protections and CI badges: defined once only in
  `group_vars/forge/vars.yml` (`gitea_branch_protections`, `gitea_ci_tokens`).
- Golden image: keep no useless package manager (npm made Trivy fail in the
  build variant); pnpm is preloaded in the image.
- CI jobs: the Docker of the CI VM trusts the forge through
  `/etc/docker/certs.d/<domain>/ca.crt` (role `lab_ca`).
- **Two CI runners** (`runner_instances`, `group_vars/all/vars.yml`):
  `ci-standard` (`docker_host: "-"`: neither socket nor `DOCKER_HOST` in the
  job; job image = CI golden image, named by `container:` with the read
  badge, because the registry is private) and `ci-image` (Docker of the VM
  mounted). Every job that runs agent code goes to `ci-standard`;
  `ci-image` only does `docker build` / `docker run` without socket.
  `docker_host` is a setting of the runner, not of a label: hence two
  runners (two Compose services, two registrations).
- Every branch outside `main` and `agent/**`: only `svc-orchestrator` writes
  there (rule `**` of `gitea_branch_protections`, the order of the rules
  matters). Without it, an agent created a branch with its own pipeline.
- The CI VM has no `docker buildx`: a build trial is done in the job image
  (`gitea/runner-images`, which has it), socket mounted.
- CI golden image: `LANG=C.UTF-8` required (Opengrep reads ASCII otherwise
  and crashes on an accent); gitleaks rebuilt (the published binary makes
  Trivy fail: old Go and `golang.org/x`).
- Workflow written in YAML: a one-line `run:` containing `: ` is silently
  rejected by Gitea (log: "ignore invalid workflow") → `run: |`.
- A failing assertion prints its whole `item`: never loop an `assert` over
  the raw result of a `no_log` task (it contains the command, hence the
  credentials); keep only the useful fields first.
- `ansible-vault` started by a script in the agent's environment: redirect
  its output to a file ("non-blocking IO", like Ansible).
- Gitea 1.27, changing a team (PATCH `/teams/{id}`): without `permission`,
  `includes_all_repositories` is silently ignored; and setting it to `false`
  does not remove the repositories already linked (remove them one by one).
  **Gitea 28.1**: the reverse, `permission: none` without `units_map` → 400
  "no permission specified"; `includes_all_repositories` alone is applied.
- Docker 29 (containerd storage) stores images and containers in
  `/var/lib/containerd`, which `data-root` does not move: the `root` of
  `/etc/containerd/config.toml` (role `docker`, `containerd_root`) puts them
  on the Docker disk. `containerd config dump` shows the real value.
- **Images by digest** (`name:tag@sha256:…`, digest of the multi-architecture
  index) for every public image: Compose, `FROM`, `docker run`, the runner's
  `docker://` label (`runner_job_image`). **Actions by digest** too: every
  `uses:` of a YAML file (GitHub, Gitea, template, Ansible recipes) as
  `owner/repo@<40-character commit SHA> # vX.Y.Z` (SHA read by
  `git ls-remote`, commit pointed to by `^{}` if the tag is annotated); the
  only exceptions: local action `./…` and `docker://…@sha256:…`. Both
  checked by `.github/scripts/verify-digests.py` (GitHub CI, tested by
  `test_verify_digests.py`). Intended exception for images: our golden
  images (organisation variables), rebuilt every week under the same tag.
  Digest read through the registry API (no `buildx` on the host), checked by
  recomputing the sha256 of the manifest.
- `site.yml` changing both `images/base-node` and the runners: the build
  started by the push of `base-image` is killed when the `image` runner is
  recreated (log cut short, red pipeline). Run
  `verify-base-image.yml -e rebuild=true`.
- **Backups** (role `backup`): `gitea dump` requires Gitea **stopped**
  (Gitea docs, consistency of database and repositories) →
  `docker compose stop gitea`, dump by
  `docker compose run --rm --no-deps -T gitea gitea dump --file -` (standard
  output: file written by root, nothing to mount nor to `chown`), restart in
  a `trap EXIT`. The registry (packages) is included by default. A registry
  blob is stored under `packages/xx/yy/<sha256 of the content>`: integrity
  checkable with `sha256sum -c`.
- `docker compose config --images <service>` also lists the images of the
  dependencies (`depends_on`): for the image of one service,
  `docker compose ps --format '{{.Image}}' <service>`.
- **PostgreSQL accounts of the orchestrator** (role `orchestrator`):
  `orchestrator/sql/roles.sql` run by `psql -f -` in the `db` container,
  passwords as `\set` on standard input (`stdin`, `no_log`), never as `-v`
  (an argument can be read in `ps`). Migrations and DBOS schema: one-shot
  service `migrate` of the Compose file, after the accounts (hence two `up`:
  `db` alone, then `migrate engine`).
- `psql -c` passed by `ansible.builtin.command` as a string: double quotes
  are eaten (`"user"` becomes `user`, PostgreSQL's current user, not Gitea's
  table) → `argv`.
- Throwaway PostgreSQL: wait for `pg_isready -h 127.0.0.1` (the temporary
  server of the initialisation listens on the local socket only).
- No Ansible `fetch` for a backup: with `become`, the file also goes through
  `slurp` in memory (module docs, risk of `MemoryError` for ≈ 1 GB). The
  copy outside the VM will come with the off-site copy (restic).
- `systemctl` started by `ansible -m script` (terminal allocated) without
  `--no-pager` waits in the pager (blocks).
- Gitea API `GET /repos/{o}/{r}/actions/jobs`: lists from the OLDEST to the
  most recent; for the last job, sort by `id`. A job's log also contains the
  text of the script: search the timestamped lines, not the source.
- Ansible with redirected output: standard output must be a file too
  (`> file 2>&1`), otherwise "non-blocking IO" even with `</dev/null`.
- **sshd keeps the first value read** and reads `sshd_config.d/*.conf` in
  alphabetical order: our file is called `10-eupadev.conf` to come before
  cloud-init's (`50-`, `60-`). A file added before it (`0x-…`) would win:
  `verify-system.yml` detects it (`sshd -T`).
- APT lists (`Unattended-Upgrade::Allowed-Origins`): an `apt.conf.d` file
  **adds** to the list; to replace it, `#clear` then the new list. Ubuntu's
  origin `${distro_codename}` (archive of the release) is removed that way.
  Real value: `apt-config dump`.
- `ansible.cfg` sets `ssh_args` without `ControlPersist`: each task opens a
  new SSH connection, so the task that follows an sshd reload proves by
  itself that Ansible can still get in.
- **needrestart on Ubuntu** restarts the services by itself after an update
  (mode "a" when called by APT, written as a comment in
  `needrestart.conf`), unless `$nrconf{restart}` is set explicitly:
  `conf.d/eupadev.conf` sets it to `'l'`. Effective value:
  `perl -e 'our %nrconf; do "/etc/needrestart/needrestart.conf"; print $nrconf{restart}'`.
- **Maintenance slot**: never create `/var/run/reboot-required` by hand for a
  trial without removing it: the VM restarts at its `maintenance_hour` the
  next night. Dry run without the file:
  `systemctl start eupadev-maintenance.service` does nothing ("unmet
  condition check" in the log).
- ansible-lint locally: if `ansible-galaxy collection install -p
  .ansible/collections` answers "Nothing to do" (collections found in the
  system), add `--force`, otherwise ansible-lint does not see
  `community.general`.
- **systemd-creds** (systemd 255): an encrypted value changes every time
  (randomness) → for idempotence, decrypt and compare in memory (`no_log`),
  encrypt again only if different. `--name=` is written into the encrypted
  value and checked at decryption. `decrypt` adds a newline depending on
  `--newline=auto` → always `--newline=no`. No `null` key in 255 (no trial
  possible without root). The `RuntimeDirectory=` of a oneshot
  `RemainAfterExit=yes` unit lives while the unit is active, disappears when
  it stops.
- **File-type Compose secrets**: mounted as they are from the host, the
  Compose uid/gid/mode ignored → owner and `0400` set on the host. A file
  rewritten (new inode) is not seen by a running container:
  `--force-recreate`. PostgreSQL alpine rereads `POSTGRES_PASSWORD_FILE` as
  uid 70 after `gosu`: the file must belong to it. This password is used only
  at the creation of the database: changing it afterwards does not change
  the superuser's.
- **Compose, one-shot service**: `up` restarts every time a finished service
  another one depends on (`migrate`) → count as a change only `db`/`engine`;
  `--wait` accepts a one-shot that exited with 0. Inactive profile + empty
  image (`${VAR:-}`): valid configuration; active profile + empty image:
  refused. Optional file: `env_file` with `required: false`.
- **cosign 3**: `--tlog-upload=false` is refused with the default signing
  configuration → `cosign signing-config create --out f.json` (no service:
  neither Rekor nor timestamp authority) then `sign --signing-config f.json`.
  Verification: `verify --key cosign.pub --insecure-ignore-tlog=true` (works
  offline). Signature in bundle format, stored under the tag
  `sha256-<digest>` of the same repository (OCI fallback without the
  referrers API); wrong key: "failed to verify signature".
- Image pulled by digest (`docker pull name@sha256:…`): found again by
  `docker image inspect name@sha256:…` (containerd storage), hence checked
  once, at download; `pull_policy: never` prevents Compose from pulling an
  unchecked image by itself.
- `docker compose kill engine`: the container stays stopped (no restart by
  `restart: unless-stopped` observed locally) → `docker compose start`.
- The agent's guard also blocks the names `*secrets.yml` and `*.env`: hence
  `tasks/systemd-creds.yml` and `pause-agents.conf`.
- **Package `runsc` (gVisor)**: its postinst runs `runsc install
  --clobber=false` (+ `systemctl reload docker`) if `/etc/docker/daemon.json`
  exists: it rewrites the file its own way. Hence the role `gvisor` BEFORE
  `docker`, and the runtime declared by the role `docker` (`docker_runtimes`).
  After a gVisor upgrade, the first run of `site.yml` rewrites `daemon.json`
  (1 change, Docker restarted): normal.
- Ansible `copy` whose rendered `content` is valid JSON: it is rewritten on
  one line (case of the `daemon.json` of the agents VM); with no runtime, the
  `daemon.json` of the other VMs stays identical to the character.
- **gVisor**: a container's `dmesg` ("Starting gVisor...") can be imitated
  (gVisor docs): `verify-agents.yml` also checks that the kernel seen from
  the container is not the VM's. APT repository: a dated channel
  (`.../releases <yyyymmdd> main`) contains a single version = pinned version.
- **Docker network `internal: true` (Docker 29)**: the bridge keeps an IP of
  the VM (the gateway) and a container reaches through it **the services of
  the VM** (sshd…), observed locally. `com.docker.network.bridge.inhibit_ipv4:
  "true"` removes this IP (task networks); the `.1` address of the subnet is
  then given to a container (often a proxy). Changing the options or the
  subnet of an existing network: `docker compose down` then `up` (`up` does
  not recreate a network).
- **Smokescreen**: without a client certificate (TLS), it does not know the
  client's role and **refuses everything**; `allow_missing_role: true`
  (configuration file only, no command-line option) applies the `default`
  rule of the ACL. Refusal of a CONNECT = **407** with the header
  `X-Smokescreen-Error`. Private, loopback, CGNAT and IPv4-embedded IPv6
  addresses refused by default, even behind an allowed name (never
  `--unsafe-allow-private-ranges` nor `allow_ranges`). The ACL is not
  reloaded live (the role recreates the container). `ghcr.io/stripe/smokescreen`
  refuses anonymous download (2026-10-13): published binary (sha256) mounted
  in `distroless/static:nonroot`.
- **Network per task** (no more shared `agents` network: two agents saw each
  other there): the launcher creates `net-<task>` (`--internal`,
  `inhibit_ipv4`), connects `agents-ai-proxy-1` and `agents-smokescreen-1` to
  it, reads their IPs with `docker inspect` and passes them to the container
  (proxies named by **IP**: under gVisor, Docker names do not resolve — trial
  of 2026-10-15, name unknown under runsc, resolved under runc;
  `AGENT_AI_PROXY=container:port`, `AGENT_EGRESS_PROXY=container:port` →
  `HTTPS_PROXY`, `NO_PROXY` = AI proxy). The proxies therefore listen on all
  their interfaces; each is alone on its egress network (`agents_egress`,
  `agents_ai-egress`) and has `ip_forward=0` (otherwise inherited from the
  host, set to 1 for Docker: a proxy connected to two tasks could relay).
  The Internet DNS cannot be reached from a task network: Smokescreen
  resolves.
- **AI proxy (Caddy)**: `header_up x-api-key {file./run/secrets/…}` reread at
  each request (unreadable file → empty header → 401); `header_up Host
  {upstream_hostport}` required (otherwise Caddy forwards the client's
  `Host`). The image's `caddy` binary carries the file capability
  `cap_net_bind_service`: with `cap_drop: ALL` alone, "exec operation not
  permitted" → `cap_add: [NET_BIND_SERVICE]`.
- Looking for a secret without taking it out of the VM: `grep -qF -f <file
  of the secret>` on `env`, `docker inspect`, `tar` of the container,
  **without pipefail** (tar dies of SIGPIPE when grep -q finds it); check the
  size of the file first (an empty file finds nothing).
- **Mailpit** (lab, Compose of the orchestrator, profile `mailpit`): the image
  runs as root by default → `user: 65534`; mails in a temporary database in
  `/tmp` (tmpfs, lost at restart); `MP_DISABLE_VERSION_CHECK`, otherwise
  `/api/v1/info` queries GitHub. A change of `EUPADEV_EXTERNAL` requires
  an engine image that knows it: synchronise the `engine` repository first
  (`site.yml --limit forge`), otherwise the engine refuses to start.
- `assert`: a `fail_msg` that is only a Jinja expression rendering a list of
  lists makes the task fail ("not string type") instead of showing the
  message: start the message with text.
- **Let's Encrypt by DNS-01 (OVH)**: `caddy_tls` (email) requires
  `caddy_image` (Caddy + module `caddy-dns/ovh`, `images/caddy`, built by the
  forge CI, pulled and checked by `roles/orchestrator/tasks/image.yml` on
  EVERY VM, the forge included: hence `lab_ca` at the end of the forge play
  and two passes for a new lab, README "Public certificates"). Shared global
  options (`caddy_acme_global`, group_vars/all): one certificate per site
  block, wildcards for `*.preview.<d>` and `*.<d>` (only DNS-01 allows it);
  OVH secrets read by `{file./run/secrets/…}` (Caddy's global replacer,
  checked in the 2.11.6 source: `fileReplacementProvider`) except on the
  forge (`{env.…}`, its `.env` already holds its secrets). Staging:
  `-e caddy_acme_staging=true` (issuer `O = Let's Encrypt` as in production,
  `(STAGING)` in its CN; certificates refused by everyone: only
  `verify-letsencrypt.yml` passes, and `site.yml` fails on the VMs that pull
  an image from the forge, "x509: unknown authority", observed on
  2026-10-28: staging proves the DNS-01 issuance, then production right
  away). The role `lab_ca` no longer does anything; its files stay harmless
  (`certs.d/<host>/ca.crt` ADDS to the system authorities, Docker source
  `ReadCertsDirectory`).
- **Caddy, variable name in `reverse_proxy`**: `preview-{labels.N}:3000` is
  evaluated at each request (local trial, Caddy 2.11.6). `{labels.0}` is the
  LAST label of the name (`com`); the port of the `Host` is not part of it.
  Too large an N gives an empty string, not an error ("lookup preview-: no
  such host"). Unknown name: 502 after `lb_try_duration`. `tls internal` on
  `*.x` does issue a wildcard certificate.
- **sudo and forced command**: sudo clears `SSH_ORIGINAL_COMMAND`
  (`env_reset`); `Defaults!<script> env_keep += "..."` keeps it for that
  script only, and `""` as the rule's arguments forbids any argument (local
  trial, sudo 1.9.15, OpenSSH 9.6). `restrict` does not make `ssh -L` fail at
  connection (the forwarding is refused only when used): test `-W`.
- **Jinja: no `\b` in a string**: `'…\b'` becomes the "backspace" character,
  not a word boundary (a `search(':5432\b')` never found anything: the old
  "no port 5432" check tested nothing). Write `'\\b'` or a space.
  `iptables -S` does not show `/32`.
- **Orchestrator database over TLS** (roles `db_pki`, `orchestrator`
  `db-tls.yml`, `executor`): dedicated authority (vault `vault-db-pki.yml`),
  keys generated on the VMs, CSR signed on the admin machine
  (`community.crypto` 3.x, pinned in `requirements.yml`). Our own
  `pg_hba` (the image's accepts plain text); certificate or rules changed →
  `docker compose kill -s HUP db`. Port published on the VM's IP, filtered
  in `DOCKER-USER` by `eupadev-db-firewall.service` (before Docker: no
  open window).
- **Ansible turns a text that starts with `{` or `[` into a dictionary or a
  list** (even when produced by `to_json`): rewritten afterwards in Python
  syntax, it is no longer JSON (and no longer compares equal to the existing
  one → change at every run). Put a newline first (case of the executor's
  Docker `config.json`, `group_vars/agents`).
- **Pilot / executor** (roles `orchestrator`, `executor`): same image and
  same digest (`orchestrator_image`), deployed together; the executor has no
  API (`healthcheck: disable`, hence no `compose up --wait`: "running and not
  restarted 20 s later"); it holds the secrets of the agents VM (played
  before `agent_proxies`). svc-agent's token kept encrypted as long as the
  forge accepts it, checked by a call within its scopes
  (`/packages/eupadev`, not `/user`, which requires `read:user`). Fake
  engine by default; `executor_claude_engine: true` = real Claude Code (paid).
  Published Go binaries (cosign) refused by Trivy: rebuilt like gitleaks.
- **Docker publishes its ports bypassing ufw**: Caddy's 443 is reachable even
  without the ufw rule (Docker docs, "Packet filtering and firewalls", ufw
  section; not measured in the lab); the rule documents the intent.
- **Keycloak** (role `keycloak`, Compose of the orchestrator):
  - `KC_BOOTSTRAP_ADMIN_*` on the service recreates temp-admin at **every**
    start as long as master has no other user (trial of 2026-10-15) →
    bootstrap by the one-shot command `kc.sh bootstrap-admin user
    --password:env … --optimized` (Keycloak stopped), then configuration
    client `eupadev-config` (realm-admin of the eupadev realm only),
    then temp-admin deleted. Afterwards, Ansible uses only this client.
  - `read_only`: tmpfs `/tmp`, `/opt/keycloak/data/tmp` **and**
    `/opt/keycloak/data/transaction-logs` (Narayana's log); without the
    latter, 3 × 10 s wait at start ("ARJUNA048006").
  - Database password: read from the secret by the entrypoint shell, then
    `exec kc.sh` (no `*_FILE` in Keycloak); absent from `docker inspect`.
  - Port 8080 of the VM = engine API → Keycloak admin on `127.0.0.1:8180`
    (SSH tunnel); 9000 never published; `hostname` fixed: the `iss` stays
    `https://auth.<domain>/realms/eupadev` even through 8180.
  - `keycloak_realm` ignores `default_optional_client_scopes` (the realm PUT
    does not touch them, with neither error nor "changed") → endpoint
    `default-optional-client-scopes/{id}` through `uri`.
  - Network `auth` with fixed addresses: **all** its members have a fixed
    address (Keycloak started before Caddy had taken Caddy's: "Address
    already in use"). `proxy-trusted-addresses` = address of `caddy-auth`.
  - Java image: Trivy also downloads its Java database (≈ 940 MiB); the
    default timeout (5 min) expired on the first run → `--timeout 30m`,
    threshold unchanged.
  - Replay of a refresh token (`refreshTokenMaxReuse=0`): `invalid_grant`,
    **and** the token that had replaced it is refused afterwards ("Session
    doesn't have required client"); the SSO session stays (new code without
    password).
  - Wrong password with `grant_type=password`: 400 `invalid_grant` (not 401).
  - Sign-in cookies `Secure` (even over HTTP): eupadev's browser flow
    works only over HTTPS (through Caddy). On the tunnel (master), a browser
    sends them back (127.0.0.1 = secure context), `urllib` does not:
    `check-keycloak.py` (mode `console`) gives it the same rule.
  - **Master** (D5): the configuration client has no right there, and a
    master account able to appoint an admin there would be a super-admin →
    master configured by an ephemeral temp-admin (`tasks/temp-admin.yml`,
    `kc.sh bootstrap-admin` requires Keycloak **stopped**, docs
    "bootstrap-admin recovery"), only if the digest of the declaration
    (`master` of the fact `keycloak.fact`) changes. Temporary password and
    required actions set at creation only. A drift made by hand in the
    console is seen only by `verify-keycloak.yml`.
    The named administrator's console (`ilan-admin`): tunnel `ssh … -N -L 8180:127.0.0.1:8180
    ansible@10.42.0.12`, `http://127.0.0.1:8180/admin/master/console/`,
    temporary password through `ansible-vault view` (separate terminal), OTP
    enrolment required: complete procedure in `README.md` ("Keycloak").
  - `docker compose up --wait` returns before the end of Keycloak's
    initialisation (503 "Request received during bootstrapping") → wait for
    `/realms/master` to answer 200.
  - Master's sign-in page served on 8180 but form posted to
    `https://auth.<domain>/realms/master/…` (404 from Caddy) → master
    attribute `frontendUrl` = `http://127.0.0.1:8180` (master's `iss` becomes
    the tunnel's; eupadev's does not change).
  - `otpSupportedApplications` (realm) gives translation keys:
    `totpAppGoogleName`, `totpAppFreeOTPName`,
    `totpAppMicrosoftAuthenticatorName` (HmacSHA1, 6 digits, 30 s).
  - The subject (`sub`) of ilan is written in the local fact
    `/etc/ansible/facts.d/keycloak.fact` (read at the start of a run):
    `orchestrator_four_eyes_exemption_subject`.
- Variable **registered** (`register`) or `set_fact` in a first play of a
  playbook: it stays on the host for the following plays and wins over a
  task variable of the same name (`clients` in `verify-keycloak.yml`) →
  distinct name.
- `map(attribute='a.b')` reads `a.b` as a **path**: for a Keycloak attribute
  with dots (`access.token.header.type.rfc9068`), `x['a.b']` in a Jinja
  loop. `psql -tA` writes the booleans `t`/`f`.
- Agent's environment: a line `secret_key: "{{ vault_… }}"` written by a Bash
  heredoc can land in the file as `[REDACTED]` (checked: the module then
  receives this text literally) → write such files with the write tool, then
  `grep -n REDACTED`.
- **tmpfs of a non-root container** (`read_only` + `tmpfs`): the mounted
  directory belongs to root (0755); a service that writes there as another
  user fails silently. Keycloak: gzip cache impossible → 404 on the console's
  JavaScript when the browser asks for a compressed answer (`curl` without
  `Accept-Encoding` does not see it), console stuck on "Loading". Always
  `path:uid=…,gid=…,mode=…` (`verify-keycloak.yml` checks the scripts).
- **Deployer (E5d)**: the script reads the registry read token
  (`svc-deployment`, one per target, named `deployer-<vm>`) with
  `systemd-creds decrypt` at each call and writes it into a 0700 directory
  of `/run`, deleted at the end of the call (`DOCKER_CONFIG` for cosign and
  `docker pull`). Caddy recreated by `site.yml` loses the tools' networks:
  the role reconnects it (networks labelled `eupadev.env`). Trial image
  without a build tool: `docker create` then
  `docker commit --change 'CMD [...]'`.
- `timeout -s KILL`: the process killed, `timeout` kills itself with the
  same signal → Ansible reads `rc = -9`, not 137.
- Agent's guard: the text of the Docker label `eupadev.env` passes for an
  `*.env` file in a Bash command → write with the edit tool; filter by
  `name=` rather than by this label.
- **Core mode of the deployer (d5)**: Smokescreen refuses private
  addresses even behind an allowed name; the identity provider of the lab
  (`auth.<domain>` → 10.42.0.12) is allowed by `allow_addresses:
  ["<ip>:443"]` in its `config.yaml` (key accepted by v0.1.0, proven by
  `verify-deployer-core.yml`), never by a range. A service with
  `profiles:` runs with `docker compose run --rm <service>` (targeted
  explicitly) and is ignored by `up`. `docker cp` into a created container
  fails if the destination folder does not exist: build the tree on the
  host, copy it in one go. A tool role (`core_app`) needs `USAGE` on schema
  `app` (granted by the core's first migration): without it, "permission
  denied for schema app". The agent's guard also reads `process.env` in a
  Bash command as an environment file: write such files with the Write tool.
