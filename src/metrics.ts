import { MetricsStore, MetricsSnapshot, RouteMetrics, HotRoute } from './types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export class InMemoryMetricsStore implements MetricsStore {
  private routes: Map<string, RouteMetrics> = new Map();
  private startTime = Date.now();

  public record(
    routeKey: string,
    duration: number,
    statusCode: number,
    responseSize: number,
    payloadSize: number,
    error: boolean,
    timeout: boolean
  ): void {
    const now = Date.now();
    let m = this.routes.get(routeKey);
    if (!m) {
      m = {
        requestCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 0,
        durations: [],
        responseSizes: [],
        payloadSizes: [],
        statusCodes: {},
        lastSeen: now,
      };
      this.routes.set(routeKey, m);
    }
    m.requestCount += 1;
    m.totalDuration += duration;
    m.durations.push(duration);
    m.responseSizes.push(responseSize);
    m.payloadSizes.push(payloadSize);
    m.statusCodes[statusCode] = (m.statusCodes[statusCode] || 0) + 1;
    if (error) m.errorCount += 1;
    if (timeout) m.timeoutCount += 1;
    m.lastSeen = now;
    if (m.durations.length > 10000) m.durations.shift();
    if (m.responseSizes.length > 10000) m.responseSizes.shift();
    if (m.payloadSizes.length > 10000) m.payloadSizes.shift();
  }

  public forRoute(routeKey: string): RouteMetrics | undefined {
    return this.routes.get(routeKey);
  }

  public hotRoutes(limit = 10): HotRoute[] {
    return Array.from(this.routes.entries())
      .map(([routeKey, m]) => this.toHotRoute(routeKey, m))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);
  }

  public snapshot(): MetricsSnapshot {
    const hotRoutes = this.hotRoutes(20);
    let totalRequests = 0;
    let totalErrors = 0;
    let totalDuration = 0;
    const allDurations: number[] = [];

    for (const m of this.routes.values()) {
      totalRequests += m.requestCount;
      totalErrors += m.errorCount;
      totalDuration += m.totalDuration;
      allDurations.push(...m.durations);
    }

    const sorted = allDurations.slice().sort((a, b) => a - b);
    const windowSeconds = Math.max(1, (Date.now() - this.startTime) / 1000);

    return {
      routes: Object.fromEntries(this.routes),
      hotRoutes,
      aggregate: {
        totalRequests,
        totalErrors,
        averageLatency: totalRequests === 0 ? 0 : totalDuration / totalRequests,
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        throughput: totalRequests / windowSeconds,
        peakTrafficTime: this.peakTrafficTime(),
      },
      system: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime(),
      },
      generatedAt: Date.now(),
    };
  }

  private toHotRoute(routeKey: string, m: RouteMetrics): HotRoute {
    const sorted = m.durations.slice().sort((a, b) => a - b);
    const seconds = Math.max(1, (Date.now() - this.startTime) / 1000);
    return {
      routeKey,
      requestCount: m.requestCount,
      averageLatency: m.requestCount === 0 ? 0 : m.totalDuration / m.requestCount,
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      errorRate: m.requestCount === 0 ? 0 : m.errorCount / m.requestCount,
      throughput: m.requestCount / seconds,
    };
  }

  private peakTrafficTime(): number | undefined {
    let maxKey: number | undefined;
    let maxCount = -1;
    for (const [, m] of this.routes) {
      if (m.requestCount > maxCount) {
        maxCount = m.requestCount;
        maxKey = m.lastSeen;
      }
    }
    return maxKey;
  }
}
