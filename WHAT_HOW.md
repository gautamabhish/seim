# SEIM (Self-Evolving Infrastructure Middleware) — What & How

This document provides a comprehensive technical breakdown of **SEIM**: what it is, what features it provides, and how each feature is implemented under the hood.

---

## 1. High-Level Overview

**SEIM (Self-Evolving Infrastructure Middleware)** is a continuous, versioned runtime adaptation and autonomous code-evolution platform for Node.js backend applications (supporting Express, Fastify, and Generic HTTP).

Rather than simply acting as an APM or alerting detector, SEIM actively closes the loop:
1. **Observes** live traffic latency, error rates, and throughput without blocking requests.
2. **Discovers** bottlenecks and anti-patterns off the hot request path.
3. **Generates** optimized candidate versions (via deterministic AST transforms or AI/LLM models).
4. **Validates** candidates safely in isolated environments through side-effect-free shadow execution and multi-layer validation gates.
5. **Rolls Out** verified improvements using deterministic, hash-based canary routing.
6. **Protects** production with automatic regression rollbacks and disaster-recovery persistence.

---

## 2. Architecture: Two Operating Modes

SEIM operates with a clear separation of concerns between safe runtime adaptations and durable codebase evolution:

```
                      ┌──────────────────────────────────────────────┐
                      │              Incoming Traffic                │
                      └──────────────────────┬───────────────────────┘
                                             │
                                  ┌──────────▼──────────┐
                                  │  VersionDispatcher  │
                                  └──────────┬──────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
         ┌─────────────▼────────────┐                ┌─────────────▼────────────┐
         │   Runtime Adaptation     │                │  Durable Code Evolution  │
         │ (Instant, zero code-gen) │                │  (Pipeline & Artifacts)  │
         ├──────────────────────────┤                ├──────────────────────────┤
         │ • Prebuilt Variants      │                │ • AST / AI Generation    │
         │ • Cache & Route Toggles  │                │ • Isolated VM Sandbox    │
         │ • Timeout/Limit Adjusts  │                │ • Side-effect-free Shadow│
         │ • Immediate Activation   │                │ • 8-Layer Validation Gate│
         │                          │                │ • Versioned Artifacts    │
         │                          │                │ • Sticky Canary Rollout  │
         └──────────────────────────┘                └──────────────────────────┘
```

---

## 3. Core Features: What They Provide & How They Work

---

### Feature 1: Non-Blocking Request Observability & Anomaly Detection

#### What It Provides
- Continuous tracking of per-endpoint request volume, latency distribution (Average, P95, P99), error rates, timeout rates, and payload byte sizes.
- Statistical anomaly detection (e.g., latency spikes exceeding rolling 3-sigma thresholds).
- Sub-millisecond overhead on live request handling.

#### How It Works
- **Adapter Hooks (`src/adapters/`):** The framework adapter (e.g., `ExpressAdapter` in `src/adapters/express.ts`) wraps `res.json`, `res.send`, and listens to `res.on('finish')`.
- **High-Precision Timers:** Durations are calculated using `process.hrtime.bigint()`.
- **Metrics Store (`src/metrics.ts`):** Durations and status codes are recorded into `InMemoryMetricsStore` with rolling time windows and percentile calculations.
- **Metrics Analyzer (`src/metricsAnalyzer.ts`):** Computes rolling statistical means, standard deviations, and throughput (`requests / duration`), flagging endpoints that exceed acceptable thresholds.

---

### Feature 2: Multi-Strategy Optimization & Candidate Generation

#### What It Provides


- Automatic identification of common backend bottlenecks:
  - `sequential-async`: Multiple unbatched sequential `await` calls.
  - `n-plus-one`: Database queries or async functions inside loops.
  - `missing-cache`: Repeated read queries without caching.
  - `inefficient-loop`: Unoptimized index iterations over collections.
  - `redundant-serialization`: Unnecessary `JSON.parse(JSON.stringify())` calls.
  - `blocking-op`: Synchronous filesystem or child process calls (`readFileSync`, `execSync`).
- Synthesis of candidate optimizations using template transforms or LLM providers (OpenAI, Google Gemini, Anthropic, Grok).

