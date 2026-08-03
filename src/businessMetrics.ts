export interface FeatureKPIs {
  featureId: string;
  variant: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
  averageEngagement: number;
  retentionRate: number;
  revenue: number;
  customKPIs: Record<string, number>;
}

export interface ComparisonResult {
  variantA: string;
  variantB: string;
  winner: string;
  improvements: {
    conversionRate: number;
    engagement: number;
    retention: number;
    revenue: number;
  };
  statisticalSignificance: number;
}

export interface ConversionEvent {
  routeKey: string;
  userId: string;
  value: number;
  timestamp: number;
  properties: Record<string, any>;
}

export interface EngagementEvent {
  routeKey: string;
  action: string;
  userId: string;
  timestamp: number;
  properties: Record<string, any>;
}

export interface FeatureImpression {
  featureId: string;
  variant: string;
  userId: string;
  timestamp: number;
  context: Record<string, any>;
}

export class BusinessMetricsStore {
  private conversions: Map<string, ConversionEvent[]> = new Map();
  private engagements: Map<string, EngagementEvent[]> = new Map();
  private featureImpressions: Map<string, FeatureImpression[]> = new Map();
  private retentionData: Map<string, { firstSeen: number; lastSeen: number; sessions: number }> = new Map();
  private persistencePath?: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath;
    if (persistencePath) {
      this.load();
      this.startAutoSave();
    }
  }

  /**
   * Record a conversion event (purchase, signup, etc.)
   */
  recordConversion(routeKey: string, userId: string, value: number, properties: Record<string, any> = {}): void {
    const key = `${routeKey}:${userId}`;
    if (!this.conversions.has(key)) {
      this.conversions.set(key, []);
    }
    
    this.conversions.get(key)!.push({
      routeKey,
      userId,
      value,
      timestamp: Date.now(),
      properties
    });

    this.markDirty();
  }

  /**
   * Record user engagement (clicks, views, etc.)
   */
  recordEngagement(routeKey: string, action: string, userId: string, properties: Record<string, any> = {}): void {
    const key = `${routeKey}:${userId}`;
    if (!this.engagements.has(key)) {
      this.engagements.set(key, []);
    }
    
    this.engagements.get(key)!.push({
      routeKey,
      action,
      userId,
      timestamp: Date.now(),
      properties
    });

    this.markDirty();
  }

  /**
   * Record user retention data
   */
  recordRetention(userId: string, returned: boolean): void {
    const existing = this.retentionData.get(userId);
    const now = Date.now();

    if (!existing) {
      this.retentionData.set(userId, {
        firstSeen: now,
        lastSeen: now,
        sessions: 1
      });
    } else {
      existing.lastSeen = now;
      if (returned) {
        existing.sessions++;
      }
    }

    this.markDirty();
  }

  /**
   * Record a feature impression for A/B testing
   */
  recordFeatureImpression(featureId: string, variant: string, userId: string, context: Record<string, any> = {}): void {
    const key = `${featureId}:${variant}`;
    if (!this.featureImpressions.has(key)) {
      this.featureImpressions.set(key, []);
    }
    
    this.featureImpressions.get(key)!.push({
      featureId,
      variant,
      userId,
      timestamp: Date.now(),
      context
    });

    this.markDirty();
  }

  /**
   * Record a feature interaction
   */
  recordFeatureInteraction(featureId: string, variant: string, action: string, userId: string): void {
    this.recordEngagement(featureId, action, userId, { variant });
  }

  /**
   * Get KPIs for a specific feature variant
   */
  getFeatureKPIs(featureId: string, variant: string): FeatureKPIs {
    const impressionKey = `${featureId}:${variant}`;
    const impressions = this.featureImpressions.get(impressionKey) || [];
    
    // Calculate conversions for this variant
    let conversions = 0;
    let totalValue = 0;
    let engagementCount = 0;
    const uniqueUsers = new Set<string>();

    impressions.forEach(imp => {
      uniqueUsers.add(imp.userId);
      
      // Check for conversions
      const convKey = `${featureId}:${imp.userId}`;
      const userConversions = this.conversions.get(convKey) || [];
      conversions += userConversions.length;
      totalValue += userConversions.reduce((sum, c) => sum + c.value, 0);
      
      // Check for engagements
      const engKey = `${featureId}:${imp.userId}`;
      const userEngagements = this.engagements.get(engKey) || [];
      engagementCount += userEngagements.length;
    });

    const uniqueUserCount = uniqueUsers.size;
    const conversionRate = uniqueUserCount > 0 ? conversions / uniqueUserCount : 0;
    const averageEngagement = uniqueUserCount > 0 ? engagementCount / uniqueUserCount : 0;

    // Calculate retention
    let retainedUsers = 0;
    uniqueUsers.forEach(userId => {
      const retention = this.retentionData.get(userId);
      if (retention && retention.sessions > 1) {
        retainedUsers++;
      }
    });
    const retentionRate = uniqueUserCount > 0 ? retainedUsers / uniqueUserCount : 0;

    return {
      featureId,
      variant,
      impressions: impressions.length,
      conversions,
      conversionRate,
      averageEngagement,
      retentionRate,
      revenue: totalValue,
      customKPIs: {}
    };
  }

  /**
   * Compare two feature variants
   */
  compareVariants(featureId: string, variantA: string, variantB: string): ComparisonResult {
    const kpisA = this.getFeatureKPIs(featureId, variantA);
    const kpisB = this.getFeatureKPIs(featureId, variantB);

    const improvements = {
      conversionRate: kpisB.conversionRate - kpisA.conversionRate,
      engagement: kpisB.averageEngagement - kpisA.averageEngagement,
      retention: kpisB.retentionRate - kpisA.retentionRate,
      revenue: kpisB.revenue - kpisA.revenue
    };

    // Simple winner determination based on conversion rate
    const winner = kpisB.conversionRate > kpisA.conversionRate ? variantB : variantA;

    // Calculate statistical significance (simplified)
    const statisticalSignificance = this.calculateSignificance(kpisA, kpisB);

    return {
      variantA,
      variantB,
      winner,
      improvements,
      statisticalSignificance
    };
  }

  /**
   * Get user behavior data for a specific user
   */
  getUserBehavior(userId: string): any {
    const userConversions: ConversionEvent[] = [];
    const userEngagements: EngagementEvent[] = [];
    const userImpressions: FeatureImpression[] = [];

    // Collect all user data
    this.conversions.forEach((events, key) => {
      if (key.endsWith(`:${userId}`)) {
        userConversions.push(...events);
      }
    });

    this.engagements.forEach((events, key) => {
      if (key.endsWith(`:${userId}`)) {
        userEngagements.push(...events);
      }
    });

    this.featureImpressions.forEach((events, key) => {
      if (events.some(imp => imp.userId === userId)) {
        userImpressions.push(...events.filter(imp => imp.userId === userId));
      }
    });

    const retention = this.retentionData.get(userId);

    return {
      userId,
      conversions: userConversions,
      engagements: userEngagements,
      impressions: userImpressions,
      retention,
      segments: this.calculateUserSegments(userId, userEngagements, userConversions)
    };
  }

  /**
   * Get aggregated metrics for a route
   */
  getRouteMetrics(routeKey: string): any {
    let totalConversions = 0;
    let totalValue = 0;
    let totalEngagements = 0;
    const uniqueUsers = new Set<string>();

    this.conversions.forEach((events, key) => {
      if (key.startsWith(`${routeKey}:`)) {
        events.forEach(conv => {
          totalConversions++;
          totalValue += conv.value;
          uniqueUsers.add(conv.userId);
        });
      }
    });

    this.engagements.forEach((events, key) => {
      if (key.startsWith(`${routeKey}:`)) {
        totalEngagements += events.length;
        events.forEach(eng => uniqueUsers.add(eng.userId));
      }
    });

    return {
      routeKey,
      uniqueUsers: uniqueUsers.size,
      conversions: totalConversions,
      revenue: totalValue,
      engagements: totalEngagements,
      conversionRate: uniqueUsers.size > 0 ? totalConversions / uniqueUsers.size : 0,
      averageEngagement: uniqueUsers.size > 0 ? totalEngagements / uniqueUsers.size : 0
    };
  }

  /**
   * Clean up old data to prevent memory bloat
   */
  cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;

    // Clean up old conversions
    this.conversions.forEach((events, key) => {
      const filtered = events.filter(e => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.conversions.delete(key);
      } else {
        this.conversions.set(key, filtered);
      }
    });

    // Clean up old engagements
    this.engagements.forEach((events, key) => {
      const filtered = events.filter(e => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.engagements.delete(key);
      } else {
        this.engagements.set(key, filtered);
      }
    });

    // Clean up old impressions
    this.featureImpressions.forEach((events, key) => {
      const filtered = events.filter(e => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.featureImpressions.delete(key);
      } else {
        this.featureImpressions.set(key, filtered);
      }
    });

    this.markDirty();
  }

  /**
   * Get statistics about the metrics store
   */
  getStats(): {
    totalConversions: number;
    totalEngagements: number;
    totalImpressions: number;
    uniqueUsers: number;
  } {
    const uniqueUsers = new Set<string>();

    this.conversions.forEach(events => {
      events.forEach(conv => uniqueUsers.add(conv.userId));
    });

    this.engagements.forEach(events => {
      events.forEach(eng => uniqueUsers.add(eng.userId));
    });

    this.featureImpressions.forEach(events => {
      events.forEach(imp => uniqueUsers.add(imp.userId));
    });

    let totalConversions = 0;
    this.conversions.forEach(events => {
      totalConversions += events.length;
    });

    let totalEngagements = 0;
    this.engagements.forEach(events => {
      totalEngagements += events.length;
    });

    let totalImpressions = 0;
    this.featureImpressions.forEach(events => {
      totalImpressions += events.length;
    });

    return {
      totalConversions,
      totalEngagements,
      totalImpressions,
      uniqueUsers: uniqueUsers.size
    };
  }

  /**
   * Destroy the metrics store and cleanup
   */
  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.persistencePath) {
      this.save();
    }
  }

  // Private methods

  private calculateSignificance(kpisA: FeatureKPIs, kpisB: FeatureKPIs): number {
    // Simplified statistical significance calculation
    // In production, use proper statistical tests like chi-square or t-test
    const nA = kpisA.impressions;
    const nB = kpisB.impressions;
    const pA = kpisA.conversionRate;
    const pB = kpisB.conversionRate;

    if (nA < 30 || nB < 30) return 0; // Not enough data

    const pooledP = (kpisA.conversions + kpisB.conversions) / (nA + nB);
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/nA + 1/nB));
    
    if (se === 0) return 0;

    const z = (pB - pA) / se;
    // Convert z-score to confidence (approximate)
    const confidence = Math.min(0.99, Math.max(0, 1 - Math.exp(-Math.abs(z) / 2)));
    
    return confidence;
  }

  private calculateUserSegments(userId: string, engagements: EngagementEvent[], conversions: ConversionEvent[]): string[] {
    const segments: string[] = [];

    // Engagement-based segments
    if (engagements.length > 10) segments.push('highly-engaged');
    else if (engagements.length > 5) segments.push('engaged');
    else segments.push('low-engagement');

    // Conversion-based segments
    if (conversions.length > 0) segments.push('converter');
    else segments.push('non-converter');

    // Time-based segments
    const retention = this.retentionData.get(userId);
    if (retention && retention.sessions > 5) segments.push('loyal');
    else if (retention && retention.sessions > 2) segments.push('returning');
    else segments.push('new');

    return segments;
  }

  private dirty = false;

  private markDirty(): void {
    this.dirty = true;
  }

  private startAutoSave(): void {
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.save();
    }, 30_000);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  private save(): void {
    if (!this.persistencePath) return;

    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.persistencePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        conversions: Array.from(this.conversions.entries()),
        engagements: Array.from(this.engagements.entries()),
        featureImpressions: Array.from(this.featureImpressions.entries()),
        retentionData: Array.from(this.retentionData.entries())
      };

      fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2), 'utf8');
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save business metrics:', error);
    }
  }

  private load(): void {
    if (!this.persistencePath) return;

    try {
      const fs = require('fs');
      const path = require('path');
      
      // Ensure the directory exists
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      if (!fs.existsSync(this.persistencePath)) return;

      const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
      
      this.conversions = new Map(data.conversions || []);
      this.engagements = new Map(data.engagements || []);
      this.featureImpressions = new Map(data.featureImpressions || []);
      this.retentionData = new Map(data.retentionData || []);
    } catch (error) {
      console.error('Failed to load business metrics:', error);
      this.conversions = new Map();
      this.engagements = new Map();
      this.featureImpressions = new Map();
      this.retentionData = new Map();
    }
  }
}