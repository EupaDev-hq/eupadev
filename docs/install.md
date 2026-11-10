# Installing EupaDev

> **Status (2026-11-09).** Discovery mode runs end to end **from a checkout
> of the repository** (section 2, "Before the first release"): install,
> sign-in of both accounts, one whole cycle driven through the API (request,
> mock-up accepted, Gate 1, Preview accepted, Gate 2, tool in production),
> re-run, uninstall, all played for real on one machine and by the CI job
> `.github/workflows/install.yml` at every push. The release workflow
> (`.github/workflows/release.yml`) is written but has never run: what is
> still to come
> ([ADR-028](adr/028-one-step-installation-signed-script-discovery-and-enterprise-modes.md))
> is the first `v*` tag, which publishes the signed script (section 1) and
> the signed engine image it names; until then the script says "signature
> not checked" and builds the image itself. The enterprise mode stays the
> lab recipe of [`infra/README.md`](../infra/README.md) (section 3 below).

EupaDev is installed by one script, `install.sh`, published signed with
every release. It has two modes: **discovery**, one machine with Docker,
made-up agents, no AI key, to see the cycle in about ten minutes; and
**enterprise**, the Terraform + Ansible recipe that builds the real
platform. Whatever the mode, start with section 1.

## 1. Verify before you run

A script run from the Internet is code nobody at your side has read. Every
release carries three files, and the order below is the point of this
project: check, read, then run. There is no `curl … | sh` line on this page,
on purpose.

1. **Download the three assets** of the release you want from
   `https://github.com/EupaDev-hq/eupadev/releases`: `install.sh`,
   `install.sh.sha256` and `install.sh.sigstore.json`. Set the tag you
   downloaded:

   ```sh
   VERSION=v0.1.0   # the release tag you downloaded
   ```