#### How It Works
- **Background Worker (`src/worker.ts`):** When an endpoint is flagged as slow, `worker.enqueue(routeKey, priority)` schedules analysis off the request thread.
- **Optimization Engine (`src/optimization.ts`):**
  - **Template Mode:** Uses regex/AST pattern matching to transform code (e.g., converting sequential `await` statements into `Promise.all([ ... ])`).
  - **AI Mode (`src/ai.ts`):** Sends handler code, metrics context, and learned memory to LLMs to generate structured code improvements.
- **Evolution Population (`src/evolution/population.ts`):** Generates multi-strategy candidate pools (template, standard AI, creative AI, learned patterns) for competitive evaluation.

---

### Feature 3: Side-Effect-Free Shadow Testing & Isolated Sandboxing

#### What It Provides
- Evaluates candidate handlers on live traffic without risking duplicate database writes, repeated payment charges, or user-facing errors.
- Prevents candidate code from crashing the main process or escaping the sandbox.

#### How It Works
- **Request Snapshot Cloning (`src/shadow.ts`):**
  Before executing the candidate handler, `ShadowTestEngine.cloneRequest()` creates an isolated deep copy of `req.body`, `req.headers`, `req.params`, and `req.query`. The candidate cannot mutate the original request object.
- **Mocked Response Recorder:** The candidate executes with an interceptor response stub (`stubRes`) that records response payloads, headers, and status codes without sending bytes over the wire.
- **Sandbox Execution (`src/sandbox.ts`):**
  - When `isolated-vm` is installed, candidate code executes in a separate V8 Isolate with strict memory limits (128MB) and wall-clock execution timeouts (default 500ms).
  - Built-in static analysis blocks unauthorized `require()` calls and dangerous globals (`eval`, `Function`, `Proxy`, `Reflect`).

---

### Feature 4: 8-Layer Honest Validation Gate

#### What It Provides
- Ensures that optimized code preserves exact business behavior, passes security constraints, and delivers verified performance gains before rollout.
- **Honest Reporting:** Explicitly flags skipped checks (`skipped: true`) so unconfigured checks are never misrepresented as verified passes.

#### How It Works
`ValidationEngine.validate()` in `src/validation.ts` evaluates 8 sequential layers:

| Layer | Name | Verification Method |
|---|---|---|
| **Layer 1** | Schema Integrity | Validates syntax and AST structure of the candidate code. |
| **Layer 2** | Response Equivalence | Compares structural matching between original and candidate outputs; handles dynamic fields (UUIDs, timestamps > 1e12). |
| **Layer 2b** | Schema Compatibility | Ensures no fields were dropped or type-corrupted in the response structure. |
| **Layer 3** | Business Rules | Executes developer-configured functional predicates (`config.businessRules`) against outputs. |
| **Layer 4** | Unit Tests | Executes configured test suites against candidate modifications. |
| **Layer 5** | Integration Tests | Verifies system-level behavior against test harnesses. |
| **Layer 6** | Security Gate | `SecurityGate` (`src/security.ts`) checks code diffs to block changes touching authentication (`login`, `jwt`, `token`), authorization (`rbac`, `admin`), payment (`stripe`, `billing`), or secret access (`process.env`). |
| **Layer 7** | AI Critic | LLM reviewer inspects code diff for hidden race conditions or edge cases. |
| **Layer 8** | Performance Gate | Compares shadow latency $v_2$ vs $v_1$ to confirm measurable speed improvement. |

---

### Feature 5: Resilient Candidate Lifecycle Management

#### What It Provides
- Prevents candidates from being prematurely discarded after a single execution.
- Gathers sufficient statistical sample sizes (default: 25 samples) across live requests before making deployment decisions.

#### How It Works
- **Lifecycle State Machine (`src/candidateLifecycle.ts`):**
  Tracks candidate states: `detected` $\rightarrow$ `generated` $\rightarrow$ `shadowing` $\rightarrow$ `shadow-complete` $\rightarrow$ `approved` $\rightarrow$ `canary` $\rightarrow$ `promoted` / `rejected`.
