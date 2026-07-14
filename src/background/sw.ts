import { logger } from '../shared/logger';
import { on, start } from './messageRouter';
import { success, failure } from '../shared/errors';
import { Throttler } from './throttler';
import { ConcurrentQueue } from '../infrastructure/queue';
import { WindowManager } from './windowManager';
import { FrameRegistry } from './frameRegistry';
import { PromptDispatcher, signalTabReady } from './promptDispatcher';
import { ResponseAggregator } from './responseAggregator';
import { HistoryManager } from './historyManager';
import { SummaryWebAdapter } from './summaryWebAdapter';
import { ExternalModelClient } from './externalModelClient';
import { getSummaryPrompt, getScorePrompt } from '../popup/promptView';
import { getTimingConfig } from '../shared/store';
import type { ModelType, Attachment, Task, SummarySettings } from '../shared/types';

const MODULE = 'SW';
const traceId = crypto.randomUUID();

const tabRegistry = new Map<number, string>();
const throttler = new Throttler();
const queue = new ConcurrentQueue();
getTimingConfig().then((c) => { queue.setConcurrency(c.concurrency); }).catch(() => {});
const frameRegistry = new FrameRegistry();
const windowManager = new WindowManager(frameRegistry);
const promptDispatcher = new PromptDispatcher(queue, windowManager);
const responseAggregator = new ResponseAggregator();
const historyManager = new HistoryManager();
/** 跨 frame 互斥锁：仅第一个认领的 content script 处理 SEND_PROMPT */
const claimedSends = new Set<string>();

logger.info(MODULE, traceId, `应用启动成功，版本=1.0.0`);

chrome.runtime.onInstalled.addListener(() => {
  logger.info(MODULE, traceId, '扩展已安装/更新');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  windowManager.onTabClosed(tabId);
  tabRegistry.delete(tabId);
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => logger.warn('SW', traceId, 'sendMessage failed: ' + e));

on('content:ready', async (payload, sender, tid) => {
  const { hostname } = payload as { hostname: string };
  const tabId = sender.tab?.id;

  if (tabId !== undefined) {
    tabRegistry.set(tabId, hostname);
    signalTabReady(tabId);
    logger.debug(MODULE, tid, `Tab 已注册: tabId=${tabId} hostname=${hostname}`);
    return success({ registered: true }, tid);
  }

  return { success: false, data: null, error: { code: 'NO_TAB', message: '无法获取 tabId' }, trace_id: tid };
});

on('log:relay', async (payload, _sender, tid) => {
  const { level, msg } = payload as { level: string; msg: string };
  if (level === 'ERROR') logger.error('CS>SW', tid, msg);
  else if (level === 'WARN') logger.warn('CS>SW', tid, msg);
  else if (level === 'DEBUG') logger.debug('CS>SW', tid, msg);
  else logger.info('CS>SW', tid, msg);
  return success({ received: true }, tid);
});

on('claim:send', async (payload, sender, tid) => {
  const { taskId } = payload as { taskId: string };
  const tabId = sender.tab?.id;
  const claimKey = tabId ? `${taskId}_${tabId}` : taskId;
  if (claimedSends.has(claimKey)) {
    return success({ claimed: false }, tid);
  }
  claimedSends.add(claimKey);
  return success({ claimed: true }, tid);
});

on('grok:fill', async (payload, sender, tid) => {
  const { text } = payload as { text: string };
  const tabId = sender.tab?.id;
  if (!tabId) return success({ success: false, error: 'no tab' }, tid);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [text],
      func: (txt: string) => {
        const el = document.querySelector<HTMLElement>('[data-testid="chat-input"] [contenteditable="true"]');
        if (!el) return;
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
    });
    return success({ success: true }, tid);
  } catch (err) {
    return success({ success: false, error: String(err) }, tid);
  }
});

on('claude:fill', async (payload, sender, tid) => {
  const { text } = payload as { text: string };
  const tabId = sender.tab?.id;
  if (!tabId) return success({ success: false, error: 'no tab' }, tid);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [text],
      func: async (txt: string) => {
        const el = document.querySelector<HTMLElement>('[data-testid="chat-input"]');
        if (!el) return;
        el.focus();
        await new Promise(r => setTimeout(r, 50));
        // Paste event - ProseMirror handles this natively
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        el.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true,
        }));
      },
    });
    return success({ success: true }, tid);
  } catch (err) {
    return success({ success: false, error: String(err) }, tid);
  }
});

