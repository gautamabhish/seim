import { SeimInstance, SeimConfig, SeimStatus } from './types';
import { mergeConfig } from './config';
import { InMemoryMetricsStore } from './metrics';
import { OptimizationEngine } from './optimization';
import { ValidationEngine } from './validation';
import { ShadowTestEngine } from './shadow';
import { RollbackEngine } from './rollback';
import { LearningMemoryStore } from './learning';
import { LLMClient } from './ai';
import { Sandbox } from './sandbox';
import { ShadowLimiter } from './shadowLimiter';
import { MetricsAnalyzer } from './metricsAnalyzer';
import { EndpointTracker } from './endpointTracker';
import { ProductionManager } from './productionManager';
import { DynamicRouter } from './dynamicRouter';
import { PersistentVersionManager } from './persistentVersionManager';
import { createStorageAdapter } from './storageFactory';
import { createExpressListener, createListener } from './middleware';
import { createStudioHandler } from './studio';
import { createAdapter } from './adapters';
import { SeimEventBus } from './events';
import { Logger } from './logger';
import { OptimizationWorker } from './worker';
import { ExplanationGenerator } from './explain';
import {
  EvolutionManager,
  PopulationGenerator,
  TournamentSelector,
  CallGraph,
  OptimizationPropagator,
  PatternExtractor,
  LearnedPatternRegistry,
  DriftDetector,
} from './evolution';

export * from './types';
export { mergeConfig } from './config';
export { SeimEventBus } from './events';
export { Logger, LogLevel, LogTransport, LoggerConfig } from './logger';
export { FrameworkAdapter } from './adapters/types';
export { EvolutionManager, CallGraph, LearnedPatternRegistry } from './evolution';

