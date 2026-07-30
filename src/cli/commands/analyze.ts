import * as fs from 'fs';
import * as path from 'path';

// Pattern definitions matching the optimization engine
const PATTERNS = [
  { name: 'sequential-async', regex: /for\s*\([^)]*\)\s*\{[^}]*await\s/s, severity: 'high', description: 'Sequential async calls in loop — use Promise.all for parallel execution' },
  { name: 'n-plus-one', regex: /forEach\s*\([^)]*\)\s*\{[^}]*await\s/s, severity: 'high', description: 'N+1 query pattern — batch operations instead' },
  { name: 'missing-cache', regex: /await\s+\w+\.(find|get|fetch|query)\s*\(/s, severity: 'medium', description: 'Repeated DB/API call without caching' },
  { name: 'inefficient-loop', regex: /for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length/, severity: 'low', description: 'C-style for loop — use for...of or array methods' },
  { name: 'redundant-serialization', regex: /JSON\.parse\s*\(\s*JSON\.stringify/, severity: 'medium', description: 'Redundant JSON round-trip — use structuredClone()' },
  { name: 'blocking-op', regex: /(readFileSync|writeFileSync|execSync)/, severity: 'critical', description: 'Blocking I/O on event loop — use async alternative' },
  { name: 'nested-ternary', regex: /\?\s*[^:]+\?\s*[^:]+:/, severity: 'low', description: 'Nested ternary — consider if/else for readability' },
  { name: 'unindexed-find', regex: /\.find\s*\(\s*\w+\s*=>/, severity: 'low', description: 'Linear search with .find() — use Map for O(1) lookup' },
  { name: 'response-streaming', regex: /res\.json\s*\(\s*(?:await\s+)?.*\.map\s*\(/, severity: 'medium', description: 'Large mapped array in response — consider streaming' },
];

export async function analyzeCommand(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: seim analyze <file>');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const source = fs.readFileSync(resolved, 'utf-8');
  console.log(`Analyzing ${path.basename(resolved)}...`);
  console.log('');

  let found = 0;
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(source);
    if (match) {
      found++;
      const line = source.slice(0, match.index).split('\n').length;
      const severity = pattern.severity.toUpperCase().padEnd(8);
      console.log(`  [${severity}] ${pattern.name} (line ${line})`);
      console.log(`            ${pattern.description}`);
      console.log('');
    }
  }

  if (found === 0) {
    console.log('  No optimization patterns detected.');
  } else {
    console.log(`Found ${found} optimization ${found === 1 ? 'opportunity' : 'opportunities'}.`);
  }
}
