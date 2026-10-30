#!/bin/sh
# Creates, once per installation, the encrypted vaults of the secrets:
#   - ~/.eupadev-vault-pass: password of the vaults (outside the repository, 0600)
#   - group_vars/all/vault.yml: secrets of the forge, generated at random
#   - group_vars/orchestrator/vault.yml: secrets of the orchestrator
#   - group_vars/orchestrator/vault-accounts.yml: PostgreSQL accounts of the orchestrator
#   - group_vars/forge/vault-cosign.yml: signing key of the engine image
#     (and images/engine/cosign.pub, to commit)
#   - group_vars/forge/vault-cosign-tools.yml: signing key of the images of
#     the generated tools (and files/cosign-tools.pub, to commit)
#   - group_vars/all/vault-deployer.yml: SSH key of the engine to the deployment
#     targets (ADR-014), generated in a temporary directory (never ~/.ssh)
#   - group_vars/all/vault-db-pki.yml: certificate authority of the orchestrator
#     database (verified TLS, client certificate of the executor)
#   - group_vars/orchestrator/vault-keycloak.yml: secrets of Keycloak (lab)
#   - group_vars/orchestrator/vault-keycloak-web.yml: client eupadev-web (web page)
#   - group_vars/orchestrator/vault-keycloak-tools.yml: configuration client
#     of the realm tools
#   - group_vars/agents/vault-ai.yml: Anthropic API key of the AI proxy,
#     not generated: ANTHROPIC_KEY_FILE=<file> ./init-vault.sh
#   - group_vars/all/vault-ovh.yml : OVH API credentials of the Caddys (Let's
#     Encrypt DNS-01), not generated: OVH_CREDS=<file> ./init-vault.sh
# Nothing is printed. Never replaces nor reads an existing vault: run again
# after a machine is added, it creates only the missing vault.
# To read a secret later: ansible-vault view <vault>
set -eu
cd "$(dirname "$0")"
PASS_FILE="$HOME/.eupadev-vault-pass"

if [ ! -e "$PASS_FILE" ]; then
  (umask 077; python3 -c 'import secrets; print(secrets.token_urlsafe(48))' > "$PASS_FILE")
fi

# create_vault <path> <python program that writes the secrets>
# Generated in a temporary file, put in place only once encrypted: a failure
# never leaves clear secrets at the vault's location.
create_vault() {
  if [ -e "$1" ]; then echo "Vault already present ($1), nothing to do."; return; fi
  mkdir -p "$(dirname "$1")"
  TMP="$1.tmp"
  trap 'rm -f "$TMP"' EXIT
  (umask 077; python3 -c "$2" > "$TMP")
  # Output into a file: Ansible requires "blocking" output.
  ansible-vault encrypt "$TMP" </dev/null >"$TMP.log" 2>&1 || { cat "$TMP.log"; rm -f "$TMP.log"; exit 1; }
  rm -f "$TMP.log"
  mv "$TMP" "$1"
  trap - EXIT
  echo "Vault created and encrypted: $1"
}

create_vault group_vars/all/vault.yml '
import secrets
gen = lambda n=32: secrets.token_urlsafe(n)
print(f"vault_gitea_db_password: {gen()}")
print(f"vault_gitea_admin_password: {gen(24)}")
print(f"vault_gitea_secret_key: {gen(48)}")
print(f"vault_gitea_internal_token: {gen(48)}")
# Gitea expects exactly 32 bytes encoded in base64url (43 characters).
print(f"vault_gitea_jwt_secret: {gen(32)}")
'

create_vault group_vars/orchestrator/vault.yml '
import secrets
print(f"vault_orch_db_password: {secrets.token_urlsafe(32)}")
'

# PostgreSQL accounts of the orchestrator (step 6): a separate vault, so as
# never to read nor change the existing one.
create_vault group_vars/orchestrator/vault-accounts.yml '
import secrets
print(f"vault_orch_owner_password: {secrets.token_urlsafe(32)}")
print(f"vault_orch_engine_password: {secrets.token_urlsafe(32)}")
'

