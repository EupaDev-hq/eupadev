#!/bin/sh
# Runs the upstream trial (instructions analysis §4-B) locally with Docker, on an agents' image built from
# images/agent/ (real Claude Code, the image's version), without Internet (--internal network) or a real key.
# Usage: sh images/agent/check/upstream-trial/launch.sh <image> [output directory]
# Passes: code, read, reviewer (assertions), then witnesses without assertion (no --restricted, no --bare, --tools as
# separate words, no --tools, no Read rule, no --add-dir) to see what each option brings; VARIANTS=… picks them.
#   image: e.g. eupadev-agent:trial (docker build --build-arg BASE_IMAGE_BUILD=<golden build> -t eupadev-agent:trial images/agent)
# Output: <directory>/log-<role>.jsonl (requests received by the upstream), <directory>/agent-<role>.log (what trial.sh prints),
# then the verdict of verify.mjs (exit code 0 = every assertion holds).
# CI (publish.yml of the `agent` repository): VARIANTS="code read reviewer" (the passes with assertions only), output in $RUNNER_TEMP.
set -eu
IMAGE="${1:?agents' image}"
OUTPUT="${2:-/tmp/upstream-trial}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUTPUT"
cp "$HERE/../report.schema.json" "$HERE/report.schema.json"
NETWORK="fa-upstream-trial-$$"
docker network create --internal "$NETWORK" >/dev/null
cleanup() { docker rm -f "fa-upstream-$$" >/dev/null 2>&1 || true; docker network rm "$NETWORK" >/dev/null 2>&1 || true; rm -f "$HERE/report.schema.json"; }
trap cleanup EXIT

for role in ${VARIANTS:-code read reviewer code-no-restricted code-no-bare code-tools-spaces code-no-tools code-no-read-rule code-no-add-dir}; do
  docker rm -f "fa-upstream-$$" >/dev/null 2>&1 || true
  # Upstream: node of the agents' image, log inside the container, fetched by docker cp.
  docker create --name "fa-upstream-$$" --network "$NETWORK" -e "UPSTREAM_SCENARIO=$role" --user 10001:10001 "$IMAGE" node /tmp/upstream.js >/dev/null
  docker cp "$HERE/upstream.js" "fa-upstream-$$:/tmp/upstream.js"
  docker start "fa-upstream-$$" >/dev/null
  IP="$(docker inspect --format "{{(index .NetworkSettings.Networks \"$NETWORK\").IPAddress}}" "fa-upstream-$$")"
  # Wait until the upstream listens (an upstream not ready would fail the trial wrongly on a loaded VM).
  i=0; until [ "$(docker logs "fa-upstream-$$" 2>&1 | grep -c 'fake upstream')" -ge 2 ]; do i=$((i + 1)); [ "$i" -lt 30 ] || { echo "FAILED: fake upstream not started"; exit 1; }; sleep 1; done
  # Agent: same hardening as the launcher (read-only root, ephemeral /tmp and /home/agent, no capability, 10001),
  # inputs by tar on standard input; ATTACKER = the upstream's IP (port 8081), so that the trapped settings aim at a
  # reachable address: if Claude Code read them, the attacker would see requests.
  tar -c -f - -C "$HERE" . | docker run -i --rm --network "$NETWORK" --read-only --tmpfs=/tmp --tmpfs=/home/agent:uid=10001,gid=10001 \
    --cap-drop=ALL --security-opt=no-new-privileges --user=10001:10001 \
    -e ANTHROPIC_API_KEY=fake-key-trial -e "ANTHROPIC_BASE_URL=http://$IP:8080" --add-host "ATTACKER:$IP" \
    "$IMAGE" sh -c 'mkdir -p /tmp/trial && tar -x -f - -C /tmp/trial && sh /tmp/trial/trial.sh "$0"' "$role" > "$OUTPUT/agent-$role.log" 2>&1 || true
  docker cp "fa-upstream-$$:/tmp/upstream/log.jsonl" "$OUTPUT/log-$role.jsonl" 2>/dev/null || : > "$OUTPUT/log-$role.jsonl"
  docker rm -f "fa-upstream-$$" >/dev/null 2>&1 || true
done
node "$HERE/verify.mjs" "$OUTPUT" "${VARIANTS:-}"
