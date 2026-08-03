import { BusinessMetricsStore } from './businessMetrics';
import { AnalyticsAdapter } from './analytics/adapter';
import { FeatureOpportunity, UserBehaviorData, UserAction, SeimConfig } from './types';

export interface UsagePattern {
  type: string;
  frequency: number;
  lastSeen: number;
  description: string;
}

export interface BehaviorSequence {
  actions: string[];
  frequency: number;
  conversionRate: number;
  avgTimeBetweenActions: number;
  users: string[];
}

export interface BehaviorInsight {
  pattern: string;
  confidence: number;
  suggestedFeature: string;
  expectedImpact: number;
  requiredActions: string[];
  userSegment: string;
}

export interface BehaviorAnomaly {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  detectedAt: number;
}

export interface UserSegment {
  name: string;
  users: string[];
  characteristics: string[];
  suggestedFeatures: string[];
}

export class BehaviorAnalysisEngine {
  private behaviorSequences: Map<string, BehaviorSequence> = new Map();
  private userSessions: Map<string, UserAction[]> = new Map();
  private userSegments: Map<string, UserSegment> = new Map();
  private opportunities: Map<string, FeatureOpportunity> = new Map();

  constructor(
    private config: SeimConfig,
    private analytics: AnalyticsAdapter,
    private businessMetrics: BusinessMetricsStore
  ) {
    this.initializeDefaultSegments();
  }

  /**
   * Initialize default user segments based on common patterns
   */
  private initializeDefaultSegments(): void {
    this.userSegments.set('content_engagers', {
      name: 'Content Engagers',
      users: [],
      characteristics: ['high_view_time', 'frequent_likes', 'shares_content'],
      suggestedFeatures: ['content_recommendations', 'social_sharing_enhancements']
    });

    this.userSegments.set('converters', {
      name: 'Converters',
      users: [],
      characteristics: ['high_conversion_rate', 'frequent_purchases', 'cart_completion'],
      suggestedFeatures: ['checkout_optimization', 'payment_enhancements']
    });

    this.userSegments.set('explorers', {
      name: 'Explorers',
      users: [],
      characteristics: ['browse_heavy', 'diverse_interests', 'category_hopping'],
      suggestedFeatures: ['recommendation_engine', 'discovery_features']
    });

    this.userSegments.set('power_users', {
      name: 'Power Users',
      users: [],
      characteristics: ['daily_usage', 'advanced_features', 'customization'],
      suggestedFeatures: ['dashboard_customization', 'advanced_analytics']
    });
  }

