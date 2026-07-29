import { RequestHandler } from 'express';
import { ProductionManager } from './productionManager';

export class DynamicRouter {
  private originalHandlers: Map<string, RequestHandler> = new Map();
  private optimizedHandlers: Map<string, RequestHandler> = new Map();
  private productionManager: ProductionManager;

  constructor(productionManager: ProductionManager) {
    this.productionManager = productionManager;
  }

  public registerHandler(routeKey: string, handler: RequestHandler, type: 'original' | 'optimized'): void {
    if (type === 'original') {
      this.originalHandlers.set(routeKey, handler);
    } else {
      this.optimizedHandlers.set(routeKey, handler);
    }
  }

  public getHandler(routeKey: string): RequestHandler {
    const deployment = this.productionManager.getDeployment(routeKey);
    
    // If no deployment or original version, return original handler
    if (!deployment || deployment.version === 'original') {
      return this.originalHandlers.get(routeKey) || this.fallbackHandler(routeKey);
    }

    // If optimized version, check canary percentage
    const shouldUseOptimized = Math.random() * 100 < deployment.canaryPercent;
    
    if (shouldUseOptimized) {
      return this.optimizedHandlers.get(routeKey) || this.originalHandlers.get(routeKey) || this.fallbackHandler(routeKey);
    }
    
    return this.originalHandlers.get(routeKey) || this.fallbackHandler(routeKey);
  }

  public createDynamicMiddleware(routeKey: string): RequestHandler {
    return (req, res, next) => {
      const handler = this.getHandler(routeKey);
      if (handler) {
        handler(req, res, next);
      } else {
        next();
      }
    };
  }

  public swapHandler(routeKey: string, newHandler: RequestHandler, type: 'original' | 'optimized'): void {
    if (type === 'original') {
      this.originalHandlers.set(routeKey, newHandler);
    } else {
      this.optimizedHandlers.set(routeKey, newHandler);
    }
  }

  public removeOptimizedHandler(routeKey: string): void {
    this.optimizedHandlers.delete(routeKey);
  }

  private fallbackHandler(routeKey: string): RequestHandler {
    return (req, res, next) => {
      console.error(`[DYNAMIC ROUTER] No handler found for ${routeKey}`);
      res.status(500).json({ error: 'Internal server error - handler not found' });
    };
  }

  public getHandlerCounts(): { original: number; optimized: number } {
    return {
      original: this.originalHandlers.size,
      optimized: this.optimizedHandlers.size,
    };
  }
}
