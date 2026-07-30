import * as fs from 'fs';
import * as path from 'path';

export async function applyCommand(args: string[]): Promise<void> {
  const dir = args[0] || '.seim-ci';
  const resolved = path.resolve(dir);

  if (!fs.existsSync(resolved)) {
    console.error(`CI/CD output directory not found: ${resolved}`);
    console.error('Run your app with CI/CD mode enabled first.');
    process.exit(1);
  }

  const files = fs.readdirSync(resolved).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No optimization files found.');
    return;
  }

  console.log(`Found ${files.length} optimization(s) in ${dir}`);
  console.log('');

  for (const file of files) {
    const filePath = path.join(resolved, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const opt = JSON.parse(raw);
      console.log(`  Route: ${opt.routeKey || 'unknown'}`);
      console.log(`  Pattern: ${opt.pattern || 'unknown'}`);
      console.log(`  Confidence: ${opt.confidence || 'N/A'}`);
      if (opt.optimizedCode) {
        console.log(`  Optimized code available (${opt.optimizedCode.length} chars)`);
      }
      console.log(`  File: ${file}`);
      console.log('');
    } catch (err) {
      console.error(`  Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('To apply these optimizations, integrate them into your deployment pipeline.');
  console.log('See documentation for CI/CD integration details.');
}
