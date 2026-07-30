import { EventEmitter } from 'events';
import { OptimizationCandidate, ExperimentReport } from './types';

export interface SeimEvents {
  'optimization:detected': { routeKey: string; pattern: string; severity: string; candidateId: string };
  'optimization:validated': { routeKey: string; candidateId: string; report: any };
  'optimization:promoted': { routeKey: string; candidateId: string; latencyImprovement: number };
  'optimization:rejected': { routeKey: string; candidateId: string; reason: string };
  'optimization:rolledback': { routeKey: string; reason: string };
  'shadow:started': { routeKey: string; candidateId: string };
  'shadow:completed': { routeKey: string; v1Latency: number; v2Latency: number; improvement: number };
  'health:degraded': { routeKey: string; healthScore: number; reason: string };
  'health:recovered': { routeKey: string; healthScore: number };
  'error:sandbox': { routeKey: string; error: string };
  'error:validation': { routeKey: string; layer: string; reason: string };
  'error:internal': { component: string; error: string; stack?: string };
  'metrics:threshold': { routeKey: string; metric: string; value: number; threshold: number };
  'worker:cycle': { routesAnalyzed: number; candidatesFound: number; duration: number };
  'lifecycle:started': { mode: string; framework: string };
  'lifecycle:shutdown': { reason: string };
}

export type SeimEventName = keyof SeimEvents;

export class SeimEventBus extends EventEmitter {
  public emitEvent<K extends SeimEventName>(event: K, payload: SeimEvents[K]): boolean {
    return this.emit(event, payload);
  }

  public onEvent<K extends SeimEventName>(event: K, listener: (payload: SeimEvents[K]) => void): this {
    return this.on(event, listener);
  }

  public onceEvent<K extends SeimEventName>(event: K, listener: (payload: SeimEvents[K]) => void): this {
    return this.once(event, listener);
  }
}
