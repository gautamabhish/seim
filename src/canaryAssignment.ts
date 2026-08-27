import { createHash } from 'crypto';

export type AssignmentKey = 'session-id' | 'user-id' | 'ip' | 'request-id';

export interface CanaryAssigner {
  /**
   * Deterministically assign a request to original or canary.
   * The same request attribute always gets the same assignment.
   */
  shouldUseCanary(req: any, canaryPercent: number): boolean;
}

export class StableCanaryAssigner implements CanaryAssigner {
  constructor(private assignmentKey: AssignmentKey = 'ip') {}

  public shouldUseCanary(req: any, canaryPercent: number): boolean {
    if (canaryPercent >= 100) return true;
    if (canaryPercent <= 0) return false;

    const key = this.extractKey(req);
    // Hash key with MD5 and extract bucket in range 0-99
    const hash = createHash('md5').update(key).digest();
    const bucket = hash.readUInt16BE(0) % 100;
    return bucket < canaryPercent;
  }

  private extractKey(req: any): string {
    if (!req) return String(Math.random());

    switch (this.assignmentKey) {
      case 'session-id':
        return (
          req.sessionID ||
          req.session?.id ||
          req.cookies?.['connect.sid'] ||
          req.headers?.['x-session-id'] ||
          this.fallbackKey(req)
        );
      case 'user-id':
        return (
          req.user?.id ||
          req.user?._id ||
          req.userId ||
          req.headers?.['x-user-id'] ||
          this.fallbackKey(req)
        );
      case 'request-id':
        return (
          req.headers?.['x-request-id'] ||
          req.id ||
          this.fallbackKey(req)
        );
      case 'ip':
      default:
        return this.fallbackKey(req);
    }
  }

  private fallbackKey(req: any): string {
    return (
      req.ip ||
      req.headers?.['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      'unknown-client'
    );
  }
}
