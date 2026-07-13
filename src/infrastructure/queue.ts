import { logger } from '../shared/logger';

interface QueueItem<T> {
  id: string;
  priority: number;
  task: () => Promise<T>;
  cancelled: boolean;
  enqueuedAt: number;
}

interface PromiseController<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class ConcurrentQueue<T = void> {
  private items: QueueItem<T>[] = [];
  private _pendingCount = 0;
  private idSeq = 0;
  private _concurrency = 2;

  setConcurrency(n: number): void { this._concurrency = Math.max(1, Math.min(10, n)); }

  // [BUG-FIX] F1 - Track promise controllers for cancel() rejection and TTL support
  private promiseMap = new Map<string, PromiseController<T>>();
  // [BUG-FIX] F1 - Track TTL timers for cleanup on cancel/completion
  private ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();

  get concurrency(): number {
    return this._concurrency;
  }

  set concurrency(val: number) {
    this._concurrency = val;
    this.schedule();
  }

  // [BUG-FIX] F1 - Added optional ttl parameter; returns string for backward compatibility
  //                Internal promise is tracked via promiseMap for cancel/TTL rejection
  enqueue(task: () => Promise<T>, priority = 0, ttl?: number): string {
    const id = `q_${++this.idSeq}`;

    // Create internal promise controller for cancel/TTL support
    const controller: PromiseController<T> = {
      resolve: () => { /* placeholder, overwritten below */ },
      reject: () => { /* placeholder, overwritten below */ },
    };
    // Capture resolve/reject by constructing a Promise; attach catch to avoid unhandled rejection
    // since the promise is internal (callers get only the string ID for backward compatibility)
    new Promise<T>((resolve, reject) => {
      controller.resolve = resolve;
      controller.reject = reject;
    }).catch(() => {
      // Internal promise — no external consumer; rejections are logged elsewhere
    });

    this.promiseMap.set(id, controller);

    // [BUG-FIX] F1 - TTL support: auto-reject and remove task if not started within timeout
    if (typeof ttl === 'number' && ttl > 0) {
      const timer = setTimeout(() => {
        logger.warn('QUEUE', id, `任务超时: ${id} (${ttl}ms)`);
        controller.reject(new Error(`Task ${id} timed out after ${ttl}ms`));
        this.cancelInternal(id);
      }, ttl);
      this.ttlTimers.set(id, timer);
    }

    this.items.push({ id, priority, task, cancelled: false, enqueuedAt: Date.now() });
    logger.debug('QUEUE', id, '任务入队: ' + id);
    this.schedule();
    return id;
  }

  dequeue(): (() => Promise<T>) | null {
    const idx = this.findNextIndex();
    if (idx === -1) return null;
    return this.items.splice(idx, 1)[0].task;
  }

  // [BUG-FIX] F1 - Reject the internal promise when cancelling to avoid dead promise
  cancel(id: string): boolean {
    const idx = this.items.findIndex(it => it.id === id);
    if (idx === -1) return false;
    const item = this.items[idx];
    item.cancelled = true;
    this.items.splice(idx, 1);

    const controller = this.promiseMap.get(id);
    if (controller) {
      controller.reject(new Error(`Task ${id} cancelled`));
      this.promiseMap.delete(id);
    }

    // Clear TTL timer if active
    const timer = this.ttlTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(id);
    }

    return true;
  }

  size(): number {
    return this.items.length;
  }

  pendingCount(): number {
    return this._pendingCount;
  }

  // Stagger: wait between batches
  private scheduling = false;
  private lastBatchTime = 0;

  private async schedule(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    // 2s gap between batches: wait if previous batch just finished
    if (this.lastBatchTime > 0 && Date.now() - this.lastBatchTime < 2000 && this.items.length > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    while (this._pendingCount < this.concurrency) {
      const idx = this.findNextIndex();
      if (idx === -1) break;
      const item = this.items.splice(idx, 1)[0];
      this._pendingCount++;
      const id = item.id;
      logger.debug('QUEUE', id, '任务开始: ' + id);

      // [BUG-FIX] F1 - Clear TTL timer since task is starting execution
      const timer = this.ttlTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.ttlTimers.delete(id);
      }

      const controller = this.promiseMap.get(id);

      // [BUG-FIX] F1 - Added .then() and .catch() to handle both success and error paths
      //                Previously only .finally() was chained, causing unhandled rejections
      // [BUG-FIX] WG2-1 - Replaced .then().catch().finally() with try/catch/finally via async IIFE
      //                to prevent queue stall when item.task() throws synchronously
      (async () => {
        try {
          const result = await item.task();
          if (controller) {
            controller.resolve(result);
            this.promiseMap.delete(id);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error('QUEUE', id, '任务失败: ' + errorMsg);
          if (controller) {
            controller.reject(err);
            this.promiseMap.delete(id);
          }
        } finally {
          logger.debug('QUEUE', id, '任务完成: ' + id);
          this._pendingCount--;
          if (this._pendingCount === 0) this.lastBatchTime = Date.now();
          this.schedule();
        }
      })();
    }
    this.scheduling = false;
  }

  // [BUG-FIX] F1 - Internal cancel used by TTL timeout (no return value needed)
  private cancelInternal(id: string): void {
    const idx = this.items.findIndex(it => it.id === id);
    if (idx === -1) return;
    const item = this.items[idx];
    item.cancelled = true;
    this.items.splice(idx, 1);
    this.promiseMap.delete(id);
    const timer = this.ttlTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(id);
    }
  }

  private findNextIndex(): number {
    let bestIdx = -1;
    let bestPriority = -Infinity;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].cancelled) continue;
      if (this.items[i].priority > bestPriority) {
        bestPriority = this.items[i].priority;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
