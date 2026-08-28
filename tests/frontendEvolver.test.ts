import * as fs from 'fs';
import * as path from 'path';
import { FrontendEvolver } from '../src/frontendEvolver';
import { ReactComponentRegistry, ReactComponentGenerator } from '../src/react';
import { LLMClient } from '../src/ai';
import { SeimEventBus } from '../src/events';
import { Logger } from '../src/logger';
import { mergeConfig } from '../src/config';
import { ProductIssue } from '../src/issueStream';

describe('FrontendEvolver — Autonomous React Evolution', () => {
  const testOutputDir = path.join(__dirname, '.test-seim-generated');
  let evolver: FrontendEvolver;
  let registry: ReactComponentRegistry;

  beforeEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
    registry = new ReactComponentRegistry();
    const config = mergeConfig({
      frontend: { enabled: true, outputDir: testOutputDir }
    });
    const llm = new LLMClient(config);
    const events = new SeimEventBus();
    const logger = new Logger({ level: 'error' });
    const generator = new ReactComponentGenerator(registry, llm, config, events, logger);
    evolver = new FrontendEvolver(generator, registry, config, events, logger);
  });

  afterEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('should generate physical TSX files and seim-routes.tsx manifest', async () => {
    const issue: ProductIssue = {
      id: 'issue_cart',
      type: 'feature:missing_page',
      path: '/cart',
      severity: 'medium',
      frequency: 15,
      affectedSessions: 5,
      evidence: [],
      suggestedAction: 'Shopping cart page for review and purchase',
      detectedAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    };

    const result = await evolver.evolve(issue);
    expect(result).not.toBeNull();
    expect(result?.component.name).toBe('CartPage');

    // Verify physical file on disk
    const componentFile = path.join(testOutputDir, 'CartPage.tsx');
    expect(fs.existsSync(componentFile)).toBe(true);
    const code = fs.readFileSync(componentFile, 'utf8');
    expect(code).toContain('export default function CartPage');

    // Verify seim-routes.tsx manifest
    const manifestFile = path.join(testOutputDir, 'seim-routes.tsx');
    expect(fs.existsSync(manifestFile)).toBe(true);
    const manifest = fs.readFileSync(manifestFile, 'utf8');
    expect(manifest).toContain("path: '/cart'");
    expect(manifest).toContain("Component: lazy(() => import('./CartPage'))");
    expect(manifest).toContain('SeimDynamicRoutes');
  });
});
