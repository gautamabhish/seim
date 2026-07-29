import { RouteMetrics } from './types';

export interface AnalysisResult {
  needsOptimization: boolean;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metrics: {
    averageLatency: number;
    p95: number;
    p99: number;
    errorRate: number;
    throughput: number;
  };
}

export class MetricsAnalyzer {
  private thresholds = {
    // Latency thresholds in milliseconds
    averageLatency: {
      good: 100,
      fair: 500,
      poor: 1000,
    },
    p95Latency: {
      good: 200,
      fair: 1000,
      poor: 2000,
    },
    p99Latency: {
      good: 500,
      fair: 2000,
      poor: 5000,
    },
    // Error rate thresholds (0-1)
    errorRate: {
      good: 0.01,
      fair: 0.05,
      poor: 0.1,
    },
    // Throughput thresholds (requests per second)
    throughput: {
      poor: 1,
      fair: 10,
      good: 100,
    },
  };

  public analyze(routeKey: string, metrics: RouteMetrics): AnalysisResult {
    if (metrics.requestCount < 10) {
      return {
        needsOptimization: false,
        reason: 'Insufficient data (less than 10 requests)',
        priority: 'low',
        metrics: this.calculateMetrics(metrics),
      };
    }

    const calculatedMetrics = this.calculateMetrics(metrics);
    const latencyScore = this.scoreLatency(calculatedMetrics);
    const errorScore = this.scoreErrorRate(calculatedMetrics);
    const throughputScore = this.scoreThroughput(calculatedMetrics);

    const overallScore = (latencyScore + errorScore + throughputScore) / 3;

    if (overallScore >= 0.8) {
      return {
        needsOptimization: false,
        reason: 'Performance is good (within acceptable thresholds)',
        priority: 'low',
        metrics: calculatedMetrics,
      };
    }

    if (overallScore >= 0.6) {
      return {
        needsOptimization: false,
        reason: 'Performance is acceptable',
        priority: 'low',
        metrics: calculatedMetrics,
      };
    }

    // Determine priority based on worst metric
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let reasons: string[] = [];

    if (latencyScore < 0.4) {
      priority = latencyScore < 0.2 ? 'critical' : 'high';
      reasons.push('High latency detected');
    }

    if (errorScore < 0.4) {
      priority = Math.max(this.priorityValue(priority), this.priorityValue('high')) === this.priorityValue('high') ? 'high' : 'critical';
      reasons.push('High error rate detected');
    }

    if (throughputScore < 0.4) {
      if (priority === 'low') priority = 'medium';
      reasons.push('Low throughput detected');
    }

    return {
      needsOptimization: true,
      reason: reasons.join(', ') || 'Performance degradation detected',
      priority,
      metrics: calculatedMetrics,
    };
  }

  private calculateMetrics(metrics: RouteMetrics): AnalysisResult['metrics'] {
    const averageLatency = metrics.requestCount === 0 ? 0 : metrics.totalDuration / metrics.requestCount;
    
    const sortedDurations = [...metrics.durations].sort((a, b) => a - b);
    const p95 = this.percentile(sortedDurations, 95);
    const p99 = this.percentile(sortedDurations, 99);
    
    const errorRate = metrics.requestCount === 0 ? 0 : metrics.errorCount / metrics.requestCount;
    
    // Simple throughput approximation (requests per second based on total duration)
    const totalTimeSeconds = metrics.totalDuration / 1000;
    const throughput = totalTimeSeconds === 0 ? 0 : metrics.requestCount / totalTimeSeconds;

    return {
      averageLatency,
      p95,
      p99,
      errorRate,
      throughput,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private scoreLatency(metrics: AnalysisResult['metrics']): number {
    let score = 0;
    
    // Average latency score
    if (metrics.averageLatency <= this.thresholds.averageLatency.good) score += 1;
    else if (metrics.averageLatency <= this.thresholds.averageLatency.fair) score += 0.6;
    else if (metrics.averageLatency <= this.thresholds.averageLatency.poor) score += 0.3;
    else score += 0;

    // P95 latency score
    if (metrics.p95 <= this.thresholds.p95Latency.good) score += 1;
    else if (metrics.p95 <= this.thresholds.p95Latency.fair) score += 0.6;
    else if (metrics.p95 <= this.thresholds.p95Latency.poor) score += 0.3;
    else score += 0;

    // P99 latency score
    if (metrics.p99 <= this.thresholds.p99Latency.good) score += 1;
    else if (metrics.p99 <= this.thresholds.p99Latency.fair) score += 0.6;
    else if (metrics.p99 <= this.thresholds.p99Latency.poor) score += 0.3;
    else score += 0;

    return score / 3;
  }

  private scoreErrorRate(metrics: AnalysisResult['metrics']): number {
    if (metrics.errorRate <= this.thresholds.errorRate.good) return 1;
    if (metrics.errorRate <= this.thresholds.errorRate.fair) return 0.6;
    if (metrics.errorRate <= this.thresholds.errorRate.poor) return 0.3;
    return 0;
  }

  private scoreThroughput(metrics: AnalysisResult['metrics']): number {
    if (metrics.throughput >= this.thresholds.throughput.good) return 1;
    if (metrics.throughput >= this.thresholds.throughput.fair) return 0.6;
    if (metrics.throughput >= this.thresholds.throughput.poor) return 0.3;
    return 0;
  }

  private priorityValue(priority: 'low' | 'medium' | 'high' | 'critical'): number {
    const values = { low: 1, medium: 2, high: 3, critical: 4 };
    return values[priority];
  }
}
