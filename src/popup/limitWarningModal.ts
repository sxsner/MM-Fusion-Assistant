import type { ModelType } from '../shared/types';
import type { CheckResult } from '../background/fileLimitChecker';

const MODEL_LABELS: Record<ModelType, string> = {
  chatgpt: 'GPT',
  claude: 'Claud',
  gemini: 'Gmini',
  deepseek: 'DSeek',
  grok: 'Grok',
  doubao: 'Seed',
  glm: 'GLM',
  qwne: 'Qwne', qwnc: 'QwnC',
  hunyuan: 'Hy',
  kimi: 'Kimi',
  minimax: 'Nimax',
  longcat: 'LCat',
  stepfun: 'Step',
  mimo: 'MiMo',
};

function buildReason(result: CheckResult): string {
  if (result.skippedReason) return result.skippedReason;
  const parts: string[] = [];
  if (result.oversizedFiles.length > 0) {
    parts.push(`文件超限（最大 ${result.maxSizeMB}MB）`);
  }
  if (result.unsupportedFiles.length > 0) {
    parts.push(`不支持的文件类型`);
  }
  if (result.maxFiles > 0) {
    const fileCount = result.oversizedFiles.length + result.unsupportedFiles.length;
    if (fileCount === 0) {
      parts.push(`文件数超限（最多 ${result.maxFiles} 个）`);
    }
  }
  return parts.join('；') || '超出上传限制';
}

export class LimitWarningModal {
  private overlay: HTMLDivElement;
  private resolve: ((value: 'proceed' | 'adjust') => void) | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:1000',
      'background:rgba(0,0,0,.4)',
      'align-items:center',
      'justify-content:center',
    ].join(';');
    container.appendChild(this.overlay);
  }

  show(skippedModels: ModelType[], checkResults: Record<string, CheckResult>): Promise<'proceed' | 'adjust'> {
    return new Promise((resolve) => {
      this.resolve = resolve;

      const dialog = document.createElement('div');
      dialog.style.cssText = [
        'background:var(--color-surface)',
        'border-radius:var(--radius-md)',
        'padding:var(--space-lg)',
        'max-width:480px',
        'width:90%',
        'max-height:80vh',
        'overflow-y:auto',
        'font-family:var(--font-sans)',
        'font-size:var(--font-size-md)',
        'box-shadow:0 4px 24px rgba(0,0,0,.15)',
      ].join(';');

      const title = document.createElement('h3');
      title.textContent = '文件上传限制提示';
      title.style.cssText = [
        'margin:0 0 var(--space-md)',
        'font-size:var(--font-size-md)',
        'font-weight:600',
        'color:var(--color-text)',
      ].join(';');
      dialog.appendChild(title);

      const list = document.createElement('ul');
      list.style.cssText = [
        'margin:0 0 var(--space-md)',
        'padding:0',
        'list-style:none',
        'display:flex',
        'flex-direction:column',
        'gap:var(--space-sm)',
      ].join(';');

      for (const modelId of skippedModels) {
        const item = document.createElement('li');
        item.style.cssText = [
          'padding:var(--space-sm)',
          'background:var(--color-bg-secondary, #f5f5f5)',
          'border-radius:var(--radius-sm)',
          'font-size:var(--font-size-sm)',
        ].join(';');

        const label = document.createElement('strong');
        label.textContent = MODEL_LABELS[modelId] || modelId;
        item.appendChild(label);

        const reasonText = document.createElement('span');
        reasonText.textContent = ` — ${buildReason(checkResults[modelId])}`;
        reasonText.style.color = 'var(--color-text-secondary, #666)';
        item.appendChild(reasonText);

        list.appendChild(item);
      }

      dialog.appendChild(list);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = [
        'display:flex',
        'justify-content:flex-end',
        'gap:var(--space-sm)',
        'margin-top:var(--space-md)',
      ].join(';');

      const adjustBtn = document.createElement('button');
      adjustBtn.textContent = '调整文件';
      adjustBtn.style.cssText = [
        'padding:var(--space-sm) var(--space-lg)',
        'font-family:var(--font-sans)',
        'font-size:var(--font-size-md)',
        'border:1px solid var(--color-border)',
        'border-radius:var(--radius-md)',
        'background:var(--color-surface)',
        'cursor:pointer',
        'color:var(--color-text)',
      ].join(';');

      const proceedBtn = document.createElement('button');
      proceedBtn.textContent = '跳过受限模型继续';
      proceedBtn.style.cssText = [
        'padding:var(--space-sm) var(--space-lg)',
        'font-family:var(--font-sans)',
        'font-size:var(--font-size-md)',
        'background:var(--color-primary)',
        'color:#FFCC00',
        'border:none',
        'border-radius:var(--radius-md)',
        'cursor:pointer',
      ].join(';');

      adjustBtn.addEventListener('click', () => {
        this.hide();
        this.resolve?.('adjust');
      });

      proceedBtn.addEventListener('click', () => {
        this.hide();
        this.resolve?.('proceed');
      });

      btnRow.appendChild(adjustBtn);
      btnRow.appendChild(proceedBtn);
      dialog.appendChild(btnRow);

      this.overlay.innerHTML = '';
      this.overlay.appendChild(dialog);
      this.overlay.style.display = 'flex';
    });
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.resolve = null;
  }
}
