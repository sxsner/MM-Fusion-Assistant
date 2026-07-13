import { logger } from '../shared/logger';
import type { ModelType, ModelResult, ModelResultStatus } from '../shared/types';

const MODULE = 'AGG';

interface ModelState {
  modelId: ModelType;
  status: ModelResultStatus;
  content: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

interface TaskState {
  registeredModels: ModelType[];
  models: Partial<Record<ModelType, ModelState>>;
  updateCallbacks: Partial<Record<ModelType, (content: string) => void>>;
  allCompletedCallback?: () => Promise<void>;
  completedFired?: boolean;
}

export class ResponseAggregator {
  private tasks: Map<string, TaskState> = new Map();
  private traceId: string;

  constructor() {
    this.traceId = crypto.randomUUID();
  }

  registerModel(taskId: string, modelId: ModelType): void {
    let task = this.tasks.get(taskId);
    if (!task) {
      task = { registeredModels: [], models: {}, updateCallbacks: {} };
      this.tasks.set(taskId, task);
    }
    if (task.registeredModels.includes(modelId)) return;
    task.registeredModels.push(modelId);
    task.models[modelId] = {
      modelId,
      status: 'pending',
      content: '',
      startedAt: Date.now(),
    };
    logger.debug(MODULE, this.traceId, `注册模型: ${modelId} 于任务: ${taskId}`);
  }

  addResult(taskId: string, modelId: ModelType, content: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const state = task.models[modelId];
    if (!state) return;
    state.content = content;
    // Only promote from pending→generating, never regress from completed
    if (state.status === 'pending') {
      state.status = 'generating';
    }
    logger.debug(MODULE, this.traceId, `模型 ${modelId} 新内容, 长度=${content.length}`);
    const cb = task.updateCallbacks[modelId];
    if (cb) cb(content);
  }

  async markCompleted(taskId: string, modelId: ModelType): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const state = task.models[modelId];
    if (!state) return;
    state.status = 'completed';
    state.completedAt = Date.now();
    logger.info(MODULE, this.traceId, `模型 ${modelId} 已完成`);
    await this.checkAllCompleted(taskId).catch((e) => logger.error('AGG', crypto.randomUUID(), 'checkAllCompleted error: ' + e));
  }

  async markFailed(taskId: string, modelId: ModelType, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const state = task.models[modelId];
    if (!state) return;
    state.status = 'failed';
    state.error = error;
    state.completedAt = Date.now();
    await this.checkAllCompleted(taskId).catch((e) => logger.error('AGG', crypto.randomUUID(), 'checkAllCompleted error: ' + e));
  }

  getAllResults(taskId: string): Partial<Record<ModelType, ModelResult>> {
    const task = this.tasks.get(taskId);
    if (!task) return {};
    const results: Partial<Record<ModelType, ModelResult>> = {};
    for (const modelId of task.registeredModels) {
      const state = task.models[modelId];
      if (state) {
        results[modelId] = {
          modelId: state.modelId,
          status: state.status,
          content: state.content || undefined,
          error: state.error,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          retryCount: 0,
        };
      }
    }
    return results;
  }

  isAllCompleted(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.registeredModels.length === 0) return false;
    return task.registeredModels.every((mid) => {
      const state = task.models[mid];
      if (!state) return false;
      return state.status === 'completed' || state.status === 'failed' || state.status === 'timeout';
    });
  }

  // [BUG-FIX] F17 - 添加 removeTask 方法清理 Map 条目
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
    logger.info(MODULE, this.traceId, `移除任务: ${taskId}`);
  }

  onUpdate(taskId: string, modelId: ModelType, callback: (content: string) => void): void {
    let task = this.tasks.get(taskId);
    if (!task) {
      task = { registeredModels: [], models: {}, updateCallbacks: {} };
      this.tasks.set(taskId, task);
    }
    task.updateCallbacks[modelId] = callback;
  }

  onAllCompleted(taskId: string, callback: () => Promise<void>): void {
    let task = this.tasks.get(taskId);
    if (!task) {
      task = { registeredModels: [], models: {}, updateCallbacks: {} };
      this.tasks.set(taskId, task);
    }
    task.allCompletedCallback = callback;
  }

  private async checkAllCompleted(taskId: string): Promise<void> {
    if (this.isAllCompleted(taskId)) {
      const task = this.tasks.get(taskId);
      if (!task || task.completedFired) return;
      task.completedFired = true;
      logger.info(MODULE, this.traceId, `任务 ${taskId} 全部模型完成`);
      if (task.allCompletedCallback) {
        try {
          await task.allCompletedCallback();
        } catch (err) {
          logger.error(MODULE, this.traceId, `allCompletedCallback 异常: ${err}`);
        }
      }
    }
  }
}
