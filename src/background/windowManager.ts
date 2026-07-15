import { logger } from '../shared/logger';
import type { ModelType } from '../shared/types';
import { FrameRegistry } from './frameRegistry';
import { getTimingConfig } from '../shared/store';

export const MODEL_URLS: Record<ModelType, string> = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com',
  grok: 'https://grok.com',
  doubao: 'https://www.doubao.com/chat/',
  glm: 'https://chat.z.ai',
  qwne: 'https://chat.qwen.ai',
  qwnc: 'https://www.qianwen.com',
  hunyuan: 'https://aistudio.tencent.com',
  kimi: 'https://www.kimi.com/?chat_enter_method=new_chat',
  minimax: 'https://agent.minimaxi.com/',
  longcat: 'https://longcat.chat',
  stepfun: 'https://chat.stepfun.com/chats/new',
  mimo: 'https://aistudio.xiaomimimo.com/#/c',
};

const MODEL_DOMAINS: Record<ModelType, string> = {
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
  deepseek: 'chat.deepseek.com',
  grok: 'grok.com',
  doubao: 'www.doubao.com',
  glm: 'chat.z.ai',
  qwne: 'chat.qwen.ai',
  qwnc: 'www.qianwen.com',
  hunyuan: 'aistudio.tencent.com',
  kimi: 'www.kimi.com',
  minimax: 'agent.minimaxi.com',
  longcat: 'longcat.chat',
  stepfun: 'chat.stepfun.com',
  mimo: 'aistudio.xiaomimimo.com',
};

export interface ModelTabInfo {
  modelId: ModelType;
  tabId: number;
  url: string;
  title: string;
  status: 'loading' | 'active' | 'inactive';
}

export class WindowManager {
  private modelTabs = new Map<ModelType, number>();
  private modelWindows = new Map<ModelType, number>();
  private tabStatus = new Map<ModelType, 'loading' | 'active' | 'inactive'>();
  private openingModels = new Set<string>();
  private onStatusChange?: (tabs: ModelTabInfo[]) => void;
  private initPromise: Promise<void>;

  constructor(private frameRegistry: FrameRegistry) {
    this.initPromise = this.recoverFromStorage().catch((e) => logger.error('WM', crypto.randomUUID(), 'recoverFromStorage failed: ' + e));
    this.setupTabListeners();
    this.setupWindowListeners();
  }

  setStatusChangeCallback(callback: (tabs: ModelTabInfo[]) => void): void {
    this.onStatusChange = callback;
  }

