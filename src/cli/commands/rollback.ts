import * as http from 'http';
import * as https from 'https';

export async function rollbackCommand(args: string[]): Promise<void> {
  const route = (args[0] && !args[0].startsWith('--')) ? args[0] : undefined;
  if (!route) {
    console.error('Usage: seim rollback <route> [--url baseUrl] [--path studioPath]');
    process.exit(1);
  }

  const baseUrl = getArg(args, '--url') || 'http://localhost:3000';
  const studioPath = getArg(args, '--path') || '/seim';
  const rollbackUrl = `${baseUrl.replace(/\/$/, '')}${studioPath}/api/rollback`;

  console.log(`Requesting rollback for route: ${route}`);
  console.log(`Sending to: ${rollbackUrl}`);

  try {
    const body = JSON.stringify({ action: 'rollback', routeKey: route });
    const data = await postJson(rollbackUrl, body);
    if (data.success) {
      console.log('Rollback successful.');
    } else {
      console.log(`Rollback response: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error(`Failed to rollback: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function postJson(url: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
