#!/bin/sh
# EupaDev installer (ADR-028). POSIX sh, no bashisms.
#
# Read this file before running it; docs/install.md shows how to check its
# signature and checksum first. It is published signed with every release.
#
#   install.sh check     [--dir DIR]                   prerequisites only, changes nothing
#   install.sh discovery [--dir DIR] [--address ADDR]  one machine, Docker Compose, fake
#                                                      agents, no AI key, loopback only
#                                                      (ADDR: localhost or 127.0.0.1)
#   install.sh uninstall [--dir DIR] [--yes]           removes what discovery created
#   install.sh version | help
#
# Discovery mode binds to the loopback address only and refuses any other
# address or a domain. It shows the cycle with made-up agents: it is not the
# product and not for production. Enterprise mode (Terraform + Ansible) is
# the recipe of infra/README.md; `install.sh enterprise` is not built yet.
set -eu

EUPADEV_VERSION="dev"   # stamped by .github/workflows/release.yml
# Idem: sha256, at that tag, of the three files the script downloads and writes
# beside .env (empty in a `dev` script, which copies them from its checkout).
COMPOSE_SHA256=""       # infra/compose/discovery/compose.yml
INIT_ROLES_SHA256=""    # infra/compose/discovery/init-roles.sh
ROLES_SQL_SHA256=""     # orchestrator/sql/roles.sql
REPOSITORY="EupaDev-hq/eupadev"
PROJECT="eupadev-discovery"
# Idem: the published engine image of that tag, by digest
# (ghcr.io/eupadev-hq/eupadev-engine@sha256:…), signed keyless by the same
# workflow; verified below, then handed to the Compose file. Empty in a `dev`
# script, which builds LOCAL_IMAGE from its checkout instead.
ENGINE_IMAGE=""
LOCAL_IMAGE="eupadev-engine:discovery"  # compose.yml default
CERTIFICATE_ISSUER="https://token.actions.githubusercontent.com"
MIN_RAM_MIB=2048
MIN_DISK_MIB=5120
PORTS="8080 8081 8025"  # page and API, local sign-in, mail catcher

DIR="${EUPADEV_HOME:-$HOME/.eupadev}/discovery"
ADDRESS="localhost"
YES=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() { sed -n '2,/^set -eu/{/^set -eu/d;s/^# \{0,1\}//;p;}' "$0"; }
say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit "${2:-1}"; }

# --- arguments -------------------------------------------------------------

[ $# -ge 1 ] || { usage >&2; exit 2; }
COMMAND="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || die "--dir needs a value" 2; DIR="$2"; shift 2 ;;
    --address) [ $# -ge 2 ] || die "--address needs a value" 2; ADDRESS="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    *) die "unknown option: $1" 2 ;;
  esac
done

# Loopback only (ADR-028): the two names the engine accepts in discovery mode
# (its LOOPBACK_HOSTS), nothing else, no domain.
case "$ADDRESS" in
  localhost|127.0.0.1) ;;
  *) die "refused: discovery mode binds to the loopback address only (localhost or 127.0.0.1), not '$ADDRESS'. It is not for production; the enterprise mode is infra/README.md." ;;
esac

# --- prerequisites: report everything, change nothing ----------------------

MISSING=0
need() { # need <command> <what it is for>
  if command -v "$1" > /dev/null 2>&1; then say "  ok       $1"; else say "  MISSING  $1 ($2)"; MISSING=1; fi
}

