import { SeimConfig } from './types';
import { Logger } from './logger';
import { SeimEventBus } from './events';

export interface AutoMiddlewareResult {
  type: string;
  description: string;
  applied: boolean;
}

/**
 * AutoMiddlewareEngine detects and suggests/applies performance middleware
 * based on observed traffic patterns.
 */
export class AutoMiddlewareEngine {
  private etagCache = new Map<string, { hash: string; body: string }>();
  private responseCache = new Map<string, { body: any; cachedAt: number; ttl: number }>();

  constructor(
    private config: SeimConfig,
    private logger: Logger,
    private events: SeimEventBus,
  ) {}

  /**
   * Analyze a response and apply/suggest auto-middleware optimizations.
   */
  public analyze(routeKey: string, req: any, res: any, responseBody: any): AutoMiddlewareResult[] {
    const results: AutoMiddlewareResult[] = [];

    if (this.config.autoMiddleware?.etag !== false) {
      const etagResult = this.checkETag(routeKey, req, res, responseBody);
      if (etagResult) results.push(etagResult);
    }

    if (this.config.autoMiddleware?.caching !== false) {
      const cacheResult = this.checkResponseCache(routeKey, req, responseBody);
      if (cacheResult) results.push(cacheResult);
    }

    return results;
  }

  /**
   * Check if GET endpoint could benefit from ETag headers.
   */
  private checkETag(routeKey: string, req: any, res: any, body: any): AutoMiddlewareResult | null {
    if (req.method !== 'GET') return null;

    // Only for JSON responses
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    if (!bodyStr) return null;

    // Simple hash using string length + first/last chars (fast, not cryptographic)
    const hash = this.quickHash(bodyStr);
    const cached = this.etagCache.get(routeKey);

    if (cached && cached.hash === hash) {
      // Same response as before — ETag would have saved bandwidth
      return {
        type: 'etag',
        description: `ETag would save bandwidth for ${routeKey} (response unchanged)`,
        applied: false,
      };
    }

    this.etagCache.set(routeKey, { hash, body: bodyStr });
    // Evict old entries
    if (this.etagCache.size > 1000) {
      const first = this.etagCache.keys().next().value;
      if (first !== undefined) this.etagCache.delete(first);
    }
    return null;
  }

  /**
   * Check if idempotent GET endpoint has stable responses that could be cached.
   */
  private checkResponseCache(routeKey: string, req: any, body: any): AutoMiddlewareResult | null {
    if (req.method !== 'GET') return null;

    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const hash = this.quickHash(bodyStr);
    const cached = this.responseCache.get(routeKey);

    if (cached) {
      const age = Date.now() - cached.cachedAt;
      const cachedHash = this.quickHash(typeof cached.body === 'string' ? cached.body : JSON.stringify(cached.body));
      if (cachedHash === hash && age > 5000) {
        // Response unchanged for >5s — caching candidate
        return {
          type: 'response-cache',
          description: `Response for ${routeKey} is stable (${Math.round(age / 1000)}s unchanged). Caching would reduce compute.`,
          applied: false,
        };
      }
    }

    this.responseCache.set(routeKey, { body, cachedAt: Date.now(), ttl: 30000 });
    if (this.responseCache.size > 1000) {
      const first = this.responseCache.keys().next().value;
      if (first !== undefined) this.responseCache.delete(first);
    }
    return null;
  }

  private quickHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `${hash}:${str.length}`;
  }
}
