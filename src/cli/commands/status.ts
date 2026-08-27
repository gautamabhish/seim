import * as http from 'http';
import * as https from 'https';

export async function statusCommand(args: string[]): Promise<void> {
  const baseUrl = (args[0] && !args[0].startsWith('--')) ? args[0] : 'http://localhost:3000';
  const studioPath = getArg(args, '--path') || '/seim';
  const statusUrl = `${baseUrl.replace(/\/$/, '')}${studioPath}/api/status`;

  console.log(`Fetching status from ${statusUrl}...`);

  try {
    const data = await fetchJson(statusUrl);
    console.log('');
    console.log('=== SEIM Status ===');
    console.log(`Mode:        ${data.mode || 'unknown'}`);
    console.log(`Framework:   ${data.framework || 'express'}`);
    console.log(`Uptime:      ${formatUptime(data.uptime || 0)}`);
    console.log(`Healthy:     ${data.healthy ? 'yes' : 'no'}`);
    console.log('');
    console.log('--- Optimizations ---');
    console.log(`Generated:   ${data.totalOptimizationsGenerated ?? 0}`);
    console.log(`Promoted:    ${data.totalOptimizationsPromoted ?? 0}`);
    console.log(`Rollbacks:   ${data.totalRollbacks ?? 0}`);
    console.log(`Shadow tests: ${data.activeShadowTests ?? 0}`);
    if (data.workerQueueSize !== undefined) {
      console.log(`Worker queue: ${data.workerQueueSize}`);
    }
    console.log('');
    if (data.activeVersions && data.activeVersions.length > 0) {
      console.log('--- Active Versions ---');
      for (const v of data.activeVersions) {
        console.log(`  ${v.routeKey}: ${v.active}`);
      }
    }
  } catch (err) {
    console.error(`Could not connect to ${statusUrl}`);
    console.error(`Make sure your app is running and seim is initialized.`);
    if (err instanceof Error) console.error(`  ${err.message}`);
  }
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
