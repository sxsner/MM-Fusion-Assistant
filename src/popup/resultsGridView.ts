import type { ModelType } from '../shared/types';
import { MarkdownRenderer } from './markdownRenderer';

export class ResultsGridView {
  private root: HTMLDivElement;
  private box: HTMLDivElement;
  private markdownRenderer: MarkdownRenderer;
  private static readonly MAX_MODEL_ENTRIES = 50; // [BUG-FIX] B-004 - Map 上限保护
  private modelContents = new Map<ModelType, string>();
  private activeModel: ModelType | null = null;

  constructor(container: HTMLElement) {
    this.markdownRenderer = new MarkdownRenderer();

    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;';

    this.box = document.createElement('div');
    this.box.setAttribute('data-testid', 'model-row');
    this.box.style.cssText = [
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)', 'line-height:1.5',
      'color:var(--color-text)', 'white-space:pre-wrap', 'word-break:break-word',
      'height:180px', 'min-height:60px', 'overflow-y:auto',
      'border:1px solid var(--color-border)', 'border-radius:var(--radius-md)', 'padding:var(--space-xs) var(--space-sm)',
    ].join(';');

    this.root.appendChild(this.box);
    container.appendChild(this.root);
  }

  updateContent(modelId: ModelType, content: string): void {
    this.modelContents.set(modelId, content);
    if (this.modelContents.size > ResultsGridView.MAX_MODEL_ENTRIES) { // [BUG-FIX] B-004 - Map 上限检查
      const firstKey = this.modelContents.keys().next().value;
      if (firstKey !== undefined) this.modelContents.delete(firstKey);
    }
    if (this.activeModel === modelId || !this.activeModel) {
      this.box.innerHTML = this.markdownRenderer.render(content);
    }
  }

  appendContent(modelId: ModelType, content: string): void {
    const existing = this.modelContents.get(modelId) || '';
    const updated = this.markdownRenderer.appendStream(existing, content);
    this.modelContents.set(modelId, updated);
    if (this.modelContents.size > ResultsGridView.MAX_MODEL_ENTRIES) { // [BUG-FIX] B-004 - Map 上限检查
      const firstKey = this.modelContents.keys().next().value;
      if (firstKey !== undefined) this.modelContents.delete(firstKey);
    }
    if (this.activeModel === modelId || !this.activeModel) {
      this.box.innerHTML = this.markdownRenderer.render(updated);
    }
  }

  showOnly(modelId: ModelType | null): void {
    if (modelId) {
      this.activeModel = modelId;
      const content = this.modelContents.get(modelId);
      this.box.innerHTML = content ? this.markdownRenderer.render(content) : '';
    } else if (this.modelContents.size > 0) {
      const entries = Array.from(this.modelContents.entries());
      const first = entries[0];
      this.activeModel = first[0];
      this.box.innerHTML = this.markdownRenderer.render(first[1]);
    } else {
      this.activeModel = null;
      this.box.innerHTML = '';
    }
  }

  clearContent(): void {
    this.modelContents.clear();
    this.box.innerHTML = '';
  }

  getVisibleModel(): ModelType | null {
    return this.activeModel;
  }

  destroy(): void { this.modelContents.clear(); this.box.innerHTML = ''; this.markdownRenderer = undefined as any; }
}