on('task:submit', async (payload, _sender, tid) => {
  const { text, targetModels, attachments, conversationUrls, conversationId } = payload as { text: string; targetModels: string[]; attachments?: unknown[]; conversationUrls?: Partial<Record<string, string>>; conversationId?: string };
  logger.info('SW', tid, '收到 task:submit conversationId=' + (conversationId ?? ''));
  if (!targetModels || targetModels.length === 0) {
    return failure('NO_TARGET', '未选择目标模型', tid);
  }
  chrome.storage.local.remove('scoredSummaries').catch(() => {});
  const taskId = crypto.randomUUID();
  taskQuestions.set(taskId, text);
  const task: Task = {
    id: taskId, question: text,
    attachments: (attachments ?? []) as Attachment[],
    targetModels: targetModels as ModelType[],
    status: 'distributing',
    createdAt: Date.now(), updatedAt: Date.now(),
    timeoutMs: 300000, results: {},
    conversationId: conversationId || taskId,
  };
  for (const m of targetModels) {
    responseAggregator.registerModel(taskId, m as ModelType);
  }
  responseAggregator.onAllCompleted(taskId, async () => {
    const results = responseAggregator.getAllResults(taskId);
    const deepseekLen = results['deepseek']?.content?.length || 0;
    if (deepseekLen > 0) {
      const minLen = deepseekLen * 0.4;
      for (const [mid, r] of Object.entries(results)) {
        if (r && r.content && r.content.length < minLen) {
          logger.warn('SW', tid, `${mid}: 内容过短(${r.content.length}字 < ${minLen.toFixed(0)}字)，标为无效`);
          r.content = '';
          r.status = 'failed';
        }
      }
    }
    task.results = results;
    task.status = 'completed';
    task.updatedAt = Date.now();
    const urlMap = convUrlStore.get(taskId) || {};
    task.conversationUrls = urlMap;
    task.pageTitle = convUrlStore.get(taskId)?._pageTitle;
    await historyManager.save(task).catch((err) => logger.error('SW', tid, 'save history error: ' + err));

    // 保存汇总数据到 storage（供汇总功能使用）
    const summaryData: Record<string, { modelId: string; content: string; status: string }> = {};
    for (const [modelId, result] of Object.entries(results)) {
      if (result?.content) {
        summaryData[modelId] = {
          modelId,
          content: result.content,
          status: result.status || 'completed',
        };
      }
    }
    await chrome.storage.local.set({
      [`summary:${taskId}`]: {
        question: text,
        results: summaryData,
        createdAt: Date.now(),
      }
    }).catch((err) => logger.error('SW', tid, 'save summary data error: ' + err));

    chrome.runtime.sendMessage({ channel: 'task:complete', trace_id: tid, payload: { taskId, results } }).catch((e) => logger.warn('SW', tid, 'sendMessage failed: ' + e));
    responseAggregator.removeTask?.(taskId);
    convUrlStore.delete(taskId);
    taskQuestions.delete(taskId);
    for (const key of claimedSends) { if (key.startsWith(taskId + '_') || key === taskId) claimedSends.delete(key); }
  });
  promptDispatcher.dispatch(taskId, text, (attachments ?? []) as Attachment[], targetModels as ModelType[], conversationUrls ?? undefined)
    .then((results) => {
      logger.info('SW', tid, '分发完成: ' + JSON.stringify(results.map(r => ({ m: r.modelId, ok: r.success, err: r.error }))));
      const resultMap: Partial<Record<ModelType, { modelId: ModelType; status: string; error?: string }>> = {};
      for (const r of results) {
        if (!r.success) {
          resultMap[r.modelId] = { modelId: r.modelId, status: 'error', error: r.error };
          responseAggregator.markFailed(taskId, r.modelId, r.error || '分发失败');
        }
      }
      if (Object.keys(resultMap).length > 0) {
        chrome.runtime.sendMessage({ channel: 'model:update', trace_id: tid, payload: { taskId, results: resultMap } }).catch((e) => logger.warn('SW', tid, 'sendMessage failed: ' + e));
      }
    })
    .catch((err) => {
      logger.error('SW', tid, 'dispatch error: ' + err);
      chrome.runtime.sendMessage({ channel: 'model:update', trace_id: tid, payload: { taskId, results: { [targetModels[0]]: { modelId: targetModels[0], status: 'error', error: String(err) } } } }).catch((e) => logger.warn('SW', tid, 'sendMessage failed: ' + e));
      for (const key of claimedSends) { if (key.startsWith(taskId + '_') || key === taskId) claimedSends.delete(key); }
    });
  return success({ taskId }, tid);
});

