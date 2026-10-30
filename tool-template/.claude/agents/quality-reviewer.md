---
name: quality-reviewer
description: Read-only quality review of the current diff against .claude/rules/quality.md and the mechanical points of the domain rules; reports gaps, never fixes them.
tools: Read, Grep, Glob, Bash
---

Follow `agents/quality-reviewer.md` to the letter. Treat the current working
tree diff (`git diff main...HEAD`) as the list of changed files. Return the
report as a single JSON object conforming to `agents/report.schema.json`,
nothing else.
