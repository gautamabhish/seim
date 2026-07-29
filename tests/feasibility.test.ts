import { MetricsAnalyzer } from '../src/metricsAnalyzer';
import { EndpointTracker } from '../src/endpointTracker';
import { VersionManager } from '../src/versionManager';
import { SeimConfig, RouteMetrics } from '../src/types';

describe('Feasibility Metrics', () => {
  let config: SeimConfig;

  beforeEach(() => {
    config = {
      mode: 'bypass',
      studioPath: '/tmp/test',
      businessRules: [],
      securityRules: [],
      ai: {
        generatorModel: 'gpt-4',
        reviewerModel: 'gpt-4',
        verifierModel: 'gpt-4',
        enabled: false,
      },
      experiment: {
        confidenceThreshold: 0.92,
        canaryPercent: 5,
        rollbackLatencyMs: 1.2,
        rollbackErrorRate: 1.5,
        minSampleSize: 100,
        shadowCooldownMs: 60000,
        shadowAllowedMethods: ['GET'],
        shadowSampleSize: 25,
      },
      storage: {
        type: 'memory',
      },
      security: {
        blockAuthenticationChanges: true,
        blockAuthorizationChanges: true,
        blockPaymentChanges: true,
        blockSecretUsage: true,
        allowedPatternModels: [],
      },
      learning: {
        enabled: true,
        sampleSize: 50,
      },
    };
  });

  describe('Adoption Feasibility Metrics', () => {
    it('should measure accuracy of performance analysis', () => {
      const analyzer = new MetricsAnalyzer();

      // Test case 1: Good performance should not trigger optimization
      const goodMetrics: RouteMetrics = {
        requestCount: 1000,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 50000, // 50ms average
        durations: Array(1000).fill(50),
        responseSizes: Array(1000).fill(100),
        payloadSizes: Array(1000).fill(0),
        statusCodes: { '200': 1000 },
        lastSeen: Date.now(),
      };

      const goodResult = analyzer.analyze('/api/good', goodMetrics);

      // Test case 2: Poor performance should trigger optimization
      const poorMetrics: RouteMetrics = {
        requestCount: 1000,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 2000000, // 2000ms average (very poor)
        durations: Array(1000).fill(2000),
        responseSizes: Array(1000).fill(100),
        payloadSizes: Array(1000).fill(0),
        statusCodes: { '200': 1000 },
        lastSeen: Date.now(),
      };

      const poorResult = analyzer.analyze('/api/poor', poorMetrics);

      console.log('Performance Analysis Accuracy:');
      console.log(`  Good performance (50ms avg): needsOptimization = ${goodResult.needsOptimization}`);
      console.log(`  Poor performance (2000ms avg): needsOptimization = ${poorResult.needsOptimization}`);

      expect(goodResult.needsOptimization).toBe(false);
      expect(poorResult.needsOptimization).toBe(true);
    });

    it('should measure false positive rate', () => {
      const analyzer = new MetricsAnalyzer();

      // Generate realistic data that should not need optimization
      const realisticMetrics: RouteMetrics = {
        requestCount: 1000,
        errorCount: 10, // 1% error rate (acceptable)
        timeoutCount: 0,
        totalDuration: 80000, // 80ms average (acceptable)
        durations: Array(990).fill(80).concat([150, 150, 150, 150, 150, 150, 150, 150, 150, 150]), // Some outliers
        responseSizes: Array(1000).fill(100),
        payloadSizes: Array(1000).fill(0),
        statusCodes: { '200': 990, '500': 10 },
        lastSeen: Date.now(),
      };

      const result = analyzer.analyze('/api/realistic', realisticMetrics);

      console.log('False Positive Test:');
      console.log(`  Realistic performance: needsOptimization = ${result.needsOptimization}`);
      console.log(`  Reason: ${result.reason}`);
      console.log(`  Priority: ${result.priority}`);

      // Should not trigger optimization for acceptable performance
      expect(result.needsOptimization).toBe(false);
    });

    it('should measure token saving effectiveness', () => {
      const tracker = new EndpointTracker();

      // Simulate scenario where endpoint is marked as non-optimizable
      tracker.markAsNonOptimizable('/api/test', 'Already optimal');

      const iterations = 1000;
      let skipCount = 0;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        if (tracker.shouldSkipOptimization('/api/test')) {
          skipCount++;
        }
      }
      const endTime = Date.now();

      const skipRate = (skipCount / iterations) * 100;
      const avgTimeMs = (endTime - startTime) / iterations;

      console.log('Token Saving Effectiveness:');
      console.log(`  Skip rate: ${skipRate.toFixed(1)}%`);
      console.log(`  Average check time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`  Time saved from skipping AI calls: ${skipRate * 100}%`);

      expect(skipRate).toBe(100); // Should skip all checks
      expect(avgTimeMs).toBeLessThan(0.1); // Very fast when skipping
    });

    it('should measure memory efficiency', async () => {
      const manager = new VersionManager(config);

      // Measure memory for increasing number of versions
      const versionCounts = [10, 50, 100, 500];
      const memoryUsages = versionCounts.map(async (count) => {
        const manager = new VersionManager(config);
        for (let i = 0; i < count; i++) {
          await manager.createVersion('/api/test', `code ${i}`, {
            createdBy: 'manual',
            reason: 'Test',
          });
        }
        const versions = await manager.getAllVersions('/api/test');
        return {
          count,
          memory: JSON.stringify(versions).length,
          avgPerVersion: JSON.stringify(versions).length / count,
        };
      });

      console.log('Memory Efficiency:');
      for (const { count, memory, avgPerVersion } of await Promise.all(memoryUsages)) {
        console.log(`  ${count} versions: ${memory} bytes (${avgPerVersion.toFixed(0)} bytes/version)`);
      }

      // Memory should scale roughly linearly
      const last = await memoryUsages[memoryUsages.length - 1];
      expect(last.memory).toBeLessThan(10 * 1024 * 1024); // Should be < 10MB for 500 versions
    });

    it('should measure scalability with concurrent endpoints', async () => {
      const manager = new VersionManager(config);
      const tracker = new EndpointTracker();
      const analyzer = new MetricsAnalyzer();

      const endpointCounts = [10, 50, 100, 500];
      const results = endpointCounts.map(async (count) => {
        const startTime = Date.now();

        // Create endpoints
        for (let i = 0; i < count; i++) {
          const routeKey = `/api/endpoint${i}`;
          await manager.createVersion(routeKey, 'code', {
            createdBy: 'manual',
            reason: 'Test',
          });
          tracker.markAsNonOptimizable(routeKey, 'Test');
        }

        // Analyze each endpoint
        for (let i = 0; i < count; i++) {
          const durations = Array(100).fill(50);
          const totalDuration = durations.reduce((a, b) => a + b, 0);
          const metrics: RouteMetrics = {
            requestCount: 100,
            errorCount: 0,
            timeoutCount: 0,
            totalDuration,
            durations,
            responseSizes: Array(100).fill(100),
            payloadSizes: Array(100).fill(0),
            statusCodes: { '200': 100 },
            lastSeen: Date.now(),
          };
          analyzer.analyze(`/api/endpoint${i}`, metrics);
        }

        const endTime = Date.now();

        return {
          count,
          time: endTime - startTime,
          avgPerEndpoint: (endTime - startTime) / count,
        };
      });

      console.log('Scalability with Concurrent Endpoints:');
      for (const { count, time, avgPerEndpoint } of await Promise.all(results)) {
        console.log(`  ${count} endpoints: ${time.toFixed(0)}ms total (${avgPerEndpoint.toFixed(2)}ms/endpoint)`);
      }

      // Should scale roughly linearly
      const last = await results[results.length - 1];
      expect(last.avgPerEndpoint).toBeLessThan(10); // Should be < 10ms per endpoint
    });

    it('should measure rollback safety', async () => {
      const manager = new VersionManager(config);

      // Create versions
      const v1 = await manager.createVersion('/api/test', 'code1', {
        createdBy: 'manual',
        reason: 'v1',
      });
      const v2 = await manager.createVersion('/api/test', 'code2', {
        createdBy: 'ai',
        reason: 'v2',
      });

      // Activate v2
      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Deploy v2',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });

      // Attempt rollback to v1
      const rollbackSuccess = await manager.rollbackToVersion('/api/test', v1.id, 'Test rollback');

      console.log('Rollback Safety:');
      console.log(`  Rollback successful: ${rollbackSuccess}`);
      console.log(`  v1 rollbackSafe: ${v1.rollbackSafe}`);
      console.log(`  v2 rollbackSafe: ${v2.rollbackSafe}`);

      expect(rollbackSuccess).toBe(true);
      expect(v1.rollbackSafe).toBe(true);

      // Check that rollback version was created
      const versions = await manager.getAllVersions('/api/test');
      const rollbackVersion = versions.find(v => v.type === 'rollback');
      expect(rollbackVersion).toBeDefined();
    });

    it('should measure operational overhead', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

      // Simulate realistic workload
      const iterations = 1000;
      const routeKeys = ['/api/users', '/api/products', '/api/orders', '/api/cart', '/api/checkout'];

      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        const routeKey = routeKeys[i % routeKeys.length];

        // Check tracker
        tracker.shouldSkipOptimization(routeKey);

        // Analyze metrics (simplified)
        const durations = Array(100).fill(50);
        const totalDuration = durations.reduce((a, b) => a + b, 0);
        const metrics: RouteMetrics = {
          requestCount: 100,
          errorCount: 0,
          timeoutCount: 0,
          totalDuration,
          durations,
          responseSizes: Array(100).fill(100),
          payloadSizes: Array(100).fill(0),
          statusCodes: { '200': 100 },
          lastSeen: Date.now(),
        };
        analyzer.analyze(routeKey, metrics);
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      const opsPerSecond = 1000 / avgTimeMs;

      console.log('Operational Overhead:');
      console.log(`  Average operation time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`  Operations per second: ${opsPerSecond.toFixed(0)}`);
      console.log(`  Overhead per request: ${avgTimeMs.toFixed(3)}ms`);

      expect(avgTimeMs).toBeLessThan(1); // Should be < 1ms per operation
      expect(opsPerSecond).toBeGreaterThan(1000); // Should handle > 1000 ops/sec
    });
  });

  describe('Production Readiness Metrics', () => {
    it('should measure system stability under load', async () => {
      const manager = new VersionManager(config);
      const tracker = new EndpointTracker();

      // Simulate load: rapid version creation and activation
      const iterations = 100;
      const startTime = Date.now();
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const version = await manager.createVersion('/api/test', `code ${i}`, {
            createdBy: 'manual',
            reason: `Version ${i}`,
          });
          await manager.activateVersion('/api/test', version.id, {
            reason: 'Test',
            triggeredBy: 'manual',
            rolloutStrategy: 'immediate',
            rolloutPercentage: 100,
          });
          tracker.recordOptimizationAttempt('/api/test');
          successCount++;
        } catch (error) {
          errorCount++;
        }
      }
      const endTime = Date.now();

      const successRate = (successCount / iterations) * 100;
      const avgTimeMs = (endTime - startTime) / iterations;

      console.log('System Stability Under Load:');
      console.log(`  Success rate: ${successRate.toFixed(1)}%`);
      console.log(`  Error rate: ${((errorCount / iterations) * 100).toFixed(1)}%`);
      console.log(`  Average operation time: ${avgTimeMs.toFixed(3)}ms`);

      expect(successRate).toBe(100); // Should be 100% stable
      expect(errorCount).toBe(0);
    });

    it('should measure data persistence reliability', async () => {
      const manager = new VersionManager(config);

      // Create and save versions
      for (let i = 0; i < 50; i++) {
        await manager.createVersion('/api/test', `code ${i}`, {
          createdBy: 'manual',
          reason: `Version ${i}`,
        });
      }

      // Export and verify state
      const exported = await manager.exportState();
      const newManager = new VersionManager(config);
      await newManager.importState(exported);

      const originalVersions = await manager.getAllVersions('/api/test');
      const restoredVersions = await newManager.getAllVersions('/api/test');

      console.log('Data Persistence Reliability:');
      console.log(`  Original versions: ${originalVersions.length}`);
      console.log(`  Restored versions: ${restoredVersions.length}`);
      console.log(`  Data integrity: ${originalVersions.length === restoredVersions.length ? 'PASS' : 'FAIL'}`);

      expect(originalVersions.length).toBe(restoredVersions.length);
    });
  });
});