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
  build?: {
    enabled: boolean;
    buildCommand: string;
    outputDir: string;
    sourceDir: string;
    typescript: boolean;
    minify: boolean;
    sourcemap: boolean;
    autoBuild: boolean;
    buildTimeout: number;
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
  evolution?: Partial<EvolutionConfig>;
  schemaEvolution?: {
    mode: 'strict' | 'compatible' | 'permissive';
    allowBreakingChanges: boolean;
    requireApiVersioning: boolean;
    notifyOnSchemaChange: boolean;
    allowedAdditions: string[];
  };
  businessMetrics?: {
    enabled: boolean;
    kpis: string[];
    analyticsProvider?: 'mixpanel' | 'amplitude' | 'ga' | 'custom';
    apiKey?: string;
    dataSource?: 'custom' | 'analytics' | 'database';
  };
  featureEvolution?: {
    enabled: boolean;
    aiProvider?: 'openai' | 'anthropic' | 'custom';
    behaviorDataSource?: 'analytics' | 'database' | 'custom';
    abTestSampleSize: number;
    abTestDuration: number;
    statisticalSignificance: number;
    autoABTest?: boolean;
  };
  frontendEvolution?: {
    enabled: boolean;
    framework: 'react' | 'vue' | 'angular' | 'vanilla';
    codeValidation: 'strict' | 'moderate' | 'permissive';
    requireCodeSigning: boolean;
    sandboxExecution: boolean;
    componentCacheDuration: number;
    allowedDependencies: string[];
    autoGenerate?: boolean;
    autoDeploy?: boolean;
  };
  featureFlags?: {
    enabled: boolean;
    storage?: 'memory' | 'redis' | 'database';
    emergencyKillSwitch: boolean;
    autoCreateFlags?: boolean;
    autoRollout?: boolean;
    rolloutDuration?: number;
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
  layer2bSchemaCompatibility: { pass: boolean; reason?: string };
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
  businessMetrics?: any;
  behaviorAnalysis?: any;
  buildService?: any;
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
  bestImprovement?: number;
  bestSolutionCode?: string;
  bestOriginalCode?: string;
  routeKeys?: string[];
}

export interface EvolutionConfig {
  enabled: boolean;
  populationSize: number;
  maxGenerations: number;
  fitnessWeights: {
    latency: number;
    errorRate: number;
    memory: number;
    stability: number;
  };
  tournamentRounds: number;
  elitePreservation: boolean;
  driftDetection: boolean;
  driftThresholdPercent: number;
  driftCheckIntervalMs: number;
  patternExtraction: boolean;
  crossRouteIntelligence: boolean;
}

export interface FitnessScore {
  overall: number;
  latencyScore: number;
  errorRateScore: number;
  memoryScore: number;
  stabilityScore: number;
  generation: number;
  lineageId: string;
}

export interface EvolutionCandidate {
  id: string;
  routeKey: string;
  generation: number;
  parentId?: string;
  strategy: 'template' | 'ai-standard' | 'ai-creative' | 'learned-pattern' | 'crossover';
  code: string;
  originalCode: string;
  pattern: string;
  fitness?: FitnessScore;
  status: 'pending' | 'testing' | 'eliminated' | 'winner' | 'promoted';
  createdAt: number;
}

export interface OptimizationExplanation {
  routeKey: string;
  candidateId: string;
  pattern: string;
  strategy: string;
  whatChanged: string;
  whyChosen: string;
  measuredImpact: {
    latencyReduction: number;
    latencyReductionPercent: number;
    errorRateChange: number;
    memoryChange: number;
  };
  fitnessScore: number;
  generation: number;
  lineage: string[];
  relatedOptimizations: string[];
  timestamp: number;
}

// Feature Evolution Types
export interface FeatureOpportunity {
  id: string;
  type: 'personalization' | 'recommendation' | 'pricing' | 'content';
  description: string;
  expectedImpact: number;
  confidence: number;
}

export interface FeatureVariant {
  id: string;
  code: string;
  strategy: string;
  metadata: Record<string, any>;
}

export interface UserBehaviorData {
  userId: string;
  actions: UserAction[];
  segments: string[];
  kpis: Record<string, number>;
}

export interface UserAction {
  action: string;
  timestamp: number;
  properties: Record<string, any>;
}

// Frontend Evolution Types
export interface ComponentUpdate {
  componentId: string;
  code: string;
  version: string;
  dependencies: string[];
  framework: string;
  checksum: string;
}

export interface BackendChange {
  field: string;
  type: 'added' | 'removed' | 'modified';
  description: string;
}

export interface ComponentVersion {
  id: string;
  version: string;
  code: string;
  dependencies: string[];
  createdAt: number;
  checksum: string;
}

// A/B Testing Types
export interface ABTest {
  id: string;
  featureId: string;
  variants: FeatureVariant[];
  status: 'created' | 'running' | 'completed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  config: ABTestConfig;
}

export interface ABTestConfig {
  featureId: string;
  sampleSize: number;
  duration: number;
  trafficSplit: Record<string, number>;
  successMetrics: string[];
}

export interface StatisticalResult {
  significant: boolean;
  confidence: number;
  winner?: string;
  pValue: number;
}

export interface TestResult {
  winner: string;
  confidence: number;
  improvement: number;
  recommendations: string[];
}

// Schema Evolution Types
export interface SchemaChange {
  id: string;
  routeKey: string;
  oldVersion: string;
  newVersion: string;
  type: 'backward_compatible' | 'breaking';
  description: string;
  changedFields: string[];
  timestamp: number;
}

export interface SchemaVersion {
  version: string;
  routeKey: string;
  schema: any;
  createdAt: number;
}

// Frontend Evolution Types
export interface FrontendComponent {
  id: string;
  routeKey: string;
  framework: string;
  code: string;
  schemaVersion: string;
  generatedAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'deployed' | 'active' | 'rollback_available';
  approvedAt?: number;
  rejectedAt?: number;
  deployedAt?: number;
  metadata: {
    changeId?: string;
    reviewPassed?: boolean;
    reviewReason?: string;
    rejectionReason?: string;
  };
}

// Feature Flags Types
export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetSegments: string[];
  targetType: 'all' | 'segment' | 'user' | 'none';
  conditions: any[];
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface FlagEvaluationContext {
  userId: string;
  segments?: string[];
  attributes?: Record<string, any>;
  timestamp?: number;
}

export interface StatisticalResult {
  significant: boolean;
  confidence: number;
  winner?: string;
  pValue: number;
}

export interface TestResult {
  winner: string;
  confidence: number;
  improvement: number;
  recommendations: string[];
}
