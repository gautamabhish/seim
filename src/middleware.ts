import { Request, Response, NextFunction, RequestHandler } from 'express';
import { SeimConfig, OptimizationCandidate } from './types';
import { InMemoryMetricsStore } from './metrics';
import { OptimizationEngine } from './optimization';
import { ValidationEngine } from './validation';
import { ShadowTestEngine } from './shadow';
import { RollbackEngine } from './rollback';
import { LearningMemoryStore } from './learning';
import { Sandbox } from './sandbox';
import { ShadowLimiter } from './shadowLimiter';
import { MetricsAnalyzer } from './metricsAnalyzer';
import { EndpointTracker } from './endpointTracker';
import { CiCdOptimizer } from './ciCdOptimizer';
import { FrameworkAdapter } from './adapters/types';
import { SeimEventBus } from './events';
import { Logger } from './logger';
import { OptimizationWorker } from './worker';

interface MiddlewareDeps {
  metrics: InMemoryMetricsStore;
  optimization: OptimizationEngine;
  validation: ValidationEngine;
  shadow: ShadowTestEngine;
  rollback: RollbackEngine;
  learning: LearningMemoryStore;
  sandbox: Sandbox;
  shadowLimiter: ShadowLimiter;
  metricsAnalyzer: MetricsAnalyzer;
  endpointTracker: EndpointTracker;
  adapter: FrameworkAdapter;
  events: SeimEventBus;
  logger: Logger;
  worker: OptimizationWorker;
}

