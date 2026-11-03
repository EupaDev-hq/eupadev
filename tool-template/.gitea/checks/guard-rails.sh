#!/bin/sh
# Guard-rails (M3): what an agent must never be able to slip in.
# Run by the "guard-rails" job of check.yml, which runs NO code of the
# agent: git, grep, the install of the dependencies without any script, and
# node to read the JSON of the licences and of package.json (code of this
# file and of package.mjs). Protected files (.gitea/**): an agent can neither
# change nor bypass them.
#
#   1. Exceptions (markers such as nosemgrep, files such as .gitleaksignore):
#      for each file and pattern, count found ≤ sum of the unexpired lines of
#      the registry .gitea/exceptions.txt (0 without a line).
#   2. Licences of EVERY dependency (development ones included): allowed
#      list, unknown or missing licence refused.
#   3. Trivy exceptions (.trivyignore.yaml): each one expires within 30 days
#      at most (an "expired_at" date is mandatory).
#   4. Root package.json (A-R0): no lifecycle script (preinstall, install,
#      postinstall, prepare…), no devEngines (package.mjs).
#      Core reference (G4): registry versions only, @eupadev/core at an
#      exact version, resolved from the registry in pnpm-lock.yaml.
#   5. Acceptance suite: features need tests/acceptance/playwright.config.js;
#      @playwright/test = the Playwright image of acceptance.sh.
#
# Registry .gitea/exceptions.txt: one line per exception approved at the gate,
# written by a human (branch exception/**, merged by them):
#   # expires;file;pattern;count;reason
#   2026-12-31;api/report.js;nosem;1;false positive eval on a constant, gate of 2026-10-20
# pattern: one of the patterns below, or "file" for the presence of a
# scanner exception file. expires: at most one year after today; once past,
# the line no longer counts. Malformed line: red.
#
# Registry read on the forge, never in the branch under test:
#   - branch (agent/…): the forge's main (git fetch origin main);
#   - push on main: the one of the commit itself (protected file on main);
#   - registry missing, or no main on the forge: no exception allowed.
# As argument, an explicit revision where to read the registry (local trials).
#
# Neither .gitea/ nor Markdown files (prose) are counted: .gitea/ is refused
# at push on the agents' branches, and whoever can change it can remove this
# job (this script itself holds every pattern).
#
# Accepted limit: a grep is bypassed by twisted code (test['sk' + 'ip']).
# The acceptance tests (written by another role) remain the safety net.
set -u
cd "$(dirname "$0")/../.." || exit 1

