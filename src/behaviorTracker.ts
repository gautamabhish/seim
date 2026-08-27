export interface BehaviorEvent {
  sessionId: string;
  type: 'pageview' | 'api_call' | 'error_404' | 'error_5xx' | 'navigation' | 'action';
  path: string;
  method?: string;
  referrer?: string;
  statusCode?: number;
  durationMs?: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface UserSession {
  sessionId: string;
  startedAt: number;
  lastSeenAt: number;
  events: BehaviorEvent[];
  journey: string[];
}

export interface BehaviorPattern {
  type: 'missing_feature' | 'high_demand' | 'drop_off' | 'rage_click' | 'navigation_loop' | 'slow_endpoint';
  path: string;
  frequency: number;
  affectedSessions: number;
  firstSeenAt: number;
  lastSeenAt: number;
  evidence: BehaviorEvent[];
  suggestedAction?: string;
}

export class BehaviorTracker {
  private sessions: Map<string, UserSession> = new Map();
  private events: BehaviorEvent[] = [];
  private readonly MAX_EVENTS = 10000;
  private readonly MAX_SESSIONS = 5000;
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Schedule periodic cleanup to prevent unbounded memory growth
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    this.events = [];
  }

  public record(event: BehaviorEvent): void {
    if (this.events.length >= this.MAX_EVENTS) {
      this.events.shift();
    }
    this.events.push(event);

    const session = this.getSession(event.sessionId);
    session.lastSeenAt = event.timestamp;
    session.events.push(event);
    if (event.path && event.path !== session.journey[session.journey.length - 1]) {
      session.journey.push(event.path);
    }
  }

  public middleware(): (req: any, res: any, next: () => void) => void {
    return (req: any, res: any, next: () => void) => {
      try {
        const startTime = Date.now();
        let sessionId = '';
        
        if (req.cookies && req.cookies.seid) sessionId = req.cookies.seid;
        else if (req.headers && req.headers['x-session-id']) sessionId = req.headers['x-session-id'];
        else sessionId = req.ip || 'anonymous';
        
        sessionId = String(sessionId);

        res.on('finish', () => {
          const durationMs = Date.now() - startTime;
          const statusCode = res.statusCode;
          let type: BehaviorEvent['type'] = 'api_call';
          
          if (statusCode === 404) type = 'error_404';
          else if (statusCode >= 500) type = 'error_5xx';
          else if (req.method === 'GET' && req.accepts && req.accepts('html')) type = 'pageview';

          this.record({
            sessionId,
            type,
            path: req.path || req.url,
            method: req.method,
            referrer: req.headers ? req.headers.referer : undefined,
            statusCode,
            durationMs,
            timestamp: Date.now(),
          });
        });
      } catch (e) {
        // Silently fail rather than crashing the request
      }
      next();
    };
  }

  public getSession(sessionId: string): UserSession {
    if (!this.sessions.has(sessionId)) {
      if (this.sessions.size >= this.MAX_SESSIONS) {
        this.cleanup();
        // If still over capacity after cleanup, evict oldest session
        if (this.sessions.size >= this.MAX_SESSIONS) {
          const oldestKey = this.sessions.keys().next().value;
          if (oldestKey) this.sessions.delete(oldestKey);
        }
      }
      this.sessions.set(sessionId, {
        sessionId,
        startedAt: Date.now(),
        lastSeenAt: Date.now(),
        events: [],
        journey: []
      });
    }
    return this.sessions.get(sessionId)!;
  }

  public analyze(): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];
    const now = Date.now();

    // 1. Missing Features (404s happening >= 3 times across sessions)
    const missing = this.getMissingFeatures(1);
    for (const m of missing) {
      if (m.sessions >= 3) {
        const evidence = this.events.filter(e => e.type === 'error_404' && e.path === m.path);
        patterns.push({
          type: 'missing_feature',
          path: m.path,
          frequency: m.count,
          affectedSessions: m.sessions,
          firstSeenAt: evidence.length ? evidence[0].timestamp : now,
          lastSeenAt: evidence.length ? evidence[evidence.length - 1].timestamp : now,
          evidence
        });
      }
    }

    // 2. High Demand (>100 hits)
    const pathCounts = new Map<string, {count: number, sessions: Set<string>, events: BehaviorEvent[]}>();
    for (const e of this.events) {
      if (!pathCounts.has(e.path)) pathCounts.set(e.path, {count: 0, sessions: new Set(), events: []});
      const pc = pathCounts.get(e.path)!;
      pc.count++;
      pc.sessions.add(e.sessionId);
      pc.events.push(e);
    }
    
    for (const [path, data] of pathCounts.entries()) {
      if (data.count > 100) {
        patterns.push({
          type: 'high_demand',
          path,
          frequency: data.count,
          affectedSessions: data.sessions.size,
          firstSeenAt: data.events[0].timestamp,
          lastSeenAt: data.events[data.events.length - 1].timestamp,
          evidence: data.events
        });
      }
    }

    // 3. Drop Off (>3 visits to same path without conversion in a session)
    for (const [sessionId, session] of this.sessions.entries()) {
      const pathVisits = new Map<string, number>();
      for (const e of session.events) {
        pathVisits.set(e.path, (pathVisits.get(e.path) || 0) + 1);
      }
      for (const [path, count] of pathVisits.entries()) {
        if (count > 3) {
          const evs = session.events.filter(e => e.path === path);
          patterns.push({
            type: 'drop_off',
            path,
            frequency: count,
            affectedSessions: 1,
            firstSeenAt: evs[0].timestamp,
            lastSeenAt: evs[evs.length - 1].timestamp,
            evidence: evs
          });
        }
      }
    }

    // 4. Navigation Loop (sequences repeating A, B, A, B)
    for (const [sessionId, session] of this.sessions.entries()) {
      const j = session.journey;
      for (let i = 0; i < j.length - 3; i++) {
        if (j[i] === j[i+2] && j[i+1] === j[i+3] && j[i] !== j[i+1]) {
          const evidence = session.events.slice(i, i + 4);
          patterns.push({
            type: 'navigation_loop',
            path: j[i],
            frequency: 1,
            affectedSessions: 1,
            firstSeenAt: evidence.length ? evidence[0].timestamp : now,
            lastSeenAt: evidence.length ? evidence[evidence.length - 1].timestamp : now,
            evidence
          });
          break; // Avoid emitting many loops for same session immediately
        }
      }
    }

    // 5. Slow Endpoint (avg > 2000ms)
    const pathDuration = new Map<string, {total: number, count: number, sessions: Set<string>, events: BehaviorEvent[]}>();
    for (const e of this.events) {
      if (e.durationMs !== undefined) {
        if (!pathDuration.has(e.path)) pathDuration.set(e.path, {total: 0, count: 0, sessions: new Set(), events: []});
        const pd = pathDuration.get(e.path)!;
        pd.total += e.durationMs;
        pd.count++;
        pd.sessions.add(e.sessionId);
        pd.events.push(e);
      }
    }

    for (const [path, data] of pathDuration.entries()) {
      if (data.total / data.count > 2000) {
        patterns.push({
          type: 'slow_endpoint',
          path,
          frequency: data.count,
          affectedSessions: data.sessions.size,
          firstSeenAt: data.events[0].timestamp,
          lastSeenAt: data.events[data.events.length - 1].timestamp,
          evidence: data.events
        });
      }
    }

    return patterns;
  }

  public getMissingFeatures(minFrequency: number = 1): { path: string; method: string; count: number; sessions: number }[] {
    const missing = new Map<string, {count: number, sessions: Set<string>, method: string}>();
    for (const e of this.events) {
      if (e.type === 'error_404') {
        const key = `${e.method || 'GET'}:${e.path}`;
        if (!missing.has(key)) missing.set(key, {count: 0, sessions: new Set(), method: e.method || 'GET'});
        const m = missing.get(key)!;
        m.count++;
        m.sessions.add(e.sessionId);
      }
    }
    const res: { path: string; method: string; count: number; sessions: number }[] = [];
    for (const [key, data] of missing.entries()) {
      if (data.count >= minFrequency) {
        res.push({
          path: key.split(':')[1],
          method: data.method,
          count: data.count,
          sessions: data.sessions.size
        });
      }
    }
    return res.sort((a, b) => b.count - a.count);
  }

  public getHotPaths(limit: number = 10): { path: string; count: number; avgDuration?: number }[] {
    const pathCounts = new Map<string, {count: number, totalDur: number}>();
    for (const e of this.events) {
      if (!pathCounts.has(e.path)) pathCounts.set(e.path, {count: 0, totalDur: 0});
      const pc = pathCounts.get(e.path)!;
      pc.count++;
      if (e.durationMs) pc.totalDur += e.durationMs;
    }
    const res: { path: string; count: number; avgDuration?: number }[] = [];
    for (const [path, data] of pathCounts.entries()) {
      res.push({
        path,
        count: data.count,
        avgDuration: data.count > 0 ? data.totalDur / data.count : undefined
      });
    }
    return res.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  public getNavigationSequences(minSupport: number = 2): { sequence: string[]; count: number }[] {
    const seqCounts = new Map<string, number>();
    for (const session of this.sessions.values()) {
      const j = session.journey;
      for (let i = 0; i < j.length - 2; i++) {
        const seq = [j[i], j[i+1], j[i+2]].join('|||');
        seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
      }
    }
    const res: { sequence: string[]; count: number }[] = [];
    for (const [seq, count] of seqCounts.entries()) {
      if (count >= minSupport) {
        res.push({
          sequence: seq.split('|||'),
          count
        });
      }
    }
    return res.sort((a, b) => b.count - a.count);
  }

  public snapshot(): {
    totalSessions: number;
    totalEvents: number;
    activeSessions: number;
    patterns: BehaviorPattern[];
    topMissingFeatures: any[];
    topPaths: any[];
  } {
    const now = Date.now();
    let active = 0;
    for (const session of this.sessions.values()) {
      if (now - session.lastSeenAt < this.SESSION_TIMEOUT_MS) active++;
    }

    return {
      totalSessions: this.sessions.size,
      totalEvents: this.events.length,
      activeSessions: active,
      patterns: this.analyze(),
      topMissingFeatures: this.getMissingFeatures(1).slice(0, 5),
      topPaths: this.getHotPaths(5)
    };
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastSeenAt > this.SESSION_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