- **Sample Accumulation:** `CandidateLifecycleManager.recordShadowSample()` records each shadow test result until `shadowSamplesCollected >= shadowSamplesRequired`.
- **Safe Promotion Gate:** Autonomous promotion is **disabled by default** (`autonomousPromotion: false`). When a candidate completes shadow testing, it enters the `approved` (manual review) state unless explicit autonomous promotion is enabled.

---

### Feature 6: Stable Canary Traffic Routing & Zero-Mutation Dispatcher

#### What It Provides
- Stable, sticky canary assignment per user/session rather than random per-request switching.
- Dynamic traffic routing without unsafe monkey-patching of Express internal router arrays (`route.stack[i].handle`).

#### How It Works
- **Consistent Hashing (`src/canaryAssignment.ts`):**
  `StableCanaryAssigner` extracts a stable request attribute (User ID, Session ID, IP address, or Request ID header) and computes an MD5 hash bucket ($0 - 99$). A user assigned to the canary branch consistently remains on the canary branch.
- **Version Registry (`src/versionRegistry.ts`):** Maintains active and canary versions per route.
- **Version Dispatcher (`src/versionDispatcher.ts`):**
  Acts as the central router for incoming traffic. Automatically checks canary eligibility and dispatches to the correct handler.
- **Emergency Controls:** `dispatcher.pauseAll()` immediately resets all active canaries to 0% traffic in an emergency.

---

### Feature 7: Realtime Runtime Adaptation (Prebuilt Variants)

#### What It Provides
- Enables instant, safe switching between alternative developer-authored handler implementations at runtime without code generation risks.

#### How It Works
- **Variant Registration (`src/variantRegistry.ts`):**
  Developers register prebuilt handler variants using the public API:
  ```typescript
  seimInstance.registerVariant('/api/users', {
    name: 'batched-query',
    handler: batchedUsersHandler,
    requires: ['userRepository'],
    description: 'High-throughput batched database query handler',
  });
  ```
- **Instant Activation:** Calling `seimInstance.activateVariant('/api/users', 'batched-query')` switches live routing immediately with zero closure reconstruction risk.

---

### Feature 8: Durable Self-Evolution & Artifact Pipeline

#### What It Provides
- Produces signed, reproducible, versioned deployment artifacts and unified diffs that can be audited, stored, and integrated into CI/CD pipelines.

#### How It Works
- **Pipeline Orchestrator (`src/evolution/pipeline.ts`):**
  1. Computes unified diffs (`--- original`, `+++ optimized`) and SHA-256 source checksums.
  2. Creates an `EvolutionArtifact` containing built code, test results, security scans, and lineage hashes.
- **Artifact Store (`src/artifactStore.ts`):** Persists artifacts to disk (`FileArtifactStore`) or memory (`MemoryArtifactStore`) under `.seim-storage/artifacts/`.
- **CI/CD Integration (`src/ciCdOptimizer.ts`):** Can export approved patches as JSON/patch files to disk (`.seim-ci/`) for pull request generation.

---

### Feature 9: Multi-Generation Evolution, Cross-Route Intelligence & Drift Detection

#### What It Provides
- Multi-generation genetic optimization tournament to select the fittest candidate.
- Automatically propagates successful optimizations to other routes sharing the same helper functions.
- Monitors post-promotion latency drift and triggers re-optimization if performance degrades over time.

#### How It Works
- **Tournament Selector (`src/evolution/tournament.ts`):** Computes composite fitness scores based on latency (40%), error rate (30%), memory (10%), and stability (20%).
- **Call Graph (`src/evolution/callGraph.ts`):** Maps route dependencies and identifies shared helper functions across endpoints.
- **Optimization Propagator (`src/evolution/propagator.ts`):** When Route A is optimized, routes calling the same functions are automatically enqueued for analysis with elevated priority.
- **Drift Detector (`src/evolution/driftDetector.ts`):** Runs periodic checks comparing live P95 latency against recorded post-promotion baselines. If latency degrades by $>20\%$, it emits an `evolution:drift-detected` event and re-enqueues the route for optimization.

---

### Feature 10: Disaster Recovery & State Persistence

#### What It Provides
- Survives process restarts, container redeployments, and crashes without losing version histories, active rollout configurations, or transition audit trails.

