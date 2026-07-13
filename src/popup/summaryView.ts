import { MarkdownRenderer } from './markdownRenderer';
import { logger } from '../shared/logger'; // [BUG-FIX] B-012 - 添加 logger 导入用于 clipboard 错误日志

export class SummaryView {
  private root: HTMLDivElement;
  private contentArea: HTMLDivElement;
  private triggerBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private scoreBtn: HTMLButtonElement;
  private loadingEl: HTMLDivElement;
  private errorEl: HTMLDivElement;
  private sourceIndicator: HTMLSpanElement;
  private rawMarkdown = '';
  private markdownRenderer: MarkdownRenderer;
  private onTrigger?: () => void;
  private onScore?: () => void;
  private ac: AbortController;

  constructor(container: HTMLElement) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.markdownRenderer = new MarkdownRenderer();

    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:var(--space-xs) 0 0;flex-shrink:0;';

    this.contentArea = document.createElement('div');
    this.contentArea.style.cssText = [
      'display:block', 'padding:var(--space-xs) var(--space-sm)',
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
      'line-height:1.6', 'color:var(--color-text-secondary)',
      'font-style:italic', 'word-break:break-word', 'white-space:pre-wrap',
      'border:1px solid var(--color-border)',
      'border-radius:var(--radius-md)',
      'background:var(--color-surface)',
      'height:180px', 'min-height:60px', 'overflow-y:auto',
    ].join(';');
    this.contentArea.textContent = '点击"生成汇总"获取多模型答案的整合摘要';

    this.loadingEl = document.createElement('div');
    this.loadingEl.style.cssText = [
      'display:none', 'padding:var(--space-xs) var(--space-sm)',
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
      'color:var(--color-text-secondary)', 'text-align:center',
    ].join(';');
    this.loadingEl.innerHTML = '汇总生成中...';

    this.errorEl = document.createElement('div');
    this.errorEl.style.cssText = [
      'display:none', 'padding:var(--space-xs) var(--space-sm)',
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
      'color:var(--color-status-error)', 'white-space:pre-wrap',
      'word-break:break-word',
    ].join(';');

    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

    this.triggerBtn = document.createElement('button');
    this.triggerBtn.textContent = '生成汇总';
    this.triggerBtn.style.cssText = this.btnStyle('var(--color-primary)', '#FFCC00');

