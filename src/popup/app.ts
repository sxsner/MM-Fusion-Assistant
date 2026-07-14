import { ComposerView } from './composerView';
import { SummaryView } from './summaryView';
import { SettingsView } from './settingsView';
import { Store, SummarySettingsStore } from '../shared/store';
import { HistoryView } from './historyView';
import { HistoryManager } from '../background/historyManager';
import { ResultsGridView } from './resultsGridView';
import { BackgroundTabsView } from './backgroundTabsView';
import { PromptView } from './promptView';
import { ScoreView } from './scoreView';
import type { ModelType, ModelResult } from '../shared/types';
import { isModelType, isModelResult } from '../shared/guards';
import { MODEL_IDS } from '../shared/constants';
import { addModelScore } from './promptView';
import { logger } from '../shared/logger';

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT', claude: 'Claud', gemini: 'Gmini', deepseek: 'DSeek', grok: 'Grok',
  doubao: 'Seed', glm: 'GLM', qwnc: 'QwnC', hunyuan: 'Hy',
  kimi: 'Kimi', minimax: 'Nimax', longcat: 'LCat', stepfun: 'Step', mimo: 'MiMo',
};

const TAB_DEFS = ['home', 'history', 'settings', 'backend', 'prompt', 'score'];
const TAB_LABELS: Record<string, string> = { home: '主页', history: '历史', settings: '设置', backend: '后台', prompt: '提示词', score: '评分' };

function createTabs(app: HTMLElement, tabButtons: Record<string, HTMLDivElement>, switchTab: (id: string) => void): void {
  const tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--color-border);flex-shrink:0;padding:0 4px;';
  for (const id of TAB_DEFS) {
    const btn = document.createElement('div');
    btn.textContent = TAB_LABELS[id];
    btn.style.cssText = [
      'padding:3px 10px', 'cursor:pointer', 'user-select:none',
      'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
      'border:1px solid transparent', 'border-bottom:none',
      'border-radius:var(--radius-sm) var(--radius-sm) 0 0',
      'color:var(--color-text-secondary)',
      'margin-bottom:-1px', 'position:relative', 'z-index:1',
    ].join(';');
    btn.dataset.tab = id;
    btn.addEventListener('click', () => switchTab(id));
    tabs.appendChild(btn);
    tabButtons[id] = btn;
  }
  app.appendChild(tabs);
}

