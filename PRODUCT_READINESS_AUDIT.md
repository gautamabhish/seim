# SEIM Product-Readiness Audit and Adoption Plan

**Status:** Discovery complete; implementation intentionally not started

**Repository:** `seim-core`

**Audit date:** 2026-08-21

## 1. Purpose

This document records the current product assessment before implementation work begins. The goal is to make SEIM something a new user can install, understand, operate safely, and continue using after the demo: predictable defaults, trustworthy optimization decisions, clear failure behavior, useful observability, and documentation that matches the shipped code.

The scope covers:

- the public installation and first-run experience;
- Express, Fastify, and generic HTTP integration;
- request-path overhead and correctness;
- optimization, shadow execution, validation, promotion, and rollback;
- persistence, restart behavior, and multi-process operation;
- security and dashboard exposure;
- CLI, Studio, telemetry, and demo usability;
- tests, packaging, CI, and operational documentation.

This is an assessment and delivery plan, not a claim that every item below is already proven to be a production defect. Items marked **confirmed** are directly supported by the current code or command output. Items marked **high-risk gap** need implementation and targeted tests before they should be presented as production-safe.

## 2. Baseline evidence

Commands run during discovery:

```text
npm run build
npm test -- --runInBand
```

Results:

- TypeScript build passed.
- 12 Jest suites passed.
- 87 tests passed.
- Existing tests emitted an Express route-key warning for `/seim/telemetry`; this is evidence that route identity can fragment for middleware-mounted or non-route requests.
- The working tree already contains substantial user changes, staged deletions, additions, and modifications. Implementation must preserve those changes and avoid broad cleanup unrelated to this plan.

Passing tests establish a useful component baseline, but they do not establish production readiness. In particular, the suite does not currently demonstrate a full external HTTP lifecycle across restart, multiple processes, real Redis, authenticated Studio access, malformed configuration, or failure of optional dependencies.

## 3. Product promise versus current experience

SEIM promises autonomous optimization with safe validation, shadow testing, promotion, rollback, learning, and a dashboard. A new adopter will judge it by a simpler sequence:

1. Can I install it without native-build or peer-dependency surprises?
2. Can I start in observe-only mode with one obvious integration?
3. Can I tell exactly what it observed and why it made a recommendation?
4. Can I trust that a candidate cannot affect a real request or leak data?
5. Can I approve, reject, roll back, and recover after a restart?
6. Can I run it in more than one application instance without split-brain state?
7. Can I remove it without changing application behavior?

The current code has the core pieces for a compelling product, but the control plane, safety boundaries, persistence semantics, and first-run explanation need to become explicit product contracts rather than inferred behavior.

## 4. Findings

### P0 — Must resolve before autonomous production promotion

#### 4.1 Dashboard and control-plane exposure is not secure by default — **high-risk gap**

Evidence:

- `src/index.ts:205` exposes `dashboard` directly.
- `src/studio.ts:4-13` serves status and metrics without an authentication or authorization hook.
- The default Studio path is intentionally obscure, but obscurity is not access control.
- The dashboard includes operational data and the product has control-oriented semantics.

Impact: an application that mounts the dashboard can expose health, metrics, route/version information, and future control operations to anyone who discovers the path. This is unacceptable as a default for production adoption.

Required direction:

- Make Studio disabled by default in production, or require an explicit `studio.enabled` setting.
- Add a documented authentication/authorization adapter and a safe localhost-only development mode.
- Separate read-only status/metrics from mutating controls.
- Add security headers, bounded response sizes, and audit events for every control action.
- Add tests for unauthenticated, unauthorized, and authorized requests.

#### 4.2 Shadow execution is not a general safe substitute for application execution — **high-risk gap**

Evidence:

- `src/sandbox.ts:35-49` falls back to Node's built-in `vm` when `isolated-vm` is unavailable.
- `src/sandbox.ts:128-145` exposes response method references that call the real response object.
- `src/sandbox.ts:152-181` exposes database bridges backed by `global.seimDb`.
- `src/sandbox.ts:218-241` provides timers and a broadly populated context to the fallback VM.
- `src/sandbox.ts:259-280` uses heuristic closure extraction; it cannot actually reproduce arbitrary application closures.

