import { LLMClient } from './ai';
import { SchemaRegistry } from './schemaRegistry';
import { SeimEventBus } from './events';
import { Logger } from './logger';
import { SeimConfig, FrontendComponent, SchemaChange } from './types';

export class FrontendEvolutionEngine {
  private pendingEvolutions: Map<string, SchemaChange> = new Map();
  private generatedComponents: Map<string, FrontendComponent> = new Map();

  constructor(
    private config: SeimConfig,
    private llm: LLMClient,
    private schemaRegistry: SchemaRegistry,
    private events: SeimEventBus,
    private logger: Logger
  ) {}

  /**
   * Handle a schema change event and potentially trigger frontend evolution
   */
  async handleSchemaChange(change: SchemaChange): Promise<void> {
    if (!this.config.frontendEvolution?.enabled) {
      return;
    }

    // Check if this is a backward-compatible change that affects frontend
    if (!this.affectsFrontend(change)) {
      this.logger.info('Schema change does not affect frontend', { changeId: change.id });
      return;
    }

    this.logger.info('Schema change affects frontend, queuing evolution', { changeId: change.id });
    this.pendingEvolutions.set(change.id, change);

    // Emit event for interested parties
    this.events.emitEvent('frontend:evolution_queued', { change });

    // Auto-generate if enabled
    if (this.config.frontendEvolution.autoGenerate) {
      await this.generateComponentsForChange(change);
    }
  }

  /**
   * Generate frontend components for a schema change
   */
  async generateComponentsForChange(change: SchemaChange): Promise<FrontendComponent[]> {
    const components: FrontendComponent[] = [];

    try {
      // Determine which frameworks to generate for
      const frameworks = [this.config.frontendEvolution?.framework || 'react'];

      for (const framework of frameworks) {
        const component = await this.generateComponent(change, framework);
        if (component) {
          components.push(component);
          this.generatedComponents.set(component.id, component);
          this.events.emitEvent('frontend:component_generated', { component, change });
        }
      }

      this.logger.info('Frontend components generated', {
        changeId: change.id,
        count: components.length,
        frameworks
      });

      return components;
    } catch (error) {
      this.logger.error('Failed to generate frontend components', { changeId: change.id, error });
      return [];
    }
  }

  /**
   * Generate a single component for a schema change
   */
  async generateComponent(change: SchemaChange, framework: string): Promise<FrontendComponent | null> {
    try {
      // Get the new schema
      const newSchema = this.schemaRegistry.getSchema(change.routeKey);
      if (!newSchema) {
        this.logger.warn('Could not find new schema for component generation', { changeId: change.id });
        return null;
      }

      // Try to get existing component (if this is an update)
      const existingComponent = this.getExistingComponent(change.routeKey, framework);

      // Generate component using AI
      const code = await this.llm.generateFrontendComponent(newSchema, framework, existingComponent?.code);
      if (!code) {
        this.logger.warn('AI failed to generate component code', { changeId: change.id, framework });
        return null;
      }

      // Review the generated component
      const review = await this.llm.reviewFrontendComponent(code, framework);
      if (!review.pass) {
        this.logger.warn('Generated component failed review', { changeId: change.id, framework, reason: review.reason });
        return null;
      }

      const component: FrontendComponent = {
        id: `${change.routeKey}::${framework}::${Date.now()}`,
        routeKey: change.routeKey,
        framework,
        code,
        schemaVersion: change.newVersion,
        generatedAt: Date.now(),
        status: 'pending',
        metadata: {
          changeId: change.id,
          reviewPassed: true,
          reviewReason: review.reason
        }
      };

      return component;
    } catch (error) {
      this.logger.error('Error generating component', { changeId: change.id, framework, error });
      return null;
    }
  }

  /**
   * Approve a component for deployment
   */
  approveComponent(componentId: string): boolean {
    const component = this.generatedComponents.get(componentId);
    if (!component) {
      this.logger.warn('Attempted to approve unknown component', { componentId });
      return false;
    }

    component.status = 'approved';
    component.approvedAt = Date.now();
    this.generatedComponents.set(componentId, component);

    this.logger.info('Frontend component approved', { componentId });
    this.events.emitEvent('frontend:component_approved', { component });

    return true;
  }

