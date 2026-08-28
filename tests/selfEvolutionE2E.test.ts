import { seim } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

describe('SEIM Full-Stack Autonomous Product Evolution E2E', () => {
  const testStorageDir = path.join(__dirname, '.test-e2e-storage');
  const testReactDir = path.join(testStorageDir, 'seim-generated');

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

  it('should autonomously observe 404s, triage issue, scaffold backend API, and record in changelog', async () => {
    const s = seim({
      mode: 'bypass',
      behavior: { enabled: true, autoScaffold: true, minPatternFrequency: 3, minIssueSessionThreshold: 3 },
      frontend: { enabled: true, outputDir: testReactDir },
      storagePath: testStorageDir,
    });

    // 1. Simulate 3 distinct visitor sessions recording 404 on /api/v1/cart
    for (let i = 1; i <= 3; i++) {
      s.behaviorTracker.record({
        sessionId: `visitor_${i}`,
        type: 'error_404',
        path: '/api/v1/cart',
        method: 'POST',
        statusCode: 404,
        timestamp: Date.now(),
      });
    }

    // 2. Trigger IssueStream scan — this autonomously emits issue:detected which orchestrator catches
    const detectedIssues = s.issueStream.scanAndEmit();
    expect(detectedIssues.length).toBeGreaterThanOrEqual(1);

    // Wait a tick for async event-driven orchestration to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 3. Verify the route was autonomously registered in DynamicRouter
    const counts = s.dynamicRouter.getHandlerCounts();
    expect(counts.optimized).toBeGreaterThanOrEqual(1);

    // 4. Verify Changelog has the change recorded autonomously
    const changelogEntries = s.changelog.getRecent();
    expect(changelogEntries.length).toBeGreaterThanOrEqual(1);
    expect(changelogEntries[0].type).toBe('new_feature');
    expect(changelogEntries[0].title).toContain('Added API Route: POST /api/v1/cart');
    expect(changelogEntries[0].status).toBe('live');

    // 5. Test founder rollback
    const rolledBack = s.changelog.rollback('/api/v1/cart', 'Founder test rollback');
    expect(rolledBack).toBe(true);
    expect(s.changelog.getRecent()[0].type).toBe('rollback');
    expect(s.changelog.getRecent()[1].status).toBe('rolled_back');

    await s.shutdown();
  });
});
