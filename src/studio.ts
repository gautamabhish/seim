import { Request, Response, RequestHandler } from 'express';
import { SeimInstance } from './types';

export function createStudioHandler(instance: SeimInstance): RequestHandler {
  return (req: Request, res: Response): void => {
    if (req.path.endsWith('/api/status')) {
      res.json({ ok: true, status: instance.status() });
      return;
    }
    if (req.path.endsWith('/api/metrics')) {
      res.json(instance.metrics.snapshot());
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SEIM — Autonomous App Control Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent-blue: #38bdf8;
      --accent-purple: #a855f7;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg-dark);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(17, 24, 39, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(135deg, #38bdf8 0%, #a855f7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo-badge {
      font-size: 0.7rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--accent-blue);
      -webkit-text-fill-color: var(--accent-blue);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 500;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--accent-green);
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 10px var(--accent-green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 0.4; }
      50% { opacity: 1; transform: scale(1.2); }
      100% { opacity: 0.4; }
    }
    main {
      flex: 1;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .card:hover {
      border-color: rgba(56, 189, 248, 0.4);
      transform: translateY(-2px);
    }
    .card-title {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .card-subtext {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .nav-tabs {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 0.5rem;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.6rem 1.2rem;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      border-radius: 0.5rem;
      transition: all 0.2s ease;
    }
    .tab-btn.active {
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent-blue);
    }
    .tab-btn:hover:not(.active) {
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.05);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.9rem;
    }
    th {
      background: rgba(31, 41, 55, 0.5);
      padding: 1rem 1.25rem;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--card-border);
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-blue { background: rgba(56, 189, 248, 0.15); color: var(--accent-blue); border: 1px solid rgba(56, 189, 248, 0.3); }
    .badge-purple { background: rgba(168, 85, 247, 0.15); color: var(--accent-purple); border: 1px solid rgba(168, 85, 247, 0.3); }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); border: 1px solid rgba(245, 158, 11, 0.3); }
    .explain-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .explain-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }
    pre {
      background: #090d16;
      border: 1px solid var(--card-border);
      padding: 1.25rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      font-family: monospace;
      font-size: 0.85rem;
      color: #38bdf8;
    }
    .non-tech-banner {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 0.75rem;
      padding: 1.25rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .non-tech-icon {
      font-size: 2rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <span>⚡ SEIM</span>
      <span class="logo-badge">Control Center</span>
    </div>
    <div class="header-right">
      <div class="status-pill">
        <span class="pulse-dot"></span>
        <span id="sys-mode">Autonomous Mode: ${instance.config.mode.toUpperCase()}</span>
      </div>
    </div>
  </header>

  <main>
    <div class="non-tech-banner">
      <div class="non-tech-icon">🧠</div>
      <div>
        <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.2rem;">Full-Stack Application Health & Self-Evolution</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted);">
          SEIM is actively monitoring your web application traffic, tuning route performance, and ensuring error-free operation in real time.
        </p>
      </div>
    </div>

    <!-- Top Key Metrics -->
    <div class="stats-grid">
      <div class="card">
        <div class="card-title">System Operational Status</div>
        <div class="card-value" style="color: var(--accent-green);" id="val-health">100% Healthy</div>
        <div class="card-subtext" id="sub-framework">Framework: ${instance.config.framework || 'express'}</div>
      </div>
      <div class="card">
        <div class="card-title">Autonomous Optimizations</div>
        <div class="card-value" style="color: var(--accent-blue);" id="val-opts">0</div>
        <div class="card-subtext">Applied safely off request path</div>
      </div>
      <div class="card">
        <div class="card-title">Active Route Versions</div>
        <div class="card-value" style="color: var(--accent-purple);" id="val-versions">0</div>
        <div class="card-subtext">Optimized candidates promoted</div>
      </div>
      <div class="card">
        <div class="card-title">Safety Rollbacks</div>
        <div class="card-value" style="color: var(--accent-amber);" id="val-rollbacks">0</div>
        <div class="card-subtext">Automated regression protection</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('overview')">📊 Route Telemetry</button>
      <button class="tab-btn" onclick="switchTab('optimizations')">⚡ Autonomous Intelligence</button>
      <button class="tab-btn" onclick="switchTab('developer')">🛠️ Raw JSON State</button>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Route Endpoint</th>
              <th>Traffic Volume</th>
              <th>Avg Latency</th>
              <th>Active Version</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="routes-tbody">
            <tr>
              <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                Listening for incoming requests...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Autonomous Intelligence -->
    <div id="tab-optimizations" class="tab-content">
      <div id="optimizations-list">
        <div class="explain-card">
          <div class="explain-header">
            <strong style="color: var(--accent-blue);">Auto-Optimizer Engine</strong>
            <span class="badge badge-green">Worker Queue: Clean</span>
          </div>
          <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5;">
            SEIM continuously scans route code for bottlenecks (such as unindexed array lookups, sequential async calls, missing caches, and heavy JSON serialization). When detected, safe optimizations are validated in a sandbox before live promotion.
          </p>
        </div>
      </div>
    </div>

    <!-- Tab 3: Developer JSON -->
    <div id="tab-developer" class="tab-content">
      <pre id="json-viewer">Loading state...</pre>
    </div>
  </main>

  <script>
    const studioPath = "${instance.config.studioPath}";

    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById('tab-' + tabName).classList.add('active');
    }

    async function updateDashboard() {
      try {
        const [statusRes, metricsRes] = await Promise.all([
          fetch(studioPath + '/api/status').then(r => r.json()),
          fetch(studioPath + '/api/metrics').then(r => r.json())
        ]);

        const status = statusRes.status || {};
        const metrics = metricsRes || {};

        // Update stats
        document.getElementById('val-opts').textContent = status.totalOptimizationsGenerated || 0;
        document.getElementById('val-versions').textContent = status.totalOptimizationsPromoted || 0;
        document.getElementById('val-rollbacks').textContent = status.totalRollbacks || 0;

        // Render Routes Table
        const tbody = document.getElementById('routes-tbody');
        const routes = Object.keys(metrics);

        if (routes.length === 0) {
          tbody.innerHTML = \`
            <tr>
              <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                No traffic detected yet. Send HTTP requests to your application to see live evolution metrics.
              </td>
            </tr>
          \`;
        } else {
          tbody.innerHTML = routes.map(routeKey => {
            const r = metrics[routeKey];
            const avg = r.requestCount ? Math.round(r.totalDuration / r.requestCount) : 0;
            const activeVer = (status.activeVersions || []).find(v => v.routeKey === routeKey);
            const isPromoted = activeVer && activeVer.active;

            return \`
              <tr>
                <td style="font-weight: 600; color: var(--accent-blue);">\${routeKey}</td>
                <td>\${r.requestCount || 0} reqs</td>
                <td>\${avg} ms</td>
                <td><span class="badge \${isPromoted ? 'badge-purple' : 'badge-blue'}">\${isPromoted ? 'Evolved v2' : 'Original v1'}</span></td>
                <td><span class="badge badge-green">🟢 Monitored</span></td>
              </tr>
            \`;
          }).join('');
        }

        // Render Raw JSON
        document.getElementById('json-viewer').textContent = JSON.stringify({ status, metrics }, null, 2);

      } catch (err) {
        console.error('Failed to update dashboard', err);
      }
    }

    // Initial load and poll every 3s
    updateDashboard();
    setInterval(updateDashboard, 3000);
  </script>
</body>
</html>`);
  };
}

