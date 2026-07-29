import { OptimizationCandidate, SeimConfig } from './types';
import { LLMClient } from './ai';

export class OptimizationEngine {
  private patterns = [
    { id: 'sequential-async', regex: /const\s+\w+\s*=\s*await\s+[^;]+;\s*\n\s*const\s+\w+\s*=\s*await\s+[^;]+;/, severity: 'high' as const },
    { id: 'n-plus-one', regex: /for\s*\([^)]*\)\s*\{[^}]*await\s+[^}]*\}/, severity: 'critical' as const },
    { id: 'missing-cache', regex: /await\s+get[^\(]*\([^\)]*\)(?!.*cache)/, severity: 'medium' as const },
    { id: 'inefficient-loop', regex: /for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*\w+\.length;\s*i\+\+\s*\)/, severity: 'low' as const },
    { id: 'redundant-serialization', regex: /JSON\.parse\(JSON\.stringify\(/, severity: 'medium' as const },
    { id: 'blocking-op', regex: /readFileSync\(|writeFileSync\(|execSync\(/, severity: 'high' as const },
  ];

  constructor(private config: SeimConfig, private llm: LLMClient) {}

  public async analyze(routeKey: string, sourceCode: string): Promise<OptimizationCandidate[]> {
    const candidates: OptimizationCandidate[] = [];
    const seen = new Set<string>();
    for (const pattern of this.patterns) {
      if (!pattern.regex.test(sourceCode)) continue;
      if (seen.has(pattern.id)) continue;
      seen.add(pattern.id);

      const optimized = await this.generateFix(sourceCode, pattern.id);
      if (!optimized && this.config.mode === 'bypass') continue;

      const candidate: OptimizationCandidate = {
        id: `${routeKey}::${pattern.id}::${Date.now()}`,
        routeKey,
        pattern: pattern.id,
        severity: pattern.severity,
        originalCode: sourceCode,
        optimizedCode: optimized,
        confidence: this.config.ai.enabled ? 0.92 : 0.85,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (this.config.security.allowedPatternModels.includes(candidate.pattern)) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  private async generateFix(sourceCode: string, patternId: string): Promise<string | undefined> {
    if (this.config.mode === 'restrict') return undefined;

    if (this.config.ai.enabled) {
      const body = await this.llm.optimize(sourceCode, patternId);
      if (body) return body;
    }

    // Fallback template generator
    return this.templateFix(sourceCode, patternId);
  }

  private templateFix(sourceCode: string, patternId: string): string | undefined {
    let modified = sourceCode;
    switch (patternId) {
      case 'sequential-async': {
        const transformed = sourceCode.replace(
          /const\s+(\w+)\s*=\s*await\s+([^;]+);\s*\n\s*const\s+(\w+)\s*=\s*await\s+([^;]+);/,
          'const [$1, $3] = await Promise.all([$2, $4]);'
        );
        modified = transformed === sourceCode ? sourceCode : transformed;
        break;
      }
      case 'n-plus-one':
        modified = `// [SEIM] Batch query: replace per-iteration awaits with a single IN clause or join\n` + sourceCode;
        break;
      case 'missing-cache':
        modified = `// [SEIM] Wrap result with cache lookup before falling back to the source\n` + sourceCode;
        break;
      case 'inefficient-loop':
        modified = `// [SEIM] Prefer for...of or .map/.filter for clarity and vectorization\n` + sourceCode;
        break;
      case 'redundant-serialization':
        modified = `// [SEIM] Avoid JSON.parse(JSON.stringify(...)); use structuredClone or shallow copy\n` + sourceCode;
        break;
      case 'blocking-op':
        modified = `// [SEIM] Replace blocking fs/child_process calls with async promise APIs\n` + sourceCode;
        break;
      default:
        return undefined;
    }
    return this.extractFunctionBody(modified);
  }

  private extractFunctionBody(fnSource: string): string {
    const trimmed = fnSource.trim();
    let m = trimmed.match(/^async\s+function\s*[\w]*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/^function\s*[\w]*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/^(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    return trimmed;
  }
}