on('history:sync', async (payload, _sender, tid) => {
  const { taskId } = payload as { taskId: string };
  if (!taskId) return failure('NO_TASK', '缺少 taskId', tid);
  const results = responseAggregator.getAllResults(taskId);
  if (Object.keys(results).length === 0) return success({ saved: false, reason: '暂无结果' }, tid);
  const q = taskQuestions.get(taskId) || '';
  const task: Task = {
    id: taskId, question: q,
    attachments: [], targetModels: Object.keys(results) as ModelType[],
    status: 'collecting', createdAt: Date.now(), updatedAt: Date.now(),
    timeoutMs: 300000, results,
    conversationId: taskId,
  };
  await historyManager.save(task).catch(() => {});
  logger.info('SW', tid, `历史同步: ${Object.keys(results).length} 个模型`);
  return success({ saved: true }, tid);
});

interface ConvUrlData {
  _pageTitle?: string;
  [modelId: string]: string | undefined;
}
const convUrlStore = new Map<string, ConvUrlData>();
const taskQuestions = new Map<string, string>();

on('model:result', async (payload, _sender, tid) => {
  const { taskId, modelId, content, error, conversationUrl, pageTitle } = payload as { taskId: string; modelId: string; content?: string; error?: string; conversationUrl?: string; pageTitle?: string };
  const resolvedModelId = modelId as ModelType;
  logger.info('SW', tid, `model:result: model=${modelId} hasUrl=${!!conversationUrl} url=${conversationUrl || '(none)'} final=${(payload as { final?: boolean }).final}`);
  if (conversationUrl) {
    const urls = convUrlStore.get(taskId) || {};
    urls[modelId] = conversationUrl;
    convUrlStore.set(taskId, urls);
  }
  if (pageTitle) {
    const urlMap = convUrlStore.get(taskId) || {};
    urlMap._pageTitle = pageTitle;
  }
  const isFinal = (payload as { final?: boolean }).final === true;
  if (content) {
    responseAggregator.addResult(taskId, resolvedModelId, content);
    if (isFinal) {
      responseAggregator.markCompleted(taskId, resolvedModelId);
      const partial = responseAggregator.getAllResults(taskId);
      const q = taskQuestions.get(taskId) || '';
      const task: Task = {
        id: taskId, question: q,
        attachments: [], targetModels: Object.keys(partial) as ModelType[],
        status: 'collecting', createdAt: Date.now(), updatedAt: Date.now(),
        timeoutMs: 300000, results: partial,
        conversationId: taskId,
      };
      historyManager.save(task).catch(() => {});
    }
  } else if (error) {
    responseAggregator.markFailed(taskId, resolvedModelId, error);
  }
  const results = responseAggregator.getAllResults(taskId);
  const urlData = convUrlStore.get(taskId);
  chrome.runtime.sendMessage({ channel: 'model:update', trace_id: tid, payload: { taskId, results, conversationUrls: urlData || undefined } }).catch((e) => logger.warn('SW', tid, 'sendMessage failed: ' + e));
  return success({ received: true }, tid);
});

on('throttle:status', async (payload, _sender, tid) => {
  const modelId = (payload as { modelId?: string })?.modelId || 'unknown';
  const status = throttler.getStatus(modelId);
  return success({
    config: {
      minIntervalMs: throttler.config.minIntervalMs,
      autoPauseMs: throttler.config.autoPauseMs,
      maxErrorsBeforePause: throttler.config.maxErrorsBeforePause,
    },
    status,
  }, tid);
});

on('tabs:list', async (_payload, _sender, tid) => {
  const tabs = await windowManager.getAllTabs();
  return success({ tabs }, tid);
});

