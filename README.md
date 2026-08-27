# SEIM — Self-Evolving Infrastructure Middleware

SEIM (in dev , please report the issues directly to us )  is a framework-agnostic, self-optimizing runtime for Node.js applications. It observes your API traffic, detects performance anti-patterns, generates safe optimizations, validates them through shadow testing, and promotes only the versions that are provably correct, secure, and faster. It ships with a CLI, structured observability, production-grade lifecycle management, and support for Express, Fastify, and generic HTTP servers.

## CONTRIBUTE AT https://github.com/worm-evolution/seim
## Features

- **Framework Agnostic**: Works with Express, Fastify, or any Node.js HTTP server
- **AI + Template Optimization**: Pattern-based rewrites plus optional LLM generation
- **Background Worker**: Optimization analysis runs off the request path
- **Shadow Testing**: Safe testing of optimizations before deployment
- **Smart Validation**: Structural response comparison, unit test runner, and performance gate
- **Automatic Rollback**: Instant rollback if latency or error rate regresses
- **Structured Observability**: Typed event bus and configurable logger
- **Exponential Backoff**: Failed routes back off automatically with health scoring
- **Version Management**: Complete history of all endpoint versions with persistent storage
- **CLI Tool**: `seim init`, `status`, `analyze`, `benchmark`, `rollback`, `apply`
- **Token Saving**: Smart caching to avoid unnecessary AI calls
- **Auto-Middleware Detection**: Identifies missing ETag, compression, and caching opportunities

## Install

```bash
npm i seim-core
```

Requires **Node.js 18+**.

For the safest sandbox, also install `isolated-vm` separately:

```bash
npm install isolated-vm
```

`isolated-vm` is an **optional** native dependency. It must compile for your platform and requires Python + a C++ toolchain. If it is not installed, SEIM transparently falls back to Node's built-in `vm` module.

## Quick start

```js
const express = require('express');
const seim = require('seim').default;

const app = express();

const s = seim({
  mode: 'bypass', // enable autonomous optimization
  businessRules: [
    (response) => response && response.total >= 0,
    (response) => !response.items || response.items.length <= 1000,
  ],
});

// Group level — every child route inherits monitoring
app.use('/v1', s.listener());

// Route level — one endpoint only
app.get('/system-report', s.listener(), (req, res) => {
  res.json({ healthy: true });
});

// Hidden Studio dashboard (default path is /asdfghjklkjhgfdsasdfghj)
app.use(s.config.studioPath, s.dashboard);

app.listen(3000, () => {
  console.log('Studio at http://localhost:3000' + s.config.studioPath);
});
```

### Fastify

```js
const fastify = require('fastify')({ logger: true });
const seim = require('seim').default;

const s = seim({ framework: 'fastify', mode: 'bypass' });
fastify.register(s.plugin());
```

## CLI

SEIM ships with a zero-dependency CLI:

```bash
seim init                      # scaffold .seimrc.json
seim status [url]              # show live status
seim analyze ./routes/users.js # offline pattern analysis
seim benchmark <url>           # simple HTTP benchmark
seim rollback /api/users       # trigger rollback via API
seim apply [dir]               # review CI/CD optimization output
```

## Configuration

SEIM auto-discovers config from `.seimrc.json`, `seim.config.js`, or `package.json#seim`. You can also pass it programmatically.

```json
{
  "mode": "bypass",
  "framework": "express",
  "logging": {
    "level": "info",
    "json": false
  },
  "experiment": {
    "canaryPercent": 5,
    "shadowCooldownMs": 60000,
    "shadowSampleSize": 25,
    "sandboxTimeoutMs": 500
  },
  "worker": {
    "enabled": true,
    "intervalMs": 10000
  },
  "ai": {
    "enabled": false
  },
  "autoMiddleware": {
    "etag": true,
    "compression": true,
    "caching": true
  }
}
```

### Full configuration interface

