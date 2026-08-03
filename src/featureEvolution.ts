import { FeatureOpportunity, FeatureVariant, UserBehaviorData, ABTest, SeimConfig } from './types';
import { LLMClient } from './ai';
import { BusinessMetricsStore } from './businessMetrics';
import { BehaviorAnalysisEngine } from './behaviorAnalysis';
import { SeimEventBus } from './events';
import { Logger } from './logger';

export interface TestOutcome {
  userId: string;
  variant: string;
  kpis: Record<string, number>;
  timestamp: number;
}

export class FeatureEvolutionEngine {
  private activeTests: Map<string, ABTest> = new Map();
  private testResults: Map<string, TestOutcome[]> = new Map();

  constructor(
    private config: SeimConfig,
    private llm: LLMClient,
    private businessMetrics: BusinessMetricsStore,
    private behaviorAnalysis?: BehaviorAnalysisEngine,
    private events?: SeimEventBus,
    private logger?: Logger
  ) {}

  /**
   * Analyze user behavior to find feature evolution opportunities
   */
  async analyzeFeatureOpportunities(routeKey: string, userBehavior: UserBehaviorData): Promise<FeatureOpportunity[]> {
    if (!this.behaviorAnalysis) {
      return [];
    }
    
    const recommendations = this.behaviorAnalysis.getFeatureRecommendations(routeKey);
    
    this.logger?.info('Feature opportunities analyzed', {
      routeKey,
      opportunities: recommendations.opportunities.length,
      aggregateInsights: recommendations.aggregateInsights
    });

    this.events?.emitEvent('feature:opportunities_analyzed', {
      routeKey,
      opportunities: recommendations.opportunities,
      insights: recommendations.aggregateInsights
    });

    return recommendations.opportunities;
  }

  /**
   * Generate a feature variant based on an opportunity
   */
  async generateFeatureVariant(routeKey: string, opportunity: FeatureOpportunity): Promise<FeatureVariant> {
    const routeMetrics = this.businessMetrics.getRouteMetrics(routeKey);
    const userBehavior = await this.getRepresentativeBehavior(routeKey);

    let code: string | undefined;
    let strategy = 'template';

    // Try AI-based generation first if enabled
    if (this.config.ai.enabled) {
      try {
        code = await this.llm.generateFeatureVariant(
          routeKey,
          opportunity,
          userBehavior,
          routeMetrics
        );
        strategy = 'ai-generated';
      } catch (error) {
        this.logger?.warn('AI feature generation failed, falling back to template', { error });
      }
    }

    // Fallback to template-based generation
    if (!code) {
      code = this.generateTemplateVariant(routeKey, opportunity);
      strategy = 'template';
    }

    const variant: FeatureVariant = {
      id: `${routeKey}::${opportunity.id}::${Date.now()}`,
      code: code || '',
      strategy,
      metadata: {
        opportunityId: opportunity.id,
        opportunityType: opportunity.type,
        expectedImpact: opportunity.expectedImpact,
        confidence: opportunity.confidence,
        generatedAt: Date.now()
      }
    };

    this.logger?.info('Feature variant generated', {
      routeKey,
      variantId: variant.id,
      strategy,
      opportunityType: opportunity.type
    });

    return variant;
  }

  /**
   * Start an A/B test for a feature
   */
  startABTest(featureId: string, variants: FeatureVariant[]): ABTest {
    const testId = `${featureId}::${Date.now()}`;
    
    const test: ABTest = {
      id: testId,
      featureId,
      variants,
      status: 'running',
      startedAt: Date.now(),
      config: {
        featureId,
        sampleSize: this.config.featureEvolution?.abTestSampleSize || 1000,
        duration: this.config.featureEvolution?.abTestDuration || 7 * 24 * 60 * 60 * 1000, // 7 days
        trafficSplit: {},
        successMetrics: ['conversionRate', 'engagement', 'retention']
      }
    };

    // Set up traffic split (equal distribution by default)
    const split = 100 / variants.length;
    variants.forEach((variant, index) => {
      test.config.trafficSplit[variant.id] = split;
    });

    this.activeTests.set(testId, test);
    this.testResults.set(testId, []);

    this.logger?.info('A/B test started', {
      testId,
      featureId,
      variants: variants.length,
      duration: test.config.duration
    });

    this.events?.emitEvent('feature:abtest_started', {
      testId,
      routeKey: featureId
    });

    return test;
  }