on('popup:sync', async (payload, _sender, tid) => {
  const skipModels = (payload as { skipModels?: string[] }).skipModels || [];
  const tabs = await windowManager.getAllTabs();
  const pending = tabs.filter(t => !skipModels.includes(t.modelId));
  logger.info('SW', tid, `同步: ${pending.length}/${tabs.length} 个待拉取`);
  const results: Record<string, { modelId: string; content: string; status: string; startedAt: number }> = {};
  await Promise.all(pending.map(async (tab) => {
    try {
      const res = await chrome.tabs.sendMessage(tab.tabId, { channel: 'GET_RESPONSE', trace_id: tid });
      if (res?.data?.content) results[tab.modelId] = { modelId: tab.modelId, content: res.data.content, status: 'completed', startedAt: Date.now() };
      else logger.info('SW', tid, `同步 ${tab.modelId}: 无内容`);
    } catch { logger.info('SW', tid, `同步 ${tab.modelId}: 标签页未就绪`); }
  }));
  logger.info('SW', tid, `同步完成: ${Object.keys(results).length}/${pending.length} 个模型有内容`);
  return success({ results }, tid);
});

on('tabs:open', async (payload, _sender, tid) => {
  const { modelId } = payload as { modelId: string };
  try {
    const result = await windowManager.openOrReuseTab(modelId as ModelType);
    return success({ success: true, tabId: result.tabId, isNew: result.isNew }, tid);
  } catch (err) {
    return success({ success: false, error: String(err) }, tid);
  }
});

on('tabs:switch', async (payload, _sender, tid) => {
  const { modelId } = payload as { modelId: string };
  const ok = await windowManager.switchToTab(modelId as ModelType);
  return success({ success: ok }, tid);
});

on('tabs:switchOrOpen', async (payload, _sender, tid) => {
  const { modelId, conversationUrl } = payload as { modelId: string; conversationUrl?: string };
  let ok = await windowManager.switchToTab(modelId as ModelType);
  if (!ok) {
    const domain = { chatgpt: 'chatgpt.com', claude: 'claude.ai', gemini: 'gemini.google.com', deepseek: 'chat.deepseek.com', grok: 'grok.com', doubao: 'www.doubao.com', glm: 'chat.z.ai', qwne: 'www.qianwen.com', qwnc: 'www.qianwen.com', hunyuan: 'aistudio.tencent.com', kimi: 'www.kimi.com', minimax: 'agent.minimaxi.com', longcat: 'longcat.chat', stepfun: 'chat.stepfun.com', mimo: 'aistudio.xiaomimimo.com' }[modelId];
    if (domain) {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find(t => t.url && t.id && new URL(t.url).hostname === domain);
      if (existing?.id) {
        await chrome.tabs.update(existing.id, { active: true }).catch(() => {});
        if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
        return success({ success: true }, tid);
      }
    }
    await windowManager.openOrReuseTab(modelId as ModelType, conversationUrl);
  }
  return success({ success: true }, tid);
});

on('tabs:close', async (payload, _sender, tid) => {
  const { modelId } = payload as { modelId: string };
  const ok = await windowManager.closeTab(modelId as ModelType);
  return success({ success: ok }, tid);
});

on('tabs:closeAll', async (_payload, _sender, tid) => {
  await windowManager.closeAllTabs();
  return success({ success: true }, tid);
});

