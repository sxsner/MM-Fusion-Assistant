import type { ModelType } from '../shared/types';
import { Store } from '../shared/store';
import { logger } from '../shared/logger';

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT', claude: 'Claud', gemini: 'Gmini', deepseek: 'DSeek', grok: 'Grok',
  doubao: 'Seed', glm: 'GLM', qwnc: 'QwnC', hunyuan: 'Hy',
  kimi: 'Kimi', minimax: 'Nimax', longcat: 'LCat', stepfun: 'Step', mimo: 'MiMo',
};

const ALL_MODELS: ModelType[] = ['chatgpt', 'claude', 'gemini', 'deepseek', 'grok', 'doubao', 'glm', 'qwnc', 'hunyuan', 'kimi', 'minimax', 'longcat', 'stepfun', 'mimo'];

interface ModelTabInfo {
  modelId: ModelType;
  tabId: number;
  url: string;
  title: string;
  status: 'loading' | 'active' | 'inactive';
}

interface ModelStatus {
  modelId: ModelType;
  label: string;
  hasTab: boolean;
  tabInfo?: ModelTabInfo;
}

export class BackgroundTabsView {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private refreshBtn: HTMLButtonElement;
  private closeAllBtn: HTMLButtonElement;
  private modelStore: Store;
  private tabsUpdatedHandler: (msg: { channel: string }) => void;
  private hoverStyle: HTMLStyleElement;
  private openTimer?: ReturnType<typeof setTimeout>; // [BUG-FIX] B-008 - 保存 setTimeout ID 用于销毁时清除
  private ac: AbortController; // [BUG-FIX] B-006 - 添加 AbortController 生命周期管理

  constructor(parent: HTMLElement) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;padding:4px 0;';

    this.hoverStyle = document.createElement('style');
    this.hoverStyle.textContent = '.bt-row:hover{background:var(--color-bg-hover)!important;opacity:1!important;}';
    document.head.appendChild(this.hoverStyle);

    this.modelStore = new Store();

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 0 4px 0;flex-shrink:0;';

