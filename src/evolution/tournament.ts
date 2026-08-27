import { EvolutionCandidate, FitnessScore, SeimConfig } from '../types';
import { Logger } from '../logger';
import { SeimEventBus } from '../events';

export interface ShadowResult {
  candidateId: string;
  v1Latency: number;
  v2Latency: number;
  v1Errors: number;
  v2Errors: number;
  v1Memory: number;
  v2Memory: number;
  sampleSize: number;
  latencyVariance: number;
  outputEquivalent?: boolean;
}

/**
 * TournamentSelector runs multiple candidates against the original handler
 * and selects the best one based on a composite fitness function.
 */
export class TournamentSelector {
  constructor(
    private config: SeimConfig,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * Score a candidate based on its shadow test results.
   */
  public scoreFitness(
    candidate: EvolutionCandidate,
    result: ShadowResult,
  ): FitnessScore {
    // If output is not semantically equivalent to original, candidate is invalid (zero fitness)
    if (result.outputEquivalent === false) {
      return {
        overall: 0,
        latencyScore: 0,
        errorRateScore: 0,
        memoryScore: 0,
        stabilityScore: 0,
        generation: candidate.generation,
        lineageId: candidate.id,
      };
    }

    const weights = this.config.evolution?.fitnessWeights ?? {
      latency: 0.4,
      errorRate: 0.3,
      memory: 0.1,
      stability: 0.2,
    };

    // Latency score: how much faster is v2 vs v1? (0-1, 1 = much faster)
    const latencyReduction = result.v1Latency > 0
      ? (result.v1Latency - result.v2Latency) / result.v1Latency
      : 0;
    const latencyScore = Math.max(0, Math.min(1, 0.5 + latencyReduction));

    // Error rate score: v2 errors vs v1 errors (1 = no increase, 0 = much worse)
    const errorIncrease = result.v1Errors > 0
      ? (result.v2Errors - result.v1Errors) / result.v1Errors
      : result.v2Errors > 0 ? -1 : 0;
    const errorRateScore = Math.max(0, Math.min(1, 1 - errorIncrease));

    // Memory score: lower is better (1 = less memory, 0 = much more)
    const memoryRatio = result.v1Memory > 0
      ? result.v2Memory / result.v1Memory
      : 1;
    const memoryScore = Math.max(0, Math.min(1, 2 - memoryRatio));

    // Stability score: lower variance = more consistent (1 = very stable)
    const stabilityScore = result.latencyVariance > 0
      ? Math.max(0, Math.min(1, 1 - (result.latencyVariance / (result.v2Latency || 1))))
      : 0.5;

    const overall =
      latencyScore * weights.latency +
      errorRateScore * weights.errorRate +
      memoryScore * weights.memory +
      stabilityScore * weights.stability;

    return {
      overall,
      latencyScore,
      errorRateScore,
      memoryScore,
      stabilityScore,
      generation: candidate.generation,
      lineageId: candidate.id,
    };
  }

  /**
   * Run a tournament round: eliminate the weakest candidate.
   * Returns the eliminated candidate and the surviving population.
   */
  public eliminateWeakest(
    candidates: EvolutionCandidate[],
  ): { eliminated: EvolutionCandidate; survivors: EvolutionCandidate[] } | null {
    if (candidates.length <= 1) return null;

    // Sort by fitness (lowest first)
    const scored = candidates
      .filter(c => c.fitness)
      .sort((a, b) => (a.fitness!.overall) - (b.fitness!.overall));

    if (scored.length === 0) return null;

    const eliminated = scored[0];
    eliminated.status = 'eliminated';

    this.events.emitEvent('evolution:candidate-eliminated', {
      routeKey: eliminated.routeKey,
      candidateId: eliminated.id,
      strategy: eliminated.strategy,
      fitness: eliminated.fitness!.overall,
      generation: eliminated.generation,
    });

    this.logger.debug('Candidate eliminated', {
      routeKey: eliminated.routeKey,
      candidateId: eliminated.id,
      fitness: eliminated.fitness!.overall,
      strategy: eliminated.strategy,
    });

    const survivors = candidates.filter(c => c.id !== eliminated.id);
    return { eliminated, survivors };
  }

  /**
   * Select the winner from the final population.
   * Returns the candidate with the highest fitness score.
   */
  public selectWinner(candidates: EvolutionCandidate[]): EvolutionCandidate | null {
    const scored = candidates
      .filter(c => c.fitness && c.status !== 'eliminated')
      .sort((a, b) => (b.fitness!.overall) - (a.fitness!.overall));

    if (scored.length === 0) return null;

    const winner = scored[0];

    // Check minimum fitness threshold
    if (winner.fitness!.overall < 0.5) {
      this.logger.info('No candidate met minimum fitness threshold', {
        routeKey: winner.routeKey,
        bestFitness: winner.fitness!.overall,
      });
      return null;
    }

    // Check that optimized version is actually faster
    if (winner.fitness!.latencyScore <= 0.5) {
      this.logger.info('Winner is not faster than original', {
        routeKey: winner.routeKey,
        latencyScore: winner.fitness!.latencyScore,
      });
      return null;
    }

    winner.status = 'winner';

    this.events.emitEvent('evolution:winner-selected', {
      routeKey: winner.routeKey,
      candidateId: winner.id,
      strategy: winner.strategy,
      fitness: winner.fitness!.overall,
      generation: winner.generation,
    });

    return winner;
  }

  /**
   * Compare two candidates head-to-head.
   */
  public compare(a: EvolutionCandidate, b: EvolutionCandidate): number {
    if (!a.fitness || !b.fitness) return 0;
    return b.fitness.overall - a.fitness.overall;
  }
}