```ts
interface SeimConfig {
  mode: 'restrict' | 'bypass';
  environment?: 'development' | 'production';
  framework?: 'express' | 'fastify' | 'http' | 'generic';
  studioPath: string;
  storagePath?: string;
  businessRules: ((response: any, request?: Request) => boolean | Promise<boolean>)[];
  securityRules?: ((oldCode: string, newCode: string) => { pass: boolean; reason?: string })[];
  ai?: {
    enabled: boolean;
    apiKey?: string;
    baseUrl?: string;
    provider?: 'openai' | 'anthropic' | 'google' | 'grok' | 'custom';
    generatorModel?: string;
    reviewerModel?: string;
    verifierModel?: string;
    headers?: Record<string, string>;
  };
  experiment?: {
    confidenceThreshold: number;
    canaryPercent: number;
    rollbackLatencyMultiplier: number;
    rollbackErrorRate: number;
    minSampleSize: number;
    shadowCooldownMs: number;
    shadowAllowedMethods: string[];
    shadowSampleSize: number;
    sandboxTimeoutMs?: number;
  };
  storage?: {
    type: 'memory' | 'sqlite' | 'redis';
    connection?: string;
  };
  security?: {
    blockAuthenticationChanges: boolean;
    blockAuthorizationChanges: boolean;
    blockPaymentChanges: boolean;
    blockSecretUsage: boolean;
    allowedPatternModels: string[];
  };
  learning?: {
    enabled: boolean;
    sampleSize: number;
    persistencePath?: string;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error' | 'silent';
    json?: boolean;
  };
  worker?: {
    enabled?: boolean;
    intervalMs?: number;
    batchSize?: number;
  };
  autoMiddleware?: {
    etag?: boolean;
    compression?: boolean;
    caching?: boolean;
    rateLimit?: boolean;
  };
  scaffolding?: {
    enabled: boolean;
    maxDynamicRoutes?: number;
  };
}
```

## Modes

### `restrict` (default)

- Observes traffic
- Collects metrics and detects patterns
- Generates suggestions
- **Never modifies or deploys code**

Use this in production first while you build confidence.

### `bypass`

- Observes traffic
- Generates optimized candidates
- Validates against all eight layers
- Runs shadow tests on a small sample
- Promotes winners, rolls back regressions

## How it works

1. **Observe** — every request is timed and counted.
2. **Analyze** — SEIM scans route handlers for patterns like sequential `await`s, N+1 queries, missing caches, blocking operations, and more.
3. **Queue** — candidate routes are enqueued to a background worker so request handling is never blocked.
4. **Improve** — a template-based optimizer (or optional LLM) creates an optimized candidate.
5. **Validate** — the candidate must pass schema, structural response equivalence, business rules, unit/integration tests, security, an AI critic, and a performance regression gate.
6. **Experiment** — the optimized handler runs on a cloned request and a stub response; the real user still gets the original.
7. **Promote** — if the new version is faster with no extra errors, SEIM swaps the real route handler.
8. **Rollback** — if error rate or latency regresses, the original is restored instantly on the next request.
9. **Learn** — health scoring and exponential backoff ensure failed attempts do not spam the system.

## Pattern Detection

SEIM detects and rewrites these anti-patterns without requiring an LLM:

- `sequential-async` — sequential `await`s in a loop → `Promise.all`
- `n-plus-one` — `forEach` with `await` → batched `Promise.all`
- `missing-cache` — repeated DB/API calls → Map-based cache
- `inefficient-loop` — C-style `for` → `for...of`
- `redundant-serialization` — `JSON.parse(JSON.stringify(x))` → `structuredClone(x)`
- `blocking-op` — `readFileSync` / `writeFileSync` / `execSync` → async equivalents
- `nested-ternary` — deeply nested ternaries (flagged for review)
- `unindexed-find` — linear `.find()` on large arrays → Map lookup
- `response-streaming` — large mapped JSON responses → streaming suggestion

## Observability

SEIM emits typed events through `SeimEventBus`:

- `optimization:detected`
- `optimization:validated`
- `optimization:promoted`
- `optimization:rejected`
- `optimization:rolledback`
- `shadow:started` / `shadow:completed`
- `health:degraded` / `health:recovered`
- `metrics:threshold`
- `error:*`
- `lifecycle:*`

Listen programmatically:

```js
s.on('optimization:promoted', (payload) => {
  console.log('Promoted', payload.routeKey, 'improvement', payload.latencyImprovement);
});
```

## Lifecycle

Always call `shutdown()` on process exit to release intervals and flush state:

```js
process.on('SIGTERM', async () => {
  await s.shutdown();
  process.exit(0);
});
```

## 🎮 Interactive Full-Stack Developer Dashboard (Demo Playground)

We have built a fully featured developer playground and dashboard under [`demo-app/`](./demo-app). This dashboard provides developers with a visual interface to simulate, monitor, and benchmark SEIM's runtime evolution.

### Features
* **Real-time Event Stream**: Watch SEIM dispatch workers, shadow-test candidates, validate code layers, and promote hot routes.
* **Canary Telemetry Dashboard**: Neon-glowing latency status cards mapping request totals and active VM sandboxes.
* **Endpoint Delay Injector**: Inject sequential async delays (1.2s bottleneck) into `/api/analytics/dashboard` or reset back to baseline.
* **Traffic Load Generator**: Simulates concurrent HTTP traffic to trigger the SEIM optimization worker loop.
* **Live Code Diff Viewer**: Compares the original unoptimized code against the promoted optimization side-by-side in real-time.

