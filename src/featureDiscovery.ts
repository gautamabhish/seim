import { BehaviorPattern, BehaviorTracker } from './behaviorTracker';
import { FeatureScaffolder } from './scaffolder';
import { SeimConfig } from './types';
import { SeimEventBus } from './events';
import { Logger } from './logger';

export interface DiscoveredFeature {
  id: string;
  pattern: BehaviorPattern;
  intent: string;
  method: string;
  path: string;
  status: 'discovered' | 'scaffolding' | 'scaffolded' | 'deployed' | 'rejected';
  createdAt: number;
  scaffoldedCode?: string;
  deployedAt?: number;
}

export class FeatureDiscovery {
  private discovered: Map<string, DiscoveredFeature> = new Map();
  private scaffolding: Set<string> = new Set();

  constructor(
    private tracker: BehaviorTracker,
    private scaffolder: FeatureScaffolder,
    private config: SeimConfig,
    private events: SeimEventBus,
    private logger: Logger,
  ) {}

  /** Run a discovery cycle: analyze behavior patterns and generate feature specs */
  public async discover(): Promise<DiscoveredFeature[]> {
    const patterns = this.tracker.analyze();
    const newlyDiscovered: DiscoveredFeature[] = [];

    for (const pattern of patterns) {
      // Dedup by path
      if (this.discovered.has(pattern.path)) continue;

      const feature = this.patternToFeature(pattern);
      if (feature) {
        this.discovered.set(pattern.path, feature);
        newlyDiscovered.push(feature);
        (this.events as any).emitEvent?.('feature:discovered', feature);
        (this.events as any).emit?.('feature:discovered', feature);
      }
    }

    return newlyDiscovered;
  }

  /** Map a behavior pattern to a concrete feature spec */
  private patternToFeature(pattern: BehaviorPattern): DiscoveredFeature | null {
    const uid = () => `feat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (pattern.type === 'missing_feature') {
      // Paths with :id params or no action-verb suggest GET; others suggest POST
      const isGet =
        pattern.path.match(/\/:[a-zA-Z0-9_-]+$/) ||
        (!pattern.path.includes('action') &&
          !pattern.path.includes('update') &&
          !pattern.path.includes('create'));
      const method = isGet ? 'GET' : 'POST';
      return {
        id: uid(),
        pattern,
        intent: `Implement missing ${method} route ${pattern.path} that users frequently try to access.`,
        method,
        path: pattern.path,
        status: 'discovered',
        createdAt: Date.now(),
      };
    }

    if (pattern.type === 'high_demand') {
      return {
        id: uid(),
        pattern,
        intent: `Add caching or a batch endpoint for the high-demand route ${pattern.path}.`,
        method: 'GET',
        path: pattern.path,
        status: 'discovered',
        createdAt: Date.now(),
      };
    }

    if (pattern.type === 'drop_off') {
      return {
        id: uid(),
        pattern,
        intent: `Users repeatedly visit ${pattern.path} but then drop off. Consider improving UX or adding a related action endpoint.`,
        method: 'GET',
        path: pattern.path,
        status: 'discovered',
        createdAt: Date.now(),
      };
    }

    return null;
  }

  /** Scaffold code for a discovered feature */
  public async scaffoldFeature(featureId: string): Promise<DiscoveredFeature | undefined> {
    const feature = Array.from(this.discovered.values()).find(f => f.id === featureId);
    if (!feature) return undefined;
    if (this.scaffolding.has(featureId)) return feature;

    this.scaffolding.add(featureId);
    feature.status = 'scaffolding';

    try {
      const code = await this.scaffolder.scaffoldRoute(feature.method, feature.path, feature.intent);
      feature.scaffoldedCode = code;
      feature.status = 'scaffolded';
      this.logger.info('[FeatureDiscovery] Scaffolded feature', { featureId, path: feature.path });
      return feature;
    } catch (err: any) {
      this.logger.error(`[FeatureDiscovery] Failed to scaffold feature ${featureId}: ${err?.message ?? err}`);
      feature.status = 'rejected';
      return feature;
    } finally {
      this.scaffolding.delete(featureId);
    }
  }

  /** Get all discovered features */
  public getAll(): DiscoveredFeature[] {
    return Array.from(this.discovered.values());
  }

  /** Get features filtered by status */
  public getByStatus(status: DiscoveredFeature['status']): DiscoveredFeature[] {
    return Array.from(this.discovered.values()).filter(f => f.status === status);
  }

  /** Update a feature's deployment status */
  public updateStatus(featureId: string, status: DiscoveredFeature['status']): void {
    const feature = Array.from(this.discovered.values()).find(f => f.id === featureId);
    if (feature) {
      feature.status = status;
      if (status === 'deployed') {
        feature.deployedAt = Date.now();
      }
    }
  }
}