  private setupTabListeners(): void {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      for (const [model, tid] of this.modelTabs) {
        if (tid === tabId) {
          if (changeInfo.status === 'loading') {
            this.tabStatus.set(model, 'loading');
          } else if (changeInfo.status === 'complete') {
            this.tabStatus.set(model, 'active');
          }
          this.notifyStatusChange();
          break;
        }
      }
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      for (const [model, tid] of this.modelTabs) {
        if (tid === activeInfo.tabId) {
          this.tabStatus.set(model, 'active');
        }
      }
      this.notifyStatusChange();
    });
  }

  private setupWindowListeners(): void {
    chrome.windows.onRemoved.addListener((windowId) => {
      for (const [model, wid] of this.modelWindows) {
        if (wid === windowId) {
          logger.info('WM', '', `模型窗口已关闭: ${model}`);
          this.modelWindows.delete(model);
          this.modelTabs.delete(model);
          this.tabStatus.delete(model);
          break;
        }
      }
      this.persist();
      this.notifyStatusChange();
    });
  }

  private notifyStatusChange(): void {
    if (this.onStatusChange) {
      this.getAllTabs().then(tabs => this.onStatusChange!(tabs));
    }
    chrome.runtime.sendMessage({ channel: 'tabs:updated' }).catch(() => {});
  }

  private async recoverFromStorage(): Promise<void> {
    try {
      const winData = await chrome.storage.session.get(['modelTabs', 'modelWindows']);
      if (winData.modelWindows) {
        for (const [model, windowId] of Object.entries(winData.modelWindows)) {
          try {
            const win = await chrome.windows.get(windowId as number);
            if (!win?.id) continue;
            this.modelWindows.set(model as ModelType, win.id);
            const tab = win.tabs?.[0];
            if (tab?.id) {
              this.modelTabs.set(model as ModelType, tab.id);
              this.tabStatus.set(model as ModelType, 'active');
            }
          } catch { logger.warn('WM', crypto.randomUUID(), 'recoverFromStorage: stale modelWindows entry'); }
        }
      }
    } catch { logger.warn('WM', crypto.randomUUID(), 'recoverFromStorage: no session data'); }
    if (this.modelTabs.size > 0) this.notifyStatusChange();
  }

  private persist(): void {
    const tabs: Record<string, number> = {};
    for (const [k, v] of this.modelTabs) tabs[k] = v;
    const windows: Record<string, number> = {};
    for (const [k, v] of this.modelWindows) windows[k] = v;
    chrome.storage.session.set({ modelTabs: tabs, modelWindows: windows }).catch(() => {});
  }

  getTabUrl(modelId: ModelType): string {
    return MODEL_URLS[modelId];
  }

  async openOrReuseTab(modelId: ModelType, targetUrl?: string): Promise<{ tabId: number; isNew: boolean }> {
    await this.initPromise;
    const tid = crypto.randomUUID();

    // STEP 1: Scan ALL tabs by domain — this ALWAYS finds existing windows
    const domain = MODEL_DOMAINS[modelId];
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.id && tab.url) {
        try {
          if (new URL(tab.url).hostname === domain) {
            this.modelTabs.set(modelId, tab.id);
            this.tabStatus.set(modelId, 'active');
            this.persist();
            this.notifyStatusChange();
            const url = targetUrl || MODEL_URLS[modelId];
            if (tab.url !== url) await chrome.tabs.update(tab.id, { url }).catch(() => {});
            logger.info('WM', tid, `复用已有标签: ${modelId} tabId=${tab.id}`);
            return { tabId: tab.id, isNew: false };
          }
        } catch { /* invalid url */ }
      }
    }

    // STEP 2: check in-memory map (catches tabs still loading / url not yet set)
    const existingTabId = this.modelTabs.get(modelId);
    if (existingTabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(existingTabId);
        if (tab?.id) {
          const url = targetUrl || MODEL_URLS[modelId];
          if (tab.url !== url) await chrome.tabs.update(tab.id, { url }).catch(() => {});
          if (!tab.active) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
          logger.info('WM', tid, `复用已有标签(内存): ${modelId} tabId=${tab.id}`);
          return { tabId: tab.id, isNew: false };
        }
      } catch { logger.warn('WM', tid, 'openOrReuseTab: stale existingTabId'); }
      this.modelTabs.delete(modelId);
      this.modelWindows.delete(modelId);
      this.tabStatus.delete(modelId);
    }

    // STEP 3: guard against concurrent creation
    if (this.openingModels.has(modelId)) {
      while (this.openingModels.has(modelId)) {
        await new Promise((r) => setTimeout(r, 500));
        const existing = this.modelTabs.get(modelId);
        if (existing !== undefined) { try { const t = await chrome.tabs.get(existing); if (t?.id) return { tabId: t.id, isNew: false }; } catch {} }
      }
    }
    this.openingModels.add(modelId);

    // Stagger window opens to avoid overwhelming Chrome
    const cfg = await getTimingConfig();
    await new Promise((r) => setTimeout(r, cfg.concurrencyInterval));
    const url = targetUrl || MODEL_URLS[modelId];
    logger.info('WM', tid, `创建独立弹出窗口: ${modelId} url=${url}`);
    const win = await chrome.windows.create({
      type: 'popup',
      width: 480,
      height: 800,
      focused: false,
      url,
    });
    const tabId = win.tabs?.[0]?.id;
    if (tabId && win.id) {
      this.modelTabs.set(modelId, tabId);
      this.modelWindows.set(modelId, win.id);
      this.tabStatus.set(modelId, 'loading');
      this.persist();
      this.notifyStatusChange();
      logger.info('WM', tid, `${modelId} 窗口创建成功: windowId=${win.id} tabId=${tabId}`);
      this.openingModels.delete(modelId);
      return { tabId, isNew: true };
    }
    this.openingModels.delete(modelId);
    throw new Error('Failed to create tab for ' + modelId);
  }

  async getAllTabs(): Promise<ModelTabInfo[]> {
    const tabs: ModelTabInfo[] = [];
    const seenModels = new Set<ModelType>();

    // Tracked tabs (in-memory, might be empty after SW restart)
    for (const [model, tabId] of this.modelTabs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id && tab.url) {
          tabs.push({ modelId: model, tabId: tab.id, url: tab.url, title: tab.title || MODEL_URLS[model], status: this.tabStatus.get(model) || 'inactive' });
          seenModels.add(model);
        } else { this.modelTabs.delete(model); this.tabStatus.delete(model); }
      } catch { this.modelTabs.delete(model); this.tabStatus.delete(model); }
    }

    // Scan all browser tabs for model domains (handles SW restart recovery)
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.id) continue;
      try {
        let hostname = tab.url ? new URL(tab.url).hostname : '';
        // about:blank tab in tracked popup window — resolve via modelWindows
        if (!hostname && tab.windowId) {
          for (const [model, winId] of this.modelWindows) {
            if (winId === tab.windowId) {
              hostname = MODEL_DOMAINS[model as ModelType];
              break;
            }
          }
        }
        for (const [model, domain] of Object.entries(MODEL_DOMAINS)) {
          if (hostname === domain && !seenModels.has(model as ModelType)) {
            tabs.push({ modelId: model as ModelType, tabId: tab.id, url: tab.url || '', title: tab.title || MODEL_URLS[model as ModelType], status: 'active' });
            seenModels.add(model as ModelType);
            this.modelTabs.set(model as ModelType, tab.id);
            this.tabStatus.set(model as ModelType, 'active');
            break;
          }
        }
      } catch { /* invalid URL */ }
    }

    this.persist();
    return tabs;
  }

  async switchToTab(modelId: ModelType): Promise<boolean> {
    const tabId = this.modelTabs.get(modelId);
    if (!tabId) return false;
    try {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return true;
    } catch {
      logger.warn('WM', crypto.randomUUID(), 'switchToTab: failed');
      return false;
    }
  }

  async closeTab(modelId: ModelType): Promise<boolean> {
    const windowId = this.modelWindows.get(modelId);
    if (windowId) {
      try {
        await chrome.windows.remove(windowId);
        this.modelWindows.delete(modelId);
        this.modelTabs.delete(modelId);
        this.tabStatus.delete(modelId);
        this.persist();
        this.notifyStatusChange();
        return true;
      } catch { logger.warn('WM', crypto.randomUUID(), 'closeTab: remove window failed'); }
    }
    const tabId = this.modelTabs.get(modelId);
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch { logger.warn('WM', crypto.randomUUID(), 'closeTab: remove tab failed'); }
    }
    this.modelTabs.delete(modelId);
    this.modelWindows.delete(modelId);
    this.tabStatus.delete(modelId);
    this.persist();
    this.notifyStatusChange();
    return true;
  }

  async closeAllTabs(): Promise<void> {
    // 1. 关闭所有模型的独立弹出窗口
    for (const [model, windowId] of this.modelWindows) {
      try { await chrome.windows.remove(windowId); logger.info('WM', '', `关闭模型窗口: ${model}`); }
      catch { logger.warn('WM', crypto.randomUUID(), 'closeAllTabs: remove window failed'); }
    }
    // 2. 扫描浏览器中所有模型网站的标签页（逐个关闭，避免批量失败）
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.id || !tab.url) continue;
      try {
        const hostname = new URL(tab.url).hostname;
        let matched = false;
        for (const domain of Object.values(MODEL_DOMAINS)) {
          if (hostname === domain || hostname.endsWith('.' + domain)) { matched = true; break; }
        }
        if (!matched && tab.title) {
          const title = tab.title.toLowerCase();
          if (title.includes('mimo') || title.includes('xiaomi')) matched = true;
        }
        if (matched) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
      } catch { /* invalid URL */ }
    }
    this.modelTabs.clear();
    this.modelWindows.clear();
    this.tabStatus.clear();
    this.persist();
    this.notifyStatusChange();
  }

  onTabClosed(tabId: number): void {
    for (const [model, tid] of this.modelTabs) {
      if (tid === tabId) {
        this.modelTabs.delete(model);
        this.modelWindows.delete(model);
        this.tabStatus.delete(model);
        this.persist();
        this.notifyStatusChange();
        break;
      }
    }
  }

  assignTabToTask(tabId: number, taskId: string, modelId: ModelType): void {
    this.frameRegistry.register(taskId, modelId, tabId);
  }

  async closeTaskTabs(taskId: string): Promise<void> {
    const tabIds: number[] = [];
    const tabs = this.frameRegistry.getTaskTabs(taskId);
    for (const tabId of tabs.values()) {
      tabIds.push(tabId);
    }
    if (tabIds.length > 0) {
      try { await chrome.tabs.remove(tabIds); } catch (e) { logger.warn('WM', '', '关闭标签页失败: ' + e); }
    }
    this.frameRegistry.unregisterTask(taskId);
  }
}