export default function seim(userConfig: Partial<SeimConfig> = {}): SeimInstance {
  const config = mergeConfig(userConfig);

  // Core infrastructure
  const events = new SeimEventBus();
  const logger = new Logger({
    level: config.logging?.level ?? 'info',
    json: config.logging?.json ?? false,
  });
  const adapter = createAdapter(config.framework);
  const worker = new OptimizationWorker(
    config.worker?.intervalMs ?? 10000,
    events,
    logger,
  );

  const metrics = new InMemoryMetricsStore();
  const llm = new LLMClient(config);
  const sandbox = new Sandbox();
  const optimization = new OptimizationEngine(config, llm);
  const validation = new ValidationEngine(config, llm);
  const rollback = new RollbackEngine(config);
  const shadow = new ShadowTestEngine();
  const shadowLimiter = new ShadowLimiter(config);
  const metricsAnalyzer = new MetricsAnalyzer();
  const endpointTracker = new EndpointTracker();
  const productionManager = new ProductionManager(config);
  const dynamicRouter = new DynamicRouter(productionManager);

  // Persistent learning with file-backed storage
  const storagePath = config.storagePath ?? './.seim-storage';
  const learningPath = `${storagePath}/learning.json`;
  const patternsPath = `${storagePath}/learned-patterns.json`;
  const learning = new LearningMemoryStore(learningPath);

  // Evolution engine components
  const learnedPatterns = new LearnedPatternRegistry(patternsPath);
  const callGraph = new CallGraph();
  const populationGenerator = new PopulationGenerator(
    config, llm, optimization, learning, learnedPatterns, logger,
  );
  const tournament = new TournamentSelector(config, logger, events);
  const evolutionManager = new EvolutionManager(
    config, populationGenerator, tournament, logger, events,
  );
  const propagator = new OptimizationPropagator(callGraph, worker, logger, events);
  const patternExtractor = new PatternExtractor(learnedPatterns, logger, events);
  const driftDetector = new DriftDetector(config, metrics, worker, logger, events);
  const explainer = new ExplanationGenerator(llm, logger);

  // Persistent version management
  const storageAdapter = createStorageAdapter(config);
  const versionManager = new PersistentVersionManager(config, storageAdapter);

  const deps = {
    metrics, optimization, validation, shadow, rollback, learning, sandbox,
    shadowLimiter, metricsAnalyzer, endpointTracker, adapter, events, logger, worker,
  };

  // Start the background worker if enabled
  if (config.worker?.enabled !== false) {
    worker.start();
  }

  // Start drift detection if evolution + drift detection enabled
  if (config.evolution?.enabled !== false && config.evolution?.driftDetection) {
    driftDetector.start();
  }

  // Wire learning into the optimization lifecycle via events
  events.on('optimization:promoted', async (payload: any) => {
    const { routeKey, candidateId, latencyImprovement } = payload;
    const candidates = evolutionManager.getCandidates(routeKey);
    const winner = candidates.find(c => c.id === candidateId) || candidates.find(c => c.status === 'winner');
    const pattern = winner?.pattern || 'unknown';
    const strategy = winner?.strategy || 'unknown';

    // Record success in learning store
    learning.remember(pattern, strategy, adapter.name, latencyImprovement, true, {
      routeKey,
      candidateCode: winner?.code,
      originalCode: winner?.originalCode,
    });

    // Extract pattern from AI-generated fixes for future reuse
    if (config.evolution?.patternExtraction && winner && (winner.strategy === 'ai-standard' || winner.strategy === 'ai-creative')) {
      patternExtractor.extract(routeKey, winner.originalCode, winner.code, pattern, latencyImprovement);
    }

    // Cross-route propagation
    if (config.evolution?.crossRouteIntelligence) {
      propagator.propagate(routeKey, pattern);
    }

    // Record drift baseline
    const routeMetrics = metrics.forRoute(routeKey);
    if (routeMetrics) {
      driftDetector.recordBaseline(routeKey, routeMetrics);
    }

    // Generate explanation
    if (winner?.fitness) {
      const lineage = evolutionManager.getLineage(routeKey, winner.id);
      const relatedRoutes = callGraph.findRelatedRoutes(routeKey);
      const v1Latency = routeMetrics ? routeMetrics.totalDuration / Math.max(1, routeMetrics.requestCount) : 0;
      const v2Latency = v1Latency - latencyImprovement;
      try {
        const explanation = await explainer.generate(winner, winner.fitness, v1Latency, v2Latency, lineage, relatedRoutes);
        events.emitEvent('optimization:explained', { routeKey, explanation });
      } catch {
        // Explanation generation is best-effort
      }
    }
  });

  events.on('optimization:rejected', (payload: any) => {
    const { routeKey, candidateId, reason } = payload;
    const candidates = evolutionManager.getCandidates(routeKey);
    const candidate = candidates.find(c => c.id === candidateId);
    const pattern = candidate?.pattern || 'unknown';
    const strategy = candidate?.strategy || 'unknown';

    learning.remember(pattern, strategy, adapter.name, 0, false, {
      routeKey,
      candidateCode: candidate?.code,
      originalCode: candidate?.originalCode,
    });
  });

  events.on('optimization:rolledback', (payload: any) => {
    const { routeKey } = payload;
    driftDetector.removeBaseline(routeKey);
  });

  logger.info('SEIM initialized', {
    mode: config.mode,
    framework: adapter.name,
    environment: config.environment ?? 'development',
    workerEnabled: config.worker?.enabled !== false,
    evolutionEnabled: config.evolution?.enabled !== false,
    learnedPatterns: learnedPatterns.size(),
    learningEntries: learning.size(),
  });

  events.emitEvent('lifecycle:started', {
    mode: config.mode,
    framework: adapter.name,
  });

  const instance: SeimInstance = {
    listener: createExpressListener(config, deps),
    plugin: adapter.name === 'fastify' ? () => createListener(config, deps)() : undefined,
    dashboard: createStudioHandler({} as any),
    status: (): SeimStatus => ({
      mode: config.mode,
      framework: adapter.name,
      uptime: process.uptime(),
      totalOptimizationsGenerated: evolutionManager.stats().totalCandidates,
      totalOptimizationsPromoted: rollback.promotedCount(),
      totalRollbacks: rollback.totalRollbacks(),
      activeShadowTests: evolutionManager.stats().activeEvolutions,
      activeVersions: rollback.list().map((v) => ({ routeKey: v.routeKey, active: v.active })),
      workerQueueSize: worker.queueSize(),
      healthy: true,
    }),
    shutdown: async (): Promise<void> => {
      logger.info('SEIM shutting down');
      worker.stop();
      driftDetector.stop();
      productionManager.destroy();
      learning.destroy();
      events.emitEvent('lifecycle:shutdown', { reason: 'shutdown() called' });
      events.removeAllListeners();
    },
    on: (event: string, listener: (...args: any[]) => void): void => {
      events.on(event, listener);
    },
    config,
    metrics,
    endpointTracker,
    productionManager,
    dynamicRouter,
    versionManager,
  };

  // Wire up studio dashboard with the real instance
  instance.dashboard = createStudioHandler(instance);

  return instance;
}

export { seim };