# cosign signing key of the engine image (ROADMAP §8.16 M2, ADR-005):
# generated here, on the administrator's machine, by the official cosign
# image (by digest, without network), in a temporary directory deleted right
# away. The private key (encrypted by its password) and the password go into
# the vault; the public key is written to images/engine/cosign.pub, to
# commit: the deployment checks with it. A rebuild of the forge keeps the
# same key (the vault survives), so the signatures stay valid.
COSIGN_IMAGE=ghcr.io/sigstore/cosign/cosign:v3.1.3@sha256:9e5c2f2edc34351160407ca3416c61855bdf9403c3c5936e0f0be7fc261611b8
export COSIGN_IMAGE
COSIGN_PROG='
import os, secrets, shutil, subprocess, sys, tempfile
key_password = secrets.token_urlsafe(32)
with tempfile.TemporaryDirectory() as d:
    r = subprocess.run(["docker", "run", "--rm", "--network", "none", "-u", f"{os.getuid()}:{os.getgid()}",
                        "-e", "COSIGN_PASSWORD", "-v", f"{d}:/keys", "-w", "/keys", os.environ["COSIGN_IMAGE"],
                        "generate-key-pair"], env={**os.environ, "COSIGN_PASSWORD": key_password}, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("cosign generate-key-pair failed: " + r.stderr.strip())
    with open(os.path.join(d, "cosign.key")) as f:
        private = f.read()
    shutil.copyfile(os.path.join(d, "cosign.pub"), os.environ["COSIGN_PUB"])
    os.chmod(os.environ["COSIGN_PUB"], 0o644)
v = os.environ["COSIGN_VAR"]
print(f"{v}_password: {key_password}")
print(f"{v}_private_key: |")
for line in private.splitlines():
    print("  " + line)
'
# Program shared by both keys: COSIGN_PUB = where to write the public key,
# COSIGN_VAR = prefix of the vault variables.
export COSIGN_PUB COSIGN_VAR
COSIGN_PUB=../../images/engine/cosign.pub COSIGN_VAR=vault_cosign
create_vault group_vars/forge/vault-cosign.yml "$COSIGN_PROG"

# Signing key of the images of the generated TOOLS (ADR-014, decision no. 5
# of 2026-10-14): distinct from the engine's and the agents', so a CI that
# builds agent code can never produce a signature accepted for an image of
# the platform. Same making; the private key goes into the secrets of the
# Gitea organisation (gitea_org_secrets), the public one into
# infra/ansible/files/cosign-tools.pub, to commit: the deployer's targets
# check with it. Rotation: delete this vault and the two COSIGN_TOOLS_*
# secrets of the organisation, run this script again, commit the new public
# key, then site.yml.
COSIGN_PUB=files/cosign-tools.pub COSIGN_VAR=vault_cosign_tools
create_vault group_vars/forge/vault-cosign-tools.yml "$COSIGN_PROG"

# SSH key of the engine to the target VMs (ADR-014, E5b): ed25519 without a
# passphrase (the engine uses it alone), generated by ssh-keygen in a
# temporary directory deleted right away, never in ~/.ssh. Both halves go
# into the vault: the public one is set (forced command) on the targets, the
# private one goes to the engine (systemd-creds, E5d). Rotation: delete this
# vault, run this script again, then site.yml.
create_vault group_vars/all/vault-deployer.yml '
import os, subprocess, sys, tempfile
with tempfile.TemporaryDirectory() as d:
    key = os.path.join(d, "deployer")
    r = subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "eupadev-deployer", "-f", key],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        sys.exit("ssh-keygen failed: " + r.stderr.strip())
    private = open(key).read()
    public = open(key + ".pub").read().strip()
print(f"vault_deployer_ssh_public_key: \"{public}\"")
print("vault_deployer_ssh_private_key: |")
for line in private.splitlines():
    print("  " + line)
'

# Certificate authority of the orchestrator database (note
# docs/reflexions/2026-10-15-note-lanceur-service.md, correction 4): PostgreSQL
# over verified TLS (verify-full) and client certificate required from the
# executor of the agents VM (clientcert=verify-full). Authority dedicated to
# this one link (not Caddy's): ECDSA P-256, 10 years, signs only end
# certificates (pathlen 0). Generated by openssl in a temporary directory
# deleted right away; the server and client certificates are issued by Ansible
# (community.crypto, keys generated on the VMs, never copied). Rotation: delete
# this vault, run this script again, then site.yml.
create_vault group_vars/all/vault-db-pki.yml '
import os, subprocess, sys, tempfile
with tempfile.TemporaryDirectory() as d:
    key, crt = os.path.join(d, "ca.key"), os.path.join(d, "ca.crt")
    r = subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
                        "-keyout", key, "-out", crt, "-days", "3650", "-subj", "/CN=EupaDev - orchestrator database",
                        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
                        "-addext", "keyUsage=critical,keyCertSign,cRLSign"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        sys.exit("openssl (database authority) failed: " + r.stderr.strip())
    private, certificate = open(key).read(), open(crt).read()
for name, pem in (("vault_db_pki_ca_key", private), ("vault_db_pki_ca_crt", certificate)):
    print(f"{name}: |")
    for line in pem.splitlines():
        print("  " + line)
