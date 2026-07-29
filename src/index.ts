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
import { PersistentVersionManager, FileStorageAdapter } from './persistentVersionManager';
import { createListener } from './middleware';
import { createStudioHandler } from './studio';

export * from './types';
export { mergeConfig } from './config';

export default function seim(userConfig: Partial<SeimConfig> = {}): SeimInstance {
  const config = mergeConfig(userConfig);
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
  const storageAdapter = new FileStorageAdapter(config.storagePath || './.seim-storage');
  const versionManager = new PersistentVersionManager(config, storageAdapter);

  const instance: any = {
    listener: createListener(config, { metrics, optimization, validation, shadow, rollback, learning, sandbox, shadowLimiter, metricsAnalyzer, endpointTracker }),
    status: (): SeimStatus => ({
      mode: config.mode,
      uptime: process.uptime(),
      totalOptimizationsGenerated: 0,
      totalOptimizationsPromoted: rollback.promotedCount(),
      totalRollbacks: rollback.totalRollbacks(),
      activeShadowTests: 0,
      activeVersions: rollback.list().map((v) => ({ routeKey: v.routeKey, active: v.active })),
      healthy: true,
    }),
    config,
    metrics,
    endpointTracker,
    productionManager,
    dynamicRouter,
    versionManager,
  };
  instance.dashboard = createStudioHandler(instance as SeimInstance);

  return instance as SeimInstance;
}

export { seim };
