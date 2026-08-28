# SEIM (Self-Evolving Infrastructure Middleware) — What & How

This document provides a comprehensive technical breakdown of **SEIM (v1.0.3)**: what it is, what features it provides, and how each feature is implemented under the hood.

---

## 1. High-Level Overview

**SEIM (Self-Evolving Infrastructure Middleware)** is an autonomous, full-stack self-evolving runtime and infrastructure middleware for Node.js (Express, Fastify, Generic HTTP) and React applications.

Rather than simply acting as an APM or alerting detector, SEIM actively closes the loop:
1. **Observes** live traffic latency, error rates, 404 journeys, and visitor navigation sequences without blocking request handling.
2. **Triages** issues across all layers (5xx runtime bugs, user drop-offs, circular navigation loops, performance bottlenecks, and missing features) via `IssueStream`.
3. **Generates** solutions autonomously (both backend API routes and physical React TSX components) via `EvolutionOrchestrator`, `FeatureScaffolder`, and `FrontendEvolver`.
4. **Validates** candidates safely in isolated environments through side-effect-free shadow execution, AST security gates, and multi-layer validation gates.
5. **Rolls Out** verified improvements using deterministic, hash-based canary routing (`StableCanaryAssigner`).
6. **Protects** production with automatic $<500\text{ms}$ regression rollbacks and disaster-recovery persistence.
7. **Maintains** an audit-ready **Product Evolution Changelog** visible to founders in the interactive Studio dashboard.

---

## 2. Architecture & Subsystems

```
                      ┌──────────────────────────────────────────────┐
                      │              Incoming Traffic                │
                      └──────────────────────┬───────────────────────┘
                                             │
                                  ┌──────────▼──────────┐
                                  │ Behavior & Metrics  │
                                  │     Middleware      │
                                  └──────────┬──────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        │                                         │
          ┌─────────────▼────────────┐              ┌─────────────▼────────────┐
          │       IssueStream        │              │    OptimizationWorker    │
          │ (5xx, 404s, UX Loops)    │              │   (Performance Scans)    │
          └─────────────┬────────────┘              └─────────────┬────────────┘
                        │                                         │
                        └────────────────────┬────────────────────┘
                                             │
                               ┌─────────────▼─────────────┐
                               │   EvolutionOrchestrator   │
                               └─────────────┬─────────────┘
                                             │
                 ┌───────────────────────────┼───────────────────────────┐
                 │                           │                           │
   ┌─────────────▼────────────┐ ┌────────────▼───────────┐ ┌─────────────▼────────────┐
   │    FeatureScaffolder     │ │     FrontendEvolver     │ │    OptimizationEngine   │
   │  (Backend Express/Fast)  │ │ (React TSX + Manifest)  │ │ (AST & AI Refactorings) │
   └─────────────┬────────────┘ └────────────┬───────────┘ └─────────────┬────────────┘
                 │                           │                           │
                 └───────────────────────────┼───────────────────────────┘
                                             │
                                ┌────────────▼────────────┐
                                │ SecurityGate & Sandbox  │
                                └────────────┬────────────┘
                                             │
                                ┌────────────▼────────────┐
                                │ DynamicRouter & Canary  │
                                └────────────┬────────────┘
                                             │
                                ┌────────────▼────────────┐
                                │ ProductChangelog/Studio │
                                └─────────────────────────┘
```

---

## 3. Core Features: What They Provide & How They Work

---

### Feature 1: Non-Blocking Request Observability & Behavior Tracking

#### What It Provides
- Continuous tracking of per-endpoint request volume, latency percentiles (Avg, P95, P99), error rates, timeout counts, and payload sizes.
- Tracking of anonymous visitor sessions, user navigation journeys, repeated 404 patterns, and drop-off bottlenecks.
- Sub-millisecond overhead on live request handling ($<0.010\text{ms}$).

