/**
 * LearnedPatternRegistry stores optimization patterns that SEIM has learned
 * from successful AI-generated fixes. Over time, SEIM becomes less dependent
 * on the LLM as it builds a library of proven transformations.
 */

export interface LearnedPattern {
  name: string;
  description: string;
  matcher: RegExp;
  transform: string; // Replacement string with capture groups
  successCount: number;
  failureCount: number;
  averageImprovement: number;
  extractedFrom: string; // routeKey where this was first learned
  learnedAt: number;
  lastUsed: number;
}

export class LearnedPatternRegistry {
  private patterns: Map<string, LearnedPattern> = new Map();
  private persistencePath: string | undefined;

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath;
    if (persistencePath) this.load();
  }

  /**
   * Find a matching learned pattern for a given source code.
   * Returns the best matching pattern (highest success rate).
   */
  public findMatch(sourceCode: string): { name: string; apply: (code: string) => string | null } | null {
    let bestMatch: LearnedPattern | null = null;
    let bestScore = -1;

    for (const pattern of this.patterns.values()) {
      if (!pattern.matcher.test(sourceCode)) continue;
      const total = pattern.successCount + pattern.failureCount;
      const score = total === 0 ? 0 : (pattern.successCount / total) * pattern.averageImprovement;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    if (!bestMatch) return null;

    const matched = bestMatch;
    return {
      name: matched.name,
      apply: (code: string) => {
        try {
          const result = code.replace(matched.matcher, matched.transform);
          return result !== code ? result : null;
        } catch {
          return null;
        }
      },
    };
  }

  /**
   * Register a new learned pattern extracted from a successful optimization.
   */
  public register(pattern: LearnedPattern): void {
    const existing = this.patterns.get(pattern.name);
    if (existing) {
      // Update stats
      existing.successCount += pattern.successCount;
      existing.failureCount += pattern.failureCount;
      existing.averageImprovement =
        (existing.averageImprovement + pattern.averageImprovement) / 2;
      existing.lastUsed = Date.now();
    } else {
      this.patterns.set(pattern.name, { ...pattern });
    }
    this.save();
  }

  /**
   * Record a success or failure for a learned pattern.
   */
  public recordOutcome(patternName: string, success: boolean, improvement: number): void {
    const pattern = this.patterns.get(patternName);
    if (!pattern) return;

    if (success) {
      pattern.successCount++;
      pattern.averageImprovement =
        (pattern.averageImprovement * (pattern.successCount - 1) + improvement) /
        pattern.successCount;
    } else {
      pattern.failureCount++;
    }
    pattern.lastUsed = Date.now();
    this.save();
  }

  /**
   * Get all learned patterns sorted by effectiveness.
   */
  public allPatterns(): LearnedPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => {
        const scoreA = this.score(a);
        const scoreB = this.score(b);
        return scoreB - scoreA;
      });
  }

  public size(): number {
    return this.patterns.size;
  }

  // ---- Persistence ----

  public save(): void {
    if (!this.persistencePath) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Serialize patterns — convert RegExp to string
      const serializable = Array.from(this.patterns.entries()).map(([key, p]) => [
        key,
        { ...p, matcher: p.matcher.source, matcherFlags: p.matcher.flags },
      ]);
      fs.writeFileSync(this.persistencePath, JSON.stringify(serializable, null, 2), 'utf8');
    } catch {
      // Best-effort
    }
  }

  public load(): void {
    if (!this.persistencePath) return;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.persistencePath)) return;
      const data = fs.readFileSync(this.persistencePath, 'utf8');
      const entries: [string, any][] = JSON.parse(data);
      this.patterns.clear();
      for (const [key, p] of entries) {
        this.patterns.set(key, {
          ...p,
          matcher: new RegExp(p.matcher, p.matcherFlags || ''),
        });
      }
    } catch {
      // Start fresh
    }
  }

  private score(p: LearnedPattern): number {
    const total = p.successCount + p.failureCount;
    const successRate = total === 0 ? 0 : p.successCount / total;
    return successRate * p.averageImprovement;
  }
}
