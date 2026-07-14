import { MODEL_IDS } from '../shared/constants';
import type { ModelType } from '../shared/types';
import { Store } from '../shared/store';

const MODEL_LABELS: Record<ModelType, string> = {
  chatgpt: 'GPT',
  claude: 'Claud',
  gemini: 'Gmini',
  deepseek: 'DSeek',
  grok: 'Grok',
  doubao: 'Seed',
  glm: 'GLM',
  qwne: 'QwnE', qwnc: 'QwnC',
  hunyuan: 'Hy',
  kimi: 'Kimi',
  minimax: 'Nimax',
  longcat: 'LCat',
  stepfun: 'Step',
  mimo: 'MiMo',
};

const MODEL_COLORS: Record<ModelType, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#4285f4',
  deepseek: '#4f46e5',
  grok: '#1da1f2',
  doubao: '#a855f7',
  glm: '#3b82f6',
  qwne: '#6366f1', qwnc: '#8b5cf6',
  hunyuan: '#0052d9',
  kimi: '#ef4444',
  minimax: '#f59e0b',
  longcat: '#14b8a6',
  stepfun: '#8b5cf6',
  mimo: '#e11d48',
};

export class ModelSelector {
  private panel: HTMLDivElement;
  private checkboxes: Map<ModelType, HTMLInputElement> = new Map();
  private onChange: (selected: ModelType[]) => void;
  private store?: Store;
  private offStoreChange?: () => void;

  constructor(
    container: HTMLElement,
    onChange: (selected: ModelType[]) => void,
    store?: Store,
  ) {
    this.onChange = onChange;
    this.store = store;

    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:var(--space-sm)',
      'padding:var(--space-xs) 0',
    ].join(';');

    for (const id of MODEL_IDS) {
      const modelId = id as ModelType;
      const item = this.buildItem(modelId);
      this.panel.appendChild(item);
    }

    container.appendChild(this.panel);

    if (this.store) {
      this.offStoreChange = this.store.onChange((models) => this.applyModels(models));
      this.restoreFromStore();
    } else {
      this.emitChange();
    }
  }

  getElement(): HTMLDivElement {
    return this.panel;
  }

  destroy(): void {
    // [BUG-FIX] WG3-1 - 取消 store 监听器，防止泄漏
    this.offStoreChange?.();
  }

  private buildItem(modelId: ModelType): HTMLLabelElement {
    const label = document.createElement('label');
    label.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:4px',
      'cursor:pointer',
      'font-family:var(--font-sans)',
      'font-size:var(--font-size-sm)',
      'user-select:none',
    ].join(';');

    const dot = document.createElement('span');
    dot.setAttribute('data-testid', 'brand-dot');
    dot.style.cssText = [
      'display:inline-block',
      `width:8px`,
      `height:8px`,
      `border-radius:50%`,
      `background:${MODEL_COLORS[modelId]}`,
      'flex-shrink:0',
    ].join(';');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.style.cssText = 'margin:0;cursor:pointer';
    this.checkboxes.set(modelId, cb);

    cb.addEventListener('change', () => {
      if (cb.checked && (modelId === 'qwne' || modelId === 'qwnc')) {
        const other = modelId === 'qwne' ? 'qwnc' : 'qwne';
        const otherCb = this.checkboxes.get(other as ModelType);
        if (otherCb?.checked) {
          otherCb.checked = false;
        }
      }
      this.emitChange();
    });

    label.appendChild(dot);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(MODEL_LABELS[modelId]));

    return label;
  }

  getSelected(): ModelType[] {
    const selected: ModelType[] = [];
    for (const [id, cb] of this.checkboxes) {
      if (cb.checked) selected.push(id);
    }
    return selected;
  }

  private async restoreFromStore(): Promise<void> {
    if (!this.store) return;
    const models = await this.store.getSelectedModels();
    this.applyModels(models);
    this.emitChange();
  }

  private applyModels(models: ModelType[]): void {
    for (const [id, cb] of this.checkboxes) {
      cb.checked = models.includes(id);
    }
  }

  private emitChange(): void {
    const selected = this.getSelected();
    this.onChange(selected);
    if (this.store) {
      this.store.setSelectedModels(selected);
    }
  }
}
