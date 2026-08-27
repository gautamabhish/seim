import { CustomPatternRegistry } from '../src/customPatternRegistry';
import assert from 'assert';

describe('CustomPatternRegistry', () => {
  let registry: CustomPatternRegistry;

  beforeEach(() => {
    registry = new CustomPatternRegistry();
  });

  it('should register using registerRegex and scan correctly', () => {
    registry.registerRegex(
      'no-sync-redis',
      'Avoid sync Redis',
      'Detects synchronous Redis calls',
      'high',
      /redis\.getSync\([^)]*\)/
    );

    const sourceCode = `
      function getUser() {
        const val = redis.getSync('user:1');
        return val;
      }
    `;

    const matches = registry.scan(sourceCode);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].pattern.id, 'no-sync-redis');
    assert.strictEqual(matches[0].match, "redis.getSync('user:1')");
  });

  it('should apply fixes with a simple regex transform', () => {
    registry.registerRegex(
      'no-sync-redis',
      'Avoid sync Redis',
      'Detects synchronous Redis calls',
      'high',
      /redis\.getSync\(([^)]*)\)/,
      (src, match) => src.replace(match[0], `await redis.get(${match[1]})`)
    );

    const sourceCode = `const val = redis.getSync('user:1');`;
    const result = registry.applyFixes(sourceCode);

    assert.strictEqual(result.appliedFixes.length, 1);
    assert.strictEqual(result.appliedFixes[0], 'no-sync-redis');
    assert.strictEqual(result.code, `const val = await redis.get('user:1');`);
  });

  it('should reject duplicate pattern IDs', () => {
    registry.registerRegex('duplicate-id', 'Test 1', 'Desc 1', 'low', /test1/);

    assert.throws(() => {
      registry.registerRegex('duplicate-id', 'Test 2', 'Desc 2', 'low', /test2/);
    }, /Pattern with ID 'duplicate-id' already exists/);
  });

  it('should support getByTag and getBySeverity', () => {
    registry.registerRegex('pattern1', 'P1', 'D1', 'high', /p1/, undefined, { tags: ['db', 'redis'] });
    registry.registerRegex('pattern2', 'P2', 'D2', 'medium', /p2/, undefined, { tags: ['db'] });
    registry.registerRegex('pattern3', 'P3', 'D3', 'high', /p3/, undefined, { tags: ['api'] });

    const dbTags = registry.getByTag('db');
    assert.strictEqual(dbTags.length, 2);
    assert.ok(dbTags.find(p => p.id === 'pattern1'));
    assert.ok(dbTags.find(p => p.id === 'pattern2'));

    const highSeverity = registry.getBySeverity('high');
    assert.strictEqual(highSeverity.length, 2);
    assert.ok(highSeverity.find(p => p.id === 'pattern1'));
    assert.ok(highSeverity.find(p => p.id === 'pattern3'));
  });

  it('should export correctly excluding non-serializable fields', () => {
    registry.registerRegex('export-test', 'Export Test', 'Desc', 'low', /export/, undefined, {
      tags: ['test'],
      useAI: true
    });

    const exported = registry.export();
    assert.strictEqual(exported.length, 1);
    
    const exp = exported[0];
    assert.strictEqual(exp.id, 'export-test');
    assert.strictEqual(exp.name, 'Export Test');
    assert.strictEqual(exp.description, 'Desc');
    assert.strictEqual(exp.severity, 'low');
    assert.deepStrictEqual(exp.tags, ['test']);
    assert.strictEqual(exp.useAI, true);
    
    // Check that detector and fixer are excluded
    assert.strictEqual((exp as any).detector, undefined);
    assert.strictEqual((exp as any).fixer, undefined);
  });

  it('should leave a comment if useAI is true and no fixer is provided', () => {
    registry.registerRegex(
      'ai-fix-pattern',
      'AI Fix',
      'Needs AI',
      'medium',
      /badCode\(\)/,
      undefined,
      { useAI: true }
    );

    const sourceCode = `const x = badCode();`;
    const result = registry.applyFixes(sourceCode);

    assert.ok(result.code.includes('// [SEIM TODO: AI fix needed for ai-fix-pattern]'));
    assert.ok(result.code.includes('badCode()'));
    assert.strictEqual(result.appliedFixes.length, 1);
    assert.strictEqual(result.appliedFixes[0], 'ai-fix-pattern');
  });
});
