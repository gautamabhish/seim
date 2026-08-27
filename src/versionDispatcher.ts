import { createHash } from 'crypto';
import { VersionRegistry, RuntimeVersion } from './versionRegistry';
import { CanaryAssigner, StableCanaryAssigner } from './canaryAssignment';
import { SeimEventBus } from './events';
import { Logger } from './logger';

export class VersionDispatcher<THandler extends Function = Function> {
  constructor(
    private registry: VersionRegistry<THandler>,
    private canaryAssigner: CanaryAssigner = new StableCanaryAssigner(),
    private events?: SeimEventBus,
    private logger?: Logger,
  ) {}

  /**
   * Dispatches and selects the appropriate handler for a given route and incoming request.
   * Deterministically routes canary traffic based on stable hash.
   */
  public dispatch(routeKey: string, req: any): THandler | undefined {
    const canary = this.registry.getCanary(routeKey);
    const active = this.registry.getActive(routeKey);

    if (canary && canary.canaryPercent > 0) {
      const shouldUseCanary = this.canaryAssigner.shouldUseCanary(req, canary.canaryPercent);
      if (shouldUseCanary && canary.handler) {
        return canary.handler;
      }
    }

    return active?.handler;
  }

  /**
   * Returns a dynamic middleware function that evaluates version dispatch on every incoming request.
   */
  public createMiddleware(routeKey: string, fallback?: THandler): THandler {
    const self = this;
    const middleware = function (req: any, res: any, next: any) {
      const handler = self.dispatch(routeKey, req) || fallback;
      if (typeof handler === 'function') {
        return handler(req, res, next);
      }
      if (typeof next === 'function') {
        return next();
      }
    };
    return middleware as unknown as THandler;
  }

  /**
   * Registers a baseline / original version for a route.
   */
  public registerOriginal(routeKey: string, handler: THandler, sourceCode: string): RuntimeVersion<THandler> {
    const sourceHash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const version: RuntimeVersion<THandler> = {
      id: `${routeKey}::original::${sourceHash}`,
      routeKey,
      handler,
      sourceHash,
      status: 'active',
      canaryPercent: 100,
      createdAt: Date.now(),
      promotedAt: Date.now(),
      metadata: { isOriginal: true },
    };

    // Only register as active if no active version exists yet
    if (!this.registry.getActive(routeKey)) {
      this.registry.register(version);
    }
    return version;
  }

  /**
   * Registers an optimized version as a canary.
   */
  public registerCanary(
    routeKey: string,
    candidateId: string,
    handler: THandler,
    code: string,
    canaryPercent: number = 5,
    metadata?: Record<string, any>,
  ): RuntimeVersion<THandler> {
    const sourceHash = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const version: RuntimeVersion<THandler> = {
      id: candidateId,
      routeKey,
      handler,
      sourceHash,
      status: 'canary',
      canaryPercent,
      createdAt: Date.now(),
      metadata: { ...metadata, candidateId },
    };

    this.registry.register(version);
    this.logger?.info('Registered canary version', { routeKey, versionId: version.id, canaryPercent });
    return version;
  }

  /**
   * Promotes a version to full 100% active traffic.
   */
  public promote(routeKey: string, versionId: string, reason: string = 'Performance validated'): boolean {
    const ok = this.registry.promote(routeKey, versionId, reason);
    if (ok) {
      this.events?.emitEvent('optimization:promoted', {
        routeKey,
        candidateId: versionId,
        latencyImprovement: 0,
      });
      this.logger?.info('Promoted version to active production', { routeKey, versionId, reason });
    }
    return ok;
  }

  /**
   * Rolls back route traffic to baseline / original.
   */
  public rollback(routeKey: string, reason: string): boolean {
    const ok = this.registry.rollback(routeKey, reason);
    if (ok) {
      this.events?.emitEvent('optimization:rolledback', {
        routeKey,
        reason,
      });
      this.logger?.warn('Rolled back version', { routeKey, reason });
    }
    return ok;
  }

  /**
   * Emergency pause on all canary traffic across all routes.
   */
  public pauseAll(): void {
    const all = this.registry.list();
    for (const v of all) {
      if (v.status === 'canary') {
        this.registry.setCanaryPercent(v.routeKey, v.id, 0);
      }
    }
    this.logger?.warn('Emergency pause: all canary deployments set to 0%');
  }

  public getRegistry(): VersionRegistry<THandler> {
    return this.registry;
  }
}
