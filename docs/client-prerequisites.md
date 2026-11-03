# EupaDev installation prerequisites (for the client's IT department)

What your IT department provides before EupaDev is installed, who does what
afterwards, and what leaves your network. Written for a small IT team that
mostly runs Microsoft systems: no Linux or Docker knowledge is needed to
fulfil it. Decisions behind this page: `ROADMAP.md` §8.15 ("Installation at
the client").

**Status of this page.** EupaDev is under construction. Each item carries a
status:

- **In place**: built, and proven by a real test on the lab VMs
  (`infra/ansible/verify-*.yml`). The lab runs on KVM virtual machines (LXD).
- **Planned**: decided, not built yet. Do not treat it as a commitment until
  it is marked in place.
- **Open**: not decided or not verified; to be settled with you.

Sizes are estimates, **to be confirmed by measurement** during the first real
runs.

## In five lines

1. You provide **4 blank Ubuntu 24.04 VMs** on your own hypervisor, with our
   SSH public key. We never access the hypervisor.
2. We install and run everything **inside** the VMs, remotely, through your
   VPN or bastion, with automated recipes (Ansible).
3. Your users reach EupaDev over HTTPS (port 443) on your internal network.
   Nothing is published on the Internet.
4. The only flow that carries your business content outside is the call to
   the **AI provider's API** (Anthropic), with a key in **your** name. No
   production data is ever sent to it.
5. Backups have two tiers: you back up whole VMs, EupaDev backs up its own
   data. Everything can be rebuilt from the recipes and the backups.

## Who does what

| Below the VMs: **your IT department** | Inside the VMs: **the EupaDev operator** |
|---|---|
| Hypervisor, storage, VM creation and resizing | Operating system configuration, security updates, reboots |
| Network, VLAN, firewall between zones, proxy | Local firewall of each VM |
| DNS records, NTP, internal certificate authority | EupaDev, the generated tools, their databases |
| Directory (Active Directory / Entra ID) | Identity service (Keycloak) connected to your directory |
| Backup of whole VMs (tier 1) | Application backups and restore tests (tier 2) |
| VPN or bastion, and the operator's access to it | Monitoring and alerts of the services |
| Approval of sensitive tools (veto) | Incident handling, rebuild |

At the start, the platform is **operated by the EupaDev operator**
(decision no. 2). No software agent is installed on your hypervisor or
elsewhere in your network.

## 1. The virtual machines

| VM | Role | vCPU | RAM | Disks (system + data) |
|---|---|---|---|---|
| Platform | Git forge and image registry, orchestrator, identity (Keycloak), reverse proxy (Caddy), monitoring | 4 | 14 GB | 40 + 200 GB |
| CI | Automated checks of the code and previews (code not yet approved) | 4 | 8 GB | 40 + 100 GB |
| Young tools | New tools during their 4-week quarantine, with their database | 2-4 | 8 GB | 40 + 100 GB |
| Mature tools | Stable tools, with their database | 4 | 12-16 GB | 40 + 150 GB |
| **Total** | | **14-16** | **42-46 GB** | **≈ 700 GB** |

All figures are **to be confirmed by measurement**. For comparison, the lab
currently runs 5 small VMs (forge, CI, orchestrator, AI agents, and a tools
VM for the production of the generated tools); the 4-VM layout above is **planned**. A tool handling sensitive data (HR, payroll,
personal data) may require a **fifth, dedicated VM**, decided when the tool is
approved (Gate 1).

**Installation contract, per VM** (the same for every hypervisor):

- Ubuntu Server **24.04 LTS**, installed from the **official ISO**, nothing
  else added (no Docker, no extra packages: the recipes install what is
  needed).
- OpenSSH server enabled; **our SSH public key** (supplied to you, dedicated
  to your installation) placed on an account named `ansible` that has `sudo`
  rights **without a password** (the recipes rely on it; commands in the
  appendix).
- A fixed IP address (static or DHCP reservation), your DNS servers and your
  NTP server configured.
- **Two disks**: one for the system, one for data. The data disk holds
  containers, databases and local backups (`/var/lib/docker`). Thin
  provisioning is fine; the data disk should be extensible without
  reinstalling. Please do not leave a hypervisor snapshot in place for more
  than 72 hours (long-lived snapshots degrade performance).
- If you install a security agent (antivirus, EDR) on Linux servers, tell us
  which one before installation.

**Hypervisors.** VMware vSphere, Microsoft Hyper-V and Proxmox VE are
accepted. Only KVM has been tested so far (lab); a **Hyper-V test is
planned**. On Hyper-V, a generation 2 VM with Secure Boot set to the
"Microsoft UEFI Certificate Authority" template is expected to be needed
(**to be verified**).

**cloud-init is optional.** If you prefer to deploy from an Ubuntu cloud image
(OVA, VHDX, qcow2), we can supply a cloud-init file that creates the account
and the key. The ISO install above remains the reference.

**Status:** configuration of the VMs by the recipes (firewall, SSH, swap,
automatic security updates, Docker on the data disk) is **in place** in the
lab. Detecting the data disk on VMware and Hyper-V is **planned** (the recipe
currently knows the lab's disk name only).

## 2. Network

**One question about the hypervisor network:** do you want a dedicated VLAN
(or port group / virtual switch) for the 4 VMs? Everything else is in the flow
matrix below.

**DNS.** Wildcard records (ADR-022, ADR-015; in place in the lab):

| Name | Points at |
|---|---|
| `*.<domain>` | Tools VM (production of the generated tools, one name per tool, approved at Gate 1) |
| `*.<previews domain>` and `mockup.<previews domain>` | CI VM (previews and scoping mock-ups) |
| `git.<domain>` | The forge (Platform VM) |
| `auth.<domain>` | Sign-in, Keycloak (Platform VM) |
| `chat.<domain>` | The requesters' page (Platform VM) |

**Previews domain: pick in this order (ADR-015).** Previews and mock-ups
run code that no human has approved yet. Browsers scope cookies by domain,
not by machine: under your main domain, a preview could set a cookie valid
for it and all your applications (forge, intranet, corporate sign-in), and
`SameSite` does not stop this. This is why GitHub, Vercel and Netlify serve
such content under a separate domain.

1. **A separate domain bought for this** (default): for example
   `preview-tools.com`, a few euros a year. Automatic public certificates
   (Let's Encrypt, DNS validation: we need access to your DNS host's API, no
   inbound Internet access). Nothing to install on workstations. The
   simplest option without an IT department.
2. **A `.internal` name** (for example `tools.internal`), reserved by ICANN
   for private use: nothing to buy, but you need internal DNS and an internal
   certificate authority installed on workstations (often already there with
   Active Directory). For IT departments that cannot buy a domain.
3. **A subdomain of your main domain** (`preview.<domain>`), as a last
   resort: the generated tools stay protected (mandatory `__Host-` cookies,
   `Domain` attribute stripped from cookies by the platform), but a preview's
   JavaScript can still set a cookie on your main domain. This risk must be
   accepted in writing.

Today the recipes implement option 3 only (`*.preview.<domain>` and
`mockup.<domain>`); a separate previews domain is **planned**. Production
tools stay under your domain: their code has passed the human approvals.

**HTTPS certificates: open, to agree with you.** Public certificates from
Let's Encrypt need no inbound Internet access with DNS validation, only access
to your DNS host's API (in place in the lab, with OVH as the DNS host). On a
purely internal network, the likely answer is a certificate from your
internal certificate authority (or a wildcard you supply); support for a
supplied certificate is **planned**.

**Proxy.** All outbound traffic can go through your HTTP(S) proxy, including
a proxy that **inspects TLS**: in that case, give us your internal CA
certificate so the VMs and containers trust it. Proxy support in the recipes
(system packages, Docker, CI jobs) is **planned**; the prerequisite check
recipe will test every outbound domain **through your proxy**.

### Flow matrix

Outbound flows are given as **domain names**, never IP addresses. Port 443
means HTTPS through your proxy.

**Inbound and internal**

| # | Source | Destination | Port | Purpose | Status |
|---|---|---|---|---|---|
| 1 | User workstations | Platform VM | 443/TCP (80 redirects to 443) | Forge web interface, sign-in (`auth.<domain>`), the requesters' page (`chat.<domain>`); later the gate pages | In place (forge, sign-in, requesters' page); planned (gate pages) |
| 2 | User workstations | Tool VMs | 443/TCP | Using the generated tools | In place in the lab (one entry point per tool VM); routing at your site (one entry point or one per VM) **open** |
| 3 | Your VPN or bastion | All 4 VMs | 22/TCP | Administration by the operator (Ansible over SSH) | In place (SSH by key only) |
| 4 | CI VM | Platform VM | 443/TCP | CI runners fetch work, pull and publish images | In place |
| 5 | Tool VMs | Platform VM | 443/TCP | Pull approved images from the forge registry; sign-in of the tools' users (Keycloak); calls between tools | In place in the lab (images, sign-in); planned (calls between tools) |
| 6 | Platform VM | All VMs | 443/TCP | Health checks (Gatus) | Planned |

**Outbound**

| # | Source | Destination (domain) | Port | Purpose | Status |
|---|---|---|---|---|---|
| 7 | All VMs | Your DNS and NTP servers | 53, 123/UDP | Name resolution, time | Required |
| 8 | All VMs | `archive.ubuntu.com`, `security.ubuntu.com` (or your Ubuntu mirror) | 80/443 | System packages, daily security updates; Docker comes from Ubuntu's own packages | In place |
| 9 | All VMs | `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | 443 | Public container images (PostgreSQL, Caddy, Gitea, CI runners, scanner), all pinned by digest | In place |
| 10 | CI VM | `ghcr.io`, `pkg-containers.githubusercontent.com`, `mirror.gcr.io` | 443 | Dynamic security scanner image (preview checks); vulnerability database of the scanner (Trivy) | In place; exact domains **to be confirmed** by the check recipe |
| 11 | CI VM | `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `proxy.golang.org`, `sum.golang.org`, `deb.debian.org` | 443 | Pinned CI building blocks and the weekly rebuild of the base image (security tools, Debian packages) | In place |
| 12 | CI VM, Platform VM (agents) | `registry.npmjs.org` | 443 | JavaScript packages of the tools and of the base image | In place |
| 13 | Platform VM (agents) | `api.anthropic.com` | 443 | Calls to the AI model, key in your name | In place in the lab (through the AI proxy) |
| 14 | Platform VM | Your directory: AD over LDAPS (636/TCP), or Entra ID (`login.microsoftonline.com`, 443) | 636 / 443 | Sign-in of your users through Keycloak | Planned |
| 15 | Platform VM | Your SMTP relay | 25 or 587 | Email notifications (gates, alerts). Microsoft 365: basic SMTP authentication is being retired (end of 2026, to be confirmed with Microsoft) — provide a relay by IP or certificate, or OAuth2 | Planned, optional |
| 16 | All VMs | Your backup target (S3-compatible, SFTP or NFS) | 443 / 22 / 2049 | Copy of application backups outside the VMs | Planned |
| 17 | Platform VM | Operator's alerting and external probe | 443 | Alerts reaching the operator; liveness check from outside | Planned; direction and domain **open** |
| 18 | Platform VM, CI VM, tool VMs | `acme-v02.api.letsencrypt.org`; your DNS host's API (OVH today: `eu.api.ovh.com`) | 443 | Public certificates by DNS validation (Let's Encrypt), if you choose them | In place in the lab |
| 19 | Platform VM, CI VM, tool VMs | `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `gcr.io`, `quay.io`, `registry.access.redhat.com`, `downloads.claude.ai`, `gvisor.dev`, `storage.googleapis.com` | 443 | Pinned binaries and images fetched by the recipes and by the builds of the platform images (cosign, Smokescreen, Keycloak, Claude Code, gVisor) | In place; exact domains **to be confirmed** by the check recipe |

**Never exposed** (in place, unless marked):

- Nothing is published on the Internet; no inbound Internet flow is required.
- Each VM's firewall denies all inbound traffic except SSH (22), plus HTTPS
  (443) on the VMs that serve web traffic (and 80 on the forge, redirected to
  443).
- SSH: key only, no password, no root login.
- PostgreSQL databases publish no port, except the orchestrator's, reachable
  from the agents only (TLS 1.3 with a client certificate, firewall rule); the
  forge's internal port listens on the VM itself only (`127.0.0.1`).
- Git access is HTTPS with a token only; the forge runs no SSH server.
- The Docker API is never reachable from the network; CI jobs that run code
  written by agents have no Docker access at all.
- The secrets store (OpenBao, **planned**) will never be exposed either.

## 3. Accounts and access

**Operator access (remote administration).**

- Through **your VPN or your bastion**, **nominative**, with **MFA**, and
  **logged** on your side. You open it and can cut it at any time. Aligned
  with ANSSI guide PA-022 (secure administration).
- A dedicated SSH key per client, kept on a dedicated administration
  workstation; the VMs accept keys only (in place).
- One inventory and one encrypted secrets vault per client on the operator's
  side (in place in the lab).

**Accounts on the VMs.**

- `ansible`: the administration account described above (in place).
- `diagnostic`: read-only SSH account without administration rights, used to
  run read-only diagnostic recipes (**planned**). Corrections are always
  applied by the operator, never by this account.

**Your directory.**

- Users sign in through **Keycloak** (standard OIDC), connected to your Active
  Directory (LDAPS, read-only service account) or to Entra ID (an app
  registration) (**planned**).
- We need **no privileged account** in your directory: a read-only service
  account (AD) or an app registration (Entra ID), and three groups you manage:
  requesters, approvers, administrators.
- Approvals (gates) are given by a **business referent**; your IT department
  is notified and has a **veto** on sensitive tools or tools on the hardened
  profile (decision no. 12; the gate pages are **planned**).

## 4. Backup, disaster recovery, reversibility

**Two tiers, written down.**

| Tier | Who | What | Status |
|---|---|---|---|
| 1. Whole VMs | Your IT department, with your usual tool (Veeam, Hyper-V, Proxmox Backup Server…) | The 4 VMs | Your scope; useful when everything is lost |
| 2. Application data | EupaDev | Forge (repositories, registry, database) with `gitea dump`, orchestrator and Keycloak databases with `pg_dump`; every night at 02:30 UTC; 7 kept (4 on the forge); real restore tested automatically | In place on the lab, **stored on the VM only** |
| 2b. Copy outside the VMs | EupaDev, to a target you provide (S3-compatible, SFTP or NFS) | Encrypted copy of tier 2 (restic) | **Planned** |
| 2c. Tool databases | EupaDev | One `pg_dump` per tool database, every night | In place on the lab (tools VM), **stored on the VM only** |

Why two tiers: a live VM backup of a database is not guaranteed to be
consistent; the application backup is. Please schedule your VM backups
outside the 02:30 UTC window (the forge stops for about 30 seconds then).

**Disaster recovery.** Rebuilding = new blank Ubuntu VMs (section 1) + the
Ansible recipes + restoring the latest application backup. The restore
procedure is documented (`infra/README.md`) and the restore is tested every
time in disposable containers (in place). A full rebuild exercise without
the usual operator is **planned**. Recovery point: at most one day of data
(nightly backup). Recovery time: **not measured yet**, no figure promised.

**Reversibility.** Everything is reconstructible and in standard formats:
the tools' code is in **your** forge (plain Git), their images in **your**
registry, databases are standard PostgreSQL dumps, and the recipes are open
source (Apache 2.0). Handing over the per-client secrets vault at the end of
the contract is **open** (it is required to restore a backup).

## 5. Data and AI

- **The AI key is in your name.** You contract directly with the AI provider
  (Anthropic); the provider is your subcontractor, the operator is not an
  intermediary on that flow (decision no. 11).
- **What is sent to the AI:** the scoping conversation, the tools' code and
  synthetic test data. **No production data is ever sent to the AI**
  (decision no. 15; the enforcing checks are **planned**).
- **Spending caps**: per agent task (in place: the engine gives each task a
  cost cap); per tool and per month (**planned**; today the AI provider's
  workspace spending limit).
- **Data processing agreement:** a DPA (GDPR art. 28) is signed between you
  and the operator, who administers VMs that contain personal data.
- **Diagnostic with an AI assistant** (optional): read-only recipes,
  personal data masked, corrections applied by the operator, only with your
  consent written in the DPA; not offered to very sensitive clients
  (decision no. 10, **planned**).
- **Transparency:** the scoping chat tells users they are talking to an AI
  (EU AI Act art. 50); Gate 1 asks whether a tool uses AI for an HR purpose
  (high risk) (**planned**).
- **Open: EU processing of the AI calls.** With the provider's API directly,
  processing may happen outside the EU; EU processing is possible through
  Amazon Bedrock or Google Vertex AI, which Claude Code supports but the
  platform does not use yet (`docs/governance.md`).

This section is not legal advice.

## 6. Open points

| Point | Owner |
|---|---|
| EU processing of the AI calls (Amazon Bedrock or Google Vertex AI, not wired in the platform yet), and the provider's transfer terms | Operator, before the offer |
| HTTPS certificates on an internal network (internal CA, supplied wildcard) | Operator + your IT department |
| How users reach the tools on the tool VMs (one entry point or one per VM) | Operator, design |
| Proxy with TLS inspection: support in the recipes, test through your proxy | Operator (planned) |
| Hyper-V and VMware compatibility (disk detection, Secure Boot) | Operator, lab test |
| Direction of the external monitoring probe (inbound or outbound) | Operator + your IT department |
| Handing over the secrets vault for reversibility | Contract |
| VM sizes | Measured during the first real runs |

## 7. Ready-for-installation checklist

- [ ] 4 VMs created, sizes agreed (section 1), each with a system disk and a
      data disk.
- [ ] Ubuntu Server 24.04 LTS installed from the official ISO, nothing added.
- [ ] Account `ansible` with password-less `sudo` and our SSH public key
      (appendix).
- [ ] Fixed IP addresses, DNS and NTP configured; the list of IPs sent to the
      operator.
- [ ] VLAN / port group decided.
- [ ] Previews domain chosen (section 2, ADR-015): separate domain,
      `.internal`, or subdomain with the risk accepted in writing; DNS
      wildcards created.
- [ ] Certificate choice made (internal CA or supplied wildcard); internal CA
      certificate sent if needed.
- [ ] Proxy address sent; outbound domains of the flow matrix allowed;
      internal CA certificate sent if the proxy inspects TLS.
- [ ] Inbound flows 1-6 and internal flows open between the VMs.
- [ ] Nominative, MFA-protected, logged access through your VPN or bastion
      opened for the operator.
- [ ] Directory: read-only service account (AD) or app registration (Entra
      ID); groups requesters / approvers / administrators created.
- [ ] Business referent for the gates named; IT veto on sensitive tools
      agreed.
- [ ] Tier 1 VM backup scheduled outside 02:30 UTC; backup target for tier 2
      provided (when available).
- [ ] AI provider account and key in your name; DPA signed with the operator.
- [ ] Security agent (EDR) on Linux, if any, announced.

The **prerequisite check recipe** (Ansible, **planned**) will verify these
points automatically and produce an "OK / missing" report to attach to the
installation record.

## Appendix: creating the `ansible` account

After the ISO install, logged in on the VM console with the account created
during installation, one command at a time (replace the file name with the
key we send you, copied onto the VM beforehand, for example with `scp`
from a workstation):

```sh
sudo adduser --disabled-password --gecos "" ansible
echo "ansible ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ansible
sudo chmod 440 /etc/sudoers.d/ansible
sudo install -d -m 700 -o ansible -g ansible /home/ansible/.ssh
sudo install -m 600 -o ansible -g ansible eupadev-client.pub /home/ansible/.ssh/authorized_keys
```

The recipes then disable password login over SSH and root login.
