import { MetricsStore, MetricsSnapshot, RouteMetrics, HotRoute } from './types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

interface TimedEntry {
  ts: number;
  value: number;
}

interface MinuteBucket {
  minute: number;
  count: number;
  totalDuration: number;
  errorCount: number;
}

interface RouteTimedData {
  durations: TimedEntry[];
  responseSizes: TimedEntry[];
  payloadSizes: TimedEntry[];
  minuteBuckets: Map<number, MinuteBucket>;
  requestCount: number;
  errorCount: number;
  timeoutCount: number;
  totalDuration: number;
  statusCodes: Record<number, number>;
  lastSeen: number;
}

const DEFAULT_WINDOW_MS = 300_000; // 5 minutes
const CLEANUP_INTERVAL = 100;      // run cleanup every N records
const MAX_BUCKET_MINUTES = 60;     // keep last 60 minutes of buckets
const ANOMALY_SAMPLE_SIZE = 10;    // number of latest entries for anomaly check
const ANOMALY_THRESHOLD = 3;       // standard deviations

export class InMemoryMetricsStore implements MetricsStore {
  private timedRoutes: Map<string, RouteTimedData> = new Map();
  private startTime = Date.now();
  private windowMs: number;
  private recordCount = 0;

  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

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
    let r = this.timedRoutes.get(routeKey);
    if (!r) {
      r = {
        durations: [],
        responseSizes: [],
        payloadSizes: [],
        minuteBuckets: new Map(),
        requestCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 0,
        statusCodes: {},
        lastSeen: now,
      };
      this.timedRoutes.set(routeKey, r);
    }

    r.requestCount += 1;
    r.totalDuration += duration;
    r.durations.push({ ts: now, value: duration });
    r.responseSizes.push({ ts: now, value: responseSize });
    r.payloadSizes.push({ ts: now, value: payloadSize });
    r.statusCodes[statusCode] = (r.statusCodes[statusCode] || 0) + 1;
    if (error) r.errorCount += 1;
    if (timeout) r.timeoutCount += 1;
    r.lastSeen = now;

    // Update minute bucket
    const minuteKey = Math.floor(now / 60_000);
    let bucket = r.minuteBuckets.get(minuteKey);
    if (!bucket) {
      bucket = { minute: minuteKey, count: 0, totalDuration: 0, errorCount: 0 };
      r.minuteBuckets.set(minuteKey, bucket);
    }
    bucket.count += 1;
    bucket.totalDuration += duration;
    if (error) bucket.errorCount += 1;

