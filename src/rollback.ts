import { RequestHandler } from 'express';
import { SeimConfig, ExperimentReport } from './types';

interface RouteInfo {
  route: any;
  index: number;
}

export class RollbackEngine {
  private activeVersions: Map<string, {
    routeInfo: RouteInfo;
    original: RequestHandler;
    optimized: RequestHandler;
    active: 'original' | 'optimized';
    reports: ExperimentReport[];
  }> = new Map();
  private lastReport: Map<string, ExperimentReport> = new Map();
  private promotionCount = 0;
  private rollbackCount = 0;

  constructor(private config: SeimConfig) {}

  public registerShadow(routeKey: string, routeInfo: RouteInfo, original: RequestHandler, optimized: RequestHandler): void {
    if (this.activeVersions.has(routeKey)) return;
    this.activeVersions.set(routeKey, {
      routeInfo,
      original,
      optimized,
      active: 'original',
      reports: [],
    });
  }

  public evaluate(routeKey: string, report: ExperimentReport): 'promote' | 'rollback' | 'continue' | 'manual-review' {
    const v = this.activeVersions.get(routeKey);
    if (!v) return 'continue';

    const cfg = this.config.experiment;
    v.reports.push(report);
    this.lastReport.set(routeKey, report);

    // Need minimum samples before making any decision
    if (report.sampleSize < cfg.minSampleSize) return 'continue';

    // Check for regressions (only after sufficient samples)
    const v1ErrorRate = report.v1Errors / Math.max(1, report.sampleSize);
    const v2ErrorRate = report.v2Errors / Math.max(1, report.sampleSize);
    if (v2ErrorRate > Math.max(v1ErrorRate * cfg.rollbackErrorRate, 0.01)) {
      this.rollback(routeKey, 'error rate regression');
      return 'rollback';
    }
    if (report.v2Latency > report.v1Latency * cfg.rollbackLatencyMultiplier) {
      this.rollback(routeKey, 'latency regression');
      return 'rollback';
    }
    if (report.sampleSize < cfg.shadowSampleSize) return 'continue';
    if (report.v2Latency < report.v1Latency && report.v2Errors <= report.v1Errors) {
      if (!this.config.autonomousPromotion) {
        return 'manual-review';
      }
      this.promote(routeKey, 'performance improvement and equivalent error rate');
      return 'promote';
    }
    return 'continue';
  }

  public promote(routeKey: string, reason?: string): void {
    const v = this.activeVersions.get(routeKey);
    if (!v || v.active === 'optimized') return;
    v.active = 'optimized';
    this.promotionCount += 1;
    v.routeInfo.route.stack[v.routeInfo.index].handle = v.optimized;
  }

  public rollback(routeKey: string, reason: string): void {
    const v = this.activeVersions.get(routeKey);
    if (!v || v.active === 'original') return;
    v.active = 'original';
    this.rollbackCount += 1;
    v.routeInfo.route.stack[v.routeInfo.index].handle = v.original;
  }

  public promotedCount(): number {
    return this.promotionCount;
  }

  public totalRollbacks(): number {
    return this.rollbackCount;
  }

  public isPromoted(routeKey: string): boolean {
    const v = this.activeVersions.get(routeKey);
    return v ? v.active === 'optimized' : false;
  }

  public list(): { routeKey: string; active: 'original' | 'optimized'; lastReport?: ExperimentReport }[] {
    return Array.from(this.activeVersions.entries()).map(([routeKey, v]) => ({
      routeKey,
      active: v.active,
      lastReport: this.lastReport.get(routeKey),
    }));
  }
}