    this.copyBtn = document.createElement('button');
    this.copyBtn.textContent = '复制';
    this.copyBtn.style.cssText = this.btnStyle('var(--color-surface)', 'var(--color-text-secondary)');
    this.copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(this.contentArea.textContent || '').catch((err) => {
        logger.warn('SUMMARY', crypto.randomUUID(), 'copy failed: ' + (err instanceof Error ? err.message : String(err)));
      });
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '导出';
    exportBtn.style.cssText = this.btnStyle('var(--color-surface)', 'var(--color-text-secondary)');
    exportBtn.addEventListener('click', () => this.doExportText(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal

    this.sourceIndicator = document.createElement('span');
    this.sourceIndicator.style.cssText = 'margin-left:auto;font-size:var(--font-size-sm);color:var(--color-text-secondary);font-family:var(--font-sans);';
    this.sourceIndicator.textContent = '来源: API';

    btnBar.appendChild(this.triggerBtn);
    btnBar.appendChild(this.copyBtn);
    this.scoreBtn = document.createElement('button');
    this.scoreBtn.textContent = '计入评分';
    this.scoreBtn.style.cssText = this.btnStyle('var(--color-primary)', '#FFCC00');
    this.scoreBtn.addEventListener('click', () => this.onScore?.(), { signal: this.ac.signal });

    btnBar.appendChild(exportBtn);
    btnBar.appendChild(this.scoreBtn);
    btnBar.appendChild(this.sourceIndicator);

    this.root.appendChild(this.contentArea);
    this.root.appendChild(this.loadingEl);
    this.root.appendChild(this.errorEl);
    this.root.appendChild(btnBar);
    container.appendChild(this.root);

    this.triggerBtn.addEventListener('click', () => this.onTrigger?.(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
  }

  private btnStyle(bg: string, color: string): string {
    return [
      'padding:3px 10px',
      'font-family:var(--font-sans);font-size:var(--font-size-sm)',
      'border:1px solid var(--color-border)',
      'border-radius:var(--radius-sm)',
      `background:${bg};color:${color}`,
      'cursor:pointer;flex-shrink:0',
      'display:inline-flex;align-items:center',
    ].join(';');
  }

  showLoading(): void {
    this.errorEl.style.display = 'none';
    this.loadingEl.style.display = 'none';
    this.contentArea.style.display = 'block';
    this.contentArea.style.color = 'var(--color-text-secondary)';
    this.contentArea.style.fontStyle = 'italic';
    this.contentArea.textContent = '汇总生成中...';
    this.triggerBtn.disabled = true;
    this.triggerBtn.textContent = '汇总中...';
    this.copyBtn.disabled = true;
  }

  showContent(content: string): void {
    this.loadingEl.style.display = 'none';
    this.errorEl.style.display = 'none';
    this.contentArea.style.display = 'block';
    this.contentArea.style.color = 'var(--color-text)';
    this.contentArea.style.fontStyle = 'normal';
    this.contentArea.innerHTML = this.markdownRenderer.render(content);
    this.triggerBtn.disabled = false;
    this.triggerBtn.textContent = '生成汇总';
    this.copyBtn.disabled = false;
  }

  appendContent(chunk: string): void {
    this.loadingEl.style.display = 'none';
    this.errorEl.style.display = 'none';
    this.contentArea.style.display = 'block';
    this.contentArea.style.color = 'var(--color-text)';
    this.contentArea.style.fontStyle = 'normal';
    this.rawMarkdown += chunk; // [BUG-FIX] B-016 - 追加原始 markdown 而非 innerHTML
    this.contentArea.innerHTML = this.markdownRenderer.render(this.rawMarkdown); // [BUG-FIX] B-016 - 每次全量渲染 markdown
    this.contentArea.scrollTop = this.contentArea.scrollHeight;
  }

  showError(error: string): void {
    this.loadingEl.style.display = 'none';
    this.contentArea.style.display = 'block';
    this.contentArea.style.color = 'var(--color-status-error)';
    this.contentArea.style.fontStyle = 'normal';
    this.contentArea.textContent = error;
    this.errorEl.style.display = 'none';
    this.triggerBtn.disabled = false;
    this.triggerBtn.textContent = '重试';
    this.copyBtn.disabled = true;
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  onTriggerSummary(callback: () => void): void {
    this.onTrigger = callback;
  }

  onScoreSummary(callback: () => void): void {
    this.onScore = callback;
  }

  setScoreLoading(loading: boolean): void {
    this.scoreBtn.disabled = loading;
    this.scoreBtn.textContent = loading ? '评分中...' : '计入评分';
  }

  destroy(): void { this.ac?.abort(); this.onTrigger = undefined; this.onScore = undefined; } // [BUG-FIX] B-006 - AbortController abort

  setSource(source: 'API' | '网页端'): void {
    this.sourceIndicator.textContent = `来源: ${source}`;
  }

  clear(): void {
    this.loadingEl.style.display = 'none';
    this.errorEl.style.display = 'none';
    this.contentArea.style.display = 'block';
    this.contentArea.style.color = 'var(--color-text-secondary)';
    this.contentArea.style.fontStyle = 'italic';
    this.contentArea.textContent = '点击"生成汇总"获取多模型答案的整合摘要';
    this.rawMarkdown = ''; // [BUG-FIX] B-016 - 清空时同时重置原始 markdown
    this.triggerBtn.disabled = false;
    this.triggerBtn.textContent = '生成汇总';
    this.copyBtn.disabled = false;
  }

  setExportData(_question: string, _modelResults: Array<{ modelId: string; content: string }>): void {
    // TODO: 暂不实现，数据通过 React 流式渲染 // [BUG-FIX] B-013 - 保留空方法体作为公共 API 占位
  }

  private doExportText(): void {
    const content = this.contentArea.textContent || '';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omnicast-summary.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
}
