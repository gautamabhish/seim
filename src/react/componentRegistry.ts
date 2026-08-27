import { ReactComponent, FrontendRouteConfig } from './types';

export class ReactComponentRegistry {
  private components: Map<string, ReactComponent> = new Map();
  private byName: Map<string, string> = new Map();
  private routes: FrontendRouteConfig[] = [];

  public register(component: ReactComponent): void {
    this.components.set(component.id, component);
    this.byName.set(component.name, component.id);
  }

  public getById(id: string): ReactComponent | undefined {
    return this.components.get(id);
  }

  public getByName(name: string): ReactComponent | undefined {
    const id = this.byName.get(name);
    return id ? this.components.get(id) : undefined;
  }

  public update(id: string, updates: Partial<ReactComponent>): ReactComponent | undefined {
    const existing = this.components.get(id);
    if (!existing) return undefined;
    
    const updated: ReactComponent = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: Date.now()
    };
    
    this.components.set(id, updated);
    this.byName.set(updated.name, id);
    return updated;
  }

  public registerRoute(route: FrontendRouteConfig): void {
    this.routes.push(route);
  }

  public getRoutes(): FrontendRouteConfig[] {
    return [...this.routes].sort((a, b) => b.path.length - a.path.length);
  }

  public generateRouterCode(): string {
    const routes = this.getRoutes();
    const imports = routes.map(r => 
      `import ${r.componentName} from './pages/${r.componentName}';`
    ).join('\n');
    
    const routeDeclarations = routes.map(r => 
      `      <Route path="${r.path}" element={<${r.componentName} />} />`
    ).join('\n');

    return `import React from 'react';\nimport { Routes, Route } from 'react-router-dom';\n${imports}\n\nexport default function AppRoutes() {\n  return (\n    <Routes>\n${routeDeclarations}\n    </Routes>\n  );\n}\n`;
  }

  public listAll(): ReactComponent[] {
    return Array.from(this.components.values());
  }

  public export(): { components: ReactComponent[]; routes: FrontendRouteConfig[] } {
    return {
      components: this.listAll(),
      routes: [...this.routes]
    };
  }

  public import(data: { components: ReactComponent[]; routes: FrontendRouteConfig[] }): void {
    this.components.clear();
    this.byName.clear();
    this.routes = [];
    
    for (const comp of data.components) {
      this.register(comp);
    }
    for (const route of data.routes) {
      this.registerRoute(route);
    }
  }
}
