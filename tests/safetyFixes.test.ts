import { ShadowTestEngine } from '../src/shadow';
import { TournamentSelector, ShadowResult } from '../src/evolution/tournament';
import { SeimCollection } from '../src/scaffolder';
import { BehaviorTracker } from '../src/behaviorTracker';
import { CandidateLifecycleManager } from '../src/candidateLifecycle';
import { createStudioHandler } from '../src/studio';
import { getDefaultConfig } from '../src/config';
import { Logger } from '../src/logger';
import { SeimEventBus } from '../src/events';

describe('P0 Safety & Integrity Fixes', () => {
  describe('ShadowTestEngine Method Gating', () => {
    it('should reject mutating HTTP methods (POST, PUT, DELETE) by default', async () => {
      const shadow = new ShadowTestEngine();
      const mockReq = { method: 'POST', url: '/api/order', headers: {}, body: {} } as any;
      const original = (req: any, res: any) => res.json({ ok: true });
      const optimized = (req: any, res: any) => res.json({ ok: true });

      await expect(shadow.run('/api/order', original, optimized, mockReq)).rejects.toThrow(
        /Shadow testing not permitted for mutating method POST/
      );
    });

    it('should allow read-only HTTP methods (GET, HEAD, OPTIONS)', async () => {
      const shadow = new ShadowTestEngine();
      const mockReq = { method: 'GET', url: '/api/items', headers: {}, query: {} } as any;
      const original = (req: any, res: any) => res.json({ items: [1, 2, 3] });
      const optimized = (req: any, res: any) => res.json({ items: [1, 2, 3] });

      const result = await shadow.run('/api/items', original, optimized, mockReq);
      expect(result).toBeDefined();
      expect(result.v1Error).toBe(false);
      expect(result.v2Error).toBe(false);
    });
  });

  describe('Evolution Tournament Fitness Gaming Protection', () => {
    it('should penalize fitness to 0 when output is not semantically equivalent', () => {
      const config = getDefaultConfig();
      const logger = new Logger({ level: 'error', json: false });
      const events = new SeimEventBus();
      const tournament = new TournamentSelector(config, logger, events);

      const candidate: any = { id: 'c1', generation: 1, strategy: 'ai-creative' };
      const shadowResult: ShadowResult = {
        candidateId: 'c1',
        v1Latency: 50,
        v2Latency: 0.1, // Super fast because it deleted business logic!
        v1Errors: 0,
        v2Errors: 0,
        v1Memory: 100,
        v2Memory: 50,
        sampleSize: 20,
        latencyVariance: 0.01,
        outputEquivalent: false, // Fails equivalence check
      };

      const fitness = tournament.scoreFitness(candidate, shadowResult);
      expect(fitness.overall).toBe(0);
      expect(fitness.latencyScore).toBe(0);
      expect(fitness.errorRateScore).toBe(0);
    });

    it('should reward candidate when output is equivalent', () => {
      const config = getDefaultConfig();
      const logger = new Logger({ level: 'error', json: false });
      const events = new SeimEventBus();
      const tournament = new TournamentSelector(config, logger, events);

      const candidate: any = { id: 'c2', generation: 1, strategy: 'template' };
      const shadowResult: ShadowResult = {
        candidateId: 'c2',
        v1Latency: 50,
        v2Latency: 25,
        v1Errors: 0,
        v2Errors: 0,
        v1Memory: 100,
        v2Memory: 90,
        sampleSize: 20,
        latencyVariance: 2,
        outputEquivalent: true,
      };

      const fitness = tournament.scoreFitness(candidate, shadowResult);
      expect(fitness.overall).toBeGreaterThan(0.5);
    });
  });

  describe('SeimCollection Query Logic Correctness', () => {
    it('should only remove documents when ALL query fields match (AND condition)', () => {
      const db = new SeimCollection();
      db.insert({ user: 'Alice', status: 'active', age: 30 });
      db.insert({ user: 'Alice', status: 'pending', age: 31 });
      db.insert({ user: 'Bob', status: 'active', age: 25 });

      // Removing with multi-key query
      const removedCount = db.remove({ user: 'Alice', status: 'pending' });
      expect(removedCount).toBe(1);

      const remaining = db.find();
      expect(remaining.length).toBe(2);
      expect(remaining.find(d => d.user === 'Alice' && d.status === 'active')).toBeDefined();
      expect(remaining.find(d => d.user === 'Bob')).toBeDefined();
    });

    it('should clear all documents when query is empty', () => {
      const db = new SeimCollection();
      db.insert({ a: 1 });
      db.insert({ a: 2 });

      const removed = db.remove({});
      expect(removed).toBe(2);
      expect(db.find().length).toBe(0);
    });
  });

  describe('Memory Bounds & Lifecycle Management', () => {
    it('should clean up expired sessions and cap session map size in BehaviorTracker', () => {
      const tracker = new BehaviorTracker();
      tracker.record({
        sessionId: 's1',
        type: 'pageview',
        path: '/home',
        timestamp: Date.now() - 31 * 60 * 1000, // Expired (31 min old)
      });
      tracker.record({
        sessionId: 's2',
        type: 'pageview',
        path: '/dashboard',
        timestamp: Date.now(),
      });

      tracker.cleanup();
      const snapshot = tracker.snapshot();
      expect(snapshot.totalSessions).toBe(1);
      expect(snapshot.activeSessions).toBe(1);
      tracker.destroy();
    });

    it('should clean up stale candidates in CandidateLifecycleManager', () => {
      const manager = new CandidateLifecycleManager();
      const oldCandidate: any = { id: 'old-1', routeKey: '/api/stale', pattern: 'n-plus-one' };
      manager.register('/api/stale', oldCandidate, 25);

      // Force creation time to 2 hours ago
      const live = manager.getCandidate('/api/stale');
      if (live) live.createdAt = Date.now() - 2 * 60 * 60 * 1000;

      const cleaned = manager.cleanupStale(60 * 60 * 1000);
      expect(cleaned).toBe(1);
      expect(manager.hasActiveCandidate('/api/stale')).toBe(false);
    });
  });

  describe('Studio API Endpoints', () => {
    it('should handle /api/status JSON requests', () => {
      const mockInstance: any = {
        status: () => ({ mode: 'restrict', healthy: true, uptime: 100 }),
      };
      const handler = createStudioHandler(mockInstance);

      let responseData: any = null;
      const req: any = { path: '/seim/api/status', method: 'GET' };
      const res: any = {
        json: (data: any) => { responseData = data; },
        setHeader: () => {},
        send: () => {},
      };

      handler(req, res, () => {});
      expect(responseData).toBeDefined();
      expect(responseData.ok).toBe(true);
      expect(responseData.mode).toBe('restrict');
    });

    it('should handle POST /api/rollback requests', () => {
      let rolledBackRoute = '';
      const mockInstance: any = {
        dispatcher: {
          rollback: (routeKey: string, reason: string) => {
            rolledBackRoute = routeKey;
            return true;
          },
        },
      };
      const handler = createStudioHandler(mockInstance);

      let responseData: any = null;
      const req: any = {
        path: '/seim/api/rollback',
        method: 'POST',
        body: { routeKey: '/api/users', reason: 'CLI requested' },
      };
      const res: any = {
        json: (data: any) => { responseData = data; },
        status: () => res,
        setHeader: () => {},
        send: () => {},
      };

      handler(req, res, () => {});
      expect(responseData).toBeDefined();
      expect(responseData.success).toBe(true);
      expect(rolledBackRoute).toBe('/api/users');
    });
  });
});
