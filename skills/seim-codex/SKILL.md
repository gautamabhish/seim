---
name: seim-codex
description: "Codex and OpenAI Assistant skill for working with SEIM autonomous self-evolving infrastructure."
---

# SEIM — Codex & OpenAI Assistant Skill

This skill provides system instructions and tool usage patterns for Codex and OpenAI Assistant models to interact with SEIM.

## Key APIs & Integrations

### Initializing the Runtime
```javascript
const { seim } = require('seim-core');

const s = seim({
  mode: 'bypass', // 'bypass' = autonomous evolution; 'restrict' = observe-only
  behavior: { enabled: true, autoScaffold: true, minPatternFrequency: 3 },
  frontend: { enabled: true, outputDir: './src/seim-generated' },
});
```

### Triaging Issues & Evolving Features
- **Query Active Issues:** `s.issueStream.getOpenIssues()`
- **Evolve Candidate Solution:** `s.orchestrator.handleIssue(issue)`
- **Check Changelog:** `s.changelog.getRecent()`
- **Rollback Route:** `s.changelog.rollback('/path', 'Reason')`

## Build & Test Commands
```bash
npm run build
npx jest --no-coverage
```
