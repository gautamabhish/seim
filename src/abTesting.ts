import { ABTest, ABTestConfig, StatisticalResult, TestResult, SeimConfig, FeatureVariant } from './types';
import { BusinessMetricsStore } from './businessMetrics';
import { SeimEventBus } from './events';
import { Logger } from './logger';

export class ABTestEngine {
  private tests: Map<string, ABTest> = new Map();
  private userAssignments: Map<string, Map<string, string>> = new Map(); // testId -> userId -> variant

  constructor(
    private config: SeimConfig,
    private businessMetrics: BusinessMetricsStore,
    private events: SeimEventBus,
    private logger: Logger
  ) {}

  /**
   * Assign a user to a variant for a test
   */
  assignUserToVariant(userId: string, testId: string): string {
    const test = this.tests.get(testId);
    if (!test) {
      this.logger.warn('Attempted to assign user to unknown test', { testId, userId });
      return 'control';
    }

    // Check if user already assigned
    if (!this.userAssignments.has(testId)) {
      this.userAssignments.set(testId, new Map());
    }

    const assignments = this.userAssignments.get(testId)!;
    if (assignments.has(userId)) {
      return assignments.get(userId)!;
    }

    // Assign based on traffic split
    const variant = this.assignBasedOnSplit(test.config.trafficSplit);
    assignments.set(userId, variant);

    // Record impression
    this.businessMetrics.recordFeatureImpression(
      test.featureId,
      variant,
      userId,
      { testId }
    );

    return variant;
  }

