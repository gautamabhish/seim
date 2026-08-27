import * as fs from 'fs';
import * as path from 'path';

export async function applyCommand(args: string[]): Promise<void> {
  const dir = (args[0] && !args[0].startsWith('--')) ? args[0] : '.seim-ci';
  const shouldWrite = args.includes('--write') || args.includes('-w');
  const outDir = getArg(args, '--out') || path.join(dir, 'applied');
  const resolved = path.resolve(dir);

  if (!fs.existsSync(resolved)) {
    console.error(`CI/CD output directory not found: ${resolved}`);
    console.error('Run your app with CI/CD mode enabled first.');
    process.exit(1);
  }

  const files = fs.readdirSync(resolved).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No optimization files found in ' + dir);
    return;
  }

  console.log(`Found ${files.length} optimization candidate(s) in ${dir}`);
  console.log('');

  if (shouldWrite && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let appliedCount = 0;
  for (const file of files) {
    const filePath = path.join(resolved, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const opt = JSON.parse(raw);
      console.log(`[Candidate] Route: ${opt.routeKey || 'unknown'} | Pattern: ${opt.pattern || 'unknown'} | Score: ${opt.confidence ?? 'N/A'}`);
      
      if (opt.optimizedCode) {
        if (shouldWrite) {
          const safeName = (opt.routeKey || file.replace('.json', '')).replace(/[^a-zA-Z0-9_-]/g, '_');
          const targetFile = path.join(outDir, `${safeName}.optimized.js`);
          fs.writeFileSync(targetFile, opt.optimizedCode, 'utf-8');
          console.log(`  ✓ Applied: Written to ${targetFile}`);
          appliedCount++;
        } else {
          console.log(`  Code length: ${opt.optimizedCode.length} chars (pass --write to emit to disk)`);
        }
      }
      console.log('');
    } catch (err) {
      console.error(`  Failed to process ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (shouldWrite) {
    console.log(`\nSuccessfully applied and emitted ${appliedCount} optimized handler(s) to ${outDir}`);
  } else {
    console.log('Run `seim apply --write` to write optimized handlers to disk for CI/CD deployment.');
  }
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
