// [BUG-FIX] F6 - 泛型抽象 BaseStore，提取三个 Store 类的公共逻辑
import { logger } from './logger';

const DEBOUNCE_MS = 300;

export abstract class BaseStore<T> {
  protected data: T;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected changeListeners: Array<(data: T) => void> = [];
  protected ready: Promise<void>;

  constructor() {
    this.data = this.getDefault();
    this.ready = this.load();
  }

  /** 子类返回 chrome.storage 的 key */
  protected abstract getStorageKey(): string;

  /** 子类返回默认值 */
  protected abstract getDefault(): T;

  /** 覆盖此方法可切换存储区域（默认 chrome.storage.sync） */
  protected getStorageArea(): chrome.storage.StorageArea {
    return chrome.storage.sync;
  }

  /** 加载后校验/转换数据，返回不符合则回退到默认值 */
  protected validateLoaded(stored: T): T {
    return stored;
  }

  // ── 生命周期 ──

  protected async load(): Promise<void> {
    try {
      const key = this.getStorageKey();
      const result = await this.getStorageArea().get(key);
      const stored = result[key] as T | undefined;
      if (stored !== undefined) {
        this.data = this.validateLoaded(stored);
      }
      const traceId = crypto.randomUUID();
      logger.info('STORE', traceId, `恢复 ${key}: ${JSON.stringify(this.data)}`);
    } catch (err) {
      const traceId = crypto.randomUUID();
      logger.error('STORE', traceId, `初始化失败 ${this.getStorageKey()}: ${err}`);
    }
  }

  // ── 公开 API ──

  /** 获取当前数据的副本 */
  async get(): Promise<T> {
    await this.ready;
    return this.cloneData();
  }

  /** 合并更新属性并触发防抖保存 */
  async update(partial: Partial<T>): Promise<void> {
    await this.ready;
    this.data = { ...this.data, ...partial };
    this.scheduleSave();
    this.notify();
  }

  /** 注册变更监听，返回取消监听的 off 函数 */
  onChange(callback: (data: T) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      const idx = this.changeListeners.indexOf(callback);
      if (idx >= 0) this.changeListeners.splice(idx, 1);
    };
  }

  // ── 内部 ──

  protected scheduleSave(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  protected async flush(): Promise<void> {
    try {
      const key = this.getStorageKey();
      await this.getStorageArea().set({ [key]: this.data });
      const traceId = crypto.randomUUID();
      logger.debug('STORE', traceId, `保存 ${key}: ${JSON.stringify(this.data)}`);
    } catch (err) {
      const traceId = crypto.randomUUID();
      logger.error('STORE', traceId, `保存失败 ${this.getStorageKey()}: ${err}`);
    }
  }

  protected notify(): void {
    const cloned = this.cloneData();
    for (const cb of this.changeListeners) {
      // [BUG-FIX] WG1-3 - 每个回调独立 try-catch，防止一个异常阻断后续回调
      try {
        cb(cloned);
      } catch (err) {
        const traceId = crypto.randomUUID();
        logger.error('STORE', traceId, `变更回调异常: ${err}`);
      }
    }
  }

  private cloneData(): T {
    if (typeof this.data !== 'object' || this.data === null) {
      return this.data;
    }
    return structuredClone(this.data);
  }
}
