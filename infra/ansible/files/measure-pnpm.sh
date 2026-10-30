#!/bin/sh
# Measure of verify-agents.yml, run INSIDE a trial container (read-only root,
# /tmp in tmpfs): cold `pnpm install` of a small project, through Smokescreen
# ($HTTPS_PROXY). Prints the duration in milliseconds.
set -eu
export HOME=/tmp
npm install --global --prefix /tmp/tools --silent "pnpm@$1"
mkdir /tmp/project && cd /tmp/project
printf '{"name":"trial","private":true,"dependencies":{"express":"4.21.2","zod":"3.24.1"}}\n' > package.json
start=$(date +%s%N)
/tmp/tools/bin/pnpm install --reporter=silent
end=$(date +%s%N)
echo "pnpm install: $(( (end - start) / 1000000 )) ms, $(find node_modules/.pnpm -maxdepth 1 -mindepth 1 | wc -l) packages"
