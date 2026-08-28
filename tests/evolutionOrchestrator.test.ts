import { EvolutionOrchestrator } from '../src/evolutionOrchestrator';
import { IssueStream, ProductIssue } from '../src/issueStream';
import { FeatureScaffolder } from '../src/scaffolder';
import { FrontendEvolver } from '../src/frontendEvolver';
import { ProductChangelog } from '../src/productChangelog';
import { DynamicRouter } from '../src/dynamicRouter';
import { ProductionManager } from '../src/productionManager';
import { Sandbox } from '../src/sandbox';
import { BehaviorTracker } from '../src/behaviorTracker';
import { InMemoryMetricsStore } from '../src/metrics';
import { ReactComponentRegistry, ReactComponentGenerator } from '../src/react';
import { LLMClient } from '../src/ai';
import { SeimEventBus } from '../src/events';
import { Logger } from '../src/logger';
import { mergeConfig } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

describe('EvolutionOrchestrator — Autonomous Product Delivery', () => {
  const testStorageDir = path.join(__dirname, '.test-orchestrator-storage');
  let orchestrator: EvolutionOrchestrator;
  let issueStream: IssueStream;
  let changelog: ProductChangelog;
  let dynamicRouter: DynamicRouter;

  beforeEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
    const config = mergeConfig({
      mode: 'bypass',
      behavior: { enabled: true, autoScaffold: true },
      frontend: { enabled: true, outputDir: testStorageDir },
      storagePath: testStorageDir,
    });
    const tracker = new BehaviorTracker();
    const metrics = new InMemoryMetricsStore();
    const events = new SeimEventBus();
    const logger = new Logger({ level: 'error' });
    const llm = new LLMClient(config);
    const sandbox = new Sandbox();
    const scaffolder = new FeatureScaffolder(config, llm);
    const registry = new ReactComponentRegistry();
    const generator = new ReactComponentGenerator(registry, llm, config, events, logger);
    const frontendEvolver = new FrontendEvolver(generator, registry, config, events, logger);
    changelog = new ProductChangelog(testStorageDir);
    const productionManager = new ProductionManager(config);
    dynamicRouter = new DynamicRouter(productionManager);
    issueStream = new IssueStream(tracker, metrics, config, events, logger);

    orchestrator = new EvolutionOrchestrator(
      issueStream, scaffolder, frontendEvolver, changelog, dynamicRouter, sandbox, config, events, logger
    );
  });

  afterEach(() => {
    orchestrator.destroy();
    issueStream.destroy();
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  it('should autonomously handle a feature:missing_api issue and inject the route', async () => {
    const issue: ProductIssue = {
      id: 'issue_cart_post',
      type: 'feature:missing_api',
      path: '/api/v1/cart',
      method: 'POST',
      severity: 'high',
      frequency: 25,
      affectedSessions: 8,
      evidence: [],
      suggestedAction: 'Add shopping cart item',
      detectedAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    };

    const handled = await orchestrator.handleIssue(issue);
    expect(handled).toBe(true);

    // Verify route was registered in dynamicRouter
    const counts = dynamicRouter.getHandlerCounts();
    expect(counts.optimized).toBeGreaterThanOrEqual(1);

    // Verify change was recorded in changelog
    const recent = changelog.getRecent();
    expect(recent.length).toBe(1);
    expect(recent[0].type).toBe('new_feature');
    expect(recent[0].title).toContain('Added API Route: POST /api/v1/cart');
    expect(recent[0].status).toBe('live');
  });
});
