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

export * from './types';
export { mergeConfig } from './config';
export { SeimEventBus } from './events';
export { Logger, LogLevel, LogTransport, LoggerConfig } from './logger';
export { FrameworkAdapter } from './adapters/types';

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
  const learning = new LearningMemoryStore();
  const shadow = new ShadowTestEngine();
  const shadowLimiter = new ShadowLimiter(config);
  const metricsAnalyzer = new MetricsAnalyzer();
  const endpointTracker = new EndpointTracker();
  const productionManager = new ProductionManager(config);
  const dynamicRouter = new DynamicRouter(productionManager);

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

  logger.info('SEIM initialized', {
    mode: config.mode,
    framework: adapter.name,
    environment: config.environment ?? 'development',
    workerEnabled: config.worker?.enabled !== false,
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
      totalOptimizationsGenerated: 0,
      totalOptimizationsPromoted: rollback.promotedCount(),
      totalRollbacks: rollback.totalRollbacks(),
      activeShadowTests: 0,
      activeVersions: rollback.list().map((v) => ({ routeKey: v.routeKey, active: v.active })),
      workerQueueSize: worker.queueSize(),
      healthy: true,
    }),
    shutdown: async (): Promise<void> => {
      logger.info('SEIM shutting down');
      worker.stop();
      productionManager.destroy();
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
