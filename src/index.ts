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

  const instance: any = {
    listener: createListener(config, { metrics, optimization, validation, shadow, rollback, learning, sandbox, shadowLimiter }),
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
  };
  instance.dashboard = createStudioHandler(instance as SeimInstance);

  return instance as SeimInstance;
}

export { seim };
