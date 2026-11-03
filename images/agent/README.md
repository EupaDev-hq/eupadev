# Image of the AI agents (Claude Code engine)

Repository `agent` of the forge, synced by Ansible (`gitea_platform_repos`)
from EupaDev: this directory at the root, plus the installation's cosign
public key at its original path in EupaDev.

**Claude Code is not in this repository and EupaDev publishes no image
that contains it** (ROADMAP §8.11 "Licences", ADR-013): the CI of the
installation's forge downloads it, accepting Anthropic's terms itself.

## Build

`Dockerfile`, from the `build` variant of the golden image
(`BASE_IMAGE_BUILD`, resolved to a digest by the pipeline and written into the
labels `org.opencontainers.image.base.*`):

| Item | Choice |
|---|---|
| Claude Code | pinned version `CLAUDE_CODE_VERSION`, official `linux-x64` binary from `downloads.claude.ai` |
| Verification | Anthropic's method ("Binary integrity and code signing"): pinned GPG key fingerprint, signature of `manifest.json` by that key, manifest version, sha256 of the binary against the manifest; one failing step = build refused |
| git | Debian package (the agent commits locally, the launcher pushes) |
| User | `agent`, uid/gid 10001, never root |
| Left out | Docker client, sudo, curl, gpg, npm; **no setuid/setgid bit** |
| Settings | `DISABLE_AUTOUPDATER=1`, `DISABLE_UPDATES=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (not `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`: see the Dockerfile) |
| Managed settings | `/etc/claude-code/managed-settings.json` (root, 0644, read-only root): hooks forbidden, `bypassPermissions` forbidden, Edit `deny` on the forbidden paths, `Read(//tmp/task/**)` allowed, no CLAUDE.md. **Generated** by `orchestrator/scripts/generate-claude-check.ts` (`pnpm generate`) from the same list as the launcher (`src/agent-engine/forbidden-paths.ts`); a test fails if it drifts |

Claude Code version bump: change `CLAUDE_CODE_VERSION` in the Dockerfile,
through a reviewed PR (Renovate proposes it, `renovate.json`).

## Pipeline

`.gitea/workflows/publish.yml` (runner `ci-image`): on every change, every
Monday at 05:00 (after the golden image) or by hand, it builds the image,
scans it (Trivy), checks its promises (non-root, neither docker nor sudo, no
setuid, `claude --version` = pinned version), checks Claude Code (the
engine's options accepted, then the upstream trial below: a failing
assertion = image not published), publishes it to the forge's registry under
the tag `<version>-<YYYYMMDD>`, signs it with cosign and the installation's
key (repository secrets `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`, no public
transparency log) and verifies the signature. Its log ends with
`Agent image digest: <registry>/eupadev/agent@sha256:…`, the only
reference the launcher uses.

Real test: `infra/ansible/verify-image-agent.yml`.

## Upstream trial (free)

`check/upstream-trial/launch.sh <image>`: the image's Claude Code, with the engine's command line, against a fake Node
upstream server that logs requests and answers scripted `tool_use` blocks, in a trapped clone (project and user
settings, hooks, CLAUDE.md, AGENTS.md, `paths:` rule, `.mcp.json`, each with a canary); `--internal` network, fake key.
Checks that no canary reaches the model, that the "attacker" named by the settings receives nothing, that hooks and MCP
do not start, that forbidden paths are refused and that normal work goes through (`verify.mjs`); first passed on
2026-10-15.

In the pipeline (step "Claude Code is not hijacked by a trapped repository"), before publication and signature:
`VARIANTS="code read reviewer"` (the three passes with assertions, the witnesses only serve the analysis), on the CI
VM's Docker (runner `ci-image`), about 15 s. It is the guard-rail of a Claude Code version bump (Renovate PR on
`CLAUDE_CODE_VERSION`) that would change behaviour. Locally: without `VARIANTS`, every pass, witnesses included.
Counter-test (2026-10-16): an image whose `claude` drops `--restricted` fails 19 assertions (requests to the attacker).
Variant `reviewer` (A-R4, ADR-020): trapped clone, `--tools Bash,Read` without permission; `grep` in the repository and
`cat` in `/tmp/task` go through, redirection, `node -e`, `Edit` and any read outside the working directories are
refused. Passed locally on 2026-10-18 (Claude Code 2.1.287), without `blockReadsOutsideWorkingDirectories`: that
setting adds nothing for the reviewers and refuses the allowed Bash of the code roles outside the clone (the `code`
variant checks it).