#### How It Works
- **Persistent Version Manager (`src/persistentVersionManager.ts`):** Saves version metadata and transition history to disk (`.seim-storage/`) or Redis (`src/redisStorageAdapter.ts`).
- **Startup Recovery:** On process boot, `versionManager.loadAllStates()` reads existing state files, parses route keys and active versions, and restores routing state.
- **Audit Trails (`src/candidateStore.ts`):** Records every candidate transition timestamp, actor (`system`, `user`, `ai`), and reason.

---

## 4. Complete Request-to-Promotion Lifecycle Walkthrough

```
1. Live Request arrives at application
   └─► VersionDispatcher evaluates request attributes (IP / User / Session)
       └─► Routes request to Active version (or Canary if selected)
       └─► Adapter records latency, bytes, and status on finish

2. Anomaly / Bottleneck Detected
   └─► MetricsAnalyzer flags high latency / error rate
   └─► OptimizationWorker enqueues routeKey with priority

3. Background Candidate Generation
   └─► OptimizationEngine analyzes handler source code
   └─► Template or LLM synthesizes optimized candidate

4. Candidate Lifecycle Registration
   └─► CandidateLifecycleManager registers candidate with required sample size (25)

5. Shadow Testing on Subsequent Live Traffic
   └─► Request body/headers deep-cloned by ShadowTestEngine
   └─► Sandbox executes candidate with mocked response stub
   └─► ValidationEngine verifies output equivalence & security rules
   └─► CandidateLifecycleManager records sample until target count reached

6. Evaluation & Canary Rollout
   └─► If autonomousPromotion is enabled:
       └─► VersionDispatcher deploys candidate at canary percentage (e.g., 5%)
       └─► StableCanaryAssigner routes percentage of users deterministically
       └─► Gradually scales canary (5% → 25% → 50% → 100%)
   └─► If autonomousPromotion is disabled (default):
       └─► Candidate marked as 'approved' awaiting manual review via Studio / API

7. Promotion & Artifact Lineage
   └─► Candidate promoted to Active version
   └─► EvolutionPipeline stores signed artifact & patch in ArtifactStore
   └─► DriftDetector establishes new performance baseline
   └─► OptimizationPropagator queues related endpoints sharing functions
```

---

## 5. Repository File Map

| Directory / File | Description |
|---|---|
| `src/index.ts` | Package entry point and root composition engine |
| `src/types.ts` | TypeScript schemas, configuration interfaces, and event types |
| `src/config.ts` | Default configuration definitions and merge logic |
| `src/versionDispatcher.ts` | Zero-mutation dynamic traffic router with canary support |
| `src/versionRegistry.ts` | Runtime version tracking (active, canary, rolled-back) |
| `src/canaryAssignment.ts` | Deterministic consistent hashing for sticky canary assignment |
| `src/candidateLifecycle.ts`| State machine and sample accumulation for candidates |
| `src/candidateStore.ts` | Persistent audit store for candidate transitions |
| `src/variantRegistry.ts` | Prebuilt handler variant registry for runtime adaptation |
| `src/shadow.ts` | Side-effect-free live request shadow execution engine |
| `src/sandbox.ts` | V8 isolate / VM execution sandbox with memory and time limits |
| `src/validation.ts` | 8-layer validation pipeline with honest skipped check tracking |
| `src/security.ts` | AST diff security gate blocking auth, payment, and secret tampering |
| `src/metrics.ts` | In-memory rolling metrics store and statistical calculations |
| `src/metricsAnalyzer.ts` | Bottleneck, latency percentile, and throughput analyzer |
| `src/optimization.ts` | Template transforms and LLM-driven candidate generator |
| `src/ai.ts` | Multi-provider LLM client (OpenAI, Gemini, Anthropic, Grok) |
| `src/artifactStore.ts` | Versioned, signed artifact persistence engine |
| `src/evolution/` | Multi-generation evolution, tournament selection, call graphs, drift detection, and pipeline |
| `src/adapters/` | Framework adapters for Express, Fastify, and Generic HTTP |
| `src/studio.ts` | Developer control center dashboard handler |
| `src/worker.ts` | Background priority task worker queue |
| `tests/` | 19 comprehensive Jest test suites covering all components |