function createPanels(app: HTMLElement): Record<string, HTMLDivElement> {
  const panels: Record<string, HTMLDivElement> = {};
  for (const id of TAB_DEFS) {
    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;flex:1;overflow-y:auto;padding:0 var(--space-sm);';
    panels[id] = panel;
    app.appendChild(panel);
  }
  return panels;
}

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (!app) return;
  app.style.cssText = 'display:flex;flex-direction:column;height:100vh;overflow:hidden;';

  const modelStore = new Store();
  const summarySettingsStore = new SummarySettingsStore();
  const historyManager = new HistoryManager();

  let currentConversationUrls: Partial<Record<string, string>> | undefined;
  let sessionConversationId: string = crypto.randomUUID();
  let currentResults: Partial<Record<ModelType, ModelResult>> = {};
  let lastTaskId: string | undefined;

  const SESSION_KEY = 'currentSession';

  async function saveSession(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [SESSION_KEY]: {
          conversationId: sessionConversationId,
          conversationUrls: currentConversationUrls,
          results: currentResults,
        }
      });
    } catch (err) { logger.warn('POPUP', crypto.randomUUID(), 'saveSession failed: ' + (err instanceof Error ? err.message : String(err))); }
  }

  async function restoreSession(): Promise<void> {
    try {
      const data = await chrome.storage.local.get(SESSION_KEY);
      const session = data[SESSION_KEY];
      if (session) {
        sessionConversationId = session.conversationId || sessionConversationId;
        currentConversationUrls = session.conversationUrls;
        currentResults = session.results || {};
        if (Object.keys(currentResults).length > 0) {
          for (const [modelId, result] of Object.entries(currentResults)) {
            if (isModelResult(result)) handleModelResult(modelId, result);
          }
        }
      }
    } catch (err) { logger.warn('POPUP', crypto.randomUUID(), 'restoreSession failed: ' + (err instanceof Error ? err.message : String(err))); }
  }

  const style = document.createElement('style');
  style.textContent = '@keyframes dot-blink { 0%,100% { opacity:1; } 50% { opacity:.3; } }';
  document.head.appendChild(style);

  const tabButtons: Record<string, HTMLDivElement> = {};
  createTabs(app, tabButtons, switchTab);
  const panels = createPanels(app);

  const historyView = new HistoryView(panels.history, historyManager);
  async function switchOrOpenModelTab(modelId: string): Promise<void> {
    chrome.runtime.sendMessage({ channel: 'tabs:switchOrOpen', trace_id: crypto.randomUUID(), payload: { modelId } }).catch(() => {});
  }

  async function checkModelSelected(modelId: string): Promise<boolean> {
    const models = await modelStore?.getSelectedModels();
    if (models && !models.includes(modelId as ModelType)) {
      alert('模型未选择，请在设置内选择模型后继续');
      return false;
    }
    return true;
  }

  historyView.onResumeConversation((entry) => {
    currentConversationUrls = entry.conversationUrls;
    sessionConversationId = entry.conversationId || entry.taskId;
    historyManager.setActiveConversationId(sessionConversationId);
    resultsGrid.clearContent();
    summaryView.clear();
    if (entry.results) {
      const modelResults: Array<{ modelId: string; content: string }> = [];
      for (const r of entry.results) {
        if (r.content && isModelType(r.modelId)) {
          checkModelSelected(r.modelId);
          resultsGrid.updateContent(r.modelId, r.content);
          setModelStatus(r.modelId, 'done');
          modelResults.push({ modelId: r.modelId, content: r.content });
        }
      }
      summaryView.setExportData(entry.question, modelResults);
      for (const r of entry.results) {
        if (r.content && isModelType(r.modelId)) switchOrOpenModelTab(r.modelId);
      }
    }
    switchTab('home');
  });
  historyView.onContinueModelSession(async (modelId) => {
    if (!(await checkModelSelected(modelId))) return;
    setModelStatus(modelId, 'done');
    switchOrOpenModelTab(modelId);
  });

  const settingsView = new SettingsView(panels.settings, summarySettingsStore, modelStore);

  const backgroundTabsView = new BackgroundTabsView(panels.backend);
  new PromptView(panels.prompt);
  const scoreView = new ScoreView(panels.score);

  const homePanel = panels.home;
  const modelTagsRow = document.createElement('div');
  modelTagsRow.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap;padding:0;flex-shrink:0;';
  modelTagsRow.addEventListener('click', (e) => {
    const tag = (e.target as HTMLElement).closest('[data-model-id]') as HTMLElement | null;
    const mid = tag?.dataset.modelId;
    if (!mid || !isModelType(mid)) return;
    activeModelTag = mid;
    resultsGrid.showOnly(mid);
    updateModelTags();
  });
  homePanel.insertBefore(modelTagsRow, homePanel.firstChild);

  const resultsGrid = new ResultsGridView(homePanel);

  const tagDots = new Map<string, HTMLSpanElement>();
  let selectedModels: ModelType[] = [];
  let activeModelTag: string | null = 'deepseek';
  const statusColors: Record<string, string> = { pending: '#9ca3af', generating: '#3b82f6', done: '#22c55e', error: '#ef4444' };

  function updateModelTags(): void {
    modelTagsRow.innerHTML = '';
    tagDots.clear();
    const allModels: ModelType[] = selectedModels.length > 0
      ? (MODEL_IDS as ModelType[]).filter((m) => selectedModels.includes(m))
      : MODEL_IDS as ModelType[];
    for (const m of allModels) {
      const isActive = m === activeModelTag;
      const tag = document.createElement('div');
      tag.dataset.modelId = m;
      tag.style.cssText = [
        'padding:0 4px',
        'font-family:var(--font-sans)', 'font-size:var(--font-size-sm)',
        'cursor:pointer', 'user-select:none',
        'border:1px solid var(--color-border)', 'border-radius:2px',
        isActive ? 'background:#EE1C25;color:#FFCC00;border-color:#EE1C25;' : 'background:var(--color-surface);color:var(--color-text-secondary);',
        'display:inline-flex', 'align-items:center', 'gap:2px',
      ].join(';');
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#9ca3af;flex-shrink:0;';
      tagDots.set(m, dot);
      const txt = document.createElement('span');
      txt.textContent = MODEL_LABELS[m] || m;
      tag.appendChild(dot);
      tag.appendChild(txt);
      modelTagsRow.appendChild(tag);
    }
  }

  function setModelStatus(modelId: string, status: string): void {
    const dot = tagDots.get(modelId);
    if (!dot) return;
    dot.style.background = statusColors[status] || '#9ca3af';
    dot.style.animation = status === 'pending' || status === 'generating' ? 'dot-blink 1s infinite' : 'none';
  }
  let unsubscribeModels: (() => void) | undefined;
  modelStore.getSelectedModels().then((models) => { selectedModels = models; updateModelTags(); resultsGrid.showOnly('deepseek'); }).catch((err) => {
    logger.error('POPUP', crypto.randomUUID(), 'Failed to load selected models: ' + (err instanceof Error ? err.message : String(err)));
  });
  unsubscribeModels = modelStore.onChange((models) => { selectedModels = models; updateModelTags(); backgroundTabsView.load(); });

  const composerView = new ComposerView(homePanel, modelStore, () => currentConversationUrls, () => sessionConversationId);
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  function startHistorySync(taskId: string): void {
    const deadline = Date.now() + 300000;
    if (syncTimer) { clearInterval(syncTimer); syncTimer = undefined; }
    syncTimer = setInterval(async () => {
      if (Date.now() > deadline || !syncTimer) { clearInterval(syncTimer); syncTimer = undefined; return; }
      try {
        await chrome.runtime.sendMessage({ channel: 'history:sync', payload: { taskId }, trace_id: crypto.randomUUID() });
      } catch {}
    }, 10000);
  }
  composerView.onSend((taskId) => {
    lastTaskId = taskId;
    scoredTasks.clear();
    resultsGrid.clearContent();
    currentResults = {};
    startHistorySync(taskId);
  });
  composerView.onClear(() => {
    resultsGrid.clearContent();
    summaryView.clear();
    currentResults = {};
    currentConversationUrls = undefined;
    activeModelTag = null;
    for (const m of MODEL_IDS as ModelType[]) setModelStatus(m, 'pending');
    updateModelTags();
    saveSession();
  });
  composerView.onSync(() => {
    const skipModels = Object.keys(currentResults).filter((m) => (currentResults as any)[m]?.content);
    chrome.runtime.sendMessage({ channel: 'popup:sync', payload: { skipModels }, trace_id: crypto.randomUUID() }).then((res: any) => {
      if (res?.data?.results) {
        currentResults = res.data.results;
        const dsLen = (currentResults as any)['deepseek']?.content?.length || 0;
        for (const [modelId, result] of Object.entries(currentResults)) {
          if (isModelResult(result)) {
            if (dsLen > 0 && result.content && result.content.length < dsLen * 0.4) {
              logger.warn('POPUP', crypto.randomUUID(), `${modelId}: 同步内容过短(${result.content.length}字 < ${Math.round(dsLen * 0.4)}字)，跳过`);
              continue;
            }
            handleModelResult(modelId, result);
          }
        }
      }
    }).catch((err) => { logger.warn('POPUP', crypto.randomUUID(), 'sync failed: ' + (err instanceof Error ? err.message : String(err))); });
  });
  const summaryView = new SummaryView(homePanel);

  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('image01.jpg');
  img.style.cssText = 'max-width:100%;height:auto;display:block;margin:8px auto 0;border-radius:var(--radius-md);mix-blend-mode:multiply;';
  img.loading = 'lazy';
  homePanel.appendChild(img);

  restoreSession();
  // Update summary source indicator from settings
  summarySettingsStore.get().then((s) => summaryView.setSource(s.mode === 'web' ? '网页端' : 'API')).catch((err) => { logger.warn('POPUP', crypto.randomUUID(), 'summarySettings load failed: ' + (err instanceof Error ? err.message : String(err))); });
  // Sync with any open model windows
  const skipModels = Object.keys(currentResults).filter((m) => (currentResults as any)[m]?.content);
  chrome.runtime.sendMessage({ channel: 'popup:sync', payload: { skipModels }, trace_id: crypto.randomUUID() }).then((res: any) => {
    if (res?.data?.results) {
      currentResults = res.data.results;
      const dsLen = (currentResults as any)['deepseek']?.content?.length || 0;
      for (const [modelId, result] of Object.entries(currentResults)) {
        if (isModelResult(result)) {
          if (dsLen > 0 && result.content && result.content.length < dsLen * 0.4) {
            logger.warn('POPUP', crypto.randomUUID(), `${modelId}: 同步内容过短(${result.content.length}字 < ${Math.round(dsLen * 0.4)}字)，跳过`);
            continue;
          }
          handleModelResult(modelId, result);
        }
      }
    }
  }).catch((err) => { logger.warn('POPUP', crypto.randomUUID(), 'init sync failed: ' + (err instanceof Error ? err.message : String(err))); });
  switchTab('home');

  function switchTab(id: string): void {
    const bg = 'var(--color-surface)';
    for (const tid of TAB_DEFS) {
      const btn = tabButtons[tid];
      const isActive = tid === id;
      panels[tid].style.display = isActive ? 'flex' : 'none';
      panels[tid].style.flexDirection = 'column';
      btn.style.borderColor = isActive ? 'var(--color-border)' : 'transparent';
      btn.style.borderBottomColor = isActive ? bg : 'transparent';
      btn.style.background = isActive ? bg : 'transparent';
      btn.style.color = isActive ? 'var(--color-text)' : 'var(--color-text-secondary)';
    }
    if (id === 'history') historyView.load();
    if (id === 'backend') backgroundTabsView.load();
  }

  let summaryBusy = false;
  summaryView.onTriggerSummary(async () => {
    if (summaryBusy) return;
    summaryBusy = true;
    const settings = await summarySettingsStore.get();
    summaryView.setSource(settings.mode === 'web' ? '网页端' : 'API');
    summaryView.showLoading();
    try {
      const res = await chrome.runtime.sendMessage({
        channel: 'summary:generate',
        payload: { mode: settings.mode, settings, taskId: lastTaskId },
      });
      if (res?.success) {
        summaryView.showContent(res.data?.content || '');
      } else {
        summaryView.showError(res?.error?.message || res?.error || '汇总失败');
      }
    } catch (err) {
      summaryView.showError(err instanceof Error ? err.message : String(err));
    } finally {
      summaryBusy = false;
    }
  });

  let scoreBusy = false;
  const scoredTasks = new Set<string>();
  summaryView.onScoreSummary(async () => {
    if (scoreBusy) return;
    if (lastTaskId && scoredTasks.has(lastTaskId)) { alert('本轮对话已评分，不可重复评分'); return; }
    scoreBusy = true;
    summaryView.setScoreLoading(true);
    try {
      const settings = await summarySettingsStore.get();
      const res = await chrome.runtime.sendMessage({
        channel: 'summary:score',
        payload: { mode: settings.mode, settings },
      });
      if (!res?.success) {
        alert(res?.error?.message || res?.error || '评分失败');
        return;
      }
      const raw = res.data?.content || '';
      let parsed: Record<string, { score: number }>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        alert('评分返回格式错误，无法解析 JSON');
        return;
      }
      for (const [modelId, data] of Object.entries(parsed)) {
        if (data && typeof data.score === 'number') {
          await addModelScore(modelId, data.score);
        }
      }
      alert('评分已记录');
      if (lastTaskId) scoredTasks.add(lastTaskId);
      scoreView.render();
    } catch (err) {
      alert('评分失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      summaryView.setScoreLoading(false);
      scoreBusy = false;
    }
  });

  function handleModelResult(modelId: string, result: ModelResult): void {
    if (!isModelType(modelId)) return;
    if (result.content) resultsGrid.updateContent(modelId, result.content);
    if (result.error) {
      setModelStatus(modelId, 'error');
      resultsGrid.updateContent(modelId, result.error);
    } else if (result.status === 'completed') {
      setModelStatus(modelId, 'done');
    } else if (result.status === 'generating') {
      setModelStatus(modelId, 'generating');
    } else {
      setModelStatus(modelId, 'pending');
    }
  }

  const onModelUpdate = (msg: { channel: string; payload?: { taskId: string; results: Partial<Record<ModelType, ModelResult>>; conversationUrls?: Partial<Record<string, string>> } }) => {
    if ((msg.channel === 'model:update' || msg.channel === 'task:complete') && msg.payload?.results) {
      currentResults = msg.payload.results;
      for (const [modelId, result] of Object.entries(currentResults)) {
        if (isModelResult(result)) handleModelResult(modelId, result);
      }
      if (msg.payload.conversationUrls) {
        currentConversationUrls = { ...currentConversationUrls, ...msg.payload.conversationUrls };
      }
      summaryView.setExportData('', Object.entries(currentResults).map(([mid, r]) => ({ modelId: mid, content: r?.content || '' })));
      saveSession();
      // Refresh history when task completes
      if (msg.channel === 'task:complete') { historyView.load(); if (syncTimer) { clearInterval(syncTimer); syncTimer = undefined; } }
    }
  };
  chrome.runtime.onMessage.addListener(onModelUpdate);
  window.addEventListener('beforeunload', () => {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = undefined; }
    unsubscribeModels?.();
    chrome.runtime.onMessage.removeListener(onModelUpdate);
    settingsView.destroy();
    backgroundTabsView.destroy();
    composerView.destroy();
    resultsGrid.destroy();
    summaryView.destroy();
    historyView.destroy();
  });
});
