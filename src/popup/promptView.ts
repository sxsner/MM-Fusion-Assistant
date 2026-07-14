import { logger } from '../shared/logger';
import type { ModelScoreEntry } from '../shared/types';

const PREFIX_KEY = 'promptPrefix';
const SUMMARY_KEY = 'summaryPrompt';
const SCORE_KEY = 'scorePrompt';
const SCORE_DATA_KEY = 'modelScores';

const DEFAULT_PREFIX = '在保证正确性的前提下，回答尽量简洁直接，省略开场白和多余铺垫；优先用自然段落表达，少用列表和多级标题，除非涉及需要顺序执行的步骤或大量对比信息；遇到模糊需求时，先做合理假设直接给出可用方案，不反复确认细节；技术类任务给完整、可直接使用的代码或方案，不做过度注释和废话式解释，如有多种技术选型可简短提一句权衡取舍，但不展开成对比表。用连贯的自然段落描述流程，不要用竖排列表或箭头链式结构（如 A→B→C 逐行排列），把步骤自然地嵌入一段完整的话里。禁止生成独立文件参与回答。\n\n';
const DEFAULT_SUMMARY = '请综合以下所有模型回答，给出一个全面、准确的总结。指出各模型回答的一致点和分歧点。';
const DEFAULT_SCORE = '请对以下各模型回答逐项评分（满分10分），如果模型的回答完全和问题无任何关联或者是问题本身，则不进行评分。';

const SCORE_JSON_SUFFIX = '\n\n按以下JSON格式返回，不要包含其他内容：{"模型ID": {"score": 分数, "reason": "评分理由"}}';

async function getStorage(key: string, def: string): Promise<string> {
  try {
    const data = await chrome.storage.local.get(key);
    const val = data[key];
    return typeof val === 'string' && val ? val : def;
  } catch (err) {
    logger.warn('PROMPT', crypto.randomUUID(), `getStorage(${key}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return def;
  }
}

async function setStorage(key: string, value: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    logger.warn('PROMPT', crypto.randomUUID(), `setStorage(${key}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getPromptPrefix(): Promise<string> { return getStorage(PREFIX_KEY, DEFAULT_PREFIX); }
export async function setPromptPrefix(value: string): Promise<void> { return setStorage(PREFIX_KEY, value); }
export async function getSummaryPrompt(): Promise<string> { return getStorage(SUMMARY_KEY, DEFAULT_SUMMARY); }
export async function setSummaryPrompt(value: string): Promise<void> { return setStorage(SUMMARY_KEY, value); }
export async function getScorePrompt(): Promise<string> { return (await getStorage(SCORE_KEY, DEFAULT_SCORE)) + SCORE_JSON_SUFFIX; }
export async function setScorePrompt(value: string): Promise<void> { return setStorage(SCORE_KEY, value); }
// getRawScorePrompt returns the editable part only (without the JSON suffix)
export async function getRawScorePrompt(): Promise<string> { return getStorage(SCORE_KEY, DEFAULT_SCORE); }

export async function getModelScores(): Promise<Record<string, ModelScoreEntry>> {
  try {
    const data = await chrome.storage.local.get(SCORE_DATA_KEY);
    return (data[SCORE_DATA_KEY] as Record<string, ModelScoreEntry>) || {};
  } catch { return {}; }
}

const LOG_KEY = 'modelScoreLog';

export async function addModelScore(modelId: string, score: number, source: 'auto' | 'manual' = 'auto'): Promise<void> {
  const data = await chrome.storage.local.get([SCORE_DATA_KEY, LOG_KEY]);
  const scores: Record<string, ModelScoreEntry> = data[SCORE_DATA_KEY] || {};
  const entry = scores[modelId] || { totalScore: 0, count: 0 };
  entry.totalScore += score;
  entry.count += 1;
  scores[modelId] = entry;
  const log: Array<{ id: string; timestamp: number; modelId: string; score: number; source: string }> = data[LOG_KEY] || [];
  log.push({ id: crypto.randomUUID(), timestamp: Date.now(), modelId, score, source });
  await chrome.storage.local.set({ [SCORE_DATA_KEY]: scores, [LOG_KEY]: log });
}

function buildSection(label: string, rows: number, load: () => Promise<string>, save: () => Promise<void>, reset: () => string): { root: HTMLDivElement; textarea: HTMLTextAreaElement; load: () => Promise<void> } {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight:500;font-size:var(--font-size-sm);color:var(--color-text);';

  const ta = document.createElement('textarea');
  ta.style.cssText = [
    `flex:1;min-height:${rows * 18}px;padding:6px 8px;resize:vertical;`,
    'font-family:var(--font-sans);font-size:var(--font-size-sm);line-height:1.5;',
    'border:1px solid var(--color-border);border-radius:var(--radius-md);outline:none;box-sizing:border-box;',
  ].join(';');

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;align-items:center;';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'padding:2px 10px;font-size:var(--font-size-sm);border:none;border-radius:var(--radius-sm);background:var(--color-primary);color:#FFCC00;cursor:pointer;';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = '恢复默认';
  resetBtn.style.cssText = 'padding:2px 10px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text-secondary);cursor:pointer;';

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-left:auto;';

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(resetBtn);
  btnRow.appendChild(statusEl);

  root.appendChild(labelEl);
  root.appendChild(ta);
  root.appendChild(btnRow);

  async function doLoad(): Promise<void> { ta.value = await load(); }

  saveBtn.addEventListener('click', async () => {
    try {
      ta.value = ta.value || '';
      await save();
      statusEl.textContent = '已保存';
      statusEl.style.color = 'var(--color-status-done)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
      statusEl.textContent = '保存失败';
      statusEl.style.color = 'var(--color-status-error)';
      logger.error('PROMPT', crypto.randomUUID(), 'save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  resetBtn.addEventListener('click', async () => { ta.value = reset(); saveBtn.click(); });

  return { root, textarea: ta, load: doLoad };
}

export class PromptView {
  private root: HTMLDivElement;
  private ac: AbortController;
  private sections: Array<{ load: () => Promise<void> }>;

  constructor(container: HTMLElement) {
    this.ac = new AbortController();
    this.sections = [];

    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:var(--space-sm);flex:1;overflow-y:auto;';

    const prefix = buildSection('模型提示词前缀（发送给模型前自动添加）', 12, getPromptPrefix, () => setPromptPrefix(prefix.textarea.value), () => DEFAULT_PREFIX);
    this.sections.push(prefix);
    this.root.appendChild(prefix.root);

    const divider1 = document.createElement('hr');
    divider1.style.cssText = 'border:none;border-top:1px solid var(--color-border);margin:2px 0;';
    this.root.appendChild(divider1);

    const s1 = buildSection('汇总提示词（生成多模型汇总时的指令）', 4, getSummaryPrompt, () => setSummaryPrompt(s1.textarea.value), () => DEFAULT_SUMMARY);
    this.sections.push(s1);
    this.root.appendChild(s1.root);

    const divider2 = document.createElement('hr');
    divider2.style.cssText = 'border:none;border-top:1px solid var(--color-border);margin:2px 0;';
    this.root.appendChild(divider2);

    const s2 = buildSection('评分提示词（JSON格式自动附加，无需手动填写）', 4, getRawScorePrompt, () => setScorePrompt(s2.textarea.value), () => DEFAULT_SCORE);
    this.sections.push(s2);
    this.root.appendChild(s2.root);

    container.appendChild(this.root);

    for (const s of this.sections) s.load();
  }

  destroy(): void {
    this.ac?.abort();
  }
}