---

## 6. Key Configuration Options

```typescript
const app = express();

const s = seim({
  mode: 'bypass',                     // 'restrict' (observe only) | 'bypass' (active optimization)
  autonomousPromotion: false,         // Default: false (requires manual review before promotion)
  experiment: {
    canaryPercent: 5,                 // Initial canary rollout percentage
    shadowSampleSize: 25,             // Number of shadow samples before evaluation
    rollbackLatencyMultiplier: 1.2,   // Auto-rollback if latency degrades > 20%
    rollbackErrorRate: 1.5,           // Auto-rollback if error rate increases > 50%
  },
  ai: {
    enabled: true,
    provider: 'google',               // 'google' | 'openai' | 'anthropic' | 'grok'
    apiKey: process.env.AI_API_KEY,
  },
  storage: {
    type: 'file',                     // 'memory' | 'file' | 'redis'
  },
  security: {
    blockAuthenticationChanges: true,
    blockPaymentChanges: true,
    blockSecretUsage: true,
  },
});

app.use(s.listener());
```

---

## 11. Behavior-Driven Feature Development

**What it does:** SEIM observes real visitor behavior — page visits, navigation sequences, 404 errors, high-traffic endpoints — and autonomously identifies which new features are most needed. It can then scaffold those features without any programmer intervention.

**The core vision:** You write the initial application once. SEIM continuously monitors what your users are trying to do, finds gaps, and expands the application over time.

### How it works

```
Visitor traffic ──► BehaviorTracker (middleware) ──► UserSession[] + BehaviorEvent[]
                                                             │
                                                    analyze() every 5 min
                                                             │
                                                    BehaviorPattern[]
                                                    (missing_feature, high_demand, drop_off, ...)
                                                             │
                                                   FeatureDiscovery.patternToFeature()
                                                             │
                                                    DiscoveredFeature (method + path + intent)
                                                             │
                                              autoScaffold? ─┤
                                                   yes       ▼
                                            FeatureScaffolder.scaffoldRoute()
                                                   (AI or local fallback)
```

### Pattern types detected

| Pattern | Trigger | Action |
|---|---|---|
| `missing_feature` | 404s on the same path ≥3 times across different sessions | Scaffold GET or POST route |
| `high_demand` | Path receives >100 hits in buffer | Suggest caching / batch endpoint |
| `drop_off` | Sessions visit same path >3× without progression | Suggest improved route or redirect |
| `navigation_loop` | Session alternates [A, B, A, B, ...] | Suggest linking the two resources |
| `slow_endpoint` | Avg duration > 2000ms | Flag for optimization |

### Key files

| File | Role |
|---|---|
| `src/behaviorTracker.ts` | `BehaviorTracker` — records events, provides Express middleware, analyzes patterns |
| `src/featureDiscovery.ts` | `FeatureDiscovery` — maps patterns to feature specs, calls scaffolder |

### Configuration

```ts
const s = seim({
  behavior: {
    enabled: true,                     // Enable behavior tracking
    minPatternFrequency: 3,            // Minimum occurrences before flagging
    maxEvents: 10000,                  // Rolling event buffer size
    autoScaffold: false,               // Auto-scaffold or just discover? (false = discover only)
    excludePaths: ['/health', '/metrics'],
  },
});

// The behavior middleware is attached automatically.
// Use s.listener() as normal — behavior tracking is transparent.

// Check what SEIM has discovered:
console.log(s.behaviors);  // { totalSessions, patterns, topMissingFeatures, ... }

// Manually trigger a discovery cycle:
const newFeatures = await s.featureDiscovery.discover();

// Scaffold a specific feature by ID:
const feature = await s.featureDiscovery.scaffoldFeature(featureId);
```

---

## 12. React Frontend Scaffolding

**What it does:** SEIM can generate new React (TypeScript) page components and route configurations based on behavioral insights or explicit requests. It enforces consistency so that new components don't break the existing application.

**The vision:** When SEIM discovers users are trying to navigate to `/dashboard`, it doesn't just scaffold a backend route — it also generates the React page component, registers it in the frontend route map, and ensures it's consistent with your existing components.

