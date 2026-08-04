// DOM Elements
const avgLatencyVal = document.getElementById('avg-latency-val');
const reqCountVal = document.getElementById('req-count-val');
const activeVerVal = document.getElementById('active-ver-val');
const activeHandlerName = document.getElementById('active-handler-name');
const shadowTestsVal = document.getElementById('shadow-tests-val');
const uptimeBadge = document.getElementById('uptime-badge');

const btnInjectDelay = document.getElementById('btn-inject-delay');
const btnRestoreFast = document.getElementById('btn-restore-fast');
const btnGenTraffic = document.getElementById('btn-gen-traffic');
const btnSingleReq = document.getElementById('btn-single-req');
const btnClearConsole = document.getElementById('btn-clear-console');

const trafficProgressBox = document.getElementById('traffic-progress-box');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');

const codeDisplay = document.getElementById('code-display');
const diffRemovedDisplay = document.getElementById('diff-removed-display');
const diffAddedDisplay = document.getElementById('diff-added-display');
const consoleOutput = document.getElementById('console-output');

const tabActiveCode = document.getElementById('tab-active-code');
const tabDiffView = document.getElementById('tab-diff-view');
const contentActiveCode = document.getElementById('content-active-code');
const contentDiffView = document.getElementById('content-diff-view');

const statCandidatesGen = document.getElementById('stat-candidates-gen');
const statPromotedCount = document.getElementById('stat-promoted-count');
const statWorkerQueue = document.getElementById('stat-worker-queue');

// State Cache
let activeTab = 'active'; // 'active' or 'diff'
let lastEventCount = 0;

// Source Code Templates
const FAST_HANDLER_SOURCE = `// GET /api/analytics/dashboard (fastHandler)
async function fastHandler(req, res) {
  // Baseline database aggregations
  const totalRevenue = global.users.reduce((sum, u) => sum + u.totalSpent, 0);
  const averageOrderValue = totalRevenue / global.users.reduce((sum, u) => sum + u.orders, 0);
  const topProducts = global.products
    .slice(0, 5)
    .map(p => ({ ...p, revenue: (p.id * 150) % 10000 }))
    .sort((a, b) => b.revenue - a.revenue);
  
  res.json({
    metrics: { totalRevenue, averageOrderValue, totalUsers: global.users.length },
    topProducts
  });
}`;

const SLOW_HANDLER_SOURCE = `// GET /api/analytics/dashboard (slowHandler)
async function slowHandler(req, res) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // ❌ ANTI-PATTERN: Sequential Async Delays
  await delay(600); // Wait 600ms
  await delay(600); // Wait another 600ms (Total 1200ms latency!)
  
  const totalRevenue = global.users.reduce((sum, u) => sum + u.totalSpent, 0);
  const averageOrderValue = totalRevenue / global.users.reduce((sum, u) => sum + u.orders, 0);
  const topProducts = global.products
    .slice(0, 5)
    .map(p => ({ ...p, revenue: (p.id * 150) % 10000 }))
    .sort((a, b) => b.revenue - a.revenue);
  
  res.json({
    metrics: { totalRevenue, averageOrderValue, totalUsers: global.users.length },
    topProducts
  });
}`;

const OPTIMIZED_HANDLER_SOURCE = `// GET /api/analytics/dashboard (optimizedHandler)
async function optimizedHandler(req, res) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // ✅ OPTIMIZED: Parallelized Async Waits via Promise.all
  await Promise.all([delay(600), delay(600)]); // Resolves concurrently in 600ms!
  
  const totalRevenue = global.users.reduce((sum, u) => sum + u.totalSpent, 0);
  const averageOrderValue = totalRevenue / global.users.reduce((sum, u) => sum + u.orders, 0);
  const topProducts = global.products
    .slice(0, 5)
    .map(p => ({ ...p, revenue: (p.id * 150) % 10000 }))
    .sort((a, b) => b.revenue - a.revenue);
  
  res.json({
    metrics: { totalRevenue, averageOrderValue, totalUsers: global.users.length },
    topProducts
  });
}`;

// Tabs Interactions
tabActiveCode.addEventListener('click', () => {
  tabActiveCode.classList.add('active');
  tabDiffView.classList.remove('active');
  contentActiveCode.style.display = 'block';
  contentDiffView.style.display = 'none';
  activeTab = 'active';
});

tabDiffView.addEventListener('click', () => {
  tabDiffView.classList.add('active');
  tabActiveCode.classList.remove('active');
  contentActiveCode.style.display = 'none';
  contentDiffView.style.display = 'block';
  activeTab = 'diff';
});

