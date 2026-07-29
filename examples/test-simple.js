const express = require('express');
const seim = require('./dist/index.js').default;

const app = express();
app.use(express.json());

// Configure SEIM with minimal settings for testing
const seimInstance = seim({
  mode: 'bypass',
  studioPath: '/tmp/seim-studio',
  learning: {
    enabled: true,
    sampleSize: 2, // Very low for testing
  },
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 100,
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 100,
    shadowCooldownMs: 0,
    shadowAllowedMethods: ['GET', 'POST'],
    shadowSampleSize: 2, // Very low for testing
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
    allowedPatternModels: ['sequential-async', 'n-plus-one', 'missing-cache', 'inefficient-loop', 'redundant-serialization', 'blocking-op'],
  },
});

// Apply SEIM middleware
app.use(seimInstance.listener());

// Test endpoint with sequential async pattern
app.get('/api/sequential', async (req, res) => {
  console.log('[ROUTE] /api/sequential called');
  const result1 = await fetchData(1);
  const result2 = await fetchData(2);
  res.json({ result1, result2 });
});

// Simple helper functions to simulate async operations
async function fetchData(id) {
  return new Promise(resolve => setTimeout(() => resolve({ id, value: `data-${id}` }), 100));
}

// Status endpoint
app.get('/seim/status', (req, res) => {
  res.json(seimInstance.status());
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Simple test server running on port ${PORT}`);
  console.log(`Sample sizes: learning.sampleSize=2, experiment.shadowSampleSize=2`);
  console.log(`\nTo test: curl http://localhost:3000/api/sequential`);
});
