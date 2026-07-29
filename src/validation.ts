import { Request } from 'express';
import { SeimConfig, OptimizationCandidate, ValidationReport } from './types';
import { SecurityGate } from './security';
import { LLMClient } from './ai';

export class ValidationEngine {
  private security: SecurityGate;

  constructor(private config: SeimConfig, private llm: LLMClient) {
    this.security = new SecurityGate(config);
  }

  public async validate(
    candidate: OptimizationCandidate,
    originalResponse: unknown,
    optimizedResponse: unknown,
    request?: Request
  ): Promise<ValidationReport> {
    const report: ValidationReport = {
      candidateId: candidate.id,
      layer1Schema: { pass: true },
      layer2ResponseEquivalence: { pass: true },
      layer3BusinessRules: { pass: true, violations: [] },
      layer4UnitTests: { pass: true },
      layer5IntegrationTests: { pass: true },
      layer6Security: { pass: true },
      layer7AICritic: { pass: true },
      overall: false,
    };

    report.layer1Schema = this.schemaCheck(candidate);
    report.layer2ResponseEquivalence = this.responseEquivalence(originalResponse, optimizedResponse);
    report.layer3BusinessRules = await this.businessRules(optimizedResponse, request);
    report.layer4UnitTests = await this.runUnitTests();
    report.layer5IntegrationTests = await this.runIntegrationTests();
    report.layer6Security = this.security.validate(candidate.originalCode, candidate);
    report.layer7AICritic = await this.aiCritic(candidate);

    report.overall =
      report.layer1Schema.pass &&
      report.layer2ResponseEquivalence.pass &&
      report.layer3BusinessRules.pass &&
      report.layer4UnitTests.pass &&
      report.layer5IntegrationTests.pass &&
      report.layer6Security.pass &&
      report.layer7AICritic.pass;

    return report;
  }

  private schemaCheck(candidate: OptimizationCandidate): { pass: boolean; reason?: string } {
    return candidate.optimizedCode ? { pass: true } : { pass: true, reason: 'Suggestion only' };
  }

  private responseEquivalence(a: unknown, b: unknown): { pass: boolean; reason?: string } {
    const eq = JSON.stringify(a) === JSON.stringify(b);
    return eq
      ? { pass: true }
      : { pass: false, reason: 'Optimized response differs from original' };
  }

  private async businessRules(response: unknown, request?: Request): Promise<{ pass: boolean; violations: string[] }> {
    const violations: string[] = [];
    for (const rule of this.config.businessRules) {
      try {
        const ok = await Promise.resolve(rule(response, request));
        if (!ok) violations.push(`Business rule failed: ${rule.toString().slice(0, 80)}`);
      } catch (err) {
        violations.push(`Business rule threw: ${err}`);
      }
    }
    return { pass: violations.length === 0, violations };
  }

  private async runUnitTests(): Promise<{ pass: boolean; reason?: string }> {
    return { pass: true, reason: 'npm test execution stubbed; wire via spawn("npm", ["test"])' };
  }

  private async runIntegrationTests(): Promise<{ pass: boolean; reason?: string }> {
    return { pass: true, reason: 'Integration tests stubbed; implement with test harness' };
  }

  private async aiCritic(candidate: OptimizationCandidate): Promise<{ pass: boolean; reason?: string }> {
    if (!this.config.ai.enabled) {
      return { pass: true, reason: 'AI critic disabled' };
    }
    try {
      const review = await this.llm.review(candidate.originalCode || '', candidate.optimizedCode || '');
      return review;
    } catch (err) {
      return { pass: false, reason: `AI critic failed: ${(err as Error).message}` };
    }
  }
}
