#!/bin/sh
# Boot check of a core tool image (step 9.7, minimal): the image runs as the
# deployer runs it (ADR-022) — read-only root, tmpfs /tmp, no capability,
# no-new-privileges, uid 1000 — against a throwaway PostgreSQL 18.6: the
# core's roles (sql/roles.sql of the image's core), the migration by the
# SAME image (bin/migrate.js, owner account), then the web process (app
# account), which must answer 200 on /health (it reads the database) and on /
# (web/index.html, the page the Preview's accessibility check reads).
# The identity provider is a stub serving only the discovery document (the
# core reads it at start); sign-in is not exercised here.
# Protected file (.gitea/**), run by check.yml (job image) and by
# EupaDev's own CI. Usage: sh boot-check.sh <image>. Docker only, no
# Compose; everything is removed at the end. The probes run the image's own
# node with -e: no code of the tool runs outside its own container.
set -eu
IMAGE="$1"
N="boot-$$-$(date +%s)"
PG=postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
POSTURE="--read-only --tmpfs /tmp:uid=1000,gid=1000,mode=0700 --cap-drop ALL --security-opt no-new-privileges --user 1000:1000"

cleanup() {
  docker rm -f "$N-db" "$N-oidc" "$N-tool" > /dev/null 2>&1 || true
  docker network rm "$N" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$N" > /dev/null
docker run -d --name "$N-db" --network "$N" --network-alias=db -e POSTGRES_PASSWORD=boot-check -e POSTGRES_DB=tool "$PG" > /dev/null
# shellcheck disable=SC2086
docker run -d --name "$N-oidc" --network "$N" --network-alias=oidc $POSTURE --entrypoint node "$IMAGE" -e '
  const i = "http://oidc:8080";
  const d = JSON.stringify({ issuer: i, authorization_endpoint: i + "/auth", token_endpoint: i + "/token", jwks_uri: i + "/jwks", end_session_endpoint: i + "/logout" });
  require("http").createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(q.url === "/.well-known/openid-configuration" ? d : "{\"keys\":[]}"); }).listen(8080);' > /dev/null

i=0
until docker exec "$N-db" pg_isready -q -h 127.0.0.1 -U postgres -d tool; do
  i=$((i + 1)); [ "$i" -lt 60 ] || { docker logs "$N-db"; echo "PostgreSQL did not start"; exit 1; }
  sleep 1
done
# The core's roles script of the version in the image, run by the superuser as the platform does.
docker run --rm --network none --entrypoint cat "$IMAGE" node_modules/@eupadev/core/sql/roles.sql \
  | docker exec -i "$N-db" psql -q -v ON_ERROR_STOP=1 -U postgres -d tool -v tool=tool \
      -v owner_password=boot-owner -v app_password=boot-app -v purge_password=boot-purge -f -

echo "== migration (same image, owner account)"
# shellcheck disable=SC2086
docker run --rm --network "$N" $POSTURE -e DATABASE_URL=postgres://tool_owner:boot-owner@db:5432/tool -e DATABASE_TLS=off \
  "$IMAGE" node node_modules/@eupadev/core/bin/migrate.js

echo "== web process (image's own command, app account)"
# shellcheck disable=SC2086
docker run -d --name "$N-tool" --network "$N" --network-alias=tool $POSTURE -e NODE_ENV=production \
  -e DATABASE_URL=postgres://tool_app:boot-app@db:5432/tool -e DATABASE_TLS=off \
  -e APP_URL=http://tool:3000 -e OIDC_ISSUER=http://oidc:8080 -e OIDC_TLS=off -e OIDC_CLIENT_ID=boot -e OIDC_CLIENT_SECRET=boot-check \
  "$IMAGE" > /dev/null

i=0
# shellcheck disable=SC2086
until docker run --rm --network "$N" $POSTURE --entrypoint node "$IMAGE" -e '
  Promise.all(["/health", "/"].map((p) => fetch("http://tool:3000" + p).then((r) => { console.log(p, r.status); return r.status; })))
    .then((s) => process.exit(s.every((x) => x === 200) ? 0 : 1), () => process.exit(1));'; do
  i=$((i + 1))
  if [ "$i" -ge 15 ] || [ "$(docker inspect -f '{{.State.Running}}' "$N-tool")" != true ]; then
    docker logs "$N-tool" 2>&1 | tail -30
    echo "The image does not answer 200 on /health and / (read-only, migrated database): broken image."
    exit 1
  fi
  sleep 2
done
echo "The image starts read-only, migrates with the same image and answers 200 on /health and /."