// Clear Console
btnClearConsole.addEventListener('click', () => {
  consoleOutput.innerHTML = '';
});

// Add console log lines
function addLogLine(text, type = 'system') {
  const line = document.createElement('div');
  line.className = `console-line event-${type}`;
  line.innerText = text;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Format milliseconds uptime to human readable
function formatUptime(seconds) {
  if (seconds < 60) return `Uptime: ${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `Uptime: ${mins}m ${secs}s`;
}

// 1. Controller Action: Inject Delay Anti-Pattern
btnInjectDelay.addEventListener('click', async () => {
  addLogLine(`[ACTION] Requesting server to inject sequential async delays...`);
  try {
    const res = await fetch('/api/seim/trigger-pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'sequential-async' })
    });
    const data = await res.json();
    addLogLine(`[SYSTEM] ${data.activeHandler}`, 'detected');
    fetchDashboardStatus();
  } catch (error) {
    addLogLine(`[ERROR] Injection failed: ${error.message}`, 'error');
  }
});

// 2. Controller Action: Reset to Baseline
btnRestoreFast.addEventListener('click', async () => {
  addLogLine(`[ACTION] Requesting server to restore fast baseline route...`);
  try {
    const res = await fetch('/api/seim/trigger-pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'restore-fast' })
    });
    const data = await res.json();
    addLogLine(`[SYSTEM] ${data.activeHandler}`, 'validated');
    fetchDashboardStatus();
  } catch (error) {
    addLogLine(`[ERROR] Restore failed: ${error.message}`, 'error');
  }
});

// 3. Controller Action: Send single dashboard request
btnSingleReq.addEventListener('click', async () => {
  addLogLine(`[LOAD] Sending single request to /api/analytics/dashboard...`);
  const start = Date.now();
  try {
    const res = await fetch('/api/analytics/dashboard');
    await res.json();
    const duration = Date.now() - start;
    addLogLine(`[HTTP GET] /api/analytics/dashboard resolved in ${duration}ms (status ${res.status})`);
  } catch (error) {
    addLogLine(`[HTTP ERROR] Request failed: ${error.message}`, 'error');
  }
});

// 4. Controller Action: Send 12 Load-test requests sequentially to trigger self-evolution lifecycle
btnGenTraffic.addEventListener('click', async () => {
  addLogLine(`[ACTION] Starting sequential load simulation of 12 requests...`, 'shadow');
  btnGenTraffic.disabled = true;
  btnSingleReq.disabled = true;
  trafficProgressBox.style.display = 'flex';
  
  for (let i = 0; i < 12; i++) {
    progressText.innerText = `${i + 1}/12`;
    progressFill.style.width = `${((i + 1) / 12) * 100}%`;
    
    const start = Date.now();
    try {
      const res = await fetch('/api/analytics/dashboard');
      await res.json();
      const duration = Date.now() - start;
      addLogLine(`[LOAD TEST] Request #${i + 1} completed in ${duration}ms`);
    } catch (e) {
      addLogLine(`[LOAD ERROR] Request #${i + 1} failed: ${e.message}`, 'error');
    }
    // Small delay between requests to allow background worker cycles to register
    await new Promise(r => setTimeout(r, 200));
  }
  
  trafficProgressBox.style.display = 'none';
  btnGenTraffic.disabled = false;
  btnSingleReq.disabled = false;
  addLogLine(`[ACTION] Load simulation finished. Check SEIM Telemetry logs for candidate analysis!`, 'validated');
});

