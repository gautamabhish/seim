export interface EndpointOptimizationStatus {
  routeKey: string;
  isOptimizable: boolean;
  lastChecked: number;
  reason: string;
  optimizationAttempts: number;
  lastOptimizationAt?: number;
  cooldownUntil?: number;
}

export class EndpointTracker {
  private endpoints: Map<string, EndpointOptimizationStatus> = new Map();
  private readonly COOLDOWN_PERIOD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly MAX_ATTEMPTS = 3; // Maximum optimization attempts before marking as non-optimizable

  public check(routeKey: string): EndpointOptimizationStatus | undefined {
    return this.endpoints.get(routeKey);
  }

  public markAsNonOptimizable(routeKey: string, reason: string): void {
    const existing = this.endpoints.get(routeKey) || {
      routeKey,
      isOptimizable: true,
      lastChecked: Date.now(),
      reason: '',
      optimizationAttempts: 0,
    };

    existing.optimizationAttempts++;
    existing.isOptimizable = false;
    existing.reason = reason;
    existing.lastChecked = Date.now();
    existing.cooldownUntil = Date.now() + this.COOLDOWN_PERIOD;

    this.endpoints.set(routeKey, existing);
  }

  public markAsOptimizable(routeKey: string): void {
    const existing = this.endpoints.get(routeKey) || {
      routeKey,
      isOptimizable: true,
      lastChecked: Date.now(),
      reason: '',
      optimizationAttempts: 0,
    };

    existing.isOptimizable = true;
    existing.reason = '';
    existing.lastChecked = Date.now();
    existing.cooldownUntil = undefined;

    this.endpoints.set(routeKey, existing);
  }

  public recordOptimizationAttempt(routeKey: string): void {
    const existing = this.endpoints.get(routeKey) || {
      routeKey,
      isOptimizable: true,
      lastChecked: Date.now(),
      reason: '',
      optimizationAttempts: 0,
    };

    existing.optimizationAttempts++;
    existing.lastOptimizationAt = Date.now();
    existing.lastChecked = Date.now();

    // If too many attempts without success, mark as non-optimizable
    if (existing.optimizationAttempts >= this.MAX_ATTEMPTS) {
      existing.isOptimizable = false;
      existing.reason = `Maximum optimization attempts (${this.MAX_ATTEMPTS}) reached without success`;
      existing.cooldownUntil = Date.now() + this.COOLDOWN_PERIOD;
    }

    this.endpoints.set(routeKey, existing);
  }

  public shouldSkipOptimization(routeKey: string): boolean {
    const status = this.endpoints.get(routeKey);
    if (!status) return false;

    // If marked as non-optimizable and still in cooldown period
    if (!status.isOptimizable && status.cooldownUntil) {
      if (Date.now() < status.cooldownUntil) {
        return true;
      }
      // Cooldown expired, reset optimizable status
      this.markAsOptimizable(routeKey);
      return false;
    }

    return !status.isOptimizable;
  }

  public canAttemptOptimization(routeKey: string): boolean {
    return !this.shouldSkipOptimization(routeKey);
  }

  public getAllStatuses(): EndpointOptimizationStatus[] {
    return Array.from(this.endpoints.values());
  }

  public resetCooldown(routeKey: string): void {
    const status = this.endpoints.get(routeKey);
    if (status) {
      status.cooldownUntil = undefined;
      status.isOptimizable = true;
      status.reason = '';
      this.endpoints.set(routeKey, status);
    }
  }

  public clear(): void {
    this.endpoints.clear();
  }
}
