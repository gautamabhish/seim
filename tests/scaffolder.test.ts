import seim from '../src/index';

describe('Feature Scaffolder Route Injection', () => {
  beforeEach(() => {
    if ((global as any).seimDb) {
      (global as any).seimDb.clearAll();
    }
  });

  it('should dynamically scaffold a route and handle execution', async () => {
    const seimInstance = seim({
      mode: 'bypass',
      ai: { enabled: false, generatorModel: '', reviewerModel: '', verifierModel: '' },
      experiment: {
        confidenceThreshold: 0.9,
        canaryPercent: 100,
        rollbackLatencyMultiplier: 1.2,
        rollbackErrorRate: 1.5,
        minSampleSize: 1,
        shadowCooldownMs: 0,
        shadowAllowedMethods: ['POST'],
        shadowSampleSize: 1,
      },
      storage: { type: 'memory' },
      security: {
        blockAuthenticationChanges: false,
        blockAuthorizationChanges: false,
        blockPaymentChanges: false,
        blockSecretUsage: false,
        allowedPatternModels: ['sequential-async'],
      },
      learning: { enabled: true, sampleSize: 1 },
      scaffolding: {
        enabled: true,
      },
    });

    const listener = seimInstance.listener();

    // Mock Express App to track dynamically registered routes at runtime
    const routesRegistered = new Map<string, Function>();
    const mockApp = {
      post: jest.fn().mockImplementation((path, handler) => {
        routesRegistered.set(`POST:${path}`, handler);
      }),
      get: jest.fn().mockImplementation((path, handler) => {
        routesRegistered.set(`GET:${path}`, handler);
      }),
    };

    // Mock request initiating a 404 scaffold intent
    const req = {
      path: '/seim/telemetry',
      method: 'POST',
      body: {
        type: '404_intent',
        path: '/api/cart',
        method: 'POST',
        intent: 'add an item to the shopping cart_items collection',
      },
      app: mockApp,
    } as any;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as any;

    await listener(req, res, jest.fn());

    // Allow async optimize/scaffold tasks to execute
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockApp.post).toHaveBeenCalledWith('/api/cart', expect.any(Function));
    expect(routesRegistered.has('POST:/api/cart')).toBe(true);

    // Get the dynamically registered handler and test it!
    const scaffoldedHandler = routesRegistered.get('POST:/api/cart')!;
    
    // Simulate hitting the dynamically scaffolded /api/cart route
    const cartReq = {
      body: { productId: 42, quantity: 5 },
      path: '/api/cart',
      method: 'POST',
    } as any;
    const cartRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as any;

    await scaffoldedHandler(cartReq, cartRes, (err: any) => {
      if (err) console.error('Next function called with error:', err);
    });

    // Wait for async sandbox execution to resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(cartRes.status).toHaveBeenCalledWith(201);
    expect(cartRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      item: expect.objectContaining({
        productId: 42,
        quantity: 5,
        _id: 1,
      }),
    }));

    await seimInstance.shutdown();
  });
});