Impact: candidates may behave differently from the real handler, may trigger side effects during shadowing, and may give users a false sense that a passed shadow test proves safety. A built-in `vm` is not a process boundary. Database writes, external calls, file access through reachable objects, response mutation, timers, and closure-dependent handlers require strict policy.

Required direction:

- Define shadow as side-effect-free by contract.
- Use a recording/stub response and explicit dependency adapters; never pass the live response to candidate code.
- Make `isolated-vm` required for autonomous promotion, with a clear restrict-only fallback when absent.
- Deny network, filesystem, process, child-process, dynamic code generation, and unapproved modules by construction.
- Add cancellation, resource cleanup, concurrency limits, and tests for side effects, rejected promises, timers, large payloads, and memory exhaustion.
- Clearly label unsupported handlers and refuse autonomous promotion when source/closure fidelity is uncertain.

#### 4.3 Promotion and rollback state is split between in-memory and persistence layers — **confirmed/high-risk gap**

Evidence:

- `src/index.ts:117-119` constructs `PersistentVersionManager` but does not load persisted state during initialization.
- `src/persistentVersionManager.ts:250-266` hardcodes `./.seim-storage` in `loadAllStates()` instead of using configured storage.
- `src/persistentVersionManager.ts:181-190` records `fromVersion: 'loaded'` rather than the actual prior version.
- `src/storageFactory.ts:7-14` treats `memory` as file-backed and does not implement the declared `sqlite` branch.
- `src/redisStorageAdapter.ts:31-39` uses read-modify-write arrays, which can lose updates under concurrent processes.
- The Redis adapter is dynamically required but `redis` is not listed in `dependencies`, `optionalDependencies`, or peer dependencies.

Impact: a restart can forget the active version in the runtime even when storage contains it; a configured path may not be restored; concurrent instances can overwrite version history; and configuration says “sqlite” when the factory does not provide sqlite semantics. These are trust-breaking failures for version management.

Required direction:

- Make storage selection truthful: memory, file, sqlite, and Redis must either work or be rejected at configuration time.
- Load and validate state before accepting traffic, with explicit degraded-mode behavior if state is corrupt or unavailable.
- Inject the storage path everywhere; remove hardcoded paths.
- Make writes atomic and versioned. For Redis, use transactions/Lua or per-record keys with compare-and-set semantics.
- Persist active routing state and restore it into the runtime router, not only into the version manager.
- Add restart, corrupt-file, concurrent-writer, and Redis-unavailable tests.

#### 4.4 “Healthy” status is hard-coded rather than derived from component health — **confirmed**

Evidence: `src/index.ts:216` returns `healthy: true` regardless of worker, storage, sandbox, drift detector, or dashboard state.

Impact: operators cannot trust the status endpoint during exactly the failures for which they need it.

Required direction:

- Add component health states: storage, worker, sandbox, router, telemetry, and Studio.
- Distinguish `healthy`, `degraded`, and `unavailable`.
- Include last successful heartbeat, last error, and recovery status.
- Make CLI and Studio show actionable remediation, not only a boolean.

### P1 — Must resolve for a reliable adoption experience

#### 4.5 Configuration semantics are confusing and under-validated — **confirmed/gap**

Evidence:

- `src/config.ts:91-122` performs shallow object merging for several nested settings and does not validate ranges or unknown keys.
- `src/types.ts:110-114` defines scaffolding but `getDefaultConfig()` does not provide a default scaffolding block.
- `README.md` documents `sqlite` as a storage option, while `src/storageFactory.ts` falls back to file storage for every non-Redis type.
- Production validation requires persistent storage, but the default storage path and actual adapter behavior are not explained consistently.

Impact: a typo or unsupported option may silently change behavior. Users cannot confidently predict whether a config is safe, especially for canary percentages, thresholds, paths, and autonomous features.

Required direction:

