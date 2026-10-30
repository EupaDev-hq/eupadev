# EupaDev engine image

Repository `engine` of the forge, synchronised by Ansible (`gitea_platform_repos`)
from EupaDev: this folder at the root, plus the build context
of the engine at its original path (`orchestrator/Dockerfile`, its sources,
its migrations and `tool-template/agents/report.schema.json`).

The pipeline `.gitea/workflows/publish.yml` builds the image
(`docker build -f orchestrator/Dockerfile .`), scans it (Trivy), publishes it
in the forge's registry, signs it with cosign using the repository's key
(secrets `COSIGN_PRIVATE_KEY` and `COSIGN_PASSWORD`, with no public
transparency log) and checks the signature with `cosign.pub`. Its log
ends with `Engine digest: <registry>/eupadev/engine@sha256:…`,
the value to put in `orchestrator_image`
(`infra/ansible/group_vars/orchestrator/vars.yml`).

`cosign.pub` is created with the private key by `infra/ansible/init-vault.sh`
(vault `group_vars/forge/vault-cosign.yml`): specific to each installation,
versioned so that the deployment checks with the same key.
