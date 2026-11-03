# EupaDev golden image (Node.js 24)

Base image of every generated tool, and image of the CI jobs. Built, scanned (Trivy) and
published by the forge's CI (`.gitea/workflows/publish.yml`) on every
change and every Monday, to take in the security fixes.

| Variant | Tag | Use |
|---|---|---|
| build | `base-node:build-24` | build stage of a tool (pnpm ready) |
| run | `base-node:run-24` | final image of a tool (non-root, no npm/corepack/yarn) |
| ci | `base-node:ci-24` | CI golden image: image of the `secrets`, `tests`, `analysis`, `guard-rails` jobs (runner `ci-standard`, no Docker) |

Each build also gets a dated tag (`build-24-YYYYMMDD`,
`run-24-YYYYMMDD`, `ci-24-YYYYMMDD`). The tools' pipelines read the address of the two
variants from the organisation variables `BASE_IMAGE_BUILD` and
`BASE_IMAGE_RUN` (set by Ansible): the template stays independent of the
installation.

## Pinned pnpm, for any user and without network (build and ci variants)

pnpm 12.16.1 is installed by corepack in a shared cache, readable by
all (`COREPACK_HOME=/usr/local/share/corepack`), and not in root's
`$HOME`: under any uid (e.g. 10001 of `images/agent`), `pnpm --version`
answers 12.16.1 without downloading anything. corepack may no longer use the
network (`COREPACK_ENABLE_NETWORK=0`, `COREPACK_DEFAULT_TO_LATEST=0`): a
project whose `packageManager` asks for another pnpm version fails instead
of downloading an unpinned one. Upgrading: change the Dockerfile
(and the template's `packageManager`) in the same PR.

## ci variant (CI golden image, ROADMAP §8.11 no. 20)

The jobs that run the agents' code have **no access to Docker**
(ROADMAP §8.14 B): the check tools are therefore in the image, in
pinned versions, instead of being run by `docker run`.

| Tool | Version | Licence | Origin |
|---|---|---|---|
| Node.js + pnpm | 24 / 12.16.1 | MIT | build variant |
| gitleaks | 8.30.1 | MIT | recompiled from the Go module (checked by sum.golang.org) with Go 1.27.3 and `golang.org/x/crypto`, `x/text` raised: the published binary ships an old Go that Trivy refuses |
| hadolint | 2.15.1 | GPL-3.0 | official binary, sha256 digest checked |
| Opengrep | 1.30.0 | LGPL-2.1 | official binary, sha256 digest checked |
| git | Debian | GPL | up-to-date Debian package |

Licences: these tools are run from the command line by the CI, never
embedded in a delivered tool (ROADMAP §8.11, licences). Root user
(throwaway container, without Docker or privileges); `LANG=C.UTF-8` (otherwise
Opengrep fails on the first accented letter). The jobs name it by the
organisation variable `CI_IMAGE` and pull it with the read badge.

This directory is copied into the forge's `base-image` repository by the
Ansible recipe (`gitea_platform_repos`).
