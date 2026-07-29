import { MetricsAnalyzer } from '../src/metricsAnalyzer';
import { EndpointTracker } from '../src/endpointTracker';
import { VersionManager } from '../src/versionManager';
import { SeimConfig, RouteMetrics } from '../src/types';

describe('Integration Tests', () => {
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

  describe('Complete Optimization Pipeline', () => {
    it('should simulate full optimization workflow', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

      // Step 1: Collect metrics (simulated)
      const durations = Array(100).fill(2000); // Very poor performance
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

      // Step 2: Analyze metrics
      const analysis = analyzer.analyze('/api/test', metrics);
      console.log('Step 1 - Metrics Analysis:', analysis.needsOptimization, analysis.reason);

      // Step 3: Check endpoint tracker
      const shouldSkip = tracker.shouldSkipOptimization('/api/test');
      console.log('Step 2 - Endpoint Tracker: shouldSkip =', shouldSkip);

      // Step 4: Create optimized version
      const optimizedCode = 'const optimized = async (req, res) => { res.json({ optimized: true }); };';
      const version = await manager.createVersion('/api/test', optimizedCode, {
        createdBy: 'ai',
        reason: 'AI optimization',
        pattern: 'sequential-async',
        confidence: 0.92,
      });
      console.log('Step 3 - Version Created:', version.id, version.version);

      // Step 5: Activate with canary
      const activationSuccess = await manager.activateVersion('/api/test', version.id, {
        reason: 'Deployment after validation',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });
      console.log('Step 4 - Version Activation:', activationSuccess);

      // Step 6: Record optimization attempt
      tracker.recordOptimizationAttempt('/api/test');
      console.log('Step 5 - Optimization Attempt Recorded');

      // Verify complete workflow
      expect(analysis.needsOptimization).toBe(true);
      expect(shouldSkip).toBe(false);
      expect(version.type).toBe('optimized');
      expect(activationSuccess).toBe(true);
    });

    it('should handle optimization rejection', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

      // Good performance metrics
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

      const analysis = analyzer.analyze('/api/test', metrics);
      tracker.markAsOptimizable('/api/test');

      console.log('Optimization Rejection Test:');
      console.log(`  Analysis result: needsOptimization = ${analysis.needsOptimization}`);
      console.log(`  Reason: ${analysis.reason}`);

      expect(analysis.needsOptimization).toBe(false);
      expect(tracker.shouldSkipOptimization('/api/test')).toBe(false);
    });

    it('should handle optimization with cooldown', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

      // Mark endpoint as non-optimizable
      tracker.markAsNonOptimizable('/api/test', 'Already optimized');

      // Create poor performance metrics
      const durations = Array(100).fill(2000);
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

      const analysis = analyzer.analyze('/api/test', metrics);
      const shouldSkip = tracker.shouldSkipOptimization('/api/test');

      console.log('Cooldown Test:');
      console.log(`  Analysis: needsOptimization = ${analysis.needsOptimization}`);
      console.log(`  Should skip due to cooldown: ${shouldSkip}`);

      expect(analysis.needsOptimization).toBe(true);
      expect(shouldSkip).toBe(true); // Should skip due to cooldown
    });

    it('should handle rollback scenario', async () => {
      const manager = new VersionManager(config);

      // Create and activate v1
      const v1 = await manager.createVersion('/api/test', 'code1', {
        createdBy: 'manual',
        reason: 'v1',
      });
      await manager.activateVersion('/api/test', v1.id, {
        reason: 'Deploy v1',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      // Create and activate v2
      const v2 = await manager.createVersion('/api/test', 'code2', {
        createdBy: 'ai',
        reason: 'v2',
      });
      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Deploy v2',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });

      // Simulate issue and rollback
      const rollbackSuccess = await manager.rollbackToVersion('/api/test', v1.id, 'Error rate spike');

      const active = await manager.getActiveVersion('/api/test');
      const transitions = await manager.getTransitionHistory('/api/test');

      console.log('Rollback Scenario:');
      console.log(`  Rollback successful: ${rollbackSuccess}`);
      console.log(`  Active version type: ${active?.type}`);
      console.log(`  Number of transitions: ${transitions.length}`);

      expect(rollbackSuccess).toBe(true);
      expect(active?.type).toBe('rollback');
      expect(transitions.length).toBe(3); // v1→v2, v2→rollback
    });
  });

  describe('Multi-Endpoint Management', () => {
    it('should handle multiple endpoints independently', async () => {
      const analyzer = new MetricsAnalyzer();
      const tracker = new EndpointTracker();
      const manager = new VersionManager(config);

      const endpoints = ['/api/users', '/api/products', '/api/orders'];

      for (const endpoint of endpoints) {
        // Create metrics
        const durations = Array(100).fill(2000); // Poor performance to trigger optimization
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

        // Analyze
        const analysis = analyzer.analyze(endpoint, metrics);

        // Create version regardless (simulating the optimization path)
        const version = await manager.createVersion(endpoint, 'optimized code', {
          createdBy: 'ai',
          reason: 'AI optimization',
          pattern: 'inefficient-loop',
          confidence: 0.85,
        });

        // Activate if analysis suggests optimization
        if (analysis.needsOptimization) {
          await manager.activateVersion(endpoint, version.id, {
            reason: 'Optimization needed',
            triggeredBy: 'auto',
            rolloutStrategy: 'canary',
            rolloutPercentage: 5,
          });
        }
      }

      // Verify each endpoint has correct state
      for (const endpoint of endpoints) {
        const versions = await manager.getAllVersions(endpoint);
        const active = await manager.getActiveVersion(endpoint);

        console.log(`${endpoint}: ${versions.length} versions, active: ${active?.version || 'none'}`);
      }

      // Each endpoint should have at least one version
      for (const endpoint of endpoints) {
        const versions = await manager.getAllVersions(endpoint);
        expect(versions.length).toBeGreaterThan(0);
      }
    });

    it('should handle different performance profiles per endpoint', async () => {
      const analyzer = new MetricsAnalyzer();
      const manager = new VersionManager(config);

      // Create different performance profiles
      const profiles = {
        '/api/fast': Array(100).fill(10), // Very fast
        '/api/medium': Array(100).fill(100), // Medium
        '/api/slow': Array(100).fill(2000), // Very slow
      };

      const results: Record<string, any> = {};
      for (const [endpoint, durations] of Object.entries(profiles)) {
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

        const analysis = analyzer.analyze(endpoint, metrics);
        results[endpoint] = {
          needsOptimization: analysis.needsOptimization,
          avgLatency: analysis.metrics.averageLatency,
          priority: analysis.priority,
        };
      }

      console.log('Performance Profile Analysis:');
      for (const [endpoint, result] of Object.entries(results)) {
        console.log(`  ${endpoint}: avg=${result.avgLatency.toFixed(0)}ms, needsOpt=${result.needsOptimization}, priority=${result.priority}`);
      }

      // Only slow endpoint should need optimization
      expect(results['/api/fast'].needsOptimization).toBe(false);
      expect(results['/api/slow'].needsOptimization).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid metrics gracefully', () => {
      const analyzer = new MetricsAnalyzer();

      const invalidMetrics: RouteMetrics = {
        requestCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 0,
        durations: [],
        responseSizes: [],
        payloadSizes: [],
        statusCodes: {},
        lastSeen: Date.now(),
      };

      const result = analyzer.analyze('/api/test', invalidMetrics);

      console.log('Invalid Metrics Handling:');
      console.log(`  Result: needsOptimization = ${result.needsOptimization}`);
      console.log(`  Reason: ${result.reason}`);

      expect(result.needsOptimization).toBe(false);
      expect(result.reason).toContain('Insufficient data');
    });

    it('should handle missing endpoint gracefully', async () => {
      const manager = new VersionManager(config);

      const version = await manager.getVersion('/api/nonexistent', 'nonexistent-id');

      console.log('Missing Endpoint Handling:');
      console.log(`  Version exists: ${version !== undefined}`);

      expect(version).toBeUndefined();
    });

    it('should handle rapid state changes', async () => {
      const manager = new VersionManager(config);

      // Rapid create/activate cycle
      const startTime = Date.now();
      for (let i = 0; i < 10; i++) {
        const version = await manager.createVersion('/api/test', `code ${i}`, {
          createdBy: 'manual',
          reason: `Rapid test ${i}`,
        });
        await manager.activateVersion('/api/test', version.id, {
          reason: 'Rapid activation',
          triggeredBy: 'manual',
          rolloutStrategy: 'immediate',
          rolloutPercentage: 100,
        });
      }
      const endTime = Date.now();

      const active = await manager.getActiveVersion('/api/test');
      const transitions = await manager.getTransitionHistory('/api/test');

      console.log('Rapid State Changes:');
      console.log(`  Total time: ${endTime - startTime}ms`);
      console.log(`  Active version: ${active?.version}`);
      console.log(`  Transitions: ${transitions.length}`);

      expect(transitions.length).toBe(10);
      expect(active?.version).toBe('v1.0.9'); // Implementation increments patch version
    });
  });
});