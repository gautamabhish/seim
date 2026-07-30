import { LearnedPattern, LearnedPatternRegistry } from './learnedPatterns';
import { Logger } from '../logger';
import { SeimEventBus } from '../events';

/**
 * PatternExtractor analyzes the diff between original and optimized code
 * to extract generalized patterns that can be reused without the LLM.
 * 
 * This is how SEIM "self-teaches": each successful AI optimization
 * becomes a template for future similar optimizations.
 */
export class PatternExtractor {
  constructor(
    private registry: LearnedPatternRegistry,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * Extract a learned pattern from a successful optimization.
   * Analyzes the diff between original and optimized code to find
   * a generalizable transformation.
   */
  public extract(
    routeKey: string,
    originalCode: string,
    optimizedCode: string,
    pattern: string,
    improvement: number,
  ): LearnedPattern | null {
    // Try each extraction strategy
    const extracted =
      this.trySequentialAsyncExtraction(originalCode, optimizedCode) ||
      this.tryLoopBatchExtraction(originalCode, optimizedCode) ||
      this.tryCacheWrappingExtraction(originalCode, optimizedCode) ||
      this.trySyncToAsyncExtraction(originalCode, optimizedCode) ||
      this.tryGenericTransformExtraction(originalCode, optimizedCode, pattern);

    if (!extracted) {
      this.logger.debug('Could not extract pattern', { routeKey, pattern });
      return null;
    }

    const learned: LearnedPattern = {
      name: `learned::${pattern}::${Date.now()}`,
      description: extracted.description,
      matcher: extracted.matcher,
      transform: extracted.transform,
      successCount: 1,
      failureCount: 0,
      averageImprovement: improvement,
      extractedFrom: routeKey,
      learnedAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.registry.register(learned);

    this.events.emitEvent('evolution:pattern-learned', {
      name: learned.name,
      description: learned.description,
      extractedFrom: routeKey,
      improvement,
    });

    this.logger.info('New pattern learned', {
      name: learned.name,
      description: learned.description,
      extractedFrom: routeKey,
      improvement,
    });

    return learned;
  }

  // ---- Extraction Strategies ----

  /**
   * Detect: sequential await → Promise.all
   */
  private trySequentialAsyncExtraction(
    original: string,
    optimized: string,
  ): { description: string; matcher: RegExp; transform: string } | null {
    const seqPattern = /const\s+(\w+)\s*=\s*await\s+([^;]+);\s*\n\s*const\s+(\w+)\s*=\s*await\s+([^;]+);/;
    const hasSeq = seqPattern.test(original);
    const hasPromiseAll = /Promise\.all/.test(optimized);

    if (hasSeq && hasPromiseAll) {
      return {
        description: 'Sequential awaits → Promise.all parallelization',
        matcher: /const\s+(\w+)\s*=\s*await\s+([^;]+);\s*\n\s*const\s+(\w+)\s*=\s*await\s+([^;]+);/,
        transform: 'const [$1, $3] = await Promise.all([$2, $4]);',
      };
    }
    return null;
  }

  /**
   * Detect: loop with await → batch with Promise.all
   */
  private tryLoopBatchExtraction(
    original: string,
    optimized: string,
  ): { description: string; matcher: RegExp; transform: string } | null {
    const loopAwait = /for\s*\([^)]*\)\s*\{[^}]*await\s+[^}]*\}/.test(original);
    const hasPromiseAll = /Promise\.all/.test(optimized);

    if (loopAwait && hasPromiseAll) {
      return {
        description: 'N+1 loop with await → batched Promise.all',
        matcher: /for\s*\(([^)]*)\)\s*\{([^}]*)(await\s+(\w+)\(([^)]*)\))([^}]*)\}/,
        transform: '// [SEIM] Batched: collect then resolve in parallel\nconst __seimIds = [];\nfor ($1) { $2 __seimIds.push($5); $6 }\nconst __seimResults = await Promise.all(__seimIds.map(id => $4(id)));',
      };
    }
    return null;
  }

  /**
   * Detect: bare function call → cached version
   */
  private tryCacheWrappingExtraction(
    original: string,
    optimized: string,
  ): { description: string; matcher: RegExp; transform: string } | null {
    const hasCache = /cache|Cache|__seimCache/.test(optimized) && !/cache|Cache/.test(original);
    if (!hasCache) return null;

    // Find the function being cached
    const fnMatch = original.match(/await\s+(get\w+)\(/);
    if (!fnMatch) return null;

    return {
      description: `Cache wrapping for ${fnMatch[1]}`,
      matcher: new RegExp(`(await\\s+${fnMatch[1]}\\(([^)]+)\\))`),
      transform: `(() => { const k = JSON.stringify([$2]); if (!globalThis.__seimCache) globalThis.__seimCache = new Map(); if (globalThis.__seimCache.has(k)) return globalThis.__seimCache.get(k); const v = await ${fnMatch[1]}($2); globalThis.__seimCache.set(k, v); return v; })()`,
    };
  }

  /**
   * Detect: sync FS/exec → async equivalent
   */
  private trySyncToAsyncExtraction(
    original: string,
    optimized: string,
  ): { description: string; matcher: RegExp; transform: string } | null {
    if (/readFileSync/.test(original) && /promises\.readFile/.test(optimized)) {
      return {
        description: 'readFileSync → async readFile',
        matcher: /readFileSync\(/g,
        transform: "await require('fs').promises.readFile(",
      };
    }
    if (/writeFileSync/.test(original) && /promises\.writeFile/.test(optimized)) {
      return {
        description: 'writeFileSync → async writeFile',
        matcher: /writeFileSync\(/g,
        transform: "await require('fs').promises.writeFile(",
      };
    }
    return null;
  }

  /**
   * Generic fallback: try to find a simple regex-based transformation.
   * Less reliable but captures novel patterns.
   */
  private tryGenericTransformExtraction(
    original: string,
    optimized: string,
    pattern: string,
  ): { description: string; matcher: RegExp; transform: string } | null {
    // Find lines that differ
    const origLines = original.split('\n').map(l => l.trim()).filter(Boolean);
    const optLines = optimized.split('\n').map(l => l.trim()).filter(Boolean);

    // Simple: if only one line changed and it's a direct replacement
    if (origLines.length === optLines.length) {
      const diffs: { index: number; from: string; to: string }[] = [];
      for (let i = 0; i < origLines.length; i++) {
        if (origLines[i] !== optLines[i]) {
          diffs.push({ index: i, from: origLines[i], to: optLines[i] });
        }
      }

      if (diffs.length === 1) {
        const { from, to } = diffs[0];
        try {
          // Escape regex special chars in the "from" string
          const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return {
            description: `${pattern}: line replacement`,
            matcher: new RegExp(escaped),
            transform: to,
          };
        } catch {
          return null;
        }
      }
    }

    return null;
  }
}
