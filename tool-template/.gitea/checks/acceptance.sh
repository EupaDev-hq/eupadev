#!/bin/sh
# Acceptance and security suite against the deployed Preview (note
# docs/reflexions/2026-10-26-note-acceptance-on-preview.md §3.2-3.3), run by
# the `acceptance` job of preview-check.yml on ci-image. Protected
# (.gitea/**): an agent changes neither this script nor the flags below.
#
# One throwaway Playwright container (version = @playwright/test of
# package.json, checked by guard-rails.sh), no Docker socket, the repository
# copied in (k6 model), the Preview reached through the CI VM's Caddy
# (--add-host), the VM's authorities trusted by Node and imported into
# Chromium's NSS store (pa11y model); certificates are never ignored.
#   1. Dependencies: the core registry badge in a temporary user config, for
#      that `docker exec` only (never in the container's own environment),
#      deleted before any test runs; no install script runs.
#   2. The tool's suite, tests/acceptance/playwright.config.js: the Preview
#      personas (secret PREVIEW_PERSONAS, written at Gate 1) as a
#      realm-shaped file (KIT_REALM_FILE, read by the kit's readRealm: people
#      are found by role); these flags override the agent's config:
#      --forbid-only, --retries=1 (flake policy), one worker (shared Preview).
#   3. The platform's SEC-* generated from the contract (sec-preview.mjs).
# No tests/acceptance/playwright.config.js: red (a missing suite never
# passes for a green one).
set -eu
case "$PREVIEW_URL" in https://*[!a-z0-9.-]*|https://) echo "invalid Preview URL"; exit 1;; https://*) ;; *) echo "invalid Preview URL"; exit 1;; esac
CONFIG=tests/acceptance/playwright.config.js
[ -f "$CONFIG" ] || { echo "No $CONFIG: this tool has no acceptance suite (red)"; exit 1; }
[ -n "${PREVIEW_PERSONAS:-}" ] || { echo "No PREVIEW_PERSONAS secret: register-tools.yml writes it at Gate 1"; exit 1; }
HOST="${PREVIEW_URL#https://}"
IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
PNPM="corepack pnpm@12.16.1"
COREPACK="-e COREPACK_ENV_FILE=0 -e COREPACK_ENABLE_PROJECT_SPEC=0 -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
REG="$GITHUB_SERVER_URL/api/packages/${GITHUB_REPOSITORY%%/*}-core/npm/"
C="acceptance-$RUN_ID"
trap 'docker rm -f "$C" > /dev/null 2>&1 || true' EXIT

docker create --name "$C" --add-host "$HOST:host-gateway" -v /usr/local/share/ca-certificates:/ca:ro -w /work \
  -e NODE_EXTRA_CA_CERTS=/tmp/ca.pem "$IMAGE" sleep infinity > /dev/null
docker cp . "$C:/work"
docker start "$C" > /dev/null

echo "== Authorities of the CI VM (Node and Chromium)"
docker exec "$C" sh -c '
  set -e
  cat /ca/*.crt > /tmp/ca.pem
  apt-get update -qq > /dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends libnss3-tools > /dev/null
  mkdir -p "$HOME/.pki/nssdb"
  certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password
  for c in /ca/*.crt; do certutil -d "sql:$HOME/.pki/nssdb" -A -t C,, -n "$(basename "$c")" -i "$c"; done'

echo "== Dependencies (frozen lockfile, no script)"
# shellcheck disable=SC2086
docker exec -e REGISTRY_READ_TOKEN -e REG="$REG" $COREPACK "$C" sh -c '
  set -e
  NPMRC=$(mktemp)
  trap "rm -f $NPMRC" EXIT
  printf "@eupadev:registry=%s\n%s:_authToken=%s\n" "$REG" "${REG#*:}" "$REGISTRY_READ_TOKEN" > "$NPMRC"
  NPM_CONFIG_USERCONFIG="$NPMRC" '"$PNPM"' install --frozen-lockfile --ignore-scripts --ignore-pnpmfile'

docker exec -e PREVIEW_PERSONAS "$C" node .gitea/checks/realm-personas.mjs /tmp/realm.json

red=0
echo "== The tool's acceptance suite"
# shellcheck disable=SC2086
docker exec -e ACCEPTANCE_BASE_URL="$PREVIEW_URL" -e KIT_REALM_FILE=/tmp/realm.json $COREPACK "$C" sh -c \
  "$PNPM exec bddgen -c $CONFIG && $PNPM exec playwright test -c $CONFIG --forbid-only --retries=1 --workers=1 --reporter=list" || red=1

echo "== Platform SEC-* (contract openapi.yaml)"
docker exec -e ACCEPTANCE_BASE_URL="$PREVIEW_URL" -e KIT_REALM_FILE=/tmp/realm.json "$C" \
  node --test --test-reporter=spec .gitea/checks/sec-preview.mjs || red=1
exit "$red"
