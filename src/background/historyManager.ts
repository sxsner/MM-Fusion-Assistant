import { logger } from '../shared/logger';
import type { Task } from '../shared/types';

const MODULE = 'HIST';
const MAX_ITEMS = 500;
const ACTIVE_CONV_KEY = 'activeConversationId';

function isHistoryEntry(v: unknown): v is HistoryEntry {
  return !!v && typeof v === 'object' && 'taskId' in (v as Record<string, unknown>) && 'conversationId' in (v as Record<string, unknown>);
}

export interface HistoryEntry {
  taskId: string;
  conversationId: string;
  modelId?: string;
  question: string;
  pageTitle?: string;
  attachmentCount: number;
  targetModels: string[];
  results: Array<{ modelId: string; content: string; status: string }>;
  conversationUrls?: Partial<Record<string, string>>;
  summary?: string;
  createdAt: number;
  completedAt?: number;
}

export class HistoryManager {
  private traceId: string;

  constructor() {
    this.traceId = crypto.randomUUID();
  }

  async save(task: Task): Promise<void> {
    const taskId = task.id;
    const conversationId = task.conversationId || taskId;
    const pageTitle = task.pageTitle;
    const completedAt = (task.status === 'completed' || task.status === 'failed' || task.status === 'partial_timeout') ? task.updatedAt : undefined;

    const entry: HistoryEntry = {
      taskId,
      conversationId,
      question: task.question,
      pageTitle,
      attachmentCount: task.attachments.length,
      targetModels: task.targetModels,
      results: [],
      conversationUrls: task.conversationUrls,
      createdAt: task.createdAt,
      completedAt,
    };

    for (const modelId of task.targetModels) {
      const r = task.results[modelId];
      if (r) {
        entry.results.push({ modelId, content: r.content ?? '', status: r.status });
      }
    }

    if (task.summaryResult?.content) {
      entry.summary = task.summaryResult.content;
    }

    const storageKey = `history:${taskId}`;
    try {
      await chrome.storage.local.set({ [storageKey]: entry });
    } catch (err) {
      logger.error(MODULE, this.traceId, `save failed: ${err}`);
      return;
    }
    logger.info(MODULE, this.traceId, `保存历史: conversationId=${conversationId} storageKey=${storageKey}`);

    await this.enforceQuota();
  }

  async updateTitle(conversationId: string, pageTitle: string): Promise<void> {
    const all = await this.getAll();
    const matches = all.filter((e) => e.conversationId === conversationId);
    for (const entry of matches) {
      entry.pageTitle = pageTitle;
      try {
        await chrome.storage.local.set({ [`history:${entry.taskId}`]: entry });
      } catch (err) {
        logger.error(MODULE, this.traceId, 'updateTitle failed: ' + err);
      }
    }
  }

  async getAll(): Promise<HistoryEntry[]> {
    let allData: Record<string, unknown>;
    try {
      allData = await chrome.storage.local.get(null);
    } catch (err) {
      logger.error(MODULE, this.traceId, 'getAll failed: ' + err);
      return [];
    }
    const entries: HistoryEntry[] = [];
    for (const [key, raw] of Object.entries(allData)) {
      if (key.startsWith('history:')) {
        const entry = isHistoryEntry(raw) ? raw : undefined;
        if (entry) entries.push(entry);
      }
    }
    entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return entries;
  }

  async get(taskId: string): Promise<HistoryEntry | undefined> {
    try {
      const result = await chrome.storage.local.get(`history:${taskId}`);
      const raw = result[`history:${taskId}`];
      return isHistoryEntry(raw) ? raw : undefined;
    } catch (err) {
      logger.error(MODULE, this.traceId, 'get failed: ' + err);
      return undefined;
    }
  }

  async search(keyword: string): Promise<HistoryEntry[]> {
    const all = await this.getAll();
    const lower = keyword.toLowerCase();
    const results = all.filter((e) => e.question.toLowerCase().includes(lower));
    logger.debug(MODULE, this.traceId, '搜索: ' + keyword + ' 结果: ' + results.length);
    return results;
  }

  async delete(taskId: string): Promise<void> {
    try {
      await chrome.storage.local.remove(`history:${taskId}`);
    } catch (err) {
      logger.error(MODULE, this.traceId, 'delete failed: ' + err);
    }
  }

  async clearAll(): Promise<void> {
    let allData: Record<string, unknown>;
    try {
      allData = await chrome.storage.local.get(null);
    } catch (err) {
      logger.error(MODULE, this.traceId, 'clearAll failed: ' + err);
      return;
    }
    const keys = Object.keys(allData).filter(k => k.startsWith('history:'));
    if (keys.length > 0) {
      try {
        await chrome.storage.local.remove(keys);
      } catch (err) {
        logger.error(MODULE, this.traceId, 'clearAll failed: ' + err);
      }
    }
  }

  async count(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  }

  async getActiveConversationId(): Promise<string | undefined> {
    try {
      const result = await chrome.storage.local.get(ACTIVE_CONV_KEY);
      const val = result[ACTIVE_CONV_KEY];
      return typeof val === 'string' ? val : undefined;
    } catch {
      logger.warn(MODULE, this.traceId, 'getActiveConversationId failed');
      return undefined;
    }
  }

  async setActiveConversationId(id: string | undefined): Promise<void> {
    if (!id) return;
    try {
      await chrome.storage.local.set({ [ACTIVE_CONV_KEY]: id });
    } catch {
      logger.warn(MODULE, this.traceId, 'setActiveConversationId failed');
    }
  }

  private async enforceQuota(): Promise<void> {
    const all = await this.getAll();
    if (all.length <= MAX_ITEMS) return;

    const removeCount = Math.ceil(MAX_ITEMS * 0.1);
    const toRemove = all.slice(all.length - removeCount);

    const keys = toRemove.map((e) => `history:${e.taskId}`);
    try {
      await chrome.storage.local.remove(keys);
    } catch (err) {
      logger.error(MODULE, this.traceId, 'enforceQuota remove failed: ' + err);
    }

    logger.warn(MODULE, this.traceId, '清理旧历史: ' + removeCount + ' 条');
  }
}
