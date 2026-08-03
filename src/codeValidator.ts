import { Logger } from './logger';
import { SeimConfig } from './types';

export interface ValidationResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
  score: number; // 0-100
}

export class CodeValidator {
  private readonly dangerousPatterns: RegExp[] = [
    // Security issues
    /eval\s*\(/gi,
    /innerHTML\s*=/gi,
    /document\.write\s*\(/gi,
    /dangerouslySetInnerHTML/gi,
    /Function\s*\(/gi,
    
    // External network calls (should be prohibited)
    /fetch\s*\(/gi,
    /axios\./gi,
    /XMLHttpRequest/gi,
    
    // File system access
    /fs\./gi,
    /require\s*\(\s*['"]fs['"]\s*\)/gi,
    
    // Child process
    /child_process/gi,
    /exec\s*\(/gi,
    /spawn\s*\(/gi,
    
    // Secret access patterns
    /process\.env/gi,
    /process\.env\./gi,
    
    // Database operations
    /db\./gi,
    /sequelize\./gi,
    /mongoose\./gi,
    /knex\./gi,
  ];

  private readonly frontendSpecificPatterns: {
    dangerous: RegExp[];
    warning: RegExp[];
  } = {
    dangerous: [
      // XSS risks
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // onclick, onload, etc.
      
      // unsafe React patterns
      /dangerouslySetInnerHTML/gi,
    ],
    warning: [
      // Performance warnings
      /useEffect\s*\([^,]*,\s*\[\]\s*\)/gi, // Missing dependencies
      /\.map\s*\([^)]*\)\s*=>\s*<[^>]+[^/>]$/gi, // Missing key prop
    ]
  };

  constructor(
    private config: SeimConfig,
    private logger: Logger
  ) {}

  /**
   * Validate backend middleware code
   */
  validateBackendCode(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        errors.push(`Dangerous pattern detected: ${pattern.source} found ${matches.length} time(s)`);
      }
    }

    // Check for authentication/authorization modifications
    if (this.modifiesAuthLogic(code)) {
      errors.push('Code modifies authentication or authorization logic');
    }

    // Check for payment logic modifications
    if (this.modifiesPaymentLogic(code)) {
      errors.push('Code modifies payment logic');
    }

    // Check for secret leakage
    if (this.leaksSecrets(code)) {
      errors.push('Code may leak secrets or sensitive data');
    }

    // Check for proper error handling
    if (!this.hasErrorHandling(code)) {
      warnings.push('Code lacks proper error handling');
    }

    // Check for proper async/await usage
    if (this.hasAsyncWithoutAwait(code)) {
      warnings.push('Code has async functions without proper await');
    }

    const score = this.calculateScore(errors, warnings);

    return {
      pass: errors.length === 0,
      errors,
      warnings,
      score
    };
  }

  /**
   * Validate frontend component code
   */
  validateFrontendCode(code: string, framework: string = 'react'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Run backend validation first
    const backendResult = this.validateBackendCode(code);
    errors.push(...backendResult.errors);
    warnings.push(...backendResult.warnings);

    // Framework-specific validation
    if (framework === 'react') {
      this.validateReactCode(code, errors, warnings);
    } else if (framework === 'vue') {
      this.validateVueCode(code, errors, warnings);
    } else if (framework === 'angular') {
      this.validateAngularCode(code, errors, warnings);
    }

    // Check for frontend-specific dangerous patterns
    for (const pattern of this.frontendSpecificPatterns.dangerous) {
      const matches = code.match(pattern);
      if (matches) {
        errors.push(`Frontend security risk: ${pattern.source} found ${matches.length} time(s)`);
      }
    }

    // Check for frontend-specific warnings
    for (const pattern of this.frontendSpecificPatterns.warning) {
      const matches = code.match(pattern);
      if (matches) {
        warnings.push(`Frontend best practice warning: ${pattern.source} found ${matches.length} time(s)`);
      }
    }

    const score = this.calculateScore(errors, warnings);

    return {
      pass: errors.length === 0,
      errors,
      warnings,
      score
    };
  }

  /**
   * Validate React-specific code
   */
  private validateReactCode(code: string, errors: string[], warnings: string[]): void {
    // Check for missing key props in lists
    const mapWithoutKey = /\.map\s*\([^)]*\)\s*=>\s*<[^>]+[^/>]$/gi;
    if (mapWithoutKey.test(code)) {
      warnings.push('React map() may be missing key prop');
    }

    // Check for useEffect dependency issues
    const useEffectWithEmptyDeps = /useEffect\s*\([^,]*,\s*\[\]\s*\)/gi;
    if (useEffectWithEmptyDeps.test(code)) {
      warnings.push('useEffect with empty dependencies may have stale closure issues');
    }

    // Check for direct state mutations
    const directStateMutation = /setState\s*\([^)]*\)\s*[^=]*=\s*[^;]+;/gi;
    if (directStateMutation.test(code)) {
      errors.push('Direct state mutation detected in React component');
    }

    // Check for proper component structure
    if (!code.includes('return') && !code.includes('=>')) {
      warnings.push('React component may not have proper return statement');
    }
  }

  /**
   * Validate Vue-specific code
   */
  private validateVueCode(code: string, errors: string[], warnings: string[]): void {
    // Check for v-for without key
    const vForWithoutKey = /v-for\s*=[^>]+(?<!key\s*=)/gi;
    if (vForWithoutKey.test(code)) {
      warnings.push('v-for directive may be missing :key attribute');
    }

    // Check for direct prop mutations
    const propMutation = /props\.[^=]+\s*=/gi;
    if (propMutation.test(code)) {
      errors.push('Direct prop mutation detected in Vue component');
    }
  }

  /**
   * Validate Angular-specific code
   */
  private validateAngularCode(code: string, errors: string[], warnings: string[]): void {
    // Check for *ngFor without trackBy
    const ngForWithoutTrackBy = /\*ngFor[^>]+(?<!trackBy)/gi;
    if (ngForWithoutTrackBy.test(code)) {
      warnings.push('*ngFor may be missing trackBy function');
    }

    // Check for direct input mutations
    const inputMutation = /@Input\(\)[^;]+;[^;]*@Input\(\)[^;]*\s*=/gi;
    if (inputMutation.test(code)) {
      errors.push('Direct @Input mutation detected in Angular component');
    }
  }

  /**
   * Check if code modifies authentication logic
   */
  private modifiesAuthLogic(code: string): boolean {
    const authPatterns = [
      /auth/gi,
      /authenticate/gi,
      /authorization/gi,
      /login/gi,
      /logout/gi,
      /session/gi,
      /jwt/gi,
      /token/gi,
      /passport/gi,
    ];

    // Check if code modifies these patterns (assignments, function calls)
    for (const pattern of authPatterns) {
      const regex = new RegExp(`${pattern.source}\\s*(=|\\()`, 'gi');
      if (regex.test(code)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if code modifies payment logic
   */
  private modifiesPaymentLogic(code: string): boolean {
    const paymentPatterns = [
      /payment/gi,
      /charge/gi,
      /refund/gi,
      /stripe/gi,
      /paypal/gi,
      /billing/gi,
      /invoice/gi,
      /subscription/gi,
    ];

    for (const pattern of paymentPatterns) {
      const regex = new RegExp(`${pattern.source}\\s*(=|\\()`, 'gi');
      if (regex.test(code)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if code leaks secrets
   */
  private leaksSecrets(code: string): boolean {
    const secretPatterns = [
      /console\.log\s*\(\s*process\.env/gi,
      /console\.log\s*\(\s*[^)]*password/gi,
      /console\.log\s*\(\s*[^)]*secret/gi,
      /console\.log\s*\(\s*[^)]*api[_-]?key/gi,
      /console\.log\s*\(\s*[^)]*token/gi,
    ];

    for (const pattern of secretPatterns) {
      if (pattern.test(code)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if code has error handling
   */
  private hasErrorHandling(code: string): boolean {
    return /try\s*\{/.test(code) || /catch\s*\(/.test(code) || /\.catch\s*\(/.test(code);
  }

  /**
   * Check if code has async without await
   */
  private hasAsyncWithoutAwait(code: string): boolean {
    const asyncFunctions = code.match(/async\s+\w+\s*\([^)]*\)\s*{/gi) || [];
    for (const func of asyncFunctions) {
      const funcBody = code.substring(code.indexOf(func) + func.length);
      if (!/await\s/.test(funcBody)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate validation score
   */
  private calculateScore(errors: string[], warnings: string[]): number {
    let score = 100;
    score -= errors.length * 25; // Each error reduces score by 25
    score -= warnings.length * 5; // Each warning reduces score by 5
    return Math.max(0, score);
  }

  /**
   * Validate code with custom rules
   */
  validateWithCustomRules(code: string, customRules: RegExp[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of customRules) {
      const matches = code.match(rule);
      if (matches) {
        errors.push(`Custom rule violation: ${rule.source} found ${matches.length} time(s)`);
      }
    }

    const score = this.calculateScore(errors, warnings);

    return {
      pass: errors.length === 0,
      errors,
      warnings,
      score
    };
  }

  /**
   * Get validation statistics
   */
  getStats(): {
    dangerousPatternsCount: number;
    frontendPatternsCount: number;
  } {
    return {
      dangerousPatternsCount: this.dangerousPatterns.length,
      frontendPatternsCount: this.frontendSpecificPatterns.dangerous.length + this.frontendSpecificPatterns.warning.length
    };
  }
}