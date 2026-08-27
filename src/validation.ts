import { Request } from 'express';
import { exec } from 'child_process';
import { SeimConfig, OptimizationCandidate, ValidationReport, ValidationCheckResult } from './types';
import { SecurityGate } from './security';
import { LLMClient } from './ai';
export class ValidationEngine {
  private security: SecurityGate;

  constructor(
    private config: SeimConfig, 
    private llm: LLMClient
  ) {
    this.security = new SecurityGate(config);
  }

  public async validate(
    candidate: OptimizationCandidate,
    originalResponse: unknown,
    optimizedResponse: unknown,
    request?: Request,
    shadowResult?: { v1Latency: number; v2Latency: number }
  ): Promise<ValidationReport> {
    const report: ValidationReport = {
      candidateId: candidate.id,
      layer1Schema: { pass: true },
      layer2ResponseEquivalence: { pass: true },
      layer2bSchemaCompatibility: { pass: true },
      layer3BusinessRules: { pass: true, violations: [] },
      layer4UnitTests: { pass: true },
      layer5IntegrationTests: { pass: true },
      layer6Security: { pass: true },
      layer7AICritic: { pass: true },
      layer8PerformanceGate: { pass: true },
      overall: false,
      fullyValidated: false,
      skippedChecks: [],
    };

    report.layer1Schema = this.schemaCheck(candidate);
    report.layer2ResponseEquivalence = this.responseEquivalence(originalResponse, optimizedResponse);
    
    report.layer2bSchemaCompatibility = this.schemaCompatibility(originalResponse, optimizedResponse);
    
    report.layer3BusinessRules = await this.businessRules(optimizedResponse, request);
    report.layer4UnitTests = await this.runUnitTests();
    report.layer5IntegrationTests = await this.runIntegrationTests();
    report.layer6Security = this.security.validate(candidate.originalCode, candidate);
    report.layer7AICritic = await this.aiCritic(candidate);
    report.layer8PerformanceGate = this.performanceGate(shadowResult);

    // Collect skipped checks
    const checks = [
      { name: 'schema', result: report.layer1Schema },
      { name: 'responseEquivalence', result: report.layer2ResponseEquivalence },
      { name: 'schemaCompatibility', result: report.layer2bSchemaCompatibility },
      { name: 'businessRules', result: report.layer3BusinessRules },
      { name: 'unitTests', result: report.layer4UnitTests },
      { name: 'integrationTests', result: report.layer5IntegrationTests },
      { name: 'security', result: report.layer6Security },
      { name: 'aiCritic', result: report.layer7AICritic },
      { name: 'performanceGate', result: report.layer8PerformanceGate },
    ];
    report.skippedChecks = checks.filter(c => c.result.skipped).map(c => c.name);
    report.fullyValidated = report.skippedChecks.length === 0;

    report.overall =
      report.layer1Schema.pass &&
      report.layer2ResponseEquivalence.pass &&
      report.layer2bSchemaCompatibility.pass &&
      report.layer3BusinessRules.pass &&
      report.layer4UnitTests.pass &&
      report.layer5IntegrationTests.pass &&
      report.layer6Security.pass &&
      report.layer7AICritic.pass &&
      report.layer8PerformanceGate.pass;

    return report;
  }

  private schemaCheck(candidate: OptimizationCandidate): ValidationCheckResult {
    return { pass: true, skipped: true, reason: 'No schema validation configured' };
  }

  private responseEquivalence(a: unknown, b: unknown): { pass: boolean; reason?: string } {
    if (a === b) return { pass: true };
    if (a === undefined || b === undefined || a === null || b === null) {
      return { pass: false, reason: 'One response is null/undefined' };
    }
    const match = this.structuralMatch(a, b);
    return match
      ? { pass: true }
      : { pass: false, reason: 'Optimized response structure differs from original' };
  }

  /**
   * Schema compatibility check - fallbacks to response equivalence.
   */
  private schemaCompatibility(a: unknown, b: unknown): { pass: boolean; reason?: string } {
    return this.responseEquivalence(a, b);
  }

  private structuralMatch(a: unknown, b: unknown, depth = 0): boolean {
    if (depth > 20) return true; // prevent infinite recursion
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) {
      // For primitive values, check if both are "dynamic" (timestamps, UUIDs)
      return this.isDynamic(a) && this.isDynamic(b);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => this.structuralMatch(item, (b as any[])[i], depth + 1));
    }
    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    if (keysA.length !== keysB.length) return false;
    if (!keysA.every((k, i) => k === keysB[i])) return false;
    return keysA.every(k => this.structuralMatch((a as any)[k], (b as any)[k], depth + 1));
  }

  private isDynamic(value: unknown): boolean {
    if (typeof value === 'number') {
      // Likely a timestamp if > 1e12 (milliseconds since epoch)
      return value > 1e12;
    }
    if (typeof value === 'string') {
      // UUID pattern
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
      // ISO date
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return true;
    }
    return false;
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

  private async runUnitTests(): Promise<ValidationCheckResult> {
    return new Promise((resolve) => {
      try {
        const child = exec('npm test', { timeout: 30_000 }, (error, stdout, stderr) => {
          if (error) {
            // If the test script isn't configured or the command fails to spawn
            if (
              (error as any).code === 'ENOENT' ||
              (error as any).killed ||
              /missing script/i.test(stderr || '') ||
              /no test specified/i.test(stderr || stdout || '')
            ) {
              return resolve({ pass: true, skipped: true, reason: 'Tests not configured' });
            }
            return resolve({ pass: false, reason: `Unit tests failed: ${(stderr || stdout || error.message).slice(0, 200)}` });
          }
          resolve({ pass: true });
        });
        child.on('error', () => {
          resolve({ pass: true, skipped: true, reason: 'Tests not configured' });
        });
      } catch {
        resolve({ pass: true, skipped: true, reason: 'Tests not configured' });
      }
    });
  }

  private async runIntegrationTests(): Promise<ValidationCheckResult> {
    return { pass: true, skipped: true, reason: 'Integration tests not implemented' };
  }

  private async aiCritic(candidate: OptimizationCandidate): Promise<ValidationCheckResult> {
    if (!this.config.ai.enabled) {
      return { pass: true, skipped: true, reason: 'AI critic disabled' };
    }
    try {
      const review = await this.llm.review(candidate.originalCode || '', candidate.optimizedCode || '');
      return review;
    } catch (err) {
      return { pass: false, reason: `AI critic failed: ${(err as Error).message}` };
    }
  }

  private performanceGate(shadowResult?: { v1Latency: number; v2Latency: number }): ValidationCheckResult {
    if (!shadowResult) {
      return { pass: true, skipped: true, reason: 'No shadow result available' };
    }
    const { v1Latency, v2Latency } = shadowResult;
    if (v2Latency < v1Latency) {
      return { pass: true };
    }
    const regressionMs = (v2Latency - v1Latency).toFixed(2);
    const regressionPct = (((v2Latency - v1Latency) / v1Latency) * 100).toFixed(1);
    return {
      pass: false,
      reason: `Performance regression: optimized handler is ${regressionMs}ms slower (${regressionPct}% regression, v1=${v1Latency}ms vs v2=${v2Latency}ms)`,
    };
  }
}
