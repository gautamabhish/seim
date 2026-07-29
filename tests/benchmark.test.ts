import { MetricsAnalyzer } from '../src/metricsAnalyzer';
import { EndpointTracker } from '../src/endpointTracker';
import { VersionManager } from '../src/versionManager';
import { SeimConfig, RouteMetrics } from '../src/types';

describe('Benchmark Tests', () => {
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

  describe('MetricsAnalyzer Overhead', () => {
    it('should have minimal overhead for analysis', () => {
      const analyzer = new MetricsAnalyzer();
      const durations = Array(1000).fill(50);
      const totalDuration = durations.reduce((a, b) => a + b, 0);

      const metrics: RouteMetrics = {
        requestCount: 1000,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration,
        durations,
        responseSizes: Array(1000).fill(100),
        payloadSizes: Array(1000).fill(0),
        statusCodes: { '200': 1000 },
        lastSeen: Date.now(),
      };

      const iterations = 1000;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        analyzer.analyze('/api/test', metrics);
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`MetricsAnalyzer average analysis time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`MetricsAnalyzer operations per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(1); // Should be < 1ms per analysis
    });

    it('should scale linearly with request count', () => {
      const analyzer = new MetricsAnalyzer();
      const sizes = [100, 1000, 10000];

      const results = sizes.map(size => {
        const durations = Array(size).fill(50);
        const totalDuration = durations.reduce((a, b) => a + b, 0);
        const metrics: RouteMetrics = {
          requestCount: size,
          errorCount: 0,
          timeoutCount: 0,
          totalDuration,
          durations,
          responseSizes: Array(size).fill(100),
          payloadSizes: Array(size).fill(0),
          statusCodes: { '200': size },
          lastSeen: Date.now(),
        };

        const startTime = Date.now();
        analyzer.analyze('/api/test', metrics);
        const endTime = Date.now();

        return { size, time: Math.max(1, endTime - startTime) }; // Ensure at least 1ms to avoid division by zero
      });

      console.log('MetricsAnalyzer scalability:');
      results.forEach(({ size, time }) => {
        console.log(`  ${size} requests: ${time.toFixed(3)}ms`);
      });

      // Time should increase roughly linearly with size
      const ratio1000to100 = results[1].time / results[0].time;
      const ratio10000to1000 = results[2].time / results[1].time;

      console.log(`  Scaling ratio (1000/100): ${ratio1000to100.toFixed(2)}x`);
      console.log(`  Scaling ratio (10000/1000): ${ratio10000to1000.toFixed(2)}x`);

      expect(ratio1000to100).toBeLessThan(20); // 10x requests should not take 20x time
      expect(ratio10000to1000).toBeLessThan(20);
    });
  });

  describe('EndpointTracker Overhead', () => {
    it('should have minimal overhead for tracking', () => {
      const tracker = new EndpointTracker();

      const iterations = 10000;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        tracker.shouldSkipOptimization('/api/test');
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`EndpointTracker average check time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`EndpointTracker operations per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(0.1); // Should be < 0.1ms per check
    });

    it('should handle rapid status updates efficiently', () => {
      const tracker = new EndpointTracker();

      const iterations = 1000;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        tracker.markAsNonOptimizable(`/api/test${i}`, `Reason ${i}`);
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`EndpointTracker average update time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`EndpointTracker updates per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(1); // Should be < 1ms per update
    });
  });

  describe('VersionManager Overhead', () => {
    it('should have acceptable overhead for version creation', async () => {
      const manager = new VersionManager(config);

      const iterations = 100;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        await manager.createVersion('/api/test', 'code', {
          createdBy: 'manual',
          reason: 'Test',
        });
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`VersionManager average creation time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`VersionManager creations per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(10); // Should be < 10ms per creation
    });

    it('should have acceptable overhead for version activation', async () => {
      const manager = new VersionManager(config);

      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      const iterations = 100;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        await manager.activateVersion('/api/test', version.id, {
          reason: 'Test',
          triggeredBy: 'manual',
          rolloutStrategy: 'immediate',
          rolloutPercentage: 100,
        });
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`VersionManager average activation time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`VersionManager activations per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(5); // Should be < 5ms per activation
    });

    it('should have acceptable overhead for performance updates', async () => {
      const manager = new VersionManager(config);

      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      const iterations = 1000;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        await manager.updateVersionPerformance('/api/test', version.id, {
          averageLatency: 100,
          p95Latency: 150,
          errorRate: 0.01,
          sampleSize: i + 1,
        });
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`VersionManager average performance update time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`VersionManager performance updates per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(1); // Should be < 1ms per update
    });
  });

  describe('Memory Usage', () => {
    it('should have reasonable memory footprint', async () => {
      const manager = new VersionManager(config);

      // Create 100 versions
      for (let i = 0; i < 100; i++) {
        await manager.createVersion('/api/test', `code ${i}`, {
          createdBy: 'manual',
          reason: `Version ${i}`,
        });
      }

      const versions = await manager.getAllVersions('/api/test');
      const memoryUsage = JSON.stringify(versions).length;

      console.log(`Memory usage for 100 versions: ${memoryUsage} bytes`);
      console.log(`Average memory per version: ${(memoryUsage / 100).toFixed(0)} bytes`);

      expect(memoryUsage).toBeLessThan(1024 * 1024); // Should be < 1MB for 100 versions
    });
  });

  describe('Overall System Overhead', () => {
    it('should measure complete optimization pipeline overhead', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

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

      const iterations = 100;
      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        // Simulate complete pipeline
        analyzer.analyze('/api/test', metrics);
        tracker.shouldSkipOptimization('/api/test');
        await manager.createVersion('/api/test', 'code', {
          createdBy: 'manual',
          reason: 'Test',
        });
      }
      const endTime = Date.now();

      const avgTimeMs = (endTime - startTime) / iterations;
      console.log(`Complete pipeline average time: ${avgTimeMs.toFixed(3)}ms`);
      console.log(`Complete pipeline operations per second: ${(1000 / avgTimeMs).toFixed(0)}`);

      expect(avgTimeMs).toBeLessThan(20); // Should be < 20ms for complete pipeline
    });
  });
});