2. **Get cosign from its own release, checked by its published checksum**
   (same version and checksum the repository's CI uses):

   ```sh
   curl -fsSLO https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64
   echo "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71  cosign-linux-amd64" | sha256sum -c -
   chmod 0755 cosign-linux-amd64 && sudo mv cosign-linux-amd64 /usr/local/bin/cosign
   ```

3. **Check the signature.** The signature is keyless (Sigstore): there is no
   project key to trust, the identity is the release workflow of the public
   repository at that tag, and the signature is recorded in the public
   transparency log. The command fails if the file was not signed by that
   workflow at that tag:

   ```sh
   cosign verify-blob \
     --bundle install.sh.sigstore.json \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     --certificate-identity "https://github.com/EupaDev-hq/eupadev/.github/workflows/release.yml@refs/tags/$VERSION" \
     install.sh
   ```

4. **Check the checksum** (a second, independent proof that the file is the
   one the release published):

   ```sh
   sha256sum -c install.sh.sha256
   ```

5. **Read it.** About two hundred lines of POSIX shell, no bash. What to
   look for: it writes only under `~/.eupadev/discovery/` (or `--dir`), it
   downloads only three files of its own tag (the discovery Compose file,
   the hook that creates the PostgreSQL accounts and the SQL it runs) and
   refuses each unless its checksum matches the one stamped in the script,
   it names the engine image by digest (`ENGINE_IMAGE=ghcr.io/…@sha256:…`,
   stamped too) and verifies that image's signature with the same workflow
   identity before starting anything, it binds to the loopback address
   only, and its `uninstall` removes only what it created.

   ```sh
   less install.sh
   ```

6. Then run it (section 2 or 3).

What the signature proves: that this exact file was produced by the release
workflow of `EupaDev-hq/eupadev` at the tag you name, and that the event is
in the public log where anyone can find it. What it does not prove: that the
code is good. That is why step 5 exists.

**One identity for the script and the image.** The release workflow has two
jobs, in this order: the first builds the engine image, pushes it to GHCR
and signs its digest keyless; the second stamps that digest into
`install.sh` with the tag and the file checksums, signs the script, then
downloads the published assets back and verifies the script *and* the
stamped image with the identity above before the release leaves its draft
state. The digest lives in the script only: the Compose file keeps a
variable (`ENGINE_IMAGE`) that the script writes into the installation's
environment file, so the Compose file's checksum does not depend on the
image, and a checkout, where nothing is stamped, builds and runs its own
local image instead. Checking the script's signature is therefore checking
who chose the image; the script checks the image itself before it runs.

## 2. Discovery mode: one machine, ten minutes, no AI key

**What you get.** The engine with its PostgreSQL, the requester page, a
local sign-in service with two accounts (`requester` and `admin`), a mail
catcher for the gate e-mails, and the fake forge, deployer and agent engine.
You see the cycle: a request, the mock-up step, the gates and their
decisions, Preview, Production, with made-up agents and no cost.

**What you do not get.** Real agents and their isolation (gVisor, one
network per task, egress proxy), a separate forge, CI or tools VM, Keycloak,
TLS, backups, a running tool. Discovery mode is a demonstration of the
cycle, not the product; its page says so, and it refuses to bind to anything
but the loopback address.

**Prerequisites.** Linux (macOS should work; untested), Docker Engine with
the Compose plugin, cosign (section 1), about 2 GiB of RAM free, 5 GiB of
disk, ports 8080, 8081 and 8025 free, and Chrome or Firefox (see the Safari
note below). Check without changing anything:

```sh
sh install.sh check
```

**Install.** The script stops at the first missing prerequisite, before any
write. Then it downloads the three files of its tag, checks each against
the checksum stamped in the script, verifies the engine image signature,
writes `~/.eupadev/discovery/` (the Compose file, the two PostgreSQL
account files it mounts, and an owner-only environment file with random
secrets), and starts the containers on `127.0.0.1`:

```sh
sh install.sh discovery
```

**Before the first release: from a checkout.** The script in the
repository says `dev`: run it from the repository root, it takes the three
files from the checkout instead of downloading them, and it builds the
engine image `eupadev-engine:discovery` with `docker build -f
orchestrator/Dockerfile .` if it is not there yet (several minutes the
first time, nothing to verify: it says "signature not checked"). Add
`--dir` to install somewhere else than `~/.eupadev/discovery`. What the
installation must then answer, checked with curl alone, one whole cycle
included (the two accounts sign in, the requester asks for a tool and
accepts the mock-up and the Preview, the admin approves Gate 1 and Gate 2;
the fakes do the rest and the cycle ends with the tool "in production",
in under a minute): `sh tests/install/discovery-smoke.sh`.

Then:

- the requester page is `http://localhost:8080/`, the mail catcher
  `http://localhost:8025/`, where the mails the factory sends at each gate
  land (nothing leaves your machine);
- the passwords of the two accounts, `requester` and `admin`, are generated
  by the script and shown **once** on your terminal, at the end of the first
  install (ADR-028): write them down. They are never written to a container
  log; the sign-in container keeps hashes in memory only. They stay in the
  owner-only file `~/.eupadev/discovery/.env` with the other secrets, so
  that a re-run keeps the same accounts;
- sign in as `requester` to describe a tool, then as `admin` to decide at
  the gates: the four-eyes rule of the engine applies as in a company, so
  one account cannot approve its own request.

**Safari.** The engine's session cookies are `Secure` (ADR-024), and the
discovery page is plain `http://localhost`. Chrome and Firefox treat
`localhost` as a secure context and accept them; Safari may refuse them, and
the sign-in then loops back to the form. Use Chrome or Firefox for discovery
mode; there is no code change for this, on purpose (the enterprise mode is
always behind HTTPS).

**Running it again** changes nothing: the secrets are kept, the files are
compared, Compose reports no recreation (only the one-off `migrate` runs
again, and finds nothing to do). To use `127.0.0.1` in the URLs
instead of `localhost` (`--address 127.0.0.1`) or another directory
(`--dir`), uninstall first; any other address is refused, these two being
the only names the engine accepts in discovery mode.

**Uninstall** removes the containers, their volumes (your discovery data)
and the four files the script wrote, nothing else (the engine image stays,
`docker image rm eupadev-engine:discovery` if you want it gone), after a
confirmation (`--yes` skips it):

```sh
sh install.sh uninstall
```

## 3. Enterprise mode: the real platform

Enterprise mode is the recipe of [`infra/README.md`](../infra/README.md),
"Rebuild everything from scratch": Terraform creates the VMs (LXD on your
own machine), Ansible configures them, Docker Compose runs the services,
and the `verify-*.yml` playbooks prove the result on the real machines.
It needs your domain and DNS, Keycloak for identity, an Anthropic key for
the agents, and it builds and signs its own images on its own forge: no
public service is trusted. Sizing and what an installation asks of a
company: [`deployment.md`](deployment.md) and
[`client-prerequisites.md`](client-prerequisites.md). First sign-in after
the install: `infra/README.md`, section "Keycloak".

Said plainly:

- `install.sh enterprise` is **not built yet**: today the script orders
  nothing for this mode; follow the numbered steps of `infra/README.md`.
- **VMs provided by an IT department: not yet.** The recipes assume the
  LXD lab (data disk found by its LXD name, DNS from the lab network, no
  outbound proxy, no supplied certificate). The list of blockers is in
  [`deployment.md`](deployment.md), "What is missing before a real client".
  Until they are fixed, enterprise mode means: a Linux host with LXD,
  Terraform (or OpenTofu) and Ansible, running the lab recipe.
