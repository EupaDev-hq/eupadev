#!/bin/sh
# Runs the CI checks of .gitea/workflows/check.yml locally, when the tool is
# installed; a missing tool is reported and left to CI. Stops at the first failure.
set -eu
cd "$(dirname "$0")/.."

# Fixed commands, as in CI: the "scripts" field of package.json is never used.
echo "== dependencies and tests (pnpm install --ignore-scripts --ignore-pnpmfile, node --test)"
ls package.json > /dev/null
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
node --test

echo "== contract (the core's linter on openapi.yaml, no handler needed)"
node --input-type=module -e "import { readContract } from '@eupadev/core'; readContract('openapi.yaml')"

echo "== code analysis (opengrep)"
if command -v opengrep >/dev/null 2>&1; then
  opengrep scan --config .opengrep --error --no-git-ignore .
else
  echo "skipped: opengrep not installed, CI will check it"
fi

echo "== secrets (gitleaks)"
if command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$PWD:/repo:ro" -w /repo zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f dir . --redact --exit-code 1 --verbose --ignore-gitleaks-allow --config .gitea/checks/gitleaks.toml
else
  echo "skipped: docker not installed (gitleaks), CI will check it"
fi

echo "== guard rails (exceptions may only decrease, compared with main on the forge)"
sh .gitea/checks/guard-rails.sh

echo "== all local checks passed"