  /**
   * Create a new A/B test
   */
  createTest(config: ABTestConfig): ABTest {
    const testId = `abtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const test: ABTest = {
      id: testId,
      featureId: config.featureId || 'unknown',
      variants: [],
      status: 'created',
      startedAt: Date.now(),
      config
    };

    this.tests.set(testId, test);

    this.logger.info('A/B test created', {
      testId,
      featureId: test.featureId,
      sampleSize: config.sampleSize
    });

    this.events.emitEvent('featureflag:created', { flag: test });

    return test;
  }

  /**
   * Start a test
   */
  startTest(testId: string): void {
    const test = this.tests.get(testId);
    if (!test) {
      this.logger.warn('Attempted to start unknown test', { testId });
      return;
    }

    test.status = 'running';
    test.startedAt = Date.now();
    this.tests.set(testId, test);

    this.logger.info('A/B test started', { testId });
    this.events.emitEvent('feature:abtest_started', { testId, routeKey: test.featureId });
  }

  /**
   * Stop a test
   */
  stopTest(testId: string, reason: string): void {
    const test = this.tests.get(testId);
    if (!test) {
      this.logger.warn('Attempted to stop unknown test', { testId });
      return;
    }

    test.status = 'stopped';
    test.endedAt = Date.now();
    this.tests.set(testId, test);

    this.logger.info('A/B test stopped', { testId, reason });
    this.events.emitEvent('featureflag:updated', { flagId: testId, updates: { reason } });
  }

  /**
   * Calculate statistical significance of test results
   */
  calculateSignificance(testId: string): StatisticalResult {
    const test = this.tests.get(testId);
    if (!test) {
      return { significant: false, confidence: 0, pValue: 1 };
    }

    // Get KPIs for each variant
    const variantKPIs: Record<string, any> = {};
    test.variants.forEach(variant => {
      variantKPIs[variant.id] = this.businessMetrics.getFeatureKPIs(test.featureId, variant.id);
    });

    const entries = Object.entries(variantKPIs);
    if (entries.length < 2) {
      return { significant: false, confidence: 0, pValue: 1 };
    }

    // Calculate statistical significance using chi-square test for conversion rates
    const [variantA, kpisA] = entries[0];
    const [variantB, kpisB] = entries[1];

    const nA = kpisA.impressions;
    const nB = kpisB.impressions;
    const convA = kpisA.conversions;
    const convB = kpisB.conversions;

    if (nA < 30 || nB < 30) {
      return { significant: false, confidence: 0, pValue: 1 };
    }

    // Chi-square test
    const totalN = nA + nB;
    const totalConv = convA + convB;
    const expectedA = (nA * totalConv) / totalN;
    const expectedB = (nB * totalConv) / totalN;

    const chiSquare = Math.pow(convA - expectedA, 2) / expectedA + Math.pow(convB - expectedB, 2) / expectedB;
    
    // Convert chi-square to p-value (simplified)
    const pValue = 1 - this.chiSquareCDF(chiSquare, 1);
    const confidence = 1 - pValue;

    const significant = pValue < 0.05 && confidence > 0.95;

    const winner = kpisB.conversionRate > kpisA.conversionRate ? variantB : variantA;

    return {
      significant,
      confidence,
      winner: significant ? winner : undefined,
      pValue
    };
  }

  /**
   * Determine the winner of a test
   */
  determineWinner(testId: string): TestResult | null {
    const test = this.tests.get(testId);
    if (!test || test.status !== 'running') {
      return null;
    }

    const significance = this.calculateSignificance(testId);
    
    if (!significance.significant) {
      return null; // Not enough statistical significance yet
    }

    // Get detailed KPIs for winner selection
    const variantKPIs: Record<string, any> = {};
    test.variants.forEach(variant => {
      variantKPIs[variant.id] = this.businessMetrics.getFeatureKPIs(test.featureId, variant.id);
    });

    // Select winner based on primary success metric
    let winner = test.variants[0].id;
    let bestScore = 0;

    Object.entries(variantKPIs).forEach(([variantId, kpis]) => {
      const score = this.calculateCompositeScore(kpis, test.config.successMetrics);
      if (score > bestScore) {
        bestScore = score;
        winner = variantId;
      }
    });

    const winnerKPIs = variantKPIs[winner];
    const baselineKPIs = variantKPIs[test.variants[0].id];

    const improvement = this.calculateImprovement(baselineKPIs, winnerKPIs);

    const result: TestResult = {
      winner,
      confidence: significance.confidence,
      improvement: improvement.overall,
      recommendations: this.generateRecommendations(variantKPIs, winner, improvement)
    };

    // Update test status
    test.status = 'completed';
    test.endedAt = Date.now();
    this.tests.set(testId, test);

    this.logger.info('A/B test winner determined', {
      testId,
      winner,
      confidence: significance.confidence,
      improvement: improvement.overall
    });

    this.events.emitEvent('feature:abtest_completed', { testId, winner, confidence: significance.confidence });

    return result;
  }

  /**
   * Get all tests
   */
  getAllTests(): ABTest[] {
    return Array.from(this.tests.values());
  }

  /**
   * Get a specific test
   */
  getTest(testId: string): ABTest | undefined {
    return this.tests.get(testId);
  }

  /**
   * Get test results for a variant
   */
  getTestResults(testId: string, variantId: string): any {
    return this.businessMetrics.getFeatureKPIs(
      this.tests.get(testId)?.featureId || '',
      variantId
    );
  }

  /**
   * Get statistics about the A/B testing engine
   */
  getStats(): {
    totalTests: number;
    runningTests: number;
    completedTests: number;
    totalAssignments: number;
  } {
    const totalTests = this.tests.size;
    const runningTests = Array.from(this.tests.values()).filter(t => t.status === 'running').length;
    const completedTests = Array.from(this.tests.values()).filter(t => t.status === 'completed').length;
    
    let totalAssignments = 0;
    this.userAssignments.forEach(assignments => {
      totalAssignments += assignments.size;
    });

    return {
      totalTests,
      runningTests,
      completedTests,
      totalAssignments
    };
  }

  // Private methods

  private assignBasedOnSplit(trafficSplit: Record<string, number>): string {
    const variants = Object.keys(trafficSplit);
    const rand = Math.random() * 100;
    let cumulative = 0;

    for (const variant of variants) {
      cumulative += trafficSplit[variant];
      if (rand < cumulative) {
        return variant;
      }
    }

    return variants[0]; // Fallback to first variant
  }

  private calculateCompositeScore(kpis: any, successMetrics: string[]): number {
    let score = 0;
    let weight = 1 / successMetrics.length;

    successMetrics.forEach(metric => {
      switch (metric) {
        case 'conversionRate':
          score += kpis.conversionRate * weight;
          break;
        case 'engagement':
          score += kpis.averageEngagement * weight;
          break;
        case 'retention':
          score += kpis.retentionRate * weight;
          break;
        default:
          if (kpis.customKPIs && kpis.customKPIs[metric]) {
            score += kpis.customKPIs[metric] * weight;
          }
      }
    });

    return score;
  }

  private calculateImprovement(baseline: any, winner: any): {
    conversionRate: number;
    engagement: number;
    retention: number;
    revenue: number;
    overall: number;
  } {
    const conversionRate = winner.conversionRate - baseline.conversionRate;
    const engagement = winner.averageEngagement - baseline.averageEngagement;
    const retention = winner.retentionRate - baseline.retentionRate;
    const revenue = winner.revenue - baseline.revenue;

    // Overall improvement as weighted average
    const overall = (conversionRate * 0.4 + engagement * 0.3 + retention * 0.2 + revenue * 0.1);

    return {
      conversionRate,
      engagement,
      retention,
      revenue,
      overall
    };
  }

  private generateRecommendations(variantKPIs: Record<string, any>, winner: string, improvement: any): string[] {
    const recommendations: string[] = [];

    const winnerKPIs = variantKPIs[winner];
    const baselineKPIs = variantKPIs[Object.keys(variantKPIs)[0]];

    if (improvement.conversionRate > 0.1) {
      recommendations.push(`Strong conversion improvement (${(improvement.conversionRate * 100).toFixed(1)}%) - recommend full rollout`);
    } else if (improvement.conversionRate > 0.05) {
      recommendations.push(`Moderate conversion improvement (${(improvement.conversionRate * 100).toFixed(1)}%) - consider gradual rollout`);
    } else if (improvement.conversionRate < 0) {
      recommendations.push(`Conversion regression detected - do not rollout`);
    }

    if (improvement.engagement > 0) {
      recommendations.push(`Positive engagement impact (${(improvement.engagement * 100).toFixed(1)}%)`);
    }

    return recommendations;
  }

  private chiSquareCDF(x: number, df: number): number {
    // Simplified chi-square CDF approximation
    // In production, use a proper statistical library
    if (x < 0) return 0;
    if (df === 1) {
      return 1 - 2 * (1 - this.normalCDF(Math.sqrt(x)));
    }
    // For df > 1, would use proper chi-square distribution
    return 1 - Math.exp(-x / 2); // Simplified approximation
  }

  private normalCDF(x: number): number {
    // Standard normal CDF approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);

    return 0.5 * (1 + sign * y);
  }
}