#### How It Works
- **Middleware Prepending (`src/middleware.ts`):** `createExpressListener` and `createListener` prepend `BehaviorTracker.middleware()` directly to the request pipeline.
- **Session Extraction:** Anonymous sessions are identified via `seid` cookie, `x-session-id` header, or client IP hash.
- **Metrics Store (`src/metrics.ts`):** Durations and status codes are recorded into `InMemoryMetricsStore` with rolling time windows.

---

### Feature 2: Unified IssueStream Engine

#### What It Provides
- Aggregates multi-source signals into a prioritized, deduplicated stream of actionable `ProductIssue` objects:
  - `feature:missing_api` & `feature:missing_page`: 404s occurring across $\ge 3$ distinct sessions.
  - `bug:5xx_spike`: Endpoints experiencing $>5\%$ error rates.
  - `ux:navigation_loop` & `ux:drop_off`: Circular navigation bounces ($[A, B, A, B]$) or abandonment.
  - `perf:slow_endpoint`: Endpoints with latency exceeding baseline threshold.
- **Sybil Protection & Probe Filtering:** Discards automated vulnerability scanners (`.env`, `wp-admin`, `phpinfo`, `.git`, SQL injections).

#### How It Works
- `IssueStream.scanAndEmit()` in `src/issueStream.ts` runs periodically (default 60s) via unref'ed background timer, scanning `BehaviorTracker` and `MetricsStore`. Emits `'issue:detected'` events.

---

### Feature 3: Autonomous Evolution Orchestrator

#### What It Provides
- The autonomous core that transforms detected issues into deployed production features without human intervention.
- Rate-limited to 5 changes/hour to prevent runaway AI calls.

#### How It Works
- `EvolutionOrchestrator` in `src/evolutionOrchestrator.ts` listens for `'issue:detected'` events:
  - For missing APIs: calls `FeatureScaffolder.scaffoldRoute()`, verifies via `Sandbox`, and dynamically registers the route in `DynamicRouter`.
  - For missing pages / UX loops: calls `FrontendEvolver.evolve()`, writing TSX components and updating manifests.
  - Automatically records every change in `ProductChangelog` with `'live'` status.

---

### Feature 4: Physical Frontend React Generation & Manifest Maintenance

#### What It Provides
- Generates real, physical React TSX components on disk (`src/seim-generated/` or custom `outputDir`).
- Automatically updates `seim-routes.tsx` and `seim-routes.json` manifests so bundlers (Vite, Next.js, CRA) pick up new routes via HMR with zero downtime.

#### How It Works
- `FrontendEvolver` (`src/frontendEvolver.ts`) calls `ReactComponentGenerator.generate()`, writes `${ComponentName}.tsx` to disk, and rewrites `seim-routes.tsx` exporting lazy-loaded components.

---

### Feature 5: Multi-Strategy Optimization & Custom Patterns

#### What It Provides
- Automatic identification and refactoring of backend bottlenecks:
  - `sequential-async`: Unbatched sequential `await`s $\to$ `Promise.all`.
  - `n-plus-one`: Loops with DB calls $\to$ batched query.
  - `missing-cache`: Repeated read queries $\to$ cached lookup.
  - `blocking-op`: Synchronous filesystem calls $\to$ async equivalents.
- **Custom Pattern Templates:** Developers register custom regex/AST rules via `s.patterns.registerRegex()`.

#### How It Works
- `OptimizationEngine` in `src/optimization.ts` combines built-in AST transforms, LLM generation, and `CustomPatternRegistry` scans.

---

### Feature 6: Side-Effect-Free Shadow Testing & Sandbox Execution

#### What It Provides
- Evaluates candidate code against live traffic without risking duplicate DB writes or external network side effects.
- Prevents candidate code from crashing the main process or escaping the sandbox.

#### How It Works
- `ShadowTestEngine.cloneRequest()` (`src/shadow.ts`) creates an isolated deep copy of `req.body`, `req.headers`, and `req.params`.
- Executes in V8 isolate (`isolated-vm`) or Node `vm` context with strict timeouts ($500\text{ms}$) and memory limits ($128\text{MB}$).
- `SecurityGate` (`src/security.ts`) blocks changes affecting authentication, authorization, payments, or secret exfiltration (`process.env`).

