import * as fs from 'fs';
import * as path from 'path';

export async function initCommand(_args: string[]): Promise<void> {
  const target = path.join(process.cwd(), '.seimrc.json');
  if (fs.existsSync(target)) {
    console.log('.seimrc.json already exists. Skipping.');
    return;
  }

  const config = {
    mode: 'bypass',
    framework: 'express',
    logging: {
      level: 'info',
      json: false,
    },
    experiment: {
      canaryPercent: 5,
      shadowCooldownMs: 60000,
      shadowSampleSize: 25,
      sandboxTimeoutMs: 500,
    },
    worker: {
      enabled: true,
      intervalMs: 10000,
    },
    ai: {
      enabled: false,
    },
    autoMiddleware: {
      etag: true,
      compression: true,
      caching: true,
    },
  };

  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n');
  console.log('Created .seimrc.json');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Install seim: npm install seim');
  console.log('  2. Add to your app:');
  console.log('');
  console.log("     const seim = require('seim').default;");
  console.log('     const s = seim();');
  console.log('     app.use(s.listener());');
  console.log('');
  console.log('  3. Set mode to "bypass" to enable autonomous optimization');
}