    // Periodic cleanup
    this.recordCount += 1;
    if (this.recordCount % CLEANUP_INTERVAL === 0) {
      this.cleanup(now);
    }
  }

  public forRoute(routeKey: string): RouteMetrics | undefined {
    const r = this.timedRoutes.get(routeKey);
    if (!r) return undefined;

    const now = Date.now();
    const cutoff = now - this.windowMs;

    return {
      requestCount: r.requestCount,
      errorCount: r.errorCount,
      timeoutCount: r.timeoutCount,
      totalDuration: r.totalDuration,
      durations: this.filterWindow(r.durations, cutoff),
      responseSizes: this.filterWindow(r.responseSizes, cutoff),
      payloadSizes: this.filterWindow(r.payloadSizes, cutoff),
      statusCodes: { ...r.statusCodes },
      lastSeen: r.lastSeen,
    };
  }

  public hotRoutes(limit = 10): HotRoute[] {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    return Array.from(this.timedRoutes.entries())
      .map(([routeKey, r]) => this.toHotRoute(routeKey, r, cutoff))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);
  }

  public snapshot(): MetricsSnapshot {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const hotRoutes = this.hotRoutes(20);
    let totalRequests = 0;
    let totalErrors = 0;
    let totalDuration = 0;
    const allDurations: number[] = [];
    const routeEntries: [string, RouteMetrics][] = [];

    for (const [key, r] of this.timedRoutes) {
      totalRequests += r.requestCount;
      totalErrors += r.errorCount;
      totalDuration += r.totalDuration;
      const windowDurations = this.filterWindow(r.durations, cutoff);
      allDurations.push(...windowDurations);
      routeEntries.push([key, {
        requestCount: r.requestCount,
        errorCount: r.errorCount,
        timeoutCount: r.timeoutCount,
        totalDuration: r.totalDuration,
        durations: windowDurations,
        responseSizes: this.filterWindow(r.responseSizes, cutoff),
        payloadSizes: this.filterWindow(r.payloadSizes, cutoff),
        statusCodes: { ...r.statusCodes },
        lastSeen: r.lastSeen,
      }]);
    }

    const sorted = allDurations.slice().sort((a, b) => a - b);
    const windowSeconds = Math.max(1, (now - this.startTime) / 1000);

    return {
      routes: Object.fromEntries(routeEntries),
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
      generatedAt: now,
    };
  }

  public getAnomalies(
    routeKey: string
  ): { isAnomaly: boolean; latestAvg: number; rollingMean: number; stdDev: number } | undefined {
    const r = this.timedRoutes.get(routeKey);
    if (!r) return undefined;

    const now = Date.now();
    const cutoff = now - this.windowMs;
    const windowEntries = r.durations.filter((e) => e.ts >= cutoff);
    if (windowEntries.length < ANOMALY_SAMPLE_SIZE + 1) {
      return { isAnomaly: false, latestAvg: 0, rollingMean: 0, stdDev: 0 };
    }

    const values = windowEntries.map((e) => e.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    const latest = values.slice(-ANOMALY_SAMPLE_SIZE);
    const latestAvg = latest.reduce((s, v) => s + v, 0) / latest.length;

    const isAnomaly = stdDev > 0 && Math.abs(latestAvg - mean) > ANOMALY_THRESHOLD * stdDev;

    return { isAnomaly, latestAvg, rollingMean: mean, stdDev };
  }

  public getTimeBuckets(routeKey: string, minutes: number = MAX_BUCKET_MINUTES): MinuteBucket[] {
    const r = this.timedRoutes.get(routeKey);
    if (!r) return [];

    const now = Date.now();
    const cutoffMinute = Math.floor(now / 60_000) - minutes;

    return Array.from(r.minuteBuckets.values())
      .filter((b) => b.minute > cutoffMinute)
      .sort((a, b) => a.minute - b.minute);
  }

  // ---- private helpers ----

  private filterWindow(entries: TimedEntry[], cutoff: number): number[] {
    const result: number[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].ts >= cutoff) {
        result.push(entries[i].value);
      } else {
        break; // entries are in chronological order, so stop early
      }
    }
    result.reverse();
    return result;
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs;
    const bucketCutoff = Math.floor(now / 60_000) - MAX_BUCKET_MINUTES;

    for (const r of this.timedRoutes.values()) {
      r.durations = this.pruneStale(r.durations, cutoff);
      r.responseSizes = this.pruneStale(r.responseSizes, cutoff);
      r.payloadSizes = this.pruneStale(r.payloadSizes, cutoff);

      for (const [key] of r.minuteBuckets) {
        if (key <= bucketCutoff) {
          r.minuteBuckets.delete(key);
        }
      }
    }
  }

  private pruneStale(entries: TimedEntry[], cutoff: number): TimedEntry[] {
    let startIdx = 0;
    for (; startIdx < entries.length; startIdx++) {
      if (entries[startIdx].ts >= cutoff) break;
    }
    return startIdx === 0 ? entries : entries.slice(startIdx);
  }

  private toHotRoute(routeKey: string, r: RouteTimedData, cutoff: number): HotRoute {
    const windowDurations = this.filterWindow(r.durations, cutoff);
    const sorted = windowDurations.slice().sort((a, b) => a - b);
    const seconds = Math.max(1, (Date.now() - this.startTime) / 1000);
    return {
      routeKey,
      requestCount: r.requestCount,
      averageLatency: r.requestCount === 0 ? 0 : r.totalDuration / r.requestCount,
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      errorRate: r.requestCount === 0 ? 0 : r.errorCount / r.requestCount,
      throughput: r.requestCount / seconds,
    };
  }

  private peakTrafficTime(): number | undefined {
    let maxKey: number | undefined;
    let maxCount = -1;
    for (const [, r] of this.timedRoutes) {
      if (r.requestCount > maxCount) {
        maxCount = r.requestCount;
        maxKey = r.lastSeen;
      }
    }
    return maxKey;
  }
}
