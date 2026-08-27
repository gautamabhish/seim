import { RollbackEngine } from '../src/rollback';
import { SeimConfig, ExperimentReport } from '../src/types';

describe('RollbackEngine', () => {
  let rollbackEngine: RollbackEngine;
  let config: SeimConfig;

  beforeEach(() => {
    config = {
      mode: 'bypass',
      studioPath: '/studio',
      businessRules: [],
      securityRules: [],
      ai: { enabled: false, generatorModel: '', reviewerModel: '', verifierModel: '' },
      experiment: {
        confidenceThreshold: 0.9,
        canaryPercent: 10,
        rollbackLatencyMultiplier: 1.2,
        rollbackErrorRate: 1.5,
        minSampleSize: 5,
        shadowCooldownMs: 1000,
        shadowAllowedMethods: ['GET'],
        shadowSampleSize: 10,
      },
      storage: { type: 'memory' },
      security: {
        blockAuthenticationChanges: true,
        blockAuthorizationChanges: true,
        blockPaymentChanges: true,
        blockSecretUsage: true,
        allowedPatternModels: ['sequential-async'],
      },
      learning: { enabled: true, sampleSize: 5 },
    };
    rollbackEngine = new RollbackEngine(config);
  });

  it('should register shadows and evaluate promote status correctly when autonomousPromotion is enabled', () => {
    // Enable autonomous promotion to test auto-promote flow
    config.autonomousPromotion = true;
    rollbackEngine = new RollbackEngine(config);

    const routeInfo = { route: { stack: [{ handle: () => {} }] }, index: 0 };
    const original = () => {};
    const optimized = () => {};
    const routeKey = '/api/v1/test';

    rollbackEngine.registerShadow(routeKey, routeInfo, original, optimized);

    const report: ExperimentReport = {
      candidateId: 'c1',
      routeKey,
      v1Latency: 100,
      v2Latency: 50, // 50% improvement
      v1Errors: 0,
      v2Errors: 0,
      v1Memory: 1000,
      v2Memory: 1000,
      sampleSize: 15, // meets the shadowSampleSize limit of 10
      promoted: false,
      rolledBack: false,
    };

    const status = rollbackEngine.evaluate(routeKey, report);
    expect(status).toBe('promote');
    expect(rollbackEngine.isPromoted(routeKey)).toBe(true);
  });

  it('should return manual-review when autonomousPromotion is disabled (default)', () => {
    // Default config has autonomousPromotion = false
    const routeInfo = { route: { stack: [{ handle: () => {} }] }, index: 0 };
    const original = () => {};
    const optimized = () => {};
    const routeKey = '/api/v1/test';

    rollbackEngine.registerShadow(routeKey, routeInfo, original, optimized);

    const report: ExperimentReport = {
      candidateId: 'c1',
      routeKey,
      v1Latency: 100,
      v2Latency: 50,
      v1Errors: 0,
      v2Errors: 0,
      v1Memory: 1000,
      v2Memory: 1000,
      sampleSize: 15,
      promoted: false,
      rolledBack: false,
    };

    const status = rollbackEngine.evaluate(routeKey, report);
    expect(status).toBe('manual-review');
    expect(rollbackEngine.isPromoted(routeKey)).toBe(false);
  });

  it('should trigger rollback on latency regression', () => {
    const routeInfo = { route: { stack: [{ handle: () => {} }] }, index: 0 };
    const original = () => {};
    const optimized = () => {};
    const routeKey = '/api/v1/test';

    rollbackEngine.registerShadow(routeKey, routeInfo, original, optimized);
    // Pretend it was promoted first
    rollbackEngine.promote(routeKey);

    const report: ExperimentReport = {
      candidateId: 'c1',
      routeKey,
      v1Latency: 100,
      v2Latency: 150, // 50% slower! exceeding multiplier 1.2
      v1Errors: 0,
      v2Errors: 0,
      v1Memory: 1000,
      v2Memory: 1000,
      sampleSize: 10,
      promoted: true,
      rolledBack: false,
    };

    const status = rollbackEngine.evaluate(routeKey, report);
    expect(status).toBe('rollback');
    expect(rollbackEngine.isPromoted(routeKey)).toBe(false);
  });
});
