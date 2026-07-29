# SEIM — Self-Evolving Infrastructure Middleware

SEIM is an Express.js middleware that observes your API traffic, detects
performance anti-patterns, generates safe optimizations, validates them,
runs them as shadow implementations, and promotes only the versions that are
provably correct, secure, and faster.

## Install

```bash
npm install seim
```

Requires **Node.js 18+**.

For the safest sandbox, also install `isolated-vm` separately:

```bash
npm install isolated-vm
```

`isolated-vm` is an **optional** native dependency. It must compile for your
platform and requires Python + a C++ toolchain. If it is not installed, SEIM
transparently falls back to Node's built-in `vm` module.

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

```js
const s = seim({
  mode: 'bypass',
  ai: {
    enabled: true,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    generatorModel: 'gpt-4',
    reviewerModel: 'gpt-4',
  },
  experiment: {
    canaryPercent: 5,            // shadow-test 5% of eligible traffic
    shadowCooldownMs: 60000,     // one shadow test per user/IP per minute
    shadowAllowedMethods: ['GET'],
    minSampleSize: 100,
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
  },
});
```

## How it works

1. **Observe** — every request is timed and counted.
2. **Analyze** — SEIM scans route handlers for patterns like sequential `await`s,
   N+1 queries, and missing caches.
3. **Improve** — in `bypass` mode, an LLM (or a built-in template fallback) creates
   an optimized candidate.
4. **Validate** — the candidate must pass schema, response equivalence, business
   rules, unit/integration tests, security, and an AI critic.
5. **Experiment** — the optimized handler runs on a cloned request and a stub
   response; the real user still gets the original.
6. **Promote** — if the new version is faster with no extra errors, SEIM swaps
   the real Express `route.stack` handle.
7. **Rollback** — if error rate or latency regresses, the original is restored
   instantly on the next request.

## Validation layers

SEIM validates in this strict priority order:

```
Correctness > Security > Business Rules > Performance
```

1. Schema validation
2. Response equivalence
3. Business rules
4. Unit tests
5. Integration tests
6. Security validation
7. AI critic review

## Configuration

```ts
interface SeimConfig {
  mode: 'restrict' | 'bypass';
  studioPath: string;
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

## Shadow testing and customer safety

SEIM will never expose an untested version to a customer:

- Real users always receive the currently promoted handler.
- Shadow tests run after the real response is sent.
- Only `GET` requests are shadow-tested by default.
- The same IP or `req.user.id` is never tested more than once per cooldown.
- Promotions only happen when sample size, latency, error rate, and all
  validation layers pass.
- Rollback is instant: the original `route.stack[index].handle` is restored.

## Sandboxing

Generated code runs inside [`isolated-vm`](https://github.com/laverdet/isolated-vm),
which creates a V8 isolate with a memory limit and CPU timeout. If `isolated-vm`
cannot be installed in a given environment, SEIM transparently falls back to
Node's built-in `vm` module with a timeout. For maximum security, use
`isolated-vm` in production.

## Studio dashboard

The default dashboard URL is `/asdfghjklkjhgfdsasdfghj`. It is configurable
via `studioPath`.

Available endpoints:

- `GET <studioPath>` — HTML dashboard
- `GET <studioPath>/api/status` — JSON status
- `GET <studioPath>/api/metrics` — full metrics snapshot

## Scripts

```bash
npm run build   # compile TypeScript to dist/
npm test        # run Jest (jest is bundled as a runtime dependency)
npm pack        # preview the npm tarball
```

## License

MIT — see [LICENSE](./LICENSE).
