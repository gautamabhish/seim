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

    if (this.config.security.blockAuthenticationChanges && this.touches(oldCode, newCode, AUTH_KEYWORDS)) {
      return { pass: false, reason: 'Authentication-related code cannot be modified' };
    }
    if (this.config.security.blockAuthorizationChanges && this.touches(oldCode, newCode, AUTHORIZATION_KEYWORDS)) {
      return { pass: false, reason: 'Authorization-related code cannot be modified' };
    }
    if (this.config.security.blockPaymentChanges && this.touches(oldCode, newCode, PAYMENT_KEYWORDS)) {
      return { pass: false, reason: 'Payment-related code cannot be modified' };
    }
    if (this.config.security.blockSecretUsage && this.introducesSecret(newCode)) {
      return { pass: false, reason: 'Generated code may leak or expose secrets' };
    }
    if (!this.config.security.allowedPatternModels.includes(candidate.pattern)) {
      return { pass: false, reason: `Optimization pattern ${candidate.pattern} is not allowed` };
    }

    for (const rule of this.config.securityRules ?? []) {
      const result = rule(oldCode, newCode);
      if (!result.pass) return result;
    }

    return { pass: true };
  }

  private touches(oldCode: string, newCode: string, keywords: string[]): boolean {
    const oldContains = this.containsAny(oldCode, keywords);
    const newContains = this.containsAny(newCode, keywords);
    return oldContains || newContains;
  }

  private introducesSecret(code: string): boolean {
    const suspicious = /process\.env\.[A-Z_]*(?:SECRET|KEY|PASSWORD|TOKEN)/i;
    const hasSuspicious = suspicious.test(code);
    const hasHardcoded = /(?:password|secret|token)\s*[:=]\s*['"`][^'"`]+['"`]/i.test(code);
    return hasSuspicious || hasHardcoded;
  }

  private containsAny(code: string, keywords: string[]): boolean {
    const lower = code.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  }
}
