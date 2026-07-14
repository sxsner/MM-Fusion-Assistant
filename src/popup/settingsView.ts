import { SummarySettingsStore, Store, getTimingConfig, setTimingConfig } from '../shared/store';
import type { TimingConfig } from '../shared/store';
import type { SummarySettings, ModelType } from '../shared/types';
import { MODEL_IDS } from '../shared/constants';
import { isModelType } from '../shared/guards';
import { logger } from '../shared/logger';

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude-api', label: 'Claude' },
  { value: 'gemini-api', label: 'Gemini' },
  { value: 'custom', label: 'Custom' },
];

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT', claude: 'Claud', gemini: 'Gmini', deepseek: 'DSeek', grok: 'Grok',
  doubao: 'Seed', glm: 'GLM', qwne: 'QwnE', qwnc: 'QwnC', hunyuan: 'Hy',
  kimi: 'Kimi', minimax: 'Nimax', longcat: 'LCat', stepfun: 'Step', mimo: 'MiMo',
};

export class SettingsView {
  private root: HTMLDivElement;
  private store: SummarySettingsStore;
  private apiSection!: HTMLDivElement;
  private webSection!: HTMLDivElement;
  private providerSelect!: HTMLSelectElement;
  private apiKeyInput!: HTMLInputElement;
  private baseUrlGroup!: HTMLDivElement;
  private baseUrlInput!: HTMLInputElement;
  private modelNameInput!: HTMLInputElement;
  private webModelSelect!: HTMLSelectElement;
  private verifyBtn!: HTMLButtonElement;
  private verifyResult!: HTMLSpanElement;
  private modelToggles: HTMLButtonElement[] = [];
  private onModelChange?: () => void;

  private modelStore?: Store;
  private onStoreChange?: () => void;
  private timingSection!: HTMLDivElement;
  private concurrencyInput!: HTMLInputElement;
  private concurrencyIntervalInput!: HTMLInputElement;
  private inputIntervalInput!: HTMLInputElement;
  private sendIntervalInput!: HTMLInputElement;
  private ac: AbortController; // [BUG-FIX] B-006 - 添加 AbortController 生命周期管理

  constructor(container: HTMLElement, store: SummarySettingsStore, modelStore?: Store, onModelChange?: () => void) {
    this.ac = new AbortController(); // [BUG-FIX] B-006 - 初始化 AbortController
    this.store = store;
    this.modelStore = modelStore;
    this.onModelChange = onModelChange;
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'display:flex', 'flex-direction:column', 'gap:6px',
      'padding:6px 8px', 'flex:1', 'overflow-y:auto',
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
    ].join(';');

    this.buildUI();
    container.appendChild(this.root);

    this.store.get().then((s) => this.applySettings(s))      .catch((err) => logger.error('SETTINGS', crypto.randomUUID(), 'failed to load store: ' + (err instanceof Error ? err.message : String(err))));
    this.onStoreChange = this.store.onChange((s) => this.applySettings(s));

