import { SeimConfig, FeatureFlag, FlagEvaluationContext } from './types';
import { Logger } from './logger';
import { SeimEventBus } from './events';
import * as crypto from 'crypto';

export class FeatureFlagEngine {
  private flags: Map<string, FeatureFlag> = new Map();
  private userAssignments: Map<string, Map<string, boolean>> = new Map(); // flagId -> userId -> enabled

  constructor(
    private config: SeimConfig,
    private events: SeimEventBus,
    private logger: Logger
  ) {
    this.loadFromDisk();
  }

  /**
   * Create a new feature flag
   */
  createFlag(flag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>): FeatureFlag {
    const id = flag.key || `flag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newFlag: FeatureFlag = {
      id,
      key: flag.key || id,
      name: flag.name,
      description: flag.description,
      enabled: flag.enabled ?? false,
      rolloutPercentage: flag.rolloutPercentage ?? 0,
      targetSegments: flag.targetSegments || [],
      targetType: flag.targetType || 'all',
      conditions: flag.conditions || [],
      metadata: flag.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.flags.set(id, newFlag);
    this.saveToDisk();

    this.logger.info('Feature flag created', { flagId: id, key: newFlag.key });
    this.events.emitEvent('featureflag:created', { flag: newFlag });

    return newFlag;
  }

  /**
   * Update an existing feature flag
   */
  updateFlag(flagId: string, updates: Partial<FeatureFlag>): FeatureFlag | null {
    const flag = this.flags.get(flagId);
    if (!flag) {
      this.logger.warn('Attempted to update unknown flag', { flagId });
      return null;
    }

    const updated = {
      ...flag,
      ...updates,
      id: flag.id, // Prevent changing ID
      key: updates.key || flag.key, // Prevent changing key if not provided
      updatedAt: Date.now()
    };

    this.flags.set(flagId, updated);
    this.saveToDisk();

    this.logger.info('Feature flag updated', { flagId, updates });
    this.events.emitEvent('featureflag:updated', { flagId, updates });

    return updated;
  }

  /**
   * Delete a feature flag
   */
  deleteFlag(flagId: string): boolean {
    const flag = this.flags.get(flagId);
    if (!flag) {
      this.logger.warn('Attempted to delete unknown flag', { flagId });
      return false;
    }

    this.flags.delete(flagId);
    this.userAssignments.delete(flagId);
    this.saveToDisk();

    this.logger.info('Feature flag deleted', { flagId });
    this.events.emitEvent('featureflag:deleted', { flagId });

    return true;
  }

  /**
   * Evaluate if a flag is enabled for a given context
   */
  evaluateFlag(flagId: string, context: FlagEvaluationContext): boolean {
    const flag = this.flags.get(flagId);
    if (!flag) {
      this.logger.warn('Attempted to evaluate unknown flag', { flagId });
      return false;
    }

    // Check if flag is globally enabled
    if (!flag.enabled) {
      return false;
    }

    // Check target type
    if (flag.targetType === 'none') {
      return false;
    }

    // Check user segments
    if (flag.targetSegments && flag.targetSegments.length > 0) {
      if (!context.segments || !context.segments.some(seg => flag.targetSegments!.includes(seg))) {
        return false;
      }
    }

    // Check custom conditions
    if (flag.conditions && flag.conditions.length > 0) {
      for (const condition of flag.conditions) {
        if (!this.evaluateCondition(condition, context)) {
          return false;
        }
      }
    }

    // Check rollout percentage for specific users
    if (flag.rolloutPercentage < 100) {
      // Check if user has a persistent assignment
      if (this.userAssignments.has(flagId)) {
        const assignments = this.userAssignments.get(flagId)!;
        if (assignments.has(context.userId)) {
          return assignments.get(context.userId)!;
        }
      }

      // Deterministic assignment based on user ID
      const hash = this.hashUserId(context.userId, flagId);
      const bucket = hash % 100;
      const enabled = bucket < flag.rolloutPercentage;

      // Cache the assignment
      if (!this.userAssignments.has(flagId)) {
        this.userAssignments.set(flagId, new Map());
      }
      this.userAssignments.get(flagId)!.set(context.userId, enabled);

      return enabled;
    }

    // If all checks pass and rollout is 100%, enable
    return true;
  }

  /**
   * Evaluate all flags for a given context
   */
  evaluateAllFlags(context: FlagEvaluationContext): Map<string, boolean> {
    const results = new Map<string, boolean>();

    for (const [flagId, flag] of this.flags.entries()) {
      results.set(flag.key, this.evaluateFlag(flagId, context));
    }

    return results;
  }

  /**
   * Get all flags
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * Get a specific flag
   */
  getFlag(flagId: string): FeatureFlag | undefined {
    return this.flags.get(flagId);
  }

  /**
   * Get flag by key
   */
  getFlagByKey(key: string): FeatureFlag | undefined {
    return Array.from(this.flags.values()).find(f => f.key === key);
  }

  /**
   * Get flags for a specific user
   */
  getFlagsForUser(userId: string, context?: Partial<FlagEvaluationContext>): Map<string, boolean> {
    const fullContext: FlagEvaluationContext = {
      userId,
      segments: context?.segments || [],
      attributes: context?.attributes || {},
      timestamp: Date.now()
    };

    return this.evaluateAllFlags(fullContext);
  }

  /**
   * Gradually rollout a flag
   */
  gradualRollout(flagId: string, targetPercentage: number, duration: number): void {
    const flag = this.flags.get(flagId);
    if (!flag) {
      this.logger.warn('Attempted to rollout unknown flag', { flagId });
      return;
    }

    const startPercentage = flag.rolloutPercentage;
    const percentageDiff = targetPercentage - startPercentage;
    const steps = 10; // Number of rollout steps
    const stepDuration = duration / steps;
    const stepIncrement = percentageDiff / steps;

    let currentStep = 0;

    const rolloutInterval = setInterval(() => {
      currentStep++;
      const newPercentage = startPercentage + (stepIncrement * currentStep);

      this.updateFlag(flagId, { rolloutPercentage: Math.min(100, Math.max(0, newPercentage)) });

      this.logger.info('Gradual rollout step', {
        flagId,
        step: currentStep,
        percentage: newPercentage
      });

      if (currentStep >= steps) {
        clearInterval(rolloutInterval);
        this.logger.info('Gradual rollout completed', { flagId, finalPercentage: targetPercentage });
        this.events.emitEvent('featureflag:rollout_completed', { flagId, targetPercentage });
      }
    }, stepDuration);
  }

  /**
   * Enable a flag immediately
   */
  enableFlag(flagId: string): boolean {
    return this.updateFlag(flagId, { enabled: true, rolloutPercentage: 100 }) !== null;
  }

  /**
   * Disable a flag immediately
   */
  disableFlag(flagId: string): boolean {
    return this.updateFlag(flagId, { enabled: false, rolloutPercentage: 0 }) !== null;
  }

  /**
   * Get flag statistics
   */
  getStats(): {
    totalFlags: number;
    enabledFlags: number;
    disabledFlags: number;
    partiallyRolledOut: number;
    fullyRolledOut: number;
  } {
    const flags = Array.from(this.flags.values());

    return {
      totalFlags: flags.length,
      enabledFlags: flags.filter(f => f.enabled).length,
      disabledFlags: flags.filter(f => !f.enabled).length,
      partiallyRolledOut: flags.filter(f => f.enabled && f.rolloutPercentage > 0 && f.rolloutPercentage < 100).length,
      fullyRolledOut: flags.filter(f => f.enabled && f.rolloutPercentage === 100).length
    };
  }

  // Private methods

  private hashUserId(userId: string, flagId: string): number {
    const hash = crypto.createHash('md5').update(`${userId}:${flagId}`).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  private evaluateCondition(condition: any, context: FlagEvaluationContext): boolean {
    const { type, attribute, operator, value } = condition;

    const contextValue = context.attributes?.[attribute];
    if (contextValue === undefined) {
      return false;
    }

    switch (operator) {
      case 'equals':
        return contextValue === value;
      case 'not_equals':
        return contextValue !== value;
      case 'contains':
        return typeof contextValue === 'string' && contextValue.includes(value);
      case 'not_contains':
        return typeof contextValue === 'string' && !contextValue.includes(value);
      case 'greater_than':
        return typeof contextValue === 'number' && contextValue > value;
      case 'less_than':
        return typeof contextValue === 'number' && contextValue < value;
      case 'in':
        return Array.isArray(value) && value.includes(contextValue);
      case 'not_in':
        return Array.isArray(value) && !value.includes(contextValue);
      default:
        this.logger.warn('Unknown condition operator', { operator });
        return false;
    }
  }

  private saveToDisk(): void {
    try {
      const data = {
        flags: Array.from(this.flags.entries()),
        userAssignments: Array.from(this.userAssignments.entries())
      };

      const filePath = this.getStoragePath();
      const fs = require('fs');
      const path = require('path');
      
      const storageDir = path.join(this.config.storagePath, 'featureflags');
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save feature flags to disk', { error });
    }
  }

  private loadFromDisk(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const filePath = this.getStoragePath();
      if (!fs.existsSync(filePath)) {
        return;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.flags = new Map(data.flags);
      this.userAssignments = new Map(data.userAssignments);

      this.logger.info('Feature flags loaded from disk', {
        flags: this.flags.size,
        userAssignments: this.userAssignments.size
      });
    } catch (error) {
      this.logger.error('Failed to load feature flags from disk', { error });
    }
  }

  private getStoragePath(): string {
    const path = require('path');
    return path.join(this.config.storagePath, 'featureflags', 'flags.json');
  }
}