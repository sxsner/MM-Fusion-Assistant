import { logger } from '../shared/logger';
import { HistoryManager, HistoryEntry } from '../background/historyManager';

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT', claude: 'Claud', gemini: 'Gmini', deepseek: 'DSeek', grok: 'Grok',
  doubao: 'Seed', glm: 'GLM', qwne: 'QwnE', qwnc: 'QwnC', hunyuan: 'Hy',
  kimi: 'Kimi', minimax: 'Nimax', longcat: 'LCat', stepfun: 'Step', mimo: 'MiMo',
};

function fmt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (isToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export class HistoryView {
  private root: HTMLDivElement;
  private listEl: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private historyManager: HistoryManager;
  private entries: HistoryEntry[] = [];
  private onResume: ((entry: HistoryEntry) => void) | null = null;
  private onContinueModel: ((modelId: string) => void) | null = null;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private ac: AbortController; // [BUG-FIX] B-006 - 添加 AbortController 生命周期管理

  onResumeConversation(cb: (entry: HistoryEntry) => void): void {
    this.onResume = cb;
  }

  onContinueModelSession(cb: (modelId: string) => void): void {
    this.onContinueModel = cb;
  }

  constructor(container: HTMLElement, historyManager: HistoryManager) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.historyManager = historyManager;

    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;font-family:var(--font-sans);';

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:6px;align-items:center;';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = '搜索...';
    this.searchInput.style.cssText = 'flex:1;padding:6px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:6px;outline:none;box-sizing:border-box;';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.textContent = '清空';
    clearAllBtn.style.cssText = 'padding:4px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-error);border-radius:4px;background:none;color:var(--color-error);cursor:pointer;flex-shrink:0;';

    searchRow.appendChild(this.searchInput);
    searchRow.appendChild(clearAllBtn);
    this.root.appendChild(searchRow);

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
    this.listEl.addEventListener('click', (e) => this.handleListClick(e), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.root.appendChild(this.listEl);

    container.appendChild(this.root);

    this.searchInput.addEventListener('input', () => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        const kw = this.searchInput.value.trim();
        if (kw) this.search(kw);
        else this.load();
      }, 300);
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    clearAllBtn.addEventListener('click', () => {
      if (confirm('确定清空全部历史？')) this.deleteAll();
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
  }

  async load(): Promise<void> {
    this.entries = await this.historyManager.getAll();
    this.renderList();
  }

  async search(keyword: string): Promise<void> {
    this.entries = await this.historyManager.search(keyword);
    this.renderList();
  }

  async delete(convId: string): Promise<void> {
    try {
      await this.historyManager.delete(convId);
      this.entries = this.entries.filter((e) => (e.conversationId || e.taskId) !== convId);
      this.renderList();
    } catch (err) {
      logger.error('History', '', '删除历史记录失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async deleteAll(): Promise<void> {
    try {
      await this.historyManager.clearAll();
      this.entries = [];
      this.renderList();
    } catch (err) {
      logger.error('History', '', '清空历史记录失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void { this.ac?.abort(); if (this.searchTimer) clearTimeout(this.searchTimer); this.onResume = null; this.onContinueModel = null; this.entries = []; } // [BUG-FIX] B-006 - AbortController abort

  private renderList(): void {
    this.listEl.innerHTML = '';
    if (this.entries.length === 0) {
      const el = document.createElement('div');
      el.style.cssText = 'text-align:center;padding:24px;color:var(--color-text-secondary);font-size:12px;';
      el.textContent = '暂无历史记录';
      this.listEl.appendChild(el);
      return;
    }

    for (const entry of this.entries) {
      this.listEl.appendChild(this.createEntryRow(entry));
    }
  }

  private async handleListClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const row = btn.closest('[data-task-id]') as HTMLElement | null;
    const taskId = row?.dataset.taskId;
    if (!taskId) return;
    const entry = this.entries.find((en) => en.taskId === taskId);
    if (!entry) return;
    const action = btn.dataset.action;
    const modelId = btn.dataset.modelId;
    if (action === 'resume') {
      try { this.onResume?.(entry); } catch (err) { logger.warn('History', '', 'onResume failed: ' + (err instanceof Error ? err.message : String(err))); }
    } else if (action === 'delete') {
      try {
        await this.historyManager.delete(taskId);
        this.entries = this.entries.filter((e2) => e2.taskId !== taskId);
        this.renderList();
      } catch (err) {
        logger.error('History', '', '删除失败: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (action === 'continueModel' && modelId) {
      try { this.onContinueModel?.(modelId); } catch (err) { logger.warn('History', '', 'onContinueModel failed: ' + (err instanceof Error ? err.message : String(err))); }
    }
  }

  private createEntryRow(entry: HistoryEntry): HTMLElement {
    const row = document.createElement('div');
    row.dataset.taskId = entry.taskId || entry.conversationId || '';
    row.style.cssText = 'border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);padding:8px 10px;margin-bottom:4px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';

    const timeEl = document.createElement('span');
    timeEl.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);flex-shrink:0;';
    timeEl.textContent = fmt(entry.createdAt);

    const modelCount = entry.results?.filter(r => r.content).length || 0;

    const qText = document.createElement('span');
    qText.style.cssText = 'flex:1;font-size:var(--font-size-sm);color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    qText.textContent = entry.question;

    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = '继续';
    resumeBtn.dataset.action = 'resume';
    resumeBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-primary);border-radius:3px;background:var(--color-primary);color:#FFCC00;cursor:pointer;flex-shrink:0;';

    const delBtn = document.createElement('button');
    delBtn.textContent = '\u2716';
    delBtn.dataset.action = 'delete';
    delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:var(--font-size-sm);color:var(--color-text-secondary);padding:1px 3px;flex-shrink:0;';

    header.appendChild(timeEl);
    if (modelCount > 0) {
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);flex-shrink:0;margin-right:4px;';
      tag.textContent = `${modelCount}模型`;
      header.appendChild(tag);
    }
    header.appendChild(qText);
    header.appendChild(resumeBtn);
    header.appendChild(delBtn);

    const body = document.createElement('div');
    body.style.cssText = 'padding:4px 0 0;border-top:1px solid var(--color-border);margin-top:4px;';
    if (entry.results) {
      for (const r of entry.results) {
        if (!r.content) continue;
        const resRow = document.createElement('div');
        resRow.style.cssText = 'display:flex;gap:4px;margin-bottom:2px;';
        const tagCol = document.createElement('div');
        tagCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:40px;flex-shrink:0;';
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:var(--font-size-sm);font-weight:600;color:var(--color-primary);padding-top:2px;text-align:center;';
        tag.textContent = MODEL_LABELS[r.modelId] || r.modelId;
        const contBtn = document.createElement('button');
        contBtn.textContent = '继续';
        contBtn.dataset.action = 'continueModel';
        contBtn.dataset.modelId = r.modelId;
        contBtn.style.cssText = 'padding:0 4px;font-size:var(--font-size-sm);border:1px solid var(--color-primary);border-radius:2px;background:transparent;color:var(--color-primary);cursor:pointer;flex-shrink:0;margin-top:1px;';
        tagCol.appendChild(tag);
        tagCol.appendChild(contBtn);
        const content = document.createElement('div');
        content.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);flex:1;word-wrap:break-word;';
        content.textContent = truncate(r.content, 110);
        resRow.appendChild(tagCol);
        resRow.appendChild(content);
        body.appendChild(resRow);
      }
    }

    row.appendChild(header);
    if (body.children.length > 0) row.appendChild(body);
    return row;
  }
}