  /**
   * Track user action for sequence analysis
   */
  trackUserAction(userId: string, action: UserAction): void {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, []);
    }
    
    const session = this.userSessions.get(userId)!;
    session.push(action);
    
    // Keep only last 100 actions per user
    if (session.length > 100) {
      session.shift();
    }

    // Analyze for patterns
    this.analyzeUserSession(userId, session);
  }

  /**
   * Track user action for sequence analysis (alias for compatibility)
   */
  recordAction(userId: string, actionType: string, properties?: any): void {
    this.trackUserAction(userId, {
      action: actionType,
      timestamp: Date.now(),
      properties: properties || {}
    });
  }

  /**
   * Analyze user session for behavior patterns
   */
  private analyzeUserSession(userId: string, actions: UserAction[]): void {
    if (actions.length < 2) return;

    // Extract action sequences
    for (let i = 0; i < actions.length - 1; i++) {
      const currentAction = actions[i].action;
      const nextAction = actions[i + 1].action;
      const sequenceKey = `${currentAction}→${nextAction}`;
      
      const timeDiff = actions[i + 1].timestamp - actions[i].timestamp;
      
      if (!this.behaviorSequences.has(sequenceKey)) {
        this.behaviorSequences.set(sequenceKey, {
          actions: [currentAction, nextAction],
          frequency: 0,
          conversionRate: 0,
          avgTimeBetweenActions: timeDiff,
          users: []
        });
      }

      const sequence = this.behaviorSequences.get(sequenceKey)!;
      sequence.frequency++;
      sequence.avgTimeBetweenActions = (sequence.avgTimeBetweenActions * (sequence.frequency - 1) + timeDiff) / sequence.frequency;
      
      if (!sequence.users.includes(userId)) {
        sequence.users.push(userId);
      }
    }

    // Classify user into segments
    this.classifyUserSegment(userId, actions);
  }

  /**
   * Classify user into segments based on behavior
   */
  private classifyUserSegment(userId: string, actions: UserAction[]): void {
    const characteristics: string[] = [];
    
    // Analyze user behavior patterns
    const actionCounts = new Map<string, number>();
    actions.forEach(action => {
      actionCounts.set(action.action, (actionCounts.get(action.action) || 0) + 1);
    });

    // Check for specific patterns
    if ((actionCounts.get('like') || 0) / actions.length > 0.3) {
      characteristics.push('frequent_likes');
    }
    if ((actionCounts.get('share') || 0) / actions.length > 0.2) {
      characteristics.push('shares_content');
    }
    if ((actionCounts.get('purchase') || 0) / actions.length > 0.1) {
      characteristics.push('frequent_purchases');
    }
    if ((actionCounts.get('browse') || 0) / actions.length > 0.5) {
      characteristics.push('browse_heavy');
    }
    if ((actionCounts.get('dashboard') || 0) / actions.length > 0.4) {
      characteristics.push('daily_usage');
    }

    // Assign to matching segments
    for (const [segmentName, segment] of this.userSegments.entries()) {
      const matchingCharacteristics = segment.characteristics.filter(char => 
        characteristics.includes(char)
      );
      
      if (matchingCharacteristics.length >= 2) {
        if (!segment.users.includes(userId)) {
          segment.users.push(userId);
        }
      }
    }
  }

  /**
   * Get behavior-driven feature recommendations for a route
   */
  getFeatureRecommendations(routeKey: string): {
    opportunities: FeatureOpportunity[];
    aggregateInsights: BehaviorInsight[];
  } {
    const opportunities: FeatureOpportunity[] = [];
    const aggregateInsights: BehaviorInsight[] = [];

    // Analyze behavior sequences for this route
    const routeSpecificSequences = this.getRouteSpecificSequences(routeKey);
    
    // Generate insights from frequent patterns
    for (const [sequenceKey, sequence] of routeSpecificSequences.entries()) {
      if (sequence.frequency < 5) continue; // Minimum threshold
      
      const insight = this.generateInsightFromSequence(sequenceKey, sequence);
      if (insight) {
        aggregateInsights.push(insight);
        
        // Create feature opportunity from insight
        const opportunity = this.createOpportunityFromInsight(insight, routeKey);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }

    // Get segment-based recommendations
    const segmentRecommendations = this.getSegmentBasedRecommendations(routeKey);
    opportunities.push(...segmentRecommendations);

    return { opportunities, aggregateInsights };
  }

  /**
   * Get behavior sequences specific to a route
   */
  private getRouteSpecificSequences(routeKey: string): Map<string, BehaviorSequence> {
    const relevantSequences = new Map<string, BehaviorSequence>();
    
    for (const [sequenceKey, sequence] of this.behaviorSequences.entries()) {
      // Check if this sequence is relevant to the route
      const actions = sequence.actions.join('→');
      if (this.isSequenceRelevantToRoute(actions, routeKey)) {
        relevantSequences.set(sequenceKey, sequence);
      }
    }
    
    return relevantSequences;
  }

  /**
   * Check if a behavior sequence is relevant to a specific route
   */
  private isSequenceRelevantToRoute(actions: string, routeKey: string): boolean {
    // This would be enhanced to track which routes users visit before/after certain actions
    // For now, return true for all sequences as we want to analyze all behavior
    return true;
  }

  /**
   * Generate insight from behavior sequence
   */
  private generateInsightFromSequence(sequenceKey: string, sequence: BehaviorSequence): BehaviorInsight | null {
    const actions = sequenceKey.split('→');
    
    // Pattern recognition for common sequences
    const patternInsights: Record<string, Partial<BehaviorInsight>> = {
      'like→subscribe': {
        pattern: 'Users who like content tend to subscribe',
        suggestedFeature: 'Enhanced content dashboard with likes and subscription status',
        expectedImpact: 0.25,
        requiredActions: ['like', 'subscribe'],
        userSegment: 'content_engagers'
      },
      'browse→like': {
        pattern: 'Users browse content before liking (exploratory behavior)',
        suggestedFeature: 'Content discovery features with like previews',
        expectedImpact: 0.15,
        requiredActions: ['browse', 'like'],
        userSegment: 'explorers'
      },
      'add_to_cart→purchase': {
        pattern: 'Users who add to cart complete purchases (high conversion)',
        suggestedFeature: 'Checkout optimization and one-click purchase',
        expectedImpact: 0.20,
        requiredActions: ['add_to_cart', 'purchase'],
        userSegment: 'converters'
      },
      'dashboard→export': {
        pattern: 'Power users export data from dashboard',
        suggestedFeature: 'Advanced analytics and export customization',
        expectedImpact: 0.30,
        requiredActions: ['dashboard', 'export'],
        userSegment: 'power_users'
      },
      'view→share': {
        pattern: 'Users share content after viewing (viral potential)',
        suggestedFeature: 'Social sharing enhancements and viral tracking',
        expectedImpact: 0.20,
        requiredActions: ['view', 'share'],
        userSegment: 'content_engagers'
      }
    };

    const insight = patternInsights[sequenceKey];
    if (!insight) return null;

    // Calculate confidence based on frequency and user diversity
    const userDiversity = sequence.users.length / sequence.frequency;
    const confidence = Math.min(0.95, (sequence.frequency / 20) * 0.7 + userDiversity * 0.3);

    return {
      pattern: insight.pattern!,
      confidence,
      suggestedFeature: insight.suggestedFeature!,
      expectedImpact: insight.expectedImpact || 0.1,
      requiredActions: insight.requiredActions!,
      userSegment: insight.userSegment!
    };
  }

  /**
   * Create feature opportunity from behavior insight
   */
  private createOpportunityFromInsight(insight: BehaviorInsight, routeKey: string): FeatureOpportunity | null {
    // Only create opportunities with sufficient confidence and impact
    if (insight.confidence < 0.5 || insight.expectedImpact < 0.1) {
      return null;
    }

    // Check if we already have a similar opportunity to avoid duplicates
    const existingOpportunity = this.opportunities.get(`${routeKey}_${insight.suggestedFeature}`);
    if (existingOpportunity && existingOpportunity.confidence > insight.confidence) {
      return null; // Keep the better one
    }

    const opportunity: FeatureOpportunity = {
      id: `${routeKey}_${insight.suggestedFeature.replace(/\s+/g, '_')}_${Date.now()}`,
      type: this.mapFeatureType(insight.suggestedFeature),
      description: `${insight.pattern}. Suggested: ${insight.suggestedFeature}`,
      expectedImpact: insight.expectedImpact,
      confidence: insight.confidence
    };

    this.opportunities.set(opportunity.id, opportunity);
    return opportunity;
  }

  /**
   * Map suggested feature to opportunity type
   */
  private mapFeatureType(suggestion: string): 'personalization' | 'recommendation' | 'pricing' | 'content' {
    const lower = suggestion.toLowerCase();
    
    if (lower.includes('recommendation') || lower.includes('suggest')) {
      return 'recommendation';
    }
    if (lower.includes('personal') || lower.includes('custom')) {
      return 'personalization';
    }
    if (lower.includes('price') || lower.includes('checkout') || lower.includes('purchase')) {
      return 'pricing';
    }
    if (lower.includes('content') || lower.includes('dashboard') || lower.includes('share')) {
      return 'content';
    }
    
    return 'content'; // Default
  }

  /**
   * Get segment-based feature recommendations
   */
  private getSegmentBasedRecommendations(routeKey: string): FeatureOpportunity[] {
    const opportunities: FeatureOpportunity[] = [];

    // Analyze which segments are most active for this route
    const segmentActivity = this.analyzeSegmentActivity(routeKey);

    for (const [segmentName, activity] of segmentActivity.entries()) {
      if (activity < 3) continue; // Minimum activity threshold

      const segment = this.userSegments.get(segmentName);
      if (!segment) continue;

      // Create opportunities based on segment characteristics
      segment.suggestedFeatures.forEach(feature => {
        const opportunity: FeatureOpportunity = {
          id: `${routeKey}_${segmentName}_${feature.replace(/\s+/g, '_')}_${Date.now()}`,
          type: this.mapFeatureType(feature),
          description: `For ${segment.name}: ${feature}`,
          expectedImpact: 0.15,
          confidence: Math.min(0.8, activity / 10)
        };
        opportunities.push(opportunity);
      });
    }

    return opportunities;
  }

  /**
   * Analyze which segments are most active for a route
   */
  private analyzeSegmentActivity(routeKey: string): Map<string, number> {
    const activity = new Map<string, number>();

    for (const [segmentName, segment] of this.userSegments.entries()) {
      // Count how many users in this segment have visited the route
      let activityCount = 0;
      segment.users.forEach(userId => {
        const session = this.userSessions.get(userId);
        if (session && session.some((a: any) => a.properties?.routeKey === routeKey)) {
          activityCount++;
        }
      });
      activity.set(segmentName, activityCount);
    }

    return activity;
  }

  /**
   * Detect anomalies in user behavior
   */
  detectAnomalies(userId: string): BehaviorAnomaly[] {
    const behavior = this.businessMetrics.getUserBehavior(userId);
    const anomalies: BehaviorAnomaly[] = [];

    // Detect sudden drop in engagement
    const recentEngagements = behavior.engagements.filter(
      (e: any) => Date.now() - e.timestamp < 7 * 24 * 60 * 60 * 1000
    );
    const olderEngagements = behavior.engagements.filter(
      (e: any) => Date.now() - e.timestamp >= 7 * 24 * 60 * 60 * 1000 &&
             Date.now() - e.timestamp < 14 * 24 * 60 * 60 * 1000
    );

    if (olderEngagements.length > 0 && recentEngagements.length < olderEngagements.length * 0.5) {
      anomalies.push({
        type: 'engagement_drop',
        severity: 'high',
        description: 'User engagement has dropped significantly',
        detectedAt: Date.now()
      });
    }

    // Detect unusual conversion patterns
    if (behavior.conversions.length > 5) {
      const recentConversions = behavior.conversions.filter(
        (c: any) => Date.now() - c.timestamp < 24 * 60 * 60 * 1000
      );
      if (recentConversions.length > 3) {
        anomalies.push({
          type: 'suspicious_activity',
          severity: 'medium',
          description: 'Unusual conversion pattern detected',
          detectedAt: Date.now()
        });
      }
    }

    return anomalies;
  }

  /**
   * Get aggregate behavior insights across all users
   */
  getAggregateInsights(): {
    topSequences: BehaviorSequence[];
    topSegments: { name: string; userCount: number }[];
    opportunityCount: number;
  } {
    // Get top behavior sequences by frequency
    const topSequences = Array.from(this.behaviorSequences.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Get segments by user count
    const topSegments = Array.from(this.userSegments.values())
      .map(segment => ({ name: segment.name, userCount: segment.users.length }))
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 5);

    return {
      topSequences,
      topSegments,
      opportunityCount: this.opportunities.size
    };
  }

  /**
   * Reset all behavior data (for testing)
   */
  resetBehaviorData(): void {
    this.behaviorSequences.clear();
    this.userSessions.clear();
    this.opportunities.clear();
    this.userSegments.forEach(segment => segment.users = []);
  }
}