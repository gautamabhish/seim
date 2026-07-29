import { Request, Response, NextFunction, RequestHandler } from 'express';
import { SeimInstance, SeimConfig, OptimizationCandidate } from './types';
import { InMemoryMetricsStore } from './metrics';
import { OptimizationEngine } from './optimization';
import { ValidationEngine } from './validation';
import { ShadowTestEngine } from './shadow';
import { RollbackEngine } from './rollback';
import { LearningMemoryStore } from './learning';
import { Sandbox } from './sandbox';
import { ShadowLimiter } from './shadowLimiter';

interface RouteHandlerInfo {
  route: any;
  index: number;
  handle: RequestHandler;
  source: string;
}

export function createListener(config: SeimConfig, deps: {
  metrics: InMemoryMetricsStore;
  optimization: OptimizationEngine;
  validation: ValidationEngine;
  shadow: ShadowTestEngine;
  rollback: RollbackEngine;
  learning: LearningMemoryStore;
  sandbox: Sandbox;
  shadowLimiter: ShadowLimiter;
}): () => RequestHandler {
  return function listener(): RequestHandler {
    return function seimListener(req: Request, res: Response, next: NextFunction): void {
      const start = process.hrtime.bigint();
      const routeKey = (req.route?.path as string | undefined) || req.path;
      let responseSize = 0;
      let payloadSize = 0;
      let timeout = false;
      const timeoutMs = 30000;
      const timer = setTimeout(() => { timeout = true; }, timeoutMs);

      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      res.json = function (body: any) {
        responseSize = JSON.stringify(body).length;
        return originalJson(body);
      };
      res.send = function (body: any) {
        if (typeof body === 'string') responseSize = Buffer.byteLength(body);
        else if (Buffer.isBuffer(body)) responseSize = body.length;
        return originalSend(body);
      };

      if (req.headers['content-length']) {
        payloadSize = parseInt(req.headers['content-length'] as string, 10) || 0;
      }

      res.on('finish', async () => {
        clearTimeout(timer);
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        const status = res.statusCode;
        const error = status >= 500 || timeout;
        deps.metrics.record(routeKey, duration, status, responseSize, payloadSize, error, timeout);

        if (config.mode !== 'bypass') return;
        if (deps.rollback.isPromoted(routeKey)) return;
        if (!deps.shadowLimiter.canRun(req, routeKey)) return;
        if (Math.random() * 100 >= config.experiment.canaryPercent) return;

        const routeInfo = findRouteHandler(req);
        if (!routeInfo) return;

        const candidates = await deps.optimization.analyze(routeKey, routeInfo.source);
        for (const candidate of candidates) {
          if (!candidate.optimizedCode) continue;
          const optimized = buildOptimizedHandler(candidate, deps.sandbox);
          try {
            const result = await deps.shadow.run(routeKey, routeInfo.handle, optimized, req);
            const validated = await deps.validation.validate(candidate, result.v1Output, result.v2Output, req);
            if (validated.overall) {
              deps.rollback.registerShadow(routeKey, { route: routeInfo.route, index: routeInfo.index }, routeInfo.handle, optimized);
              const report = deps.shadow.getReport(routeKey);
              if (report) {
                deps.rollback.evaluate(routeKey, report);
              }
            }
          } catch {
            // Do not crash the application on shadow-test failure.
          }
        }
      });

      next();
    };
  };
}

function findRouteHandler(req: Request): RouteHandlerInfo | undefined {
  const route = (req as any).route;
  const stack = route?.stack;
  if (!Array.isArray(stack)) return undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    const handle = stack[i]?.handle;
    if (typeof handle === 'function') {
      return { route, index: i, handle, source: handle.toString() };
    }
  }
  return undefined;
}

function buildOptimizedHandler(candidate: OptimizationCandidate, sandbox: Sandbox): RequestHandler {
  return function optimizedHandler(req: Request, res: Response, next: NextFunction): void {
    sandbox.run(candidate.optimizedCode || '', candidate.originalCode || '', req, res, next, 500).catch((err) => {
      next(err instanceof Error ? err : new Error(String(err)));
    });
  };
}