### How it works

```
ComponentRequest (name + intent + routePath + dataEndpoints)
         │
         ▼
ReactComponentGenerator
   ├── LLMClient.chat() — AI-generated TSX
   │         (falls back to buildFallbackTemplate() if AI off)
   ├── ReactConsistencyChecker.validateStructure()
   │         (ensure default export, JSX return, no dangerous patterns)
   ├── computeHash() — consistency hash for break detection
   └── ReactComponentRegistry.register()
                  │
                  ▼
           ReactComponent { id, name, code, routePath, consistencyHash, ... }
```

### Consistency enforcement

When **updating** an existing component, `ReactConsistencyChecker.check()` compares the old and new versions:
- Checks if `interface ${Name}Props` still exists
- Checks if the default export is preserved
- Checks for dangerous patterns (`eval`, `document.write`, unguarded `dangerouslySetInnerHTML`)
- Returns `backwardCompatible: false` if breaking changes are detected

Route conflicts are caught before registration:
- Static routes cannot shadow dynamic routes
- Duplicate `path` values are rejected

### Key files

| File | Role |
|---|---|
| `src/react/types.ts` | `ReactComponent`, `FrontendRouteConfig`, `ConsistencyCheck`, `ComponentRequest` |
| `src/react/componentGenerator.ts` | `ReactComponentGenerator` — AI + fallback component generation |
| `src/react/componentRegistry.ts` | `ReactComponentRegistry` — stores components, generates router code |
| `src/react/consistencyChecker.ts` | `ReactConsistencyChecker` — validates structure and backward compat |
| `src/react/index.ts` | Public exports |

### Configuration & API

```ts
const s = seim({
  frontend: {
    enabled: true,
    framework: 'react',             // 'react' | 'next' | 'vite'
    typescript: true,               // Generate .tsx (true) or .jsx (false)
    outputDir: './src/pages',       // Where to write files (if writeToDisk: true)
    writeToDisk: false,             // Write generated code to disk
  },
});

// Generate a new page component:
const { code, componentId } = await s.generateComponent({
  name: 'Dashboard',
  routePath: '/dashboard',
  intent: 'Show user analytics and recent activity',
  dataEndpoints: ['/api/analytics', '/api/activity'],
  isPage: true,
});

// Get the router code to paste into your app:
console.log(s.reactRegistry.generateRouterCode());

// List all generated components:
const all = s.reactRegistry.listAll();

// Events emitted:
s.on('react:component-generated', ({ component }) => {
  // component.code contains the TSX source
});
```

### Generated component structure (fallback template)

```tsx
import React, { useState, useEffect } from 'react';

interface DashboardProps {}

export default function Dashboard({}: DashboardProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="seim-page">
      <h1>Dashboard</h1>
      <div>{/* generated content */}</div>
    </div>
  );
}
```

---

## 13. Custom Pattern Templates

**What it does:** Developers can register their own optimization patterns — like N+1 but specific to their codebase — that SEIM will detect and fix automatically alongside its built-in patterns.

**The vision:** When building your app, you document your team's code quality rules directly in SEIM's config. Over time, SEIM enforces and auto-fixes those rules across all routes, just like built-in patterns.

### How it works

```
CustomPatternRegistry.register() / registerRegex()
        │
        ▼
  CustomPattern { id, detector, fixer, severity, tags, useAI }
        │
 OptimizationEngine.analyzeWithPatterns()
        │
  customPatterns.scan(sourceCode) → matches
        │
  cp.fixer.fix(sourceCode) OR llm.optimize() (if useAI)
        │
  OptimizationCandidate (flows through normal shadow → validate → promote pipeline)
```

### Key files

| File | Role |
|---|---|
| `src/customPatternRegistry.ts` | `CustomPatternRegistry` — register, scan, fix, export |
| `src/optimization.ts` | `OptimizationEngine.setCustomPatternRegistry()` — integration point |

### API

