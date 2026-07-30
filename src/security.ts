import { SeimConfig, OptimizationCandidate } from './types';

const AUTH_KEYWORDS = ['login', 'logout', 'authenticate', 'auth', 'token', 'session', 'jwt', 'passport'];
const AUTHORIZATION_KEYWORDS = ['authorize', 'roles', 'permissions', 'acl', 'rbac', 'admin', 'owner', 'access'];
const PAYMENT_KEYWORDS = ['payment', 'billing', 'charge', 'invoice', 'card', 'stripe', 'paypal', 'wallet'];
const SECRET_KEYWORDS = ['password', 'secret', 'api_key', 'apikey', 'private_key', 'token', 'credentials'];

export class SecurityGate {
  constructor(private config: SeimConfig) {}

  public validate(oldCode: string, candidate: OptimizationCandidate): { pass: boolean; reason?: string } {
    if (!this.config.security) return { pass: true };

    const newCode = candidate.optimizedCode || '';

    // Diff-based analysis: only check lines that actually changed
    const diff = this.computeDiff(oldCode, newCode);

    if (this.config.security.blockAuthenticationChanges && this.diffTouches(diff, AUTH_KEYWORDS)) {
      return { pass: false, reason: 'Optimization modifies authentication-related code' };
    }
    if (this.config.security.blockAuthorizationChanges && this.diffTouches(diff, AUTHORIZATION_KEYWORDS)) {
      return { pass: false, reason: 'Optimization modifies authorization-related code' };
    }
    if (this.config.security.blockPaymentChanges && this.diffTouches(diff, PAYMENT_KEYWORDS)) {
      return { pass: false, reason: 'Optimization modifies payment-related code' };
    }
    if (this.config.security.blockSecretUsage && this.introducesSecret(newCode)) {
      return { pass: false, reason: 'Generated code may leak or expose secrets' };
    }
    if (!this.config.security.allowedPatternModels.includes(candidate.pattern)) {
      return { pass: false, reason: `Optimization pattern ${candidate.pattern} is not allowed` };
    }

    // Structural safety checks
    const structuralResult = this.structuralSafetyCheck(oldCode, newCode);
    if (!structuralResult.pass) return structuralResult;

    for (const rule of this.config.securityRules ?? []) {
      const result = rule(oldCode, newCode);
      if (!result.pass) return result;
    }

    return { pass: true };
  }

  /**
   * Compute the diff between old and new code — returns only changed lines.
   */
  private computeDiff(oldCode: string, newCode: string): { added: string[]; removed: string[] } {
    const oldLines = new Set(oldCode.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = new Set(newCode.split('\n').map(l => l.trim()).filter(Boolean));

    const added: string[] = [];
    const removed: string[] = [];

    for (const line of newLines) {
      if (!oldLines.has(line)) added.push(line);
    }
    for (const line of oldLines) {
      if (!newLines.has(line)) removed.push(line);
    }

    return { added, removed };
  }

  /**
   * Check if the diff (changed lines only) touches any sensitive keywords.
   * This dramatically reduces false positives vs checking the entire code.
   */
  private diffTouches(diff: { added: string[]; removed: string[] }, keywords: string[]): boolean {
    const changedText = [...diff.added, ...diff.removed].join('\n').toLowerCase();
    // Skip comment-only matches
    const nonCommentLines = changedText.split('\n').filter(l => {
      const trimmed = l.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    }).join('\n');
    return keywords.some(k => nonCommentLines.includes(k.toLowerCase()));
  }

  /**
   * Structural safety checks:
   * - Did the optimization remove error handling?
   * - Did it remove null/undefined checks?
   * - Did it remove input validation?
   */
  private structuralSafetyCheck(oldCode: string, newCode: string): { pass: boolean; reason?: string } {
    // Check for removed try/catch blocks
    const oldTryCatch = (oldCode.match(/try\s*\{/g) || []).length;
    const newTryCatch = (newCode.match(/try\s*\{/g) || []).length;
    if (newTryCatch < oldTryCatch) {
      return { pass: false, reason: `Optimization removed ${oldTryCatch - newTryCatch} try/catch block(s)` };
    }

    // Check for removed null checks (if (x != null), if (x !== undefined), x?.y)
    const oldNullChecks = (oldCode.match(/!==?\s*(?:null|undefined)|if\s*\(\s*!\s*\w+\s*\)|\?\./g) || []).length;
    const newNullChecks = (newCode.match(/!==?\s*(?:null|undefined)|if\s*\(\s*!\s*\w+\s*\)|\?\./g) || []).length;
    if (newNullChecks < oldNullChecks - 1) {
      // Allow removing one null check (might be redundant), but flag removing 2+
      return { pass: false, reason: `Optimization removed ${oldNullChecks - newNullChecks} null/safety check(s)` };
    }

    // Check for removed input validation
    const oldValidation = (oldCode.match(/\.trim\(\)|\.length\s*[<>=]|typeof\s+\w+\s*[!=]==?\s*['"`]|isNaN\(|isFinite\(/g) || []).length;
    const newValidation = (newCode.match(/\.trim\(\)|\.length\s*[<>=]|typeof\s+\w+\s*[!=]==?\s*['"`]|isNaN\(|isFinite\(/g) || []).length;
    if (newValidation < oldValidation - 1) {
      return { pass: false, reason: `Optimization removed ${oldValidation - newValidation} input validation check(s)` };
    }

    return { pass: true };
  }

  private introducesSecret(code: string): boolean {
    const suspicious = /process\.env\.[A-Z_]*(?:SECRET|KEY|PASSWORD|TOKEN)/i;
    const hasSuspicious = suspicious.test(code);
    const hasHardcoded = /(?:password|secret|token)\s*[:=]\s*['"`][^'"`]+['"`]/i.test(code);
    return hasSuspicious || hasHardcoded;
  }
}