- Add runtime schema validation at startup with precise field-level errors.
- Reject unknown keys by default, with an explicit escape hatch if needed.
- Validate percentages, positive durations, thresholds, model/provider combinations, and path permissions.
- Publish one canonical config reference generated from the actual schema.
- Add `seim config check` and a redacted effective-config command.

#### 4.6 First-run defaults are too ambitious for a safety-sensitive product — **product decision needed**

Evidence:

- Evolution, learning, drift detection, cross-route intelligence, and pattern extraction default to enabled in `src/config.ts:4-20` and `src/config.ts:67-87`.
- The README presents `bypass` as a quick-start option and describes automatic promotion.
- Studio is mounted manually but has no secure production default.

Impact: users may move from demo to production without understanding the difference between observation, candidate generation, shadowing, canarying, and promotion. Autonomous behavior should be earned through a staged workflow.

Required direction:

- Make the first-run flow explicit: `observe`/restrict → review → canary → promote.
- Keep autonomous promotion opt-in, especially in production.
- Show a startup summary of all behavior-changing capabilities.
- Require explicit acknowledgement for bypass mode in production.
- Add route allowlists/denylists and sensitive-route defaults.

#### 4.7 Framework integration contracts are under-specified — **high-risk gap**

Evidence:

- `src/types.ts:209-212` exposes `listener` and `plugin` as `any`.
- `src/index.ts:202-205` always assigns `listener: createExpressListener(...)`, while Fastify uses a separate plugin function.
- `src/adapters/express.ts` warns that `req.route.path` may be absent and falls back to raw paths, which can fragment metrics.
- The generic adapter and Fastify lifecycle need external end-to-end coverage, not just typescript compilation.

Impact: users may mount SEIM in a valid framework position and receive incorrect route identity, missing body/context behavior, or inconsistent response/shadow semantics.

Required direction:

- Define typed adapter contracts for route identity, request snapshot, response capture, error completion, and handler replacement.
- Test Express router nesting, params, errors, streams, aborted requests, and mounted middleware.
- Test Fastify hooks/plugins, encapsulation, async errors, serialization, and reply lifecycle.
- Define what generic HTTP can and cannot optimize.
- Use stable route templates plus method, not raw URLs, for metrics keys.

#### 4.8 Request-path behavior and metrics retention need production limits — **high-risk gap**

Evidence:

- `RouteMetrics` stores `durations`, `responseSizes`, and `payloadSizes` arrays (`src/types.ts:117-127`).
- `src/index.ts` creates an in-memory metrics store for every instance.
- The repository advertises background processing, but the request instrumentation and response capture need bounded-memory and error-path guarantees.

Impact: long-lived applications with high-cardinality routes can grow memory without a defined retention policy. Errors, streaming responses, client aborts, and large payloads can also produce incomplete or misleading measurements.

Required direction:

- Use bounded rolling histograms or configurable ring buffers.
- Normalize route keys and cap cardinality.
- Define sampling, payload-size limits, PII redaction, and retention.
- Ensure every request completion path records exactly once.
- Benchmark realistic throughput with middleware enabled, not only data-structure operations.

#### 4.9 Validation claims exceed the current evidence — **high-risk gap**

Evidence:

- `ValidationReport` advertises eight layers (`src/types.ts:159-170`).
- The repository tests mostly exercise individual classes and simulated metrics; they do not prove that every layer executes for a real candidate in a real route.
- The optimizer can optionally use AI, but reproducibility, prompt/version tracking, and provider failure behavior are not described as product contracts.

Impact: users may interpret “validated” as equivalent to correctness, while some layers may be heuristic, unavailable, or unable to reproduce application dependencies.

Required direction:

- Emit a per-candidate validation trace showing which layers ran, skipped, or failed and why.
- Make unavailable layers fail closed for autonomous promotion, or visibly downgrade the candidate to manual review.
- Store candidate provenance: source hash, config hash, model/provider, prompt version, validation inputs, and decision.
- Add deterministic fixtures for each optimization pattern and negative cases.
- Treat AI output as untrusted input with strict timeouts, budget limits, redaction, and retry policy.

