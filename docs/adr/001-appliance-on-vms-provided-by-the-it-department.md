---
adr: 001
title: Appliance on VMs provided by the IT department (option C)
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-007]
check: planned
---
## Context
Target: a company of more than 200 employees whose IT department has two
overstretched generalists (VMware, Hyper-V or Proxmox; little Linux and
Docker). EupaDev must be installed and operated there over time,
remotely, by a single person (the operator, a service provider), without
the IT department learning a platform or losing control. Three ways: plug
into the existing setup (A), bring one's own virtualisation (B), ask for
standard Linux VMs and install everything inside them (C).

## Decision
Install EupaDev as an appliance on standard Linux VMs provided by the IT
department, without ever accessing the hypervisor.
- **Responsibilities**: *below* the VMs (hypervisor, network, DNS,
  directory, VM backup) = IT department; *inside* the VMs (EupaDev,
  tools, updates, application backups, monitoring) = operator. A
  prerequisites sheet (`docs/client-prerequisites.md`) says what the IT
  department provides: blank Ubuntu VM, SSH key, network flows listed by
  domain name.
- **Tools** in containers on "tools" VMs; a sensitive tool (HR, payroll,
  personal data) has its own VM, decided at scoping.
- **Access** through the client's VPN or bastion, individual, MFA, logged;
  never open on the Internet. **Operator's workstation**: one SSH key per
  client, never shared, protected (passphrase or hardware token); encrypted
  disk, updates, locked session, MFA on every client access.
- **Reversibility**: everything is described in code (Ansible, Compose) and
  documented, so that another operator or the IT department can take over
  from the blank VMs, the inventory, the vault handed to the client and the
  backups; the contract leaves to the client, at the end of the contract,
  the building blocks of the private repository with their code.
- **AI**: the tools' code and the scoping exchanges go to the AI provider,
  under the key of the client, who accepts it before installation; never
  production data (code and fictitious data only). What the requester types
  in the chat goes there, under their responsibility (notice displayed).
- Terraform/OpenTofu is optional at the client's: the VMs already exist.

## Rejected alternatives
- A, the existing setup as it is — integration and support redone at every
  client.
- B, one's own virtualisation (OpenNebula…) — refusal of one more
  hypervisor; the operator would become the vendor of a cloud, too heavy
  for one person.

## Consequences
- Same environment at every client; the IT department keeps control below
  the VMs and can cut access at any time.
- **A single person**: no round-the-clock on-call; service hours and
  response time in the contract; the IT department knows how to restart or
  restore a VM. Rebuilding from code reduces this risk without removing it.
- **Confidentiality**: a client who refuses the sending to the AI cannot
  use EupaDev as is (except with a model hosted on its premises,
  ADR-013); the chat notice makes users accountable, it filters nothing.
- **Operator's workstation**: if compromised, it opens every client;
  separate keys limit the repair to removing the keys, not the attack. Its
  requirements are contractual commitments.
- **Isolation**: containers share the VM's kernel; hence non-root, quotas,
  network, database and PostgreSQL account per tool, dedicated VM if
  sensitive.
- Takeover clause for the private building blocks: accepted commercial
  cost. The prerequisites (proxy, certificates, DNS) vary: EupaDev adapts
  to them.

## Verification
- An Ansible prerequisites recipe will check the VM (system, resources,
  flows of the sheet) and refuse to install if anything is missing.
- By construction, the client inventory will contain only VMs and no
  installed code will talk to a hypervisor API (the lab's code does not go
  there).
- Reversibility will be proven by a full rebuild from blank VMs, the code
  and the last backup.
- Not mechanically checkable: responsibilities, access, workstation,
  takeover clause, agreement on AI and the chat notice (contract, review of
  the scoping).
