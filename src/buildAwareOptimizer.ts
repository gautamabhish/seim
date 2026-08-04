import { BuildService, BuildResult } from './buildService';
import { Logger } from './logger';
import { SeimConfig } from './types';

export interface ChangeType {
  type: 'major' | 'minor' | 'patch';
  requiresBuild: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export class BuildAwareOptimizer {
  constructor(
    private config: SeimConfig,
    private buildService?: BuildService,
    private logger?: Logger
  ) {}

  /**
   * Analyze the type of change to determine if build is required
   */
  analyzeChangeType(originalCode: string, newCode: string): ChangeType {
    const changes = this.detectChanges(originalCode, newCode);
    
    // Major changes require build
    if (changes.hasNewDependencies || changes.hasTypeChanges || changes.hasComplexLogic) {
      return {
        type: 'major',
        requiresBuild: true,
        riskLevel: 'high'
      };
    }
    
    // Minor changes might require build depending on config
    if (changes.hasConfigurationChanges || changes.hasSimpleLogic) {
      return {
        type: 'minor',
        requiresBuild: this.config.build?.autoBuild || false,
        riskLevel: 'medium'
      };
    }
    
    // Patch changes can use sandbox
    return {
      type: 'patch',
      requiresBuild: false,
      riskLevel: 'low'
    };
  }

  /**
   * Detect what kind of changes were made
   */
  private detectChanges(originalCode: string, newCode: string): {
    hasNewDependencies: boolean;
    hasTypeChanges: boolean;
    hasComplexLogic: boolean;
    hasConfigurationChanges: boolean;
    hasSimpleLogic: boolean;
  } {
    const originalImports = this.extractImports(originalCode);
    const newImports = this.extractImports(newCode);
    
    const hasNewDependencies = newImports.length > originalImports.length;
    const hasTypeChanges = this.detectTypeChanges(originalCode, newCode);
    const hasComplexLogic = this.detectComplexLogic(newCode);
    const hasConfigurationChanges = this.detectConfigurationChanges(originalCode, newCode);
    const hasSimpleLogic = !hasComplexLogic && !hasNewDependencies;
    
    return {
      hasNewDependencies,
      hasTypeChanges,
      hasComplexLogic,
      hasConfigurationChanges,
      hasSimpleLogic
    };
  }

  /**
   * Extract import statements from code
   */
  private extractImports(code: string): string[] {
    const importRegex = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    
    return imports;
  }

  /**
   * Detect if type definitions changed
   */
  private detectTypeChanges(originalCode: string, newCode: string): boolean {
    // Simple heuristic: check for type annotations, interfaces, types
    const typeRegex = /:\s*(string|number|boolean|any|object|void|null)/g;
    const originalTypes = (originalCode.match(typeRegex) || []).length;
    const newTypes = (newCode.match(typeRegex) || []).length;
    
    return originalTypes !== newTypes;
  }

  /**
   * Detect if code has complex logic changes
   */
  private detectComplexLogic(code: string): boolean {
    // Heuristics for complexity
    const indicators = [
      /class\s+\w+/,           // Classes
      /async\s+function/,      // Async functions
      /Promise\.<.*>/,         // Generic promises
      /try\s*{.*catch/,        // Try-catch blocks
      /while\s*\(/,            // While loops
      /for\s*\(.*in/,          // For-in loops
      /function\s*\([^)]*\)\s*{[^}]*{[^}]*}/, // Nested functions
    ];
    
    for (const indicator of indicators) {
      if (indicator.test(code)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Detect configuration changes
   */
  private detectConfigurationChanges(originalCode: string, newCode: string): boolean {
    // Check for config-like changes
    const configChanges = [
      /const\s+\w+\s*=\s*{[^}]*}/, // Object assignments
      /process\.env\./,                 // Environment variables
      /config\./,                        // Config access
    ];
    
    const originalConfigCount = configChanges.reduce((count, regex) => 
      count + (originalCode.match(regex) || []).length, 0);
    const newConfigCount = configChanges.reduce((count, regex) => 
      count + (newCode.match(regex) || []).length, 0);
    
    return originalConfigCount !== newConfigCount;
  }

  /**
   * Build-aware optimization process
   */
  async optimizeWithBuild(
    originalCode: string,
    generatedCode: string,
    routeKey: string
  ): Promise<{
    success: boolean;
    optimizedCode: string;
    buildRequired: boolean;
    buildResult?: BuildResult;
    changeType: ChangeType;
  }> {
    const changeType = this.analyzeChangeType(originalCode, generatedCode);
    
    this.logger?.info('Change analysis complete', {
      routeKey,
      changeType: changeType.type,
      requiresBuild: changeType.requiresBuild,
      riskLevel: changeType.riskLevel
    });

    // If build is required and build service is available
    if (changeType.requiresBuild && this.buildService) {
      this.logger?.info('Building generated code', { routeKey });
      
      const buildResult = await this.buildService.buildCode(generatedCode, routeKey);
      
      if (buildResult.success) {
        this.logger?.info('Build successful', {
          routeKey,
          duration: buildResult.duration,
          outputPath: buildResult.outputPath
        });
        
        return {
          success: true,
          optimizedCode: generatedCode, // Built code is deployed separately
          buildRequired: true,
          buildResult,
          changeType
        };
      } else {
        this.logger?.error('Build failed', {
          routeKey,
          errors: buildResult.errors
        });
        
        return {
          success: false,
          optimizedCode: originalCode, // Fallback to original
          buildRequired: true,
          buildResult,
          changeType
        };
      }
    }
    
    // For minor changes where build is optional or build service not available
    if (changeType.requiresBuild && !this.buildService) {
      this.logger?.warn('Build required but build service not available', {
        routeKey,
        changeType: changeType.type
      });
      
      // In production, this should be an error
      if (this.config.environment === 'production') {
        return {
          success: false,
          optimizedCode: originalCode,
          buildRequired: true,
          changeType
        };
      }
    }
    
    // Sandbox-safe optimization
    return {
      success: true,
      optimizedCode: generatedCode,
      buildRequired: false,
      changeType
    };
  }

  /**
   * Validate code before building
   */
  async validateBeforeBuild(code: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    if (!this.buildService) {
      // Basic validation without build service
      try {
        new Function(code);
        return { valid: true, errors: [] };
      } catch (error) {
        return { 
          valid: false, 
          errors: [error instanceof Error ? error.message : String(error)] 
        };
      }
    }
    
    const validation = await this.buildService.validateCode(code);
    return {
      valid: validation.syntaxValid && validation.typeValid && validation.dependenciesValid,
      errors: validation.errors
    };
  }
}