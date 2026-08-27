import { StableCanaryAssigner } from '../src/canaryAssignment';

describe('StableCanaryAssigner', () => {
  it('should deterministically return the same decision for identical request attributes', () => {
    const assigner = new StableCanaryAssigner('ip');
    const reqA = { ip: '192.168.1.100' };
    const reqB = { ip: '192.168.1.100' };

    const resultA1 = assigner.shouldUseCanary(reqA, 50);
    const resultA2 = assigner.shouldUseCanary(reqA, 50);
    const resultB = assigner.shouldUseCanary(reqB, 50);

    expect(resultA1).toBe(resultA2);
    expect(resultA1).toBe(resultB);
  });

  it('should always return false for 0% and true for 100%', () => {
    const assigner = new StableCanaryAssigner('ip');
    const req = { ip: '10.0.0.1' };

    expect(assigner.shouldUseCanary(req, 0)).toBe(false);
    expect(assigner.shouldUseCanary(req, 100)).toBe(true);
  });

  it('should support user-id based assignment', () => {
    const assigner = new StableCanaryAssigner('user-id');
    const reqUser1 = { user: { id: 'usr_abc123' } };
    const reqUser2 = { user: { id: 'usr_xyz789' } };

    const res1 = assigner.shouldUseCanary(reqUser1, 50);
    const res2 = assigner.shouldUseCanary(reqUser1, 50);
    expect(res1).toBe(res2);

    // Distribution check across a larger sample
    let canaryCount = 0;
    for (let i = 0; i < 100; i++) {
      if (assigner.shouldUseCanary({ user: { id: `user_${i}` } }, 20)) {
        canaryCount++;
      }
    }
    // Should be reasonably close to 20%
    expect(canaryCount).toBeGreaterThan(5);
    expect(canaryCount).toBeLessThan(40);
  });

  it('should support session-id and request-id based assignment', () => {
    const sessionAssigner = new StableCanaryAssigner('session-id');
    const reqSession = { sessionID: 'sess_12345' };
    expect(sessionAssigner.shouldUseCanary(reqSession, 50)).toBe(
      sessionAssigner.shouldUseCanary(reqSession, 50),
    );

    const requestIdAssigner = new StableCanaryAssigner('request-id');
    const reqId = { headers: { 'x-request-id': 'req-98765' } };
    expect(requestIdAssigner.shouldUseCanary(reqId, 50)).toBe(
      requestIdAssigner.shouldUseCanary(reqId, 50),
    );
  });
});
