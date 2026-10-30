# Keycloak image of the platform

Repository `keycloak` of the forge, synced by Ansible (`gitea_platform_repos`)
from EupaDev: this directory at the root, plus the installation's public
key copied to its original path (`images/engine/cosign.pub`).

The `Dockerfile` starts from the official image `quay.io/keycloak/keycloak` by
digest and builds it for PostgreSQL (`kc.sh build`: database, health and
metrics on the management port 9000); it starts with `start --optimized`
(Keycloak docs "Running Keycloak in a container").

The pipeline `.gitea/workflows/publish.yml` builds the image, scans it
(Trivy, fixable HIGH/CRITICAL), checks its promises (non-root, version,
PostgreSQL), publishes it to the forge's registry, signs it with cosign using
the installation's key (repository secrets `COSIGN_PRIVATE_KEY` and
`COSIGN_PASSWORD`, no public transparency log) and checks the
signature with `images/engine/cosign.pub`. Its log ends with
`Keycloak digest: <registry>/eupadev/keycloak@sha256:…`, the value to
put in `keycloak_image` (`infra/ansible/group_vars/orchestrator/vars.yml`);
`ansible-playbook engine-digest.yml -e repo=keycloak` reads it.

Upgrading: new digest in both `FROM` (same version, read through the
registry API), expected version in the pipeline, then
`site.yml --limit eupadev-forge` and the new digest in
`keycloak_image`. Always a dump of the `keycloak` database first (the schema
has no rollback: `docs/reflexions/2026-10-15-analyse-keycloak.md`, D10).