  /**
   * Record a test result for a specific user
   */
  recordABTestResult(testId: string, variant: string, userId: string, outcome: TestOutcome): void {
    const results = this.testResults.get(testId);
    if (!results) {
      this.logger?.warn('Test result recorded for unknown test', { testId });
      return;
    }

    results.push(outcome);
    this.testResults.set(testId, results);

    // Also record in business metrics
    this.businessMetrics.recordFeatureImpression(
      this.activeTests.get(testId)?.featureId || '',
      variant,
      userId,
      outcome
    );

    // Check if test should be evaluated
    this.evaluateTestIfNeeded(testId);
  }

  /**
   * Evaluate an A/B test and determine winner
   */
  evaluateABTest(testId: string): any {
    const test = this.activeTests.get(testId);
    if (!test) {
      return { error: 'Test not found' };
    }

    const results = this.testResults.get(testId) || [];
    
    if (results.length < test.config.sampleSize) {
      return { status: 'insufficient_data', samplesNeeded: test.config.sampleSize - results.length };
    }

    // Calculate KPIs for each variant
    const variantKPIs: Record<string, any> = {};
    test.variants.forEach(variant => {
      const variantResults = results.filter(r => r.variant === variant.id);
      variantKPIs[variant.id] = this.calculateVariantKPIs(variantResults);
    });

    // Determine winner based on primary metric (conversion rate)
    let winner = test.variants[0].id;
    let bestConversionRate = 0;

    Object.entries(variantKPIs).forEach(([variantId, kpis]) => {
      if (kpis.conversionRate > bestConversionRate) {
        bestConversionRate = kpis.conversionRate;
        winner = variantId;
      }
    });

    // Calculate statistical significance
    const significance = this.calculateStatisticalSignificance(variantKPIs);

    const result = {
      testId,
      winner,
      confidence: significance,
      variantKPIs,
      status: 'completed',
      recommendations: this.generateTestRecommendations(variantKPIs, winner)
    };

    // Update test status
    test.status = 'completed';
    test.endedAt = Date.now();
    this.activeTests.set(testId, test);

    this.logger?.info('A/B test evaluated', result);
    this.events?.emitEvent('feature:abtest_completed', result);

    return result;
  }

  /**
   * Get all active tests
   */
  getActiveTests(): ABTest[] {
    return Array.from(this.activeTests.values());
  }

  /**
   * Get a specific test
   */
  getTest(testId: string): ABTest | undefined {
    return this.activeTests.get(testId);
  }

  /**
   * Stop a test
   */
  stopTest(testId: string, reason: string): boolean {
    const test = this.activeTests.get(testId);
    if (!test) return false;

    test.status = 'stopped';
    test.endedAt = Date.now();
    this.activeTests.set(testId, test);

    this.logger?.info('A/B test stopped', { testId, reason });
    this.events?.emitEvent('featureflag:updated', { flagId: testId, updates: { reason } });

    return true;
  }

  // Private methods

  private async getRepresentativeBehavior(routeKey: string): Promise<UserBehaviorData> {
    // Get aggregate behavior for the route
    const routeMetrics = this.businessMetrics.getRouteMetrics(routeKey);
    
    // In production, this would aggregate real user behavior data
    // For now, return a placeholder
    return {
      userId: 'aggregate',
      actions: [],
      segments: [],
      kpis: {
        conversionRate: routeMetrics.conversionRate,
        engagement: routeMetrics.averageEngagement
      }
    };
  }

