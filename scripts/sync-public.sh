#!/usr/bin/env bash
# Updates the public repository from this repository's `main`.
#
#   scripts/sync-public.sh [--dry-run] [PUBLIC_CHECKOUT]
#
# PUBLIC_CHECKOUT (default /home/ilan/EupaDev) must be clean and on `main`.
# The `main` tree of this repository (the committed tree, not the working
# directory; SYNC_REF overrides the ref) is exported into it minus the
# private notes (docs/reflexions/) and the deny list below; files removed
# upstream are removed too, except under the excluded paths (the public
# checkout keeps its own docs/reflexions/README.md).
#
# Privacy guard on the result: scripts/sync-public.deny (one extended
# regex per line, case-insensitive, matched against every text line; a
# line starting with "!" exempts the hits matching it, as
# "path:line:matched text"; "#" comments), gitleaks when installed, and
# .github/scripts/check-english.py. Any hit: the paths are printed, the
# script stops, the public checkout keeps the changes for inspection.
#
# Clean: one signed-off commit. Never pushes.
# --dry-run: export and guard in a temporary directory, nothing else.
set -euo pipefail

dev=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ref=${SYNC_REF:-main}
public=/home/ilan/EupaDev
dry=0
for arg in "$@"; do
  case $arg in
    --dry-run) dry=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) public=$arg ;;
  esac
done
deny=$dev/scripts/sync-public.deny
excluded=(docs/reflexions scripts/sync-public.deny)
die() { echo "sync-public: $*" >&2; exit 1; }

if (( dry )); then
  tree=$(mktemp -d)
  trap 'rm -rf "$tree"' EXIT
  git -C "$tree" init -q -b main  # check-english.py lists the tracked files
  echo "Dry run: exporting $ref into $tree"
else
  tree=$public
  git -C "$tree" rev-parse --is-inside-work-tree > /dev/null 2>&1 || die "$tree is not a git checkout"
  [[ $(git -C "$tree" branch --show-current) == main ]] || die "$tree is not on main"
  [[ -z $(git -C "$tree" status --porcelain) ]] || die "$tree has uncommitted changes"
  # Everything tracked goes, except the excluded paths; the export puts back what still exists.
  keep=$(IFS='|'; echo "${excluded[*]}")
  # The paths are relative to the public checkout: rm runs there, never in the caller's directory.
  git -C "$tree" ls-files -z | { grep -zvE "^(${keep//./\\.})(/|$)" || true; } | (cd "$tree" && xargs -0 -r rm -f)
fi

pathspecs=()
for path in "${excluded[@]}"; do pathspecs+=(":!$path"); done
git -C "$dev" archive --format=tar "$ref" "${pathspecs[@]}" | tar -x -C "$tree"
git -C "$tree" add -A

failed=0

# 1. Deny list.
patterns=() exempt=()
while IFS= read -r line; do
  [[ -z $line || $line == \#* ]] && continue
  if [[ $line == !* ]]; then exempt+=("${line#!}"); else patterns+=("$line"); fi
done < "$deny"
args=()
for p in "${patterns[@]}"; do args+=(-e "$p"); done
hits=$(cd "$tree" && { grep -rnioIE --exclude-dir=.git "${args[@]}" . || true; } | sed 's|^\./||')
for e in "${exempt[@]}"; do hits=$(grep -viE -- "$e" <<< "$hits" || true); done
if [[ -n $hits ]]; then
  echo "Deny list hits (path:line:match):"
  echo "$hits"
  failed=1
fi

# 2. Secrets.
if command -v gitleaks > /dev/null; then
  report=$(mktemp)
  rc=0
  # From inside the tree: relative paths, and its .gitleaksignore applies.
  (cd "$tree" && gitleaks detect --no-git --no-banner --redact -s . --report-format json \
    --report-path "$report" --exit-code 9 --log-level error) || rc=$?
  if (( rc == 9 )); then
    echo "gitleaks findings (path:line: rule):"
    jq -r '.[] | "\(.File):\(.StartLine): \(.RuleID)"' "$report"
    failed=1
  elif (( rc != 0 )); then
    die "gitleaks failed ($rc)"
  fi
  rm -f "$report"
else
  echo "gitleaks not installed: secret scan skipped"
fi

# 3. English only.
(cd "$tree" && python3 .github/scripts/check-english.py) || failed=1

if (( failed )); then
  (( dry )) || echo "The public checkout keeps the staged changes for inspection: git -C $public status"
  die "privacy guard failed, nothing committed"
fi
if (( dry )); then
  echo "Dry run clean: $(git -C "$tree" ls-files | wc -l) files would be published"
  exit 0
fi
if git -C "$public" diff --cached --quiet; then
  echo "The public checkout is already up to date with $ref"
  exit 0
fi
author=Ilan  # first name only in public (maintainer's decision, 2026-11-08)
git -C "$public" -c user.name="$author" -c user.email=admin@eupadev.org commit -q -s \
  -m "Sync with the development repository ($(date +%F))" -m "Assisted-by: Claude Opus 5.5"
git -C "$public" log -1 --stat --format='%h %s' | tail -1
echo "Committed, not pushed. Review it, then: git -C $public push origin main"
