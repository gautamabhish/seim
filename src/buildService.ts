import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const exec = promisify(require('child_process').exec);

export interface BuildConfig {
  buildCommand: string;
  outputDir: string;
  sourceDir: string;
  typescript: boolean;
  minify: boolean;
  sourcemap: boolean;
}

export interface BuildResult {
  success: boolean;
  output: string;
  errors: string[];
  outputPath: string;
  duration: number;
}

export class BuildService {
  private buildQueue: Map<string, Promise<BuildResult>> = new Map();
  private artifactRegistry: Map<string, string> = new Map();
  private buildStats: { totalBuilds: number; successfulBuilds: number; failedBuilds: number } = {
    totalBuilds: 0,
    successfulBuilds: 0,
    failedBuilds: 0
  };

  constructor(private config: BuildConfig) {}

  /**
   * Build code asynchronously in background (non-blocking)
   */
  async buildCodeAsync(generatedCode: string, routeKey: string): Promise<BuildResult> {
    // Check if already building this route
    if (this.buildQueue.has(routeKey)) {
      return this.buildQueue.get(routeKey)!;
    }

    // Start build in background
    const buildPromise = this.buildCode(generatedCode, routeKey);
    this.buildQueue.set(routeKey, buildPromise);

    // Clean up queue when complete
    buildPromise.finally(() => {
      this.buildQueue.delete(routeKey);
    });

    return buildPromise;
  }

  /**
   * Check if a build is in progress
   */
  isBuilding(routeKey: string): boolean {
    return this.buildQueue.has(routeKey);
  }

  /**
   * Check if optimized artifact is ready
   */
  isArtifactReady(routeKey: string): boolean {
    return this.artifactRegistry.has(routeKey);
  }

  /**
   * Get artifact path if ready
   */
  getArtifactPath(routeKey: string): string | null {
    return this.artifactRegistry.get(routeKey) || null;
  }

  /**
   * Build generated code using project's build system
   */
  async buildCode(generatedCode: string, routeKey: string): Promise<BuildResult> {
    const startTime = Date.now();
    const tempFile = path.join(this.config.sourceDir, `temp_${routeKey.replace(/[^a-zA-Z0-9]/g, '_')}.ts`);
    
    this.buildStats.totalBuilds++;
    
    try {
      // 1. Write generated code to temporary file
      await fs.writeFile(tempFile, generatedCode, 'utf8');
      
      // 2. Run build process
      const buildOutput = await this.runBuild();
      
      // 3. Copy built artifact to output location
      const outputPath = await this.copyBuildArtifact(routeKey);
      
      // 4. Register artifact for deployment
      this.artifactRegistry.set(routeKey, outputPath);
      
      // 5. Clean up temporary file
      await fs.unlink(tempFile);
      
      this.buildStats.successfulBuilds++;
      
      return {
        success: true,
        output: buildOutput.stdout,
        errors: [],
        outputPath,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(tempFile);
      } catch {}
      
      this.buildStats.failedBuilds++;
      
      return {
        success: false,
        output: '',
        errors: [error instanceof Error ? error.message : String(error)],
        outputPath: '',
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Run the project's build command
   */
  private async runBuild(): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await exec(this.config.buildCommand, {
        cwd: process.cwd(),
        timeout: 60000 // 60 second timeout
      });
      
      return { stdout, stderr };
    } catch (error: any) {
      throw new Error(`Build failed: ${error.message}`);
    }
  }

  /**
   * Copy built artifact to output location
   */
  private async copyBuildArtifact(routeKey: string): Promise<string> {
    const outputFilename = `${routeKey.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
    const outputPath = path.join(this.config.outputDir, outputFilename);
    
    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });
    
    // Assuming build output is in dist/
    const sourcePath = path.join('dist', outputFilename);
    
    try {
      await fs.copyFile(sourcePath, outputPath);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to copy build artifact: ${error}`);
    }
  }

  /**
   * Type-check generated code without building
   */
  async typeCheck(code: string): Promise<{ valid: boolean; errors: string[] }> {
    const tempFile = path.join(this.config.sourceDir, `temp_typecheck_${Date.now()}.ts`);
    
    try {
      await fs.writeFile(tempFile, code, 'utf8');
      
      const { stdout, stderr } = await exec('npx tsc --noEmit', {
        cwd: process.cwd(),
        timeout: 30000
      });
      
      await fs.unlink(tempFile);
      
      return {
        valid: true,
        errors: []
      };
    } catch (error: any) {
      await fs.unlink(tempFile).catch(() => {});
      
      return {
        valid: false,
        errors: [error.message || 'Type check failed']
      };
    }
  }

  /**
   * Validate generated code before building
   */
  async validateCode(code: string): Promise<{
    syntaxValid: boolean;
    typeValid: boolean;
    dependenciesValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    // 1. Syntax validation
    try {
      // Basic syntax check by attempting to parse
      new Function(code);
    } catch (error) {
      errors.push(`Syntax error: ${error}`);
      return {
        syntaxValid: false,
        typeValid: false,
        dependenciesValid: false,
        errors
      };
    }
    
    // 2. Type validation (if TypeScript enabled)
    let typeValid = true;
    if (this.config.typescript) {
      const typeCheck = await this.typeCheck(code);
      if (!typeCheck.valid) {
        typeValid = false;
        errors.push(...typeCheck.errors);
      }
    }
    
    // 3. Dependency validation
    const dependenciesValid = await this.validateDependencies(code);
    if (!dependenciesValid) {
      errors.push('Invalid or missing dependencies');
    }
    
    return {
      syntaxValid: true,
      typeValid,
      dependenciesValid,
      errors
    };
  }

  /**
   * Validate that all required dependencies are available
   */
  private async validateDependencies(code: string): Promise<boolean> {
    // Extract import statements
    const importRegex = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    
    // Check if imports are node_modules or project files
    for (const imp of imports) {
      if (imp.startsWith('.')) {
        // Relative import - check if file exists
        const filePath = path.join(this.config.sourceDir, imp);
        try {
          await fs.access(filePath);
        } catch {
          return false;
        }
      } else {
        // Node module - check if installed
        const modulePath = path.join('node_modules', imp);
        try {
          await fs.access(modulePath);
        } catch {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Get build statistics
   */
  getBuildStats(): {
    lastBuildTime: number;
    totalBuilds: number;
    successfulBuilds: number;
    failedBuilds: number;
    successRate: number;
  } {
    const successRate = this.buildStats.totalBuilds > 0 
      ? (this.buildStats.successfulBuilds / this.buildStats.totalBuilds) * 100 
      : 0;
    
    return {
      lastBuildTime: Date.now(),
      totalBuilds: this.buildStats.totalBuilds,
      successfulBuilds: this.buildStats.successfulBuilds,
      failedBuilds: this.buildStats.failedBuilds,
      successRate
    };
  }

  /**
   * Clear build queue and artifacts (for testing/reset)
   */
  clear(): void {
    this.buildQueue.clear();
    this.artifactRegistry.clear();
    this.buildStats = {
      totalBuilds: 0,
      successfulBuilds: 0,
      failedBuilds: 0
    };
  }
}