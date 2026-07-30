/**
 * CallGraph maps function calls across route handlers.
 * Used for cross-route intelligence: when a shared function is optimized
 * in one route, related routes can be flagged for re-evaluation.
 */
export class CallGraph {
  // functionName → set of routeKeys that call it
  private functionToRoutes: Map<string, Set<string>> = new Map();
  // routeKey → set of function names it calls
  private routeToFunctions: Map<string, Set<string>> = new Map();

  private static readonly SKIP_NAMES = new Set([
    'if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'typeof',
    'void', 'delete', 'async', 'await', 'const', 'let', 'var', 'function',
    'Promise', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
    'Date', 'Math', 'Error', 'RegExp', 'Map', 'Set', 'console', 'Buffer',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'clearImmediate', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'require', 'structuredClone', 'fetch', 'res', 'req', 'next',
  ]);

  /**
   * Register a route's source code, extracting its function call graph.
   */
  public register(routeKey: string, sourceCode: string): void {
    const functions = this.extractFunctionNames(sourceCode);
    this.routeToFunctions.set(routeKey, new Set(functions));

    for (const fn of functions) {
      let routes = this.functionToRoutes.get(fn);
      if (!routes) {
        routes = new Set();
        this.functionToRoutes.set(fn, routes);
      }
      routes.add(routeKey);
    }
  }

  /**
   * Find all routes that share function calls with a given route.
   * Excludes the route itself.
   */
  public findRelatedRoutes(routeKey: string): string[] {
    const functions = this.routeToFunctions.get(routeKey);
    if (!functions) return [];

    const related = new Set<string>();
    for (const fn of functions) {
      const routes = this.functionToRoutes.get(fn);
      if (routes) {
        for (const r of routes) {
          if (r !== routeKey) related.add(r);
        }
      }
    }
    return Array.from(related);
  }

  /**
   * Find all routes that call a specific function.
   */
  public routesCallingFunction(functionName: string): string[] {
    const routes = this.functionToRoutes.get(functionName);
    return routes ? Array.from(routes) : [];
  }

  /**
   * Get the shared functions between two routes.
   */
  public sharedFunctions(routeKeyA: string, routeKeyB: string): string[] {
    const fnsA = this.routeToFunctions.get(routeKeyA);
    const fnsB = this.routeToFunctions.get(routeKeyB);
    if (!fnsA || !fnsB) return [];

    return Array.from(fnsA).filter(fn => fnsB.has(fn));
  }

  /**
   * Get all functions called by a route.
   */
  public functionsForRoute(routeKey: string): string[] {
    const fns = this.routeToFunctions.get(routeKey);
    return fns ? Array.from(fns) : [];
  }

  /**
   * Get the number of routes calling each function (hotspot analysis).
   * Functions called by many routes are high-impact optimization targets.
   */
  public hotspots(minRoutes = 2): { name: string; routeCount: number; routes: string[] }[] {
    const result: { name: string; routeCount: number; routes: string[] }[] = [];
    for (const [name, routes] of this.functionToRoutes) {
      if (routes.size >= minRoutes) {
        result.push({ name, routeCount: routes.size, routes: Array.from(routes) });
      }
    }
    return result.sort((a, b) => b.routeCount - a.routeCount);
  }

  public size(): { routes: number; functions: number } {
    return {
      routes: this.routeToFunctions.size,
      functions: this.functionToRoutes.size,
    };
  }

  // ---- Private ----

  private extractFunctionNames(source: string): string[] {
    const callRegex = /(?:await\s+)?(\w+)\s*\(/g;
    const names: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      const name = match[1];
      if (!CallGraph.SKIP_NAMES.has(name)) {
        names.push(name);
      }
    }
    return [...new Set(names)];
  }
}