    getTimingConfig().then((c) => this.applyTiming(c));
  }

  private buildUI(): void {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);';
    const title = document.createElement('span');
    title.textContent = '设置';
    title.style.cssText = 'font-weight:600;font-size:var(--font-size-md);';
    const modelToggleHint = document.createElement('span');
    modelToggleHint.textContent = '启用模型（点击切换）';
    modelToggleHint.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);font-weight:400;';
    const version = document.createElement('span');
    version.textContent = 'v' + chrome.runtime.getManifest().version;
    version.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);';
    headerLeft.appendChild(title);
    headerLeft.appendChild(modelToggleHint);
    header.appendChild(headerLeft);
    header.appendChild(version);
    this.root.appendChild(header);

    this.buildModelSelection();
    this.buildSummarySection();
    this.buildBehaviorConfig();
    this.buildTimingConfig();
  }

  private buildModelSelection(): void {
    const section = document.createElement('div');
    section.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-xs);';

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

    const colorMap: Record<string, string> = {
      chatgpt: '#10a37f', claude: '#d97757', gemini: '#4285f4', deepseek: '#4f46e5', grok: '#1da1f2',
      doubao: '#a855f7', glm: '#3b82f6', qwne: '#6366f1', qwnc: '#8b5cf6', hunyuan: '#0052d9',
      kimi: '#ef4444', minimax: '#f59e0b', longcat: '#14b8a6',
      mimo: '#06b6d4', stepfun: '#84cc16',
    };
    let selectedModels: ModelType[] = [];

    const renderToggles = () => {
      list.innerHTML = '';
      this.modelToggles = [];
      for (const id of MODEL_IDS) {
        const isSelected = selectedModels.includes(id as ModelType);
        const btn = document.createElement('button');
        btn.style.cssText = [
          'display:inline-flex;align-items:center;justify-content:center;gap:4px;',
          'padding:4px 6px;min-width:72px;',
          'font-family:var(--font-sans);font-size:var(--font-size-sm);',
          'border:1px solid var(--color-border);border-radius:var(--radius-sm);',
          'cursor:pointer;', 'user-select:none;',
          isSelected
            ? `background:${colorMap[id] || '#999'};color:#fff;border-color:${colorMap[id] || '#999'};`
            : 'background:var(--color-surface);color:var(--color-text-secondary);',
        ].join(';');

        const dot = document.createElement('span');
        dot.style.cssText = [
          'display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0;',
          `background:${isSelected ? '#fff' : (colorMap[id] || '#999')};`,
        ].join(';');

        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(MODEL_LABELS[id] || id));

        btn.addEventListener('click', () => {
          const idx = selectedModels.indexOf(id as ModelType);
          if (idx >= 0) {
            selectedModels.splice(idx, 1);
          } else {
            if ((id === 'qwne' || id === 'qwnc')) {
              const other = id === 'qwne' ? 'qwnc' : 'qwne';
              const otherIdx = selectedModels.indexOf(other as ModelType);
              if (otherIdx >= 0) selectedModels.splice(otherIdx, 1);
            }
            selectedModels.push(id as ModelType);
          }
          this.modelStore?.setSelectedModels([...selectedModels]);
          this.onModelChange?.();
          renderToggles();
        }, { signal: this.ac.signal });

        list.appendChild(btn);
        this.modelToggles.push(btn);
      }
    };

    this.modelStore?.getSelectedModels().then((models) => { selectedModels = models; renderToggles(); }).catch((err) => { logger.warn('SETTINGS', crypto.randomUUID(), 'getSelectedModels failed: ' + (err instanceof Error ? err.message : String(err))); });
    if (!this.modelStore) renderToggles();

    section.appendChild(list);
    this.root.appendChild(section);
  }

  private buildSummarySection(): void {
    const modeGroup = document.createElement('div');
    modeGroup.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const modeLabel = document.createElement('span');
    modeLabel.textContent = '汇总来源';
    modeLabel.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);white-space:nowrap;';

    const apiBtn = document.createElement('button');
    apiBtn.textContent = 'API';
    apiBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);cursor:pointer;';
    const webBtn = document.createElement('button');
    webBtn.textContent = '网页端';
    webBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);cursor:pointer;';

    const updateModeBtns = (mode: 'api' | 'web') => {
      apiBtn.style.background = mode === 'api' ? 'var(--color-primary)' : 'var(--color-surface)';
      apiBtn.style.color = mode === 'api' ? '#FFCC00' : 'var(--color-text-secondary)';
      webBtn.style.background = mode === 'web' ? 'var(--color-primary)' : 'var(--color-surface)';
      webBtn.style.color = mode === 'web' ? '#FFCC00' : 'var(--color-text-secondary)';
    };

    apiBtn.addEventListener('click', () => { this.onModeChange('api'); updateModeBtns('api'); }, { signal: this.ac.signal });
    webBtn.addEventListener('click', () => { this.onModeChange('web'); updateModeBtns('web'); }, { signal: this.ac.signal });
    this.store.get().then((s) => updateModeBtns(s.mode || 'web')).catch(() => {});

    modeGroup.appendChild(modeLabel);
    modeGroup.appendChild(apiBtn);
    modeGroup.appendChild(webBtn);
    this.root.appendChild(modeGroup);

    this.apiSection = document.createElement('div');
    this.apiSection.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-xs);';
    this.buildApiConfig();
    this.root.appendChild(this.apiSection);

    this.webSection = document.createElement('div');
    this.webSection.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-xs);';
    this.buildWebConfig();
    this.root.appendChild(this.webSection);
  }

  private createField(label: string, input: HTMLElement): HTMLDivElement {
    const group = document.createElement('div');
    group.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);';
    group.appendChild(lbl);
    group.appendChild(input);
    return group;
  }

  private buildApiConfig(): void {
    this.providerSelect = document.createElement('select');
    this.providerSelect.style.cssText = 'padding:4px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:var(--font-size-sm);';
    for (const opt of PROVIDER_OPTIONS) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      this.providerSelect.appendChild(el);
    }
    this.providerSelect.addEventListener('change', () => {
      const isCustom = this.providerSelect.value === 'custom';
      this.baseUrlGroup.style.display = isCustom ? 'flex' : 'none';
      this.store.update({ provider: this.providerSelect.value });
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.apiSection.appendChild(this.createField('Provider', this.providerSelect));

    this.apiKeyInput = document.createElement('input');
    this.apiKeyInput.type = 'password';
    this.apiKeyInput.placeholder = 'sk-...';
    this.apiKeyInput.style.cssText = 'padding:4px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);width:100%;box-sizing:border-box;font-size:var(--font-size-sm);';
    this.apiKeyInput.addEventListener('input', () => this.store.update({ apiKey: this.apiKeyInput.value }), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.apiSection.appendChild(this.createField('API Key', this.apiKeyInput));

    this.baseUrlGroup = document.createElement('div');
    this.baseUrlGroup.style.cssText = 'display:none;flex-direction:column;gap:4px;';
    this.baseUrlInput = document.createElement('input');
    this.baseUrlInput.placeholder = 'https://api.example.com/v1';
    this.baseUrlInput.style.cssText = 'padding:4px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);width:100%;box-sizing:border-box;font-size:var(--font-size-sm);';
    this.baseUrlInput.addEventListener('input', () => {
      const val = this.baseUrlInput.value;
      if (val && !/^https?:\/\/.+/.test(val)) {
        this.baseUrlInput.style.setProperty('border-color', 'var(--color-error)'); // [BUG-FIX] B-009 - 硬编码色值改为 CSS 变量
      } else {
        this.baseUrlInput.style.borderColor = 'var(--color-border)';
      }
      this.store.update({ baseUrl: val });
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    const baseUrlLabel = document.createElement('label');
    baseUrlLabel.textContent = 'Base URL';
    baseUrlLabel.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);';
    this.baseUrlGroup.appendChild(baseUrlLabel);
    this.baseUrlGroup.appendChild(this.baseUrlInput);
    this.apiSection.appendChild(this.baseUrlGroup);

    this.modelNameInput = document.createElement('input');
    this.modelNameInput.placeholder = 'gpt-4o-mini';
    this.modelNameInput.style.cssText = 'padding:4px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);width:100%;box-sizing:border-box;font-size:var(--font-size-sm);';
    this.modelNameInput.addEventListener('input', () => this.store.update({ modelName: this.modelNameInput.value }), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.apiSection.appendChild(this.createField('模型名', this.modelNameInput));

    const verifyRow = document.createElement('div');
    verifyRow.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);';
    this.verifyBtn = document.createElement('button');
    this.verifyBtn.textContent = '验证连接';
    this.verifyBtn.style.cssText = 'padding:4px 10px;font-family:var(--font-sans);font-size:var(--font-size-sm);border:1px solid var(--color-primary);border-radius:var(--radius-sm);background:var(--color-primary);color:#FFCC00;cursor:pointer;';
    this.verifyBtn.addEventListener('click', () => this.verifyConnection(), { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    this.verifyResult = document.createElement('span');
    this.verifyResult.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);';
    verifyRow.appendChild(this.verifyBtn);
    verifyRow.appendChild(this.verifyResult);
    this.apiSection.appendChild(verifyRow);
  }

  private buildWebConfig(): void {
    this.webModelSelect = document.createElement('select');
    this.webModelSelect.style.cssText = 'padding:4px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:var(--font-size-sm);';
    for (const id of MODEL_IDS) {
      const el = document.createElement('option');
      el.value = id;
      el.textContent = MODEL_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1);
      this.webModelSelect.appendChild(el);
    }
    this.webModelSelect.addEventListener('change', () => {
      const val = this.webModelSelect.value;
      if (isModelType(val)) this.store.update({ webModelId: val });
    }, { signal: this.ac.signal }); // [BUG-FIX] B-006 - AbortController signal
    const webRow = document.createElement('div');
    webRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const webLbl = document.createElement('span');
    webLbl.textContent = '汇总模型';
    webLbl.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);white-space:nowrap;';
    webRow.appendChild(webLbl);
    webRow.appendChild(this.webModelSelect);
    this.webSection.appendChild(webRow);
  }

  private buildBehaviorConfig(): void {
    const section = document.createElement('div');
    section.style.cssText = 'display:flex;align-items:center;gap:8px;border-top:1px solid var(--color-border);padding-top:var(--space-sm);margin-top:var(--space-sm);';
    const label = document.createElement('span');
    label.textContent = '模型标签激活窗口';
    label.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);white-space:nowrap;';
    const yesBtn = document.createElement('button');
    yesBtn.textContent = '是';
    yesBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);cursor:pointer;';
    const noBtn = document.createElement('button');
    noBtn.textContent = '否';
    noBtn.style.cssText = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);cursor:pointer;';
    const updateBtns = (val: boolean) => {
      yesBtn.style.background = val ? 'var(--color-primary)' : 'var(--color-surface)';
      yesBtn.style.color = val ? '#FFCC00' : 'var(--color-text-secondary)';
      noBtn.style.background = val ? 'var(--color-surface)' : 'var(--color-primary)';
      noBtn.style.color = val ? 'var(--color-text-secondary)' : '#FFCC00';
    };
    yesBtn.addEventListener('click', () => { this.store.update({ bringModelToFront: true }); updateBtns(true); }, { signal: this.ac.signal });
    noBtn.addEventListener('click', () => { this.store.update({ bringModelToFront: false }); updateBtns(false); }, { signal: this.ac.signal });
    this.store.get().then((s) => updateBtns(s.bringModelToFront !== false)).catch(() => {});
    section.appendChild(label);
    section.appendChild(yesBtn);
    section.appendChild(noBtn);
    this.root.appendChild(section);
  }

  private buildTimingConfig(): void {
    this.timingSection = document.createElement('div');
    this.timingSection.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-xs);border-top:1px solid var(--color-border);padding-top:var(--space-sm);margin-top:var(--space-sm);';

    const header = document.createElement('span');
    header.textContent = '时序参数';
    header.style.cssText = 'font-weight:600;font-size:var(--font-size-sm);';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const hint = document.createElement('span');
    hint.textContent = '调整并发数量和等待时间';
    hint.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);';
    headerRow.appendChild(header);
    headerRow.appendChild(hint);
    this.timingSection.appendChild(headerRow);

    const cfg = [
      { key: 'concurrency', label: '并发数', w: '50px' },
      { key: 'concurrencyInterval', label: '并发间隔', w: '70px' },
      { key: 'inputInterval', label: '输入间隔', w: '70px' },
      { key: 'sendInterval', label: '发送间隔', w: '70px' },
    ] as const;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    for (const c of cfg) {
      const lbl = document.createElement('span');
      lbl.textContent = c.label;
      lbl.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);white-space:nowrap;';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.style.cssText = `padding:2px 4px;border:1px solid var(--color-border);border-radius:var(--radius-sm);width:${c.w};font-size:var(--font-size-sm);`;
      inp.addEventListener('input', async () => {
        const val = parseInt(inp.value, 10);
        if (isNaN(val)) { inp.style.setProperty('border-color', 'var(--color-error)'); return; }
        inp.style.borderColor = 'var(--color-border)';
        const current = await getTimingConfig();
        await setTimingConfig({ ...current, [c.key]: val });
      }, { signal: this.ac.signal });
      (this as any)[`${c.key}Input`] = inp;
      row.appendChild(lbl);
      row.appendChild(inp);
    }
    this.timingSection.appendChild(row);

    this.root.appendChild(this.timingSection);

    const foot = document.createElement('div');
    foot.style.cssText = 'padding:8px;font-size:var(--font-size-sm);color:var(--color-text-secondary);border-top:1px solid var(--color-border);margin-top:8px;line-height:1.6;';
    const ftTitle = document.createElement('b');
    ftTitle.textContent = '使用说明';
    foot.appendChild(ftTitle);
    for (const note of ['1. 尽量只提一轮（1个问题+1个回答）再汇总，太多容易崩', '2. 文件上传功能不要用，没做好', '3. 历史功能也没做好']) {
      foot.appendChild(document.createElement('br'));
      foot.appendChild(document.createTextNode(note));
    }
    this.root.appendChild(foot);
  }

  private applyTiming(c: TimingConfig): void {
    this.concurrencyInput.value = String(c.concurrency);
    this.concurrencyIntervalInput.value = String(c.concurrencyInterval);
    this.inputIntervalInput.value = String(c.inputInterval);
    this.sendIntervalInput.value = String(c.sendInterval);
  }

  private onModeChange(mode: 'api' | 'web'): void {
    this.apiSection.style.display = mode === 'api' ? 'flex' : 'none';
    this.webSection.style.display = mode === 'web' ? 'flex' : 'none';
    this.store.update({ mode });
  }

  private async verifyConnection(): Promise<void> {
    this.verifyBtn.disabled = true;
    this.verifyResult.textContent = '验证中...';
    this.verifyResult.style.color = 'var(--color-text-secondary)';
    try {
      const settings = await this.store.get();
      const result = await chrome.runtime.sendMessage({
        channel: 'summary:verify',
        payload: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          modelName: settings.modelName,
        },
      });
      if (result?.success) {
        this.verifyResult.textContent = '连接成功';
        this.verifyResult.style.setProperty('color', 'var(--color-success)');
      } else {
        this.verifyResult.textContent = (typeof result?.error === 'string' ? result.error : result?.error?.message) || '连接失败';
        this.verifyResult.style.setProperty('color', 'var(--color-error)');
      }
    } catch (err) {
      this.verifyResult.textContent = '连接失败: ' + (err instanceof Error ? err.message : String(err));
      this.verifyResult.style.setProperty('color', 'var(--color-error)'); // [BUG-FIX] B-009 - 硬编码色值改为 CSS 变量
    } finally {
      this.verifyBtn.disabled = false;
    }
  }

  private applySettings(s: SummarySettings): void {
    this.apiSection.style.display = s.mode === 'api' ? 'flex' : 'none';
    this.webSection.style.display = s.mode === 'web' ? 'flex' : 'none';
    if (s.provider) this.providerSelect.value = s.provider;
    if (s.apiKey !== undefined) this.apiKeyInput.value = s.apiKey;
    if (s.baseUrl !== undefined) this.baseUrlInput.value = s.baseUrl;
    if (s.modelName !== undefined) this.modelNameInput.value = s.modelName;
    const isCustom = s.provider === 'custom';
    this.baseUrlGroup.style.display = isCustom ? 'flex' : 'none';
    if (s.webModelId && MODEL_IDS.includes(s.webModelId)) {
      this.webModelSelect.value = s.webModelId;
    }
  }

  destroy(): void {
    this.ac?.abort();
    this.onStoreChange?.();
  }
}
