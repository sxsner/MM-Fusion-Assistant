import { getModelScores } from './promptView';
import type { ModelScoreEntry } from '../shared/types';

const MODEL_IDS = ['deepseek', 'doubao', 'qwne', 'glm', 'claude', 'chatgpt', 'grok', 'gemini', 'kimi', 'minimax', 'mimo', 'stepfun', 'hunyuan', 'longcat'];
const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT', claude: 'Claud', gemini: 'Gmini', deepseek: 'DSeek', grok: 'Grok',
  doubao: 'Seed', glm: 'GLM', qwne: 'Qwne', hunyuan: 'Hy',
  kimi: 'Kimi', minimax: 'Nimax', longcat: 'LCat', stepfun: 'Step', mimo: 'MiMo',
};

const LOG_KEY = 'modelScoreLog';

interface ScoreLogEntry {
  id: string;
  timestamp: number;
  modelId: string;
  score: number;
  note?: string;
  source?: string;
}

type SortKey = 'model' | 'total' | 'avg' | 'count';

async function getScoreLog(): Promise<ScoreLogEntry[]> {
  try {
    const data = await chrome.storage.local.get(LOG_KEY);
    return (data[LOG_KEY] as ScoreLogEntry[]) || [];
  } catch { return []; }
}

async function saveScoreLog(log: ScoreLogEntry[]): Promise<void> {
  await chrome.storage.local.set({ [LOG_KEY]: log });
}

async function rebuildScores(): Promise<void> {
  const log = await getScoreLog();
  const agg: Record<string, ModelScoreEntry> = {};
  for (const entry of log) {
    if (!agg[entry.modelId]) agg[entry.modelId] = { totalScore: 0, count: 0 };
    agg[entry.modelId].totalScore += entry.score;
    agg[entry.modelId].count += 1;
  }
  await chrome.storage.local.set({ modelScores: agg });
}

const COLUMNS: Array<{ label: string; key: SortKey }> = [
  { label: '模型', key: 'model' },
  { label: '总分', key: 'total' },
  { label: '均分', key: 'avg' },
  { label: '次数', key: 'count' },
];

export class ScoreView {
  private root: HTMLDivElement;
  private table: HTMLTableElement;
  private tbody: HTMLTableSectionElement;
  private headers: HTMLTableCellElement[] = [];
  private sortKey: SortKey = 'model';
  private sortAsc = false;
  private logPanel: HTMLDivElement;
  private logList: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:var(--space-sm);flex:1;overflow:hidden;';

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const title = document.createElement('div');
    title.textContent = '模型评分';
    title.style.cssText = 'font-weight:600;font-size:var(--font-size-sm);color:var(--color-text);flex:1;';

    const btnStyle = 'padding:2px 8px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:transparent;color:var(--color-text-secondary);cursor:pointer;white-space:nowrap;';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置';
    resetBtn.style.cssText = btnStyle.replace('var(--color-border)', 'var(--color-error)').replace('var(--color-text-secondary)', 'var(--color-error)');
    resetBtn.addEventListener('click', async () => {
      if (!confirm('确定清空所有模型评分？此操作不可恢复。')) return;
      await chrome.storage.local.remove(['modelScores', 'modelScoreLog']);
      this.render();
      this.renderLog();
    });

    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:14px;background:var(--color-border);';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '导出';
    exportBtn.style.cssText = btnStyle;
    exportBtn.addEventListener('click', () => this.exportData());

