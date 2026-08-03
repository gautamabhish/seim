/**
 * React Hook for SEIM integration
 */

import { useEffect, useState, useCallback } from 'react';
import { SEIMClient, SEIMConfig, SchemaChangeInfo, FeatureFlagContext } from './index';

export interface UseSEIMReturn {
  client: SEIMClient;
  schemaVersion: string | null;
  knownFields: string[];
  featureFlags: Map<string, boolean>;
  lastSchemaChange: SchemaChangeInfo | null;
  isLoading: boolean;
}

export function useSEIM(config?: SEIMConfig): UseSEIMReturn {
  const [client] = useState(() => new SEIMClient(config));
  const [schemaVersion, setSchemaVersion] = useState<string | null>(null);
  const [knownFields, setKnownFields] = useState<string[]>([]);
  const [featureFlags, setFeatureFlags] = useState<Map<string, boolean>>(new Map());
  const [lastSchemaChange, setLastSchemaChange] = useState<SchemaChangeInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Listen for schema changes
    const handleSchemaChange = (change: SchemaChangeInfo) => {
      setSchemaVersion(change.schemaVersion);
      setKnownFields(client.getKnownFields());
      setLastSchemaChange(change);
    };

    client.on('schema:change', handleSchemaChange);
    client.on('schema:newFields', handleSchemaChange);

    return () => {
      client.off('schema:change', handleSchemaChange);
      client.off('schema:newFields', handleSchemaChange);
    };
  }, [client]);

  const evaluateFeatureFlag = useCallback((flagKey: string, context: FeatureFlagContext) => {
    return client.evaluateFeatureFlag(flagKey, context);
  }, [client]);

  return {
    client,
    schemaVersion,
    knownFields,
    featureFlags,
    lastSchemaChange,
    isLoading
  };
}

/**
 * Hook for feature flag evaluation
 */
export function useFeatureFlag(flagKey: string, context: FeatureFlagContext) {
  const { client } = useSEIM();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const enabled = client.evaluateFeatureFlag(flagKey, context);
    setIsEnabled(enabled);
    setIsLoading(false);
  }, [client, flagKey, context]);

  return { isEnabled, isLoading };
}

/**
 * Hook for schema field detection
 */
export function useSchemaField(fieldName: string) {
  const { knownFields } = useSEIM();
  const [isKnown, setIsKnown] = useState(false);

  useEffect(() => {
    setIsKnown(knownFields.includes(fieldName));
  }, [knownFields, fieldName]);

  return isKnown;
}