export function createListener(config: SeimConfig, deps: MiddlewareDeps): () => any {
  const { adapter, events, logger, worker } = deps;

  // Set up the worker processor — this runs optimization analysis off the request path
  worker.setProcessor(async (task) => {
    await processOptimization(config, deps, task.routeKey);
  });

  return function listener(): any {
    return adapter.createMiddleware(
      // onRequest — lightweight, just records start time
      (_req: any, _res: any, _routeKey: string) => {},

      // onResponse — records metrics, enqueues optimization work
      (_req: any, _res: any, routeKey: string, info) => {
        try {
          // Cache source code for background worker (req.route is populated on response finish)
          const routeInfo = findRouteHandler(_req);
          if (routeInfo) {
            sourceCache.set(routeKey, routeInfo.source);
          }

          // Check for pending candidates that need shadow testing
          const pending = pendingCandidates.get(routeKey);
          if (pending && routeInfo && config.mode === 'bypass') {
            pendingCandidates.delete(routeKey);
            const optimized = buildOptimizedHandler(pending, deps.sandbox, config.experiment.sandboxTimeoutMs || 500);
            deps.shadow.run(routeKey, routeInfo.handle, optimized, _req)
              .then(async (result) => {
                const validated = await deps.validation.validate(pending, result.v1Output, result.v2Output, _req, {
                  v1Latency: result.v1Latency,
                  v2Latency: result.v2Latency,
                });
                if (validated.overall) {
                  deps.rollback.registerShadow(routeKey, { route: routeInfo.route, index: routeInfo.index }, routeInfo.handle, optimized);
                  const report = deps.shadow.getReport(routeKey);
                  if (report && report.sampleSize >= config.experiment.shadowSampleSize) {
                    const evalResult = deps.rollback.evaluate(routeKey, report);
                    if (evalResult === 'promote') {
                      deps.endpointTracker.recordSuccess(routeKey);
                      deps.events.emitEvent('optimization:promoted', {
                        routeKey,
                        candidateId: pending.id,
                        latencyImprovement: result.v1Latency - result.v2Latency,
                      });
                      deps.logger.info('Optimization promoted', {
                        routeKey,
                        candidateId: pending.id,
                        improvement: `${Math.round(result.v1Latency - result.v2Latency)}ms`,
                      });
                    }
                  }
                } else {
                  deps.endpointTracker.markAsNonOptimizable(routeKey, 'Validation failed');
                  deps.events.emitEvent('optimization:rejected', {
                    routeKey,
                    candidateId: pending.id,
                    reason: 'Validation failed',
                  });
                }
              })
              .catch((err) => {
                deps.endpointTracker.markAsNonOptimizable(routeKey, 'Shadow test error');
                deps.events.emitEvent('error:sandbox', {
                  routeKey,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          }

          deps.metrics.record(routeKey, info.duration, info.statusCode, info.responseSize, info.payloadSize, info.error, info.timeout);

          // Feed health data to endpoint tracker
          if (info.error) {
            deps.endpointTracker.recordErrorRequest(routeKey);
          } else {
            deps.endpointTracker.recordHealthyRequest(routeKey);
          }

          // Only enqueue for analysis in bypass mode
          if (config.mode !== 'bypass') return;
          if (deps.rollback.isPromoted(routeKey)) return;
          if (!deps.shadowLimiter.canRun(_req, routeKey)) return;
          if (Math.random() * 100 >= config.experiment.canaryPercent) return;

          const routeMetrics = deps.metrics.forRoute(routeKey);
          if (config.learning.enabled && routeMetrics && routeMetrics.requestCount < config.learning.sampleSize) {
            return;
          }

          if (deps.endpointTracker.shouldSkipOptimization(routeKey)) return;

          if (routeMetrics) {
            const analysis = deps.metricsAnalyzer.analyze(routeKey, routeMetrics);
            if (!analysis.needsOptimization) {
              deps.endpointTracker.markAsOptimizable(routeKey);
              return;
            }
          }

          // Check for anomalies
          const anomaly = (deps.metrics as any).getAnomalies?.(routeKey);
          if (anomaly?.isAnomaly) {
            events.emitEvent('metrics:threshold', {
              routeKey,
              metric: 'latency_anomaly',
              value: anomaly.latestAvg,
              threshold: anomaly.rollingMean + anomaly.stdDev * 3,
            });
          }

          // Enqueue to background worker instead of processing inline
          const priority = routeMetrics ? Math.min(10, Math.round(routeMetrics.requestCount / 100)) : 1;
          worker.enqueue(routeKey, priority);
        } catch (err) {
          events.emitEvent('error:internal', {
            component: 'middleware',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      },
    );
  };
}

/**
 * Process an optimization for a route — called by the background worker.
 */
async function processOptimization(config: SeimConfig, deps: MiddlewareDeps, routeKey: string): Promise<void> {
  const { adapter, events, logger } = deps;

  // For Express, we need a route handler — but we can't get it without a request.
  // The worker processes the route based on previously seen source code.
  // For now, we store source code when first seen and re-use it.
  const source = sourceCache.get(routeKey);
  if (!source) {
    logger.debug('No cached source for route, skipping', { routeKey });
    return;
  }

  const routeMetrics = deps.metrics.forRoute(routeKey);
  const candidates = await deps.optimization.analyzeWithMetricsCheck(
    routeKey,
    source,
    routeMetrics,
    deps.endpointTracker,
  );

  for (const candidate of candidates) {
    if (!candidate.optimizedCode) continue;

    deps.endpointTracker.recordOptimizationAttempt(routeKey);
    events.emitEvent('optimization:detected', {
      routeKey,
      pattern: candidate.pattern,
      severity: candidate.severity,
      candidateId: candidate.id,
    });

    logger.info('Optimization candidate found', {
      routeKey,
      pattern: candidate.pattern,
      severity: candidate.severity,
      candidateId: candidate.id,
    });

    // In CI/CD mode, emit to disk
    if (config.environment === 'production' && config.production?.ciCd?.enabled) {
      const ciCd = new CiCdOptimizer(config);
      await ciCd.publish(routeKey, candidate, { v1Latency: 0, v2Latency: 0, v1Output: null, v2Output: null });
      logger.info('Candidate published to CI/CD output', { routeKey, candidateId: candidate.id });
      continue;
    }

    // For non-CI/CD, we'd need the live handler to run shadow tests.
    // Store the candidate for when the next request comes in.
    pendingCandidates.set(routeKey, candidate);
  }
}

// Source code cache keyed by route
const sourceCache = new Map<string, string>();
// Pending candidates awaiting shadow test on next request
const pendingCandidates = new Map<string, OptimizationCandidate>();

/**
 * Legacy Express-compatible listener for backward compatibility.
 * Uses the adapter layer internally.
 */
export function createExpressListener(config: SeimConfig, deps: MiddlewareDeps): () => RequestHandler {
  const innerListener = createListener(config, deps);

  return function listener(): RequestHandler {
    const middleware = innerListener();

    return function seimListener(req: Request, res: Response, next: NextFunction): void {
      // Cache source code for background worker
      const routeInfo = findRouteHandler(req);
      if (routeInfo) {
        sourceCache.set(deps.adapter.getRouteKey(req), routeInfo.source);
      }

      // Check for pending candidates that need shadow testing
      const routeKey = deps.adapter.getRouteKey(req);
      const pending = pendingCandidates.get(routeKey);
      if (pending && routeInfo && config.mode === 'bypass') {
        pendingCandidates.delete(routeKey);
        // Run shadow test inline
        const optimized = buildOptimizedHandler(pending, deps.sandbox, config.experiment.sandboxTimeoutMs || 500);
        deps.shadow.run(routeKey, routeInfo.handle, optimized, req)
          .then(async (result) => {
            const validated = await deps.validation.validate(pending, result.v1Output, result.v2Output, req, {
              v1Latency: result.v1Latency,
              v2Latency: result.v2Latency,
            });
            if (validated.overall) {
              deps.rollback.registerShadow(routeKey, { route: routeInfo.route, index: routeInfo.index }, routeInfo.handle, optimized);
              const report = deps.shadow.getReport(routeKey);
              if (report && report.sampleSize >= config.experiment.shadowSampleSize) {
                const evalResult = deps.rollback.evaluate(routeKey, report);
                if (evalResult === 'promote') {
                  deps.endpointTracker.recordSuccess(routeKey);
                  deps.events.emitEvent('optimization:promoted', {
                    routeKey,
                    candidateId: pending.id,
                    latencyImprovement: result.v1Latency - result.v2Latency,
                  });
                  deps.logger.info('Optimization promoted', {
                    routeKey,
                    candidateId: pending.id,
                    improvement: `${Math.round(result.v1Latency - result.v2Latency)}ms`,
                  });
                }
              }
            } else {
              deps.endpointTracker.markAsNonOptimizable(routeKey, 'Validation failed');
              deps.events.emitEvent('optimization:rejected', {
                routeKey,
                candidateId: pending.id,
                reason: 'Validation failed',
              });
            }
          })
          .catch((err) => {
            deps.endpointTracker.markAsNonOptimizable(routeKey, 'Shadow test error');
            deps.events.emitEvent('error:sandbox', {
              routeKey,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }

      // Call the adapter middleware
      middleware(req, res, next);
    };
  };
}

function findRouteHandler(req: Request): { route: any; index: number; handle: RequestHandler; source: string } | undefined {
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

function buildOptimizedHandler(candidate: OptimizationCandidate, sandbox: Sandbox, timeoutMs = 500): RequestHandler {
  return function optimizedHandler(req: Request, res: Response, next: NextFunction): void {
    sandbox.run(candidate.optimizedCode || '', candidate.originalCode || '', req, res, next, timeoutMs).catch((err) => {
      next(err instanceof Error ? err : new Error(String(err)));
    });
  };
}
