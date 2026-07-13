import type { ModelType } from '../shared/types';
import { logger } from '../shared/logger';

const MODULE = 'FR';

export class FrameRegistry {
  private taskMap = new Map<string, Map<ModelType, number>>();
  private reverseMap = new Map<number, { taskId: string; modelId: ModelType }>();

  register(taskId: string, modelId: ModelType, tabId: number): void {
    let modelMap = this.taskMap.get(taskId);
    if (!modelMap) {
      modelMap = new Map();
      this.taskMap.set(taskId, modelMap);
    }
    modelMap.set(modelId, tabId);
    this.reverseMap.set(tabId, { taskId, modelId });
    const tid = crypto.randomUUID();
    logger.debug(MODULE, tid, '注册帧: ' + modelId + ' @ tab ' + tabId);
  }

  getTabId(taskId: string, modelId: ModelType): number | undefined {
    return this.taskMap.get(taskId)?.get(modelId);
  }

  getByTabId(tabId: number): { taskId: string; modelId: ModelType } | undefined {
    return this.reverseMap.get(tabId);
  }

  unregister(taskId: string, modelId: ModelType): void {
    const modelMap = this.taskMap.get(taskId);
    if (modelMap) {
      const tabId = modelMap.get(modelId);
      if (tabId !== undefined) {
        modelMap.delete(modelId);
        this.reverseMap.delete(tabId);
        if (modelMap.size === 0) {
          this.taskMap.delete(taskId);
        }
      }
    }
    const tid = crypto.randomUUID();
    logger.debug(MODULE, tid, '注销帧: ' + modelId);
  }

  getTaskTabs(taskId: string): Map<ModelType, number> {
    return new Map(this.taskMap.get(taskId) ?? []);
  }

  unregisterTask(taskId: string): void {
    const modelMap = this.taskMap.get(taskId);
    if (!modelMap) return;
    for (const [, tabId] of modelMap) {
      this.reverseMap.delete(tabId);
    }
    this.taskMap.delete(taskId);
  }
}
