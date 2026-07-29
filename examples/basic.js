const express = require('express');
const seim = require('../dist/index').default;

const app = express();

const s = seim({
  mode: 'restrict',
  businessRules: [
    (response) => response && response.total >= 0,
    (response) => !response || !response.items || response.items.length <= 1000,
  ],
});

// Group-level monitoring
app.use('/v1', s.listener());

app.get('/v1/users', (req, res) => {
  res.json({ items: [] });
});

app.get('/v1/orders', (req, res) => {
  res.json({ total: 0, items: [] });
});

// Route-level monitoring
function systemReportHandler(req, res) {
  res.json({ healthy: true });
}
app.get('/system-report', s.listener(), systemReportHandler);

// Dashboard
app.use(s.config.studioPath, s.dashboard);

app.listen(3000, () => {
  console.log('SEIM basic example running on http://localhost:3000');
  console.log('Studio at http://localhost:3000' + s.config.studioPath);
});
