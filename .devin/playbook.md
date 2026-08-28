---
name: seim-devin
description: "Devin execution playbook and skill for deploying, diagnosing, and maintaining SEIM self-evolving middleware."
---

# SEIM — Devin Playbook & Skill

This skill defines the operational runbook and troubleshooting steps for Cognition AI's Devin agent.

## Setup & Environment Verification
1. **Node.js Environment:** Verify Node $\ge 18.0.0$ via `node -v`.
2. **Build Verification:** Run `npm run build` and ensure `dist/` is produced with no TypeScript errors.
3. **Test Suite:** Execute `npm test -- --runInBand` and verify all 26 test suites pass (147 tests).

## Common Task Workflows

### Task 1: Integrating SEIM into a New or Existing App
1. Add `seim-core` to `package.json` dependencies.
2. In the server entry point (e.g. `server.js` or `app.ts`), import `seim` and initialize with:
   ```javascript
   const { seim } = require('seim-core');
   const s = seim({ mode: 'bypass', behavior: { enabled: true, autoScaffold: true } });
   app.use(s.listener());
   app.use(s.config.studioPath, s.dashboard);
   ```
3. In the React app, import `seimGeneratedRoutes` from `src/seim-generated/seim-routes` inside `<Routes>`.

### Task 2: Diagnosing Performance or Rollback Events
1. Check Studio API: `curl http://localhost:3000/seim/api/changelog` to see recent rollbacks.
2. Check Issue Stream: `curl http://localhost:3000/seim/api/issues` for 5xx spikes or unhandled errors.
3. Inspect sandbox errors via `GET /seim/api/events`.
4. Trigger manual rollback if necessary:
   ```bash
   npx seim rollback <routeKey>
   ```

## Verification Checklist
- [ ] TypeScript compilation exits `0` (`npm run build`)
- [ ] Jest test suite completes with 100% pass rate (`npm test`)
- [ ] No high/critical vulnerabilities (`npm audit`)
- [ ] Background intervals call `.unref()` to avoid dangling handles
