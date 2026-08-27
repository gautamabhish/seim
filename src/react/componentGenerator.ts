import { createHash } from 'crypto';
import { ReactComponent, FrontendRouteConfig, ConsistencyCheck, ComponentRequest } from './types';
import { ReactConsistencyChecker } from './consistencyChecker';
import { ReactComponentRegistry } from './componentRegistry';
import { LLMClient } from '../ai';
import { SeimConfig } from '../types';
import { SeimEventBus } from '../events';
import { Logger } from '../logger';

export class ReactComponentGenerator {
  private checker: ReactConsistencyChecker;

  constructor(
    private registry: ReactComponentRegistry,
    private llm: LLMClient,
    private config: SeimConfig,
    private events: SeimEventBus,
    private logger: Logger,
  ) {
    this.checker = new ReactConsistencyChecker();
  }

  public async generate(request: ComponentRequest): Promise<ReactComponent> {
    const systemPrompt = `You are a senior React developer. Generate a complete, functional React component (TSX) based on the request.
Do not use markdown code block backticks in the final output unless required by formatting. Just provide the raw TSX code.
Ensure it includes React imports, a default export for the component, and appropriate hooks.`;

    const userPrompt = `Generate a component named ${request.name}.
Intent: ${request.intent}
Endpoints to call: ${request.dataEndpoints?.join(', ') || 'None'}
Is Page: ${request.isPage ? 'Yes' : 'No'}
Visuals: ${request.styleHints || 'Standard UI'}`;

    let code = '';
    try {
      if (this.config.ai?.apiKey) {
        code = await this.llm.chat(systemPrompt, userPrompt);
        code = code.replace(/^\`\`\`(tsx|typescript|js|javascript)?\s*/i, '').replace(/\`\`\`$/i, '').trim();
      } else {
        code = this.buildFallbackTemplate(request);
      }
    } catch (err) {
      this.logger.error(`AI generation failed, using fallback. Error: ${err}`);
      code = this.buildFallbackTemplate(request);
    }

    const structureCheck = this.checker.validateStructure(code, request.name);
    if (!structureCheck.passed) {
      this.logger.warn(`Generated component ${request.name} failed structure validation: ${JSON.stringify(structureCheck.issues)}`);
    }

    const consistencyHash = this.checker.computeHash(code);

    const component: ReactComponent = {
      id: `cmp_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      name: request.name,
      path: `src/pages/${request.name}.tsx`,
      routePath: request.routePath,
      code,
      dependencies: ['react'],
      isPage: !!request.isPage,
      consistencyHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      backwardCompatible: true
    };

    this.registry.register(component);

    if (component.isPage && component.routePath) {
      this.registry.registerRoute({
        path: component.routePath,
        componentName: component.name,
        componentId: component.id,
        lazy: true
      });
    }

    (this.events as any).emitEvent('frontend:component_generated', { component, change: request });

    return component;
  }

  public async update(componentId: string, updateIntent: string): Promise<{ component: ReactComponent; consistency: ConsistencyCheck }> {
    const existing = this.registry.getById(componentId);
    if (!existing) {
      throw new Error(`Component ${componentId} not found`);
    }

    const systemPrompt = `You are a senior React developer updating an existing component. Apply the update intent and return the full updated TSX code. Do not include markdown code block syntax.`;
    const userPrompt = `Update Intent: ${updateIntent}\n\nOriginal Code:\n${existing.code}`;

    let updatedCode = existing.code;
    if (this.config.ai?.apiKey) {
      try {
        updatedCode = await this.llm.chat(systemPrompt, userPrompt);
        updatedCode = updatedCode.replace(/^\`\`\`(tsx|typescript|js|javascript)?\s*/i, '').replace(/\`\`\`$/i, '').trim();
      } catch (err) {
        this.logger.error(`AI update failed: ${err}`);
      }
    } else {
      updatedCode = `// Updated by local fallback\n${existing.code}`;
    }

    const consistencyHash = this.checker.computeHash(updatedCode);
    
    const updatedComponent = {
      ...existing,
      code: updatedCode,
      consistencyHash,
      updatedAt: Date.now(),
      version: existing.version + 1
    };

    const consistency = this.checker.check(existing, updatedComponent);
    updatedComponent.backwardCompatible = consistency.passed;

    this.registry.update(componentId, updatedComponent);

    return { component: updatedComponent, consistency };
  }

  public async generateFromBehavior(path: string, userJourneyDescription: string): Promise<ReactComponent> {
    const request: ComponentRequest = {
      name: `BehaviorDrivenComponent_${Math.floor(Math.random()*1000)}`,
      intent: `Generated for user journey: ${userJourneyDescription}`,
      routePath: path,
      isPage: true
    };
    return this.generate(request);
  }

  private buildFallbackTemplate(request: ComponentRequest): string {
    const hasEndpoints = request.dataEndpoints && request.dataEndpoints.length > 0;
    
    let fetchLogic = '';
    if (hasEndpoints) {
      fetchLogic = `
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch('${request.dataEndpoints![0]}', { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(\`HTTP error \${r.status}\`);
        return r.json();
      })
      .then(d => {
        setData(Array.isArray(d) ? d : [d]);
        setLoading(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to fetch data');
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);`;
    } else {
      fetchLogic = `
  useEffect(() => {
    setLoading(false);
  }, []);`;
    }

    return `import React, { useState, useEffect } from 'react';

export interface ${request.name}Props {
  title?: string;
  className?: string;
}

export default function ${request.name}({ title = '${request.name}', className = '' }: ${request.name}Props) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
${fetchLogic}

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: '1rem', fontWeight: 500 }}>Loading ${request.name}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1.5rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#991b1b' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Error loading data</h3>
        <p style={{ fontSize: '0.875rem' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className={\`seim-container \${className}\`} style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>{title}</h1>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
          Autonomous component for: ${request.intent}
        </p>
      </header>
      
      <main style={{ background: '#ffffff', borderRadius: '0.5rem', border: '1px solid #e5e7eb', padding: '1.5rem' }}>
        {data.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No items available.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {data.map((item, idx) => (
              <div key={item.id || idx} style={{ padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #f3f4f6' }}>
                <pre style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}>{JSON.stringify(item, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
`;
  }
}
