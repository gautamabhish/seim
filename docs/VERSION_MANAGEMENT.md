# How SEIM Manages Different Endpoint Versions Persistently

## Current Scope: File-Based Persistent Storage

SEIM currently uses **file-based persistent storage** for version management. This provides:
- ✅ Persistent version storage across restarts
- ✅ Complete version history
- ✅ Safe rollback capability
- ✅ Audit trail of changes
- ❌ No multi-instance coordination (single instance only)
- ❌ No CI/CD integration (runtime-only for now)

## Storage Architecture

### File Storage (<ref_file file="/home/abhishek/seim/src/persistentVersionManager.ts" />)

```
./.seim-storage/
  ├── api_users.json       # All versions for /api/users
  ├── api_products.json    # All versions for /api/products
  └── api_orders.json      # All versions for /api/orders
```

Each file contains complete version history for an endpoint:

```json
{
  "versions": [
    {
      "id": "/api/users::v1.0.0::1234567890",
      "routeKey": "/api/users",
      "version": "v1.0.0",
      "type": "original",
      "code": "original handler code...",
      "metadata": {
        "createdAt": 1234567890,
        "createdBy": "manual",
        "reason": "Initial version"
      },
      "performance": {
        "averageLatency": 100,
        "p95Latency": 150,
        "errorRate": 0.01,
        "sampleSize": 1000
      },
      "status": "inactive",
      "rollbackSafe": true
    },
    {
      "id": "/api/users::v1.1.0::1234567891",
      "routeKey": "/api/users",
      "version": "v1.1.0",
      "type": "optimized",
      "code": "optimized handler code...",
      "metadata": {
        "createdAt": 1234567891,
        "createdBy": "ai",
        "reason": "AI detected sequential-async pattern",
        "pattern": "sequential-async",
        "confidence": 0.92
      },
      "performance": {
        "averageLatency": 50,
        "p95Latency": 75,
        "errorRate": 0.005,
        "sampleSize": 500
      },
      "status": "active",
      "rollbackSafe": true
    }
  ],
  "transitions": [
    {
      "id": "transition::1234567892",
      "routeKey": "/api/users",
      "fromVersion": "/api/users::v1.0.0::1234567890",
      "toVersion": "/api/users::v1.1.0::1234567891",
      "transitionAt": 1234567892,
      "reason": "AI optimization improved latency by 50%",
      "triggeredBy": "auto",
      "rolloutStrategy": "canary",
      "rolloutPercentage": 5
    }
  ],
  "activeVersion": "/api/users::v1.1.0::1234567891"
}
```

## Version Management Components

### 1. VersionManager Core (<ref_file file="/home/abhishek/seim/src/versionManager.ts" />)

Manages version lifecycle with semantic versioning:

```typescript
interface EndpointVersion {
  id: string;                          // Unique version ID
  routeKey: string;                    // Route identifier
  version: string;                     // Semantic versioning (v1.0.0, v1.1.0)
  type: 'original' | 'optimized' | 'rollback';
  code: string;                        // Actual code for this version
  metadata: {
    createdAt: number;
    createdBy: 'ai' | 'manual';
    reason: string;
    pattern?: string;                  // AI-detected pattern
    confidence?: number;               // AI confidence score
  };
  performance: {
    averageLatency: number;
    p95Latency: number;
    errorRate: number;
    sampleSize: number;
  };
  status: 'active' | 'inactive' | 'deprecated';
  rollbackSafe: boolean;               // Can this version be safely rolled back to
}
```

### 2. PersistentVersionManager

Extends VersionManager with file storage:

```typescript
// Automatic persistence for all operations
const versionManager = new PersistentVersionManager(config, new FileStorageAdapter());

// Create version → automatically saved to file
await versionManager.createVersion('/api/users', code, metadata);

// Activate version → automatically updates file
await versionManager.activateVersion('/api/users', versionId, transitionData);

// Rollback → automatically creates and saves rollback version
await versionManager.rollbackToVersion('/api/users', targetVersionId, reason);
```

## Version Lifecycle

### Creation
```typescript
// AI generates optimization → creates new version
const version = await versionManager.createVersion('/api/users', optimizedCode, {
  createdBy: 'ai',
  reason: 'Fixed sequential-async pattern',
  pattern: 'sequential-async',
  confidence: 0.92
});
// Automatically persisted to ./.seim-storage/api_users.json
```

