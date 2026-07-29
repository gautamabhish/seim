import { OptimizationMemory } from './types';

export class LearningMemoryStore {
  private memory: Map<string, OptimizationMemory> = new Map();

  public remember(problem: string, solution: string, framework: string, improvement: number, success: boolean): void {
    const key = `${problem}::${solution}::${framework}`;
    const existing = this.memory.get(key);
    if (existing) {
      existing.successCount += success ? 1 : 0;
      existing.failureCount += success ? 0 : 1;
      existing.averageImprovement =
        (existing.averageImprovement * (existing.successCount + existing.failureCount - 1) + improvement) /
        (existing.successCount + existing.failureCount);
      existing.lastUsed = Date.now();
    } else {
      this.memory.set(key, {
        problem,
        solution,
        framework,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        averageImprovement: improvement,
        lastUsed: Date.now(),
      });
    }
  }

  public lookup(problem: string, framework: string): OptimizationMemory | undefined {
    for (const [, entry] of this.memory) {
      if (entry.problem === problem && entry.framework === framework) return entry;
    }
    return undefined;
  }

  public topSolutions(limit = 10): OptimizationMemory[] {
    return Array.from(this.memory.values())
      .sort((a, b) => {
        const scoreA = this.score(a);
        const scoreB = this.score(b);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  private score(entry: OptimizationMemory): number {
    const total = entry.successCount + entry.failureCount;
    const successRate = total === 0 ? 0 : entry.successCount / total;
    return successRate * entry.averageImprovement;
  }
}