```ts
const s = seim({ /* ... */ });

// Shorthand: regex-based pattern
s.patterns.registerRegex(
  'org/avoid-sync-redis',          // unique ID
  'Avoid synchronous Redis calls', // name
  'redis.getSync() blocks the event loop; use await redis.get() instead',
  'high',                          // severity
  /redis\.getSync\(/,              // detect regex
  (source, match) => source.replace(/redis\.getSync\(/g, 'await redis.get('), // fix transform
  { tags: ['redis', 'async'], examples: ['redis.getSync("key")'] }
);

// Full custom pattern with object-based detector
s.patterns.register({
  id: 'org/paginate-large-queries',
  name: 'Unpaginated Database Queries',
  description: 'db.find({}) without limit will load all rows — add .limit()',
  severity: 'critical',
  detector: {
    detect: (src) => /db\.find\(\s*\{\s*\}\s*\)/.test(src) && !/\.limit\(/.test(src),
    getMatch: (src) => src.match(/db\.find\(\s*\{\s*\}\s*\)/)?.[0] ?? null,
  },
  fixer: {
    fix: (src) => src.replace(/db\.find\(\s*\{\s*\}\s*\)/g, 'db.find({}).limit(100)'),
  },
  tags: ['database', 'performance'],
  examples: ['const users = await db.find({})'],
  goodExamples: ['const users = await db.find({}).limit(100)'],
});

// Scan source code manually:
const matches = s.patterns.scan(sourceCode);

// Apply all registered fixes:
const { code, appliedFixes } = s.patterns.applyFixes(sourceCode);

// Query patterns:
const dbPatterns = s.patterns.getByTag('database');
const criticalPatterns = s.patterns.getBySeverity('critical');

// Export patterns for sharing/persistence:
const exported = s.patterns.export();
```

Custom patterns are automatically run by `OptimizationEngine` on every analyzed route. Their candidates go through the same shadow → validate → promote pipeline as built-in patterns.

---

## File Map (complete)

```
src/
├── index.ts                    Main entry point, seim() factory
├── types.ts                    All TypeScript interfaces and types
├── config.ts                   Config merging and defaults
├── middleware.ts               Core request interception layer
├── optimization.ts             Pattern detection + custom pattern integration
├── validation.ts               8-layer validation engine
├── shadow.ts                   Side-effect-free shadow test execution
├── rollback.ts                 Rollback decision engine
├── learning.ts                 Learning memory store
├── ai.ts                       LLM client abstraction
├── sandbox.ts                  Code execution sandbox (isolated-vm / vm)
├── dynamicRouter.ts            Runtime route handler swapping
├── versionDispatcher.ts        Unified traffic routing (canary / promote / rollback)
├── versionRegistry.ts          Per-route version tracking
├── canaryAssignment.ts         MD5 hash-based stable canary assignment
├── variantRegistry.ts          Prebuilt handler variant registry
├── candidateLifecycle.ts       State machine: detected→shadow→promoted
├── candidateStore.ts           Durable candidate + transition audit store
├── artifactStore.ts            Signed artifact persistence
├── persistentVersionManager.ts File-backed version state manager
├── productionManager.ts        Production deployment engine
├── scaffolder.ts               Dynamic backend route scaffolder
├── behaviorTracker.ts          ★ NEW: visitor behavior tracking + analysis
├── featureDiscovery.ts         ★ NEW: behavior → feature spec → scaffold
├── customPatternRegistry.ts    ★ NEW: developer-defined optimization patterns
├── react/
│   ├── types.ts                ★ NEW: ReactComponent, FrontendRouteConfig, ConsistencyCheck
│   ├── componentGenerator.ts   ★ NEW: AI + fallback React component generation
│   ├── componentRegistry.ts    ★ NEW: component + route registry, router code gen
│   ├── consistencyChecker.ts   ★ NEW: backward compat + structure validation
│   └── index.ts                ★ NEW: public exports
└── evolution/
    ├── index.ts                Evolution system exports
    ├── manager.ts              EvolutionManager (population-based evolution)
    ├── population.ts           PopulationGenerator
    ├── tournament.ts           TournamentSelector (fitness scoring)
    ├── pipeline.ts             EvolutionPipeline (artifact + dispatcher)
    ├── drift.ts                DriftDetector (post-promotion regression guard)
    ├── propagator.ts           OptimizationPropagator (cross-route intelligence)
    └── ...
```

