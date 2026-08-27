import { SecurityGate } from '../src/security';
import { SeimConfig, OptimizationCandidate } from '../src/types';

describe('SecurityGate', () => {
  let securityGate: SecurityGate;
  let config: SeimConfig;

  beforeEach(() => {
    config = {
      mode: 'bypass',
      studioPath: '/studio',
      businessRules: [],
      securityRules: [],
      ai: { enabled: false, generatorModel: '', reviewerModel: '', verifierModel: '' },
      experiment: {
        confidenceThreshold: 0.9,
        canaryPercent: 10,
        rollbackLatencyMultiplier: 1.2,
        rollbackErrorRate: 1.5,
        minSampleSize: 5,
        shadowCooldownMs: 1000,
        shadowAllowedMethods: ['GET'],
        shadowSampleSize: 5,
      },
      storage: { type: 'memory' },
      security: {
        blockAuthenticationChanges: true,
        blockAuthorizationChanges: true,
        blockPaymentChanges: true,
        blockSecretUsage: true,
        allowedPatternModels: ['sequential-async'],
      },
      learning: { enabled: true, sampleSize: 5 },
    };
    securityGate = new SecurityGate(config);
  });

  it('should pass on safe optimization candidate', () => {
    const oldCode = 'async function handler(req, res) { await delay(100); res.json({ ok: true }); }';
    const candidate: OptimizationCandidate = {
      id: 'c1',
      routeKey: '/api/v1/test',
      pattern: 'sequential-async',
      severity: 'low',
      originalCode: oldCode,
      optimizedCode: 'async function handler(req, res) { res.json({ ok: true }); }',
      confidence: 0.95,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const res = securityGate.validate(oldCode, candidate);
    expect(res.pass).toBe(true);
  });

  it('should block candidates introducing eval()', () => {
    const oldCode = 'async function handler(req, res) { res.json({ val: 1 }); }';
    const candidate: OptimizationCandidate = {
      id: 'c2',
      routeKey: '/api/v1/test',
      pattern: 'sequential-async',
      severity: 'high',
      originalCode: oldCode,
      optimizedCode: 'async function handler(req, res) { const x = eval("1"); res.json({ val: x }); }',
      confidence: 0.95,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const res = securityGate.validate(oldCode, candidate);
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('dangerous global API');
  });

  it('should block candidates introducing process.env secrets with bracket notation', () => {
    const oldCode = 'async function handler(req, res) { res.json({ ok: true }); }';
    const candidate: OptimizationCandidate = {
      id: 'c3',
      routeKey: '/api/v1/test',
      pattern: 'sequential-async',
      severity: 'high',
      originalCode: oldCode,
      optimizedCode: 'async function handler(req, res) { const k = process.env["API_KEY"]; res.json({ key: k }); }',
      confidence: 0.95,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const res = securityGate.validate(oldCode, candidate);
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('leak or expose secrets');
  });
});