    const title = document.createElement('div');
    title.textContent = '后台标签页';
    title.style.cssText = 'font-family:var(--font-sans);font-size:var(--font-size-sm);font-weight:600;color:var(--color-text);';

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:6px;';

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.textContent = '刷新';
    this.refreshBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text-secondary);cursor:pointer;';
    this.refreshBtn.addEventListener('click', () => this.load(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    this.closeAllBtn = document.createElement('button');
    this.closeAllBtn.textContent = '全部关闭';
    this.closeAllBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-error);border-radius:var(--radius-sm);background:transparent;color:var(--color-error);cursor:pointer;';
    this.closeAllBtn.addEventListener('click', () => this.closeAll(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    btnGroup.appendChild(this.refreshBtn);
    btnGroup.appendChild(this.closeAllBtn);
    header.appendChild(title);
    header.appendChild(btnGroup);

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
    this.listEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const row = btn.closest('[data-mid]') as HTMLElement | null;
      const mid = row?.dataset.mid;
      if (!mid) return;
      const action = btn.dataset.action;
      if (action === 'switch') this.switchToTab(mid as ModelType);
      else if (action === 'close') this.closeTab(mid as ModelType);
      else if (action === 'open') this.openTab(mid as ModelType);
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const hint = document.createElement('div');
    hint.textContent = '显示所有已选模型的后台标签页状态。点击"打开"可静默加载模型，点击"切换"可跳转到对应标签页。';
    hint.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);padding:3px 0;border-bottom:1px solid var(--color-border);margin-bottom:2px;line-height:1.3;';

    this.container.appendChild(header);
    this.container.appendChild(hint);
    this.container.appendChild(this.listEl);
    parent.appendChild(this.container);

    this.tabsUpdatedHandler = (msg: { channel: string }) => {
      if (msg.channel === 'tabs:updated') this.load();
    };
    chrome.runtime.onMessage.addListener(this.tabsUpdatedHandler);
    this.load();
  }

  async load(): Promise<void> {
    try {
      const selectedModels = await this.modelStore.getSelectedModels();
      const modelsToShow = selectedModels.length > 0 ? selectedModels : ALL_MODELS;

      const res = await chrome.runtime.sendMessage({ channel: 'tabs:list' });
      const activeTabs: ModelTabInfo[] = res?.success ? (res.data?.tabs || []) : [];

      const tabMap = new Map<ModelType, ModelTabInfo>();
      for (const tab of activeTabs) {
        tabMap.set(tab.modelId, tab);
      }

      const modelStatuses: ModelStatus[] = modelsToShow.map(modelId => ({
        modelId,
        label: MODEL_LABELS[modelId] || modelId,
        hasTab: tabMap.has(modelId),
        tabInfo: tabMap.get(modelId),
      }));

      this.render(modelStatuses);
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), 'Failed to load tabs: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private render(modelStatuses: ModelStatus[]): void {
    this.listEl.innerHTML = '';

    const activeTabs = modelStatuses.filter(m => m.hasTab);
    const inactiveModels = modelStatuses.filter(m => !m.hasTab);

    if (activeTabs.length > 0) {
      const activeHeader = document.createElement('div');
      activeHeader.textContent = `活跃标签页 (${activeTabs.length})`;
      activeHeader.style.cssText = 'font-size:var(--font-size-sm);font-weight:600;color:var(--color-text-secondary);padding:4px 0 2px 0;';
      this.listEl.appendChild(activeHeader);

      for (const model of activeTabs) {
        this.listEl.appendChild(this.createActiveRow(model));
      }
    }

    if (inactiveModels.length > 0) {
      const inactiveHeader = document.createElement('div');
      inactiveHeader.textContent = `未打开 (${inactiveModels.length})`;
      inactiveHeader.style.cssText = 'font-size:var(--font-size-sm);font-weight:600;color:var(--color-text-secondary);padding:8px 0 2px 0;';
      this.listEl.appendChild(inactiveHeader);

      for (const model of inactiveModels) {
        this.listEl.appendChild(this.createInactiveRow(model));
      }
    }
  }

  private createActiveRow(model: ModelStatus): HTMLDivElement {
    const tab = model.tabInfo!;
    const row = document.createElement('div');
    row.className = 'bt-row';
    row.dataset.mid = model.modelId;
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);transition:background 0.15s;';

    const statusColors: Record<string, string> = {
      loading: '#f59e0b',
      active: '#22c55e',
      inactive: '#6b7280',
    };

    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[tab.status] || '#6b7280'};flex-shrink:0;`;
    if (tab.status === 'loading') {
      dot.style.animation = 'dot-blink 1s infinite';
    }

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const name = document.createElement('div');
    name.textContent = model.label;
    name.style.cssText = 'font-size:12px;font-weight:500;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const urlText = document.createElement('div');
    urlText.textContent = tab.url;
    urlText.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    info.appendChild(name);
    info.appendChild(urlText);

    const statusLabel = document.createElement('span');
    statusLabel.textContent = tab.status === 'loading' ? '加载中' : tab.status === 'active' ? '活跃' : '后台';
    statusLabel.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);flex-shrink:0;';

    const switchBtn = document.createElement('button');
    switchBtn.textContent = '切换';
    switchBtn.dataset.action = 'switch';
    switchBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:transparent;color:var(--color-text);cursor:pointer;flex-shrink:0;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.dataset.action = 'close';
    closeBtn.style.cssText = 'padding:2px 6px;font-size:14px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:transparent;color:var(--color-text-secondary);cursor:pointer;flex-shrink:0;line-height:1;';

    row.appendChild(dot);
    row.appendChild(info);
    row.appendChild(statusLabel);
    row.appendChild(switchBtn);
    row.appendChild(closeBtn);

    return row;
  }

  private createInactiveRow(model: ModelStatus): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'bt-row';
    row.dataset.mid = model.modelId;
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);opacity:0.7;transition:opacity 0.15s;';

    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--color-border);flex-shrink:0;'; // [BUG-FIX] B-009 - 硬编码色值改为 CSS 变量

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const name = document.createElement('div');
    name.textContent = model.label;
    name.style.cssText = 'font-size:12px;font-weight:500;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    info.appendChild(name);

    const openBtn = document.createElement('button');
    openBtn.textContent = '打开';
    openBtn.dataset.action = 'open';
    openBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-primary);border-radius:var(--radius-sm);background:transparent;color:var(--color-primary);cursor:pointer;flex-shrink:0;';

    row.appendChild(dot);
    row.appendChild(info);
    row.appendChild(openBtn);

    return row;
  }

  private async openTab(modelId: ModelType): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ channel: 'tabs:open', payload: { modelId } });
      this.openTimer = setTimeout(() => this.load(), 500); // [BUG-FIX] B-008 - 保存 timeout ID
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), 'Failed to open tab: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async switchToTab(modelId: ModelType): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ channel: 'tabs:switch', payload: { modelId } });
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), 'Failed to switch tab: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async closeTab(modelId: ModelType): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ channel: 'tabs:close', payload: { modelId } });
      await this.load();
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), 'Failed to close tab: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async closeAll(): Promise<void> {
    if (!confirm('确定关闭所有后台标签页？')) return;
    try {
      await chrome.runtime.sendMessage({ channel: 'tabs:closeAll' });
      await this.load();
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), 'Failed to close all tabs: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  destroy(): void {
    this.ac?.abort(); // [BUG-FIX] B-006 - AbortController abort
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = undefined; } // [BUG-FIX] B-008 - 清除 openTimer
    chrome.runtime.onMessage.removeListener(this.tabsUpdatedHandler);
    if (this.hoverStyle?.parentNode) this.hoverStyle.parentNode.removeChild(this.hoverStyle);
  }
}
