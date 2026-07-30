# LLM Guide to SEIM

This document helps LLMs and AI coding assistants contribute to and use SEIM effectively.

## What SEIM is

SEIM is a **framework-agnostic, self-optimizing runtime for Node.js**. It observes HTTP traffic, detects performance anti-patterns in route handlers, generates safe optimizations, validates them through shadow testing, and promotes only faster, behaviorally-equivalent versions. It supports Express, Fastify, and generic HTTP servers.

## High-level architecture

```
Request  →  Framework Adapter  →  Metrics Store  →  Worker Queue
                                               ↓
                                      Background Worker
                                               ↓
                                OptimizationEngine → ValidationEngine
                                               ↓
                                        ShadowTest
                                               ↓
                                    Promote / Rollback
```

Key design rule: **never block the request path**. The middleware only records metrics and enqueues routes. Analysis, optimization, validation, and shadow testing happen asynchronously or on subsequent requests.

## File map

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Factory. Wires all components, starts worker, exposes `listener()`, `plugin()`, `dashboard`, `status()`, `shutdown()`, `on()` |
| `src/middleware.ts` | Framework adapter integration; `createExpressListener` and `createListener` |
| `src/adapters/` | Framework-specific instrumentation: Express, Fastify, generic HTTP |
| `src/metrics.ts` | Sliding-window metrics (5 min default), anomaly detection, time buckets |
| `src/metricsAnalyzer.ts` | Decides if a route needs optimization based on latency/error/throughput |
| `src/optimization.ts` | Pattern detector and template-based optimizer (works without LLM) |
| `src/validation.ts` | 8-layer validation: schema, structural equivalence, business rules, tests, security, AI critic, performance gate |
| `src/shadow.ts` | Shadow test engine: runs original and optimized handlers side by side |
| `src/rollback.ts` | Canary/promotion/rollback state machine |
| `src/sandbox.ts` | Secure code execution (`isolated-vm` or `vm` fallback) |
| `src/endpointTracker.ts` | Health scoring, exponential backoff, max-attempt tracking |
| `src/worker.ts` | Background optimization worker with priority queue |
| `src/events.ts` | Typed `SeimEventBus` |
| `src/logger.ts` | Configurable logger with levels and JSON mode |
| `src/config.ts` + `src/configLoader.ts` | Defaults and config auto-discovery |
| `src/autoMiddleware.ts` | Detects missing ETag / response-cache opportunities |
| `src/cli/` | CLI commands: `init`, `status`, `analyze`, `benchmark`, `rollback`, `apply` |

## Adding a new optimization pattern

1. Add the pattern to `src/optimization.ts` in the `patterns` array.
2. Implement `templateFix(source, pattern)` to produce real, runnable code. Comment-only fixes are not acceptable.
3. Add the pattern name to `DEFAULT_SECURITY_CONFIG.allowedPatternModels` in `src/config.ts`.
4. Add a CLI regex to `src/cli/commands/analyze.ts`.
5. Add a unit test and update `LLM.md` pattern list.

## Adding a new framework adapter

1. Create `src/adapters/<framework>.ts` implementing `FrameworkAdapter`.
2. Export it from `src/adapters/index.ts`.
3. Add the framework name to the `framework` union type in `src/types.ts` and `createAdapter()` switch.
4. Update `README.md` and `LLM.md`.

## Validation layers

When changing `ValidationEngine`, keep the 8-layer contract:

1. `layer1Schema` — optimized code exists
2. `layer2ResponseEquivalence` — structural comparison (ignore timestamps/UUIDs)
3. `layer3BusinessRules` — user business rules
4. `layer4UnitTests` — `npm test` execution
5. `layer5IntegrationTests` — integration tests (currently stubbed)
6. `layer6Security` — security gate
7. `layer7AICritic` — LLM review
8. `layer8PerformanceGate` — optimized must be faster than original

`ValidationReport` in `src/types.ts` must match.

## Event conventions

Emit events with typed payloads via `SeimEventBus`:

