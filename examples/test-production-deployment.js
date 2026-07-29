const express = require('express');
const seim = require('./dist/index.js').default;

const app = express();
app.use(express.json());

// Configure SEIM with production deployment features
const seimInstance = seim({
  mode: 'bypass',
  studioPath: '/tmp/seim-studio',
  learning: {
    enabled: true,
    sampleSize: 2, // Very low for testing
  },
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 5, // Start with 5% canary
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 10,
    shadowCooldownMs: 0,
    shadowAllowedMethods: ['GET', 'POST'],
    shadowSampleSize: 2, // Low for testing
  },
  ai: {
    generatorModel: 'gemini-2.5-flash',
    reviewerModel: 'gemini-2.5-flash',
    verifierModel: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    enabled: true,
    apiKey: 'AIzaSyC8uqcd4Nnlf69U0sIzCeJLyDwCK8yLxtQ',
    provider: 'google',
  },
  storage: {
    type: 'memory',
  },
  security: {
    blockAuthenticationChanges: true,
    blockAuthorizationChanges: true,
    blockPaymentChanges: true,
    blockSecretUsage: true,
    allowedPatternModels: ['sequential-async', 'n-plus-one', 'missing-cache', 'inefficient-loop', 'redundant-serialization', 'blocking-op', 'nested-ternary', 'ai-detected'],
  },
});

// Apply SEIM middleware
app.use(seimInstance.listener());

// Test endpoint for production deployment
app.get('/api/test', async (req, res) => {
  const result1 = await fetchData(1);
  const result2 = await fetchData(2);
  res.json({ result1, result2 });
});

// Helper function
async function fetchData(id) {
  return new Promise(resolve => setTimeout(() => resolve({ id, value: `data-${id}` }), 100));
}

// Production management endpoints
app.get('/seim/production/deployments', (req, res) => {
  res.json(seimInstance.productionManager?.getAllDeployments() || []);
});

app.post('/seim/production/deploy/:routeKey', (req, res) => {
  const { routeKey } = req.params;
  const { canaryPercent = 5 } = req.body;
  
  const deployment = seimInstance.productionManager?.startDeployment(routeKey, canaryPercent);
  res.json({ success: true, deployment });
});

app.post('/seim/production/rollback/:routeKey', (req, res) => {
  const { routeKey } = req.params;
  const { reason } = req.body;
  
  const success = seimInstance.productionManager?.rollback(routeKey, reason);
  res.json({ success });
});

app.post('/seim/production/promote/:routeKey', (req, res) => {
  const { routeKey } = req.params;
  
  const success = seimInstance.productionManager?.promoteToFullTraffic(routeKey);
  res.json({ success });
});

app.post('/seim/production/canary/:routeKey', (req, res) => {
  const { routeKey } = req.params;
  const { percent } = req.body;
  
  const success = seimInstance.productionManager?.updateCanaryPercent(routeKey, percent);
  res.json({ success });
});

// Regular endpoints
app.get('/seim/status', (req, res) => {
  res.json(seimInstance.status());
});

app.get('/seim/endpoints', (req, res) => {
  res.json(seimInstance.endpointTracker?.getAllStatuses() || []);
});

app.get('/seim/metrics', (req, res) => {
  res.json(seimInstance.metrics.snapshot());
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Production Deployment System running on port ${PORT}`);
  console.log(`\n🚀 PRODUCTION DEPLOYMENT FEATURES:`);
  console.log(`1. Production Manager - Manages deployment lifecycle`);
  console.log(`2. Dynamic Router - Request-level routing based on canary %`);
  console.log(`3. Health Monitoring - Continuous health checks with auto-rollback`);
  console.log(`4. Gradual Canary Progression - 5% → 25% → 50% → 75% → 100%`);
  console.log(`5. Circuit Breaker Pattern - Auto-failover on issues`);
  console.log(`\n📊 PRODUCTION DEPLOYMENT FLOW:`);
  console.log(`Shadow Testing → Validation → Canary 5% → Health Check →`);
  console.log(`  If healthy: Progress to 25% → Health Check →`);
  console.log(`  If healthy: Progress to 50% → Health Check →`);
  console.log(`  If healthy: Progress to 75% → Health Check →`);
  console.log(`  If healthy: Progress to 100% → Continuous Monitoring`);
  console.log(`  If unhealthy: Auto-rollback → Investigate → Fix → Retry`);
  console.log(`\n🔍 ENDPOINTS:`);
  console.log(`- GET /api/test (test endpoint for optimization)`);
  console.log(`- GET /seim/production/deployments (view all deployments)`);
  console.log(`- POST /seim/production/deploy/:routeKey (start deployment)`);
  console.log(`- POST /seim/production/rollback/:routeKey (manual rollback)`);
  console.log(`- POST /seim/production/promote/:routeKey (promote canary)`);
  console.log(`- POST /seim/production/canary/:routeKey (set canary %)`);
  console.log(`- GET /seim/status (system status)`);
  console.log(`- GET /seim/endpoints (endpoint tracking)`);
  console.log(`- GET /seim/metrics (performance metrics)`);
  console.log(`\n🏗️ PRODUCTION SAFETY FEATURES:`);
  console.log(`- Shadow testing (users never see experimental code)`);
  console.log(`- Gradual canary deployment (reduces risk)`);
  console.log(`- Automatic rollback (protects against bad optimizations)`);
  console.log(`- Health monitoring (continuous validation)`);
  console.log(`- Runtime handler replacement (no server restart needed)`);
  console.log(`- Circuit breaker pattern (auto-failover)`);
});
