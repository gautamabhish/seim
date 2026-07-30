import { OptimizationMemory } from './types';

export interface LearningContext {
  pattern: string;
  routeKey: string;
  relatedSolutions: OptimizationMemory[];
  historicalSuccessRate: number;
  suggestedConfidence: number;
}

export class LearningMemoryStore {
  private memory: Map<string, OptimizationMemory> = new Map();
  private persistencePath: string | undefined;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath;
    if (persistencePath) {
      this.load();
      // Debounced auto-save every 30s if dirty
      this.saveTimer = setInterval(() => {
        if (this.dirty) this.save();
      }, 30_000);
      if (this.saveTimer.unref) this.saveTimer.unref();
    }
  }

  public destroy(): void {
    if (this.dirty) this.save();
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  public remember(problem: string, solution: string, framework: string, improvement: number, success: boolean, metadata?: { routeKey?: string; candidateCode?: string; originalCode?: string }): void {
    const key = `${problem}::${framework}`;
    const existing = this.memory.get(key);
    if (existing) {
      existing.successCount += success ? 1 : 0;
      existing.failureCount += success ? 0 : 1;
      existing.averageImprovement =
        (existing.averageImprovement * (existing.successCount + existing.failureCount - 1) + improvement) /
        (existing.successCount + existing.failureCount);
      existing.lastUsed = Date.now();
      // Track the best solution code
      if (success && improvement > (existing.bestImprovement ?? 0)) {
        existing.bestImprovement = improvement;
        existing.bestSolutionCode = metadata?.candidateCode;
        existing.bestOriginalCode = metadata?.originalCode;
      }
      // Track route keys where this pattern appeared
      if (metadata?.routeKey && !existing.routeKeys?.includes(metadata.routeKey)) {
        existing.routeKeys = existing.routeKeys || [];
        existing.routeKeys.push(metadata.routeKey);
      }
    } else {
      this.memory.set(key, {
        problem,
        solution,
        framework,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        averageImprovement: improvement,
        lastUsed: Date.now(),
        bestImprovement: success ? improvement : undefined,
        bestSolutionCode: success ? metadata?.candidateCode : undefined,
        bestOriginalCode: metadata?.originalCode,
        routeKeys: metadata?.routeKey ? [metadata.routeKey] : [],
      });
    }
    this.dirty = true;
  }

  public lookup(problem: string, framework: string): OptimizationMemory | undefined {
    return this.memory.get(`${problem}::${framework}`);
  }

  /**
   * Find solutions related to a pattern — returns entries with the same problem
   * type or that share function calls with the given source code.
   */
  public findRelated(pattern: string, framework: string, sourceCode?: string): OptimizationMemory[] {
    const results: OptimizationMemory[] = [];
    for (const [, entry] of this.memory) {
      // Exact pattern match
      if (entry.problem === pattern && entry.framework === framework) {
        results.push(entry);
        continue;
      }
      // If source code provided, check for shared function calls
      if (sourceCode && entry.bestOriginalCode) {
        const sourceFns = this.extractFunctionNames(sourceCode);
        const entryFns = this.extractFunctionNames(entry.bestOriginalCode);
        const overlap = sourceFns.filter(fn => entryFns.includes(fn));
        if (overlap.length > 0) {
          results.push(entry);
        }
      }
    }
    return results.sort((a, b) => this.score(b) - this.score(a));
  }

  /**
   * Build a learning context for the optimization engine.
   * Includes related solutions, historical success rate, and suggested confidence.
   */
  public buildContext(pattern: string, routeKey: string, framework: string, sourceCode?: string): LearningContext {
    const related = this.findRelated(pattern, framework, sourceCode);
    const exact = this.lookup(pattern, framework);

    let historicalSuccessRate = 0.5; // Default: no data
    if (exact) {
      const total = exact.successCount + exact.failureCount;
      historicalSuccessRate = total === 0 ? 0.5 : exact.successCount / total;
    }

    // Calibrate confidence based on historical data
    let suggestedConfidence = 0.85; // base
    if (historicalSuccessRate >= 0.8) suggestedConfidence = 0.95;
    else if (historicalSuccessRate >= 0.6) suggestedConfidence = 0.90;
    else if (historicalSuccessRate >= 0.4) suggestedConfidence = 0.80;
    else if (historicalSuccessRate > 0) suggestedConfidence = 0.70;

    return {
      pattern,
      routeKey,
      relatedSolutions: related.slice(0, 5),
      historicalSuccessRate,
      suggestedConfidence,
    };
  }

  public topSolutions(limit = 10): OptimizationMemory[] {
    return Array.from(this.memory.values())
      .sort((a, b) => this.score(b) - this.score(a))
      .slice(0, limit);
  }

  public allEntries(): OptimizationMemory[] {
    return Array.from(this.memory.values());
  }

  public size(): number {
    return this.memory.size;
  }

  public score(entry: OptimizationMemory): number {
    const total = entry.successCount + entry.failureCount;
    const successRate = total === 0 ? 0 : entry.successCount / total;
    return successRate * entry.averageImprovement;
  }

  // ---- Persistence ----

  public save(): void {
    if (!this.persistencePath) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = JSON.stringify(Array.from(this.memory.entries()), null, 2);
      fs.writeFileSync(this.persistencePath, data, 'utf8');
      this.dirty = false;
    } catch {
      // Silently fail — persistence is best-effort
    }
  }

  public load(): void {
    if (!this.persistencePath) return;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.persistencePath)) return;
      const data = fs.readFileSync(this.persistencePath, 'utf8');
      const entries: [string, OptimizationMemory][] = JSON.parse(data);
      this.memory = new Map(entries);
    } catch {
      // Silently fail — start fresh
    }
  }

  // ---- Helpers ----

  private extractFunctionNames(source: string): string[] {
    const callRegex = /(?:await\s+)?(\w+)\s*\(/g;
    const names: string[] = [];
    const skip = new Set(['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'typeof',
      'void', 'delete', 'async', 'await', 'const', 'let', 'var', 'function',
      'Promise', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
      'Date', 'Math', 'Error', 'RegExp', 'Map', 'Set', 'console', 'Buffer',
      'setTimeout', 'clearTimeout', 'require', 'res', 'req', 'next']);
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      if (!skip.has(match[1])) names.push(match[1]);
    }
    return [...new Set(names)];
  }
}
