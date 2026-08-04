# @seim/frontend-sdk

Frontend SDK for SEIM (Self-Evolving Infrastructure Middleware). This SDK helps frontend applications interact with SEIM's evolution features.

## Features

- **Schema Evolution Detection**: Automatically detect when backend API schemas change
- **Feature Flag Integration**: Evaluate feature flags with client-side support
- **Evolution Signal Parsing**: Parse SEIM evolution signals from HTTP response headers
- **React Hooks**: Pre-built React hooks for easy integration

## Installation

```bash
npm install @seim/frontend-sdk
```

## Usage

### Basic Usage

```typescript
import { createSEIMClient } from '@seim/frontend-sdk';

const seim = createSEIMClient({
  autoDetectSchemaChanges: true,
  enableFeatureFlags: true
});

// Listen for schema changes
seim.on('schema:change', (change) => {
  console.log('Schema changed:', change);
});

// Wrap fetch calls to auto-detect signals
const response = await seim.fetchWithSignals('/api/data');
```

### React Integration

```typescript
import { useSEIM, useFeatureFlag } from '@seim/frontend-sdk/react';

function MyComponent() {
  const { schemaVersion, knownFields } = useSEIM();
  const { isEnabled: newFeatureEnabled } = useFeatureFlag('new-feature', {
    userId: 'user-123',
    segments: ['beta-testers']
  });

  return (
    <div>
      {newFeatureEnabled && <NewFeature />}
      {knownFields.includes('discount') && <DiscountBanner />}
    </div>
  );
}
```

### Manual Signal Parsing

```typescript
import { SEIMClient } from '@seim/frontend-sdk';

const client = new SEIMClient();

// Parse signals from response headers
const signals = client.parseEvolutionSignals(response.headers);
if (signals) {
  client.handleSchemaChange(signals);
}
```

## API Reference

### SEIMClient

#### Constructor
```typescript
new SEIMClient(config?: SEIMConfig)
```

#### Methods

- `parseEvolutionSignals(headers: Headers): SchemaChangeInfo | null`
- `handleSchemaChange(change: SchemaChangeInfo): void`
- `getSchemaVersion(): string | null`
- `getKnownFields(): string[]`
- `isFieldKnown(field: string): boolean`
- `evaluateFeatureFlag(flagKey: string, context: FeatureFlagContext): boolean`
- `setFeatureFlag(flagKey: string, enabled: boolean): void`
- `getFeatureFlags(): Map<string, boolean>`
- `on(event: string, callback: (data: any) => void): void`
- `off(event: string, callback: (data: any) => void): void`
- `fetchWithSignals(url: string, options?: RequestInit): Promise<Response>`

### React Hooks

#### useSEIM
```typescript
const { client, schemaVersion, knownFields, featureFlags, lastSchemaChange } = useSEIM(config);
```

#### useFeatureFlag
```typescript
const { isEnabled, isLoading } = useFeatureFlag(flagKey, context);
```

#### useSchemaField
```typescript
const isKnown = useSchemaField(fieldName);
```

## Configuration

```typescript
interface SEIMConfig {
  baseUrl?: string;
  autoDetectSchemaChanges?: boolean;
  enableFeatureFlags?: boolean;
  headers?: Record<string, string>;
}
```

## Evolution Signals

The SDK parses the following HTTP response headers:

- `X-SEIM-Schema-Version`: Current schema version
- `X-SEIM-Feature-Variant`: Active feature variant
- `X-SEIM-New-Fields`: Comma-separated list of new fields

## License

MIT