import { FrameworkAdapter, RouteHandlerInfo, OnRequestCallback, OnResponseCallback } from './types';
import { normalizePath } from '../routeNormalizer';

export class ExpressAdapter implements FrameworkAdapter {
  readonly name = 'express';

  createMiddleware(onRequest: OnRequestCallback, onResponse: OnResponseCallback): any {
    return (req: any, res: any, next: any) => {
      const start = process.hrtime.bigint();
      const routeKey = this.getRouteKey(req);
      let responseSize = 0;
      let payloadSize = 0;
      let timeout = false;
      const timeoutMs = 30000;
      const timer = setTimeout(() => { timeout = true; }, timeoutMs);

      // Intercept response body size
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      res.json = function (body: any) {
        responseSize = JSON.stringify(body).length;
        return originalJson(body);
      };
      res.send = function (body: any) {
        if (typeof body === 'string') responseSize = Buffer.byteLength(body);
        else if (Buffer.isBuffer(body)) responseSize = body.length;
        return originalSend(body);
      };

      if (req.headers['content-length']) {
        payloadSize = parseInt(req.headers['content-length'], 10) || 0;
      }

      onRequest(req, res, routeKey);

      res.on('finish', () => {
        clearTimeout(timer);
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        const info = {
          statusCode: res.statusCode,
          duration,
          responseSize,
          payloadSize,
          error: res.statusCode >= 500 || timeout,
          timeout,
        };
        
        // Add evolution signals to response headers if enabled
        if (res.seimEvolution) {
          if (res.seimEvolution.schemaVersion) {
            res.setHeader('X-SEIM-Schema-Version', res.seimEvolution.schemaVersion);
          }
          if (res.seimEvolution.featureVariant) {
            res.setHeader('X-SEIM-Feature-Variant', res.seimEvolution.featureVariant);
          }
          if (res.seimEvolution.newFields && res.seimEvolution.newFields.length > 0) {
            res.setHeader('X-SEIM-New-Fields', res.seimEvolution.newFields.join(','));
          }
        }
        
        // Fire and forget — errors handled internally
        try {
          const result = onResponse(req, res, routeKey, info);
          if (result && typeof (result as any).catch === 'function') {
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // never crash the app from seim internals
        }
      });

      next();
    };
  }

  getRouteHandler(req: any): RouteHandlerInfo | undefined {
    const route = req.route;
    const stack = route?.stack;
    if (!Array.isArray(stack)) return undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const handle = stack[i]?.handle;
      if (typeof handle === 'function') {
        return { route, index: i, handle, source: handle.toString() };
      }
    }
    return undefined;
  }

  private warnedPaths = new Set<string>();

  swapHandler(routeInfo: RouteHandlerInfo, newHandler: Function): void {
    routeInfo.route.stack[routeInfo.index].handle = newHandler;
  }

  getRouteKey(req: any): string {
    const routePath = req.route?.path as string | undefined;
    if (routePath) return routePath;
    const raw = req.path || req.url || '/';
    return normalizePath(raw);
  }
}
