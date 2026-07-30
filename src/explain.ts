import { OptimizationExplanation, EvolutionCandidate, FitnessScore } from './types';
import { LLMClient } from './ai';
import { Logger } from './logger';

/**
 * ExplanationGenerator creates human-readable explanations for optimizations.
 * Each promoted optimization gets a full explanation: what changed, why,
 * measured impact, lineage, and related optimizations.
 */
export class ExplanationGenerator {
  constructor(
    private llm: LLMClient,
    private logger: Logger,
  ) {}

  /**
   * Generate a complete explanation for a promoted optimization.
   */
  public async generate(
    candidate: EvolutionCandidate,
    fitness: FitnessScore,
    v1Latency: number,
    v2Latency: number,
    lineage: string[],
    relatedRoutes: string[],
  ): Promise<OptimizationExplanation> {
    const whatChanged = this.generateDiffSummary(candidate.originalCode, candidate.code);
    const latencyReduction = v1Latency - v2Latency;
    const latencyReductionPercent = v1Latency > 0 ? (latencyReduction / v1Latency) * 100 : 0;

    // Try to get an AI-generated explanation
    let whyChosen = this.generateRuleBased(candidate, fitness, latencyReduction);
    try {
      const aiExplanation = await this.llm.explain(
        candidate.originalCode,
        candidate.code,
        candidate.pattern,
        latencyReduction,
      );
      if (aiExplanation && aiExplanation.length > 20) {
        whyChosen = aiExplanation;
      }
    } catch {
      // Fall back to rule-based explanation
    }

    return {
      routeKey: candidate.routeKey,
      candidateId: candidate.id,
      pattern: candidate.pattern,
      strategy: candidate.strategy,
      whatChanged,
      whyChosen,
      measuredImpact: {
        latencyReduction,
        latencyReductionPercent,
        errorRateChange: fitness.errorRateScore - 0.5, // Relative to baseline
        memoryChange: fitness.memoryScore - 0.5,
      },
      fitnessScore: fitness.overall,
      generation: candidate.generation,
      lineage,
      relatedOptimizations: relatedRoutes,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate a simple diff summary showing what changed.
   */
  private generateDiffSummary(original: string, optimized: string): string {
    const origLines = original.split('\n');
    const optLines = optimized.split('\n');
    const changes: string[] = [];

    const maxLen = Math.max(origLines.length, optLines.length);
    let addedCount = 0;
    let removedCount = 0;

    for (let i = 0; i < maxLen; i++) {
      const origLine = (origLines[i] || '').trim();
      const optLine = (optLines[i] || '').trim();
      if (origLine !== optLine) {
        if (origLine && !optLine) {
          removedCount++;
          if (changes.length < 5) changes.push(`- ${origLine}`);
        } else if (!origLine && optLine) {
          addedCount++;
          if (changes.length < 5) changes.push(`+ ${optLine}`);
        } else {
          removedCount++;
          addedCount++;
          if (changes.length < 5) {
            changes.push(`- ${origLine}`);
            changes.push(`+ ${optLine}`);
          }
        }
      }
    }

    const summary = `${addedCount} lines added, ${removedCount} lines removed`;
    if (changes.length > 0) {
      return `${summary}\n${changes.join('\n')}`;
    }
    return summary;
  }

  /**
   * Generate a rule-based explanation when AI is unavailable.
   */
  private generateRuleBased(
    candidate: EvolutionCandidate,
    fitness: FitnessScore,
    latencyReduction: number,
  ): string {
    const parts: string[] = [];

    // Strategy context
    const strategyDescriptions: Record<string, string> = {
      'template': 'Applied a proven template-based optimization',
      'ai-standard': 'AI-generated optimization using standard approach',
      'ai-creative': 'AI-generated optimization using a creative, unconventional approach',
      'learned-pattern': 'Applied a previously learned pattern from successful optimizations',
      'crossover': 'Combined successful patterns from different routes',
    };
    parts.push(strategyDescriptions[candidate.strategy] || `Optimization strategy: ${candidate.strategy}`);

    // Pattern context
    const patternDescriptions: Record<string, string> = {
      'sequential-async': 'parallelized sequential await calls using Promise.all',
      'n-plus-one': 'batched N+1 queries into a single parallel operation',
      'missing-cache': 'added caching for repeated data fetches',
      'inefficient-loop': 'replaced indexed loop with optimized iteration',
      'redundant-serialization': 'removed unnecessary JSON.parse(JSON.stringify) clone',
      'blocking-op': 'converted blocking synchronous operations to async',
      'response-streaming': 'suggested streaming for large response arrays',
    };
    if (patternDescriptions[candidate.pattern]) {
      parts.push(patternDescriptions[candidate.pattern]);
    } else {
      parts.push(`detected pattern: ${candidate.pattern}`);
    }

    // Impact
    parts.push(`Measured ${latencyReduction.toFixed(0)}ms latency reduction with fitness score ${fitness.overall.toFixed(2)}`);

    // Generation context
    if (candidate.generation > 1) {
      parts.push(`This is a generation ${candidate.generation} optimization, refined from earlier attempts`);
    }

    return parts.join('. ') + '.';
  }
}
