import { OptimizationCandidate, ValidationReport } from './types';
import { ShadowRunResult } from './shadow';

/**
 * Represents the current status of an optimization candidate in its lifecycle.
 */
export type CandidateStatus =
  | 'detected'
  | 'generated'
  | 'static-checked'
  | 'shadowing'
  | 'shadow-complete'
  | 'approved'
  | 'canary'
  | 'promoted'
  | 'rejected'
  | 'rolled-back';

/**
 * Represents a single sample collected during a shadow test execution.
 */
export interface ShadowSample {
  v1Latency: number;
  v2Latency: number;
  v1Error: boolean;
  v2Error: boolean;
  v1Output: unknown;
  v2Output: unknown;
  sampledAt: number;
}

/**
 * Wraps an OptimizationCandidate with its runtime lifecycle state.
 */
export interface LiveCandidate {
  candidate: OptimizationCandidate;
  status: CandidateStatus;
  shadowSamplesCollected: number;
  shadowSamplesRequired: number;
  shadowSamples: ShadowSample[];
  validationReport?: ValidationReport;
  statusHistory: { status: CandidateStatus; at: number; reason?: string }[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Manages the lifecycle and state transitions of optimization candidates.
 */
export class CandidateLifecycleManager {
  private active: Map<string, LiveCandidate> = new Map();

  private readonly STALE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Registers a new candidate and initializes its lifecycle.
   */
  public register(routeKey: string, candidate: OptimizationCandidate, requiredSamples: number): LiveCandidate {
    this.cleanupStale();
    const now = Date.now();
    const liveCandidate: LiveCandidate = {
      candidate,
      status: 'generated',
      shadowSamplesCollected: 0,
      shadowSamplesRequired: requiredSamples,
      shadowSamples: [],
      statusHistory: [{ status: 'generated', at: now }],
      createdAt: now,
      updatedAt: now,
    };
    this.active.set(routeKey, liveCandidate);
    return liveCandidate;
  }

  /**
   * Cleans up stale candidates that never reached completion within TTL.
   */
  public cleanupStale(maxAgeMs: number = this.STALE_TTL_MS): number {
    const now = Date.now();
    let count = 0;
    for (const [routeKey, candidate] of this.active.entries()) {
      if (now - candidate.createdAt > maxAgeMs) {
        this.active.delete(routeKey);
        count++;
      }
    }
    return count;
  }

  /**
   * Records a shadow sample.
   * Returns true when the required number of shadow samples has been collected.
   */
  public recordShadowSample(routeKey: string, sample: ShadowSample): boolean {
    const liveCandidate = this.active.get(routeKey);
    if (!liveCandidate) {
      return false;
    }

    liveCandidate.shadowSamples.push(sample);
    liveCandidate.shadowSamplesCollected += 1;
    liveCandidate.updatedAt = Date.now();

    if (liveCandidate.shadowSamplesCollected === 1 && liveCandidate.status !== 'shadowing') {
      this.transition(routeKey, 'shadowing');
    }

    if (liveCandidate.shadowSamplesCollected >= liveCandidate.shadowSamplesRequired) {
      if (liveCandidate.status !== 'shadow-complete') {
        this.transition(routeKey, 'shadow-complete');
      }
      return true;
    }

    return false;
  }

  /**
   * Transitions a candidate to a new status.
   */
  public transition(routeKey: string, newStatus: CandidateStatus, reason?: string): void {
    const liveCandidate = this.active.get(routeKey);
    if (!liveCandidate) return;

    liveCandidate.status = newStatus;
    liveCandidate.updatedAt = Date.now();
    liveCandidate.statusHistory.push({ status: newStatus, at: liveCandidate.updatedAt, reason });
  }

  /**
   * Retrieves the candidate for shadow testing without removing it from the active map.
   */
  public getCandidateForShadow(routeKey: string): LiveCandidate | undefined {
    return this.active.get(routeKey);
  }

  /**
   * Checks if an active candidate exists for the given route key.
   */
  public hasActiveCandidate(routeKey: string): boolean {
    return this.active.has(routeKey);
  }

  /**
   * Retrieves the active candidate for the given route key.
   */
  public getCandidate(routeKey: string): LiveCandidate | undefined {
    return this.active.get(routeKey);
  }

  /**
   * Removes a candidate from the active map.
   */
  public remove(routeKey: string): void {
    this.active.delete(routeKey);
  }

  /**
   * Returns all active candidates.
   */
  public getAll(): Map<string, LiveCandidate> {
    return this.active;
  }

  /**
   * Clears all active candidates.
   */
  public clear(): void {
    this.active.clear();
  }
}
