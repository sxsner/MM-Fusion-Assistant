import { logger } from '../shared/logger'; // [BUG-FIX] WG6-catch-as - 添加 logger 导入用于 catch 错误日志
import { getLogs, onLog, clearLogs, loadPersistedLogs } from '../shared/logBuffer';

export class DebugConsole {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private unsub?: () => void;
  private ac: AbortController; // [BUG-FIX] B-006 - 添加 AbortController 生命周期管理

  constructor(container: HTMLElement) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;flex:1;font-family:var(--font-sans);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:var(--space-xs);padding:4px 0;flex-shrink:0;';

    const title = document.createElement('span');
    title.textContent = '运行日志';
    title.style.cssText = 'font-weight:600;font-size:var(--font-size-md);';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.style.cssText = 'background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-secondary);cursor:pointer;font-family:inherit;font-size:var(--font-size-sm);padding:2px 8px;';
    copyBtn.addEventListener('click', () => {
      const text = getLogs().map((e) => `${e.timestamp} [${e.level}] [${e.module}] [${e.traceId}] ${e.message}`).join('\n');
      navigator.clipboard.writeText(text).catch((err) => {
        logger.warn('CONSOLE', crypto.randomUUID(), 'copy failed: ' + (err instanceof Error ? err.message : String(err)));
      });
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cssText = 'background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-secondary);cursor:pointer;font-family:inherit;font-size:var(--font-size-sm);padding:2px 8px;margin-left:auto;';
    clearBtn.addEventListener('click', () => { clearLogs(); this.render(); }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '导出';
    exportBtn.style.cssText = 'background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-secondary);cursor:pointer;font-family:inherit;font-size:var(--font-size-sm);padding:2px 8px;';
    exportBtn.addEventListener('click', () => {
      const logs = getLogs().map((e) => `${e.timestamp} [${e.level}] [${e.module}] [${e.traceId}] ${e.message}`).join('\n');
      const blob = new Blob([logs], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omnilog-${Date.now()}.log`;
      a.click();
      URL.revokeObjectURL(url);
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    this.body = document.createElement('div');
    this.body.style.cssText = 'flex:1;overflow-y:auto;padding:var(--space-xs);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:var(--font-size-sm);line-height:1.5;';

    header.appendChild(title);
    header.appendChild(copyBtn);
    header.appendChild(clearBtn);
    header.appendChild(exportBtn);
    this.root.appendChild(header);
    this.root.appendChild(this.body);
    container.appendChild(this.root);

    loadPersistedLogs().then(() => this.render()).catch((err) => logger.error('DebugConsole', '', '加载持久化日志失败: ' + (err instanceof Error ? err.message : String(err)))); // [BUG-FIX] WG6-catch-as - 补全缺失的 catch 错误处理
    this.unsub = onLog(() => this.render());
  }

  private render(): void {
    try {
      const logs = getLogs();
      const badge: Record<string, string> = {
        DEBUG: 'background:#9ca3af;color:#fff',
        INFO: 'background:#3b82f6;color:#fff',
        WARN: 'background:#f59e0b;color:#fff',
        ERROR: 'background:#ef4444;color:#fff',
      };

      // [BUG-FIX] WG0-1 - Use safe DOM APIs instead of innerHTML to prevent XSS
      this.body.textContent = '';
      const fragment = document.createDocumentFragment();
      for (const e of logs) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:1px 0;display:flex;gap:4px;align-items:baseline';

        const levelSpan = document.createElement('span');
        levelSpan.style.cssText = `${badge[e.level] || badge.DEBUG};padding:0 4px;border-radius:2px;font-size:var(--font-size-sm);flex-shrink:0`;
        levelSpan.textContent = e.level;

        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'color:var(--color-text-secondary);font-size:var(--font-size-sm);flex-shrink:0';
        timeSpan.textContent = e.timestamp;

        const msgSpan = document.createElement('span');
        msgSpan.style.cssText = 'color:var(--color-text)';
        msgSpan.textContent = e.message;

        row.appendChild(levelSpan);
        row.appendChild(timeSpan);
        row.appendChild(msgSpan);
        fragment.appendChild(row);
      }
      this.body.appendChild(fragment);
      this.body.scrollTop = this.body.scrollHeight;
    } catch (err) { logger.warn('CONSOLE', crypto.randomUUID(), 'render failed: ' + (err instanceof Error ? err.message : String(err))); }
  }

  destroy(): void {
    this.ac?.abort(); // [BUG-FIX] B-006 - AbortController abort
    this.unsub?.();
  }
}
