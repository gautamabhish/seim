import { Request } from 'express';
import { SeimConfig } from './types';

export class ShadowLimiter {
  private lastRun = new Map<string, number>();

  constructor(private config: SeimConfig) {}

  public canRun(req: Request, routeKey: string): boolean {
    const allowed = this.config.experiment.shadowAllowedMethods || ['GET'];
    if (!allowed.includes(req.method)) return false;

    const key = this.key(req, routeKey);
    const now = Date.now();
    const cooldown = this.config.experiment.shadowCooldownMs ?? 60000;
    
    // If cooldown is 0, always allow (for testing)
    if (cooldown === 0) return true;
    
    const last = this.lastRun.get(key) || 0;

    if (now - last < cooldown) return false;

    this.lastRun.set(key, now);
    this.evictIfNeeded();
    return true;
  }

  private key(req: Request, routeKey: string): string {
    // Priority: user ID > session ID > x-request-id > x-forwarded-for > IP
    // This ensures proper keying behind load balancers where all traffic
    // comes from the same internal IP.
    const userId = (req as any).user?.id || (req as any).userId;
    if (userId) return `${routeKey}::u:${userId}`;

    const sessionId = (req as any).session?.id || (req as any).sessionID;
    if (sessionId) return `${routeKey}::s:${sessionId}`;

    const requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    if (requestId) return `${routeKey}::r:${requestId}`;

    // For load-balanced envs, x-forwarded-for contains the real client IP
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = forwarded
      ? (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded[0])
      : req.ip || (req as any).socket?.remoteAddress || 'unknown';
    return `${routeKey}::ip:${clientIp}`;
  }

  private evictIfNeeded(): void {
    if (this.lastRun.size <= 10000) return;
    const first = this.lastRun.keys().next().value;
    if (first !== undefined) this.lastRun.delete(first);
  }
}