#### 4.10 Worker lifecycle and event handling need failure isolation — **high-risk gap**

Evidence:

- `src/index.ts:106-114` starts background services during `seim()` construction.
- Lifecycle listeners at `src/index.ts:123-185` perform persistence, propagation, drift, and explanation work in response to events.
- Several event callbacks accept `any`, and the exposed `on` API does not expose unsubscribe semantics.

Impact: initialization has side effects before the application is listening; a failed async listener can become an unhandled rejection or leave the system in a partial state; repeated instances can leave background activity behind if shutdown is missed.

Required direction:

- Add explicit `start()`/`shutdown()` lifecycle semantics and idempotency.
- Isolate event listener failures and report them through health state.
- Use typed event payloads and bounded queues with backpressure.
- Add worker retry/dead-letter behavior and graceful process signal handling.
- Add tests for duplicate start, shutdown during work, worker exceptions, and queue overflow.

### P2 — Required to make the product pleasant and credible

#### 4.11 Documentation and package surface are not yet aligned — **confirmed/gap**

Evidence:

- `package.json` publishes only `dist`, `README.md`, and `LICENSE`; examples, config templates, and operational docs are not included in the package.
- The README says “zero-dependency CLI” while the runtime has optional native and dynamically loaded integrations that need clear installation guidance.
- The README refers to “eight layers” and production capabilities without a limitations/support matrix.
- The repository contains deleted documentation files in the current worktree, so the final public docs need deliberate reconstruction rather than assumptions about their prior contents.

Required direction:

- Create a 10-minute quickstart, production checklist, configuration reference, security model, troubleshooting guide, and framework matrix.
- Add copy-paste examples for restrict mode, canary mode, dashboard auth, Redis, shutdown, and rollback.
- Document unsupported handler shapes and side effects.
- Verify packed output with `npm pack --dry-run` and a clean consumer fixture.

#### 4.12 CLI is useful but not yet an operator workflow — **gap**

Current commands cover init, status, analyze, benchmark, rollback, and apply, but the adoption workflow also needs:

- `config check`;
- `doctor` for storage/sandbox/framework/permissions;
- `routes` and `candidates` with filters;
- `explain <candidate>`;
- explicit `promote`, `pause`, and `resume` controls;
- JSON output and exit codes suitable for CI;
- configurable Studio URL/path rather than only the default path.

Every command should handle non-2xx responses, malformed JSON, timeouts, and authentication consistently.

#### 4.13 Studio is a demo surface, not yet an operations surface — **gap**

The Studio currently exposes summary status/metrics and presents autonomous language. It needs route-level evidence, candidate diff/reason, validation layer results, rollout state, rollback controls with confirmation, audit history, and clear distinction between observed, proposed, shadowed, canaried, promoted, and rolled-back states. It also needs accessibility, responsive behavior, no external font dependency in restricted environments, and secure origin-aware API calls.

#### 4.14 Sensitive data handling is not a documented contract — **high-risk gap**

Requests, headers, bodies, source code, generated code, and metrics can contain secrets or personal data. The current public types and dashboard do not define redaction, retention, or AI-provider data handling.

Required direction:

- Redact authorization, cookies, API keys, passwords, and configurable fields before logs, persistence, telemetry, or AI calls.
- Add payload/body capture opt-in, size limits, and a custom redactor.
- Document whether code and request data leave the process.
- Add tests proving redaction in logger, persistence, Studio, and AI request paths.

#### 4.15 Test quality and CI coverage need a production-focused layer — **gap**

The current suite is valuable but over-indexes on simulated components and permissive performance assertions. Add:

- clean-install and package-consumer tests;
- Node 18/20/22 matrix;
- Express and Fastify real HTTP tests;
- restart/persistence tests;
- Redis integration tests, optionally service-backed in CI;
- security and property-based tests for candidate code;
- fault injection for storage, worker, AI, sandbox, and network failures;
- memory/cardinality soak tests;
- dashboard accessibility and API contract tests.

## 5. Adoption-oriented target behavior

The following should become the product contract:

### First run

