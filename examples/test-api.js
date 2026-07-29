const express = require('express');
const seim = require('./dist/index.js').default;

const app = express();
app.use(express.json());

// Configure SEIM with sampleSize=5 and Gemini API
const seimInstance = seim({
  mode: 'bypass',
  studioPath: '/tmp/seim-studio',
  learning: {
    enabled: true,
    sampleSize: 5, // Only analyze after 5 requests
  },
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 100, // Run shadow tests on all requests for testing
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 100,
    shadowCooldownMs: 60000,
    shadowAllowedMethods: ['GET', 'POST'],
    shadowSampleSize: 5, // Only evaluate after 5 shadow samples
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

// Test endpoints with different patterns
app.get('/api/sequential', async (req, res) => {
  // Simulate sequential async calls (pattern: sequential-async)
  const result1 = await fetchData(1);
  const result2 = await fetchData(2);
  res.json({ result1, result2 });
});

app.get('/api/n-plus-one', async (req, res) => {
  // Simulate N+1 query pattern
  const users = await fetchUsers();
  const results = [];
  for (const user of users) {
    const userDetails = await fetchUserDetails(user.id);
    results.push(userDetails);
  }
  res.json({ results });
});

app.get('/api/cache', async (req, res) => {
  // Simulate missing cache pattern
  const data = await fetchData(1);
  res.json({ data });
});

app.get('/api/loop', (req, res) => {
  // Simulate inefficient loop pattern
  const items = [1, 2, 3, 4, 5];
  const results = [];
  for (let i = 0; i < items.length; i++) {
    results.push(items[i] * 2);
  }
  res.json({ results });
});

app.get('/api/serialization', (req, res) => {
  // Simulate redundant serialization pattern
  const data = { key: 'value' };
  const copied = JSON.parse(JSON.stringify(data));
  res.json({ copied });
});

app.get('/api/blocking', (req, res) => {
  // Simulate blocking operation pattern
  const fs = require('fs');
  let data = 'default';
  try {
    data = fs.readFileSync('/tmp/test.txt', 'utf8') || 'default';
  } catch (e) {
    data = 'default';
  }
  res.json({ data });
});

// Simple helper functions to simulate async operations
async function fetchData(id) {
  return new Promise(resolve => setTimeout(() => resolve({ id, value: `data-${id}` }), 100));
}

async function fetchUsers() {
  return new Promise(resolve => setTimeout(() => resolve([
    { id: 1, name: 'User 1' },
    { id: 2, name: 'User 2' },
    { id: 3, name: 'User 3' }
  ]), 100));
}

async function fetchUserDetails(userId) {
  return new Promise(resolve => setTimeout(() => resolve({ userId, details: `details-${userId}` }), 50));
}

// Regular endpoint without patterns
app.get('/api/normal', (req, res) => {
  res.json({ message: 'This is a normal endpoint' });
});

// Dashboard endpoint
app.get('/seim/dashboard', seimInstance.dashboard);

// Status endpoint
app.get('/seim/status', (req, res) => {
  res.json(seimInstance.status());
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Test API server running on port ${PORT}`);
  console.log(`Sample sizes configured: learning.sampleSize=5, experiment.shadowSampleSize=5`);
  console.log(`AI enabled with Gemini model: gemini-2.5-flash`);
  console.log(`\nTest endpoints:`);
  console.log(`- GET /api/sequential (sequential-async pattern)`);
  console.log(`- GET /api/n-plus-one (n-plus-one pattern)`);
  console.log(`- GET /api/cache (missing-cache pattern)`);
  console.log(`- GET /api/loop (inefficient-loop pattern)`);
  console.log(`- GET /api/serialization (redundant-serialization pattern)`);
  console.log(`- GET /api/blocking (blocking-op pattern)`);
  console.log(`- GET /api/normal (no pattern)`);
  console.log(`- GET /seim/dashboard (SEIM dashboard)`);
  console.log(`- GET /seim/status (SEIM status)`);
  console.log(`\nTo test: curl http://localhost:3000/api/sequential`);
});
