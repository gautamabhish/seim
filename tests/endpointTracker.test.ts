import { EndpointTracker } from '../src/endpointTracker';

describe('EndpointTracker', () => {
  let tracker: EndpointTracker;

  beforeEach(() => {
    tracker = new EndpointTracker();
  });

  describe('Optimization Tracking', () => {
    it('should track endpoint status', () => {
      tracker.markAsNonOptimizable('/api/test', 'Already optimal');

      const status = tracker.check('/api/test');

      expect(status).toBeDefined();
      expect(status?.isOptimizable).toBe(false);
      expect(status?.reason).toBe('Already optimal');
    });

    it('should set cooldown period', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test reason');

      const status = tracker.check('/api/test');

      expect(status?.cooldownUntil).toBeDefined();
      expect(status?.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it('should skip optimization during cooldown', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test reason');

      const shouldSkip = tracker.shouldSkipOptimization('/api/test');

      expect(shouldSkip).toBe(true);
    });

    it('should allow optimization when not in cooldown', () => {
      const shouldSkip = tracker.shouldSkipOptimization('/api/new-endpoint');

      expect(shouldSkip).toBe(false);
    });

    it('should record optimization attempts', () => {
      tracker.recordOptimizationAttempt('/api/test');

      const status = tracker.check('/api/test');

      expect(status?.optimizationAttempts).toBe(1);
    });

    it('should mark as non-optimizable after max attempts', () => {
      const newTracker = new EndpointTracker(); // Fresh instance to avoid interference
      
      // Make 5 attempts (max attempts)
      newTracker.recordOptimizationAttempt('/api/test');
      newTracker.recordOptimizationAttempt('/api/test');
      newTracker.recordOptimizationAttempt('/api/test');
      newTracker.recordOptimizationAttempt('/api/test');
      newTracker.recordOptimizationAttempt('/api/test');

      const status = newTracker.check('/api/test');
      // After 5 attempts, it should automatically be marked as non-optimizable by the tracker
      expect(status?.isOptimizable).toBe(false);
      expect(status?.optimizationAttempts).toBeGreaterThanOrEqual(5);
    });

    it('should mark as optimizable', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test');
      tracker.markAsOptimizable('/api/test');

      const status = tracker.check('/api/test');

      expect(status?.isOptimizable).toBe(true);
      expect(status?.reason).toBe('');
    });

    it('should reset cooldown', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test');
      tracker.resetCooldown('/api/test');

      const status = tracker.check('/api/test');

      expect(status?.cooldownUntil).toBeUndefined();
    });

    it('should get all statuses', () => {
      tracker.markAsNonOptimizable('/api/test1', 'Reason 1');
      tracker.markAsNonOptimizable('/api/test2', 'Reason 2');

      const statuses = tracker.getAllStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses[0].routeKey).toBe('/api/test1');
      expect(statuses[1].routeKey).toBe('/api/test2');
    });

    it('should clear all statuses', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test');
      tracker.clear();

      const statuses = tracker.getAllStatuses();

      expect(statuses).toHaveLength(0);
    });
  });

  describe('Cooldown Logic', () => {
    it('should reset cooldown after expiration', () => {
      tracker.markAsNonOptimizable('/api/test', 'Test');
      
      // Manually set cooldown to past
      const status = tracker.check('/api/test');
      if (status) {
        status.cooldownUntil = Date.now() - 1000; // 1 second ago
      }

      const shouldSkip = tracker.shouldSkipOptimization('/api/test');

      expect(shouldSkip).toBe(false);
    });
  });
});