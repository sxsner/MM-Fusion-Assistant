import { logger } from '../shared/logger';
import type { Attachment, ModelType, Task } from '../shared/types';
import { DEFAULT_TIMEOUT_MS } from '../shared/constants';

const MODULE = 'TM';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  createTask(question: string, attachments: Attachment[], targetModels: ModelType[]): Task {
    const taskId = crypto.randomUUID();
    const now = Date.now();
    const task: Task = {
      id: taskId,
      question,
      attachments,
      targetModels,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      results: {},
    };
    this.tasks.set(taskId, task);
    const traceId = crypto.randomUUID();
    logger.info(MODULE, traceId, '创建任务: ' + taskId);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  // [BUG-FIX] F18 - 添加 deleteTask 方法删除 Map 条目
  deleteTask(taskId: string): void {
    this.tasks.delete(taskId);
    const traceId = crypto.randomUUID();
    logger.info(MODULE, traceId, '删除任务: ' + taskId);
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, updates, { updatedAt: Date.now() });
  }

  async persist(task: Task): Promise<void> {
    const traceId = crypto.randomUUID();
    try {
      await chrome.storage.local.set({ [`task:${task.id}`]: task });
      logger.debug(MODULE, traceId, '持久化任务: ' + task.id);
    } catch (err) {
      logger.error(MODULE, traceId, '持久化失败: ' + err);
    }
  }
}
