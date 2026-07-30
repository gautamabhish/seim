import { SeimConfig, OptimizationCandidate } from './types';

export class CiCdOptimizer {
  private outputDir: string;

  constructor(private config: SeimConfig) {
    this.outputDir = config.production?.ciCd?.outputDir ?? './.seim-cicd-output';
  }

  public async publish(routeKey: string, candidate: OptimizationCandidate, result?: any): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    await fs.mkdir(this.outputDir, { recursive: true });

    const safeKey = routeKey.replace(/[^a-zA-Z0-9-_]/g, '_');
    const dir = path.join(this.outputDir, safeKey);
    await fs.mkdir(dir, { recursive: true });

    const timestamp = new Date().toISOString();
    const metadata = {
      routeKey,
      candidateId: candidate.id,
      pattern: candidate.pattern,
      severity: candidate.severity,
      confidence: candidate.confidence,
      generatedAt: timestamp,
      shadowResult: result,
    };

    const filePrefix = `${candidate.id.replace(/[^a-zA-Z0-9-_]/g, '_')}`;

    await Promise.all([
      fs.writeFile(path.join(dir, `${filePrefix}.original.js`), candidate.originalCode || '', 'utf8'),
      fs.writeFile(path.join(dir, `${filePrefix}.optimized.js`), candidate.optimizedCode || '', 'utf8'),
      fs.writeFile(path.join(dir, `${filePrefix}.metadata.json`), JSON.stringify(metadata, null, 2), 'utf8'),
    ]);

    console.log(`[SEIM CI/CD] Wrote optimized candidate for ${routeKey} to ${dir}/${filePrefix}.optimized.js`);
  }
}