### Running the Dashboard
1. **Navigate to the demo folder and install dependencies**:
   ```bash
   cd demo-app
   npm install
   ```
2. **Start the Express server** (passing your Gemini API key through the environment):
   ```bash
   GEMINI_API_KEY=YOUR_API_KEY_HERE npm start
   ```
3. **Open in browser**: Navigate to **`http://localhost:3005`** and interact with the panel.

### Running Automated Integration Tests
You can execute the automated demo flow integration test script to verify the entire pipeline (telemetry -> worker -> LLM analyzer fallback -> shadow test -> hot swap promotion):
```bash
node demo-app/test_demo_flow.js
```

## Testing

SEIM includes a comprehensive test suite:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests
npm run test:stress       # Stress tests
npm run test:benchmark    # Benchmark tests
npm run test:feasibility  # Feasibility tests
npm run test:integration  # Integration tests
```

### Test Coverage

* **Unit Tests**: metrics analyzer, endpoint tracker, version manager, sandbox isolation, security gates, and rollback engines
* **Stress Tests**: load handling and memory efficiency
* **Benchmark Tests**: performance metrics and overhead
* **Feasibility Tests**: adoption feasibility metrics
* **Integration Tests**: complete workflow scenarios, frontend telemetry overrides, and autonomous feature scaffolding

### Test Results

* **Total Tests**: 87
* **Pass Rate**: 100%
* **Performance**: Sub-millisecond operations for all components
* **Scalability**: Linear scaling with load
* **Memory Efficiency**: ~315 bytes per version

## Directory Structure

```
seim/
├── src/
│   ├── adapters/           # Framework adapters (Express/Fastify/generic)
│   ├── cli/                # CLI commands
│   ├── ai.ts               # AI client with rate-limit recovery
│   ├── autoMiddleware.ts   # Auto-middleware detection
│   ├── config.ts           # Configuration management
│   ├── configLoader.ts     # Config file discovery
│   ├── dynamicRouter.ts    # Dynamic routing for production
│   ├── endpointTracker.ts  # Endpoint optimization tracking
│   ├── events.ts           # Typed event bus
│   ├── index.ts            # Main entry point
│   ├── logger.ts           # Configurable logger
│   ├── metrics.ts          # Sliding window metrics
│   ├── metricsAnalyzer.ts  # Performance analysis
│   ├── middleware.ts       # Framework-agnostic middleware
│   ├── optimization.ts     # Optimization engine
│   ├── persistentVersionManager.ts # Persistent version storage
│   ├── productionManager.ts # Production deployment manager
│   ├── rollback.ts         # Rollback mechanism
│   ├── sandbox.ts          # Code execution sandbox with globals scope injector
│   ├── scaffolder.ts       # Autonomous feature scaffolding engine
│   ├── shadow.ts           # Shadow testing engine
│   ├── shadowLimiter.ts    # Shadow testing rate limiter
│   ├── storageFactory.ts   # Storage adapter factory
│   ├── types.ts            # TypeScript types
│   ├── validation.ts       # Validation engine with debug logger
│   ├── versionManager.ts   # In-memory version management
│   └── worker.ts           # Background optimization worker
├── demo-app/               # Full-stack developer dashboard playground
├── tests/                  # Comprehensive test suite
├── examples/               # Example scripts
├── dist/                   # Compiled JavaScript
└── package.json            # Package configuration
```

## Production Deployment

SEIM includes production deployment features:

- **ProductionManager**: Handles production deployment logic
- **DynamicRouter**: Dynamic routing for different versions
- **Shadow Testing**: Safe testing before full deployment
- **Auto-Rollback**: Automatic rollback on threshold violations
- **Health Monitoring**: Real-time performance tracking
- **Background Worker**: Optimization analysis decoupled from request handling
- **Exponential Backoff**: Prevents repeated failed optimization attempts

For multi-instance deployments, configure persistent storage (`redis` with `storage.connection`).

## Current Limitations

- **Single Instance Coordination**: Redis storage is available but lock-free; multi-instance promotion requires external coordination
- **Fastify / Generic HTTP**: Metrics collection works; live handler swapping requires CI/CD or manual integration
- **AI Provider**: Requires external API key; all optimizations work without AI using templates

## Scripts

```bash
npm run build   # compile TypeScript to dist/
npm test        # run Jest test suite
npm run watch   # compile in watch mode
npm pack        # preview the npm tarball
```

## License

MIT — see [LICENSE](./LICENSE).
