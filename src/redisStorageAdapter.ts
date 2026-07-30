import { StorageAdapter } from './persistentVersionManager';
import { EndpointVersion, VersionTransition } from './versionManager';

export class RedisStorageAdapter implements StorageAdapter {
  private client: any;
  private prefix = 'seim';

  constructor(url?: string) {
    let redis;
    try {
      redis = require('redis');
    } catch {
      throw new Error(
        'Redis storage requires the "redis" package. Install it with: npm install redis'
      );
    }

    const connectionUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = redis.createClient({ url: connectionUrl });
    this.client.connect().catch((err: any) => {
      console.error('[SEIM] Redis connection failed:', err?.message || err);
    });
  }

  private key(routeKey: string, suffix: string): string {
    const safeKey = routeKey.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${this.prefix}:${safeKey}:${suffix}`;
  }

  public async saveVersion(routeKey: string, version: EndpointVersion): Promise<void> {
    const versions = await this.getVersions(routeKey);
    versions.push(version);
    await this.client.set(this.key(routeKey, 'versions'), JSON.stringify(versions));
  }

  public async getVersions(routeKey: string): Promise<EndpointVersion[]> {
    const data = await this.client.get(this.key(routeKey, 'versions'));
    return data ? JSON.parse(data) : [];
  }

  public async getVersion(routeKey: string, versionId: string): Promise<EndpointVersion | undefined> {
    const versions = await this.getVersions(routeKey);
    return versions.find((v: EndpointVersion) => v.id === versionId);
  }

  public async saveTransition(routeKey: string, transition: VersionTransition): Promise<void> {
    const transitions = await this.getTransitions(routeKey);
    transitions.push(transition);
    await this.client.set(this.key(routeKey, 'transitions'), JSON.stringify(transitions));
  }

  public async getTransitions(routeKey: string): Promise<VersionTransition[]> {
    const data = await this.client.get(this.key(routeKey, 'transitions'));
    return data ? JSON.parse(data) : [];
  }

  public async setActiveVersion(routeKey: string, versionId: string): Promise<void> {
    await this.client.set(this.key(routeKey, 'active'), versionId);
  }

  public async getActiveVersion(routeKey: string): Promise<string | undefined> {
    return await this.client.get(this.key(routeKey, 'active')) || undefined;
  }

  public async updateVersionPerformance(routeKey: string, versionId: string, performance: any): Promise<void> {
    const versions = await this.getVersions(routeKey);
    const updated = versions.map((v: EndpointVersion) => {
      if (v.id === versionId) {
        return { ...v, performance: { ...v.performance, ...performance } };
      }
      return v;
    });
    await this.client.set(this.key(routeKey, 'versions'), JSON.stringify(updated));
  }
}