    const importBtn = document.createElement('button');
    importBtn.textContent = '导入';
    importBtn.style.cssText = btnStyle;
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', () => this.importData(input));
      input.click();
    });

    titleRow.appendChild(title);
    titleRow.appendChild(resetBtn);
    titleRow.appendChild(sep);
    titleRow.appendChild(exportBtn);
    titleRow.appendChild(importBtn);

    this.table = document.createElement('table');
    this.table.style.cssText = 'table-layout:fixed;width:auto;border-collapse:collapse;font-size:var(--font-size-sm);';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const widths: Record<string, string> = { model: '70px', total: '50px', avg: '50px', count: '50px' };
    for (const col of COLUMNS) {
      const cell = document.createElement('th');
      cell.textContent = col.label;
      cell.dataset.key = col.key;
      cell.style.cssText = `padding:4px 10px;text-align:left;cursor:pointer;border-bottom:1px solid var(--color-border);user-select:none;white-space:nowrap;width:${widths[col.key]};`;
      cell.addEventListener('click', () => {
        if (this.sortKey === col.key) this.sortAsc = !this.sortAsc;
        else { this.sortKey = col.key; this.sortAsc = true; }
        this.render();
      });
      this.headers.push(cell);
      headerRow.appendChild(cell);
    }
    thead.appendChild(headerRow);
    this.table.appendChild(thead);

    this.tbody = document.createElement('tbody');
    this.table.appendChild(this.tbody);

    this.logPanel = document.createElement('div');
    this.logPanel.style.cssText = 'display:flex;flex-direction:column;gap:4px;overflow-y:auto;max-height:300px;';

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-shrink:0;';

    const modelSel = document.createElement('select');
    modelSel.style.cssText = 'flex:1;padding:2px 4px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);';
    for (const id of MODEL_IDS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = MODEL_LABELS[id] || id;
      modelSel.appendChild(opt);
    }

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.min = '0';
    scoreInput.max = '10';
    scoreInput.step = '0.5';
    scoreInput.placeholder = '分数';
    scoreInput.style.cssText = 'width:60px;padding:2px 4px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);';

    const noteInput = document.createElement('input');
    noteInput.placeholder = '备注（选填）';
    noteInput.style.cssText = 'width:80px;padding:2px 4px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:var(--radius-sm);';

    const addBtn = document.createElement('button');
    addBtn.textContent = '新增';
    addBtn.style.cssText = 'padding:2px 10px;font-size:var(--font-size-sm);border:none;border-radius:var(--radius-sm);background:var(--color-primary);color:#FFCC00;cursor:pointer;white-space:nowrap;';
    addBtn.addEventListener('click', async () => {
      const score = parseFloat(scoreInput.value);
      if (isNaN(score) || score < 0 || score > 10) { alert('请输入 0-10 的分数'); return; }
      const log = await getScoreLog();
      log.push({ id: crypto.randomUUID(), timestamp: Date.now(), modelId: modelSel.value, score, note: noteInput.value || undefined });
      await saveScoreLog(log);
      await rebuildScores();
      scoreInput.value = '';
      noteInput.value = '';
      this.render();
      this.renderLog();
    });

    addRow.appendChild(modelSel);
    addRow.appendChild(scoreInput);
    addRow.appendChild(noteInput);
    addRow.appendChild(addBtn);

    this.logList = document.createElement('div');
    this.logList.style.cssText = 'display:flex;flex-direction:column;gap:2px;overflow-y:auto;';

    this.logPanel.appendChild(addRow);
    this.logPanel.appendChild(this.logList);

    this.root.appendChild(titleRow);
    this.root.appendChild(this.table);
    this.root.appendChild(this.logPanel);
    container.appendChild(this.root);

    this.render();
    this.renderLog();
  }

  private async exportData(): Promise<void> {
    const [scores, log] = await Promise.all([getModelScores(), getScoreLog()]);
    const data = JSON.stringify({ modelScores: scores, modelScoreLog: log }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnicast-scores-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importData(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') { alert('无效的 JSON 格式'); return; }
      if (data.modelScoreLog && Array.isArray(data.modelScoreLog)) {
        await chrome.storage.local.set({ modelScoreLog: data.modelScoreLog });
      }
      if (data.modelScores && typeof data.modelScores === 'object') {
        await chrome.storage.local.set({ modelScores: data.modelScores });
      }
      alert('导入成功');
      this.render();
      this.renderLog();
    } catch (err) {
      alert('导入失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async render(): Promise<void> {
    const scores = await getModelScores();
    const rows = MODEL_IDS.map((id) => ({
      label: MODEL_LABELS[id] || id, entry: scores[id],
    }));

    rows.sort((a, b) => {
      if (this.sortKey === 'model') {
        return this.sortAsc ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label);
      }
      const getVal = (r: typeof rows[0]) => {
        if (!r.entry) return -Infinity;
        if (this.sortKey === 'total') return r.entry.totalScore;
        if (this.sortKey === 'avg') return r.entry.totalScore / r.entry.count;
        return r.entry.count;
      };
      return this.sortAsc ? getVal(a) - getVal(b) : getVal(b) - getVal(a);
    });

    for (const h of this.headers) {
      const key = h.dataset.key as SortKey;
      const col = COLUMNS.find((c) => c.key === key);
      const isActive = this.sortKey === key;
      const arrow = isActive ? (this.sortAsc ? ' ▲' : ' ▼') : ' △';
      h.innerHTML = (col?.label || '') + `<span style="color:${isActive ? 'var(--color-text)' : 'var(--color-text-secondary)'};font-size:10px;">${arrow}</span>`;
    }

    this.tbody.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      const avg = r.entry ? (r.entry.totalScore / r.entry.count).toFixed(1) : '-';
      const cells = [r.label, r.entry ? String(r.entry.totalScore) : '-', avg, r.entry ? String(r.entry.count) : '-'];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        td.style.cssText = 'padding:3px 10px;border-bottom:1px solid var(--color-border);white-space:nowrap;';
        tr.appendChild(td);
      }
      this.tbody.appendChild(tr);
    }
  }

  private async renderLog(): Promise<void> {
    const log = await getScoreLog();
    const manual = log.filter((e) => e.source === 'manual');
    this.logList.innerHTML = '';

    if (manual.length === 0) {
      this.logList.textContent = '暂无手动评分记录';
      this.logList.style.cssText = 'padding:8px;font-size:var(--font-size-sm);color:var(--color-text-secondary);text-align:center;';
      return;
    }
    this.logList.style.cssText = 'display:flex;flex-direction:column;gap:2px;overflow-y:auto;';

    const reversed = [...manual].reverse();
    for (const entry of reversed) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:var(--font-size-sm);border-bottom:1px solid var(--color-border);';

      const label = document.createElement('span');
      label.textContent = MODEL_LABELS[entry.modelId] || entry.modelId;
      label.style.cssText = 'width:50px;flex-shrink:0;font-weight:500;';

      const scoreEl = document.createElement('input');
      scoreEl.type = 'number';
      scoreEl.min = '0';
      scoreEl.max = '10';
      scoreEl.step = '0.5';
      scoreEl.value = String(entry.score);
      scoreEl.style.cssText = 'width:50px;padding:1px 2px;font-size:var(--font-size-sm);border:1px solid var(--color-border);border-radius:2px;';

      const dateEl = document.createElement('span');
      const d = new Date(entry.timestamp);
      dateEl.textContent = `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      dateEl.style.cssText = 'width:70px;flex-shrink:0;color:var(--color-text-secondary);font-size:11px;';

      const noteEl = document.createElement('span');
      noteEl.textContent = entry.note || '';
      noteEl.style.cssText = 'flex:1;color:var(--color-text-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '保存';
      saveBtn.style.cssText = 'padding:1px 6px;font-size:11px;border:1px solid var(--color-border);border-radius:2px;background:transparent;color:var(--color-text-secondary);cursor:pointer;';

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'padding:1px 4px;font-size:11px;border:none;background:none;color:var(--color-error);cursor:pointer;';

      saveBtn.addEventListener('click', async () => {
        const newScore = parseFloat(scoreEl.value);
        if (isNaN(newScore) || newScore < 0 || newScore > 10) { alert('请输入 0-10 的分数'); return; }
        const log = await getScoreLog();
        const found = log.find((e) => e.id === entry.id);
        if (found) { found.score = newScore; }
        await saveScoreLog(log);
        await rebuildScores();
        this.render();
        this.renderLog();
      });

      delBtn.addEventListener('click', async () => {
        let log = await getScoreLog();
        log = log.filter((e) => e.id !== entry.id);
        await saveScoreLog(log);
        await rebuildScores();
        this.render();
        this.renderLog();
      });

      row.appendChild(label);
      row.appendChild(scoreEl);
      row.appendChild(dateEl);
      row.appendChild(noteEl);
      row.appendChild(saveBtn);
      row.appendChild(delBtn);
      this.logList.appendChild(row);
    }
  }
}
