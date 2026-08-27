export interface RuntimeVersion<THandler = any> {
  id: string;
  routeKey: string;
  handler: THandler;
  sourceHash: string;
  artifactHash?: string;
  status: 'candidate' | 'shadow' | 'canary' | 'active' | 'rolled-back';
  canaryPercent: number;
  createdAt: number;
  promotedAt?: number;
  rolledBackAt?: number;
  metadata?: {
    pattern?: string;
    candidateId?: string;
    generation?: number;
    strategy?: string;
    reason?: string;
    [key: string]: any;
  };
}

export class VersionRegistry<THandler = any> {
  private versions = new Map<string, RuntimeVersion<THandler>[]>();
  private activeVersionIds = new Map<string, string>(); // routeKey -> versionId
  private canaryVersionIds = new Map<string, string>(); // routeKey -> versionId

  public register(version: RuntimeVersion<THandler>): void {
    const list = this.versions.get(version.routeKey) || [];
    // Replace if same version ID exists
    const idx = list.findIndex((v) => v.id === version.id);
    if (idx >= 0) {
      list[idx] = version;
    } else {
      list.push(version);
    }
    this.versions.set(version.routeKey, list);

    if (version.status === 'active') {
      this.activeVersionIds.set(version.routeKey, version.id);
    } else if (version.status === 'canary') {
      this.canaryVersionIds.set(version.routeKey, version.id);
    }
  }

  public getActive(routeKey: string): RuntimeVersion<THandler> | undefined {
    const versionId = this.activeVersionIds.get(routeKey);
    if (!versionId) {
      const list = this.versions.get(routeKey) || [];
      return list.find((v) => v.status === 'active');
    }
    return this.getVersion(routeKey, versionId);
  }

  public getCanary(routeKey: string): RuntimeVersion<THandler> | undefined {
    const versionId = this.canaryVersionIds.get(routeKey);
    if (!versionId) {
      const list = this.versions.get(routeKey) || [];
      return list.find((v) => v.status === 'canary');
    }
    return this.getVersion(routeKey, versionId);
  }

  public getVersion(routeKey: string, versionId: string): RuntimeVersion<THandler> | undefined {
    const list = this.versions.get(routeKey);
    return list?.find((v) => v.id === versionId);
  }

  public promote(routeKey: string, versionId: string, reason?: string): boolean {
    const version = this.getVersion(routeKey, versionId);
    if (!version) return false;

    // Demote current active
    const currentActive = this.getActive(routeKey);
    if (currentActive && currentActive.id !== versionId) {
      currentActive.status = 'rolled-back';
      currentActive.rolledBackAt = Date.now();
    }

    // Clear canary if this version was the canary
    if (this.canaryVersionIds.get(routeKey) === versionId) {
      this.canaryVersionIds.delete(routeKey);
    }

    version.status = 'active';
    version.canaryPercent = 100;
    version.promotedAt = Date.now();
    if (reason) {
      version.metadata = { ...version.metadata, promoteReason: reason };
    }
    this.activeVersionIds.set(routeKey, versionId);
    return true;
  }

  public rollback(routeKey: string, reason?: string, fallbackVersionId?: string): boolean {
    const active = this.getActive(routeKey);
    const canary = this.getCanary(routeKey);

    if (canary) {
      canary.status = 'rolled-back';
      canary.rolledBackAt = Date.now();
      if (reason) {
        canary.metadata = { ...canary.metadata, rollbackReason: reason };
      }
      this.canaryVersionIds.delete(routeKey);
    }

    if (fallbackVersionId) {
      return this.promote(routeKey, fallbackVersionId, reason || 'Rollback to fallback');
    }

    if (active) {
      const list = this.versions.get(routeKey) || [];
      // Find the original or previous stable version
      const original = list.find((v) => v.id.includes('original') || v.id.includes('v1.0.0') || v.status !== 'rolled-back');
      if (original && original.id !== active.id) {
        return this.promote(routeKey, original.id, reason || 'Rollback to baseline');
      }
    }

    return true;
  }

  public setCanaryPercent(routeKey: string, versionId: string, percent: number): boolean {
    const version = this.getVersion(routeKey, versionId);
    if (!version) return false;

    version.status = 'canary';
    version.canaryPercent = Math.max(0, Math.min(100, percent));
    this.canaryVersionIds.set(routeKey, versionId);
    return true;
  }

  public list(routeKey?: string): RuntimeVersion<THandler>[] {
    if (routeKey) {
      return [...(this.versions.get(routeKey) || [])];
    }
    const all: RuntimeVersion<THandler>[] = [];
    for (const list of this.versions.values()) {
      all.push(...list);
    }
    return all;
  }

  public clear(): void {
    this.versions.clear();
    this.activeVersionIds.clear();
    this.canaryVersionIds.clear();
  }
}
