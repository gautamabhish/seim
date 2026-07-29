import { VersionManager } from '../src/versionManager';
import { SeimConfig } from '../src/types';

describe('VersionManager', () => {
  let manager: VersionManager;
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
    manager = new VersionManager(config);
  });

  describe('Version Creation', () => {
    it('should create initial version as v1.0.0', async () => {
      const version = await manager.createVersion('/api/test', 'original code', {
        createdBy: 'manual',
        reason: 'Initial version',
      });

      expect(version.version).toBe('v1.0.0');
      expect(version.type).toBe('original');
      expect(version.status).toBe('inactive');
      expect(version.rollbackSafe).toBe(true);
    });

    it('should create AI-generated version as optimized', async () => {
      const version = await manager.createVersion('/api/test', 'optimized code', {
        createdBy: 'ai',
        reason: 'AI optimization',
        pattern: 'sequential-async',
        confidence: 0.92,
      });

      expect(version.type).toBe('optimized');
      expect(version.metadata.createdBy).toBe('ai');
      expect(version.metadata.pattern).toBe('sequential-async');
      expect(version.metadata.confidence).toBe(0.92);
    });

    it('should increment version numbers correctly', async () => {
      await manager.createVersion('/api/test', 'code v1', { createdBy: 'manual', reason: 'v1' });
      await manager.createVersion('/api/test', 'code v2', { createdBy: 'manual', reason: 'v2' });
      const v3 = await manager.createVersion('/api/test', 'code v3', { createdBy: 'manual', reason: 'v3' });

      expect(v3.version).toBe('v1.0.2'); // Implementation increments patch version
    });

    it('should store version code correctly', async () => {
      const code = 'const handler = async (req, res) => { res.json({ ok: true }); };';
      const version = await manager.createVersion('/api/test', code, {
        createdBy: 'manual',
        reason: 'Test',
      });

      expect(version.code).toBe(code);
    });
  });

  describe('Version Activation', () => {
    it('should activate version with transition', async () => {
      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      const success = await manager.activateVersion('/api/test', version.id, {
        reason: 'Test activation',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      expect(success).toBe(true);
      expect(version.status).toBe('active');
    });

    it('should record transition history', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      const v2 = await manager.createVersion('/api/test', 'code2', { createdBy: 'manual', reason: 'v2' });

      await manager.activateVersion('/api/test', v1.id, {
        reason: 'Initial deployment',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Upgrade',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });

      const transitions = await manager.getTransitionHistory('/api/test');

      expect(transitions).toHaveLength(2);
      expect(transitions[0].fromVersion).toBe('none');
      expect(transitions[0].toVersion).toBe(v1.id);
      expect(transitions[1].fromVersion).toBe(v1.id);
      expect(transitions[1].toVersion).toBe(v2.id);
    });

    it('should deactivate previous version when activating new one', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      const v2 = await manager.createVersion('/api/test', 'code2', { createdBy: 'manual', reason: 'v2' });

      await manager.activateVersion('/api/test', v1.id, {
        reason: 'Deploy v1',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Deploy v2',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      const active = await manager.getActiveVersion('/api/test');

      expect(active?.id).toBe(v2.id);
      expect(v1.status).toBe('inactive');
      expect(v2.status).toBe('active');
    });
  });

  describe('Version Retrieval', () => {
    it('should get active version', async () => {
      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      await manager.activateVersion('/api/test', version.id, {
        reason: 'Test',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      const active = await manager.getActiveVersion('/api/test');

      expect(active?.id).toBe(version.id);
    });

    it('should get all versions', async () => {
      await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      await manager.createVersion('/api/test', 'code2', { createdBy: 'manual', reason: 'v2' });
      await manager.createVersion('/api/test', 'code3', { createdBy: 'manual', reason: 'v3' });

      const versions = await manager.getAllVersions('/api/test');

      expect(versions).toHaveLength(3);
    });

    it('should get specific version', async () => {
      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      const retrieved = await manager.getVersion('/api/test', version.id);

      expect(retrieved?.id).toBe(version.id);
    });
  });

  describe('Rollback', () => {
    it('should rollback to previous version', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      const v2 = await manager.createVersion('/api/test', 'code2', { createdBy: 'ai', reason: 'v2' });

      await manager.activateVersion('/api/test', v1.id, {
        reason: 'Deploy v1',
        triggeredBy: 'manual',
        rolloutStrategy: 'immediate',
        rolloutPercentage: 100,
      });

      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Deploy v2',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });

      const success = await manager.rollbackToVersion('/api/test', v1.id, 'Testing rollback');

      expect(success).toBe(true);

      const active = await manager.getActiveVersion('/api/test');
      expect(active?.type).toBe('rollback');
      expect(active?.code).toBe(v1.code);
    });

    it('should fail rollback if version not rollback safe', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      
      await manager.markVersionUnsafe('/api/test', v1.id);

      const success = await manager.rollbackToVersion('/api/test', v1.id, 'Test');

      expect(success).toBe(false);
    });

    it('should create new rollback version instead of reusing old', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      const v2 = await manager.createVersion('/api/test', 'code2', { createdBy: 'ai', reason: 'v2' });

      await manager.activateVersion('/api/test', v2.id, {
        reason: 'Deploy v2',
        triggeredBy: 'auto',
        rolloutStrategy: 'canary',
        rolloutPercentage: 5,
      });

      await manager.rollbackToVersion('/api/test', v1.id, 'Test');

      const versions = await manager.getAllVersions('/api/test');

      // Should have 3 versions: v1, v2, and v1.3.0-rollback
      expect(versions).toHaveLength(3);
      expect(versions[2].type).toBe('rollback');
    });
  });

  describe('Performance Tracking', () => {
    it('should update version performance metrics', async () => {
      const version = await manager.createVersion('/api/test', 'code', {
        createdBy: 'manual',
        reason: 'Test',
      });

      const success = await manager.updateVersionPerformance('/api/test', version.id, {
        averageLatency: 100,
        p95Latency: 150,
        errorRate: 0.01,
        sampleSize: 1000,
      });

      expect(success).toBe(true);

      const updated = await manager.getVersion('/api/test', version.id);
      expect(updated?.performance.averageLatency).toBe(100);
      expect(updated?.performance.p95Latency).toBe(150);
      expect(updated?.performance.errorRate).toBe(0.01);
      expect(updated?.performance.sampleSize).toBe(1000);
    });
  });

  describe('Version Comparison', () => {
    it('should compare two versions', async () => {
      const v1 = await manager.createVersion('/api/test', 'code1', { createdBy: 'manual', reason: 'v1' });
      const v2 = await manager.createVersion('/api/test', 'code2', { createdBy: 'ai', reason: 'v2' });

      await manager.updateVersionPerformance('/api/test', v1.id, {
        averageLatency: 200,
        errorRate: 0.02,
      });

      await manager.updateVersionPerformance('/api/test', v2.id, {
        averageLatency: 100,
        errorRate: 0.01,
      });

      const comparison = await manager.compareVersions('/api/test', v1.id, v2.id);

      expect(comparison.version1?.id).toBe(v1.id);
      expect(comparison.version2?.id).toBe(v2.id);
      const perfDiff = comparison.performanceDiff as any;
      expect(perfDiff.latencyChange).toBe(-100); // v2 is 100ms faster
      expect(perfDiff.errorRateChange).toBe(-0.01); // v2 has 1% lower error rate
    });
  });

  describe('State Management', () => {
    it('should export and import state', async () => {
      await manager.createVersion('/api/test', 'code', { createdBy: 'manual', reason: 'Test' });

      const exported = await manager.exportState();

      const newManager = new VersionManager(config);
      await newManager.importState(exported);

      const versions = await newManager.getAllVersions('/api/test');
      expect(versions).toHaveLength(1);
    });
  });
});