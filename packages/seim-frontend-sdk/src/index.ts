/**
 * SEIM Frontend SDK
 * 
 * This SDK helps frontend applications interact with SEIM's evolution features:
 * - Schema evolution notifications
 * - Feature flag evaluation
 * - Evolution signal parsing
 */

export interface SEIMConfig {
  /**
   * Base URL of the SEIM backend
   */
  baseUrl?: string;

  /**
   * Enable automatic schema change detection
   */
  autoDetectSchemaChanges?: boolean;

  /**
   * Enable feature flag integration
   */
  enableFeatureFlags?: boolean;

  /**
   * Custom headers to include in API requests
   */
  headers?: Record<string, string>;
}

export interface SchemaChangeInfo {
  schemaVersion: string;
  newFields: string[];
  featureVariant?: string;
}

export interface FeatureFlagContext {
  userId: string;
  segments?: string[];
  attributes?: Record<string, any>;
}

export class SEIMClient {
  private config: SEIMConfig;
  private schemaVersion: string | null = null;
  private knownFields: Set<string> = new Set();
  private featureFlags: Map<string, boolean> = new Map();

  constructor(config: SEIMConfig = {}) {
    this.config = {
      autoDetectSchemaChanges: true,
      enableFeatureFlags: true,
      ...config
    };

    if (this.config.autoDetectSchemaChanges) {
      this.initializeSchemaDetection();
    }
  }

  /**
   * Parse SEIM evolution signals from response headers
   */
  parseEvolutionSignals(headers: Headers): SchemaChangeInfo | null {
    const schemaVersion = headers.get('X-SEIM-Schema-Version');
    const featureVariant = headers.get('X-SEIM-Feature-Variant');
    const newFieldsHeader = headers.get('X-SEIM-New-Fields');

    if (!schemaVersion && !featureVariant && !newFieldsHeader) {
      return null;
    }

    const newFields = newFieldsHeader ? newFieldsHeader.split(',').map(f => f.trim()) : [];

    return {
      schemaVersion: schemaVersion || '',
      newFields,
      featureVariant: featureVariant || undefined
    };
  }

  /**
   * Handle a schema change event
   */
  handleSchemaChange(change: SchemaChangeInfo): void {
    if (change.schemaVersion && change.schemaVersion !== this.schemaVersion) {
      this.schemaVersion = change.schemaVersion;
      this.dispatchEvent('schema:change', change);
    }

    if (change.newFields && change.newFields.length > 0) {
      const newFields = change.newFields.filter(f => !this.knownFields.has(f));
      if (newFields.length > 0) {
        newFields.forEach(f => this.knownFields.add(f));
        this.dispatchEvent('schema:newFields', { newFields });
      }
    }

    if (change.featureVariant) {
      this.dispatchEvent('feature:variant', { variant: change.featureVariant });
    }
  }

  /**
   * Get the current schema version
   */
  getSchemaVersion(): string | null {
    return this.schemaVersion;
  }

  /**
   * Get all known fields
   */
  getKnownFields(): string[] {
    return Array.from(this.knownFields);
  }

  /**
   * Check if a field is known
   */
  isFieldKnown(field: string): boolean {
    return this.knownFields.has(field);
  }

  /**
   * Evaluate a feature flag (client-side evaluation)
   */
  evaluateFeatureFlag(flagKey: string, context: FeatureFlagContext): boolean {
    if (!this.config.enableFeatureFlags) {
      return false;
    }

    // Check cached value
    if (this.featureFlags.has(flagKey)) {
      return this.featureFlags.get(flagKey)!;
    }

    // In a real implementation, this would call the SEIM backend
    // For now, return false (flag not enabled)
    return false;
  }

  /**
   * Set a feature flag value (for testing or server-provided values)
   */
  setFeatureFlag(flagKey: string, enabled: boolean): void {
    this.featureFlags.set(flagKey, enabled);
  }

  /**
   * Get all feature flags
   */
  getFeatureFlags(): Map<string, boolean> {
    return new Map(this.featureFlags);
  }

  /**
   * Register an event listener
   */
  on(event: string, callback: (data: any) => void): void {
    const listeners = this.getListeners(event);
    listeners.add(callback);
  }

  /**
   * Unregister an event listener
   */
  off(event: string, callback: (data: any) => void): void {
    const listeners = this.getListeners(event);
    listeners.delete(callback);
  }

  /**
   * Wrap fetch to automatically parse SEIM signals
   */
  async fetchWithSignals(url: string, options?: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.config.headers,
        ...options?.headers
      }
    });

    if (this.config.autoDetectSchemaChanges) {
      const signals = this.parseEvolutionSignals(response.headers);
      if (signals) {
        this.handleSchemaChange(signals);
      }
    }

    return response;
  }

  // Private methods

  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  private getListeners(event: string): Set<(data: any) => void> {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    return this.listeners.get(event)!;
  }

  private dispatchEvent(event: string, data: any): void {
    const listeners = this.getListeners(event);
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in SEIM event listener for ${event}:`, error);
      }
    });
  }

  private initializeSchemaDetection(): void {
    // Intercept fetch to detect schema changes
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const response = await originalFetch(input, init);
      
      try {
        const signals = self.parseEvolutionSignals(response.headers);
        if (signals) {
          self.handleSchemaChange(signals);
        }
      } catch (error) {
        console.error('Error parsing SEIM signals:', error);
      }

      return response;
    };
  }
}

/**
 * Create a SEIM client instance
 */
export function createSEIMClient(config?: SEIMConfig): SEIMClient {
  return new SEIMClient(config);
}

/**
 * React Hook for SEIM integration
 */
export function useSEIM(config?: SEIMConfig) {
  // This would be implemented in a separate React-specific file
  // For now, just return the client
  return {
    client: new SEIMClient(config),
    schemaVersion: null,
    knownFields: [],
    featureFlags: new Map()
  };
}

// Export React hooks separately
export { useSEIM as useSEIMReact, useFeatureFlag, useSchemaField } from './react';