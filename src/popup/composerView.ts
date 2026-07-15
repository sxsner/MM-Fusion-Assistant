import { logger } from '../shared/logger';
import type { ModelType, Attachment, TaskSubmitMessage } from '../shared/types';
import { MODEL_IDS } from '../shared/constants';
import { Store } from '../shared/store';

export function createTaskSubmitMessage(
  text: string, traceId: string, targetModels: ModelType[], attachments?: Attachment[],
): TaskSubmitMessage {
  return {
    channel: 'task:submit',
    payload: { text, timestamp: Date.now(), targetModels, attachments },
    trace_id: traceId,
  };
}

// 文件注入已稳定，不再需要转文字附件
// async function fileToAttachment(file: File): Promise<Attachment> { ... }

export class ComposerView {
  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private fileBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private fileLabel: HTMLDivElement;
  private selectedFiles: File[] = [];
  private getConversationUrls?: () => Partial<Record<string, string>> | undefined;
  getConversationId?: () => string | undefined;
  private clearCallback?: () => void;
  private syncCallback?: () => void;
  private sendCallback?: (taskId: string) => void;
  private activateCallback?: () => Promise<void>;
  private syncTimer?: ReturnType<typeof setTimeout>; // [BUG-FIX] B-008 - 保存 setTimeout ID 用于销毁时清除
  private ac: AbortController; // [BUG-FIX] B-006 - 添加 AbortController 生命周期管理

  constructor(container: HTMLElement, private store?: Store, getConversationUrls?: () => Partial<Record<string, string>> | undefined, getConversationId?: () => string | undefined) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.getConversationUrls = getConversationUrls;
    this.getConversationId = getConversationId;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;';

    const textareaRow = document.createElement('div');
    textareaRow.style.cssText = 'display:flex;gap:4px;align-items:flex-end;';

    this.fileLabel = document.createElement('div');
    this.fileLabel.style.cssText = 'display:none;font-size:var(--font-size-sm);color:var(--color-text-secondary);padding:0 2px;word-break:break-all;';

    this.textarea = document.createElement('textarea');
    this.textarea.placeholder = '输入消息...';
    this.textarea.style.cssText = [
      'flex:1;min-height:32px;max-height:80px;padding:6px 8px;resize:none;',
      'font-family:var(--font-sans);font-size:var(--font-size-sm);',
      'border:1px solid var(--color-border);border-radius:var(--radius-md);outline:none;box-sizing:border-box;',
    ].join(';');