// Fetch Status & Diagnostics
async function fetchDashboardStatus() {
  try {
    const res = await fetch('/api/seim/status');
    const data = await res.json();
    
    // Update Stats Display
    uptimeBadge.innerText = formatUptime(data.uptime);
    shadowTestsVal.innerText = data.activeShadowTests;
    statCandidatesGen.innerText = data.totalOptimizationsGenerated;
    statPromotedCount.innerText = data.totalOptimizationsPromoted;
    statWorkerQueue.innerText = data.workerQueueSize;
    
    // Check active version states
    const hasOptimized = data.activeVersions.find(v => v.routeKey === '/api/analytics/dashboard' && v.active === 'optimized');
    
    if (hasOptimized) {
      activeVerVal.innerText = 'Optimized';
      activeVerVal.className = 'stat-value text-glow-green';
      activeHandlerName.innerText = 'Handler: V2 (VM Sandbox)';
      codeDisplay.innerText = OPTIMIZED_HANDLER_SOURCE;
      
      // Update Diff Tab
      diffRemovedDisplay.innerText = SLOW_HANDLER_SOURCE;
      diffAddedDisplay.innerText = OPTIMIZED_HANDLER_SOURCE;
    } else if (data.activeHandler === 'slowHandler') {
      activeVerVal.innerText = 'Unoptimized';
      activeVerVal.className = 'stat-value text-glow-amber';
      activeHandlerName.innerText = 'Handler: slowHandler';
      codeDisplay.innerText = SLOW_HANDLER_SOURCE;
      
      diffRemovedDisplay.innerText = '// Run traffic to trigger optimization diff';
      diffAddedDisplay.innerText = '// Run traffic to trigger optimization diff';
    } else {
      activeVerVal.innerText = 'Baseline';
      activeVerVal.className = 'stat-value text-glow-blue';
      activeHandlerName.innerText = 'Handler: fastHandler';
      codeDisplay.innerText = FAST_HANDLER_SOURCE;
      
      diffRemovedDisplay.innerText = '// Run traffic to trigger optimization diff';
      diffAddedDisplay.innerText = '// Run traffic to trigger optimization diff';
    }
  } catch (error) {
    console.error('Failed to fetch status:', error);
  }
}

// Fetch Metrics Telemetry
async function fetchMetrics() {
  try {
    const res = await fetch('/api/seim/metrics');
    const data = await res.json();
    const routeKey = '/api/analytics/dashboard';
    
    const dashboardMetrics = data.routes[routeKey];
    if (dashboardMetrics) {
      const avg = Math.round(dashboardMetrics.totalDuration / dashboardMetrics.requestCount);
      avgLatencyVal.innerText = `${avg}ms`;
      reqCountVal.innerText = dashboardMetrics.requestCount;
      
      if (avg > 1000) {
        avgLatencyVal.className = 'stat-value text-glow-amber';
      } else if (avg < 800 && avg > 100) {
        avgLatencyVal.className = 'stat-value text-glow-green';
      } else {
        avgLatencyVal.className = 'stat-value text-glow-blue';
      }
    } else {
      avgLatencyVal.innerText = '0ms';
      avgLatencyVal.className = 'stat-value text-glow-blue';
      reqCountVal.innerText = '0';
    }
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
  }
}

// Fetch Event telemetry log stream
async function fetchEventLogs() {
  try {
    const res = await fetch('/api/seim/events');
    const logs = await res.json();
    
    if (logs.length > lastEventCount) {
      // Append new event lines
      const newLogs = logs.slice(lastEventCount);
      newLogs.forEach(log => {
        let msg = `[${log.timestamp}] [${log.event.toUpperCase()}] `;
        let type = 'system';
        
        switch (log.event) {
          case 'optimization:detected':
            msg += `Candidate optimization pattern detected on "${log.payload.routeKey}" (Pattern: ${log.payload.pattern})`;
            type = 'detected';
            break;
          case 'optimization:validated':
            msg += `Optimization candidate "${log.payload.candidateId}" validation result: Overall Pass = ${log.payload.report.overall}`;
            type = 'validated';
            break;
          case 'optimization:promoted':
            msg += `PROMOTED route "${log.payload.routeKey}" to VM sandbox (Latency saved: ${Math.round(log.payload.latencyImprovement)}ms!)`;
            type = 'promoted';
            break;
          case 'optimization:rejected':
            msg += `Rejected candidate for "${log.payload.routeKey}". Reason: ${log.payload.reason}`;
            type = 'error';
            break;
          case 'shadow:started':
            msg += `Initiated canary shadow tests on candidate "${log.payload.candidateId}"...`;
            type = 'shadow';
            break;
          case 'shadow:completed':
            msg += `Shadow test finished. V1 = ${Math.round(log.payload.v1Latency)}ms, V2 = ${Math.round(log.payload.v2Latency)}ms. Net speedup: ${Math.round(log.payload.improvement)}ms`;
            type = 'shadow';
            break;
          default:
            msg += JSON.stringify(log.payload);
        }
        addLogLine(msg, type);
      });
      lastEventCount = logs.length;
    }
  } catch (error) {
    console.error('Failed to fetch events:', error);
  }
}

// Initial Telemetry Poll loop
fetchDashboardStatus();
fetchMetrics();
fetchEventLogs();

setInterval(fetchDashboardStatus, 1500);
setInterval(fetchMetrics, 1500);
setInterval(fetchEventLogs, 1000);
