# TEST image of the Claude Code engine (tests/claude-engine.test.ts): same shape as images/agent (git, sh, user
# 10001, /home/agent), but a FAKE `claude` that imitates the documented JSON output. No AI call. Built locally.
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
# /var/trial-root: a directory of the root owned by 10001, to see that --read-only (not the permissions) protects the root.
RUN apk add --no-cache git && adduser -D -u 10001 -h /home/agent agent && install -d -o 10001 -g 10001 /var/trial-root
COPY claude /usr/local/bin/claude
USER 10001:10001
WORKDIR /home/agent
