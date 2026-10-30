# Caddy image of the platform

Repository `caddy` of the forge, synchronised by Ansible (`gitea_platform_repos`)
from EupaDev: this folder at the root, plus the public key of the
installation copied at its original path (`images/engine/cosign.pub`).

The `Dockerfile` builds the official Caddy (builder image by digest, `xcaddy`)
with the OVH DNS module `github.com/caddy-dns/ovh` (pinned), so that every
public Caddy of the platform (forge, `auth.<domain>` and the chat page,
Previews and mock-ups, Prod) obtains its Let's Encrypt certificates by the
DNS-01 challenge at OVH (ADR-015, option 1): wildcard certificates, nothing
exposed to the Internet. The binary is copied into the official runtime image,
by digest.

The pipeline `.gitea/workflows/publish.yml` builds the image, scans it (Trivy,
fixable HIGH/CRITICAL), checks its promises (Caddy version, OVH module
present), publishes it in the forge registry, signs it by cosign with the key
of the installation (repository secrets `COSIGN_PRIVATE_KEY` and
`COSIGN_PASSWORD`, no public transparency log) and verifies the signature with
`images/engine/cosign.pub`. Its log ends with
`Caddy digest: <registry>/eupadev/caddy@sha256:…`, the value to put
in `caddy_image` (`infra/ansible/group_vars/all/vars.yml`);
`ansible-playbook engine-digest.yml -e repo=caddy` reads it.

Upgrading: new digests in the two `FROM` (same version, read from the registry
API), version expected by the pipeline, module version in `xcaddy build`, then
`site.yml --limit eupadev-forge` and the new digest in `caddy_image`.
