import { MemoryArtifactStore } from '../src/artifactStore';
import { VersionRegistry } from '../src/versionRegistry';
import { VersionDispatcher } from '../src/versionDispatcher';
import { EvolutionPipeline } from '../src/evolution/pipeline';
import { SeimEventBus } from '../src/events';

describe('EvolutionPipeline & ArtifactStore', () => {
  it('should generate artifact with diff, persist it, and deploy canary in VersionDispatcher', async () => {
    const artifactStore = new MemoryArtifactStore();
    const versionRegistry = new VersionRegistry();
    const dispatcher = new VersionDispatcher(versionRegistry);
    const events = new SeimEventBus();
    const pipeline = new EvolutionPipeline(artifactStore, dispatcher, events);

    const origCode = 'const a = await fetchA();\nconst b = await fetchB();';
    const optCode = 'const [a, b] = await Promise.all([fetchA(), fetchB()]);';

    const result = await pipeline.processOpportunity({
      routeKey: '/api/v1/data',
      pattern: 'sequential-async',
      severity: 'high',
      sourceCode: origCode,
      suggestedCode: optCode,
    }, 20);

    expect(result.success).toBe(true);
    expect(result.artifactId).toBeDefined();
    expect(result.artifact?.patchDiff).toContain('Promise.all');

    // Verify artifact saved in store
    const stored = await artifactStore.get(result.artifactId!);
    expect(stored).toBeDefined();
    expect(stored?.builtCode).toBe(optCode);
    expect(stored?.lineage).toHaveLength(1);

    // Verify canary registered in dispatcher
    const canary = versionRegistry.getCanary('/api/v1/data');
    expect(canary).toBeDefined();
    expect(canary?.canaryPercent).toBe(20);
  });
});
