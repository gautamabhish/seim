export interface EndpointOptimizationStatus {
  routeKey: string;
  isOptimizable: boolean;
  lastChecked: number;
  reason: string;
  optimizationAttempts: number;
  lastOptimizationAt?: number;
  cooldownUntil?: number;
  /** Health score 0-100. Higher = healthier. Gates optimization attempts. */
  healthScore: number;
  /** Number of consecutive failures (drives exponential backoff). */
  consecutiveFailures: number;
  /** History of recent failure reasons for diagnostics. */
  failureHistory: { at: number; reason: string }[];
}

export class EndpointTracker {
  private endpoints: Map<string, EndpointOptimizationStatus> = new Map();
  private readonly BASE_COOLDOWN = 60 * 60 * 1000; // 1 hour base
  private readonly MAX_COOLDOWN = 48 * 60 * 60 * 1000; // 48 hours max
  private readonly MAX_ATTEMPTS = 5;
  private readonly HEALTH_THRESHOLD = 30; // Minimum health score to attempt optimization
  private readonly MAX_FAILURE_HISTORY = 20;

  public check(routeKey: string): EndpointOptimizationStatus | undefined {
    return this.endpoints.get(routeKey);
  }

  public markAsNonOptimizable(routeKey: string, reason: string): void {
    const existing = this.getOrCreate(routeKey);

    existing.consecutiveFailures++;
    existing.isOptimizable = false;
    existing.reason = reason;
    existing.lastChecked = Date.now();

    // Exponential backoff: baseCooldown * 2^failures, capped at MAX_COOLDOWN
    const backoff = Math.min(
      this.BASE_COOLDOWN * Math.pow(2, existing.consecutiveFailures - 1),
      this.MAX_COOLDOWN,
    );
    existing.cooldownUntil = Date.now() + backoff;

    // Degrade health score
    existing.healthScore = Math.max(0, existing.healthScore - 15);

    // Record failure
    existing.failureHistory.push({ at: Date.now(), reason });
    if (existing.failureHistory.length > this.MAX_FAILURE_HISTORY) {
      existing.failureHistory.shift();
    }

    this.endpoints.set(routeKey, existing);
  }

  public markAsOptimizable(routeKey: string): void {
    const existing = this.getOrCreate(routeKey);

    existing.isOptimizable = true;
    existing.reason = '';
    existing.lastChecked = Date.now();
    existing.cooldownUntil = undefined;

    this.endpoints.set(routeKey, existing);
  }

  public recordOptimizationAttempt(routeKey: string): void {
    const existing = this.getOrCreate(routeKey);

    existing.optimizationAttempts++;
    existing.lastOptimizationAt = Date.now();
    existing.lastChecked = Date.now();

    // If too many attempts without success, mark as non-optimizable
    if (existing.optimizationAttempts >= this.MAX_ATTEMPTS) {
      existing.isOptimizable = false;
      existing.reason = `Maximum optimization attempts (${this.MAX_ATTEMPTS}) reached without success`;
      existing.consecutiveFailures++;
      const backoff = Math.min(
        this.BASE_COOLDOWN * Math.pow(2, existing.consecutiveFailures - 1),
        this.MAX_COOLDOWN,
      );
      existing.cooldownUntil = Date.now() + backoff;
    }

    this.endpoints.set(routeKey, existing);
  }

  /** Record a successful optimization to boost health and reset failure counter. */
  public recordSuccess(routeKey: string): void {
    const existing = this.getOrCreate(routeKey);
    existing.consecutiveFailures = 0;
    existing.healthScore = Math.min(100, existing.healthScore + 20);
    existing.optimizationAttempts = 0;
    existing.isOptimizable = true;
    existing.reason = '';
    existing.cooldownUntil = undefined;
    this.endpoints.set(routeKey, existing);
  }

  /** Feed healthy request traffic to gradually restore health score. */
  public recordHealthyRequest(routeKey: string): void {
    const existing = this.endpoints.get(routeKey);
    if (!existing) return;
    // Gradually recover: +0.1 per healthy request, capped at 100
    existing.healthScore = Math.min(100, existing.healthScore + 0.1);
  }

  /** Feed error traffic to degrade health score. */
  public recordErrorRequest(routeKey: string): void {
    const existing = this.endpoints.get(routeKey);
    if (!existing) return;
    existing.healthScore = Math.max(0, existing.healthScore - 1);
  }

  public shouldSkipOptimization(routeKey: string): boolean {
    const status = this.endpoints.get(routeKey);
    if (!status) return false;

    // Health score too low — route is unhealthy, don't make it worse
    if (status.healthScore < this.HEALTH_THRESHOLD) return true;

    // If marked as non-optimizable and still in cooldown period
    if (!status.isOptimizable && status.cooldownUntil) {
      if (Date.now() < status.cooldownUntil) {
        return true;
      }
      // Cooldown expired, reset optimizable status but keep failure count
      status.isOptimizable = true;
      status.reason = '';
      status.cooldownUntil = undefined;
      status.optimizationAttempts = 0;
      this.endpoints.set(routeKey, status);
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
      status.consecutiveFailures = 0;
      status.optimizationAttempts = 0;
      this.endpoints.set(routeKey, status);
    }
  }

  public resetRoute(routeKey: string): void {
    this.endpoints.delete(routeKey);
  }

  public clear(): void {
    this.endpoints.clear();
  }

  private getOrCreate(routeKey: string): EndpointOptimizationStatus {
    return this.endpoints.get(routeKey) || {
      routeKey,
      isOptimizable: true,
      lastChecked: Date.now(),
      reason: '',
      optimizationAttempts: 0,
      healthScore: 100,
      consecutiveFailures: 0,
      failureHistory: [],
    };
  }
}
