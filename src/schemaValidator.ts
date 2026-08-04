export interface SchemaChange {
  type: 'field_added' | 'field_removed' | 'field_renamed' | 'type_changed';
  field: string;
  impact: 'breaking' | 'safe' | 'risky';
  oldValue?: any;
  newValue?: any;
}

export interface SchemaCompatibility {
  pass: boolean;
  reason?: string;
  changes: SchemaChange[];
}

export class SchemaValidator {
  /**
   * Validate that an evolved schema is compatible with the original.
   * Allows safe additions, blocks breaking changes.
   */
  validateSchemaCompatibility(original: any, evolved: any): SchemaCompatibility {
    const changes = this.detectSchemaChanges(original, evolved);
    const breakingChanges = changes.filter(c => c.impact === 'breaking');
    const riskyChanges = changes.filter(c => c.impact === 'risky');

    if (breakingChanges.length > 0) {
      return {
        pass: false,
        reason: `Breaking changes detected: ${breakingChanges.map(c => c.field).join(', ')}`,
        changes
      };
    }

    if (riskyChanges.length > 0) {
      return {
        pass: true,
        reason: `Compatible with ${riskyChanges.length} risky type changes`,
        changes
      };
    }

    return {
      pass: true,
      reason: 'Schema compatible (safe additions only)',
      changes
    };
  }

  /**
   * Detect all schema changes between original and evolved versions.
   */
  private detectSchemaChanges(original: any, evolved: any): SchemaChange[] {
    const changes: SchemaChange[] = [];

    // Handle null/undefined cases
    if (!original || !evolved) {
      return changes;
    }

    // Check for added fields (safe)
    for (const key in evolved) {
      if (!(key in original)) {
        changes.push({
          type: 'field_added',
          field: key,
          impact: 'safe',
          newValue: evolved[key]
        });
      }
    }

    // Check for removed fields (breaking)
    for (const key in original) {
      if (!(key in evolved)) {
        changes.push({
          type: 'field_removed',
          field: key,
          impact: 'breaking',
          oldValue: original[key]
        });
      }
    }

    // Check for type changes (risky)
    for (const key in original) {
      if (key in evolved) {
        const originalType = this.getType(original[key]);
        const evolvedType = this.getType(evolved[key]);
        
        if (originalType !== evolvedType) {
          // Some type changes are safe (e.g., number -> string for display)
          if (this.isSafeTypeChange(originalType, evolvedType)) {
            changes.push({
              type: 'type_changed',
              field: key,
              impact: 'safe',
              oldValue: original[key],
              newValue: evolved[key]
            });
          } else {
            changes.push({
              type: 'type_changed',
              field: key,
              impact: 'risky',
              oldValue: original[key],
              newValue: evolved[key]
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Get the type of a value for comparison.
   */
  private getType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Determine if a type change is safe for display purposes.
   */
  private isSafeTypeChange(from: string, to: string): boolean {
    // Safe conversions for display purposes
    const safeConversions = [
      ['number', 'string'],  // Numbers can be safely converted to strings
      ['boolean', 'string'], // Booleans can be safely converted to strings
    ];

    return safeConversions.some(([f, t]) => f === from && t === to);
  }

  /**
   * Validate that a specific field can be safely added.
   */
  canAddField(original: any, fieldName: string, fieldType: string): boolean {
    // If field already exists, check if type change is safe
    if (fieldName in original) {
      const existingType = this.getType(original[fieldName]);
      return this.isSafeTypeChange(existingType, fieldType);
    }

    // New field is always safe to add
    return true;
  }

  /**
   * Generate a schema compatibility report for logging.
   */
  generateReport(original: any, evolved: any): string {
    const result = this.validateSchemaCompatibility(original, evolved);
    
    let report = `Schema Validation: ${result.pass ? 'PASS' : 'FAIL'}\n`;
    report += `Reason: ${result.reason}\n`;
    report += `Changes detected: ${result.changes.length}\n`;
    
    if (result.changes.length > 0) {
      report += '\nChange Details:\n';
      result.changes.forEach(change => {
        report += `  - ${change.type}: ${change.field} (${change.impact})\n`;
      });
    }

    return report;
  }
}