import { SeimEventBus } from './events';
import { Logger } from './logger';

export interface WorkerTask {
  routeKey: string;
  priority: number;
  enqueuedAt: number;
}

export class OptimizationWorker {
  private queue: Map<string, WorkerTask> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processFn: ((task: WorkerTask) => Promise<void>) | null = null;

  constructor(
    private intervalMs: number,
    private events: SeimEventBus,
    private logger: Logger,
  ) {}

  public setProcessor(fn: (task: WorkerTask) => Promise<void>): void {
    this.processFn = fn;
  }

  public enqueue(routeKey: string, priority = 1): void {
    const existing = this.queue.get(routeKey);
    if (existing) {
      // Bump priority if higher
      if (priority > existing.priority) existing.priority = priority;
      return;
    }
    this.queue.set(routeKey, { routeKey, priority, enqueuedAt: Date.now() });
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.cycle(), this.intervalMs);
    // Don't keep the process alive just for seim
    if (this.timer.unref) this.timer.unref();
    this.logger.debug('Optimization worker started', { intervalMs: this.intervalMs });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.debug('Optimization worker stopped');
  }

  public queueSize(): number {
    return this.queue.size;
  }

  private async cycle(): Promise<void> {
    if (this.running || !this.processFn || this.queue.size === 0) return;
    this.running = true;
    const start = Date.now();
    let analyzed = 0;
    let found = 0;

    try {
      // Sort by priority descending, then age ascending
      const tasks = Array.from(this.queue.values()).sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.enqueuedAt - b.enqueuedAt;
      });

      // Process up to 5 routes per cycle to avoid blocking
      const batch = tasks.slice(0, 5);
      for (const task of batch) {
        this.queue.delete(task.routeKey);
        try {
          await this.processFn(task);
          analyzed++;
        } catch (err) {
          this.logger.warn('Worker task failed', {
            routeKey: task.routeKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      this.events.emitEvent('error:internal', {
        component: 'worker',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      this.running = false;
      const duration = Date.now() - start;
      if (analyzed > 0) {
        this.events.emitEvent('worker:cycle', {
          routesAnalyzed: analyzed,
          candidatesFound: found,
          duration,
        });
        this.logger.debug('Worker cycle completed', { analyzed, duration });
      }
    }
  }
}