    const updateSendBtn = () => { this.sendBtn.disabled = this.textarea.value.trim() === '' && this.selectedFiles.length === 0; };
    this.textarea.addEventListener('input', updateSendBtn, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      this.selectedFiles = Array.from(this.fileInput.files || []);
      this.fileLabel.textContent = this.selectedFiles.map(f => f.name).join(', ');
      this.fileLabel.style.display = this.selectedFiles.length > 0 ? 'block' : 'none';
      updateSendBtn();
      logger.info('UI', crypto.randomUUID(), `文件已选择: ${this.selectedFiles.length}个 ${this.selectedFiles.map(f => f.name).join(', ')}`);
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const btnBase: Record<string, string> = {
      padding: '3px 10px', 'flex-shrink': '0',
      'font-family': 'var(--font-sans)', 'font-size': 'var(--font-size-sm)',
      border: '1px solid var(--color-border)', 'border-radius': 'var(--radius-sm)',
      cursor: 'pointer', display: 'inline-flex', 'align-items': 'center',
    };
    function btnStyle(overrides: Record<string, string>): string {
      return Object.entries({ ...btnBase, ...overrides }).map(([k, v]) => `${k}:${v}`).join(';');
    }

    this.fileBtn = document.createElement('button');
    this.fileBtn.textContent = '+';
    this.fileBtn.title = '上传文件';
    this.fileBtn.style.cssText = btnStyle({ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', width: '32px', 'justify-content': 'center' });
    this.fileBtn.addEventListener('click', () => this.fileInput.click(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    this.sendBtn = document.createElement('button');
    this.sendBtn.textContent = '发送';
    this.sendBtn.disabled = true;
    this.sendBtn.style.cssText = btnStyle({ background: 'var(--color-primary)', color: '#FFCC00', border: 'none' });

    this.clearBtn = document.createElement('button');
    this.clearBtn.textContent = '清空';
    this.clearBtn.title = '清空所有模型回复';
    this.clearBtn.style.cssText = btnStyle({ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' });

    const closeAllBtn = document.createElement('button');
    closeAllBtn.textContent = '全部关闭';
    closeAllBtn.title = '关闭所有后台模型窗口';
    closeAllBtn.style.cssText = btnStyle({ background: 'var(--color-surface)', color: 'var(--color-status-error)', 'margin-left': 'auto' });
    closeAllBtn.addEventListener('click', () => {
      if (!confirm('确定关闭所有后台标签页？')) return;
      chrome.runtime.sendMessage({ channel: 'tabs:closeAll' }).catch(() => {});
    }, { signal: this.ac.signal });

    const syncBtn = document.createElement('button');
    syncBtn.textContent = '手动同步';
    syncBtn.title = '强制同步最新回答';
    syncBtn.style.cssText = btnStyle({ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' });
    let syncCooldown = false;
    syncBtn.addEventListener('click', () => {
      if (syncCooldown) return;
      syncCooldown = true;
      syncBtn.style.opacity = '0.5';
      syncBtn.style.cursor = 'default';
      this.syncCallback?.();
      this.syncTimer = setTimeout(() => { syncCooldown = false; syncBtn.style.opacity = '1'; syncBtn.style.cursor = 'pointer'; }, 2000); // [BUG-FIX] B-008 - 保存 timeout ID
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const activateBtn = document.createElement('button');
    activateBtn.textContent = '依次激活';
    activateBtn.title = '逐个激活模型窗口到前台';
    activateBtn.style.cssText = btnStyle({ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' });
    let activating = false;
    activateBtn.addEventListener('click', async () => {
      if (activating) return;
      activating = true;
      activateBtn.style.opacity = '0.5';
      activateBtn.style.cursor = 'default';
      if (this.activateCallback) await this.activateCallback();
      activating = false;
    }, { signal: this.ac.signal });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:4px;';

    wrapper.appendChild(this.fileLabel);
    textareaRow.appendChild(this.textarea);
    wrapper.appendChild(textareaRow);
    btnRow.appendChild(this.fileBtn);
    btnRow.appendChild(this.fileInput);
    btnRow.appendChild(this.sendBtn);
    btnRow.appendChild(this.clearBtn);
    btnRow.appendChild(activateBtn);
    btnRow.appendChild(closeAllBtn);
    btnRow.appendChild(syncBtn);
    wrapper.appendChild(btnRow);
    container.appendChild(wrapper);

    this.sendBtn.addEventListener('click', () => this.handleSend(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.clearBtn.addEventListener('click', () => this.handleClear(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    logger.info('UI', crypto.randomUUID(), 'ComposerView 已加载');
  }

  onClear(callback: () => void): void {
    this.clearCallback = callback;
  }

  onActivate(callback: () => Promise<void>): void {
    this.activateCallback = callback;
  }

  onSync(callback: () => void): void {
    this.syncCallback = callback;
  }

  onSend(callback: (taskId: string) => void): void {
    this.sendCallback = callback;
  }

  destroy(): void { this.ac?.abort(); if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = undefined; } this.clearCallback = undefined; this.syncCallback = undefined; this.sendCallback = undefined; } // [BUG-FIX] B-006 - AbortController abort // [BUG-FIX] B-008 - 清除 syncTimer

  private async handleSend(): Promise<void> {
    const text = this.textarea.value.trim();
    if (!text && this.selectedFiles.length === 0) return;

    this.sendBtn.textContent = '...';
    this.sendBtn.disabled = true;

    try {
      const targetModels = this.store ? await this.store.getSelectedModels() : MODEL_IDS as ModelType[];
      if (targetModels.length === 0) { this.sendBtn.textContent = '发送'; this.sendBtn.disabled = false; return; }

      const tid = crypto.randomUUID();
      logger.info('UI', tid, '提交任务: ' + text.substring(0, 50));

      let attachments: Attachment[] | undefined;
      // 文件注入已稳定，不再需要转文字附件
      // if (this.selectedFiles.length > 0) { ... }

      const conversationUrls = this.getConversationUrls?.();
      const conversationId = this.getConversationId?.();
      logger.info('UI', tid, `conversationId=${conversationId || '(none)'}`);
      const base = createTaskSubmitMessage(text, tid, targetModels, attachments);
      let msg: any = base;
      if (conversationUrls) msg = { ...msg, payload: { ...msg.payload, conversationUrls } };
      if (conversationId) msg = { ...msg, payload: { ...msg.payload, conversationId } };

      const response = await chrome.runtime.sendMessage(msg).catch((err) => { logger.error('UI', tid, '发送失败: ' + (err instanceof Error ? err.message : String(err))); return null; });
      if (response && !response.success) {
        logger.warn('UI', tid, '后台返回失败: ' + (response.error?.message || JSON.stringify(response)));
      } else {
        logger.info('UI', tid, '后台已接受任务');
        this.sendCallback?.(response?.data?.taskId || tid);
      }
    } catch (err) {
      logger.error('UI', crypto.randomUUID(), '发送异常: ' + (err instanceof Error ? err.message : String(err)));
    }
    this.sendBtn.textContent = '发送';
    this.sendBtn.disabled = true;
    this.textarea.value = '';
    this.selectedFiles = [];
    this.fileInput.value = '';
    this.fileLabel.textContent = '';
    this.fileLabel.style.display = 'none';
  }

  setText(text: string): void {
    this.textarea.value = text;
    this.sendBtn.disabled = text.trim() === '' && this.selectedFiles.length === 0;
  }

  private handleClear(): void {
    this.clearCallback?.();
  }
}
