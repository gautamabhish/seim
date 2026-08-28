# SEIM — Self-Evolving Infrastructure Middleware (v1.0.3)

**SEIM** is an autonomous, full-stack self-evolving runtime and infrastructure middleware for Node.js and React applications. 

Rather than merely monitoring metrics or alerting on errors, SEIM actively observes real user behavior, triages problems across every layer (5xx runtime bugs, user drop-offs, circular navigation loops, performance anti-patterns, and missing features), automatically scaffolds and sandbox-tests solutions (both backend Express/Fastify routes and physical React TSX components), rolls them out with staged canary traffic, and maintains a real-time **Product Evolution Changelog** with instant 1-click rollback controls for founders.

---

## 🌟 Key Capabilities

- **🚀 Autonomous Product Evolution**: Watches 404s and user journeys across sessions to build, test, and deploy missing API endpoints and React pages with zero founder intervention.
- **⚡ Performance & Anti-Pattern Auto-Fixer**: Identifies and rewrites sequential async calls, N+1 database loops, missing caches, and blocking operations.
- **🛡️ 4-Layer Automated Safety Gate**: Pre-flight security gate, isolated VM sandbox execution, multi-session Sybil filtering, and <500ms automated regression rollback sentry.
- **⚛️ Physical React Frontend Generation**: Generates clean TypeScript TSX components (`src/seim-generated/`) and maintains auto-updated route manifests (`seim-routes.tsx`) for zero-downtime HMR.
- **🧩 Custom Optimization Pattern Registry**: Allows developers to register custom regex/AST code quality templates (`s.patterns.registerRegex`) that SEIM enforces and fixes across the codebase.
- **📦 Founder Control Center & Changelog**: Real-time interactive Studio dashboard showing a timeline of everything SEIM shipped today with side-by-side code diffs and 1-click rollback buttons.
- **🏎️ Framework Agnostic & Lightweight**: Compatible with Express, Fastify, Next.js, Vite, and generic HTTP with sub-millisecond (<0.010ms) request overhead.

---

## 📦 Installation

```bash
npm install seim-core
```

Requires **Node.js 18+**.

*Optional native sandbox acceleration:*
```bash
npm install isolated-vm
```
*(If `isolated-vm` is not installed, SEIM transparently uses its hardened Node.js `vm` context sandbox).*

---

## 🚀 Quick Start

### 1. Backend Integration (Express)

```javascript
const express = require('express');
const { seim } = require('seim-core');

const app = express();
app.use(express.json());

// Initialize SEIM
const s = seim({
  mode: 'bypass', // 'bypass' for autonomous evolution, 'restrict' for observe-only
  behavior: {
    enabled: true,
    autoScaffold: true,     // Automatically build missing features
    minPatternFrequency: 3, // Requires 3+ sessions before triggering
  },
  frontend: {
    enabled: true,
    outputDir: './src/seim-generated', // Writes physical React TSX files
  },
  businessRules: [
    (response) => response && response.total >= 0,
  ],
});

// Attach SEIM listener BEFORE your routes
app.use(s.listener());

// Mount the Studio Control Center
app.use(s.config.studioPath, s.dashboard);

// Standard API routes...
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(3000, () => {
  console.log('App running on http://localhost:3000');
  console.log(`SEIM Studio at http://localhost:3000${s.config.studioPath}`);
});
```

### 2. Fastify Integration

```javascript
const fastify = require('fastify')({ logger: true });
const { seim } = require('seim-core');

const s = seim({ framework: 'fastify', mode: 'bypass' });
fastify.register(s.plugin());

fastify.listen({ port: 3000 });
```

### 3. Frontend Integration (React Router / Vite / Next.js)

SEIM automatically writes generated components to `src/seim-generated/` and updates `seim-routes.tsx`:

```tsx
import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { seimGeneratedRoutes } from './seim-generated/seim-routes';

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          {/* Your standard application routes */}
          <Route path="/" element={<HomePage />} />

          {/* Autonomously evolved SEIM routes (auto-discovered) */}
          {seimGeneratedRoutes.map(r => (
            <Route key={r.path} path={r.path} element={<r.Component />} />
          ))}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