# Same version as the golden image (images/base-node/Dockerfile).
PNPM_VERSION=12.16.1
# List of .claude/rules/quality.md (SPDX identifiers).
ALLOWED_LICENSES="MIT BSD-2-Clause BSD-3-Clause Apache-2.0 ISC MPL-2.0 0BSD CC0-1.0 BlueOak-1.0.0"
MAX_DURATION_DAYS=30
REGISTRY=.gitea/exceptions.txt
PATTERNS='nosem
noopengrep
gitleaks:allow
hadolint ignore
eslint-disable
@ts-ignore
@ts-nocheck
@ts-expect-error
.skip(
skip:
.todo(
todo:
.only(
continue-on-error
|| true
squawk-ignore'

red=0
report() { echo "GUARD-RAIL $*"; red=1; }
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

# --- Exceptions registry -----------------------------------------------------
if [ $# -gt 0 ]; then
  git rev-parse --verify -q "$1^{commit}" > /dev/null || { echo "Revision not found: $1"; exit 1; }
  src=$1; src_name=$1
elif [ "${GITHUB_REF:-}" = refs/heads/main ]; then
  src=HEAD; src_name="this commit of main"
else
  git ls-remote --exit-code origin refs/heads/main > /dev/null; rc=$?
  if [ $rc -eq 0 ]; then
    git fetch -q --depth=1 origin main || { echo "Cannot read main on the forge"; exit 1; }
    src=FETCH_HEAD; src_name="the forge's main"
  elif [ $rc -eq 2 ]; then
    src=""; src_name="no main on the forge"
  else
    echo "Forge unreachable: cannot read the exceptions registry"; exit 1
  fi
fi
if [ -n "$src" ] && git cat-file -e "$src:$REGISTRY" 2> /dev/null; then
  git show "$src:$REGISTRY" > "$tmp/registry" || exit 1
  echo "Exceptions registry: $REGISTRY ($src_name)"
else
  : > "$tmp/registry"
  echo "Exceptions registry: missing ($src_name): no exception allowed"
fi

# Valid and unexpired lines → "pattern;file;count" in $tmp/allowed.
today=$(date -u +%F | tr -d -)
max=$(date -u -d '+1 year' +%F)
num=0; cr=$(printf '\r')
faulty_line() { report "registry $REGISTRY, line $num: $*: \"$l\""; }
: > "$tmp/allowed"
while IFS= read -r l || [ -n "$l" ]; do
  num=$((num + 1)); l=${l%"$cr"}
  case $l in ''|'#'*) continue ;; esac
  case $l in *';'*';'*';'*';'*) ;; *) faulty_line "fewer than 5 fields (expires;file;pattern;count;reason)"; continue ;; esac
  expires=${l%%;*}; r=${l#*;}; file=${r%%;*}; r=${r#*;}
  pattern=${r%%;*}; r=${r#*;}; count=${r%%;*}; reason=${r#*;}
  if ! printf '%s' "$expires" | grep -q -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
      || [ "$(date -u -d "$expires" +%F 2> /dev/null)" != "$expires" ]; then
    faulty_line "invalid expiry date \"$expires\" (format YYYY-MM-DD)"
  elif [ "$(echo "$expires" | tr -d -)" -gt "$(echo "$max" | tr -d -)" ]; then
    faulty_line "expires on $expires, more than a year ahead (at most $max)"
  elif [ -z "$file" ]; then
    faulty_line "empty file"
  elif ! printf '%s\nfile\n' "$PATTERNS" | grep -q -x -F -e "$pattern"; then
    faulty_line "unknown pattern \"$pattern\""
  elif ! printf '%s' "$count" | grep -q -x -E '0|[1-9][0-9]{0,5}'; then
    faulty_line "count \"$count\" not an integer (0 to 999999, no leading zero)"
  elif [ -z "$reason" ]; then
    faulty_line "empty reason"
  elif [ "$(echo "$expires" | tr -d -)" -lt "$today" ]; then
    echo "Registry $REGISTRY, line $num expired on $expires: it no longer counts: \"$l\""
  else
    echo "$pattern;$file;$count" >> "$tmp/allowed"
  fi
done < "$tmp/registry"

allowed() { # $1 pattern, $2 file: sum of the valid and unexpired lines
  s=0
  while IFS=';' read -r pm pf pn; do
    if [ "$pm" = "$1" ] && [ "$pf" = "$2" ]; then s=$((s + pn)); fi
  done < "$tmp/allowed"   # ponytail: linear search, fast enough for a few lines
  echo "$s"
}
missing=0
compare() { # $1 pattern, $2 file, $3 count found
  p=$(allowed "$1" "$2")
  if [ "$3" -gt "$p" ]; then
    report "pattern \"$1\" in $2: $3 found, $p allowed by the registry $REGISTRY ($src_name)"
    missing=1
  fi
}

# --- 1. Exceptions, file by file ----------------------------------------------
head_tree=$(git rev-parse "HEAD^{tree}") || exit 1
while IFS= read -r pattern; do
  opt=-F   # nosem (nosemgrep, NOSEM…) and noopengrep (Opengrep ≥ 1.15): case-insensitive
  case $pattern in nosem|noopengrep) opt=-i ;; esac
  git grep -c "$opt" -e "$pattern" "$head_tree" -- . ':(exclude).gitea' ':(exclude)*.md' \
    | sed "s|^$head_tree:||" > "$tmp/found"
  while IFS= read -r line; do
    compare "$pattern" "${line%:*}" "${line##*:}"
  done < "$tmp/found"
done <<EOF
$PATTERNS
EOF
# Scanner exception files: pattern "file", one per path.
git ls-tree -r --name-only "$head_tree" | grep -v '^\.gitea/' \
  | grep -E '(^|/)(\.gitleaksignore|\.gitleaks\.toml|\.semgrepignore|\.hadolint\.yaml|\.trivyignore)$' > "$tmp/found"
while IFS= read -r f; do compare file "$f" 1; done < "$tmp/found"
if [ "$missing" -ne 0 ]; then
  echo "Exception to be approved: add a line to the registry $REGISTRY by the human route (branch exception/**), in the format \"expires;file;pattern;count;reason\"."
fi

# --- 2. Licences of every dependency -----------------------------------------
# pnpm of the golden image, whatever the repository: version imposed on
# corepack (the packageManager field and an agent's .corepack.env are ignored;
# pnpm refuses to run if packageManager asks for another version).
# --ignore-scripts and --ignore-pnpmfile: no script nor .pnpmfile.cjs of the
# agent runs (pnpm runs .pnpmfile.cjs at install AND during
# "licenses list", checked with pnpm 12.9.1).
pinned_pnpm() {
  COREPACK_ENV_FILE=0 COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    corepack "pnpm@$PNPM_VERSION" "$@" --ignore-pnpmfile
}
if [ ! -f package.json ]; then
  report "licences: package.json missing"
else
  # A node_modules tracked by Git could pass for the install.
  find . -name node_modules -type d -prune -exec rm -rf {} +
  if ! pinned_pnpm install --frozen-lockfile --ignore-scripts; then
    report "licences: cannot install the dependencies (pnpm install --frozen-lockfile)"
  elif ! pinned_pnpm licenses list --json > "$tmp/licenses.json"; then
    report "licences: pnpm licenses list failed"
  else
    # An SPDX expression ("MIT OR Apache-2.0") is allowed if each of its
    # identifiers is allowed; "Unknown", empty or any other form: refused.
    node -e '
      const [file, list] = process.argv.slice(1);
      const allowed = new Set(list.split(" "));
      const json = JSON.parse(require("fs").readFileSync(file, "utf8"));
      let refused = 0;
      for (const [key, packages] of Object.entries(json)) {
        for (const p of packages) {
          const licence = String(p.license ?? key);
          const ids = licence.replace(/[()]/g, " ").split(/\s+/).filter((t) => t && t !== "OR" && t !== "AND");
          if (ids.length === 0 || !ids.every((id) => allowed.has(id))) {
            console.log(`GUARD-RAIL licence refused: ${p.name}@${(p.versions || []).join(",")} (${licence})`);
            refused++;
          }
        }
      }
      process.exit(refused ? 1 : 0);
    ' "$tmp/licenses.json" "$ALLOWED_LICENSES" || red=1
  fi
fi

# --- 3. Dated Trivy exceptions (.trivyignore.yaml) ---------------------------
# Accepted format (strict, any other form is refused):
#   vulnerabilities:            (or misconfigurations, secrets, licenses)
#     - id: CVE-2026-12345
#       expired_at: 2026-11-15
#       statement: "reason, gate of …"
# After expired_at, Trivy puts the vulnerability back in its results: the
# pipeline turns red again by itself.
if [ -f .trivyignore.yaml ]; then
  max=$(date -u -d "+$MAX_DURATION_DAYS days" +%F)
  section=""; e=-1; k=-1; num=0; dates=0
  end_entry() {
    if [ "$num" -gt 0 ] && [ "$dates" -ne 1 ]; then
      report ".trivyignore.yaml: entry no. $num ($section) must have one and only one expired_at date"
    fi
  }
  verify_date() { # $1: text after "expired_at:"
    d=$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*#.*$//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//")
    dates=$((dates + 1))
    if ! printf '%s' "$d" | grep -q -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
        || [ "$(date -u -d "$d" +%F 2>/dev/null)" != "$d" ]; then
      report ".trivyignore.yaml: entry no. $num has an invalid expired_at date: \"$d\" (format YYYY-MM-DD)"
    elif [ "$(echo "$d" | tr -d -)" -gt "$(echo "$max" | tr -d -)" ]; then
      report ".trivyignore.yaml: entry no. $num expires on $d, beyond $MAX_DURATION_DAYS days (at most $max)"
    fi
  }
  while IFS= read -r l || [ -n "$l" ]; do
    t=${l#"${l%%[! ]*}"}; ind=$(( ${#l} - ${#t} ))
    case "$t" in ''|'#'*) continue ;; esac
    case "$l" in *"	"*) report ".trivyignore.yaml: tab forbidden: \"$l\""; continue ;; esac
    if [ "$ind" -eq 0 ] && [ "${t#-}" = "$t" ]; then
      end_entry; num=0; dates=0; e=-1
      case "$t" in
        vulnerabilities:|misconfigurations:|secrets:|licenses:) section=${t%:} ;;
        *) section=""; report ".trivyignore.yaml: line not recognised: \"$l\"" ;;
      esac
      continue
    fi
    if [ -z "$section" ]; then report ".trivyignore.yaml: line outside a section: \"$l\""; continue; fi
    case "$t" in
      '- '*|'-')
        [ "$e" -lt 0 ] && e=$ind
        if [ "$ind" -eq "$e" ]; then
          end_entry
          num=$((num + 1)); dates=0
          rest=${t#-}; rest=${rest#"${rest%%[! ]*}"}
          k=$(( ind + ${#t} - ${#rest} ))
          case "$rest" in
            '{'*) report ".trivyignore.yaml: entry no. $num on one line ({…}) refused: \"$l\"" ;;
            expired_at:*) verify_date "${rest#expired_at:}" ;;
          esac
        elif [ "$ind" -lt "$e" ]; then
          report ".trivyignore.yaml: indentation not recognised: \"$l\""
        fi ;;
      expired_at:*)
        if [ "$num" -gt 0 ] && [ "$ind" -eq "$k" ]; then verify_date "${t#expired_at:}"; fi ;;
      *)
        if [ "$num" -eq 0 ] || [ "$ind" -lt "$k" ]; then
          report ".trivyignore.yaml: line not recognised: \"$l\""
        fi ;;
    esac
  done < .trivyignore.yaml
  end_entry
