import { StorageAdapter } from './persistentVersionManager';
import { FileStorageAdapter } from './persistentVersionManager';
import { RedisStorageAdapter } from './redisStorageAdapter';
import { SeimConfig } from './types';

export function createStorageAdapter(config: SeimConfig): StorageAdapter {
  const type = config.storage?.type ?? 'memory';

  if (type === 'redis') {
    const connection = config.storage?.connection || process.env.REDIS_URL;
    return new RedisStorageAdapter(connection);
  }

  // For development or default, fall back to file-based persistence.
  return new FileStorageAdapter(config.storagePath ?? './.seim-storage');
}
