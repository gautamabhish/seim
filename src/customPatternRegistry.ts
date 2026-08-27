export interface PatternDetector {
  detect(sourceCode: string): boolean;
  getMatch?(sourceCode: string): string | null;
}

export interface PatternFixer {
  fix(sourceCode: string): string | undefined;
}

export interface CustomPattern {
  id: string;
  name: string;
  description: string;
  examples?: string[];
  goodExamples?: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  detector: PatternDetector;
  fixer?: PatternFixer;
  tags?: string[];
  useAI?: boolean;
  createdBy?: string;
  registeredAt: number;
}

export class CustomPatternRegistry {
  private patterns: Map<string, CustomPattern> = new Map();

  public register(pattern: Omit<CustomPattern, 'registeredAt'>): void {
    if (this.patterns.has(pattern.id)) {
      throw new Error(`Pattern with ID '${pattern.id}' already exists.`);
    }
    this.patterns.set(pattern.id, {
      ...pattern,
      registeredAt: Date.now(),
    });
  }

  public registerRegex(
    id: string,
    name: string,
    description: string,
    severity: CustomPattern['severity'],
    detectRegex: RegExp,
    fixTransform?: (source: string, match: RegExpMatchArray) => string,
    options?: { tags?: string[]; useAI?: boolean; examples?: string[]; goodExamples?: string[]; createdBy?: string }
  ): void {
    this.register({
      id,
      name,
      description,
      severity,
      ...(options || {}),
      detector: {
        detect: (src: string) => detectRegex.test(src),
        getMatch: (src: string) => {
          const m = src.match(detectRegex);
          return m ? m[0] : null;
        }
      },
      fixer: fixTransform ? {
        fix: (src: string) => {
          const m = src.match(detectRegex);
          if (m) {
            return fixTransform(src, m);
          }
          return undefined;
        }
      } : undefined
    });
  }

  public update(id: string, updates: Partial<Omit<CustomPattern, 'id' | 'registeredAt'>>): boolean {
    const existing = this.patterns.get(id);
    if (!existing) return false;
    
    this.patterns.set(id, {
      ...existing,
      ...updates
    });
    return true;
  }

  public remove(id: string): boolean {
    return this.patterns.delete(id);
  }

  public get(id: string): CustomPattern | undefined {
    return this.patterns.get(id);
  }

  public getAll(): CustomPattern[] {
    return Array.from(this.patterns.values());
  }

  public scan(sourceCode: string): { pattern: CustomPattern; match: string | null }[] {
    const matches: { pattern: CustomPattern; match: string | null }[] = [];
    for (const pattern of this.patterns.values()) {
      if (pattern.detector.detect(sourceCode)) {
        const match = pattern.detector.getMatch ? pattern.detector.getMatch(sourceCode) : null;
        matches.push({ pattern, match });
      }
    }
    return matches;
  }

  public applyFixes(sourceCode: string): { code: string; appliedFixes: string[] } {
    let currentCode = sourceCode;
    const appliedFixes: string[] = [];

    const severities: Record<CustomPattern['severity'], number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    const sortedPatterns = Array.from(this.patterns.values()).sort((a, b) => {
      return severities[b.severity] - severities[a.severity];
    });

    for (const pattern of sortedPatterns) {
      if (pattern.detector.detect(currentCode)) {
        if (pattern.fixer) {
          const fixed = pattern.fixer.fix(currentCode);
          if (fixed !== undefined && fixed !== currentCode) {
            currentCode = fixed;
            appliedFixes.push(pattern.id);
          }
        } else if (pattern.useAI) {
          const match = pattern.detector.getMatch ? pattern.detector.getMatch(currentCode) : null;
          if (match) {
            currentCode = currentCode.replace(match, `// [SEIM TODO: AI fix needed for ${pattern.id}]\n${match}`);
          } else {
            currentCode = `// [SEIM TODO: AI fix needed for ${pattern.id}]\n` + currentCode;
          }
          appliedFixes.push(pattern.id);
        }
      }
    }

    return { code: currentCode, appliedFixes };
  }

  public getByTag(tag: string): CustomPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.tags && p.tags.includes(tag));
  }

  public getBySeverity(severity: CustomPattern['severity']): CustomPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.severity === severity);
  }

  public export(): Record<string, Omit<CustomPattern, 'detector' | 'fixer'>>[] {
    return Array.from(this.patterns.values()).map(pattern => {
      const { detector, fixer, ...rest } = pattern;
      return rest as Record<string, any>;
    });
  }
}
