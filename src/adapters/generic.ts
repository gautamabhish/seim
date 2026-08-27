import { FrameworkAdapter, RouteHandlerInfo, OnRequestCallback, OnResponseCallback } from './types';
import { normalizePath } from '../routeNormalizer';

/**
 * Generic Node.js HTTP adapter.
 *
 * Works with raw `http.createServer` or any framework not specifically
 * supported. Provides metrics collection and CI/CD output but cannot
 * hot-swap handlers (requires restart).
 */
export class GenericHttpAdapter implements FrameworkAdapter {
  readonly name = 'http';

  createMiddleware(onRequest: OnRequestCallback, onResponse: OnResponseCallback): any {
    return (req: any, res: any, next?: Function) => {
      const start = process.hrtime.bigint();
      const routeKey = this.getRouteKey(req);
      const payloadSize = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) || 0 : 0;

      onRequest(req, res, routeKey);

      const originalEnd = res.end.bind(res);
      let responseSize = 0;

      res.end = function (chunk: any, ...args: any[]) {
        if (chunk) {
          responseSize += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        }
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        const info = {
          statusCode: res.statusCode,
          duration,
          responseSize,
          payloadSize,
          error: res.statusCode >= 500,
          timeout: false,
        };
        try {
          const result = onResponse(req, res, routeKey, info);
          if (result && typeof (result as any).catch === 'function') {
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // never crash
        }
        return originalEnd(chunk, ...args);
      };

      if (typeof next === 'function') next();
    };
  }

  getRouteHandler(_req: any): RouteHandlerInfo | undefined {
    return undefined;
  }

  swapHandler(_routeInfo: RouteHandlerInfo, _newHandler: Function): void {
    // No-op for generic HTTP — optimizations go through CI/CD
  }

  getRouteKey(req: any): string {
    return normalizePath(req.url || '/');
  }
}
