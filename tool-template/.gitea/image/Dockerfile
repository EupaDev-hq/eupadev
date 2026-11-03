# Tool image — FIXED by the EupaDev platform (A-R0). Protected file
# (.gitea/**): no agent can change it, and a Dockerfile anywhere else in the
# repository is refused at push time.
# CI builds it with BuildKit: docker build -f .gitea/image/Dockerfile .
# (BuildKit is required: only BuildKit reads Dockerfile.dockerignore next to it.)
#
# Built FROM the EupaDev golden image (images/base-node): security patches,
# pnpm, non-root user and the removal of package managers from the final image
# are handled there, once, for every tool. BASE_IMAGE_BUILD / BASE_IMAGE_RUN
# are passed by CI from the organisation variables of the same name. No default
# on purpose: building without the golden image must fail visibly, never fall
# back silently to an unhardened base.
#
# What the tested code is, the image runs (G1): no script and no .pnpmfile of
# the tool runs during the build, on install AND on prune.

ARG BASE_IMAGE_BUILD
ARG BASE_IMAGE_RUN
# Version of @eupadev/core in package.json, passed by CI; the build checks it is
# the installed one, then labels the image with it (the deployer's core mode).
ARG CORE_VERSION

# --- Build stage: dependencies installed with the lockfile ---
FROM ${BASE_IMAGE_BUILD} AS build
WORKDIR /app
# pnpm-workspace.yaml: the platform's pnpm settings (protected file; core
# exempt from the minimum release age), read by the install below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# @eupadev/core comes from the forge's npm registry. CI passes two BuildKit
# secrets, mounted for this step only and never written to a layer: a pnpm
# user config holding the read-only badge (npmrc) and the certificate
# authorities that trust the forge (ca; lab: Caddy's internal CA).
# (Default mount path /run/secrets/<id>; one line: the platform's checks read each RUN line whole.)
RUN --mount=type=secret,id=npmrc --mount=type=secret,id=ca NPM_CONFIG_USERCONFIG=/run/secrets/npmrc NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
COPY . .
# Only what is needed at runtime remains; the core installed is the one CI named.
# Same registry config as the install: pnpm 12.16.1 prune re-resolves the
# tree (12.9.1 did not; lab, 2026-10-30): without it @eupadev/core is looked
# up on registry.npmjs.org.
ARG CORE_VERSION
RUN --mount=type=secret,id=npmrc --mount=type=secret,id=ca NPM_CONFIG_USERCONFIG=/run/secrets/npmrc NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm prune --prod --ignore-scripts --ignore-pnpmfile && test -n "$CORE_VERSION" && test "$(node -p 'require("./node_modules/@eupadev/core/package.json").version')" = "$CORE_VERSION"

# --- Runtime stage: hardened golden image, non-root ---
FROM ${BASE_IMAGE_RUN} AS runtime
ARG CORE_VERSION
# A core tool (ADR-022): the deployer creates its database, runs its migration
# with this same image (node node_modules/@eupadev/core/bin/migrate.js),
# then starts it read-only as uid 1000.
LABEL eupadev.core=${CORE_VERSION}
WORKDIR /app
# No --chown: files stay owned by root, the process (user node) cannot rewrite
# its own code.
COPY --from=build /app .
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
# The core's server: contract, handlers of api/, static files of web/.
CMD ["node", "node_modules/@eupadev/core/bin/start.js"]
