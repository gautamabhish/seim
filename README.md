# SEIM — Self-Evolving Infrastructure Middleware

SEIM is an Express.js middleware that observes your API traffic, detects performance anti-patterns, generates safe optimizations, validates them, runs them as shadow implementations, and promotes only the versions that are provably correct, secure, and faster.

## Features

- **AI-Powered Optimization**: Analyzes code patterns and suggests improvements
- **Shadow Testing**: Safe testing of optimizations before deployment
- **Automatic Rollback**: Instant rollback if issues are detected
- **Version Management**: Complete history of all endpoint versions with persistent storage
- **Performance Tracking**: Metrics analysis for optimization decisions
- **Token Saving**: Smart caching to avoid unnecessary AI calls
- **Holistic AI Analysis**: AI-driven code analysis without rigid pattern matching

## Install

```bash
npm install seim
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
  mode: 'restrict', // safe observe-and-suggest mode
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

## Directory Structure

```
seim/
├── src/                    # Source code
│   ├── ai.ts             # AI client for optimization
│   ├── config.ts         # Configuration management
│   ├── dynamicRouter.ts  # Dynamic routing for production
│   ├── endpointTracker.ts # Endpoint optimization tracking
│   ├── index.ts          # Main entry point
│   ├── metrics.ts        # Metrics collection
│   ├── metricsAnalyzer.ts # Performance analysis
│   ├── middleware.ts     # Express middleware
│   ├── optimization.ts   # Optimization engine
│   ├── persistentVersionManager.ts # Persistent version storage
│   ├── productionManager.ts # Production deployment manager
│   ├── rollback.ts       # Rollback mechanism
│   ├── sandbox.ts        # Code execution sandbox
│   ├── shadow.ts         # Shadow testing engine
│   ├── shadowLimiter.ts  # Shadow testing rate limiter
│   ├── types.ts          # TypeScript types
│   ├── validation.ts     # Validation engine
│   └── versionManager.ts # Version management
├── tests/                 # Comprehensive test suite
│   ├── benchmark.test.ts # Performance benchmarks
│   ├── endpointTracker.test.ts # Unit tests
│   ├── feasibility.test.ts # Feasibility metrics
│   ├── integration.test.ts # Integration tests
│   ├── metricsAnalyzer.test.ts # Unit tests
│   ├── stress.test.ts     # Stress tests
│   ├── versionManager.test.ts # Unit tests
│   └── jest.config.js    # Jest configuration
├── examples/              # Example scripts
│   ├── test-enhanced-system.js # Complete system test
│   ├── test-production-deployment.js # Production deployment test
│   ├── test-ai.js        # AI optimization test
│   ├── test-loop-ai.js   # Loop optimization test
│   ├── test-blocking-ai.js # Blocking operation test
│   ├── test-cache-ai.js   # Cache optimization test
│   ├── test-n-plus-one-ai.js # N+1 query optimization test
│   ├── test-ternary-ai.js # Ternary operator test
│   ├── test-serialization-ai.js # Serialization test
│   ├── test-regex.js     # Regex optimization test
│   ├── test-simple.js    # Simple test
│   ├── test-working.js   # Working example
│   ├── test-final.js     # Final test
│   ├── test-api.js       # API test
│   ├── test-api-debug.js # API debug test
│   ├── test-direct.js    # Direct test
│   ├── test-loop-pattern.js # Pattern-based loop test
│   ├── test-cache-pattern.js # Pattern-based cache test
│   ├── test-n-plus-one.js # N+1 pattern test
│   ├── test-ternary-pattern.js # Pattern-based ternary test
│   ├── test-sequential-working.js # Sequential working test
│   ├── test-working-loop.js # Working loop test
│   └── run-test.sh      # Test runner script
├── docs/                  # Documentation
│   ├── ARCHITECTURE.md   # System architecture
│   ├── PRODUCTION_DEPLOYMENT.md # Production deployment guide
│   ├── PRODUCTION_LIMITATIONS.md # Current limitations
│   ├── VERSION_MANAGEMENT.md # Version management system
│   └── TEST_REPORT.md    # Comprehensive test report
├── dist/                  # Compiled JavaScript
└── package.json          # Package configuration
```

## Testing

SEIM includes a comprehensive test suite covering all aspects of the system:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests only (35 tests)
npm run test:stress       # Stress tests only (11 tests)
npm run test:benchmark    # Benchmark tests only (9 tests)
npm run test:feasibility  # Feasibility tests only (9 tests)
npm run test:integration  # Integration tests only (9 tests)
```

### Test Coverage

- **Unit Tests**: 35 tests covering individual components
- **Stress Tests**: 11 tests for load handling and memory efficiency
- **Benchmark Tests**: 9 tests for performance metrics and overhead
- **Feasibility Tests**: 9 tests for adoption feasibility metrics
- **Integration Tests**: 9 tests for complete workflow scenarios

### Test Results

- **Total Tests**: 73
- **Pass Rate**: 100%
- **Performance**: Sub-millisecond operations for all components
- **Scalability**: Linear scaling with load
- **Memory Efficiency**: ~315 bytes per version

