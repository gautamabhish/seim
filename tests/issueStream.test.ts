import { BehaviorTracker } from '../src/behaviorTracker';
import { InMemoryMetricsStore } from '../src/metrics';
import { IssueStream } from '../src/issueStream';
import { SeimEventBus } from '../src/events';
import { Logger } from '../src/logger';
import { mergeConfig } from '../src/config';

describe('IssueStream — Autonomous Issue & Opportunity Detection', () => {
  let tracker: BehaviorTracker;
  let metrics: InMemoryMetricsStore;
  let events: SeimEventBus;
  let logger: Logger;
  let issueStream: IssueStream;

  beforeEach(() => {
    tracker = new BehaviorTracker();
    metrics = new InMemoryMetricsStore();
    events = new SeimEventBus();
    logger = new Logger({ level: 'error' });
    const config = mergeConfig({
      behavior: { enabled: true, minPatternFrequency: 3, minIssueSessionThreshold: 3 }
    });
    issueStream = new IssueStream(tracker, metrics, config, events, logger);
  });

  afterEach(() => {
    tracker.destroy();
    issueStream.destroy();
  });

  it('should detect missing API feature when 404s occur across >= 3 sessions', () => {
    // Record 404s from 3 distinct sessions
    for (let i = 1; i <= 3; i++) {
      tracker.record({
        sessionId: `sess_${i}`,
        type: 'error_404',
        path: '/api/v1/cart',
        method: 'POST',
        statusCode: 404,
        timestamp: Date.now(),
      });
    }

    const issues = issueStream.scanAndEmit();
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('feature:missing_api');
    expect(issues[0].path).toBe('/api/v1/cart');
    expect(issues[0].method).toBe('POST');
    expect(issues[0].affectedSessions).toBe(3);
    expect(issues[0].status).toBe('open');
  });

  it('should filter out vulnerability scans and exploit probes', () => {
    const maliciousPaths = ['/.env', '/wp-admin/login.php', '/phpinfo.php', '/.git/config', '/api/users?q=UNION SELECT'];
    for (let i = 0; i < maliciousPaths.length; i++) {
      for (let s = 1; s <= 5; s++) {
        tracker.record({
          sessionId: `attacker_${s}`,
          type: 'error_404',
          path: maliciousPaths[i],
          method: 'GET',
          statusCode: 404,
          timestamp: Date.now(),
        });
      }
    }

    const issues = issueStream.scanAndEmit();
    expect(issues.length).toBe(0);
  });

  it('should detect 5xx error spikes as critical bug issues', () => {
    const routeKey = 'GET /api/checkout';
    // 20 requests, 5 errors (25% error rate)
    for (let i = 0; i < 15; i++) {
      metrics.record(routeKey, 50, 200, 100, 10, false, false);
    }
    for (let i = 0; i < 5; i++) {
      metrics.record(routeKey, 50, 500, 100, 10, true, false);
    }

    const issues = issueStream.scanAndEmit();
    const bugIssue = issues.find(i => i.type === 'bug:5xx_spike');
    expect(bugIssue).toBeDefined();
    expect(bugIssue?.path).toBe(routeKey);
    expect(bugIssue?.severity).toBe('critical');
    expect(bugIssue?.frequency).toBe(5);
  });

  it('should allow resolving and dismissing issues', () => {
    for (let i = 1; i <= 3; i++) {
      tracker.record({
        sessionId: `sess_${i}`,
        type: 'error_404',
        path: '/api/v1/wishlist',
        method: 'GET',
        statusCode: 404,
        timestamp: Date.now(),
      });
    }

    issueStream.scanAndEmit();
    const open = issueStream.getOpenIssues();
    expect(open.length).toBe(1);

    issueStream.dismissIssue(open[0].id);
    expect(issueStream.getOpenIssues().length).toBe(0);
    expect(issueStream.getAllIssues()[0].status).toBe('dismissed');
  });
});
