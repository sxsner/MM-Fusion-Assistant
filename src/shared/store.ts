// [BUG-FIX] F6 - 重构：三个 Store 继承 BaseStore 泛型基类，消除 20.5% 重复
import { logger } from './logger';
import type { ModelType, SummarySettings } from '../shared/types';
import { MODEL_IDS } from './constants';
import { BaseStore } from './baseStore';
import { encrypt, decrypt } from '../infrastructure/secureStorage';

export interface ThrottleSettings {
  minInterval: number;
  maxErrors: number;
  pauseDuration: number;
}

export interface TimingConfig {
  concurrency: number;
  concurrencyInterval: number;
  inputInterval: number;
  sendInterval: number;
}

const TIMING_KEY = 'timingConfig';
let timingCache: TimingConfig | null = null;

export function getDefaultTiming(): TimingConfig {
  return { concurrency: 2, concurrencyInterval: 1500, inputInterval: 2000, sendInterval: 1000 };
}

export async function getTimingConfig(): Promise<TimingConfig> {
  if (timingCache) return timingCache;
  try {
    const data = await chrome.storage.local.get(TIMING_KEY);
    const cfg = data[TIMING_KEY] as TimingConfig | undefined;
    if (cfg && typeof cfg.concurrency === 'number' && typeof cfg.inputInterval === 'number') {
      timingCache = cfg;
      return cfg;
    }
  } catch {}
  return getDefaultTiming();
}

export async function setTimingConfig(cfg: TimingConfig): Promise<void> {
  timingCache = cfg;
  await chrome.storage.local.set({ [TIMING_KEY]: cfg });
}

export function clearTimingCache(): void { timingCache = null; }

// ── Store ────────────────────────────────────────────────────────────

export class Store extends BaseStore<ModelType[]> {
  protected getStorageKey(): string {
    return 'selectedModels';
  }

  protected getDefault(): ModelType[] {
    return [...MODEL_IDS] as ModelType[];
  }

  protected validateLoaded(stored: ModelType[]): ModelType[] {
    if (!Array.isArray(stored) || stored.length === 0) return this.getDefault();
    const valid = stored.filter((m) => MODEL_IDS.includes(m)) as ModelType[];
    return valid.length > 0 ? valid : this.getDefault();
  }

  async getSelectedModels(): Promise<ModelType[]> {
    return this.get();
  }

  async setSelectedModels(models: ModelType[]): Promise<void> {
    await this.ready;
    if (!models.includes('deepseek' as ModelType)) models.push('deepseek' as ModelType);
    this.data = [...models];
    this.scheduleSave();
    this.notify();
  }
}

// ── SummarySettingsStore ─────────────────────────────────────────────

export class SummarySettingsStore extends BaseStore<SummarySettings> {
  protected getStorageKey(): string {
    return 'summarySettings';
  }

  protected getDefault(): SummarySettings {
    return { mode: 'api', provider: 'openai' };
  }

  // [BUG-FIX] F6 - 存储改为 chrome.storage.local（apiKey 涉及敏感信息，不同步）
  protected getStorageArea(): chrome.storage.StorageArea {
    return chrome.storage.local;
  }

  protected validateLoaded(stored: SummarySettings): SummarySettings {
    if (stored && (stored.mode === 'api' || stored.mode === 'web')) {
      return stored;
    }
    return this.getDefault();
  }

  // [BUG-FIX] F6 - 加载后解密 apiKey
  protected override async load(): Promise<void> {
    await super.load();
    try {
      const plaintext = await decrypt('summaryApiKey', chrome.storage.local); // [BUG-FIX] WG1-2 - 传入 local 保持与存储区域一致
      if (plaintext) {
        this.data.apiKey = plaintext;
      }
    } catch (err) {
      const traceId = crypto.randomUUID();
      logger.error('STORE', traceId, `解密 apiKey 失败: ${err}`);
    }
  }

  // [BUG-FIX] F6 - 写入前加密 apiKey，不存明文
  protected override async flush(): Promise<void> {
    if (this.data.apiKey) {
      try {
        await encrypt('summaryApiKey', this.data.apiKey, chrome.storage.local); // [BUG-FIX] WG1-2 - 传入 local 保持与存储区域一致
      } catch (err) {
        const traceId = crypto.randomUUID();
        logger.error('STORE', traceId, `加密 apiKey 失败: ${err}`);
      }
    }
    const { apiKey: _, ...safe } = this.data;
    try {
      await this.getStorageArea().set({ [this.getStorageKey()]: safe });
      const traceId = crypto.randomUUID();
      logger.debug('STORE', traceId, `保存汇总设置: mode=${safe.mode}`);
    } catch (err) {
      const traceId = crypto.randomUUID();
      logger.error('STORE', traceId, `保存汇总设置失败: ${err}`);
    }
  }
}

// ── ThrottleSettingsStore ────────────────────────────────────────────

export class ThrottleSettingsStore extends BaseStore<ThrottleSettings> {
  protected getStorageKey(): string {
    return 'throttleSettings';
  }

  protected getDefault(): ThrottleSettings {
    return { minInterval: 15, maxErrors: 3, pauseDuration: 5 };
  }

  protected validateLoaded(stored: ThrottleSettings): ThrottleSettings {
    if (
      stored &&
      typeof stored.minInterval === 'number' &&
      typeof stored.maxErrors === 'number' &&
      typeof stored.pauseDuration === 'number'
    ) {
      return stored;
    }
    return this.getDefault();
  }
}