  private generateTemplateVariant(routeKey: string, opportunity: FeatureOpportunity): string {
    // Template-based feature generation based on opportunity type
    switch (opportunity.type) {
      case 'personalization':
        return `// Personalization enhancement for ${routeKey}
// Based on user behavior analysis
// Expected impact: ${(opportunity.expectedImpact * 100).toFixed(0)}% improvement
const personalizedData = await getPersonalizedData(req.user.id);
res.json({ ...data, personalized: personalizedData });`;

      case 'recommendation':
        return `// Recommendation enhancement for ${routeKey}
// Based on user behavior analysis
// Expected impact: ${(opportunity.expectedImpact * 100).toFixed(0)}% improvement
const recommendations = await getRecommendations(req.user.id, data);
res.json({ ...data, recommendations });`;

      case 'pricing':
        return `// Pricing optimization for ${routeKey}
// Based on user behavior analysis
// Expected impact: ${(opportunity.expectedImpact * 100).toFixed(0)}% improvement
const dynamicPricing = await calculateDynamicPricing(req.user.id, data);
res.json({ ...data, pricing: dynamicPricing });`;

      case 'content':
        return `// Content optimization for ${routeKey}
// Based on user behavior analysis
// Expected impact: ${(opportunity.expectedImpact * 100).toFixed(0)}% improvement
const optimizedContent = await optimizeContent(req.user.id, data);
res.json({ ...data, content: optimizedContent });`;

      default:
        return `// Generic optimization for ${routeKey}
res.json(data);`;
    }
  }

  private calculateVariantKPIs(results: TestOutcome[]): any {
    if (results.length === 0) {
      return { conversionRate: 0, engagement: 0, retention: 0 };
    }

    const conversions = results.filter(r => r.kpis.converted).length;
    const totalEngagement = results.reduce((sum, r) => sum + (r.kpis.engagement || 0), 0);
    const returningUsers = results.filter(r => r.kpis.returning).length;

    return {
      conversionRate: conversions / results.length,
      engagement: totalEngagement / results.length,
      retention: returningUsers / results.length
    };
  }

  private calculateStatisticalSignificance(variantKPIs: Record<string, any>): number {
    const entries = Object.entries(variantKPIs);
    if (entries.length < 2) return 0;

    // Simplified statistical significance calculation
    // In production, use proper statistical tests
    const [variantA, kpisA] = entries[0];
    const [variantB, kpisB] = entries[1];

    const nA = 100; // Placeholder - would use actual sample sizes
    const nB = 100;
    const pA = kpisA.conversionRate;
    const pB = kpisB.conversionRate;

    const pooledP = (kpisA.conversionRate * nA + kpisB.conversionRate * nB) / (nA + nB);
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/nA + 1/nB));

    if (se === 0) return 0;

    const z = Math.abs(pB - pA) / se;
    const confidence = Math.min(0.99, 1 - Math.exp(-Math.abs(z) / 2));

    return confidence;
  }

  private generateTestRecommendations(variantKPIs: Record<string, any>, winner: string): string[] {
    const recommendations: string[] = [];

    const winnerKPIs = variantKPIs[winner];
    const improvement = winnerKPIs.conversionRate * 100;

    recommendations.push(`Promote variant ${winner} with ${improvement.toFixed(1)}% conversion rate`);

    // Additional recommendations based on other metrics
    Object.entries(variantKPIs).forEach(([variantId, kpis]) => {
      if (variantId !== winner && kpis.engagement > winnerKPIs.engagement * 1.2) {
        recommendations.push(`Consider hybrid approach for ${variantId} due to higher engagement`);
      }
    });

    return recommendations;
  }

  private evaluateTestIfNeeded(testId: string): void {
    const test = this.activeTests.get(testId);
    if (!test || test.status !== 'running') return;

    const results = this.testResults.get(testId) || [];
    const elapsed = Date.now() - test.startedAt;

    // Auto-evaluate if we have enough data or time has elapsed
    if (results.length >= test.config.sampleSize || elapsed >= test.config.duration) {
      this.evaluateABTest(testId);
    }
  }

  /**
   * Get statistics about the feature evolution engine
   */
  getStats(): {
    activeTests: number;
    completedTests: number;
    totalResults: number;
  } {
    const completedTests = Array.from(this.activeTests.values()).filter(t => t.status === 'completed').length;
    const totalResults = Array.from(this.testResults.values()).reduce((sum, results) => sum + results.length, 0);

    return {
      activeTests: this.activeTests.size,
      completedTests,
      totalResults
    };
  }
}