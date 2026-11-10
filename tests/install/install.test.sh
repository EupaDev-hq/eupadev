#!/bin/sh
# Checks of install.sh that need no Docker: syntax, argument parsing, the
# loopback refusal, and a prerequisites check that fails cleanly and creates
# nothing when docker and cosign are absent. Run: sh tests/install/install.test.sh
set -eu

HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$HERE/install.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export EUPADEV_HOME="$TMP/home"
FAILED=0

expect() { # expect <description> <expected exit code> <command...>
  desc="$1"; want="$2"; shift 2
  set +e; out=$("$@" 2>&1); got=$?; set -e
  if [ "$got" -eq "$want" ]; then printf 'ok    %s\n' "$desc"; else printf 'FAIL  %s (exit %s, wanted %s)\n%s\n' "$desc" "$got" "$want" "$out"; FAILED=1; fi
}
contains() { # contains <description> <needle> <command...>
  desc="$1"; needle="$2"; shift 2
  set +e; out=$("$@" 2>&1); set -e
  case "$out" in *"$needle"*) printf 'ok    %s\n' "$desc" ;; *) printf 'FAIL  %s: output lacks "%s"\n%s\n' "$desc" "$needle" "$out"; FAILED=1 ;; esac
}

expect "POSIX syntax" 0 sh -n "$SCRIPT"
expect "no arguments is a usage error" 2 sh "$SCRIPT"
expect "unknown command is a usage error" 2 sh "$SCRIPT" frobnicate
expect "unknown option is a usage error" 2 sh "$SCRIPT" check --bogus
expect "help exits 0" 0 sh "$SCRIPT" help
contains "help names the three commands" "uninstall" sh "$SCRIPT" help
contains "version prints the stamp" "dev" sh "$SCRIPT" version
expect "no bash-only syntax" 0 grep -L -E '\[\[|function |\$\(\(|local ' "$SCRIPT"

# Loopback only: refused before any prerequisite is looked at.
expect "a public address is refused" 1 sh "$SCRIPT" discovery --address 0.0.0.0
expect "a LAN address is refused" 1 sh "$SCRIPT" discovery --address 192.168.1.10
expect "a domain is refused" 1 sh "$SCRIPT" discovery --address eupadev.example
expect "a dotted name under 127 is refused" 1 sh "$SCRIPT" discovery --address 127.evil.example
expect "another loopback address than 127.0.0.1 is refused (the engine would refuse it too)" 1 sh "$SCRIPT" discovery --address 127.0.0.2
contains "the refusal says loopback" "loopback" sh "$SCRIPT" discovery --address 0.0.0.0

# A PATH with the plain tools only: docker and cosign are missing, so check
# fails, names them, and leaves nothing behind.
BIN="$TMP/bin"; mkdir -p "$BIN"
for tool in sh awk sed grep cut head tr od df dirname mktemp cmp mv cp rm mkdir rmdir cat printf uname; do
  if path=$(command -v "$tool" 2> /dev/null); then ln -s "$path" "$BIN/$tool"; fi
done
expect "check fails without docker" 1 env PATH="$BIN" sh "$SCRIPT" check
contains "check names docker" "MISSING  docker" env PATH="$BIN" sh "$SCRIPT" check
contains "check names cosign" "MISSING  cosign" env PATH="$BIN" sh "$SCRIPT" check
contains "check says nothing was changed" "nothing was changed" env PATH="$BIN" sh "$SCRIPT" check
expect "discovery stops at the prerequisites" 1 env PATH="$BIN" sh "$SCRIPT" discovery
if [ ! -e "$EUPADEV_HOME" ]; then printf 'ok    nothing created under EUPADEV_HOME\n'; else printf 'FAIL  %s was created\n' "$EUPADEV_HOME"; FAILED=1; fi

# With Docker present but no Compose file to run (a `dev` script outside a
# checkout), discovery stops before writing anything.
if docker info > /dev/null 2>&1; then
  cp "$SCRIPT" "$TMP/install.sh"
  # A stub cosign passes the prerequisites on a runner without it and records
  # how the script calls it (exit code from $TMP/cosign.exit); a stub curl
  # fails every download, so that no stamped case reaches the network.
  STUB="$TMP/stub"; mkdir -p "$STUB"
  cat > "$STUB/cosign" <<EOF
