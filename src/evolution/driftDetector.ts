import { SeimConfig, RouteMetrics } from '../types';
import { InMemoryMetricsStore } from '../metrics';
import { OptimizationWorker } from '../worker';
import { Logger } from '../logger';
import { SeimEventBus } from '../events';

interface PromotedBaseline {
  routeKey: string;
  promotedAt: number;
  baselineP95: number;
  baselineAvgLatency: number;
  baselineErrorRate: number;
  lastChecked: number;
}

/**
 * DriftDetector monitors promoted routes for performance degradation over time.
 * 
 * When a route is promoted, its current metrics are recorded as a baseline.
 * Periodically, the detector checks if the route has degraded beyond a threshold.
 * If so, the route re-enters the evolution loop.
 */
export class DriftDetector {
  private baselines: Map<string, PromotedBaseline> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private config: SeimConfig,
    private metrics: InMemoryMetricsStore,
    private worker: OptimizationWorker,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * Start periodic drift detection.
   */
  public start(): void {
    if (!this.config.evolution?.driftDetection) return;
    const interval = this.config.evolution?.driftCheckIntervalMs ?? 300_000; // 5 min default
    this.timer = setInterval(() => this.check(), interval);
    if (this.timer.unref) this.timer.unref();
    this.logger.debug('Drift detector started', { intervalMs: interval });
  }

  /**
   * Stop periodic drift detection.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Record the baseline metrics for a newly promoted route.
   */
  public recordBaseline(routeKey: string, routeMetrics: RouteMetrics): void {
    const sorted = [...routeMetrics.durations].sort((a, b) => a - b);
    const p95Idx = Math.ceil((95 / 100) * sorted.length) - 1;
    const p95 = sorted.length > 0 ? sorted[Math.max(0, p95Idx)] : 0;
    const avgLatency = routeMetrics.requestCount === 0 ? 0 : routeMetrics.totalDuration / routeMetrics.requestCount;
    const errorRate = routeMetrics.requestCount === 0 ? 0 : routeMetrics.errorCount / routeMetrics.requestCount;

    this.baselines.set(routeKey, {
      routeKey,
      promotedAt: Date.now(),
      baselineP95: p95,
      baselineAvgLatency: avgLatency,
      baselineErrorRate: errorRate,
      lastChecked: Date.now(),
    });

    this.logger.debug('Drift baseline recorded', {
      routeKey,
      p95,
      avgLatency: avgLatency.toFixed(1),
      errorRate: (errorRate * 100).toFixed(2),
    });
  }

  /**
   * Check all promoted routes for drift.
   */
  public check(): void {
    const threshold = this.config.evolution?.driftThresholdPercent ?? 20;

    for (const [routeKey, baseline] of this.baselines) {
      const current = this.metrics.forRoute(routeKey);
      if (!current || current.requestCount < 10) continue;

      const sorted = [...current.durations].sort((a, b) => a - b);
      const p95Idx = Math.ceil((95 / 100) * sorted.length) - 1;
      const currentP95 = sorted.length > 0 ? sorted[Math.max(0, p95Idx)] : 0;

      if (baseline.baselineP95 === 0) continue;

      const degradation = ((currentP95 - baseline.baselineP95) / baseline.baselineP95) * 100;

      if (degradation > threshold) {
        this.logger.warn('Performance drift detected', {
          routeKey,
          currentP95: currentP95.toFixed(1),
          baselineP95: baseline.baselineP95.toFixed(1),
          degradation: `${degradation.toFixed(1)}%`,
        });

        this.events.emitEvent('evolution:drift-detected', {
          routeKey,
          currentP95,
          promotedP95: baseline.baselineP95,
          degradationPercent: degradation,
        });

        // Re-enter evolution loop with high priority
        this.worker.enqueue(routeKey, 9);

        // Update baseline check time
        baseline.lastChecked = Date.now();
      }
    }
  }

  /**
   * Remove a route's baseline (e.g., after rollback).
   */
  public removeBaseline(routeKey: string): void {
    this.baselines.delete(routeKey);
  }

  /**
   * Get all tracked baselines.
   */
  public getBaselines(): PromotedBaseline[] {
    return Array.from(this.baselines.values());
  }

  public size(): number {
    return this.baselines.size;
  }
}
