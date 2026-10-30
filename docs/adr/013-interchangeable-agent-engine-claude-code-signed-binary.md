---
adr: 013
title: Interchangeable agent engine behind a fixed contract, Claude Code first, installed from its signed binary
status: accepted
date: 2026-10-13
decision-makers: Ilan
supersedes: ADR-006
related: [ADR-001, ADR-005, ADR-007]
check: partial
---
## Context
The agent launcher has an autonomous coding agent work on a tool's
repository (scope, code, review, fix). Claude Code is today the most
reliable for this work but officially runs only Claude models; some
companies have another provider under contract or require a model hosted
on their premises. Testing the whole chain with real agents costs AI calls
on every trial. Claude Code is distributed under Anthropic's commercial
terms, not under a free licence: EupaDev (Apache 2.0) cannot
redistribute it; whoever installs it accepts these terms. The choice of a
model and an effort per role is a separate decision, which uses this
contract without being part of it.

Anthropic publishes Claude Code in two ways: the npm package
`@anthropic-ai/claude-code`, and a standalone binary per platform
(`downloads.claude.ai/claude-code-releases/<version>/`). For the binary,
each version publishes a `manifest.json` (sha256 of each binary) signed by
Claude Code's GPG release key, whose fingerprint appears in Anthropic's
documentation (code.claude.com/docs/en/setup, "Binary integrity and code
signing"). The build variant of the golden images no longer has npm: it
made the Trivy scan fail. The binary exists for Linux only in x86_64 and
arm64, and depends on no package manager.

## Decision
Have the agent launcher call an agent engine behind a fixed input/output
contract, with Claude Code as engine no. 1, installed from its signed
binary.
- **Input**: repository, instruction, rules, budget cap, launcher
  parameters passed as is (model, effort); **output**: modified code,
  common JSON report, cost and tokens.
- **Claude Code never shipped by EupaDev**: no image published by
  EupaDev contains it. The launcher image is built by the CI of the
  client's forge, whose Dockerfile downloads the Claude Code binary at an
  exact version: the client accepts the terms itself and uses its own key.
  A version upgrade is a reviewed change of this Dockerfile.
- **Verified download**: fingerprint of the release key pinned in the
  Dockerfile; manifest signature by this key; manifest version equal to the
  pinned version; binary sha256 equal to the manifest's; a single mismatch
  stops the build. The download tools (curl, gpg) stay in a throwaway
  stage, out of the final image.
- **Signature**: this image is signed by the cosign key of the client's
  installation (not by EupaDev, which does not see it) and verified
  before each launch; unsigned or another key = refused.
- A 2nd model-agnostic engine (candidate: OpenHands, MIT) is plugged in
  only if a client asks for it.
- Neutral agent rules in `AGENTS.md`; what is specific to Claude Code
  (`.claude/agents/`) is isolated so that it can be translated.
- A **fake engine**, behind the same contract, drops prepared code and
  report: it tests the whole chain without any AI call.

## Rejected alternatives
- Install from npm (`npm install -g @anthropic-ai/claude-code`) — puts npm
  back in the build image, and integrity rests on the npm registry, not on
  a vendor signature verified at build time.
- Install with Anthropic's `curl … | bash` script — it downloads the latest
  version instead of a pinned version.
- Call Claude Code directly — closes the door to other providers and to the
  fake engine.
- Claude Code towards another model through `ANTHROPIC_BASE_URL` and a
  gateway — not supported by the vendor, behaviour not guaranteed at each
  update; rejected as a long-term solution, possible as a trial before a
  2nd engine.
- Agent frameworks (LangGraph, Mastra, CrewAI) — one more layer without
  bringing anything that DBOS and a command-line agent do not already do.

## Consequences
- Another engine plugs in through an adapter, without rewriting the
  orchestrator.
- **Limit**: contract designed with a single real implementation and a
  fake; it will probably be reworked at the 2nd engine (Claude-specific
  fields, cost format, session resume).
- **Limit**: a model hosted at the client today codes less well
  autonomously (more iterations, time and budget per task).
- With Claude Code, code and exchanges go to the provider (ADR-001).
- Each client builds its launcher image: dependence on its forge's access
  to `downloads.claude.ai`, and two clients may have two versions, each
  pinned in the Dockerfile.
- If Anthropic changes its release key, the build fails until the reviewed
  update of the pinned fingerprint: safe failure, wanted.
- Trivy does not scan inside the binary: its integrity rests on Anthropic's
  signature.

## Verification
- The contract is a typed interface (`AgentEngine`,
  `orchestrator/src/external/contracts.ts`): the compiler refuses an engine
  that does not respect it.
- The image build refuses a manifest not signed by the pinned key, another
  version or a binary with another digest.
- The real test of the agent image (`infra/ansible/verify-image-agent.yml`)
  checks the cosign signature of the published image and that
  `claude --version` answers the pinned version.
- The engine's CI will run the chain end to end with the fake engine, and a
  pattern rule there will refuse any launch of `claude` outside the Claude
  Code adapter.
- EupaDev's CI will look for the `claude` binary and the
  `@anthropic-ai/claude-code` package in the images it publishes and will
  refuse the publication if they are there.
- The launcher will verify the signature of its image before launching an
  agent; a test will prove it with an unsigned image.