#!/bin/sh
printf '%s ' "\$@" > "$TMP/cosign.args"
exit "\$(cat "$TMP/cosign.exit")"
EOF
  printf '#!/bin/sh\nexit 22\n' > "$STUB/curl"
  chmod +x "$STUB/cosign" "$STUB/curl"
  echo 0 > "$TMP/cosign.exit"
  expect "unreleased script outside a checkout stops" 1 env PATH="$STUB:$PATH" sh "$TMP/install.sh" discovery
  contains "it says why" "unreleased script" env PATH="$STUB:$PATH" sh "$TMP/install.sh" discovery
  contains "an unstamped script says the image signature is not checked" "signature not checked" env PATH="$STUB:$PATH" sh "$TMP/install.sh" discovery
  if [ ! -e "$TMP/cosign.args" ]; then printf 'ok    an unstamped script never calls cosign\n'; else printf 'FAIL  an unstamped script called cosign: %s\n' "$(cat "$TMP/cosign.args")"; FAILED=1; fi
  if [ ! -e "$EUPADEV_HOME" ]; then printf 'ok    still nothing created under EUPADEV_HOME\n'; else printf 'FAIL  %s was created\n' "$EUPADEV_HOME"; FAILED=1; fi

  # A released script, stamped the way .github/workflows/release.yml does it
  # (same sed): the image signature is verified first, with the release
  # workflow identity at that tag, and a signature that does not verify
  # stops everything before any download or write.
  REF="ghcr.io/eupadev-hq/eupadev-engine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  sed -e 's|^EUPADEV_VERSION=.*|EUPADEV_VERSION="v9.9.9"|' -e "s|^ENGINE_IMAGE=.*|ENGINE_IMAGE=\"$REF\"|" \
      -e "s|^COMPOSE_SHA256=.*|COMPOSE_SHA256=\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"|" "$SCRIPT" > "$TMP/stamped.sh"
  expect "the tree script is stampable (the lines release.yml rewrites exist)" 0 grep -q -E '^ENGINE_IMAGE=""$' "$SCRIPT"
  echo 1 > "$TMP/cosign.exit"
  expect "a stamped script stops when the image signature does not verify" 1 env PATH="$STUB:$PATH" sh "$TMP/stamped.sh" discovery
  contains "it names the release workflow" "does not match the release workflow of v9.9.9" env PATH="$STUB:$PATH" sh "$TMP/stamped.sh" discovery
  contains "cosign was asked for the stamped digest" "$REF" cat "$TMP/cosign.args"
  contains "cosign was asked for the release workflow identity at the tag" "--certificate-identity https://github.com/EupaDev-hq/eupadev/.github/workflows/release.yml@refs/tags/v9.9.9" cat "$TMP/cosign.args"
  contains "cosign was asked for GitHub's certificate issuer" "--certificate-oidc-issuer https://token.actions.githubusercontent.com" cat "$TMP/cosign.args"
  echo 0 > "$TMP/cosign.exit"
  contains "a verified image is said so, then the download of the tag's files is attempted" "could not download" env PATH="$STUB:$PATH" sh "$TMP/stamped.sh" discovery
  contains "a verified image is reported" "Engine image signature checked ($REF)" env PATH="$STUB:$PATH" sh "$TMP/stamped.sh" discovery
  if [ ! -e "$EUPADEV_HOME" ]; then printf 'ok    a stamped script that stops creates nothing either\n'; else printf 'FAIL  %s was created\n' "$EUPADEV_HOME"; FAILED=1; fi
else
  printf 'skip  unreleased-script and stamped-script cases (no Docker daemon here)\n'
fi

# Uninstall with nothing installed needs no Docker and removes nothing.
expect "uninstall with nothing installed exits 0" 0 env PATH="$BIN" sh "$SCRIPT" uninstall --yes
contains "uninstall says nothing to remove" "Nothing to remove" env PATH="$BIN" sh "$SCRIPT" uninstall --yes

# The files the script copies or downloads exist at the paths it names, and
# the Compose file mounts nothing outside its own directory (the installed
# copy lives alone in ~/.eupadev/discovery: a `../` would mount the user's
# home, and a missing file becomes a root-owned directory).
for file in compose.yml init-roles.sh roles.sql; do
  path=$(sed -n "s/^ *$file) path=\([^;]*\);.*/\1/p" "$SCRIPT")
  if [ -n "$path" ] && [ -f "$HERE/$path" ]; then printf 'ok    %s comes from %s\n' "$file" "$path"; else printf 'FAIL  install.sh names "%s" for %s, which does not exist\n' "$path" "$file"; FAILED=1; fi
done
expect "the Compose file mounts only files beside it" 1 grep -q -E '^ *- \.\./' "$HERE/infra/compose/discovery/compose.yml"
expect "the Compose file has no build context" 1 grep -q -E '^ *build:' "$HERE/infra/compose/discovery/compose.yml"

# Contract with the Compose file: every variable it requires is one the
# script writes, so that the two cannot drift apart again.
for var in $(grep -oE '\$\{[A-Z_]+:\?missing\}' "$HERE/infra/compose/discovery/compose.yml" | tr -d '{}$' | sed 's/:?missing//' | sort -u); do
  if grep -q "^ *say \"$var=" "$SCRIPT"; then printf 'ok    install.sh writes %s\n' "$var"; else printf 'FAIL  compose.yml requires %s, install.sh does not write it\n' "$var"; FAILED=1; fi
done

if [ "$FAILED" -eq 0 ]; then printf 'All install.sh checks passed.\n'; else printf 'install.sh checks FAILED.\n'; exit 1; fi
