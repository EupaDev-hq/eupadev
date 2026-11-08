# EupaDev golden image — base of every generated tool (Node.js 24, Debian 13).
# Prepared once, checked, rebuilt every week by the forge's CI: a flaw fixed
# here is fixed for every tool at its next build, and no agent can weaken
# this base.
#
# Three variants (targets):
#   build — for the build stage of a tool: pnpm ready to use.
#   run   — for the final image of a tool: hardened, no package manager,
#           non-root user.
#   ci    — CI golden image: the jobs that run the agents' code (secrets,
#           tests, analysis) run there WITHOUT access to Docker; the check
#           tools are therefore preinstalled, in pinned versions.

# Debian 13 "trixie" (stable): bookworm has only partial LTS support since
# 11/07/2026. The short alias "22-slim" still points to bookworm: always pin
# "-trixie-slim".
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS common
# Debian security fixes already published: the pinned official image does
# not update itself between two rebuilds.
# hadolint ignore=DL3005
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

FROM common AS build
# Shared corepack cache (corepack 0.36 docs: COREPACK_HOME, "Offline
# Workflow"): by default it lives in $HOME, so /root; another user (agents,
# uid 10001) saw nothing there and corepack fetched the latest pnpm from the
# registry. Here, readable by all, filled once: `corepack install -g` puts
# pnpm and its "Known Good Release" there.
# COREPACK_DEFAULT_TO_LATEST=0: never ask the registry for the latest
# version nor move the Known Good Release.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_DEFAULT_TO_LATEST=0
# The corepack shipped with Node (0.36.0 in 24.22.1) installs pnpm 12; an
# older one could not. npm and yarn are then removed: they are no longer
# used (pnpm is enough) and npm ships dependencies regularly flagged by Trivy.
RUN corepack enable && corepack install -g pnpm@12.16.1 \
    && chmod -R a+rX "$COREPACK_HOME" \
    && pnpm --version \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
# No more network for corepack (docs: COREPACK_ENABLE_NETWORK=0): pnpm 12.16.1
# is in the cache; a `packageManager` asking for another version fails
# clearly instead of downloading an unpinned pnpm.
ENV COREPACK_ENABLE_NETWORK=0

FROM common AS run
# The final image only needs `node`: npm, npx, corepack and yarn are
# removed (less attack surface, and a frequent source of flaws flagged by
# the scanners).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
WORKDIR /app
# DL3066: user `node` provided by the official image, on purpose.
# hadolint ignore=DL3066
USER node

# gitleaks recompiled: the published binary ships an old Go and old
# golang.org/x dependencies, in which Trivy flags dozens of flaws. Source
# code downloaded as a Go module (checked by sum.golang.org), then compiled
# with an up-to-date Go and these dependencies raised to their fixed
# version (same API: golang.org/x modules in v0).
FROM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS gitleaks
WORKDIR /src
# pipefail: a failure of `go mod download` must not be hidden by sed.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN cp -r "$(go mod download -json github.com/zricethezav/gitleaks/v8@v8.30.1 \
      | sed -n 's/^\t"Dir": "\(.*\)",$/\1/p')/." . && chmod -R u+w . \
    && go get golang.org/x/crypto@v0.56.0 golang.org/x/text@v0.41.0 github.com/klauspost/compress@v1.18.7 && go mod tidy \
    && CGO_ENABLED=0 go build -o /out/gitleaks \
      -ldflags "-X=github.com/zricethezav/gitleaks/v8/version.Version=8.30.1" .

FROM build AS ci
# UTF-8: Opengrep otherwise reads the rules and the code as ASCII, and fails
# on the first accented letter.
ENV LANG=C.UTF-8
# git: code fetched by actions/checkout. No Python: single JS stack
# (§8.15); the Opengrep binary is standalone (checked without python3).
# Up-to-date Debian packages (the base has just been updated), versions
# followed by the rebuild.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
# Check tools: official binaries checked by their digest (published by
# each project) before entering the image; gitleaks above.
#   gitleaks (MIT), hadolint (GPL-3.0), Opengrep (LGPL-2.1): run from the
#   command line by the CI, never embedded in a delivered tool.
ADD --chmod=755 --checksum=sha256:c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507 \
    https://github.com/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-x86_64 /usr/local/bin/hadolint
ADD --chmod=755 --checksum=sha256:35779bdd72e92129c8df2a77f0c55e8c08356801ea92591ef32108d6b28d564c \
    https://github.com/opengrep/opengrep/releases/download/v1.30.0/opengrep_manylinux_x86 /usr/local/bin/opengrep
COPY --from=gitleaks /out/gitleaks /usr/local/bin/gitleaks
