#!/bin/sh
# What a running discovery installation must answer (ADR-028), checked with
# curl alone, the way the CI job and a doubtful human do it after
# `install.sh discovery`: the notice in /health and on the page, Mailpit, a
# real sign-in of each account through the engine's web flow (one cookie jar
# each), then one whole cycle driven through the API with the two hats: the
# request as the requester, the mock-up accepted, Gate 1 approved by the
# admin, the Preview accepted, Gate 2 approved by the admin on the candidate
# digest, the tool "in production". Everything between the human steps
# (scoping, hardening, merge, CI, Preview pipeline, deployments) is the fake
# world answering by itself: the cycle ends in `end_success`, the furthest
# state there is. The passwords are read from the owner-only environment
# file of the installation and never printed.
#   sh tests/install/discovery-smoke.sh [DIR]   (DIR: ~/.eupadev/discovery)
set -eu

DIR="${1:-${EUPADEV_HOME:-$HOME/.eupadev}/discovery}"
ENV_FILE="$DIR/.env"
ADDRESS="$(sed -n 's/^EUPADEV_ADDRESS=//p' "$ENV_FILE")"
PAGE="http://${ADDRESS:-localhost}:8080"
MAIL="http://${ADDRESS:-localhost}:8025"
REQUESTER_JAR="$(mktemp)"
ADMIN_JAR="$(mktemp)"
trap 'rm -f "$REQUESTER_JAR" "$ADMIN_JAR"' EXIT
FAILED=0
# Longest wait for one state (seconds): the fake watcher polls every second,
# the fake agents answer at once; a minute covers a slow runner.
WAIT_S=90

ok() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
# body_has <description> <needle> <curl arguments...>
body_has() { desc="$1"; needle="$2"; shift 2; body=$(curl -s "$@"); case "$body" in *"$needle"*) ok "$desc" ;; *) fail "$desc: no \"$needle\" in: $(printf '%s' "$body" | head -c 300)" ;; esac; }

body_has "/health says discovery mode" '"discovery":true' -H 'X-EupaDev: 1' "$PAGE/health"
body_has "/health carries the notice" 'not for production' -H 'X-EupaDev: 1' "$PAGE/health"
body_has "the page shows the notice" 'data-discovery="1"' "$PAGE/"
body_has "Mailpit answers" '"Version"' "$MAIL/api/v1/info"
body_has "the sign-in service serves its keys" '"keys"' "http://${ADDRESS:-localhost}:8081/realms/eupadev/protocol/openid-connect/certs"

# sign_in <account> <jar>: the engine's /auth/login, the issuer's form, the callback; the session cookie lands in the jar.
sign_in() {
  password="$(sed -n "s/^SIGNIN_$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')_PASSWORD=//p" "$ENV_FILE")"
  [ -n "$password" ] || { fail "no password of $1 in the environment file"; return; }
  : > "$2"
  form_url="$(curl -s -o /dev/null -c "$2" -w '%{redirect_url}' "$PAGE/auth/login")"
  back_url="$(curl -s -o /dev/null -w '%{redirect_url}' --data-urlencode "username=$1" --data-urlencode "password=$password" "$form_url")"
  case "$back_url" in "$PAGE/auth/callback?"*code=*) ;; *) fail "sign-in of $1: the issuer did not send a code back to the page"; return ;; esac
  curl -s -o /dev/null -b "$2" -c "$2" "$back_url"
  body_has "$1 signed in and sees the requests page" "\"roles\":[\"$1\"]" -b "$2" -H 'X-EupaDev: 1' "$PAGE/requests"
}
sign_in admin "$ADMIN_JAR"
sign_in requester "$REQUESTER_JAR"

