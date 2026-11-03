# EupaDev engine image. One image, two commands:
#   node src/main.ts     (default) the engine;
#   node src/migrate.ts  the migration, run before it with the owner account.
# No TypeScript build: Node 22 runs the .ts files as they are (erasable syntax).
#
# Built from the repository ROOT (the report schema lives in
# tool-template/ and is copied into the image):
#   docker build -f orchestrator/Dockerfile -t eupadev-engine .
# Context filtered by orchestrator/Dockerfile.dockerignore (whitelist).
#
# Base: official Node 22 image by digest (the golden image is on 24),
# with the same hardening as the run variant of images/base-node/Dockerfile.
# Not `FROM base-node:run-24`: the engine image is built upstream then
# copied by digest to the client (ROADMAP §8.16 M2), so it cannot
# depend on a golden image local to one installation.
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS common
# Debian security fixes already published (the pinned image does not update
# itself between two rebuilds). Git (and the certificate authorities for the
# https of a real forge): integration and diff check of the forge adapter,
# pushing fake (E3). Versions of the pinned Debian, no version pinned by
# hand (same rule as the upgrade).
# openssh-client: the real deployer (SshDeployer, ADR-014) calls the targets.
# hadolint ignore=DL3005,DL3008
RUN apt-get update && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
 && rm -rf /var/lib/apt/lists/*

# cosign rebuilt (same method as gitleaks, images/base-node/Dockerfile):
# the published v3.1.3 binary (latest version) embeds a Go and dependencies
# in which Trivy reports HIGH flaws fixed upstream. Source code downloaded
# as a Go module (checked by sum.golang.org), built with an up-to-date Go and
# these dependencies raised to their fixed version (same API; golang.org/x/net
# brings fixed crypto, text and mod).
FROM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS cosign
WORKDIR /src
# pipefail: a failure of `go mod download` must not be hidden by sed.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN cp -r "$(go mod download -json github.com/sigstore/cosign/v3@v3.1.3 \
      | sed -n 's/^\t"Dir": "\(.*\)",$/\1/p')/." . && chmod -R u+w . \
    && go get golang.org/x/net@v0.60.0 google.golang.org/grpc@v1.83.2 github.com/klauspost/compress@v1.18.7 \
       github.com/go-jose/go-jose/v4@v4.1.6 \
    && go mod tidy \
    && CGO_ENABLED=0 go build -trimpath -o /out/cosign \
      -ldflags "-X=sigs.k8s.io/release-utils/version.gitVersion=v3.1.3" ./cmd/cosign

# Production dependencies only, installed from the lockfile.
FROM common AS dependencies
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN npm install -g corepack@0.36.0 && corepack enable
COPY orchestrator/package.json orchestrator/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# deep-chat (ADR-024): a development dependency pinned by the lockfile's integrity; only its single bundle enters the
# image, served by the engine under a path carrying its content hash (src/static.ts). Never fetched at run time.
FROM dependencies AS vendor
RUN pnpm install --frozen-lockfile --ignore-scripts \
 && cp node_modules/deep-chat/dist/deepChat.bundle.js /deepChat.bundle.js

FROM common AS run
# Only `node` is used: npm, npx, corepack and yarn removed (like base-node:run-24).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
# Executor role (agents VM): the
# Claude Code engine launches the agents with `docker` (socket of the VM mounted)
# and checks their image with `cosign` (ADR-013), both taken from the PATH.
# docker: binary of the official image, by digest (29.9.0, no known flaw
# according to Trivy; client compatible with the Docker 29 of the VMs by
# API version negotiation). cosign: rebuilt above. Inert without a
# socket (pilot role).
COPY --from=docker:29.9.2-cli@sha256:2a146f3eb1ee1015c482756624bbff3a94a1b0531cad6fca03be55943373cf95 /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cosign /out/cosign /usr/local/bin/cosign
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY orchestrator/package.json ./
COPY orchestrator/migrations ./migrations
COPY orchestrator/src ./src
# End-user texts (mails, chat messages, gate reasons), one dictionary per language (ADR-025).
COPY orchestrator/lang ./lang
# The requester's web page (ADR-024): its files and the vendored deep-chat bundle, served by the engine process.
COPY orchestrator/web ./web
COPY --from=vendor /deepChat.bundle.js ./vendor/deepChat.bundle.js
# Schema of the agents' reports IN the image: by default the engine would read
# it outside its directory (config.ts, ../../tool-template/…).
COPY tool-template/agents/report.schema.json ./schemas/report.schema.json
# Role instructions IN the image (ADR-018):
# charter, role prompts and domain rules of the template, never read in the
# cloned repository of a tool (data). The engine refuses to start if one
# is missing (src/agent-engine/instructions.ts).
COPY tool-template/AGENTS.md ./instructions/AGENTS.md
COPY tool-template/agents/*.md ./instructions/agents/
COPY tool-template/.claude/rules/*.md ./instructions/.claude/rules/
# Reference tool given read-only to the contract, tests and builder roles (A-R6).
COPY examples/requests/README.md examples/requests/openapi.yaml ./example/
COPY examples/requests/api ./example/api
COPY examples/requests/db ./example/db
COPY examples/requests/web ./example/web
COPY examples/requests/tests ./example/tests
ENV NODE_ENV=production \
    REPORT_SCHEMA_PATH=/app/schemas/report.schema.json \
    INSTRUCTIONS_PATH=/app/instructions \
    EXAMPLE_PATH=/app/example \
    WEB_PATH=/app/web \
    DEEP_CHAT_PATH=/app/vendor/deepChat.bundle.js
# Nothing is written in the image: the container can run read-only
# (`read_only: true`). User `node` (uid 1000) of the official image.
# hadolint ignore=DL3066
USER node
# Local API: 127.0.0.1 by default (config.ts); in Compose, API_ADDRESS=0.0.0.0
# and the port published on 127.0.0.1 of the VM only.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT || 8080}/health`, { headers: { 'X-EupaDev': '1' } }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