---

## 🛠️ CLI Commands

SEIM includes a built-in zero-dependency CLI tool:

```bash
# Initialize SEIM in a project (or scaffold a starter server)
npx seim init

# View live system status, active versions, and health
npx seim status [url]

# Analyze source code offline for anti-patterns
npx seim analyze ./routes/users.js

# Benchmark API latency and throughput overhead
npx seim benchmark http://localhost:3000/api/health

# Trigger an immediate rollback on a specific route
npx seim rollback /api/users

# Review and apply CI/CD optimizations
npx seim apply [dir]
```

---

## ⚙️ Configuration Reference

Configuration can be specified in `.seimrc.json`, `seim.config.js`, or passed directly to `seim(config)`.

```json
{
  "mode": "bypass",
  "framework": "express",
  "studioPath": "/seim",
  "behavior": {
    "enabled": true,
    "autoScaffold": true,
    "minPatternFrequency": 3,
    "minIssueSessionThreshold": 3,
    "issueCheckIntervalMs": 60000,
    "maxEvents": 10000,
    "excludePaths": ["/health", "/metrics"]
  },
  "frontend": {
    "enabled": true,
    "outputDir": "./src/seim-generated",
    "writeToDisk": true,
    "framework": "react",
    "typescript": true
  },
  "changelog": {
    "enabled": true,
    "maxEntries": 500
  },
  "experiment": {
    "canaryPercent": 5,
    "shadowSampleSize": 25,
    "rollbackLatencyMultiplier": 1.2,
    "rollbackErrorRate": 1.5,
    "sandboxTimeoutMs": 500
  },
  "ai": {
    "enabled": true,
    "provider": "google",
    "apiKey": "YOUR_API_KEY_HERE"
  },
  "security": {
    "blockAuthenticationChanges": true,
    "blockAuthorizationChanges": true,
    "blockPaymentChanges": true,
    "blockSecretUsage": true
  }
}
```

---

## 🧩 Registering Custom Optimization Patterns

Developers can define domain-specific code quality patterns that SEIM enforces automatically:

```javascript
// Register with simple regex shorthand
s.patterns.registerRegex(
  'org/no-sync-redis',
  'Avoid synchronous Redis operations',
  'Use async await redis.get() instead of blocking getSync()',
  'high',
  /redis\.getSync\((.*?)\)/,
  (source, match) => source.replace(/redis\.getSync\(/g, 'await redis.get('),
  { tags: ['redis', 'async'] }
);

// Custom patterns automatically run alongside built-in optimizations!
```

---

## 📊 Benchmark & Performance Profile

Benchmarked across 10,000 requests and 500 concurrent endpoints:

| Metric | Result | Benchmark Threshold | Status |
|---|---|---|---|
| **Request Interceptor Overhead** | **0.010 ms** | <1.0 ms | ✅ Undetectable |
| **Endpoint Tracker Status Check** | **0.0001 ms** | <0.1 ms | ✅ Near Zero-Cost |
| **Analysis Loop Throughput** | **33,333 ops/sec** | >5,000 ops/sec | ✅ Off Hot Path |
| **Memory per Version Variant** | **~322 bytes** | <10 KB | ✅ Ultralight |
| **Test Suite Pass Rate** | **147/147 (100%)** | 100% | ✅ 26/26 Suites Pass |

---

## 🧪 Running Tests

```bash
# Run all 26 test suites
npm test

# Run specific suites
npm run test:benchmark    # Latency & throughput benchmarks
npm run test:stress       # 10,000 req memory & concurrency stress test
npm run test:feasibility  # Accuracy & rollback safety metrics
npm run test:integration  # Complete workflow integration test
```

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