### Activation
```typescript
// Validation passes → activate with canary
await versionManager.activateVersion('/api/users', versionId, {
  reason: 'Deployment after validation',
  triggeredBy: 'auto',
  rolloutStrategy: 'canary',
  rolloutPercentage: 5
});
// Records transition and updates active version in file
```

### Rollback
```typescript
// Issue detected → automatic rollback
await versionManager.rollbackToVersion('/api/users', 'v1.0.0-id', 'Error rate spike');
// Creates v1.2.0-rollback with v1.0.0 code
// Instant activation at 100%
// All changes persisted to file
```

## State Persistence Across Restarts

### Before restart:
```json
./.seim-storage/api_users.json
{
  "versions": [
    { "id": "v1.0.0", "code": "original...", "status": "inactive" },
    { "id": "v1.1.0", "code": "optimized...", "status": "active" }
  ],
  "transitions": [
    { "from": "v1.0.0", "to": "v1.1.0", "reason": "AI optimization" }
  ],
  "activeVersion": "v1.1.0"
}
```

### After restart:
```typescript
// System automatically loads state
await versionManager.loadAllStates();
// Restores: versions, transitions, activeVersion for all routes
// Continues serving v1.1.0 seamlessly
```

## Version Management API

```typescript
// Create new version
const version = await versionManager.createVersion(routeKey, code, metadata);

// Activate version
await versionManager.activateVersion(routeKey, versionId, transitionData);

// Get active version
const active = await versionManager.getActiveVersion(routeKey);

// Rollback to specific version
await versionManager.rollbackToVersion(routeKey, targetVersionId, reason);

// Compare versions
const comparison = await versionManager.compareVersions(routeKey, v1Id, v2Id);

// Get history
const versions = await versionManager.getAllVersions(routeKey);
const transitions = await versionManager.getTransitionHistory(routeKey);

// Update performance metrics
await versionManager.updateVersionPerformance(routeKey, versionId, performance);

// Load all states on startup
await versionManager.loadAllStates();
```

## Current Limitations

### Single Instance Only
- ❌ No multi-instance coordination
- ❌ Not suitable for containerized deployments
- ❌ Not suitable for Kubernetes environments
- ❌ Each instance has its own version state

### Runtime-Only
- ❌ No CI/CD pipeline integration
- ❌ No code-based deployment
- ❌ No code review process
- ❌ No version control integration

## What's Not Implemented (Removed)

### Redis Storage (Removed)
- ❌ No RedisStorageAdapter
- ❌ No multi-instance coordination
- ❌ No shared state across instances

### CI/CD Integration (Removed)
- ❌ No pipeline integration
- ❌ No code-based deployments
- ❌ No git integration
- ❌ No build process integration

## What IS Implemented

### ✅ File-Based Persistent Storage
- Automatic version persistence to JSON files
- Complete version history
- Transition tracking
- Performance metrics per version
- State survives restarts

### ✅ Version Management
- Semantic versioning (v1.0.0, v1.1.0, etc.)
- Safe rollback to any previous version
- Version comparison
- Performance tracking per version
- Audit trail of all changes

### ✅ Production Deployment
- Canary deployment support
- Gradual rollout (5% → 25% → 50% → 75% → 100%)
- Automatic rollback on threshold violations
- Health monitoring
- Runtime handler swapping

## Summary

SEIM currently provides **file-based persistent version management** for single-instance deployments:

- **Storage**: JSON files in `./.seim-storage/`
- **Persistence**: State survives restarts
- **Version Control**: Complete history with semantic versioning
- **Rollback**: Safe rollback to any previous version
- **Deployment**: Canary deployment with automatic rollback
- **Limitations**: Single instance only, no multi-instance coordination, no CI/CD integration

This is suitable for:
- ✅ Single-instance production deployments
- ✅ Development environments
- ✅ Testing and experimentation
- ✅ Applications that don't need multi-instance coordination

Not suitable for:
- ❌ Multi-instance/containerized deployments
- ❌ Kubernetes environments
- ❌ CI/CD pipeline integration
- ❌ Enterprise multi-instance deployments