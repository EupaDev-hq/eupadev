---
adr: 006
title: Interchangeable agent engine behind a fixed contract, Claude Code first
status: superseded by ADR-013
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-005, ADR-007]
check: partial
---
## Context
The agent launcher has an autonomous coding agent work on a tool's
repository (scope, code, review, fix). Claude Code is today the most
reliable for this work but officially runs only Claude models; some
companies have another provider under contract or require a model hosted
in-house. Testing the whole chain with real agents costs AI calls on every
try. Claude Code is distributed under Anthropic's commercial terms, not
under a free licence: EupaDev (Apache 2.0) cannot redistribute it; it is
installed from npm (`@anthropic-ai/claude-code`) and whoever installs it
accepts these terms. The choice of a model and an effort per role is a
separate decision, which uses this contract without being part of it.

## Decision
Have the agent launcher call an agent engine behind a fixed input/output
contract, with Claude Code as engine no. 1.
- **Input**: repository, instruction, rules, budget cap, launcher
  parameters passed as is (model, effort); **output**: modified code,
  common JSON report, cost and tokens.
- **Claude Code never shipped by EupaDev**: no image published by
  EupaDev contains it. The launcher image is built by the CI of the
  client's forge, whose Dockerfile downloads Claude Code from npm at an
  exact version: the client accepts the terms itself and uses its key.
  A version upgrade is a reviewed change of this Dockerfile.
- **Signature**: this image is signed with the cosign key of the client's
  installation (not by EupaDev, which does not see it) and verified
  before each launch; unsigned or other key = refused.
- A 2nd model-agnostic engine (candidate: OpenHands, MIT) is plugged in only
  if a client asks for it.
- Agent rules neutral in `AGENTS.md`; what is specific to Claude Code
  (`.claude/agents/`) is isolated so that it can be translated.
- A **fake engine**, behind the same contract, drops prepared code and
  report: it tests the whole chain without an AI call.

## Rejected alternatives
- Calling Claude Code directly — closes the door to other providers and to
  the fake engine.
- Claude Code pointed at another model through `ANTHROPIC_BASE_URL` and a
  gateway — not supported by the publisher, behaviour not guaranteed at
  each update; rejected as a long-term solution, possible as a trial before
  a 2nd engine.
- Agent frameworks (LangGraph, Mastra, CrewAI) — one more layer, bringing
  nothing that DBOS and a command-line agent do not already do.

## Consequences
- Another engine is plugged in through an adapter, without rewriting the
  orchestrator.
- **Limit**: contract drawn with a single real implementation and a fake;
  it will probably be reworked at the 2nd engine (Claude-specific fields,
  cost format, session resume).
- **Limit**: a model hosted at the client's today codes less well
  autonomously (more iterations, time and budget per task).
- With Claude Code, code and exchanges go to the provider (ADR-001).
- Each client builds its launcher image: dependency on its forge's npm
  access, and two clients can have two versions, each pinned in the
  Dockerfile.

## Verification
- The contract is a typed interface (`AgentEngine`,
  `orchestrator/src/external/contracts.ts`): the compiler refuses an engine
  that does not respect it.
- The engine's CI will run the chain end to end with the fake engine, and a
  pattern rule there will refuse any launch of `claude` outside the Claude
  Code adapter.
- EupaDev's CI will look for `@anthropic-ai/claude-code` in the images
  it publishes and will refuse the publication if it is there.
- The launcher will verify its image's signature before launching an agent;
  a test will prove it with an unsigned image.
