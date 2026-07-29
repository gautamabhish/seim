const express = require('express');
const seim = require('./dist/index.js').default;

const app = express();
app.use(express.json());

// Configure SEIM with low sample sizes for testing
const seimInstance = seim({
  mode: 'bypass',
  studioPath: '/tmp/seim-studio',
  learning: {
    enabled: true,
    sampleSize: 3, // Low for testing
  },
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 100,
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 100,
    shadowCooldownMs: 0, // Disable cooldown for testing
    shadowAllowedMethods: ['GET', 'POST'],
    shadowSampleSize: 3, // Low for testing
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

// Test endpoint with inefficient loop pattern
app.get('/api/double-items', (req, res) => {
  console.log('[ROUTE] /api/double-items called');
  
  // Inefficient loop pattern
  const items = [1, 2, 3, 4, 5];
  const results = [];
  for (let i = 0; i < items.length; i++) {
    results.push(items[i] * 2);
  }
  res.json({ results });
});

// Status endpoint
app.get('/seim/status', (req, res) => {
  res.json(seimInstance.status());
});

// Metrics endpoint
app.get('/seim/metrics', (req, res) => {
  res.json(seimInstance.metrics.snapshot());
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Inefficient loop pattern test server running on port ${PORT}`);
  console.log(`Testing inefficient loop pattern detection and optimization`);
  console.log(`Sample sizes: learning.sampleSize=3, experiment.shadowSampleSize=3`);
  console.log(`\nTest endpoint: GET /api/double-items`);
  console.log(`Status: GET /seim/status`);
  console.log(`Metrics: GET /seim/metrics`);
});
