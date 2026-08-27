import { CandidateLifecycleManager, ShadowSample } from '../src/candidateLifecycle';
import { OptimizationCandidate } from '../src/types';

describe('CandidateLifecycleManager', () => {
  let manager: CandidateLifecycleManager;
  let candidate: OptimizationCandidate;

  beforeEach(() => {
    manager = new CandidateLifecycleManager();
    candidate = {
      id: 'test-candidate-1',
      routeKey: '/api/users',
      pattern: 'sequential-async',
      severity: 'high',
      originalCode: 'const a = await getA(); const b = await getB();',
      optimizedCode: 'const [a, b] = await Promise.all([getA(), getB()]);',
      confidence: 0.92,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  const makeSample = (overrides: Partial<ShadowSample> = {}): ShadowSample => ({
    v1Latency: 100,
    v2Latency: 50,
    v1Error: false,
    v2Error: false,
    v1Output: { ok: true },
    v2Output: { ok: true },
    sampledAt: Date.now(),
    ...overrides,
  });

  describe('register', () => {
    it('should register a candidate with generated status', () => {
      const live = manager.register('/api/users', candidate, 5);
      expect(live.status).toBe('generated');
      expect(live.shadowSamplesRequired).toBe(5);
      expect(live.shadowSamplesCollected).toBe(0);
      expect(live.shadowSamples).toHaveLength(0);
      expect(live.statusHistory).toHaveLength(1);
      expect(live.statusHistory[0].status).toBe('generated');
    });

    it('should replace existing candidate for same route', () => {
      manager.register('/api/users', candidate, 5);
      const newCandidate = { ...candidate, id: 'new-candidate' };
      const live = manager.register('/api/users', newCandidate, 10);
      expect(live.candidate.id).toBe('new-candidate');
      expect(live.shadowSamplesRequired).toBe(10);
    });
  });

  describe('getCandidateForShadow', () => {
    it('should return candidate WITHOUT removing it', () => {
      manager.register('/api/users', candidate, 5);
      const first = manager.getCandidateForShadow('/api/users');
      expect(first).toBeDefined();
      // Key fix: candidate should still be there
      const second = manager.getCandidateForShadow('/api/users');
      expect(second).toBeDefined();
      expect(second!.candidate.id).toBe(first!.candidate.id);
    });

    it('should return undefined for unregistered route', () => {
      expect(manager.getCandidateForShadow('/unknown')).toBeUndefined();
    });
  });

  describe('recordShadowSample', () => {
    it('should accumulate samples without returning true until threshold', () => {
      manager.register('/api/users', candidate, 3);

      expect(manager.recordShadowSample('/api/users', makeSample())).toBe(false);
      expect(manager.recordShadowSample('/api/users', makeSample())).toBe(false);
      expect(manager.recordShadowSample('/api/users', makeSample())).toBe(true);
    });

    it('should transition to shadowing on first sample', () => {
      manager.register('/api/users', candidate, 5);
      manager.recordShadowSample('/api/users', makeSample());
      const live = manager.getCandidate('/api/users');
      expect(live!.status).toBe('shadowing');
    });

    it('should transition to shadow-complete when threshold reached', () => {
      manager.register('/api/users', candidate, 2);
      manager.recordShadowSample('/api/users', makeSample());
      manager.recordShadowSample('/api/users', makeSample());
      const live = manager.getCandidate('/api/users');
      expect(live!.status).toBe('shadow-complete');
    });

    it('should return false for unregistered route', () => {
      expect(manager.recordShadowSample('/unknown', makeSample())).toBe(false);
    });

    it('should store all samples', () => {
      manager.register('/api/users', candidate, 3);
      manager.recordShadowSample('/api/users', makeSample({ v2Latency: 40 }));
      manager.recordShadowSample('/api/users', makeSample({ v2Latency: 45 }));
      manager.recordShadowSample('/api/users', makeSample({ v2Latency: 55 }));
      const live = manager.getCandidate('/api/users');
      expect(live!.shadowSamples).toHaveLength(3);
      expect(live!.shadowSamplesCollected).toBe(3);
    });
  });

  describe('transition', () => {
    it('should update status and history', () => {
      manager.register('/api/users', candidate, 5);
      manager.transition('/api/users', 'approved', 'manual review passed');
      const live = manager.getCandidate('/api/users');
      expect(live!.status).toBe('approved');
      expect(live!.statusHistory).toHaveLength(2);
      expect(live!.statusHistory[1].status).toBe('approved');
      expect(live!.statusHistory[1].reason).toBe('manual review passed');
    });

    it('should be a no-op for unregistered route', () => {
      // Should not throw
      manager.transition('/unknown', 'rejected');
    });
  });

  describe('hasActiveCandidate', () => {
    it('should return true for registered routes', () => {
      manager.register('/api/users', candidate, 5);
      expect(manager.hasActiveCandidate('/api/users')).toBe(true);
    });

    it('should return false for unregistered routes', () => {
      expect(manager.hasActiveCandidate('/unknown')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove candidate from active map', () => {
      manager.register('/api/users', candidate, 5);
      manager.remove('/api/users');
      expect(manager.hasActiveCandidate('/api/users')).toBe(false);
      expect(manager.getCandidateForShadow('/api/users')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should remove all candidates', () => {
      manager.register('/api/users', candidate, 5);
      manager.register('/api/products', { ...candidate, routeKey: '/api/products' }, 5);
      expect(manager.getAll().size).toBe(2);
      manager.clear();
      expect(manager.getAll().size).toBe(0);
    });
  });

  describe('full lifecycle flow', () => {
    it('should support the complete lifecycle: register → shadow → complete → approve → promote', () => {
      const routeKey = '/api/users';
      manager.register(routeKey, candidate, 2);

      // Shadow test 1
      manager.recordShadowSample(routeKey, makeSample());
      expect(manager.getCandidate(routeKey)!.status).toBe('shadowing');

      // Shadow test 2 — completes
      const done = manager.recordShadowSample(routeKey, makeSample());
      expect(done).toBe(true);
      expect(manager.getCandidate(routeKey)!.status).toBe('shadow-complete');

      // Manual approval
      manager.transition(routeKey, 'approved', 'manual review passed');
      expect(manager.getCandidate(routeKey)!.status).toBe('approved');

      // Promotion
      manager.transition(routeKey, 'promoted', 'canary success');
      expect(manager.getCandidate(routeKey)!.status).toBe('promoted');
      expect(manager.getCandidate(routeKey)!.statusHistory).toHaveLength(5);

      // Cleanup
      manager.remove(routeKey);
      expect(manager.hasActiveCandidate(routeKey)).toBe(false);
    });
  });
});
