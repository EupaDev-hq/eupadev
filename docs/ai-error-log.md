# AI error log

EupaDev is written by AI agents (Claude Code) under human decisions and
automatic checks. This log records the mistakes the AI made that a check or a
human review caught, so that anyone can judge whether the checks work. Newest
first. "Cost if missed" is our estimate.

| Date | What the AI did | Caught by | Cost if missed |
|---|---|---|---|
| 2026-10-29 | To leave the bare domain to the public DNS, the lab DNS sent it upstream, to the host; but the host sends the whole domain to the lab DNS: a loop, every lookup of the bare domain timed out. Tested with dnsmasq alone, not with the host's routing. | A real run on the lab: Let's Encrypt could not find the domain's DNS zone. | No public certificate for any site of the lab. |
| 2026-10-29 | The engine "fix" for the analysis details only renamed the check: the real forge watcher never read any details for it, only the fakes and unit tests supplied them. | Tracing the contract from the watcher to the template's CI, before changing the template. | Same as the 2026-10-28 entry: the details would still not have reached the agents. |
| 2026-10-29 | While renaming the product, a parser kept a fixed offset equal to the old prefix's length (`x.length + 12`): with a shorter name it cut the fields in the wrong place. | Engine unit tests (3 failed). | The core update at the start of every evolution would have read wrong fields. |
| 2026-10-29 | Translated infra playbooks still used half-renamed names left by earlier steps (deployer verbs and keys, a CI job name, a vault variable built from an old word). | Review of the infra step against the glossary, before any lab run. | The lab rebuild would have failed on about ten checks. |
| 2026-10-29 | A test filtered incident mails with `/Incident/`; once the mails were in English the filter matched nothing, so the assertion could no longer fail. | Mutation testing: one injected fault survived. | A broken incident mail would have passed CI. |
| 2026-10-29 | One field was named `archive` in one module and `archived` in another. | Review during the translation of stored values. | The orphan check of an archived tool would have been wrong. |
| 2026-10-28 | The front-end loaded its dictionaries with JSON module imports (`import … with { type: 'json' }`), unsupported by Firefox ESR before 138, common in companies. | Human review of the change. | Generated tools' screens would not load in those browsers. |
| 2026-10-28 | Real code (`string`, `client.secret`) was replaced by the literal text `[REDACTED]` in two files: a secret-masking filter in the tooling rewrote what the agent wrote. | The agent's own scan of changed files. | The test kit would not have loaded. |
| 2026-10-28 | The engine read code-analysis details from a CI check named `opengrep`, while the template's job had another name: the details never reached the agents. The scenarios covering it were marked "not wired", so they never ran. | Inventory of names across files (English switch, step 0). | Agents fixed analysis findings without their details. Fixed in the engine; then the template's `analysis` job printed its SARIF results in its log, read by the watcher. |
| 2026-10-28 | The security test kit expected the sign-in server at the tool's own address; on the Preview it lives at `auth.<domain>`, so the security-header check failed. | A real run on the lab (`verify-engine-preview.yml`). | Every Preview of a tool on that core version would have been red. |
| 2026-10-27 | A commit message quoted the text that tells GitHub to skip CI, so no CI ran on that push. | Human: no run appeared on GitHub. | An untested change could have reached `main`. |
