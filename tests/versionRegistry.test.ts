import { VersionRegistry, RuntimeVersion } from '../src/versionRegistry';

describe('VersionRegistry', () => {
  let registry: VersionRegistry;

  beforeEach(() => {
    registry = new VersionRegistry();
  });

  it('should register and retrieve active and canary versions', () => {
    const original: RuntimeVersion = {
      id: 'v1.0.0',
      routeKey: '/api/items',
      handler: () => 'original',
      sourceHash: 'hash1',
      status: 'active',
      canaryPercent: 100,
      createdAt: Date.now(),
    };

    const canary: RuntimeVersion = {
      id: 'v1.0.1-canary',
      routeKey: '/api/items',
      handler: () => 'canary',
      sourceHash: 'hash2',
      status: 'canary',
      canaryPercent: 15,
      createdAt: Date.now(),
    };

    registry.register(original);
    registry.register(canary);

    expect(registry.getActive('/api/items')?.id).toBe('v1.0.0');
    expect(registry.getCanary('/api/items')?.id).toBe('v1.0.1-canary');
    expect(registry.list('/api/items')).toHaveLength(2);
  });

  it('should promote a canary version to active', () => {
    const original: RuntimeVersion = {
      id: 'v1.0.0',
      routeKey: '/api/users',
      handler: () => 'original',
      sourceHash: 'hash1',
      status: 'active',
      canaryPercent: 100,
      createdAt: Date.now(),
    };

    const canary: RuntimeVersion = {
      id: 'v1.0.1',
      routeKey: '/api/users',
      handler: () => 'optimized',
      sourceHash: 'hash2',
      status: 'canary',
      canaryPercent: 10,
      createdAt: Date.now(),
    };

    registry.register(original);
    registry.register(canary);

    const success = registry.promote('/api/users', 'v1.0.1', 'Latency reduced by 40%');
    expect(success).toBe(true);
    expect(registry.getActive('/api/users')?.id).toBe('v1.0.1');
    expect(registry.getActive('/api/users')?.status).toBe('active');
    expect(registry.getCanary('/api/users')).toBeUndefined();
    expect(original.status).toBe('rolled-back');
  });

  it('should rollback to original version', () => {
    const original: RuntimeVersion = {
      id: 'v1.0.0-original',
      routeKey: '/api/users',
      handler: () => 'original',
      sourceHash: 'hash1',
      status: 'active',
      canaryPercent: 100,
      createdAt: Date.now(),
    };

    const canary: RuntimeVersion = {
      id: 'v1.0.1',
      routeKey: '/api/users',
      handler: () => 'optimized',
      sourceHash: 'hash2',
      status: 'canary',
      canaryPercent: 10,
      createdAt: Date.now(),
    };

    registry.register(original);
    registry.register(canary);

    registry.rollback('/api/users', 'Error rate spiked');
    expect(canary.status).toBe('rolled-back');
    expect(registry.getCanary('/api/users')).toBeUndefined();
  });
});
