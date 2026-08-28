import { Request, Response, RequestHandler } from 'express';
import { SeimInstance } from './types';

// Internal event ring-buffer per studio handler
const studioEventLog: Array<{ ts: number; event: string; payload: any }> = [];
const MAX_EVENTS = 100;

/** Push an event into the studio event ring buffer (called from index.ts) */
export function pushStudioEvent(event: string, payload: any): void {
  studioEventLog.push({ ts: Date.now(), event, payload });
  if (studioEventLog.length > MAX_EVENTS) studioEventLog.shift();
}

/**
 * Create a studio dashboard handler.
 *
 * IMPORTANT: The returned handler closes over the `instance` object by reference.
 * As long as the caller mutates the same object (not reassigns), all API endpoints
 * will automatically see the fully-initialised instance — even if `app.use()` was
 * called before `index.ts` finished wiring everything in.
 */
export function createStudioHandler(instance: SeimInstance): RequestHandler {
  return (req: Request, res: Response): void => {
    const p = req.path || req.url || '';
    if (p.endsWith('/api/status') || p.endsWith('/status')) {
      const statusData = instance && typeof instance.status === 'function' ? instance.status() : {};
      res.json({ ok: true, status: statusData, ...statusData });
      return;
    }
    if (p.endsWith('/api/metrics') || p.endsWith('/metrics')) {
      res.json(instance?.metrics ? instance.metrics.snapshot() : {});
      return;
    }
    if (p.endsWith('/api/candidates')) {
      // listAll() is async — must await
      const store = instance?.candidateStore;
      if (!store) { res.json([]); return; }
      Promise.resolve(store.listAll ? store.listAll() : []).then((list: any[]) => {
        res.json(list);
      }).catch(() => res.json([]));
      return;
    }
    if (p.endsWith('/api/behavior')) {
      const snapshot = instance?.behaviorTracker ? instance.behaviorTracker.snapshot() : {};
      const components = instance?.reactRegistry ? instance.reactRegistry.listAll() : [];
      res.json({ ...snapshot, components });
      return;
    }
    if (p.endsWith('/api/changelog')) {
      const entries = instance?.changelog ? instance.changelog.getRecent(100) : [];
      res.json(entries);
      return;
    }
    if (p.endsWith('/api/issues')) {
      const openIssues = instance?.issueStream ? instance.issueStream.getOpenIssues() : [];
      const allIssues = instance?.issueStream ? instance.issueStream.getAllIssues() : [];
      res.json({ open: openIssues, all: allIssues });
      return;
    }
    if (p.endsWith('/api/evolve-issue') && req.method === 'POST') {
      const body = req.body || {};
      const issueId = body.issueId;
      if (instance?.orchestrator && instance?.issueStream && issueId) {
        const issue = instance.issueStream.getAllIssues().find((i: any) => i.id === issueId);
        if (issue) {
          instance.orchestrator.handleIssue(issue).then((ok: boolean) => {
            res.json({ success: ok, message: ok ? 'Issue evolved & deployed successfully' : 'Evolution could not be completed' });
          }).catch((err: any) => {
            res.status(500).json({ success: false, error: err.message });
          });
          return;
        }
      }
      res.status(400).json({ success: false, error: 'Issue not found or orchestrator unavailable' });
      return;
    }
    if (p.endsWith('/api/dismiss-issue') && req.method === 'POST') {
      const body = req.body || {};
      const issueId = body.issueId;
      if (instance?.issueStream && issueId) {
        instance.issueStream.dismissIssue(issueId);
        res.json({ success: true, message: 'Issue dismissed' });
        return;
      }
      res.status(400).json({ success: false, error: 'issueId required' });
      return;
    }
    if (p.endsWith('/api/events')) {
      res.json(studioEventLog);
      return;
    }
    if (p.endsWith('/api/rollback') || p.endsWith('/rollback')) {
      if (req.method === 'POST') {
        const body = req.body || {};
        const routeKey = body.routeKey || body.route;
        const reason = body.reason || 'Manual rollback via CLI/API';
        if (!routeKey) {
          res.status(400).json({ success: false, error: 'routeKey is required' });
          return;
        }
        let success = false;
        if (instance?.dispatcher) {
          success = instance.dispatcher.rollback(routeKey, reason);
        } else if (instance?.dynamicRouter) {
          instance.dynamicRouter.swapHandler(routeKey, null as any, 'optimized');
          success = true;
        }
        res.json({ success, routeKey, message: success ? 'Rollback successful' : 'Route not found or rollback failed' });
        return;
      }
    }
    if (p.endsWith('/api/promote') && req.method === 'POST') {
      const body = req.body || {};
      const routeKey = body.routeKey || body.route;
      let success = false;
      if (instance?.dispatcher && routeKey) {
        success = instance.dispatcher.promote(routeKey);
      }
      res.json({ success, routeKey, message: success ? 'Candidate promoted to production' : 'Promotion failed' });
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
      <button class="tab-btn active" onclick="switchTab('shipped')">🚀 Shipped Evolution</button>
      <button class="tab-btn" onclick="switchTab('issues')">🔍 Issue Stream</button>
      <button class="tab-btn" onclick="switchTab('overview')">📊 Route Telemetry</button>
      <button class="tab-btn" onclick="switchTab('optimizations')">🧬 Candidates & Diffs</button>
      <button class="tab-btn" onclick="switchTab('behavior')">🧠 Visitor Behavior & React</button>
      <button class="tab-btn" onclick="switchTab('events')">⚡ Live Events</button>
      <button class="tab-btn" onclick="switchTab('developer')">🛠️ Raw JSON State</button>
    </div>

    <!-- Tab 0: Shipped Evolution (Timeline) -->
    <div id="tab-shipped" class="tab-content active">
      <div class="explain-card">
        <div class="explain-header">
          <strong style="color: var(--accent-green);">🚀 Product Evolution Timeline (Shipped Automatically)</strong>
          <span class="badge badge-green" id="shipped-count-badge">0 Changes Shipped</span>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
          Continuous changelog of autonomous features, runtime bug fixes, UX refinements, and performance upgrades shipped to production by SEIM.
        </p>
        <div id="changelog-list" style="display: flex; flex-direction: column; gap: 0.85rem;">
          <div style="color: var(--text-muted); font-size: 0.85rem;">No autonomous changes shipped yet. Real-time visitor activity will trigger evolution.</div>
        </div>
      </div>
    </div>

    <!-- Tab 0.5: Issue Stream -->
    <div id="tab-issues" class="tab-content">
      <div class="explain-card">
        <div class="explain-header">
          <strong style="color: var(--accent-amber);">🔍 Detected Product Issues & Feature Opportunities</strong>
          <span class="badge badge-amber" id="issues-count-badge">0 Open Issues</span>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
          Real-time stream of 5xx runtime bugs, missing API 404s, user drop-offs, and circular navigation loops detected across user sessions.
        </p>
        <div id="issues-list" style="display: flex; flex-direction: column; gap: 0.85rem;">
          <div style="color: var(--text-muted); font-size: 0.85rem;">No open issues detected across active visitor sessions.</div>
        </div>
      </div>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Route Endpoint</th>
              <th>Traffic Volume</th>
              <th>Avg Latency</th>
              <th>Active Version</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="routes-tbody">
            <tr>
              <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                Listening for incoming requests...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Candidate Diffs -->
    <div id="tab-optimizations" class="tab-content">
      <div id="candidates-container">
        <div class="explain-card">
          <div class="explain-header">
            <strong style="color: var(--accent-blue);">Evolution & Sandboxed Candidates</strong>
            <span class="badge badge-green" id="candidate-count-badge">0 Candidates</span>
          </div>
          <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
            SEIM continuously scans route code for optimization opportunities (e.g., N+1 queries, unindexed finds, sequential async calls, and missing caches). Inspect diffs and control promotions below.
          </p>
          <div id="candidates-list" style="display: grid; gap: 1rem;">
            <div style="color: var(--text-muted); font-size: 0.85rem;">No active evolution candidates in storage.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 3: Visitor Behavior & React -->
    <div id="tab-behavior" class="tab-content">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
        <div class="card">
          <div class="card-title">Discovered Feature Opportunities (404s & Hot Paths)</div>
          <div id="behavior-patterns" style="margin-top: 1rem; display: grid; gap: 0.75rem; font-size: 0.85rem;">
            <div style="color: var(--text-muted);">Tracking user journeys...</div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Scaffolded React Frontend Components</div>
          <div id="react-components-list" style="margin-top: 1rem; display: grid; gap: 0.75rem; font-size: 0.85rem;">
            <div style="color: var(--text-muted);">No autonomous frontend components scaffolded yet.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 4: Live Events -->
    <div id="tab-events" class="tab-content">
      <div class="explain-card">
        <div class="explain-header">
          <strong style="color: var(--accent-green);">Live Optimization & Lifecycle Events</strong>
          <span class="badge badge-green" id="events-count-badge">0 Events</span>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
          Real-time stream of SEIM lifecycle events — optimization detections, promotions, rollbacks, feature discoveries, and errors.
          Events are kept in a ring buffer (last 100).
        </p>
        <div id="events-log" style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.82rem; font-family: monospace; max-height: 400px; overflow-y: auto;">
          <div style="color: var(--text-muted);">Waiting for events...</div>
        </div>
      </div>
    </div>

    <!-- Tab 5: Developer JSON -->
    <div id="tab-developer" class="tab-content">
      <pre id="json-viewer">Loading state...</pre>
    </div>
  </main>

  <!-- Diff Viewer Modal -->
  <div id="diff-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 100; align-items: center; justify-content: center; padding: 2rem;">
    <div style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.75rem; width: 100%; max-width: 900px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;">
      <div style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center;">
        <h3 id="diff-modal-title" style="font-size: 1.1rem; color: var(--accent-blue); font-weight: 600;">Candidate Code Diff</h3>
        <button onclick="closeDiffModal()" style="background: transparent; border: none; color: var(--text-muted); font-size: 1.25rem; cursor: pointer;">&times;</button>
      </div>
      <div id="diff-modal-body" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
        <pre id="diff-code-view" style="color: #10b981; white-space: pre-wrap; font-size: 0.85rem;"></pre>
      </div>
      <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--card-border); display: flex; justify-content: flex-end; gap: 0.75rem;">
        <button onclick="closeDiffModal()" style="padding: 0.5rem 1rem; background: var(--card-border); border: none; border-radius: 0.375rem; color: var(--text-main); cursor: pointer;">Close</button>
      </div>
    </div>
  </div>

  <script>
    const studioPath = "${instance.config.studioPath || '/seim'}";
    let currentCandidates = [];

    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById('tab-' + tabName).classList.add('active');
    }

    function openDiffModal(title, code) {
      document.getElementById('diff-modal-title').textContent = title;
      document.getElementById('diff-code-view').textContent = code;
      document.getElementById('diff-modal').style.display = 'flex';
    }

    function closeDiffModal() {
      document.getElementById('diff-modal').style.display = 'none';
    }

    async function triggerRollback(routeKey) {
      if (!confirm('Are you sure you want to rollback ' + routeKey + ' to original handler?')) return;
      try {
        const res = await fetch(studioPath + '/api/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeKey, reason: 'Manual studio action' })
        }).then(r => r.json());
        alert(res.message || (res.success ? 'Rollback completed!' : 'Rollback failed'));
        updateDashboard();
      } catch (err) {
        alert('Rollback error: ' + err.message);
      }
    }

    async function triggerPromote(routeKey) {
      if (!confirm('Promote candidate for ' + routeKey + ' to 100% production traffic?')) return;
      try {
        const res = await fetch(studioPath + '/api/promote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeKey })
        }).then(r => r.json());
        alert(res.message || (res.success ? 'Candidate promoted!' : 'Promotion failed'));
        updateDashboard();
      } catch (err) {
        alert('Promote error: ' + err.message);
      }
    }

    async function triggerEvolveIssue(issueId) {
      try {
        const res = await fetch(studioPath + '/api/evolve-issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId })
        }).then(r => r.json());
        alert(res.message || (res.success ? 'Evolution started/completed!' : 'Evolution failed: ' + res.error));
        updateDashboard();
      } catch (err) {
        alert('Evolve error: ' + err.message);
      }
    }

    async function triggerDismissIssue(issueId) {
      try {
        const res = await fetch(studioPath + '/api/dismiss-issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId })
        }).then(r => r.json());
        updateDashboard();
      } catch (err) {
        alert('Dismiss error: ' + err.message);
      }
    }

    async function updateDashboard() {
      try {
        const [statusRes, metricsRes, candidatesRes, behaviorRes, eventsRes, changelogRes, issuesRes] = await Promise.all([
          fetch(studioPath + '/api/status').then(r => r.json()).catch(() => ({})),
          fetch(studioPath + '/api/metrics').then(r => r.json()).catch(() => ({})),
          fetch(studioPath + '/api/candidates').then(r => r.json()).catch(() => ([])),
          fetch(studioPath + '/api/behavior').then(r => r.json()).catch(() => ({})),
          fetch(studioPath + '/api/events').then(r => r.json()).catch(() => ([])),
          fetch(studioPath + '/api/changelog').then(r => r.json()).catch(() => ([])),
          fetch(studioPath + '/api/issues').then(r => r.json()).catch(() => ({ open: [], all: [] }))
        ]);

        const status = statusRes.status || statusRes || {};
        const metrics = metricsRes || {};
        currentCandidates = candidatesRes || [];
        const behavior = behaviorRes || {};
        const events = Array.isArray(eventsRes) ? eventsRes : [];
        const changelog = Array.isArray(changelogRes) ? changelogRes : [];
        const openIssues = issuesRes.open || [];

        // Update stats
        document.getElementById('val-opts').textContent = status.totalOptimizationsGenerated || 0;
        document.getElementById('val-versions').textContent = status.totalOptimizationsPromoted || 0;
        document.getElementById('val-rollbacks').textContent = status.totalRollbacks || 0;
        document.getElementById('candidate-count-badge').textContent = currentCandidates.length + ' Candidates';
        document.getElementById('events-count-badge').textContent = events.length + ' Events';
        document.getElementById('shipped-count-badge').textContent = changelog.length + ' Changes Shipped';
        document.getElementById('issues-count-badge').textContent = openIssues.length + ' Open Issues';

        // 1. Render Shipped Evolution Timeline
        const changelogContainer = document.getElementById('changelog-list');
        if (changelog.length === 0) {
          changelogContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No autonomous changes shipped yet. Real-time visitor activity will trigger evolution.</div>';
        } else {
          const typeColors = {
            'new_feature': '#10b981',
            'optimization': '#38bdf8',
            'bug_fix': '#a855f7',
            'ux_improvement': '#f59e0b',
            'rollback': '#f43f5e',
          };
          changelogContainer.innerHTML = changelog.map(item => {
            const color = typeColors[item.type] || '#9ca3af';
            const time = new Date(item.shippedAt).toLocaleString();
            const isLive = item.status === 'live';
            const hasCode = !!(item.code || item.diff);

            return \`
              <div style="padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem; border-left: 4px solid \${color}; border-top: 1px solid var(--card-border); border-right: 1px solid var(--card-border); border-bottom: 1px solid var(--card-border);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 700; color: \${color}; font-size: 0.95rem;">\${item.title}</span>
                    <span class="badge \${isLive ? 'badge-green' : 'badge-blue'}">\${isLive ? '🟢 Live in Production' : '↩️ Rolled Back'}</span>
                  </div>
                  <span style="color: var(--text-muted); font-size: 0.75rem;">\${time}</span>
                </div>
                <div style="color: var(--text-main); font-size: 0.85rem; line-height: 1.4; margin-bottom: 0.5rem;">\${item.description}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-muted);">
                  <span>Path: <code style="color: var(--accent-blue);">\${item.path}</code> \${item.affectedSessions ? '• Affected: ' + item.affectedSessions + ' sessions' : ''}</span>
                  <div style="display: flex; gap: 0.5rem;">
                    \${hasCode ? \`<button onclick="openDiffModal('Code: \${item.title}', decodeURIComponent('\${encodeURIComponent(item.code || item.diff || '')}'))" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; background: var(--card-border); border: none; color: var(--text-main); border-radius: 0.25rem; cursor: pointer;">View Code</button>\` : ''}
                    \${isLive ? \`<button onclick="triggerRollback('\${item.path}')" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; background: rgba(244, 63, 94, 0.2); border: 1px solid var(--accent-rose); color: var(--accent-rose); border-radius: 0.25rem; cursor: pointer;">Rollback</button>\` : ''}
                  </div>
                </div>
              </div>
            \`;
          }).join('');
        }

        // 2. Render Open Issues Stream
        const issuesContainer = document.getElementById('issues-list');
        if (openIssues.length === 0) {
          issuesContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No open issues detected across active visitor sessions. All systems healthy.</div>';
        } else {
          issuesContainer.innerHTML = openIssues.map(iss => {
            const isCrit = iss.severity === 'critical' || iss.severity === 'high';
            const sevColor = isCrit ? 'var(--accent-rose)' : 'var(--accent-amber)';

            return \`
              <div style="padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem; border: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <span style="font-weight: 600; color: \${sevColor}; font-size: 0.9rem;">[\${iss.type.toUpperCase()}] \${iss.path}</span>
                    <span class="badge \${isCrit ? 'badge-blue' : 'badge-amber'}">\${iss.severity}</span>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">\${iss.affectedSessions} sessions affected</span>
                  </div>
                  <div style="color: var(--text-main); font-size: 0.85rem;">\${iss.suggestedAction}</div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                  <button onclick="triggerEvolveIssue('\${iss.id}')" style="padding: 0.35rem 0.8rem; font-size: 0.8rem; background: rgba(16, 185, 129, 0.2); border: 1px solid var(--accent-green); color: var(--accent-green); border-radius: 0.375rem; cursor: pointer; font-weight: 600;">⚡ Evolve Now</button>
                  <button onclick="triggerDismissIssue('\${iss.id}')" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; background: var(--card-border); border: none; color: var(--text-muted); border-radius: 0.375rem; cursor: pointer;">Dismiss</button>
                </div>
              </div>
            \`;
          }).join('');
        }

        // Render Routes Table
        const tbody = document.getElementById('routes-tbody');
        const routes = Object.keys(metrics.routes || metrics);

        if (routes.length === 0) {
          tbody.innerHTML = \`
            <tr>
              <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                No traffic detected yet. Send HTTP requests to your application to see live evolution metrics.
              </td>
            </tr>
          \`;
        } else {
          tbody.innerHTML = routes.map(routeKey => {
            const r = (metrics.routes || metrics)[routeKey];
            const avg = r.requestCount ? Math.round(r.totalDuration / r.requestCount) : 0;
            const activeVer = (status.activeVersions || []).find(v => v.routeKey === routeKey);
            const isPromoted = activeVer && activeVer.active === 'optimized';

            return \`
              <tr>
                <td style="font-weight: 600; color: var(--accent-blue);">\${routeKey}</td>
                <td>\${r.requestCount || 0} reqs</td>
                <td>\${avg} ms</td>
                <td><span class="badge \${isPromoted ? 'badge-purple' : 'badge-blue'}">\${isPromoted ? '🧬 Evolved' : '📌 Original'}</span></td>
                <td><span class="badge badge-green">🟢 Active</span></td>
                <td>
                  <button onclick="triggerPromote('\${routeKey}')" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; background: rgba(168, 85, 247, 0.2); border: 1px solid var(--accent-purple); color: var(--accent-purple); border-radius: 0.25rem; cursor: pointer; margin-right: 0.4rem;">Promote</button>
                  <button onclick="triggerRollback('\${routeKey}')" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; background: rgba(244, 63, 94, 0.2); border: 1px solid var(--accent-rose); color: var(--accent-rose); border-radius: 0.25rem; cursor: pointer;">Rollback</button>
                </td>
              </tr>
            \`;
          }).join('');
        }

        // Render Behavior & React
        const patternsContainer = document.getElementById('behavior-patterns');
        const patterns = behavior.patterns || [];
        if (patterns.length === 0) {
          patternsContainer.innerHTML = '<div style="color: var(--text-muted);">No anomalous visitor patterns detected yet (minimum threshold not reached).</div>';
        } else {
          patternsContainer.innerHTML = patterns.map(p => \`
            <div style="padding: 0.75rem; background: var(--bg-dark); border-radius: 0.375rem; border: 1px solid var(--card-border);">
              <div style="display: flex; justify-content: space-between; font-weight: 600; color: var(--accent-amber);">
                <span>Type: \${p.type}</span>
                <span>Hits: \${p.frequency}</span>
              </div>
              <div style="margin-top: 0.25rem; color: var(--text-main);">Path: <code>\${p.path}</code></div>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.25rem;">Affected Sessions: \${p.affectedSessions}</div>
            </div>
          \`).join('');
        }

        const reactContainer = document.getElementById('react-components-list');
        const components = behavior.components || [];
        if (components.length === 0) {
          reactContainer.innerHTML = '<div style="color: var(--text-muted);">No React frontend components scaffolded yet.</div>';
        } else {
          reactContainer.innerHTML = components.map(c => \`
            <div style="padding: 0.75rem; background: var(--bg-dark); border-radius: 0.375rem; border: 1px solid var(--card-border);">
              <div style="display: flex; justify-content: space-between; font-weight: 600; color: var(--accent-blue);">
                <span>\${c.name}</span>
                <span class="badge badge-purple">v\${c.version}</span>
              </div>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.25rem;">Route: \${c.routePath || 'Component only'}</div>
              <button onclick="openDiffModal('React Component: \${c.name}', decodeURIComponent('\${encodeURIComponent(c.code)}'))" style="margin-top: 0.5rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; background: var(--card-border); border: none; color: var(--text-main); border-radius: 0.25rem; cursor: pointer;">View TSX Source</button>
            </div>
          \`).join('');
        }

        // Render Live Events
        const eventsLog = document.getElementById('events-log');
        if (events.length === 0) {
          eventsLog.innerHTML = '<div style="color: var(--text-muted);">Waiting for events... (events appear as SEIM detects optimization opportunities, promotes candidates, or encounters errors)</div>';
        } else {
          const eventColors = {
            'optimization:detected': '#f59e0b',
            'optimization:promoted': '#10b981',
            'optimization:rejected': '#f43f5e',
            'optimization:rolledback': '#f43f5e',
            'feature:discovered': '#a855f7',
            'feature:deployed': '#10b981',
            'frontend:component_generated': '#38bdf8',
            'frontend:evolved': '#38bdf8',
            'issue:detected': '#f59e0b',
            'issue:resolved': '#10b981',
            'metrics:threshold': '#f59e0b',
            'error:sandbox': '#f43f5e',
            'error:validation': '#f43f5e',
            'lifecycle:started': '#10b981',
          };
          eventsLog.innerHTML = [...events].reverse().map(e => {
            const color = eventColors[e.event] || '#9ca3af';
            const time = new Date(e.ts).toLocaleTimeString();
            return \`
              <div style="padding: 0.5rem 0.75rem; background: var(--bg-dark); border-radius: 0.375rem; border-left: 3px solid \${color}; display: flex; gap: 0.75rem; align-items: flex-start;">
                <span style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; padding-top: 1px;">\${time}</span>
                <div style="flex: 1; min-width: 0;">
                  <span style="color: \${color}; font-weight: 600;">\${e.event}</span>
                  <span style="color: var(--text-muted); margin-left: 0.5rem; font-size: 0.78rem;">\${e.payload?.routeKey || e.payload?.path || e.payload?.title || ''}</span>
                </div>
              </div>
            \`;
          }).join('');
        }

        // Render Raw JSON
        document.getElementById('json-viewer').textContent = JSON.stringify({ status, metrics, behavior, changelog: changelog.slice(0, 20), openIssues, recentEvents: events.slice(-20) }, null, 2);

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

