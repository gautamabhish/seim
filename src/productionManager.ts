import { SeimConfig } from './types';

export interface ProductionDeployment {
  routeKey: string;
  version: 'original' | 'optimized';
  deployedAt: number;
  canaryPercent: number;
  healthStatus: 'healthy' | 'degraded' | 'failing';
  rollbackThresholds: {
    errorRate: number;
    latencyThreshold: number;
    sampleSize: number;
  };
}

export interface DeploymentMetrics {
  currentErrors: number;
  currentLatency: number;
  errorRate: number;
  sampleCount: number;
  lastUpdated: number;
}

export class ProductionManager {
  private deployments: Map<string, ProductionDeployment> = new Map();
  private healthChecks: Map<string, DeploymentMetrics> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private config: SeimConfig;

  constructor(config: SeimConfig) {
    this.config = config;
    this.startHealthMonitoring();
  }

  public destroy(): void {
    this.stopMonitoring();
  }

  public startDeployment(routeKey: string, canaryPercent: number = 5): ProductionDeployment {
    const deployment: ProductionDeployment = {
      routeKey,
      version: 'optimized',
      deployedAt: Date.now(),
      canaryPercent,
      healthStatus: 'healthy',
      rollbackThresholds: {
        errorRate: this.config.experiment.rollbackErrorRate,
        latencyThreshold: this.config.experiment.rollbackLatencyMs,
        sampleSize: this.config.experiment.shadowSampleSize,
      },
    };

    this.deployments.set(routeKey, deployment);
    this.initializeHealthCheck(routeKey);
    
    return deployment;
  }

  public updateCanaryPercent(routeKey: string, newPercent: number): boolean {
    const deployment = this.deployments.get(routeKey);
    if (!deployment) return false;

    deployment.canaryPercent = newPercent;
    deployment.deployedAt = Date.now(); // Reset deployment time
    
    return true;
  }

  public rollback(routeKey: string, reason: string): boolean {
    const deployment = this.deployments.get(routeKey);
    if (!deployment) return false;

    deployment.version = 'original';
    deployment.healthStatus = 'failing';
    deployment.deployedAt = Date.now();
    
    console.log(`[PRODUCTION] Rolled back ${routeKey}: ${reason}`);
    
    return true;
  }

  public promoteToFullTraffic(routeKey: string): boolean {
    const deployment = this.deployments.get(routeKey);
    if (!deployment) return false;

    // Gradual increase: 5% → 25% → 50% → 75% → 100%
    const stages = [5, 25, 50, 75, 100];
    const currentStage = stages.indexOf(deployment.canaryPercent);
    
    if (currentStage === -1 || currentStage >= stages.length - 1) {
      // Already at 100% or invalid state
      deployment.canaryPercent = 100;
      return true;
    }

    deployment.canaryPercent = stages[currentStage + 1];
    deployment.deployedAt = Date.now();
    
    console.log(`[PRODUCTION] Increased canary for ${routeKey} to ${deployment.canaryPercent}%`);
    
    return true;
  }

  public getDeployment(routeKey: string): ProductionDeployment | undefined {
    return this.deployments.get(routeKey);
  }

  public getAllDeployments(): ProductionDeployment[] {
    return Array.from(this.deployments.values());
  }

  private initializeHealthCheck(routeKey: string): void {
    this.healthChecks.set(routeKey, {
      currentErrors: 0,
      currentLatency: 0,
      errorRate: 0,
      sampleCount: 0,
      lastUpdated: Date.now(),
    });
  }

  private startHealthMonitoring(): void {
    // Run health checks every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.runHealthChecks();
    }, 30000);
    // Don't keep the process alive just for seim health monitoring
    if (this.monitoringInterval.unref) this.monitoringInterval.unref();
  }

  private runHealthChecks(): void {
    this.deployments.forEach((deployment, routeKey) => {
      if (deployment.version === 'original') return; // Skip rolled back deployments

      const healthCheck = this.healthChecks.get(routeKey);
      if (!healthCheck) return;

      // Check if we need to auto-rollback
      if (healthCheck.sampleCount >= deployment.rollbackThresholds.sampleSize) {
        if (healthCheck.errorRate > deployment.rollbackThresholds.errorRate) {
          this.rollback(routeKey, `Error rate ${healthCheck.errorRate} exceeds threshold ${deployment.rollbackThresholds.errorRate}`);
        } else if (healthCheck.currentLatency > deployment.rollbackThresholds.latencyThreshold) {
          this.rollback(routeKey, `Latency ${healthCheck.currentLatency}ms exceeds threshold ${deployment.rollbackThresholds.latencyThreshold}ms`);
        } else {
          // Health is good, consider increasing canary
          this.promoteToFullTraffic(routeKey);
        }
      }
    });
  }

  public updateHealthMetrics(routeKey: string, metrics: Partial<DeploymentMetrics>): void {
    const healthCheck = this.healthChecks.get(routeKey);
    if (!healthCheck) return;

    Object.assign(healthCheck, metrics, { lastUpdated: Date.now() });
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}
