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
import { SchemaValidator } from './schemaValidator';
import { SchemaRegistry } from './schemaRegistry';
import { BusinessMetricsStore } from './businessMetrics';
import { AnalyticsAdapter } from './analytics/adapter';
import { BehaviorAnalysisEngine } from './behaviorAnalysis';
import { FeatureEvolutionEngine } from './featureEvolution';
import { ABTestEngine } from './abTesting';
import { FrontendEvolutionEngine } from './frontendEvolution';
import { ComponentRegistry } from './componentRegistry';
import { CodeValidator } from './codeValidator';
import { FeatureFlagEngine } from './featureFlags';

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
  
  // Schema validation for feature evolution
  const schemaValidator = new SchemaValidator();
  const schemaRegistry = new SchemaRegistry(config.storagePath);
  const validation = new ValidationEngine(config, llm, schemaValidator, schemaRegistry);
  
  // Business metrics and analytics for feature evolution
  let businessMetrics: BusinessMetricsStore | undefined;
  let analytics: AnalyticsAdapter;
  let behaviorAnalysis: BehaviorAnalysisEngine | undefined;
  
  if (config.businessMetrics?.enabled) {
    businessMetrics = new BusinessMetricsStore(config.storagePath);
    analytics = new AnalyticsAdapter();
    if (config.businessMetrics.analyticsProvider === 'mixpanel' && config.businessMetrics.apiKey) {
      analytics.integrateMixpanel(config.businessMetrics.apiKey);
    } else if (config.businessMetrics.analyticsProvider === 'amplitude' && config.businessMetrics.apiKey) {
      analytics.integrateAmplitude(config.businessMetrics.apiKey);
    } else if (config.businessMetrics.analyticsProvider === 'ga' && config.businessMetrics.apiKey) {
      analytics.integrateGoogleAnalytics(config.businessMetrics.apiKey);
    }
    
    if (config.featureEvolution?.enabled) {
      behaviorAnalysis = new BehaviorAnalysisEngine(config, analytics, businessMetrics);
      
      // Integrate behavior analysis with business metrics
      // When events are tracked, also analyze for behavior patterns
      const originalRecordEngagement = businessMetrics.recordEngagement.bind(businessMetrics);
      businessMetrics.recordEngagement = (routeKey: string, action: string, userId: string, properties?: any) => {
        originalRecordEngagement(routeKey, action, userId, properties);
        if (behaviorAnalysis) {
          behaviorAnalysis.recordAction(userId, action, properties);
        }
      };
    }
  } else {
    analytics = new AnalyticsAdapter();
  }
  
  // Feature evolution and A/B testing
  const featureEvolution = new FeatureEvolutionEngine(
    config,
    llm,
    businessMetrics || new BusinessMetricsStore(config.storagePath),
    behaviorAnalysis,
    events,
    logger
  );
  const abTesting = new ABTestEngine(config, businessMetrics || new BusinessMetricsStore(config.storagePath), events, logger);
  
  // Frontend evolution
  const frontendEvolution = new FrontendEvolutionEngine(
    config,
    llm,
    schemaRegistry,
    events,
    logger
  );
  const componentRegistry = new ComponentRegistry(config, logger);
  const codeValidator = new CodeValidator(config, logger);
  
  // Feature flags
  const featureFlags = new FeatureFlagEngine(config, events, logger);
  
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
    schemaValidator, schemaRegistry,
    businessMetrics, analytics, behaviorAnalysis,
    featureEvolution, abTesting,
    frontendEvolution, componentRegistry, codeValidator,
    featureFlags,
  };

  // Start the background worker if enabled
  if (config.worker?.enabled !== false) {
    worker.start();
  }

  // Start drift detection if evolution + drift detection enabled
  if (config.evolution?.enabled !== false && config.evolution?.driftDetection) {
    driftDetector.start();
  }

  // Wire feature evolution events if enabled
  if (config.featureEvolution?.enabled) {
    events.on('feature:opportunities_analyzed', async (payload: any) => {
      const { routeKey, opportunities } = payload;
      if (opportunities.length > 0) {
        // Generate variants for high-confidence opportunities
        for (const opportunity of opportunities.filter((o: any) => o.confidence > 0.7)) {
          try {
            const variant = await featureEvolution.generateFeatureVariant(routeKey, opportunity);
            if (variant) {
              events.emitEvent('feature:variant_generated', { routeKey, variant, opportunity });
            }
          } catch (error) {
            logger.warn('Failed to generate feature variant', { routeKey, opportunity, error });
          }
        }
      }
    });

    events.on('feature:variant_generated', async (payload: any) => {
      const { routeKey, variant } = payload;
      if (config.featureEvolution?.autoABTest) {
        // Start A/B test for the variant
        try {
          const test = abTesting.createTest({
            featureId: routeKey,
            sampleSize: config.featureEvolution.abTestSampleSize || 1000,
            duration: config.featureEvolution.abTestDuration || 7 * 24 * 60 * 60 * 1000,
            trafficSplit: { control: 50, [variant.id]: 50 },
            successMetrics: ['conversionRate', 'engagement', 'retention']
          });
          abTesting.startTest(test.id);
          events.emitEvent('feature:abtest_started', { testId: test.id, routeKey });
        } catch (error) {
          logger.warn('Failed to start A/B test', { routeKey, variant, error });
        }
      }
    });

    events.on('feature:abtest_completed', async (payload: any) => {
      const { testId, winner, confidence } = payload;
      if (confidence > 0.95 && winner) {
        // Promote winner to production
        logger.info('Promoting A/B test winner to production', { testId, winner });
        events.emitEvent('feature:winner_promoted', { testId, winner });
      }
    });
  }

  // Wire frontend evolution events if enabled
  if (config.frontendEvolution?.enabled) {
    events.on('schema:change', async (payload: any) => {
      const { change } = payload;
      await frontendEvolution.handleSchemaChange(change);
    });

    events.on('frontend:component_generated', async (payload: any) => {
      const { component } = payload;
      // Validate the generated component
      const validation = codeValidator.validateFrontendCode(component.code, component.framework);
      if (validation.pass) {
        componentRegistry.registerComponent(component);
        logger.info('Frontend component registered', { componentId: component.id });
      } else {
        logger.warn('Frontend component failed validation', {
          componentId: component.id,
          errors: validation.errors
        });
        // Manually set the component status to rejected
        component.status = 'rejected';
        component.rejectedAt = Date.now();
        component.metadata.rejectionReason = 'Code validation failed';
      }
    });

    events.on('frontend:component_approved', async (payload: any) => {
      const { component } = payload;
      if (config.frontendEvolution?.autoDeploy) {
        componentRegistry.activateComponent(component.id);
        logger.info('Frontend component auto-deployed', { componentId: component.id });
      }
    });
  }

  // Wire feature flags events if enabled
  if (config.featureFlags?.enabled) {
    events.on('feature:winner_promoted', async (payload: any) => {
      const { winner } = payload;
      // Create a feature flag for the winning variant
      if (config.featureFlags?.autoCreateFlags) {
        try {
          const flag = featureFlags.createFlag({
            key: `feature_${winner}`,
            name: `Feature: ${winner}`,
            description: 'Auto-created flag from A/B test winner',
            enabled: false,
            rolloutPercentage: 0,
            targetType: 'all',
            targetSegments: [],
            conditions: [],
            metadata: {
              source: 'abtest',
              winnerId: winner
            }
          });
          logger.info('Feature flag auto-created from A/B test winner', { flagId: flag.id });
        } catch (error) {
          logger.warn('Failed to auto-create feature flag', { winner, error });
        }
      }
    });

    events.on('featureflag:created', async (payload: any) => {
      const { flag } = payload;
      if (config.featureFlags?.autoRollout && flag.enabled) {
        // Start gradual rollout
        featureFlags.gradualRollout(flag.id, flag.rolloutPercentage, config.featureFlags?.rolloutDuration || 7 * 24 * 60 * 60 * 1000);
      }
    });
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
    ...(config.businessMetrics?.enabled && config.featureEvolution?.enabled ? { businessMetrics } : {}),
    ...(config.businessMetrics?.enabled && config.featureEvolution?.enabled ? { behaviorAnalysis } : {}),
  };

  // Wire up studio dashboard with the real instance
  instance.dashboard = createStudioHandler(instance);

  return instance;
}

export { seim };
