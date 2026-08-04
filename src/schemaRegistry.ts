import { SchemaValidator, SchemaCompatibility } from './schemaValidator';

export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ValidationResult {
  pass: boolean;
  reason?: string;
  schemaChanges?: SchemaCompatibility;
}

export interface SchemaRecord {
  routeKey: string;
  schema: JSONSchema;
  sampleResponse: any;
  registeredAt: number;
  lastEvolvedAt?: number;
  evolutionCount: number;
}

export class SchemaRegistry {
  private schemas: Map<string, SchemaRecord> = new Map();
  private schemaValidator: SchemaValidator;
  private persistencePath?: string;

  constructor(persistencePath?: string) {
    this.schemaValidator = new SchemaValidator();
    this.persistencePath = persistencePath;
    if (persistencePath) {
      this.load();
    }
  }

  /**
   * Register a schema for a specific route.
   */
  registerSchema(routeKey: string, schema: JSONSchema, sampleResponse?: any): void {
    const record: SchemaRecord = {
      routeKey,
      schema,
      sampleResponse: sampleResponse || this.generateSampleFromSchema(schema),
      registeredAt: Date.now(),
      evolutionCount: 0
    };

    this.schemas.set(routeKey, record);
    this.save();
  }

  /**
   * Validate that an evolved response is compatible with the registered schema.
   */
  validateEvolution(routeKey: string, evolvedResponse: any): ValidationResult {
    const record = this.schemas.get(routeKey);
    
    if (!record) {
      // No schema registered, allow evolution but warn
      return {
        pass: true,
        reason: 'No original schema registered for validation'
      };
    }

    // Check schema compatibility
    const schemaChanges = this.schemaValidator.validateSchemaCompatibility(
      record.sampleResponse,
      evolvedResponse
    );

    if (!schemaChanges.pass) {
      return {
        pass: false,
        reason: schemaChanges.reason,
        schemaChanges
      };
    }

    // Validate against JSON schema if available
    const schemaValidation = this.validateAgainstSchema(evolvedResponse, record.schema);
    
    if (!schemaValidation.pass) {
      return {
        pass: false,
        reason: `Schema validation failed: ${schemaValidation.reason}`,
        schemaChanges
      };
    }

    // Update the record if evolution is valid
    record.sampleResponse = evolvedResponse;
    record.lastEvolvedAt = Date.now();
    record.evolutionCount++;
    this.schemas.set(routeKey, record);
    this.save();

    return {
      pass: true,
      reason: 'Evolution validated successfully',
      schemaChanges
    };
  }

  /**
   * Get the registered schema for a route.
   */
  getSchema(routeKey: string): SchemaRecord | undefined {
    return this.schemas.get(routeKey);
  }

  /**
   * Get all registered schemas.
   */
  getAllSchemas(): SchemaRecord[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Remove a schema from the registry.
   */
  removeSchema(routeKey: string): boolean {
    const result = this.schemas.delete(routeKey);
    this.save();
    return result;
  }

  /**
   * Generate a sample response from a JSON schema.
   */
  private generateSampleFromSchema(schema: JSONSchema): any {
    switch (schema.type) {
      case 'object':
        const obj: any = {};
        if (schema.properties) {
          for (const [key, value] of Object.entries(schema.properties)) {
            obj[key] = this.generateSampleFromSchema(value);
          }
        }
        return obj;
      
      case 'array':
        if (schema.items) {
          return [this.generateSampleFromSchema(schema.items)];
        }
        return [];
      
      case 'string':
        return 'sample_string';
      
      case 'number':
        return 42;
      
      case 'boolean':
        return true;
      
      case 'null':
        return null;
      
      default:
        return null;
    }
  }

  /**
   * Validate a response against a JSON schema.
   */
  private validateAgainstSchema(response: any, schema: JSONSchema): ValidationResult {
    try {
      this.validateAgainstSchemaRecursive(response, schema);
      return { pass: true };
    } catch (error) {
      return {
        pass: false,
        reason: error instanceof Error ? error.message : 'Schema validation failed'
      };
    }
  }

  private validateAgainstSchemaRecursive(value: any, schema: JSONSchema): void {
    // Type check
    const expectedType = schema.type;
    const actualType = this.getValueType(value);

    if (actualType !== expectedType) {
      throw new Error(`Type mismatch: expected ${expectedType}, got ${actualType}`);
    }

    // Object validation
    if (schema.type === 'object' && schema.properties) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Expected object but got different type');
      }

      // Check required fields
      if (schema.required) {
        for (const requiredField of schema.required) {
          if (!(requiredField in value)) {
            throw new Error(`Missing required field: ${requiredField}`);
          }
        }
      }

      // Validate properties
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          this.validateAgainstSchemaRecursive(value[key], propSchema);
        } else if (!schema.additionalProperties) {
          // Additional properties not allowed
          throw new Error(`Unexpected field: ${key}`);
        }
      }
    }

    // Array validation
    if (schema.type === 'array' && schema.items) {
      if (!Array.isArray(value)) {
        throw new Error('Expected array but got different type');
      }

      for (const item of value) {
        this.validateAgainstSchemaRecursive(item, schema.items);
      }
    }
  }

  private getValueType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Save schema registry to disk.
   */
  private save(): void {
    if (!this.persistencePath) return;

    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.persistencePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = JSON.stringify(Array.from(this.schemas.entries()), null, 2);
      fs.writeFileSync(this.persistencePath, data, 'utf8');
    } catch (error) {
      console.error('Failed to save schema registry:', error);
    }
  }

  /**
   * Load schema registry from disk.
   */
  private load(): void {
    if (!this.persistencePath) return;

    try {
      const fs = require('fs');
      const path = require('path');
      
      // Ensure the directory exists
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      if (!fs.existsSync(this.persistencePath)) return;

      const data = fs.readFileSync(this.persistencePath, 'utf8');
      const entries: [string, SchemaRecord][] = JSON.parse(data);
      this.schemas = new Map(entries);
    } catch (error) {
      console.error('Failed to load schema registry:', error);
      this.schemas = new Map();
    }
  }

  /**
   * Get statistics about the schema registry.
   */
  getStats(): {
    totalSchemas: number;
    totalEvolutions: number;
    schemasByAge: { [key: string]: number };
  } {
    const schemas = Array.from(this.schemas.values());
    const totalEvolutions = schemas.reduce((sum, record) => sum + record.evolutionCount, 0);
    
    const schemasByAge: { [key: string]: number } = {
      '0-24h': 0,
      '1-7d': 0,
      '7-30d': 0,
      '30d+': 0
    };

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    schemas.forEach(record => {
      const age = now - record.registeredAt;
      if (age < day) schemasByAge['0-24h']++;
      else if (age < 7 * day) schemasByAge['1-7d']++;
      else if (age < 30 * day) schemasByAge['7-30d']++;
      else schemasByAge['30d+']++;
    });

    return {
      totalSchemas: schemas.length,
      totalEvolutions,
      schemasByAge
    };
  }
}