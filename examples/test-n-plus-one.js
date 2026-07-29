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

// Test endpoint with N+1 query pattern
app.get('/api/users-with-details', async (req, res) => {
  console.log('[ROUTE] /api/users-with-details called');
  
  // First query to get users
  const users = await fetchUsers();
  
  // N+1 problem: making individual queries for each user
  const results = [];
  for (const user of users) {
    const userDetails = await fetchUserDetails(user.id);
    results.push(userDetails);
  }
  
  res.json({ results });
});

// Simulate database functions
async function fetchUsers() {
  return new Promise(resolve => setTimeout(() => resolve([
    { id: 1, name: 'User 1' },
    { id: 2, name: 'User 2' },
    { id: 3, name: 'User 3' },
    { id: 4, name: 'User 4' },
    { id: 5, name: 'User 5' }
  ]), 100));
}

async function fetchUserDetails(userId) {
  return new Promise(resolve => setTimeout(() => resolve({ 
    userId, 
    details: `Detailed info for user ${userId}`,
    email: `user${userId}@example.com`,
    role: 'user'
  }), 50));
}

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
  console.log(`N+1 pattern test server running on port ${PORT}`);
  console.log(`Testing N+1 query pattern detection and optimization`);
  console.log(`Sample sizes: learning.sampleSize=3, experiment.shadowSampleSize=3`);
  console.log(`\nTest endpoint: GET /api/users-with-details`);
  console.log(`Status: GET /seim/status`);
  console.log(`Metrics: GET /seim/metrics`);
});