```text
npx seim init
npx seim doctor
```

The generated config should default to observation/restrict mode, show exactly what is enabled, and provide a single framework-specific integration example. Startup should fail early with a useful message for invalid or unsafe configuration.

### Safe progression

```text
observe → analyze → review candidate → shadow → canary → promote
                                      ↘ reject / rollback
```

Each transition should be visible in the CLI, Studio, events, and persisted audit history.

### Failure behavior

- If SEIM cannot observe, the application remains available unless the user explicitly chooses fail-closed behavior.
- If storage is unavailable, autonomous promotion pauses and status becomes degraded.
- If sandbox guarantees are unavailable, candidates remain suggestions/manual-review only.
- If a candidate fails validation, it is never promoted.
- If promoted traffic regresses, rollback is atomic, observable, and restart-safe.
- `shutdown()` is safe to call more than once and flushes or explicitly reports dropped work.

## 6. Recommended delivery sequence

### Phase 0 — Contract and safety foundation

- Freeze the public behavior matrix and supported framework versions.
- Add runtime config validation and safe production defaults.
- Secure/disable Studio by default in production.
- Define redaction and data-retention policies.
- Add typed lifecycle/events and health components.

### Phase 1 — State and runtime correctness

- Fix storage adapter truthfulness and configured-path handling.
- Restore persisted routing state before traffic.
- Implement atomic writes/concurrency handling.
- Harden worker lifecycle, queue limits, and shutdown.
- Bound metrics memory and normalize route keys.

### Phase 2 — Candidate safety and decision evidence

- Replace live-response shadowing with side-effect-free recording.
- Require isolated-vm for autonomous promotion or downgrade safely.
- Make validation traces and candidate provenance persistent.
- Add route allow/deny controls and sensitive-route protections.

### Phase 3 — Framework and integration confidence

- Add real Express, Fastify, generic HTTP, restart, and failure-path suites.
- Test streams, errors, aborts, nested routers, params, and async context.
- Verify clean package installation and example applications.

### Phase 4 — Operator experience

- Build the CLI workflow (`doctor`, `config check`, candidate review, explain, promote/pause/resume).
- Redesign Studio around evidence and safe controls.
- Add production docs, migration notes, and troubleshooting.

### Phase 5 — Release gate

- Run the CI matrix and soak tests.
- Publish a threat model and limitations matrix.
- Verify npm tarball contents and a clean consumer project.
- Release with autonomous promotion disabled by default until the evidence thresholds are met.

## 7. Definition of done

SEIM is ready for a public adoption push when all of the following are true:

- A new user can install and reach a working restrict-mode integration in under 10 minutes.
- Configuration errors are caught before traffic starts and identify the exact field and remedy.
- Production Studio is protected or disabled by default.
- No shadow test can call a live response, mutate production state, access unapproved resources, or silently continue after timeout.
- Restart restores active versions and audit history from the configured storage backend.
- Multi-process storage updates are safe or explicitly unsupported and rejected.
- Health status reflects real component failures.
- Metrics, logs, telemetry, persistence, and AI requests have tested redaction and bounded retention.
- Express and Fastify behavior is covered by real HTTP integration tests.
- Every automatic promotion has an inspectable evidence trail and an operator rollback path.
- README, examples, package contents, CLI help, and runtime behavior agree.
- CI covers supported Node versions, clean installation, security, persistence, and failure injection.

## 8. Implementation rules for the next phase

- Preserve existing user work in the dirty working tree.
- Make small, reviewable changes grouped by the delivery phases above.
- Add a regression test with every confirmed bug fix.
- Do not enable a new autonomous capability merely to make a demo look better.
- Prefer explicit refusal/manual review over pretending an unsupported handler is safe.
- Update user-facing documentation in the same change as behavior changes.
- Re-run build, unit tests, integration tests, and the relevant production-focused tests after each phase.

## 9. Immediate next step

After review of this document, implementation should begin with Phase 0: configuration validation, production-safe defaults, Studio access control, redaction policy, and component health. These establish the trust boundary needed for the later optimization work to be adoptable.