```ts
import { SeimEventBus } from './events';

const events = new SeimEventBus();
events.emitEvent('optimization:detected', { routeKey, pattern, severity, candidateId });
```

If adding new events, extend `SeimEvents` in `src/events.ts`.

## Logging conventions

Use the `Logger` class. Never use `console.log`/`console.error`.

```ts
import { Logger } from './logger';

const logger = new Logger({ level: 'info', json: false });
logger.info('message', { routeKey, candidateId });
logger.error('message', { error: err.message });
```

## Error handling conventions

- Async paths in middleware must be wrapped in try/catch and emit `error:internal`.
- Never throw unhandled exceptions in request listeners.
- Sandbox errors emit `error:sandbox`.
- Validation failures emit `optimization:rejected` with a reason.

## Metrics storage

`InMemoryMetricsStore` uses time-windowed arrays internally but exposes `durations` as `number[]` for compatibility. If you add new public methods, ensure they return windowed data. The store supports `getAnomalies()` and `getTimeBuckets()`.

## Configuration

Prefer adding defaults to `src/config.ts` `getDefaultConfig()` and merging in `mergeConfig()`. The config loader checks, in order:

1. `.seimrc.json`
2. `seim.config.js`
3. `package.json#seim`
4. programmatic config

## CLI commands

CLI files live in `src/cli/commands/`. They must use only Node.js built-in modules (`fs`, `path`, `http`, `https`). Add new commands to `src/cli/index.ts`.

## Testing conventions

- Add unit tests in `tests/<component>.test.ts`.
- Run `npm test` before committing.
- Do not reduce the existing pass count.
- Stress/feasibility tests measure performance; do not add heavy async loops that distort timing.

## Common anti-patterns to avoid

- **Running optimization on the request path** — always enqueue to `OptimizationWorker`.
- **Strict JSON equality for response validation** — use `structuralMatch` and ignore dynamic fields.
- **Hardcoded mock functions in sandbox** — extract closure scope and require safe modules only.
- **Unbounded arrays** — metrics uses sliding windows; maps are capped at 1000/10000 entries.
- **Leaked intervals** — use `unref()` and clear in `shutdown()` / `destroy()` methods.

## Prompts for common tasks

### Generate a new CLI command

> Create a new CLI command at `src/cli/commands/<name>.ts` that [description]. Use only built-in modules, parse args manually, and register it in `src/cli/index.ts`. Keep error handling minimal but never crash the process.

### Add a validation layer

> Add a new validation layer to `src/validation.ts` and update `ValidationReport` in `src/types.ts`. The layer must return `{ pass: boolean; reason?: string }` and be included in `report.overall`.

### Add a framework adapter

> Add a `src/adapters/<name>.ts` implementing `FrameworkAdapter` from `src/adapters/types.ts`. Export it from `src/adapters/index.ts` and update the `framework` config union.

### Add an optimization pattern

> Add a new pattern to `src/optimization.ts` `patterns` array, implement a real `templateFix` rewrite, add the name to `src/config.ts` `allowedPatternModels`, and add a matching regex to `src/cli/commands/analyze.ts`.

## Version policy

- `package.json` `version` is the source of truth.
- `npm run build` compiles to `dist/`.
- `npm run build` must pass before `npm test`.
- Run `npm pack` to preview the published tarball.

## Security checklist for generated code

- Never optimize authentication, authorization, or payment logic (gated by `SecurityGate`).
- Never introduce new network calls or file system writes not present in the original.
- Sandbox `require()` is restricted to built-in modules extracted from the original source.
- Do not log secrets or API keys.

## Useful shell commands

```bash
npm run build            # compile TypeScript
npm test                 # run Jest suite
npx tsc --noEmit         # type check only
npm pack                 # preview tarball
node dist/cli/index.js --help
```

## When in doubt

- Ask: "Does this change block the request path?" If yes, move it to the worker.
- Ask: "Does this change have a matching event and log line?" If no, add one.
- Ask: "Did `npm test` pass?" If no, fix before finalizing.
