import { FrontendComponent, SeimConfig } from './types';
import { Logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export interface ComponentVersion {
  version: string;
  component: FrontendComponent;
  deployedAt?: number;
  rollbackAvailable: boolean;
}

export class ComponentRegistry {
  private components: Map<string, ComponentVersion[]> = new Map();
  private activeComponents: Map<string, string> = new Map(); // routeKey -> componentId

  constructor(
    private config: SeimConfig,
    private logger: Logger
  ) {
    this.loadFromDisk();
  }

  /**
   * Register a new component
   */
  registerComponent(component: FrontendComponent): void {
    const key = this.getComponentKey(component.routeKey, component.framework);
    
    if (!this.components.has(key)) {
      this.components.set(key, []);
    }

    const versions = this.components.get(key)!;
    
    // Check if this version already exists
    const existingIndex = versions.findIndex(v => v.component.id === component.id);
    if (existingIndex >= 0) {
      // Update existing version
      versions[existingIndex] = {
        version: this.calculateVersion(versions.length),
        component,
        rollbackAvailable: false
      };
    } else {
      // Add new version
      versions.push({
        version: this.calculateVersion(versions.length),
        component,
        rollbackAvailable: false
      });
    }

    this.components.set(key, versions);
    this.saveToDisk();

    this.logger.info('Component registered', {
      componentId: component.id,
      routeKey: component.routeKey,
      framework: component.framework,
      version: versions[versions.length - 1].version
    });
  }

  /**
   * Activate a component for a route
   */
  activateComponent(componentId: string): boolean {
    // Find the component
    let foundComponent: FrontendComponent | null = null;
    let foundKey: string | null = null;

    for (const [key, versions] of this.components.entries()) {
      const version = versions.find(v => v.component.id === componentId);
      if (version) {
        foundComponent = version.component;
        foundKey = key;
        break;
      }
    }

    if (!foundComponent || !foundKey) {
      this.logger.warn('Attempted to activate unknown component', { componentId });
      return false;
    }

    // Mark previous active component as rollback available
    const previousActiveId = this.activeComponents.get(foundComponent.routeKey);
    if (previousActiveId) {
      this.markRollbackAvailable(foundKey, previousActiveId);
    }

    // Set new active component
    this.activeComponents.set(foundComponent.routeKey, componentId);
    
    // Update component status
    const versions = this.components.get(foundKey)!;
    const version = versions.find(v => v.component.id === componentId);
    if (version) {
      version.component.status = 'active';
      version.deployedAt = Date.now();
    }

    this.saveToDisk();

    this.logger.info('Component activated', {
      componentId,
      routeKey: foundComponent.routeKey,
      previousId: previousActiveId
    });

    return true;
  }

  /**
   * Deactivate a component
   */
  deactivateComponent(routeKey: string): boolean {
    const componentId = this.activeComponents.get(routeKey);
    if (!componentId) {
      this.logger.warn('No active component to deactivate', { routeKey });
      return false;
    }

    const key = this.getComponentKey(routeKey, 'react'); // Default to react for now
    if (componentId) {
      this.markRollbackAvailable(key, componentId);
    }
    this.activeComponents.delete(routeKey);

    this.saveToDisk();

    this.logger.info('Component deactivated', { routeKey, componentId });
    return true;
  }

  /**
   * Rollback to a previous component version
   */
  rollbackToVersion(routeKey: string, framework: string, version: string): boolean {
    const key = this.getComponentKey(routeKey, framework);
    const versions = this.components.get(key);

    if (!versions) {
      this.logger.warn('No versions found for rollback', { routeKey, framework });
      return false;
    }

    const targetVersion = versions.find(v => v.version === version);
    if (!targetVersion) {
      this.logger.warn('Target version not found', { routeKey, framework, version });
      return false;
    }

    if (!targetVersion.rollbackAvailable) {
      this.logger.warn('Target version not available for rollback', { routeKey, framework, version });
      return false;
    }

    // Activate the target version
    return this.activateComponent(targetVersion.component.id);
  }

  /**
   * Get the active component for a route
   */
  getActiveComponent(routeKey: string, framework: string = 'react'): FrontendComponent | null {
    const componentId = this.activeComponents.get(routeKey);
    if (!componentId) {
      return null;
    }

    const key = this.getComponentKey(routeKey, framework);
    const versions = this.components.get(key);
    if (!versions) {
      return null;
    }

    const version = versions.find(v => v.component.id === componentId);
    return version?.component || null;
  }

  /**
   * Get all versions for a route/framework
   */
  getVersions(routeKey: string, framework: string): ComponentVersion[] {
    const key = this.getComponentKey(routeKey, framework);
    return this.components.get(key) || [];
  }

  /**
   * Get a specific component by ID
   */
  getComponent(componentId: string): FrontendComponent | null {
    for (const versions of this.components.values()) {
      const version = versions.find(v => v.component.id === componentId);
      if (version) {
        return version.component;
      }
    }
    return null;
  }

  /**
   * Delete a component version
   */
  deleteComponent(componentId: string): boolean {
    for (const [key, versions] of this.components.entries()) {
      const index = versions.findIndex(v => v.component.id === componentId);
      if (index >= 0) {
        // Don't delete if it's the active component
        const isActive = this.activeComponents.get(versions[index].component.routeKey) === componentId;
        if (isActive) {
          this.logger.warn('Cannot delete active component', { componentId });
          return false;
        }

        versions.splice(index, 1);
        this.components.set(key, versions);
        this.saveToDisk();

        this.logger.info('Component deleted', { componentId });
        return true;
      }
    }

    this.logger.warn('Component not found for deletion', { componentId });
    return false;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalComponents: number;
    totalVersions: number;
    activeComponents: number;
    rollbackAvailable: number;
  } {
    let totalVersions = 0;
    let rollbackAvailable = 0;

    for (const versions of this.components.values()) {
      totalVersions += versions.length;
      rollbackAvailable += versions.filter(v => v.rollbackAvailable).length;
    }

    return {
      totalComponents: this.components.size,
      totalVersions,
      activeComponents: this.activeComponents.size,
      rollbackAvailable
    };
  }

  /**
   * Clean up old component versions
   */
  cleanupOldVersions(routeKey: string, framework: string, keepCount: number = 5): number {
    const key = this.getComponentKey(routeKey, framework);
    const versions = this.components.get(key);

    if (!versions || versions.length <= keepCount) {
      return 0;
    }

    // Sort by deployedAt (most recent first)
    const sorted = [...versions].sort((a, b) => (b.deployedAt || 0) - (a.deployedAt || 0));

    // Keep the first keepCount versions
    const toKeep = sorted.slice(0, keepCount);
    const toDelete = sorted.slice(keepCount);

    // Only delete versions that are not rollback candidates
    let deleted = 0;
    const filtered = versions.filter(v => {
      if (toDelete.includes(v) && !v.rollbackAvailable) {
        deleted++;
        return false;
      }
      return true;
    });

    this.components.set(key, filtered);
    this.saveToDisk();

    this.logger.info('Cleaned up old component versions', {
      routeKey,
      framework,
      deleted,
      remaining: filtered.length
    });

    return deleted;
  }

  // Private methods

  private getComponentKey(routeKey: string, framework: string): string {
    return `${routeKey}::${framework}`;
  }

  private calculateVersion(count: number): string {
    return `v${count + 1}`;
  }

  private markRollbackAvailable(key: string, componentId: string): void {
    const versions = this.components.get(key);
    if (!versions || !componentId) return;

    const version = versions.find(v => v.component.id === componentId);
    if (version) {
      version.rollbackAvailable = true;
      version.component.status = 'rollback_available';
      this.components.set(key, versions);
    }
  }

  private saveToDisk(): void {
    try {
      const data = {
        components: Array.from(this.components.entries()),
        activeComponents: Array.from(this.activeComponents.entries())
      };

      const filePath = this.getStoragePath();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save component registry to disk', { error });
    }
  }

  private loadFromDisk(): void {
    try {
      const filePath = this.getStoragePath();
      if (!fs.existsSync(filePath)) {
        return;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.components = new Map(data.components);
      this.activeComponents = new Map(data.activeComponents);

      this.logger.info('Component registry loaded from disk', {
        components: this.components.size,
        activeComponents: this.activeComponents.size
      });
    } catch (error) {
      this.logger.error('Failed to load component registry from disk', { error });
    }
  }

  private getStoragePath(): string {
    const storageDir = path.join(this.config.storagePath || './.seim', 'components');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    return path.join(storageDir, 'registry.json');
  }
}