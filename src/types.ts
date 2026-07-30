import { Request, Response, NextFunction, RequestHandler } from 'express';
import { LogLevel } from './logger';

export type SeimMode = 'restrict' | 'bypass';

export type BusinessRule<T = unknown> = (response: T, request?: Request) => boolean | Promise<boolean>;

export type SecurityRule = (oldCode: string, newCode: string) => { pass: boolean; reason?: string };

export interface OptimizationCandidate {
  id: string;
  routeKey: string;
  pattern: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  originalCode: string;
  optimizedCode?: string;
  confidence: number;
  status: 'pending' | 'validating' | 'shadow' | 'promoted' | 'rejected' | 'rolledback';
  createdAt: number;
  updatedAt: number;
}

export interface SeimConfig {
  mode: SeimMode;
  environment?: 'development' | 'production';
  framework?: 'express' | 'fastify' | 'http' | 'generic';
  studioPath: string;
  storagePath?: string;
  businessRules: BusinessRule[];
  securityRules: SecurityRule[];
  production?: {
    ciCd?: {
      enabled?: boolean;
      outputDir?: string;
    };
    requireIsolatedVm?: boolean;
  };
  ai: {
    generatorModel: string;
    reviewerModel: string;
    verifierModel: string;
    provider?: 'openai' | 'anthropic' | 'google' | 'grok' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    enabled: boolean;
    headers?: Record<string, string>;
    responsePath?: string;
  };
  experiment: {
    confidenceThreshold: number;
    canaryPercent: number;
    rollbackLatencyMs: number;
    rollbackErrorRate: number;
    minSampleSize: number;
    shadowCooldownMs: number;
    shadowAllowedMethods: string[];
    shadowSampleSize: number;
    sandboxTimeoutMs?: number;
  };
  storage: {
    type: 'memory' | 'sqlite' | 'redis';
    connection?: string;
  };
  security: {
    blockAuthenticationChanges: boolean;
    blockAuthorizationChanges: boolean;
    blockPaymentChanges: boolean;
    blockSecretUsage: boolean;
    allowedPatternModels: string[];
  };
  learning: {
    enabled: boolean;
    persistencePath?: string;
    sampleSize: number;
  };
  logging?: {
    level?: LogLevel;
    json?: boolean;
  };
  worker?: {
    enabled?: boolean;
    intervalMs?: number;
    batchSize?: number;
  };
  autoMiddleware?: {
    etag?: boolean;
    compression?: boolean;
    caching?: boolean;
    rateLimit?: boolean;
  };
}

export interface RouteMetrics {
  requestCount: number;
  errorCount: number;
  timeoutCount: number;
  totalDuration: number;
  durations: number[];
  responseSizes: number[];
  payloadSizes: number[];
  statusCodes: Record<number, number>;
  lastSeen: number;
}

export interface HotRoute {
  routeKey: string;
  requestCount: number;
  averageLatency: number;
  p95: number;
  p99: number;
  errorRate: number;
  throughput: number;
}

export interface MetricsSnapshot {
  routes: Record<string, RouteMetrics>;
  hotRoutes: HotRoute[];
  aggregate: {
    totalRequests: number;
    totalErrors: number;
    averageLatency: number;
    p95: number;
    p99: number;
    throughput: number;
    peakTrafficTime?: number;
  };
  system: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    uptime: number;
  };
  generatedAt: number;
}

export interface ValidationReport {
  candidateId: string;
  layer1Schema: { pass: boolean; reason?: string };
  layer2ResponseEquivalence: { pass: boolean; reason?: string };
  layer3BusinessRules: { pass: boolean; violations: string[] };
  layer4UnitTests: { pass: boolean; reason?: string };
  layer5IntegrationTests: { pass: boolean; reason?: string };
  layer6Security: { pass: boolean; reason?: string };
  layer7AICritic: { pass: boolean; reason?: string };
  layer8PerformanceGate: { pass: boolean; reason?: string };
  overall: boolean;
}

export interface ExperimentReport {
  candidateId: string;
  routeKey: string;
  v1Latency: number;
  v2Latency: number;
  v1Errors: number;
  v2Errors: number;
  v1Memory: number;
  v2Memory: number;
  sampleSize: number;
  promoted: boolean;
  rolledBack: boolean;
  reason?: string;
}

export interface SeimStatus {
  mode: SeimMode;
  framework: string;
  uptime: number;
  totalOptimizationsGenerated: number;
  totalOptimizationsPromoted: number;
  totalRollbacks: number;
  activeShadowTests: number;
  activeVersions: { routeKey: string; active: 'original' | 'optimized' }[];
  workerQueueSize: number;
  lastOptimizationAt?: number;
  healthy: boolean;
}

export interface MetricsStore {
  record(routeKey: string, duration: number, statusCode: number, responseSize: number, payloadSize: number, error: boolean, timeout: boolean): void;
  snapshot(): MetricsSnapshot;
  hotRoutes(limit: number): HotRoute[];
  forRoute(routeKey: string): RouteMetrics | undefined;
}

export interface SeimInstance {
  listener: () => any;
  plugin?: () => any;
  dashboard: any;
  status(): SeimStatus;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
  config: Readonly<SeimConfig>;
  metrics: MetricsStore;
  endpointTracker?: any;
  productionManager?: any;
  dynamicRouter?: any;
  versionManager?: any;
}

export type RequestListener = (req: Request, res: Response, next: NextFunction) => void;

export interface OptimizationMemory {
  problem: string;
  solution: string;
  framework: string;
  successCount: number;
  failureCount: number;
  averageImprovement: number;
  lastUsed: number;
}