check() {
  say "Prerequisites of discovery mode ($EUPADEV_VERSION):"
  need docker "Docker Engine"
  need cosign "checks the engine image signature; https://github.com/sigstore/cosign/releases"
  if command -v docker > /dev/null 2>&1; then
    if docker compose version > /dev/null 2>&1; then say "  ok       docker compose"; else say "  MISSING  docker compose (Compose plugin v2)"; MISSING=1; fi
    if docker info > /dev/null 2>&1; then say "  ok       docker daemon reachable"; else say "  MISSING  docker daemon (not running, or your user is not allowed to use it)"; MISSING=1; fi
  fi
  if [ -n "$COMPOSE_SHA256" ]; then
    if command -v curl > /dev/null 2>&1 || command -v wget > /dev/null 2>&1; then say "  ok       curl or wget"; else say "  MISSING  curl or wget (downloads the discovery files of $EUPADEV_VERSION)"; MISSING=1; fi
  fi
  if [ -r /proc/meminfo ]; then
    ram_mib=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
    if [ "${ram_mib:-0}" -ge "$MIN_RAM_MIB" ]; then say "  ok       ${ram_mib} MiB of RAM available (needs $MIN_RAM_MIB)"; else say "  MISSING  RAM: ${ram_mib:-?} MiB available, needs $MIN_RAM_MIB"; MISSING=1; fi
  else
    say "  skipped  RAM check (no /proc/meminfo; needs about $MIN_RAM_MIB MiB free)"
  fi
  parent="$DIR"; while [ ! -d "$parent" ] && [ "$parent" != / ]; do parent="$(dirname "$parent")"; done
  disk_mib=$(df -Pk "$parent" | awk 'NR==2 {print int($4/1024)}')
  if [ "${disk_mib:-0}" -ge "$MIN_DISK_MIB" ]; then say "  ok       ${disk_mib} MiB of disk free under $parent (needs $MIN_DISK_MIB)"; else say "  MISSING  disk: ${disk_mib:-?} MiB free under $parent, needs $MIN_DISK_MIB"; MISSING=1; fi
  if [ -f "$DIR/compose.yml" ]; then
    say "  ok       ports $PORTS (already installed in $DIR, ports are ours)"
  elif command -v ss > /dev/null 2>&1; then
    # ponytail: ss only (Linux); on other systems the port clash shows up at `docker compose up`.
    for port in $PORTS; do
      if ss -Hltn "sport = :$port" 2> /dev/null | grep -q .; then say "  MISSING  port $port is in use"; MISSING=1; else say "  ok       port $port free"; fi
    done
  else
    say "  skipped  port check (no ss); ports $PORTS must be free"
  fi
  [ "$MISSING" -eq 0 ] || die "a prerequisite is missing; nothing was changed."
  say "All prerequisites are met."
}

# --- discovery -------------------------------------------------------------

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; } # random_hex <bytes>

fetch() { # fetch <url> <file>
  if command -v curl > /dev/null 2>&1; then curl -fsSL -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}

# The three files written beside .env: the Compose file, the hook that creates
# the PostgreSQL accounts at the first start, and the SQL it runs.
FILES="compose.yml init-roles.sh roles.sql"
source_of() { # source_of <file>: sets `path` (in the repository) and `sum` (stamped)
  case "$1" in
    compose.yml) path=infra/compose/discovery/compose.yml; sum="$COMPOSE_SHA256" ;;
    init-roles.sh) path=infra/compose/discovery/init-roles.sh; sum="$INIT_ROLES_SHA256" ;;
    roles.sql) path=orchestrator/sql/roles.sql; sum="$ROLES_SQL_SHA256" ;;
  esac
}

# They come from the release tag and must match the checksums stamped into
# this signed script; a `dev` script takes them from its checkout and builds
# the engine image there if it is missing.
discovery_files() { # writes the verified files to the directory $1
  for file in $FILES; do
    source_of "$file"
    if [ -n "$COMPOSE_SHA256" ]; then
      fetch "https://raw.githubusercontent.com/$REPOSITORY/$EUPADEV_VERSION/$path" "$1/$file" \
        || die "could not download $path of $EUPADEV_VERSION"
      got=$(sha256sum "$1/$file" | cut -d' ' -f1)
      [ "$got" = "$sum" ] || die "the downloaded $file does not match the checksum of $EUPADEV_VERSION (got $got); nothing was started."
    else
      [ -f "$SCRIPT_DIR/$path" ] || die "unreleased script ($EUPADEV_VERSION): run it from a checkout of the repository, or use a released install.sh"
      cp "$SCRIPT_DIR/$path" "$1/$file"
    fi
  done
  if [ -z "$ENGINE_IMAGE" ] && ! docker image inspect "$LOCAL_IMAGE" > /dev/null 2>&1; then
    say "Building the engine image $LOCAL_IMAGE from the checkout (a few minutes the first time)..."
    docker build -f "$SCRIPT_DIR/orchestrator/Dockerfile" -t "$LOCAL_IMAGE" "$SCRIPT_DIR" \
      || die "the engine image could not be built; nothing was started."
  fi
}

# Keyless signature of the published image, stamped by digest above: the
# identity is the release workflow at this tag, the one that also signed this
# script (ADR-028: one identity to check). A `dev` script runs the image it
# built from its checkout: said, not verified.
verify_image() {
  if [ -z "$ENGINE_IMAGE" ]; then say "Engine image: $LOCAL_IMAGE built from the checkout ($EUPADEV_VERSION), signature not checked."; return; fi
  cosign verify --certificate-oidc-issuer "$CERTIFICATE_ISSUER" \
    --certificate-identity "https://github.com/$REPOSITORY/.github/workflows/release.yml@refs/tags/$EUPADEV_VERSION" \
    "$ENGINE_IMAGE" > /dev/null 2>&1 || die "the engine image signature does not match the release workflow of $EUPADEV_VERSION ($ENGINE_IMAGE); nothing was started."
  say "Engine image signature checked ($ENGINE_IMAGE)."
}