'

# Keycloak in the lab (docs/reflexions/2026-10-15-note-keycloak-labo.md): database,
# bootstrap admin (temporary, deleted by Ansible after the creation of the
# configuration client), Ansible's configuration client, check clients of the
# lab (verify-*.yml) and temporary password of Ilan's account (change required
# at the first sign-in; read with ansible-vault view, in a separate terminal).
create_vault group_vars/orchestrator/vault-keycloak.yml '
import secrets
for name in ("db_password", "bootstrap_admin_password", "config_secret",
            "check_requester_secret", "check_admin_secret", "ilan_temp_password"):
    print(f"vault_keycloak_{name}: {secrets.token_urlsafe(32)}")
'

# Named administrator of the Keycloak console (realm master, D5): temporary
# password of ilan-admin; change and OTP enrolment required at the first
# sign-in (read with ansible-vault view, in a separate terminal).
create_vault group_vars/orchestrator/vault-keycloak-admin.yml '
import secrets
print(f"vault_keycloak_admin_ilan_temp_password: {secrets.token_urlsafe(32)}")
'
# Chat step 2 (ADR-024): secret of the confidential client eupadev-web, the
# engine's server-side sign-in for the requesters' web page.
create_vault group_vars/orchestrator/vault-keycloak-web.yml '
import secrets
print(f"vault_keycloak_web_secret: {secrets.token_urlsafe(32)}")
'
# Configuration client of the realm tools (R8, tools-config: realm-admin of
# the realm tools only, D5). The secrets of the trial client and of the test
# people are not in it: generated by Keycloak, or absent (note 2026-10-18).
create_vault group_vars/orchestrator/vault-keycloak-tools.yml '
import secrets
print(f"vault_keycloak_tools_config_secret: {secrets.token_urlsafe(32)}")
'
[ -e ../../images/engine/cosign.pub ] || echo "WARNING: images/engine/cosign.pub missing (cosign vault created elsewhere?)."
[ -e files/cosign-tools.pub ] || echo "WARNING: files/cosign-tools.pub missing (cosign vault of the tools created elsewhere?)."

# Anthropic API key of the AI proxy (ROADMAP §8.16 L4): key of a service
# account limited to the workspace dedicated to the agents (spending limit).
# Provided by the administrator in a file (cat > file, then Ctrl-D), never as
# an argument nor printed; delete the file afterwards. Without
# ANTHROPIC_KEY_FILE, this vault is simply skipped (the agents VM is not
# configured without it).
if [ -n "${ANTHROPIC_KEY_FILE:-}" ]; then
  create_vault group_vars/agents/vault-ai.yml '
import json, os, sys
with open(os.path.expanduser(os.environ["ANTHROPIC_KEY_FILE"])) as f:
    key = f.read().strip()
if len(key) < 20 or any(c.isspace() for c in key):
    sys.exit("ANTHROPIC_KEY_FILE: file empty, too short or key containing spaces.")
print(f"vault_anthropic_api_key: {json.dumps(key)}")
'
elif [ ! -e group_vars/agents/vault-ai.yml ]; then
  echo "Vault group_vars/agents/vault-ai.yml absent: rerun with ANTHROPIC_KEY_FILE=<file holding the key>."
fi

# OVH API credentials of the public Caddys (Let's Encrypt DNS-01, ADR-015):
# an application token restricted to /domain/zone/<domain> (endpoint ovh-eu,
# not secret: group_vars/all). Provided in a file of three lines, in this
# order: application key, application secret, consumer key (cat > file, then
# Ctrl-D), never as an argument; delete the file afterwards. Without
# OVH_CREDS, this vault is skipped (caddy_tls stays internal).
if [ -n "${OVH_CREDS:-}" ]; then
  create_vault group_vars/all/vault-ovh.yml '
import json, os, sys
with open(os.path.expanduser(os.environ["OVH_CREDS"])) as f:
    lines = [l.strip() for l in f if l.strip()]
if len(lines) != 3 or any(len(l) < 8 or any(c.isspace() for c in l) for l in lines):
    sys.exit("OVH_CREDS: three non-empty lines expected (application key, application secret, consumer key).")
for name, value in zip(("application_key", "application_secret", "consumer_key"), lines):
    print(f"vault_ovh_{name}: {json.dumps(value)}")
'
elif [ ! -e group_vars/all/vault-ovh.yml ]; then
  echo "Vault group_vars/all/vault-ovh.yml absent (Let's Encrypt DNS-01): rerun with OVH_CREDS=<file of three lines>."
fi