---

### Feature 7: 8-Layer Validation Gate & Staged Canary Rollout

#### What It Provides
- Ensures optimized code preserves exact business behavior, passes security checks, and delivers verified performance gains.
- Gradually rolls out candidates ($5\% \to 25\% \to 50\% \to 100\%$) using deterministic MD5 hashing (`StableCanaryAssigner`).

#### How It Works
- `ValidationEngine.validate()` in `src/validation.ts` evaluates schema integrity, response equivalence, business rules, unit tests, integration tests, security gate, AI critic, and performance gain.

---

### Feature 8: Persistent Product Changelog & Studio Control Center

#### What It Provides
- Real-time interactive dashboard at `/seim` showing:
  - **🚀 Shipped Evolution Timeline**: Chronological log of automated features, optimizations, and bug fixes with "View Code" diff modals and "Rollback" buttons.
  - **🔍 Issue Stream**: Live view of open 5xx bugs and feature opportunities with 1-click "⚡ Evolve Now" and "Dismiss" controls.
  - **📊 Route Telemetry & ⚡ Live Events**: Real-time request volumes, latency distributions, and lifecycle event stream.

---

## 4. Repository File Map

```
src/
├── index.ts                    Main entry point, seim() factory
├── types.ts                    TypeScript interfaces, configuration, and event types
├── config.ts                   Default configuration definitions and merge logic
├── middleware.ts               Core request interception & behavior wrapper layer
├── issueStream.ts              Unified signal router (5xx, 404s, UX loops, probe filtering)
├── evolutionOrchestrator.ts    Autonomous pipeline controller (scaffold → test → deploy)
├── frontendEvolver.ts          Physical React TSX generator & route manifest manager
├── productChangelog.ts         Persistent evolution ledger & rollback tracking
├── scaffolder.ts               Autonomous backend Express route generator
├── customPatternRegistry.ts    Developer-defined optimization pattern templates
├── optimization.ts             Pattern detection & candidate generator
├── validation.ts               8-layer validation engine
├── shadow.ts                   Side-effect-free shadow test execution
├── sandbox.ts                  Code execution sandbox (isolated-vm / vm)
├── security.ts                 AST diff security gate blocking auth/payment/secret edits
├── dynamicRouter.ts            Dynamic route handler hot-swapping
├── versionDispatcher.ts        Unified traffic routing (canary / promote / rollback)
├── versionRegistry.ts          Runtime version tracking
├── canaryAssignment.ts         MD5 hash-based deterministic canary assignment
├── variantRegistry.ts          Prebuilt handler variant registry
├── candidateLifecycle.ts       State machine: detected → shadow → promoted
├── candidateStore.ts           Durable candidate & transition audit store
├── artifactStore.ts            Signed artifact persistence engine
├── persistentVersionManager.ts File-backed version state manager
├── productionManager.ts        Production deployment manager
├── metrics.ts                  In-memory rolling metrics store
├── metricsAnalyzer.ts          Performance percentile and bottleneck analyzer
├── studio.ts                   Interactive Studio control center dashboard
├── worker.ts                   Background priority task worker queue
├── logger.ts                   Configurable structured logger
├── events.ts                   Typed SeimEventBus
└── react/
    ├── types.ts                ReactComponent, FrontendRouteConfig, ConsistencyCheck
    ├── componentGenerator.ts   AI + fallback React TSX component generator
    ├── componentRegistry.ts    Component & route registry
    ├── consistencyChecker.ts   Backward compatibility & structure validation
    └── index.ts                React module exports
```

---

## 5. Summary of Tested Benchmarks

- **Request Interceptor Overhead:** $0.010\text{ ms}$ (100,000 req/sec)
- **Endpoint Tracker Status Check:** $0.0001\text{ ms}$ (10,000,000 checks/sec)
- **Metrics Analysis Loop:** $0.030\text{ ms}$ (33,333 ops/sec)
- **Memory per Version:** ~322 bytes
- **Test Pass Rate:** **26/26 Test Suites Passed (147/147 Tests)**
