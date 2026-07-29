const express = require('express');
const seim = require('./dist/index.js').default;

const app = express();
app.use(express.json());

// Configure SEIM with the enhanced features
const seimInstance = seim({
  mode: 'bypass',
  studioPath: '/tmp/seim-studio',
  learning: {
    enabled: true,
    sampleSize: 3, // Lower for testing
  },
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 100,
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 100,
    shadowCooldownMs: 0, // Disable cooldown for testing
    shadowAllowedMethods: ['GET', 'POST'],
    shadowSampleSize: 2, // Lower for testing
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

// Test endpoint with various potential issues (AI will analyze holistically)
app.get('/api/complex', async (req, res) => {
  // Complex endpoint with multiple potential issues
  const result1 = await fetchData(1);
  const result2 = await fetchData(2);
  const result3 = await fetchData(3);
  
  // Inefficient processing
  const items = [1, 2, 3, 4, 5];
  const processed = [];
  for (let i = 0; i < items.length; i++) {
    processed.push(items[i] * 2);
  }
  
  res.json({ result1, result2, result3, processed });
});

// Simple fast endpoint (AI should determine no optimization needed)
app.get('/api/simple', (req, res) => {
  res.json({ message: 'Simple endpoint', timestamp: Date.now() });
});

// Endpoint with potential caching opportunity
app.get('/api/expensive', async (req, res) => {
  const data = await getExpensiveData(req.query.id || 1);
  res.json({ data });
});

// Helper functions
async function fetchData(id) {
  return new Promise(resolve => setTimeout(() => resolve({ id, value: `data-${id}` }), 100));
}

async function getExpensiveData(id) {
  return new Promise(resolve => setTimeout(() => resolve({ 
    id, 
    value: `expensive-data-${id}`,
    timestamp: Date.now()
  }), 200));
}

// Status endpoint
app.get('/seim/status', (req, res) => {
  res.json(seimInstance.status());
});

// Endpoint tracking status
app.get('/seim/endpoints', (req, res) => {
  res.json(seimInstance.endpointTracker?.getAllStatuses() || []);
});

// Metrics endpoint
app.get('/seim/metrics', (req, res) => {
  res.json(seimInstance.metrics.snapshot());
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Enhanced SEIM system running on port ${PORT}`);
  console.log(`\n🚀 NEW FEATURES DEMONSTRATION:`);
  console.log(`1. Metrics Analysis Engine - Analyzes performance before optimization`);
  console.log(`2. AI-Driven Code Analysis - AI analyzes code holistically (no pattern matching)`);
  console.log(`3. Smart AI Prompting - "Can we optimize this code?" with metrics context`);
  console.log(`4. Endpoint Tracking - Maintains optimization status per endpoint`);
  console.log(`5. Token Saving - Skips AI calls for non-optimizable endpoints`);
  console.log(`\n📊 CONFIGURATION:`);
  console.log(`- learning.sampleSize: 3 (requests before analysis)`);
  console.log(`- experiment.shadowSampleSize: 2 (samples before evaluation)`);
  console.log(`- AI enabled with Gemini model: gemini-2.5-flash`);
  console.log(`\n🔍 ENDPOINTS:`);
  console.log(`- GET /api/complex (multiple potential issues for AI analysis)`);
  console.log(`- GET /api/simple (fast endpoint, AI should skip optimization)`);
  console.log(`- GET /api/expensive (caching opportunity for AI analysis)`);
  console.log(`- GET /seim/status (system status)`);
  console.log(`- GET /seim/endpoints (endpoint optimization tracking)`);
  console.log(`- GET /seim/metrics (performance metrics)`);
  console.log(`\n🏗️ SANDBOX EXPLANATION:`);
  console.log(`The sandbox is a pre-built JavaScript execution environment (NOT AI-written)`);
  console.log(`It safely executes AI-generated code to test if it works correctly`);
  console.log(`- Uses Node.js vm module or isolated-vm for security`);
  console.log(`- Provides safe context with built-in functions (fetchData, etc.)`);
  console.log(`- Executes optimized code in parallel with original for comparison`);
  console.log(`- Prevents AI code from affecting the real application`);
  console.log(`\n🤖 NEW AI APPROACH:`);
  console.log(`- Removed pattern matching (regex patterns are limiting)`);
  console.log(`- AI now performs holistic code analysis`);
  console.log(`- AI considers: performance bottlenecks, code quality, best practices, architecture`);
  console.log(`- AI receives metrics context: latency, P95, P99, error rate, request count`);
  console.log(`- AI decides: can optimize? identifies pattern? provides optimized code`);
  console.log(`- Much more flexible and intelligent than regex pattern matching!`);
});