# One request by the requester: the fake scoping answers by itself and the first gate mail goes to Mailpit.
created=$(curl -s -b "$REQUESTER_JAR" -H 'X-EupaDev: 1' -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-request-$(date +%s)" \
  -d '{"type":"creation","name":"Loan log","slug":"loan-log","owner_service":"Library","need":"A page where colleagues log the books they borrow and return."}' "$PAGE/requests")
CYCLE=$(printf '%s' "$created" | sed -n 's/.*"cycle_id":\([0-9]*\).*/\1/p')
if [ -n "$CYCLE" ]; then ok "a request is created (cycle $CYCLE)"; else fail "a request is created: no cycle_id in: $(printf '%s' "$created" | head -c 300)"; printf 'discovery smoke checks FAILED.\n'; exit 1; fi

# state_is <state>: waits until the cycle, read as the admin, is in that state (WAIT_S at most).
state_is() {
  tries=0
  until body=$(curl -s -b "$ADMIN_JAR" -H 'X-EupaDev: 1' "$PAGE/requests/$CYCLE") && case "$body" in *"\"state\":\"$1\""*) true ;; *) false ;; esac; do
    tries=$((tries + 1))
    if [ "$tries" -ge "$WAIT_S" ]; then fail "the cycle did not reach $1 within ${WAIT_S}s; last answer: $(printf '%s' "$body" | head -c 300)"; return 1; fi
    sleep 1
  done
  ok "the cycle is in state $1"
}
# mail_has <description> <needle>: waits until a mail in Mailpit contains the needle (subject or snippet).
mail_has() {
  tries=0
  until curl -s "$MAIL/api/v1/messages?limit=50" | grep -q -F "$2" || [ "$tries" -ge "$WAIT_S" ]; do tries=$((tries + 1)); sleep 1; done
  body_has "$1" "$2" "$MAIL/api/v1/messages?limit=50"
}
# send <description> <jar> <message json>: POST /messages for the cycle, 202 expected.
SENT=0
send() {
  SENT=$((SENT + 1))
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$2" -H 'X-EupaDev: 1' -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-$(date +%s)-$$-$SENT" \
    -d "{\"cycle_id\":$CYCLE,\"message\":$3}" "$PAGE/messages")
  if [ "$status" = "202" ]; then ok "$1"; else fail "$1: HTTP $status"; fi
}

# 1. The mock-up: the fake scoping deploys it, the requester is told by mail and accepts it.
state_is waiting_scoping_feedback || exit 1
mail_has "the first gate mail reached Mailpit" '"Mock-up available'
send "the requester accepts the mock-up" "$REQUESTER_JAR" '{"type":"scoping_feedback","outcome":"satisfied"}'

# 2. Contract, hardening rounds, merge, green CI: all fakes; the first delivery stops at Gate 1 for the admin.
state_is gate_1 || exit 1
mail_has "the admin is asked to decide at Gate 1" 'Decision required — Gate 1'
body_has "the requester cannot decide at a gate" '403' -o /dev/null -w '%{http_code}' -b "$REQUESTER_JAR" -H 'X-EupaDev: 1' -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-wrong-hat-$(date +%s)" \
  -d "{\"cycle_id\":$CYCLE,\"message\":{\"type\":\"decision\",\"gate\":\"gate_1\",\"outcome\":\"approved\"}}" "$PAGE/messages"
send "the admin approves Gate 1 (name and domain)" "$ADMIN_JAR" '{"type":"decision","gate":"gate_1","outcome":"approved"}'

# 3. Preview deployed, Preview pipeline green (fakes): the requester gets the link and accepts it.
state_is waiting_preview_feedback || exit 1
mail_has "the requester gets the Preview link" 'Preview available'
send "the requester accepts the Preview" "$REQUESTER_JAR" '{"type":"preview_feedback","outcome":"satisfied"}'

# 4. Gate 2: the admin approves the exact candidate digest (another person than the requester: four eyes).
state_is gate_2 || exit 1
DIGEST=$(curl -s -b "$ADMIN_JAR" -H 'X-EupaDev: 1' "$PAGE/requests/$CYCLE" | sed -n 's/.*"candidate_digest":"\(sha256:[0-9a-f]*\)".*/\1/p')
if [ -n "$DIGEST" ]; then ok "Gate 2 shows the candidate digest"; else fail "Gate 2 shows the candidate digest: none"; exit 1; fi
send "the admin approves Gate 2 on that digest" "$ADMIN_JAR" "{\"type\":\"decision\",\"gate\":\"gate_2\",\"outcome\":\"approved\",\"digest\":\"$DIGEST\"}"

# 5. Prod deployed (fake): the end of the cycle, and the requester told so.
state_is end_success || exit 1
mail_has "the requester is told the tool is in production" 'tool in production'

if [ "$FAILED" -eq 0 ]; then printf 'The discovery installation answers as documented: one whole cycle, up to end_success.\n'; else printf 'discovery smoke checks FAILED.\n'; exit 1; fi
