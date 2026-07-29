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
    const cooldown = this.config.experiment.shadowCooldownMs || 60000;
    
    // If cooldown is 0, always allow (for testing)
    if (cooldown === 0) return true;
    
    const last = this.lastRun.get(key) || 0;

    if (now - last < cooldown) return false;

    this.lastRun.set(key, now);
    this.evictIfNeeded();
    return true;
  }

  private key(req: Request, routeKey: string): string {
    const userId = (req as any).user?.id || (req as any).userId;
    const ip = req.ip || req.headers['x-forwarded-for'] || (req as any).socket?.remoteAddress || 'unknown';
    const id = userId ? `u:${userId}` : `ip:${ip}`;
    return `${routeKey}::${id}`;
  }

  private evictIfNeeded(): void {
    if (this.lastRun.size <= 10000) return;
    const first = this.lastRun.keys().next().value;
    if (first !== undefined) this.lastRun.delete(first);
  }
}
