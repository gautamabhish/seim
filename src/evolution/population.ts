import { EvolutionCandidate, SeimConfig } from '../types';
import { LLMClient } from '../ai';
import { OptimizationEngine } from '../optimization';
import { LearningMemoryStore, LearningContext } from '../learning';
import { LearnedPatternRegistry } from './learnedPatterns';
import { Logger } from '../logger';

/**
 * PopulationGenerator creates multiple optimization candidates per route
 * using different strategies: template, AI standard, AI creative, learned patterns.
 */
export class PopulationGenerator {
  constructor(
    private config: SeimConfig,
    private llm: LLMClient,
    private optimizationEngine: OptimizationEngine,
    private learning: LearningMemoryStore,
    private learnedPatterns: LearnedPatternRegistry,
    private logger: Logger,
  ) {}

  /**
   * Generate a population of candidates for a route.
   * Returns up to `populationSize` candidates using diverse strategies.
   */
  public async generate(
    routeKey: string,
    sourceCode: string,
    pattern: string,
    generation: number,
    framework: string,
  ): Promise<EvolutionCandidate[]> {
    const popSize = this.config.evolution?.populationSize ?? 3;
    const candidates: EvolutionCandidate[] = [];
    const learningContext = this.learning.buildContext(pattern, routeKey, framework, sourceCode);

    // Strategy 1: Template-based fix (fast, no LLM cost)
    const templateCandidate = await this.generateTemplate(routeKey, sourceCode, pattern, generation);
    if (templateCandidate) candidates.push(templateCandidate);

    // Strategy 2: Learned pattern fix (from previously extracted patterns)
    const learnedCandidate = this.generateFromLearnedPattern(routeKey, sourceCode, pattern, generation);
    if (learnedCandidate) candidates.push(learnedCandidate);

    // Strategy 3+: AI-generated variants (only if AI enabled and we need more)
    if (this.config.ai.enabled && candidates.length < popSize) {
      const aiStrategies: Array<'standard' | 'creative' | 'conservative'> = ['standard', 'creative', 'conservative'];
      for (const strategy of aiStrategies) {
        if (candidates.length >= popSize) break;
        const aiCandidate = await this.generateAI(routeKey, sourceCode, pattern, generation, strategy, learningContext);
        if (aiCandidate) candidates.push(aiCandidate);
      }
    }

    this.logger.debug('Population generated', {
      routeKey,
      generation,
      candidates: candidates.length,
      strategies: candidates.map(c => c.strategy),
    });

    return candidates;
  }

  private async generateTemplate(
    routeKey: string,
    sourceCode: string,
    pattern: string,
    generation: number,
  ): Promise<EvolutionCandidate | null> {
    try {
      // Use the optimization engine's pattern analysis (template-based)
      const candidates = await this.optimizationEngine.analyze(routeKey, sourceCode);
      if (candidates.length > 0 && candidates[0].optimizedCode) {
        return {
          id: `evo::${routeKey}::template::${generation}::${Date.now()}`,
          routeKey,
          generation,
          strategy: 'template',
          code: candidates[0].optimizedCode,
          originalCode: sourceCode,
          pattern: candidates[0].pattern || pattern,
          status: 'pending',
          createdAt: Date.now(),
        };
      }
    } catch (err) {
      this.logger.debug('Template generation failed', { routeKey, error: (err as Error).message });
    }
    return null;
  }

  private generateFromLearnedPattern(
    routeKey: string,
    sourceCode: string,
    pattern: string,
    generation: number,
  ): EvolutionCandidate | null {
    const match = this.learnedPatterns.findMatch(sourceCode);
    if (!match) return null;

    const transformed = match.apply(sourceCode);
    if (!transformed || transformed === sourceCode) return null;

    return {
      id: `evo::${routeKey}::learned::${generation}::${Date.now()}`,
      routeKey,
      generation,
      strategy: 'learned-pattern',
      code: transformed,
      originalCode: sourceCode,
      pattern: match.name,
      status: 'pending',
      createdAt: Date.now(),
    };
  }

  private async generateAI(
    routeKey: string,
    sourceCode: string,
    pattern: string,
    generation: number,
    strategy: 'standard' | 'creative' | 'conservative',
    learningContext: LearningContext,
  ): Promise<EvolutionCandidate | null> {
    try {
      const strategyMap: Record<string, 'ai-standard' | 'ai-creative'> = {
        standard: 'ai-standard',
        creative: 'ai-creative',
        conservative: 'ai-standard',
      };
      const code = await this.llm.optimizeWithStrategy(sourceCode, pattern, strategy, learningContext);
      if (!code || code === sourceCode) return null;

      return {
        id: `evo::${routeKey}::${strategy}::${generation}::${Date.now()}`,
        routeKey,
        generation,
        strategy: strategyMap[strategy] ?? 'ai-standard',
        code,
        originalCode: sourceCode,
        pattern,
        status: 'pending',
        createdAt: Date.now(),
      };
    } catch (err) {
      this.logger.debug(`AI ${strategy} generation failed`, { routeKey, error: (err as Error).message });
      return null;
    }
  }
}