  /**
   * Reject a component
   */
  rejectComponent(componentId: string, reason: string): boolean {
    const component = this.generatedComponents.get(componentId);
    if (!component) {
      this.logger.warn('Attempted to reject unknown component', { componentId });
      return false;
    }

    component.status = 'rejected';
    component.rejectedAt = Date.now();
    component.metadata.rejectionReason = reason;
    this.generatedComponents.set(componentId, component);

    this.logger.info('Frontend component rejected', { componentId, reason });
    this.events.emitEvent('frontend:component_rejected', { component, reason });

    return true;
  }

  /**
   * Deploy a component to production
   */
  deployComponent(componentId: string): boolean {
    const component = this.generatedComponents.get(componentId);
    if (!component || component.status !== 'approved') {
      this.logger.warn('Attempted to deploy unapproved component', { componentId, status: component?.status });
      return false;
    }

    component.status = 'deployed';
    component.deployedAt = Date.now();
    this.generatedComponents.set(componentId, component);

    this.logger.info('Frontend component deployed', { componentId });
    this.events.emitEvent('frontend:component_deployed', { component });

    return true;
  }

  /**
   * Get all pending components
   */
  getPendingComponents(): FrontendComponent[] {
    return Array.from(this.generatedComponents.values()).filter(c => c.status === 'pending');
  }

  /**
   * Get components for a specific route
   */
  getComponentsForRoute(routeKey: string): FrontendComponent[] {
    return Array.from(this.generatedComponents.values()).filter(c => c.routeKey === routeKey);
  }

  /**
   * Get a specific component
   */
  getComponent(componentId: string): FrontendComponent | undefined {
    return this.generatedComponents.get(componentId);
  }

  /**
   * Get evolution statistics
   */
  getStats(): {
    pendingEvolutions: number;
    generatedComponents: number;
    approvedComponents: number;
    deployedComponents: number;
    rejectedComponents: number;
  } {
    const components = Array.from(this.generatedComponents.values());

    return {
      pendingEvolutions: this.pendingEvolutions.size,
      generatedComponents: components.length,
      approvedComponents: components.filter(c => c.status === 'approved').length,
      deployedComponents: components.filter(c => c.status === 'deployed').length,
      rejectedComponents: components.filter(c => c.status === 'rejected').length
    };
  }

  // Private methods

  private affectsFrontend(change: SchemaChange): boolean {
    // Check if the change is backward-compatible and adds new fields
    // that would benefit from frontend display
    if (change.type === 'breaking') {
      return false; // Breaking changes require manual intervention
    }

    if (change.type === 'backward_compatible') {
      // Check if the change adds fields that should be displayed
      return true;
    }

    return false;
  }

  private getExistingComponent(routeKey: string, framework: string): FrontendComponent | undefined {
    // Find the most recent deployed component for this route and framework
    const components = Array.from(this.generatedComponents.values())
      .filter(c => c.routeKey === routeKey && c.framework === framework && c.status === 'deployed')
      .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));

    return components[0];
  }

  /**
   * Get schema diff for display purposes
   */
  async getSchemaDiff(routeKey: string, oldVersion: string, newVersion: string): Promise<any> {
    const oldSchema = this.schemaRegistry.getSchema(routeKey);
    const newSchema = this.schemaRegistry.getSchema(routeKey);

    if (!oldSchema || !newSchema) {
      return null;
    }

    // Calculate diff
    const diff = {
      addedFields: this.getAddedFields(oldSchema, newSchema),
      removedFields: this.getRemovedFields(oldSchema, newSchema),
      modifiedFields: this.getModifiedFields(oldSchema, newSchema)
    };

    return diff;
  }

  private getAddedFields(oldSchema: any, newSchema: any): string[] {
    const oldFields = new Set(Object.keys(oldSchema.properties || {}));
    const newFields = Object.keys(newSchema.properties || {});
    return newFields.filter(f => !oldFields.has(f));
  }

  private getRemovedFields(oldSchema: any, newSchema: any): string[] {
    const oldFields = Object.keys(oldSchema.properties || {});
    const newFields = new Set(Object.keys(newSchema.properties || {}));
    return oldFields.filter(f => !newFields.has(f));
  }

  private getModifiedFields(oldSchema: any, newSchema: any): string[] {
    const oldFields = oldSchema.properties || {};
    const newFields = newSchema.properties || {};
    const modified: string[] = [];

    Object.keys(oldFields).forEach(field => {
      if (newFields[field] && JSON.stringify(oldFields[field]) !== JSON.stringify(newFields[field])) {
        modified.push(field);
      }
    });

    return modified;
  }
}