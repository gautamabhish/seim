import { CallGraph } from './callGraph';
import { OptimizationWorker } from '../worker';
import { Logger } from '../logger';
import { SeimEventBus } from '../events';

/**
 * OptimizationPropagator detects when an optimization on one route
 * should be propagated to related routes that share function calls.
 * 
 * Example: caching getUserById() worked on GET /users/:id → auto-enqueue
 * GET /posts/:userId and GET /comments/:userId for re-evaluation.
 */
export class OptimizationPropagator {
  private propagationCooldown: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private callGraph: CallGraph,
    private worker: OptimizationWorker,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * After a successful optimization on a route, propagate to related routes.
   * Related routes are enqueued in the worker with boosted priority.
   */
  public propagate(optimizedRouteKey: string, pattern: string): string[] {
    const now = Date.now();
    const related = this.callGraph.findRelatedRoutes(optimizedRouteKey);
    if (related.length === 0) return [];

    const sharedInfo: string[] = [];
    for (const relatedRoute of related) {
      // Prevent circular ping-pong propagation cascades
      const edgeKey = `${optimizedRouteKey}->${relatedRoute}`;
      const lastPropagated = this.propagationCooldown.get(edgeKey);
      if (lastPropagated && now - lastPropagated < this.COOLDOWN_MS) {
        continue; // Under cooldown, skip
      }

      const shared = this.callGraph.sharedFunctions(optimizedRouteKey, relatedRoute);
      if (shared.length === 0) continue;

      this.propagationCooldown.set(edgeKey, now);

      // Boost priority for related routes
      this.worker.enqueue(relatedRoute, 8);
      sharedInfo.push(relatedRoute);

      this.logger.debug('Propagating optimization opportunity', {
        from: optimizedRouteKey,
        to: relatedRoute,
        sharedFunctions: shared,
        pattern,
      });
    }

    if (sharedInfo.length > 0) {
      this.events.emitEvent('evolution:propagated', {
        sourceRoute: optimizedRouteKey,
        targetRoutes: sharedInfo,
        pattern,
        sharedFunctionCount: this.callGraph.findRelatedRoutes(optimizedRouteKey).length,
      });
    }

    return sharedInfo;
  }

  /**
   * Analyze the call graph to find high-impact optimization targets.
   * Functions called by many routes should be prioritized.
   */
  public findHighImpactTargets(minRoutes = 3): {
    functionName: string;
    affectedRoutes: string[];
    impact: number;
  }[] {
    return this.callGraph.hotspots(minRoutes).map(h => ({
      functionName: h.name,
      affectedRoutes: h.routes,
      impact: h.routeCount,
    }));
  }
}
