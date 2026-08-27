import { VersionManager, EndpointVersion, VersionTransition } from './versionManager';
import { SeimConfig } from './types';

export interface StorageAdapter {
  saveVersion(routeKey: string, version: EndpointVersion): Promise<void>;
  getVersions(routeKey: string): Promise<EndpointVersion[]>;
  getVersion(routeKey: string, versionId: string): Promise<EndpointVersion | undefined>;
  saveTransition(routeKey: string, transition: VersionTransition): Promise<void>;
  getTransitions(routeKey: string): Promise<VersionTransition[]>;
  setActiveVersion(routeKey: string, versionId: string): Promise<void>;
  getActiveVersion(routeKey: string): Promise<string | undefined>;
  updateVersionPerformance(routeKey: string, versionId: string, performance: any): Promise<void>;
}

export class FileStorageAdapter implements StorageAdapter {
  private storagePath: string;
  
  constructor(storagePath: string = './.seim-storage') {
    this.storagePath = storagePath;
    this.ensureStorageDirectory();
  }

  private ensureStorageDirectory(): void {
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private getRouteFilePath(routeKey: string): string {
    const path = require('path');
    // Sanitize routeKey for filesystem
    const safeKey = routeKey.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.storagePath, `${safeKey}.json`);
  }

  private async atomicWriteFile(filePath: string, content: string): Promise<void> {
    const fs = require('fs').promises;
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async saveVersion(routeKey: string, version: EndpointVersion): Promise<void> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    let versions: EndpointVersion[] = [];
    let transitions: any[] = [];
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      versions = parsed.versions || [];
      transitions = parsed.transitions || [];
    } catch {
      // File doesn't exist yet, that's fine
    }

    versions.push(version);
    
    const fileData = {
      routeKey,
      versions,
      transitions,
      activeVersion: versions.length > 0 ? versions[versions.length - 1].id : undefined,
    };
    
    await this.atomicWriteFile(filePath, JSON.stringify(fileData, null, 2));
  }

  async getVersions(routeKey: string): Promise<EndpointVersion[]> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.versions || [];
    } catch {
      return [];
    }
  }

  async getVersion(routeKey: string, versionId: string): Promise<EndpointVersion | undefined> {
    const versions = await this.getVersions(routeKey);
    return versions.find(v => v.id === versionId);
  }

  async saveTransition(routeKey: string, transition: VersionTransition): Promise<void> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    let fileData: any = { versions: [], transitions: [], activeVersion: undefined };
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      fileData = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    fileData.routeKey = routeKey;
    fileData.transitions = fileData.transitions || [];
    fileData.transitions.push(transition);
    
    await this.atomicWriteFile(filePath, JSON.stringify(fileData, null, 2));
  }

  async getTransitions(routeKey: string): Promise<VersionTransition[]> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.transitions || [];
    } catch {
      return [];
    }
  }

  async setActiveVersion(routeKey: string, versionId: string): Promise<void> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    let fileData: any = { versions: [], transitions: [], activeVersion: undefined };
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      fileData = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    fileData.routeKey = routeKey;
    fileData.activeVersion = versionId;
    
    await this.atomicWriteFile(filePath, JSON.stringify(fileData, null, 2));
  }

  async getActiveVersion(routeKey: string): Promise<string | undefined> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.activeVersion;
    } catch {
      return undefined;
    }
  }

  async updateVersionPerformance(routeKey: string, versionId: string, performance: any): Promise<void> {
    const fs = require('fs').promises;
    const filePath = this.getRouteFilePath(routeKey);
    
    let fileData: any = { versions: [], transitions: [], activeVersion: undefined };
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      fileData = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    fileData.routeKey = routeKey;
    const version = fileData.versions?.find((v: any) => v.id === versionId);
    if (version) {
      version.performance = { ...version.performance, ...performance };
      await fs.writeFile(filePath, JSON.stringify(fileData, null, 2));
    }
  }
}

export class PersistentVersionManager extends VersionManager {
  private storageAdapter: StorageAdapter;
  private storagePath: string;

