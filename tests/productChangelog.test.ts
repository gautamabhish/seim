import * as fs from 'fs';
import * as path from 'path';
import { ProductChangelog } from '../src/productChangelog';

describe('ProductChangelog — Evolution Ledger & Rollback Sentry', () => {
  const testStorageDir = path.join(__dirname, '.test-changelog-storage');

  beforeEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  it('should record changes and persist them to disk', () => {
    const changelog = new ProductChangelog(testStorageDir);
    const entry = changelog.record({
      type: 'new_feature',
      title: 'Added POST /api/cart',
      description: 'Built from 40 visitor 404 requests',
      path: '/api/cart',
      affectedSessions: 40,
      status: 'live',
    });

    expect(entry.id).toBeDefined();
    expect(entry.shippedAt).toBeGreaterThan(0);
    expect(changelog.getRecent().length).toBe(1);

    // Verify re-loading from disk
    const changelog2 = new ProductChangelog(testStorageDir);
    expect(changelog2.getRecent().length).toBe(1);
    expect(changelog2.getRecent()[0].title).toBe('Added POST /api/cart');
  });

  it('should record rollbacks and update status of live changes', () => {
    const changelog = new ProductChangelog(testStorageDir);
    changelog.record({
      type: 'optimization',
      title: 'Optimized GET /api/users',
      description: 'Saved 200ms',
      path: 'GET /api/users',
      status: 'live',
    });

    const rolledBack = changelog.rollback('GET /api/users', 'Regression detected');
    expect(rolledBack).toBe(true);

    const recent = changelog.getRecent();
    expect(recent.length).toBe(2);
    expect(recent[0].type).toBe('rollback');
    expect(recent[1].status).toBe('rolled_back');
  });

  it('should generate human-readable Markdown summary for founders', () => {
    const changelog = new ProductChangelog(testStorageDir);
    changelog.record({
      type: 'new_feature',
      title: 'Added /api/checkout',
      description: 'Built checkout flow for visitors',
      path: '/api/checkout',
      affectedSessions: 12,
      status: 'live',
    });

    const md = changelog.toMarkdown();
    expect(md).toContain('Product Evolution Changelog');
    expect(md).toContain('Added /api/checkout');
    expect(md).toContain('**Affected Visitor Sessions**: 12');
  });
});
