---
name: seim-claude
description: "Skill for Claude Code / Anthropic agents to configure, evolve, and operate SEIM self-evolving middleware."
---

# SEIM — Claude Agent Skill

This skill guides Claude agents on how to leverage and maintain the SEIM runtime in full-stack projects.

## Capabilities & Workflows
- **Autonomous Feature Discovery:** Query `s.issueStream.getOpenIssues()` to inspect missing API and UX bottleneck signals detected from visitor traffic.
- **Custom Pattern Registration:** Use `s.patterns.registerRegex()` to enforce team coding standards.
- **Dynamic Scaffolding:** Execute `s.orchestrator.handleIssue(issue)` to synthesize backend Express handlers and React TSX components into `src/seim-generated/`.
- **Changelog & Rollback Management:** Inspect `s.changelog.getRecent()` and invoke `s.changelog.rollback(path, reason)` if regressions are observed.

## Verification Runbook
Run after every change:
```bash
npm run build && npx jest --no-coverage --runInBand
```
