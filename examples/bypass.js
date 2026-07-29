const express = require('express');
const seim = require('../dist/index').default;

const app = express();

const s = seim({
  mode: 'bypass',
  experiment: {
    confidenceThreshold: 0.92,
    canaryPercent: 10,
    rollbackLatencyMs: 1.2,
    rollbackErrorRate: 1.5,
    minSampleSize: 5,
  },
  businessRules: [
    (response) => response && typeof response.total === 'number' && response.total >= 0,
  ],
});

app.use('/v1', s.listener());

// This handler intentionally uses a sequential async pattern for demo purposes.
async function slow(req, res) {
  const a = await Promise.resolve({ id: 1 });
  const b = await Promise.resolve({ id: 2 });
  res.json({ total: a.id + b.id });
}
app.get('/v1/demo', s.listener(), slow);

app.use(s.config.studioPath, s.dashboard);

app.listen(3001, () => {
  console.log('SEIM bypass example running on http://localhost:3001');
  console.log('Studio at http://localhost:3001' + s.config.studioPath);
});
