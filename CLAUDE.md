# CLAUDE.md — SEIM (Self-Evolving Infrastructure Middleware)

This document provides guidelines, commands, and architectural rules for Claude Code and Anthropic agents working with SEIM.

---

## 1. Project Overview & Architecture
SEIM is an autonomous, full-stack self-evolving infrastructure middleware for Node.js (Express, Fastify, Generic HTTP) and React applications.

- **Primary Entry Point:** `src/index.ts` (`seim()` factory function).
- **Core Pipeline:**
  1. `src/middleware.ts` intercepts requests, prepending `BehaviorTracker`.
  2. `src/issueStream.ts` classifies 5xx bugs, 404 missing APIs, and UX loops.
  3. `src/evolutionOrchestrator.ts` drives code generation via `FeatureScaffolder` (backend) & `FrontendEvolver` (React TSX).
  4. `src/sandbox.ts` & `src/security.ts` enforce isolated execution and block auth/payment/secret exfiltration.
  5. `src/dynamicRouter.ts` hot-swaps live routes with staged canary traffic.
  6. `src/productChangelog.ts` & `src/studio.ts` maintain the real-time founder changelog at `/seim`.

---

## 2. Common Developer & Agent Commands

```bash
# Build TypeScript to dist/
npm run build

# Run all test suites
npm test

# Run individual test suites
npx jest tests/selfEvolutionE2E.test.ts
npx jest tests/evolutionOrchestrator.test.ts
npx jest tests/issueStream.test.ts
npx jest tests/benchmark.test.ts

# Security audit
npm audit
```

---

## 3. Key Design Rules & Coding Standards

1. **Defensive Resource Management:**
   - Any `setInterval` or background timer MUST call `.unref()` so tests and processes exit cleanly.
   - Circular buffers MUST have fixed upper bounds (e.g. `MAX_EVENTS = 10000`, `MAX_ENTRIES = 500`).
2. **Security & Sandbox Isolation:**
   - Never pass live `res` objects directly into unverified candidate code. Use stubbed/recording responses.
   - `SecurityGate` must strictly block code modifying authentication, authorization, payments, or accessing `process.env`.
3. **Frontend Evolution:**
   - Generated components must be written to disk (`src/seim-generated/`) and the manifest `seim-routes.tsx` must be updated atomically.
   - Never mutate or overwrite developer-authored source files outside `outputDir`.
4. **Zero-Downtime Rollback:**
   - All promotions must support immediate rollback via `changelog.rollback(routeKey, reason)` or `dynamicRouter.swapHandler()`.

---

## 4. Integration Snippet

```typescript
import express from 'express';
import { seim } from 'seim-core';

const app = express();
app.use(express.json());

const s = seim({
  mode: 'bypass',
  behavior: { enabled: true, autoScaffold: true },
  frontend: { enabled: true, outputDir: './src/seim-generated' },
});

app.use(s.listener());
app.use(s.config.studioPath, s.dashboard);
```
