import { OptimizationCandidate, SeimConfig, RouteMetrics } from './types';
import { LLMClient } from './ai';
import { EndpointTracker } from './endpointTracker';

export class OptimizationEngine {
  constructor(private config: SeimConfig, private llm: LLMClient) {}

  public async analyze(routeKey: string, sourceCode: string): Promise<OptimizationCandidate[]> {
    // Legacy method for backward compatibility - uses pattern-based approach
    return this.analyzeWithPatterns(routeKey, sourceCode);
  }

  public async analyzeWithMetricsCheck(
    routeKey: string, 
    sourceCode: string, 
    routeMetrics: RouteMetrics | undefined,
    endpointTracker: EndpointTracker
  ): Promise<OptimizationCandidate[]> {
    const candidates: OptimizationCandidate[] = [];
    
    // Calculate current metrics for AI context
    const currentMetrics = routeMetrics ? {
      averageLatency: routeMetrics.requestCount === 0 ? 0 : routeMetrics.totalDuration / routeMetrics.requestCount,
      p95: this.calculateP95(routeMetrics.durations),
      p99: this.calculateP99(routeMetrics.durations),
      errorRate: routeMetrics.requestCount === 0 ? 0 : routeMetrics.errorCount / routeMetrics.requestCount,
      requestCount: routeMetrics.requestCount,
    } : undefined;

    // Use AI-driven holistic analysis instead of pattern matching
    if (this.config.ai.enabled) {
      const analysis = await this.llm.analyzeAndOptimize(sourceCode, currentMetrics);
      
      if (!analysis.canOptimize) {
        // AI determined no optimization needed
        endpointTracker.markAsNonOptimizable(routeKey, analysis.reason);
        return []; // No candidates
      }

      // AI found optimization opportunity
      if (analysis.optimizedCode) {
        const candidate: OptimizationCandidate = {
          id: `${routeKey}::ai-generated::${Date.now()}`,
          routeKey,
          pattern: analysis.pattern || 'ai-detected',
          severity: 'high', // AI-detected issues are treated as high priority
          originalCode: sourceCode,
          optimizedCode: analysis.optimizedCode,
          confidence: 0.92,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        candidates.push(candidate);
      }
    } else {
      // AI disabled, fall back to pattern-based approach
      return this.analyzeWithPatterns(routeKey, sourceCode);
    }

    return candidates;
  }

  private async analyzeWithPatterns(routeKey: string, sourceCode: string): Promise<OptimizationCandidate[]> {
    // Legacy pattern-based approach (only used when AI is disabled)
    const patterns = [
      { id: 'sequential-async', regex: /const\s+\w+\s*=\s*await\s+[^;]+;\s*\n\s*const\s+\w+\s*=\s*await\s+[^;]+;/, severity: 'high' as const },
      { id: 'n-plus-one', regex: /for\s*\([^)]*\)\s*\{[^}]*await\s+[^}]*\}/, severity: 'critical' as const },
      { id: 'missing-cache', regex: /await\s+get[^\(]*\([^\)]*\)(?!.*cache)/, severity: 'medium' as const },
      { id: 'inefficient-loop', regex: /for\s*\(let\s+\w+\s*=\s*0;\s*\w+\s*<\s*\w+\.length;\s*\w+\+\+\s*\)/, severity: 'low' as const },
      { id: 'redundant-serialization', regex: /JSON\.parse\(JSON\.stringify\(/, severity: 'medium' as const },
      { id: 'blocking-op', regex: /readFileSync\(|writeFileSync\(|execSync\(/, severity: 'high' as const },
      { id: 'nested-ternary', regex: /\?\s*[^:]+\s*:\s*[^?]+\?\s*[^:]+\s*:/, severity: 'low' as const },
    ];

    const candidates: OptimizationCandidate[] = [];
    const seen = new Set<string>();
    
    for (const pattern of patterns) {
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

  private calculateP95(durations: number[]): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const index = Math.ceil((95 / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateP99(durations: number[]): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const index = Math.ceil((99 / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
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
      case 'nested-ternary':
        modified = `// [SEIM] Replace nested ternary with early returns or object lookup for better readability\n` + sourceCode;
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