discovery() {
  check
  # Everything that can still fail (signature, download, checksum) runs
  # before the first write.
  verify_image
  new=$(mktemp -d)
  trap 'rm -rf "$new"' EXIT
  discovery_files "$new"
  changed=0
  umask 077
  mkdir -p "$DIR"
  requester_password=""; admin_password=""
  if [ -f "$DIR/.env" ]; then
    stored=$(sed -n 's/^EUPADEV_ADDRESS=//p' "$DIR/.env")
    [ "$stored" = "$ADDRESS" ] || die "already installed on $stored (see $DIR); run 'install.sh uninstall' before changing the address."
  else
    # ponytail: the variable names are the contract with infra/compose/discovery/compose.yml
    # (its header lists them; tests/install/install.test.sh checks both sides agree).
    # The two sign-in passwords are shown once below (ADR-028); the sign-in
    # container hashes them in memory and never logs them.
    requester_password=$(random_hex 12); admin_password=$(random_hex 12)
    {
      say "# Written by install.sh $EUPADEV_VERSION; owner-only, holds secrets. Never commit or share it."
      say "EUPADEV_VERSION=$EUPADEV_VERSION"
      say "EUPADEV_ADDRESS=$ADDRESS"
      say "ENGINE_IMAGE=${ENGINE_IMAGE:-$LOCAL_IMAGE}"
      say "ORCH_DB_PASSWORD=$(random_hex 32)"
      say "ORCH_OWNER_PASSWORD=$(random_hex 32)"
      say "ORCH_ENGINE_PASSWORD=$(random_hex 32)"
      say "OIDC_WEB_CLIENT_SECRET=$(random_hex 32)"
      say "SIGNIN_REQUESTER_PASSWORD=$requester_password"
      say "SIGNIN_ADMIN_PASSWORD=$admin_password"
    } > "$DIR/.env"
    changed=1
  fi
  for file in $FILES; do
    if [ -f "$DIR/$file" ] && cmp -s "$DIR/$file" "$new/$file"; then :; else cp "$new/$file" "$DIR/$file"; changed=1; fi
  done
  # Read by the PostgreSQL container (another uid), no secret in them: the
  # umask above would hide them from it. .env stays owner-only.
  chmod 0644 "$DIR/init-roles.sh" "$DIR/roles.sql"
  docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/compose.yml" up -d --wait
  say ""
  if [ "$changed" -eq 1 ]; then say "EupaDev $EUPADEV_VERSION installed in $DIR."; else say "Already installed in $DIR, nothing changed."; fi
  say "Discovery mode: made-up agents, no AI key, loopback only. Not for production."
  say "  Requester page:    http://$ADDRESS:8080/"
  say "  Mail catcher:      http://$ADDRESS:8025/  (the gate mails land there)"
  if [ -n "$requester_password" ]; then
    say "  Sign-in accounts, shown once (ADR-028); write them down now:"
    say "    requester  $requester_password"
    say "    admin      $admin_password"
  else
    say "  Sign-in accounts:  requester and admin, passwords shown at the first install (kept in $DIR/.env, readable by you only)"
  fi
  say "  Remove everything: $0 uninstall"
}

# --- uninstall: only what discovery created --------------------------------

uninstall() {
  if [ ! -f "$DIR/compose.yml" ] && [ ! -f "$DIR/.env" ]; then say "Nothing to remove in $DIR."; return; fi
  if [ -z "$YES" ]; then
    [ -t 0 ] || die "this removes the containers, the data volumes and $DIR; run again with --yes to confirm."
    printf 'Remove the EupaDev discovery containers, their data and %s? [y/N] ' "$DIR"
    read -r answer
    case "$answer" in y|Y|yes) ;; *) say "Nothing removed."; return ;; esac
  fi
  if [ -f "$DIR/compose.yml" ] && command -v docker > /dev/null 2>&1; then
    docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/compose.yml" down --volumes --remove-orphans
  fi
  for file in $FILES; do rm -f "$DIR/$file"; done
  rm -f "$DIR/.env"
  rmdir "$DIR" 2> /dev/null || say "$DIR kept: it holds files install.sh did not create."
  say "EupaDev discovery removed."
}

case "$COMMAND" in
  check) check ;;
  discovery) discovery ;;
  uninstall) uninstall ;;
  version) say "$EUPADEV_VERSION" ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown command: $COMMAND" 2 ;;
esac