fi

# --- 4. package.json: neither lifecycle script nor devEngines (A-R0) ---------
# Code of .gitea/checks/package.mjs (protected); package.json is only read.
# It also reads pnpm-lock.yaml next to it (core reference, G4).
if [ -f package.json ]; then
  node .gitea/checks/package.mjs package.json || red=1
fi

# --- 5. Acceptance suite against the Preview -----------------------------
# Features without the Playwright config would turn the Preview job red: caught
# here, on the agent branch. The Playwright image of acceptance.sh must be the
# version of @playwright/test in package.json (Renovate bumps both).
if git ls-tree -r --name-only "$head_tree" -- tests/acceptance/features | grep -q . \
    && [ ! -f tests/acceptance/playwright.config.js ]; then
  report "acceptance: tests/acceptance/features/ without tests/acceptance/playwright.config.js"
fi
image=$(sed -n 's|^IMAGE=mcr\.microsoft\.com/playwright:v\([0-9.]*\)-.*|\1|p' .gitea/checks/acceptance.sh)
if [ -f package.json ]; then
  package_version=$(node -e 'const p = require("./package.json"); process.stdout.write(String({ ...p.dependencies, ...p.devDependencies }["@playwright/test"] ?? ""))')
  if [ -n "$package_version" ] && [ "$package_version" != "$image" ]; then
    report "acceptance: @playwright/test $package_version in package.json, Playwright image $image in .gitea/checks/acceptance.sh"
  fi
fi

if [ "$red" -ne 0 ]; then
  echo "Guard-rails: RED. A justified exception is decided at the gate; a human then writes it in the registry $REGISTRY."
  exit 1
fi
echo "Guard-rails: nothing to report (exceptions, exception files, licences, Trivy exceptions, package.json, core reference, acceptance suite)."