See `docs/TEST_REPORT.md` for detailed test results and performance analysis.

## Configuration

```ts
interface SeimConfig {
  mode: 'restrict' | 'bypass';
  studioPath: string;
  storagePath?: string; // Path for persistent version storage
  businessRules: ((response: any, request?: Request) => boolean | Promise<boolean>)[];
  securityRules?: ((oldCode: string, newCode: string) => { pass: boolean; reason?: string })[];
  ai?: {
    enabled: boolean;
    apiKey?: string;
    baseUrl?: string;
    generatorModel?: string;
    reviewerModel?: string;
    verifierModel?: string;
  };
  experiment: {
    confidenceThreshold: number;
    canaryPercent: number;
    rollbackLatencyMs: number;
    rollbackErrorRate: number;
    minSampleSize: number;
    shadowCooldownMs: number;
    shadowAllowedMethods: string[];
  };
  security: {
    blockAuthenticationChanges: boolean;
    blockAuthorizationChanges: boolean;
    blockPaymentChanges: boolean;
    blockSecretUsage: boolean;
    allowedPatternModels: string[];
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
- Validates against all seven layers
- Runs shadow tests on a small sample
- Promotes winners, rolls back regressions

## How it works

1. **Observe** — every request is timed and counted.
2. **Analyze** — SEIM scans route handlers for patterns like sequential `await`s, N+1 queries, and missing caches.
3. **Improve** — in `bypass` mode, an LLM (or a built-in template fallback) creates an optimized candidate.
4. **Validate** — the candidate must pass schema, response equivalence, business rules, unit/integration tests, security, and an AI critic.
5. **Experiment** — the optimized handler runs on a cloned request and a stub response; the real user still gets the original.
6. **Promote** — if the new version is faster with no extra errors, SEIM swaps the real Express `route.stack` handle.
7. **Rollback** — if error rate or latency regresses, the original is restored instantly on the next request.

## Version Management

SEIM now includes comprehensive version management:

- **Persistent Storage**: File-based storage for all endpoint versions
- **Semantic Versioning**: v1.0.0, v1.1.0, etc. for clear version tracking
- **Complete History**: Every version and transition tracked
- **Safe Rollback**: Can rollback to any previous version
- **Performance Tracking**: Metrics per version for comparison
- **Audit Trail**: Complete change history with reasons

See `docs/VERSION_MANAGEMENT.md` for detailed version management documentation.

## Production Deployment

SEIM includes production deployment features:

- **ProductionManager**: Handles production deployment logic
- **DynamicRouter**: Dynamic routing for different versions
- **Shadow Testing**: Safe testing before full deployment
- **Auto-Rollback**: Automatic rollback on threshold violations
- **Health Monitoring**: Real-time performance tracking

See `docs/PRODUCTION_DEPLOYMENT.md` for production deployment guide.

## Current Limitations

- **Single Instance Only**: No multi-instance coordination
- **File-Based Storage**: Not suitable for multi-instance coordination
- **No CI/CD Integration**: Runtime-only optimizations
- **No Redis Coordination**: No distributed state management

See `docs/PRODUCTION_LIMITATIONS.md` for detailed limitations.

## Documentation

- **Architecture**: See `docs/ARCHITECTURE.md` for system architecture
- **Production Deployment**: See `docs/PRODUCTION_DEPLOYMENT.md` for production setup
- **Version Management**: See `docs/VERSION_MANAGEMENT.md` for version control details
- **Test Report**: See `docs/TEST_REPORT.md` for comprehensive test results
- **Limitations**: See `docs/PRODUCTION_LIMITATIONS.md` for current limitations

## Examples

See the `examples/` directory for various usage scenarios:
- `test-enhanced-system.js` - Complete system test with all features
- `test-production-deployment.js` - Production deployment test
- `test-ai.js` - AI optimization test
- `test-loop-ai.js` - Loop optimization test
- `test-blocking-ai.js` - Blocking operation test
- `test-cache-ai.js` - Cache optimization test
- `test-n-plus-one-ai.js` - N+1 query optimization test
- `test-ternary-ai.js` - Ternary operator test
- `test-serialization-ai.js` - Serialization test
- `test-regex.js` - Regex optimization test
- `test-simple.js` - Simple test
- `test-working.js` - Working example
- `test-final.js` - Final test
- `test-api.js` - API test
- `test-api-debug.js` - API debug test
- `test-direct.js` - Direct test
- `test-loop-pattern.js` - Pattern-based loop test
- `test-cache-pattern.js` - Pattern-based cache test
- `test-n-plus-one.js` - N+1 pattern test
- `test-ternary-pattern.js` - Pattern-based ternary test
- `test-sequential-working.js` - Sequential working test
- `test-working-loop.js` - Working loop test
- `run-test.sh` - Test runner script

## Scripts

```bash
npm run build   # compile TypeScript to dist/
npm test        # run Jest test suite
npm pack        # preview the npm tarball
```

## License

MIT — see [LICENSE](./LICENSE).