  constructor(config: SeimConfig, storageAdapter: StorageAdapter) {
    super(config);
    this.storageAdapter = storageAdapter;
    this.storagePath = (config as any).storagePath || './.seim-storage';
  }

  public override async createVersion(routeKey: string, code: string, metadata: any): Promise<EndpointVersion> {
    const version = await super.createVersion(routeKey, code, metadata);
    await this.storageAdapter.saveVersion(routeKey, version);
    return version;
  }

  public override async activateVersion(routeKey: string, versionId: string, transitionData: any): Promise<boolean> {
    const success = await super.activateVersion(routeKey, versionId, transitionData);
    if (success) {
      await this.storageAdapter.setActiveVersion(routeKey, versionId);
      
      const transition: VersionTransition = {
        id: `transition::${Date.now()}`,
        routeKey,
        fromVersion: 'loaded', // Will be filled in by reload
        toVersion: versionId,
        transitionAt: Date.now(),
        reason: transitionData.reason,
        triggeredBy: transitionData.triggeredBy,
        rolloutStrategy: transitionData.rolloutStrategy,
        rolloutPercentage: transitionData.rolloutPercentage,
      };
      await this.storageAdapter.saveTransition(routeKey, transition);
    }
    return success;
  }

  public override async getActiveVersion(routeKey: string): Promise<EndpointVersion | undefined> {
    const activeVersionId = await this.storageAdapter.getActiveVersion(routeKey);
    if (!activeVersionId) return undefined;

    return await this.storageAdapter.getVersion(routeKey, activeVersionId);
  }

  public override async getVersion(routeKey: string, versionId: string): Promise<EndpointVersion | undefined> {
    return await this.storageAdapter.getVersion(routeKey, versionId);
  }

  public override async getAllVersions(routeKey: string): Promise<EndpointVersion[]> {
    return await this.storageAdapter.getVersions(routeKey);
  }

  public override async getTransitionHistory(routeKey: string): Promise<VersionTransition[]> {
    return await this.storageAdapter.getTransitions(routeKey);
  }

  public override async rollbackToVersion(routeKey: string, targetVersionId: string, reason: string): Promise<boolean> {
    const success = await super.rollbackToVersion(routeKey, targetVersionId, reason);
    if (success) {
      // The rollback creates a new version, so we need to save it
      const versions = await this.getAllVersions(routeKey);
      const newRollbackVersion = versions[versions.length - 1];
      await this.storageAdapter.saveVersion(routeKey, newRollbackVersion);
      await this.storageAdapter.setActiveVersion(routeKey, newRollbackVersion.id);
    }
    return success;
  }

  public override async updateVersionPerformance(routeKey: string, versionId: string, performance: any): Promise<boolean> {
    const success = await super.updateVersionPerformance(routeKey, versionId, performance);
    if (success) {
      await this.storageAdapter.updateVersionPerformance(routeKey, versionId, performance);
    }
    return success;
  }

  public async loadState(routeKey: string): Promise<void> {
    const versions = await this.storageAdapter.getVersions(routeKey);
    const transitions = await this.storageAdapter.getTransitions(routeKey);
    const activeVersionId = await this.storageAdapter.getActiveVersion(routeKey);

    if (versions.length > 0) {
      this.versions.set(routeKey, versions);
      this.transitions.set(routeKey, transitions);
      if (activeVersionId) {
        this.activeVersions.set(routeKey, activeVersionId);
      }
    }
  }

  public async loadAllStates(): Promise<void> {
    // Load all route files from storage directory
    const fs = require('fs');
    const path = require('path');
    
    try {
      const storagePath = this.storagePath;
      if (!fs.existsSync(storagePath)) {
        return; // No storage directory yet
      }

      const files = fs.readdirSync(storagePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(storagePath, file);
          const data = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(data);
          let routeKey = parsed.routeKey;
          if (!routeKey) {
            routeKey = file.replace('.json', '').replace(/_/g, '/');
          }
          await this.loadState(routeKey);
        }
      }
    } catch (error) {
      console.error('Error loading states:', error);
    }
  }
}
