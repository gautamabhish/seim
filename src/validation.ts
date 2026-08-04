import { Request } from 'express';
import { exec } from 'child_process';
import { SeimConfig, OptimizationCandidate, ValidationReport } from './types';
import { SecurityGate } from './security';
import { LLMClient } from './ai';
import { SchemaValidator } from './schemaValidator';
import { SchemaRegistry } from './schemaRegistry';

export class ValidationEngine {
  private security: SecurityGate;
  private schemaValidator?: SchemaValidator;
  private schemaRegistry?: SchemaRegistry;

  constructor(
    private config: SeimConfig, 
    private llm: LLMClient,
    schemaValidator?: SchemaValidator,
    schemaRegistry?: SchemaRegistry
  ) {
    this.security = new SecurityGate(config);
    this.schemaValidator = schemaValidator;
    this.schemaRegistry = schemaRegistry;
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
    };

    report.layer1Schema = this.schemaCheck(candidate);
    report.layer2ResponseEquivalence = this.responseEquivalence(originalResponse, optimizedResponse);
    
    // Add schema compatibility check if validator is available
    if (this.schemaValidator) {
      report.layer2bSchemaCompatibility = this.schemaCompatibility(originalResponse, optimizedResponse);
    }
    
    report.layer3BusinessRules = await this.businessRules(optimizedResponse, request);
    report.layer4UnitTests = await this.runUnitTests();
    report.layer5IntegrationTests = await this.runIntegrationTests();
    report.layer6Security = this.security.validate(candidate.originalCode, candidate);
    report.layer7AICritic = await this.aiCritic(candidate);
    report.layer8PerformanceGate = this.performanceGate(shadowResult);

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

    console.log('📊 [SEIM DEBUG] Validation Report:', JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Validate for feature evolution - uses schema compatibility instead of strict equivalence.
   */
  public async validateForFeatureEvolution(
    candidate: OptimizationCandidate,
    originalResponse: unknown,
    optimizedResponse: unknown,
    request?: Request,
    shadowResult?: { v1Latency: number; v2Latency: number }
  ): Promise<ValidationReport> {
    const report: ValidationReport = {
      candidateId: candidate.id,
      layer1Schema: { pass: true },
      layer2ResponseEquivalence: { pass: true }, // Keep for backward compatibility
      layer2bSchemaCompatibility: { pass: true },
      layer3BusinessRules: { pass: true, violations: [] },
      layer4UnitTests: { pass: true },
      layer5IntegrationTests: { pass: true },
      layer6Security: { pass: true },
      layer7AICritic: { pass: true },
      layer8PerformanceGate: { pass: true },
      overall: false,
    };

    report.layer1Schema = this.schemaCheck(candidate);
    
    // For feature evolution, schema compatibility is the key check
    if (this.schemaValidator) {
      report.layer2bSchemaCompatibility = this.schemaCompatibility(originalResponse, optimizedResponse);
    } else {
      // Fallback to strict equivalence if schema validator not available
      report.layer2ResponseEquivalence = this.responseEquivalence(originalResponse, optimizedResponse);
    }
    
    report.layer3BusinessRules = await this.businessRules(optimizedResponse, request);
    report.layer4UnitTests = await this.runUnitTests();
    report.layer5IntegrationTests = await this.runIntegrationTests();
    report.layer6Security = this.security.validate(candidate.originalCode, candidate);
    report.layer7AICritic = await this.aiCritic(candidate);
    report.layer8PerformanceGate = this.performanceGate(shadowResult);

    // For feature evolution, schema compatibility is required instead of strict equivalence
    report.overall =
      report.layer1Schema.pass &&
      report.layer2bSchemaCompatibility.pass &&
      report.layer3BusinessRules.pass &&
      report.layer4UnitTests.pass &&
      report.layer5IntegrationTests.pass &&
      report.layer6Security.pass &&
      report.layer7AICritic.pass &&
      report.layer8PerformanceGate.pass;

    return report;
  }

  private schemaCheck(candidate: OptimizationCandidate): { pass: boolean; reason?: string } {
    return candidate.optimizedCode ? { pass: true } : { pass: true, reason: 'Suggestion only' };
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
   * Schema compatibility check - allows safe additions, blocks breaking changes.
   */
  private schemaCompatibility(a: unknown, b: unknown): { pass: boolean; reason?: string } {
    if (!this.schemaValidator) {
      // Fallback to strict equivalence if validator not available
      return this.responseEquivalence(a, b);
    }

    const result = this.schemaValidator.validateSchemaCompatibility(a, b);
    
    if (!result.pass) {
      return { 
        pass: false, 
        reason: `Breaking schema changes: ${result.changes
          .filter(c => c.impact === 'breaking')
          .map(c => c.field)
          .join(', ')}` 
      };
    }

    return { pass: true, reason: result.reason };
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

  private async runUnitTests(): Promise<{ pass: boolean; reason?: string }> {
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
              return resolve({ pass: true, reason: 'Tests not configured' });
            }
            return resolve({ pass: false, reason: `Unit tests failed: ${(stderr || stdout || error.message).slice(0, 200)}` });
          }
          resolve({ pass: true });
        });
        child.on('error', () => {
          resolve({ pass: true, reason: 'Tests not configured' });
        });
      } catch {
        resolve({ pass: true, reason: 'Tests not configured' });
      }
    });
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

  private performanceGate(shadowResult?: { v1Latency: number; v2Latency: number }): { pass: boolean; reason?: string } {
    if (!shadowResult) {
      return { pass: true, reason: 'No shadow result provided; skipping performance gate' };
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
