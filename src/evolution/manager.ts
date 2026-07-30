import { EvolutionCandidate, SeimConfig, FitnessScore } from '../types';
import { PopulationGenerator } from './population';
import { TournamentSelector, ShadowResult } from './tournament';
import { Logger } from '../logger';
import { SeimEventBus } from '../events';

export interface GenerationRecord {
  generation: number;
  routeKey: string;
  candidates: EvolutionCandidate[];
  winnerId?: string;
  startedAt: number;
  completedAt?: number;
  bestFitness?: number;
}

/**
 * EvolutionManager orchestrates the multi-generation evolution lifecycle.
 * 
 * For each route:
 * 1. Generate a population of candidates (diverse strategies)
 * 2. Run shadow tests on each candidate
 * 3. Score fitness for each candidate
 * 4. Eliminate the weakest (tournament selection)
 * 5. If fitness plateau detected or max generations reached, select winner
 * 6. Winner goes through full validation and potential promotion
 */
export class EvolutionManager {
  private activeEvolutions: Map<string, GenerationRecord[]> = new Map();
  private pendingCandidates: Map<string, EvolutionCandidate[]> = new Map();

  constructor(
    private config: SeimConfig,
    private populationGenerator: PopulationGenerator,
    private tournament: TournamentSelector,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * Check if evolution is currently active for a route.
   */
  public isEvolving(routeKey: string): boolean {
    const pending = this.pendingCandidates.get(routeKey);
    return !!pending && pending.length > 0;
  }

  /**
   * Start a new evolution cycle for a route.
   * Generates the initial population of candidates.
   */
  public async startEvolution(
    routeKey: string,
    sourceCode: string,
    pattern: string,
    framework: string,
  ): Promise<EvolutionCandidate[]> {
    const maxGen = this.config.evolution?.maxGenerations ?? 3;
    const generations = this.activeEvolutions.get(routeKey) || [];
    const currentGen = generations.length + 1;

    if (currentGen > maxGen) {
      this.logger.debug('Max generations reached', { routeKey, maxGen });
      return [];
    }

    this.events.emitEvent('evolution:generation-started', {
      routeKey,
      generation: currentGen,
      maxGenerations: maxGen,
    });

    const candidates = await this.populationGenerator.generate(
      routeKey, sourceCode, pattern, currentGen, framework,
    );

    if (candidates.length === 0) {
      this.logger.debug('No candidates generated', { routeKey, generation: currentGen });
      return [];
    }

    const record: GenerationRecord = {
      generation: currentGen,
      routeKey,
      candidates: [...candidates],
      startedAt: Date.now(),
    };
    generations.push(record);
    this.activeEvolutions.set(routeKey, generations);
    this.pendingCandidates.set(routeKey, candidates);

    this.logger.info('Evolution started', {
      routeKey,
      generation: currentGen,
      populationSize: candidates.length,
      strategies: candidates.map(c => c.strategy),
    });

    return candidates;
  }

  /**
   * Record a shadow test result for a candidate and score its fitness.
   */
  public recordResult(
    routeKey: string,
    candidateId: string,
    result: ShadowResult,
  ): FitnessScore | null {
    const candidates = this.pendingCandidates.get(routeKey);
    if (!candidates) return null;

    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return null;

    candidate.status = 'testing';
    const fitness = this.tournament.scoreFitness(candidate, result);
    candidate.fitness = fitness;

    return fitness;
  }

  /**
   * Run a tournament round after all candidates have been tested.
   * Eliminates the weakest candidate.
   * Returns the winner if only one remains or fitness plateau detected.
   */
  public runTournamentRound(routeKey: string): {
    winner: EvolutionCandidate | null;
    eliminated: EvolutionCandidate | null;
    remaining: number;
  } {
    const candidates = this.pendingCandidates.get(routeKey);
    if (!candidates || candidates.length === 0) {
      return { winner: null, eliminated: null, remaining: 0 };
    }

    // Check if all candidates have been scored
    const allScored = candidates.every(c => c.fitness || c.status === 'eliminated');
    if (!allScored) {
      return { winner: null, eliminated: null, remaining: candidates.filter(c => c.status !== 'eliminated').length };
    }

    const active = candidates.filter(c => c.status !== 'eliminated');

    // If only one left, it's the winner
    if (active.length === 1) {
      const winner = this.tournament.selectWinner(active);
      if (winner) {
        this.finishEvolution(routeKey, winner);
      }
      return { winner, eliminated: null, remaining: winner ? 0 : 1 };
    }

    // Check for fitness plateau
    if (this.detectPlateau(routeKey, active)) {
      const winner = this.tournament.selectWinner(active);
      if (winner) {
        this.finishEvolution(routeKey, winner);
      }
      return { winner, eliminated: null, remaining: 0 };
    }

    // Eliminate weakest
    const result = this.tournament.eliminateWeakest(active);
    if (!result) {
      return { winner: null, eliminated: null, remaining: active.length };
    }

    this.pendingCandidates.set(routeKey, candidates);

    // If only one survivor, select winner
    if (result.survivors.length === 1) {
      const winner = this.tournament.selectWinner(result.survivors);
      if (winner) {
        this.finishEvolution(routeKey, winner);
      }
      return { winner, eliminated: result.eliminated, remaining: winner ? 0 : 1 };
    }

    return {
      winner: null,
      eliminated: result.eliminated,
      remaining: result.survivors.length,
    };
  }

  /**
   * Get the current pending candidates for a route.
   */
  public getCandidates(routeKey: string): EvolutionCandidate[] {
    return this.pendingCandidates.get(routeKey) || [];
  }

  /**
   * Get the full evolution history for a route.
   */
  public getHistory(routeKey: string): GenerationRecord[] {
    return this.activeEvolutions.get(routeKey) || [];
  }

  /**
   * Get lineage: trace a candidate's ancestry through generations.
   */
  public getLineage(routeKey: string, candidateId: string): string[] {
    const lineage: string[] = [candidateId];
    const history = this.activeEvolutions.get(routeKey) || [];

    let current = candidateId;
    for (const gen of [...history].reverse()) {
      const candidate = gen.candidates.find(c => c.id === current);
      if (candidate?.parentId) {
        lineage.unshift(candidate.parentId);
        current = candidate.parentId;
      }
    }

    return lineage;
  }

  /**
   * Clean up completed evolution data for a route.
   */
  public cleanup(routeKey: string): void {
    this.pendingCandidates.delete(routeKey);
  }

  /**
   * Get summary stats across all evolutions.
   */
  public stats(): {
    activeEvolutions: number;
    totalGenerations: number;
    totalCandidates: number;
  } {
    let totalGenerations = 0;
    let totalCandidates = 0;
    for (const gens of this.activeEvolutions.values()) {
      totalGenerations += gens.length;
      for (const gen of gens) {
        totalCandidates += gen.candidates.length;
      }
    }
    return {
      activeEvolutions: this.pendingCandidates.size,
      totalGenerations,
      totalCandidates,
    };
  }

  // ---- Private ----

  private finishEvolution(routeKey: string, winner: EvolutionCandidate): void {
    const generations = this.activeEvolutions.get(routeKey) || [];
    const lastGen = generations[generations.length - 1];
    if (lastGen) {
      lastGen.winnerId = winner.id;
      lastGen.completedAt = Date.now();
      lastGen.bestFitness = winner.fitness?.overall;
    }
    this.pendingCandidates.delete(routeKey);

    this.logger.info('Evolution completed', {
      routeKey,
      winnerId: winner.id,
      strategy: winner.strategy,
      fitness: winner.fitness?.overall,
      generations: generations.length,
    });
  }

  private detectPlateau(routeKey: string, candidates: EvolutionCandidate[]): boolean {
    if (candidates.length < 2) return false;

    const scores = candidates
      .filter(c => c.fitness)
      .map(c => c.fitness!.overall)
      .sort((a, b) => b - a);

    if (scores.length < 2) return false;

    // Plateau = top two candidates within 5% of each other
    const diff = Math.abs(scores[0] - scores[1]) / scores[0];
    return diff < 0.05;
  }
}
