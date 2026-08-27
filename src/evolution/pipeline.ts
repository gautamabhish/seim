import { createHash } from 'crypto';
import { RouteMetrics } from '../types';
import { ArtifactStore, EvolutionArtifact } from '../artifactStore';
import { VersionDispatcher } from '../versionDispatcher';
import { SeimEventBus } from '../events';
import { Logger } from '../logger';

export interface EvolutionOpportunity {
  routeKey: string;
  pattern: string;
  severity: string;
  sourceCode: string;
  suggestedCode: string;
  metrics?: RouteMetrics;
}

export interface PipelineExecutionResult {
  success: boolean;
  artifactId?: string;
  versionId?: string;
  canaryPercent?: number;
  reason?: string;
  artifact?: EvolutionArtifact;
}

export class EvolutionPipeline {
  constructor(
    private artifactStore: ArtifactStore,
    private dispatcher: VersionDispatcher,
    private events?: SeimEventBus,
    private logger?: Logger,
  ) {}

  /**
   * Executes the full durable evolution workflow:
   * 1. Generates source diff & checksum
   * 2. Builds a versioned artifact
   * 3. Persists artifact to the artifact store
   * 4. Deploys as an isolated canary version in VersionDispatcher
   */
  public async processOpportunity(
    opportunity: EvolutionOpportunity,
    canaryPercent: number = 5,
  ): Promise<PipelineExecutionResult> {
    const { routeKey, sourceCode, suggestedCode, pattern } = opportunity;
    if (!suggestedCode) {
      return { success: false, reason: 'No suggested code provided' };
    }

    const sourceHash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const candidateId = `${routeKey}::pipeline::${Date.now()}`;
    const patchDiff = this.computeUnifiedDiff(sourceCode, suggestedCode);

    const artifact: EvolutionArtifact = {
      id: `artifact::${Date.now()}::${sourceHash}`,
      routeKey,
      candidateId,
      sourceHash,
      patchDiff,
      builtCode: suggestedCode,
      createdAt: Date.now(),
      lineage: [sourceHash],
    };

    // 1. Save artifact
    await this.artifactStore.save(artifact);

    // 2. Register canary with VersionDispatcher
    const dummyHandler = (req: any, res: any, next: any) => {
      if (typeof next === 'function') next();
    };

    this.dispatcher.registerCanary(
      routeKey,
      candidateId,
      dummyHandler,
      suggestedCode,
      canaryPercent,
      { pattern, artifactId: artifact.id },
    );

    this.logger?.info('Durable evolution pipeline generated artifact and deployed canary', {
      routeKey,
      artifactId: artifact.id,
      canaryPercent,
    });

    return {
      success: true,
      artifactId: artifact.id,
      versionId: candidateId,
      canaryPercent,
      artifact,
    };
  }

  private computeUnifiedDiff(original: string, modified: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const diff: string[] = ['--- original', '+++ optimized'];

    const maxLines = Math.max(origLines.length, modLines.length);
    for (let i = 0; i < maxLines; i++) {
      const o = origLines[i];
      const m = modLines[i];
      if (o !== m) {
        if (o !== undefined) diff.push(`- ${o}`);
        if (m !== undefined) diff.push(`+ ${m}`);
      } else if (o !== undefined) {
        diff.push(`  ${o}`);
      }
    }
    return diff.join('\n');
  }
}
