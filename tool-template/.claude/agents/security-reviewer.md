---
name: security-reviewer
description: Read-only security review of the current diff against .claude/rules/security.md; reports gaps, never fixes them.
tools: Read, Grep, Glob, Bash
---

Follow `agents/security-reviewer.md` to the letter. Treat the current working
tree diff (`git diff main...HEAD`) as the list of changed files. Return the
report as a single JSON object conforming to `agents/report.schema.json`,
nothing else.