on('summary:generate', async (payload, _sender, tid) => {
  const t0 = Date.now();
  const { mode, settings, taskId } = payload as { mode: string; settings: SummarySettings; taskId?: string };
  logger.debug(MODULE, tid, `收到 summary:generate: mode=${mode} taskId=${taskId || '(none)'}`);

  let summaryData: { question: string; results: Record<string, { modelId: string; content: string; status: string }>; createdAt: number } | null = null;

  if (taskId) {
    const taskResults = responseAggregator.getAllResults(taskId);
    if (Object.keys(taskResults).length > 0) {
      const results: Record<string, { modelId: string; content: string; status: string }> = {};
      for (const [modelId, r] of Object.entries(taskResults)) {
        if (r?.content) results[modelId] = { modelId: modelId as string, content: r.content, status: r.status };
      }
      if (Object.keys(results).length > 0) {
        summaryData = { question: '', results, createdAt: Date.now() };
      }
    }
    if (!summaryData) {
      const data = await chrome.storage.local.get(`summary:${taskId}`);
      summaryData = data[`summary:${taskId}`] || null;
    }
  }

  if (!summaryData) {
    const allData = await chrome.storage.local.get(null);
    const summaryKeys = Object.keys(allData).filter(k => k.startsWith('summary:'));
    if (summaryKeys.length > 0) {
      const latestKey = summaryKeys.sort((a, b) => (allData[b]?.createdAt || 0) - (allData[a]?.createdAt || 0))[0];
      summaryData = allData[latestKey];
    }
  }

  if (!summaryData) {
    const tabs = await windowManager.getAllTabs();
    const liveResults: Record<string, { modelId: string; content: string; status: string }> = {};
    for (const tab of tabs) {
      try {
        const res = await chrome.tabs.sendMessage(tab.tabId, { channel: 'GET_RESPONSE', trace_id: tid });
        if (res?.data?.content) liveResults[tab.modelId] = { modelId: tab.modelId, content: res.data.content, status: 'completed' };
      } catch { /* tab not ready */ }
    }
    if (Object.keys(liveResults).length > 0) summaryData = { question: '', results: liveResults, createdAt: Date.now() };
  }

  if (!summaryData || Object.keys(summaryData.results).length === 0) {
    return success({ success: false, error: '没有可汇总的数据，请先完成一次多模型对话' }, tid);
  }

  const summaryInstruction = await getSummaryPrompt();

  // 格式化为结构化文本
  const formattedContent = formatSummaryInput(summaryData.question, summaryData.results, summaryInstruction);
  logger.info(MODULE, tid, `汇总数据已格式化: ${Object.keys(summaryData.results).length} 个模型, 长度=${formattedContent.length}`);

  if (mode === 'web') {
    const webAdapter = new SummaryWebAdapter(windowManager);
    const modelId = settings.webModelId || 'chatgpt';
    try {
      const result = await webAdapter.summarizeViaWeb(modelId, { content: formattedContent, fileName: 'summary-input.md' }, () => {});
      logger.info(MODULE, tid, `汇总完成 ${result.length}字 ${((Date.now()-t0)/1000).toFixed(1)}s`);
      return success({ content: result }, tid);
    } catch (err) {
      logger.error(MODULE, tid, '汇总失败: ' + String(err));
      return failure('SUMMARY_ERR', String(err), tid);
    }
  }

  if (settings.apiKey && settings.provider) {
    const client = new ExternalModelClient({
      provider: settings.provider as 'openai' | 'claude-api' | 'gemini-api' | 'custom',
      apiKey: settings.apiKey,
      apiEndpoint: settings.baseUrl,
      modelName: settings.modelName,
      promptTemplate: summaryInstruction,
      useWebOnly: false,
      timeoutMs: 60000,
    });
    try {
      const result = await client.summarize(formattedContent);
      logger.info(MODULE, tid, `汇总完成 ${result.length}字 ${((Date.now()-t0)/1000).toFixed(1)}s`);
      return success({ content: result }, tid);
    } catch (err) {
      return failure('SUMMARY_ERR', String(err), tid);
    }
  }

  logger.warn(MODULE, tid, '汇总失败: 未配置汇总设置');
  return failure('SUMMARY_NO_CONFIG', '未配置汇总设置', tid);
});

on('summary:verify', async (payload, _sender, tid) => {
  const { provider, apiKey, baseUrl, modelName } = payload as { provider: string; apiKey: string; baseUrl?: string; modelName?: string };
  if (!apiKey) return failure('VERIFY_ERR', 'API Key 为空', tid);
  const client = new ExternalModelClient({
    provider: provider as 'openai' | 'claude-api' | 'gemini-api' | 'custom',
    apiKey,
    apiEndpoint: baseUrl,
    modelName,
    promptTemplate: '',
    useWebOnly: false,
    timeoutMs: 10000,
  });
  try {
    const ok = await client.validate();
    return ok ? success({ ok: true }, tid) : failure('VERIFY_ERR', '连接失败，请检查 API Key 和地址', tid);
  } catch (err) {
    return failure('VERIFY_ERR', String(err), tid);
  }
});

