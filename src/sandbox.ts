import * as vm from 'vm';
import { Request, Response, NextFunction } from 'express';

const BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'crypto', 'dns',
  'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

export class Sandbox {
  private ivm: any | undefined;

  constructor() {
    try {
      this.ivm = require('isolated-vm');
    } catch {
      // Fall back to the built-in vm module if isolated-vm is not installed.
      // Production deployments should always install isolated-vm for a real security boundary.
    }
  }

  public async run(
    code: string,
    originalSource: string,
    req: Request,
    res: Response,
    _next: NextFunction,
    timeoutMs = 500
  ): Promise<unknown> {
    const body = this.extractFunctionBody(code);
    if (this.ivm) {
      return this.runIsolated(body, req, res, timeoutMs);
    }
    return this.runVm(body, originalSource, req, res, timeoutMs);
  }

  private async runIsolated(body: string, req: Request, res: Response, timeoutMs: number): Promise<unknown> {
    const isolate = new this.ivm.Isolate({ memoryLimit: 128 });
    const context = isolate.createContextSync();

    try {
      const reqSnapshot = this.snapshotRequest(req);

      context.global.setSync('__resJson', new this.ivm.Reference(res.json.bind(res)));
      context.global.setSync('__resSend', new this.ivm.Reference(res.send.bind(res)));
      context.global.setSync('__resStatus', new this.ivm.Reference(res.status.bind(res)));
      context.global.setSync('__resEnd', new this.ivm.Reference(res.end.bind(res)));
      context.global.setSync('req', new this.ivm.ExternalCopy(reqSnapshot).copyInto());

      context.evalSync(`
        var res = {
          json: function(body) {
            __resJson.applySync(undefined, [body], { arguments: { copy: true }, result: { reference: true } });
            return res;
          },
          send: function(body) {
            __resSend.applySync(undefined, [body], { arguments: { copy: true }, result: { reference: true } });
            return res;
          },
          status: function(code) {
            __resStatus.applySync(undefined, [code], { arguments: { copy: true }, result: { reference: true } });
            return res;
          },
          end: function() {
            __resEnd.applySync(undefined, [], { arguments: { copy: true }, result: { reference: true } });
          }
        };
        
        // Add helper functions for testing
        var fetchData = async function(id) {
          return { id: id, value: 'data-' + id };
        };
        
        var fetchUsers = async function() {
          return [
            { id: 1, name: 'User 1' },
            { id: 2, name: 'User 2' },
            { id: 3, name: 'User 3' },
            { id: 4, name: 'User 4' },
            { id: 5, name: 'User 5' }
          ];
        };
        
        var fetchUserDetails = async function(userId) {
          return {
            userId: userId,
            details: 'Detailed info for user ' + userId,
            email: 'user' + userId + '@example.com',
            role: 'user'
          };
        };
        
        var getExpensiveData = async function(id) {
          return {
            id: id,
            value: 'expensive-data-' + id,
            timestamp: Date.now()
          };
        };
        
        var fetchData = async function(id) {
          return {
            id: id,
            value: 'data-' + id
          };
        };
      `);

      const script = isolate.compileScriptSync(`(async function() {\n${body}\n})`);
      const fn = script.runSync(context);
      const result = await fn.apply(undefined, [], { timeout: timeoutMs, result: { promise: true } });
      isolate.dispose();
      return result;
    } catch (err) {
      isolate.dispose();
      throw err;
    }
  }

  private async runVm(body: string, originalSource: string, req: Request, res: Response, timeoutMs: number): Promise<unknown> {
    const modules = this.getModules(originalSource);

    const context = vm.createContext({
      console,
      Buffer,
      Promise,
      JSON,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Date,
      Math,
      Error,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      BigInt,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      clearImmediate,
      require: (name: string) => this.requireSafe(name, modules),
      req,
      res,
      // Add helper functions that might be used in optimized code
      fetchData: async (id: number) => ({ id, value: `data-${id}` }),
      fetchUsers: async () => [
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
        { id: 3, name: 'User 3' },
        { id: 4, name: 'User 4' },
        { id: 5, name: 'User 5' }
      ],
      fetchUserDetails: async (userId: number) => ({ 
        userId, 
        details: `Detailed info for user ${userId}`,
        email: `user${userId}@example.com`,
        role: 'user'
      }),
      getExpensiveData: async (id: number) => ({ 
        id, 
        value: `expensive-data-${id}`,
        timestamp: Date.now()
      }),
    });

    const wrapped = `(async (req, res) => {\n${body}\n})(req, res)`;
    const script = new vm.Script(wrapped, { filename: 'seim-shadow.js' });
    const start = Date.now();
    
    try {
      const result = script.runInContext(context, { timeout: timeoutMs });
      const remaining = Math.max(1, timeoutMs - (Date.now() - start));

      return await Promise.race([
        result as Promise<unknown>,
        new Promise((_, reject) => setTimeout(() => reject(new Error('SEIM sandbox wall-clock timeout')), remaining)),
      ]);
    } catch (err) {
      throw err;
    }
  }

  private extractFunctionBody(fnSource: string): string {
    const trimmed = fnSource.trim();
    let m = trimmed.match(/^async\s+function\s*[\w]*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/^function\s*[\w]*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/^(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    m = trimmed.match(/=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}$/);
    if (m) return m[1].trim();
    return trimmed;
  }

  private snapshotRequest(req: Request): Record<string, any> {
    const snapshot: Record<string, any> = {
      method: req.method,
      url: req.url,
      ip: req.ip,
      headers: req.headers,
      params: req.params,
      query: req.query,
      body: req.body,
    };
    // Drop circular or non-cloneable properties defensively.
    try {
      return JSON.parse(JSON.stringify(snapshot));
    } catch {
      return snapshot;
    }
  }

  private getModules(originalSource: string): Map<string, any> {
    const regex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    const modules = new Map<string, any>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(originalSource)) !== null) {
      const name = match[1];
      if (BUILTINS.has(name)) {
        try { modules.set(name, require(name)); } catch {}
      } else if (!name.startsWith('.')) {
        try { modules.set(name, require(name)); } catch {}
      }
    }
    return modules;
  }

  private requireSafe(name: string, modules: Map<string, any>): any {
    if (modules.has(name)) return modules.get(name);
    if (BUILTINS.has(name)) return require(name);
    throw new Error(`SEIM sandbox: module '${name}' is not in the allowed import list`);
  }
}
