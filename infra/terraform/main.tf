# EupaDev infra: a dedicated private network + the VMs (forge, ci, orch, agents, tools).
#   - forge: Gitea (+ PostgreSQL + Caddy), the code store.
#   - ci   : the runner that executes the pipelines. Separate from the forge
#            because it runs code not checked yet (and needs Docker, hence
#            full rights on its machine): if it is compromised, the forge is
#            not touched.
#
# Provider: local LXD (lab VMs). To move to a hosting provider, only this
# directory changes; the configuration (Ansible) stays identical.

terraform {
  required_version = ">= 1.6"
  required_providers {
    lxd = {
      source  = "terraform-lxd/lxd"
      version = "~> 2.5"
    }
  }
}

provider "lxd" {}

variable "ssh_public_key_file" {
  description = "SSH public key allowed on the VMs (used by Ansible)"
  type        = string
  default     = "ssh_lab.pub"
}

# Same value as base_domain (infra/ansible/group_vars/all/vars.yml): the DNS
# of the network depends on it (raw.dnsmasq, below).
variable "domain" {
  description = "Domain of the platform (Ansible's base_domain)"
  type        = string
  default     = "eupadev.org"
}

# Resolver for the domain's names the lab does not answer (bare domain, www.,
# docs.): not the host's, which sends the whole domain back to the lab
# (lab-host.yml, eupadev-lxd-dns) — a loop.
variable "dns_upstream" {
  description = "DNS resolver for the domain's public names"
  type        = string
  default     = "9.9.9.9"
}

variable "subnet_prefix" {
  description = "Prefix of the dedicated private network (/24)"
  type        = string
  default     = "10.42.0"
}

# Starting sizes, to adjust from the real measures (ROADMAP §8.3): the
# platform must fit on a small VM in a company.
# disk        = system disk (OS only).
# docker_disk = separate disk mounted on /var/lib/docker (images, volumes:
#               database, repositories): if it fills up, the system keeps
#               running (ROADMAP §8.11, decision 1).
variable "vms" {
  type = map(object({ host = number, cpu = number, memory = string, disk = string, docker_disk = string }))
  default = {
    forge = { host = 10, cpu = 2, memory = "4GiB", disk = "15GiB", docker_disk = "60GiB" }
    ci    = { host = 11, cpu = 2, memory = "4GiB", disk = "15GiB", docker_disk = "40GiB" }
    # orch: engine + PostgreSQL + Keycloak (≈ 1.25 GiB, Keycloak lab note).
    orch  = { host = 12, cpu = 2, memory = "6GiB", disk = "15GiB", docker_disk = "20GiB" }
    # agents: containers of the AI agents under gVisor (ROADMAP §8.16 L1). 4 GiB
    # in the lab because of the host machine's memory; 4 vCPU / 8 GiB targeted.
    agents = { host = 13, cpu = 2, memory = "4GiB", disk = "15GiB", docker_disk = "30GiB" }
    # tools: the Prod of the generated tools (ADR-014), never beside the
    # Previews nor the agents' code. 2 vCPU / 3 GiB (Ilan's decision, 2026-10-14).
    tools = { host = 14, cpu = 2, memory = "3GiB", disk = "15GiB", docker_disk = "20GiB" }
  }
}

resource "lxd_volume" "docker" {
  for_each     = var.vms
  name         = "eupadev-${each.key}-docker"
  pool         = "default"
  content_type = "block"
  config       = { size = each.value.docker_disk }
}

# Dedicated network, isolated from any other application network (ROADMAP §3, §5).
resource "lxd_network" "eupadev" {
  name = "eupadev-net"
  config = {
    "ipv4.address" = "${var.subnet_prefix}.1/24"
    "ipv4.nat"     = "true"
    "ipv6.address" = "none"
    # Wildcard DNS of the lab (ADR-014), served by the dnsmasq of the LXD
    # network, which the VMs get by DHCP: every address under the domain goes
    # to the tools VM (Prod), except the more precise names (dnsmasq: the most
    # precise domain wins, subdomains included). At a client: their internal DNS.
    # host-record= : chat.<domain> only (the requesters' page, chat step 6,
    # Ansible's chat_domain) to the orch VM; it overrides address= for that
    # exact name (tried locally with dnsmasq 2.91).
    # local=: the lab names are never forwarded upstream. Without it, an AAAA
    # query (no IPv6 in the lab) went upstream and never came back: curl
    # waited 15 s then gave up (seen on 2026-10-14).
    # `/*.domain/` (dnsmasq >= 2.86) matches the subdomains only: the bare
    # domain and www./docs. (the public project site, reserved names) are
    # resolved upstream, never by the lab (tried locally with dnsmasq 2.91),
    # by var.dns_upstream (seen on 2026-10-29: via the host, a loop).
    "raw.dnsmasq" = <<-EOT
      server=/${var.domain}/${var.dns_upstream}
      local=/*.${var.domain}/
      address=/*.${var.domain}/${var.subnet_prefix}.${var.vms["tools"].host}
      server=/www.${var.domain}/${var.dns_upstream}
      server=/docs.${var.domain}/${var.dns_upstream}
      address=/preview.${var.domain}/${var.subnet_prefix}.${var.vms["ci"].host}
      address=/mockup.${var.domain}/${var.subnet_prefix}.${var.vms["ci"].host}
      address=/git.${var.domain}/${var.subnet_prefix}.${var.vms["forge"].host}
      address=/auth.${var.domain}/${var.subnet_prefix}.${var.vms["orch"].host}
      host-record=chat.${var.domain},${var.subnet_prefix}.${var.vms["orch"].host}
    EOT
  }
}

resource "lxd_instance" "vm" {
  for_each = var.vms

  name  = "eupadev-${each.key}"
  image = "ubuntu:24.04"
  type  = "virtual-machine"

  config = {
    "boot.autostart"       = "false"
    "cloud-init.user-data" = <<-EOT
      #cloud-config
      users:
        - name: ansible
          groups: sudo
          shell: /bin/bash
          sudo: "ALL=(ALL) NOPASSWD:ALL"
          lock_passwd: true
          ssh_authorized_keys:
            - ${trimspace(file(var.ssh_public_key_file))}
      ssh_pwauth: false
      package_update: true
      packages: [python3]
    EOT
  }

  # The very first start (image download, cloud-init) can exceed the default
  # timeout: without this, Terraform marks as failed a VM that simply starts
  # slowly.
  timeouts = {
    create = "15m"
  }

  limits = {
    cpu    = each.value.cpu
    memory = each.value.memory
  }

  device {
    name = "eth0"
    type = "nic"
    properties = {
      network        = lxd_network.eupadev.name
      "ipv4.address" = "${var.subnet_prefix}.${each.value.host}"
    }
  }

  device {
    name = "root"
    type = "disk"
    properties = {
      pool = "default"
      path = "/"
      size = each.value.disk
    }
  }

  # Seen in the VM as /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_lxd_docker.
  device {
    name = "docker"
    type = "disk"
    properties = {
      pool   = "default"
      source = lxd_volume.docker[each.key].name
    }
  }
}

output "ips" {
  value = { for k, v in var.vms : k => "${var.subnet_prefix}.${v.host}" }
}