on('summary:score', async (payload, _sender, tid) => {
  const t0 = Date.now();
  const { mode, settings } = payload as { mode: string; settings: SummarySettings };
  logger.debug(MODULE, tid, '收到 summary:score');

  let results: Record<string, { modelId: string; content: string; status: string }> = {};
  const allData = await chrome.storage.local.get(null);
  const scoredSet: string[] = allData['scoredSummaries'] || [];
  const summaryKeys = Object.keys(allData).filter(k => k.startsWith('summary:'));
  if (summaryKeys.length > 0) {
    const latestKey = summaryKeys.sort((a, b) => (allData[b]?.createdAt || 0) - (allData[a]?.createdAt || 0))[0];
    if (scoredSet.includes(latestKey)) {
      return success({ success: false, error: '本轮数据已评分，请先发送新问题再评分' }, tid);
    }
    results = allData[latestKey]?.results || {};
    scoredSet.push(latestKey);
    await chrome.storage.local.set({ scoredSummaries: scoredSet });
  }

  if (Object.keys(results).length === 0) {
    const tabs = await windowManager.getAllTabs();
    for (const tab of tabs) {
      try {
        const res = await chrome.tabs.sendMessage(tab.tabId, { channel: 'GET_RESPONSE', trace_id: tid });
        if (res?.data?.content) results[tab.modelId] = { modelId: tab.modelId, content: res.data.content, status: 'completed' };
      } catch { /* tab not ready */ }
    }
  }

  if (Object.keys(results).length === 0) {
    return success({ success: false, error: '没有可评分的数据，请先完成一次多模型对话' }, tid);
  }

  const scoreInstruction = await getScorePrompt();
  const formattedContent = formatSummaryInput('', results, scoreInstruction);
  logger.info(MODULE, tid, `评分数据已格式化: ${Object.keys(results).length} 个模型, 长度=${formattedContent.length}`);

  if (mode === 'web') {
    const webAdapter = new SummaryWebAdapter(windowManager);
    const modelId = settings.webModelId || 'chatgpt';
    try {
      const result = await webAdapter.summarizeViaWeb(modelId, { content: formattedContent, fileName: 'summary-input.md' }, () => {});
      logger.info(MODULE, tid, `评分完成 ${result.length}字 ${((Date.now()-t0)/1000).toFixed(1)}s`);
      return success({ content: result }, tid);
    } catch (err) {
      logger.error(MODULE, tid, '评分失败: ' + String(err));
      return failure('SCORE_ERR', String(err), tid);
    }
  }

  if (settings.apiKey && settings.provider) {
    const client = new ExternalModelClient({
      provider: settings.provider as 'openai' | 'claude-api' | 'gemini-api' | 'custom',
      apiKey: settings.apiKey,
      apiEndpoint: settings.baseUrl,
      modelName: settings.modelName,
      promptTemplate: scoreInstruction,
      useWebOnly: false,
      timeoutMs: 60000,
    });
    try {
      const result = await client.summarize(formattedContent);
      logger.info(MODULE, tid, `评分完成 ${result.length}字 ${((Date.now()-t0)/1000).toFixed(1)}s`);
      return success({ content: result }, tid);
    } catch (err) {
      return failure('SCORE_ERR', String(err), tid);
    }
  }

  return failure('SUMMARY_NO_CONFIG', '未配置汇总设置', tid);
});

function formatSummaryInput(question: string, results: Record<string, { modelId: string; content: string; status: string }>, instruction?: string): string {
  const lines: string[] = [];
  lines.push('# 多模型回答汇总输入');
  lines.push('');
  if (instruction) {
    lines.push('## 汇总要求');
    lines.push(instruction);
    lines.push('');
  }
  if (question) {
    lines.push('## 原始问题');
    lines.push('');
    lines.push(question);
    lines.push('');
  }
  lines.push('## 各模型回答');
  lines.push('');
  for (const [modelId, data] of Object.entries(results)) {
    lines.push(`### ${modelId}`);
    lines.push('');
    lines.push(data.content);
    lines.push('');
  }
  return lines.join('\n');
}

/** [BUG-FIX] F7+F15 - 捕获 cleanup 引用，供模块卸载时清理 listener */
export const stopRouter = start();
