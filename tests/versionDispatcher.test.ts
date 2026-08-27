import { VersionRegistry } from '../src/versionRegistry';
import { VersionDispatcher } from '../src/versionDispatcher';
import { StableCanaryAssigner } from '../src/canaryAssignment';
import { SeimEventBus } from '../src/events';

describe('VersionDispatcher', () => {
  let registry: VersionRegistry;
  let dispatcher: VersionDispatcher;
  let events: SeimEventBus;

  beforeEach(() => {
    registry = new VersionRegistry();
    events = new SeimEventBus();
    dispatcher = new VersionDispatcher(registry, new StableCanaryAssigner('ip'), events);
  });

  it('should route traffic to original when no canary is registered', () => {
    const originalHandler = () => 'original';
    dispatcher.registerOriginal('/api/orders', originalHandler, 'function original() {}');

    const selected = dispatcher.dispatch('/api/orders', { ip: '192.168.1.1' });
    expect(selected).toBe(originalHandler);
  });

  it('should route canary traffic deterministically', () => {
    const originalHandler = () => 'original';
    const canaryHandler = () => 'canary';

    dispatcher.registerOriginal('/api/orders', originalHandler, 'function original() {}');
    dispatcher.registerCanary('/api/orders', 'c1', canaryHandler, 'function canary() {}', 100);

    const selected = dispatcher.dispatch('/api/orders', { ip: '192.168.1.1' });
    expect(selected).toBe(canaryHandler);
  });

  it('should support emergency pause on canary deployments', () => {
    const originalHandler = () => 'original';
    const canaryHandler = () => 'canary';

    dispatcher.registerOriginal('/api/orders', originalHandler, 'function original() {}');
    dispatcher.registerCanary('/api/orders', 'c1', canaryHandler, 'function canary() {}', 100);

    dispatcher.pauseAll();

    const selected = dispatcher.dispatch('/api/orders', { ip: '192.168.1.1' });
    expect(selected).toBe(originalHandler);
  });

  it('should emit events on promote and rollback', () => {
    const promotedSpy = jest.fn();
    const rollbackSpy = jest.fn();

    events.on('optimization:promoted', promotedSpy);
    events.on('optimization:rolledback', rollbackSpy);

    dispatcher.registerOriginal('/api/orders', () => 'orig', 'orig');
    dispatcher.registerCanary('/api/orders', 'c1', () => 'canary', 'canary', 10);

    dispatcher.promote('/api/orders', 'c1', 'Approved');
    expect(promotedSpy).toHaveBeenCalledWith(expect.objectContaining({ routeKey: '/api/orders', candidateId: 'c1' }));

    dispatcher.rollback('/api/orders', 'Issue found');
    expect(rollbackSpy).toHaveBeenCalledWith(expect.objectContaining({ routeKey: '/api/orders', reason: 'Issue found' }));
  });

  it('should create dynamic middleware function', (done) => {
    dispatcher.registerOriginal('/api/ping', (_req: any, res: any) => {
      res.json({ pong: true });
    }, 'ping');

    const middleware = dispatcher.createMiddleware('/api/ping');
    const mockRes = {
      json: (data: any) => {
        expect(data).toEqual({ pong: true });
        done();
      },
    };

    middleware({}, mockRes, () => {});
  });
});
