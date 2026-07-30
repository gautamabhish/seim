import * as http from 'http';
import * as https from 'https';

export async function benchmarkCommand(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    console.error('Usage: seim benchmark <url> [--requests N] [--concurrency C]');
    process.exit(1);
  }

  const requests = parseInt(getArg(args, '--requests') || '100', 10);
  const concurrency = parseInt(getArg(args, '--concurrency') || '10', 10);

  console.log(`Benchmarking ${url}`);
  console.log(`  Requests: ${requests}, Concurrency: ${concurrency}`);
  console.log('');

  const results: number[] = [];
  const errors: number[] = [];
  const start = Date.now();

  const batches = Math.ceil(requests / concurrency);
  for (let b = 0; b < batches; b++) {
    const batchSize = Math.min(concurrency, requests - b * concurrency);
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      promises.push(makeRequest(url));
    }
    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      if (r.error) {
        errors.push(r.duration);
      } else {
        results.push(r.duration);
      }
    }
  }

  const totalTime = Date.now() - start;
  const sorted = results.sort((a, b) => a - b);

  console.log('=== Results ===');
  console.log(`Total time:  ${totalTime}ms`);
  console.log(`Successful:  ${results.length}/${requests}`);
  console.log(`Errors:      ${errors.length}`);
  console.log(`RPS:         ${Math.round((results.length / totalTime) * 1000)}`);
  console.log('');
  if (sorted.length > 0) {
    console.log('--- Latency ---');
    console.log(`  Min:       ${sorted[0].toFixed(1)}ms`);
    console.log(`  Avg:       ${(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)}ms`);
    console.log(`  p50:       ${percentile(sorted, 50).toFixed(1)}ms`);
    console.log(`  p95:       ${percentile(sorted, 95).toFixed(1)}ms`);
    console.log(`  p99:       ${percentile(sorted, 99).toFixed(1)}ms`);
    console.log(`  Max:       ${sorted[sorted.length - 1].toFixed(1)}ms`);
  }
}

function makeRequest(url: string): Promise<{ duration: number; statusCode: number; error: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      res.resume(); // drain
      res.on('end', () => {
        resolve({
          duration: Date.now() - start,
          statusCode: res.statusCode || 0,
          error: (res.statusCode || 0) >= 400,
        });
      });
    });
    req.on('error', () => {
      resolve({ duration: Date.now() - start, statusCode: 0, error: true });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ duration: Date.now() - start, statusCode: 0, error: true });
    });
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
