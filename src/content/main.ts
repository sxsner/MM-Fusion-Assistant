import { logger } from '../shared/logger';
import { performHandshake } from './frameHandshake';
import { getAdapter } from './sites';
import type { Attachment } from '../shared/types';
import { getTimingConfig } from '../shared/store';
import { setInputDelay, setSendDelay } from './sites/adapter-utils';

const MODULE = 'CS';
const traceId = crypto.randomUUID();
console.info('[CS]', traceId, 'content script loaded, hostname:', window.location.hostname);

/** Per-batch dedup: key = taskId_batchIndex */
const processedBatches = new Set<string>();
let sendCounter = 0;

getTimingConfig().then((c) => { setInputDelay(c.inputInterval); setSendDelay(c.sendInterval); }).catch(() => {});

/** Background message from extension runtime */
interface BackgroundMessage {
  channel?: string;
  payload?: { taskId: string; question: string; attachments?: Attachment[]; batchIndex?: number; totalBatches?: number; startNew?: boolean };
  trace_id?: string;
}

/** [BUG-FIX] WG3-2 - 自定义类型守卫，替代裸 as 断言 */
function isBackgroundMessage(obj: unknown): obj is BackgroundMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const m = obj as Record<string, unknown>;
  if (m.channel !== undefined && typeof m.channel !== 'string') return false;
  if (m.trace_id !== undefined && typeof m.trace_id !== 'string') return false;
  if (m.payload !== undefined) {
    if (typeof m.payload !== 'object' || m.payload === null) return false;
    const p = m.payload as Record<string, unknown>;
    if (p.taskId !== undefined && typeof p.taskId !== 'string') return false;
    if (p.question !== undefined && typeof p.question !== 'string') return false;
  }
  return true;
}

const processPrompt = async (taskId: string, question: string, attachments: Attachment[]): Promise<void> => {
  const hostname = window.location.hostname;
  const tid = traceId;
  const modelInputSelector: Record<string, string> = {
    'chat.deepseek.com': 'textarea[name="search"]',
    'chatgpt.com': 'div[contenteditable="true"]#prompt-textarea, div[contenteditable="true"], #prompt-textarea',
    'chat.openai.com': 'div[contenteditable="true"]#prompt-textarea, div[contenteditable="true"], #prompt-textarea',
    'claude.ai': 'div[contenteditable="true"], [data-testid="chat-input"]',
    'gemini.google.com': 'div.ql-editor[contenteditable="true"], div[contenteditable="true"]',
    'grok.com': 'div[contenteditable="true"], textarea',
    'www.doubao.com': 'textarea.semi-input-textarea',
    'chat.stepfun.com': 'textarea[placeholder*="问我"], textarea',
  };
  const selector = modelInputSelector[hostname];
  let hasModelUI = false;
  if (selector) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (document.querySelector(selector)) { hasModelUI = true; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
  } else {
    hasModelUI = true;
  }
  console.info('[CS]', tid, `frame 检测: ${hostname} hasModelUI=${hasModelUI} readyState=${document.readyState}`);
  logger.debug(MODULE, tid, `frame 检测: ${hostname} hasModelUI=${hasModelUI} readyState=${document.readyState}`);
  if (!hasModelUI) {
    logger.debug(MODULE, tid, `当前 frame 没有 ${hostname} 的 UI 元素，跳过处理`);
    return;
  }

  await new Promise((r) => setTimeout(r, Math.random() * 300));

  try {
    const claim = await chrome.runtime.sendMessage({ channel: 'claim:send', payload: { taskId } });
    if (!claim?.data?.claimed) {
      logger.info(MODULE, tid, `task ${taskId.slice(0, 8)} 已被其他 frame 认领，跳过`);
      return;
    }
  } catch {
    logger.warn(MODULE, tid, `认领失败（SW 可能重启），直接处理`);
  }
  const hostToModel: Record<string, string> = {
    'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'claude.ai': 'claude',
    'gemini.google.com': 'gemini', 'chat.deepseek.com': 'deepseek', 'grok.com': 'grok',
    'www.doubao.com': 'doubao', 'chat.z.ai': 'glm', 'www.qianwen.com': 'qwnc', 'chat.qwen.ai': 'qwne',
    'aistudio.tencent.com': 'hunyuan', 'www.kimi.com': 'kimi',
    'agent.minimaxi.com': 'minimax', 'longcat.chat': 'longcat',
    'chat.stepfun.com': 'stepfun',
    'aistudio.xiaomimimo.com': 'mimo',
  };
  const modelId = hostToModel[hostname] || hostname;

  const adapter = getAdapter(hostname);
  const baseline = (await adapter.readResponse().catch(() => '')).trim();
  await adapter.fillAndSend(question, attachments || []);
  logger.info(MODULE, tid, `已发送 prompt 到 ${hostname} (${modelId})`);

  await new Promise((r) => setTimeout(r, 5000));
  let generated = false;
  let stableContent = '';
  let stableSince = 0;
  let growStableSince = 0;
  let lastLen = 0;
  const start = Date.now();
  let adapterErrors = 0;
  let contentGrace = 0;
  while (Date.now() - start < 180000 + contentGrace) {
    await new Promise((r) => setTimeout(r, 500));
    const generating = await adapter.isGenerating().catch(() => false);
    if (generating && !generated) { generated = true; stableContent = ''; stableSince = 0; growStableSince = 0; lastLen = 0; }
    if (generating) { stableSince = Date.now(); growStableSince = Date.now(); }
    if (!generated && Date.now() - start > 5000) {
      const current = (await adapter.readResponse().catch(() => '')).trim();
      if (current && current !== baseline) { stableContent = current; stableSince = Date.now(); growStableSince = Date.now(); lastLen = current.length; generated = true; contentGrace = 60000; }
    }
    let reply: string;
    try { reply = await adapter.readResponse(); adapterErrors = 0; } catch {
      adapterErrors++;
      if (adapterErrors > 10) { logger.warn(MODULE, tid, `readResponse 失败 ${adapterErrors} 次`); break; }
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const trimmed = reply.trim();
    if (trimmed && trimmed !== stableContent && trimmed !== baseline) {
      const qHead = question.slice(0, 20);
      if (trimmed.length > 20 && trimmed.includes(qHead)) {
        logger.debug(MODULE, tid, `${modelId}: 内容含提问前缀，跳过`);
      } else {
        if (!contentGrace) contentGrace = 60000;
        stableContent = trimmed; stableSince = Date.now();
        if (trimmed.length !== lastLen) { lastLen = trimmed.length; growStableSince = Date.now(); }
        chrome.runtime.sendMessage({ channel: 'model:result', trace_id: tid, payload: { taskId, modelId, content: trimmed, conversationUrl: window.location.href } }).catch(() => {});
      }
    }
    const stillGenerating = await adapter.isGenerating().catch(() => false);
    const stableFor = Date.now() - stableSince;
    const growStableFor = Date.now() - growStableSince;
    const canFinalize = stableFor > 5000 && !stillGenerating;
    const forceFinalize = stableContent && growStableFor > 10000 && !stillGenerating;
    const panicFinalize = stableContent && stableFor > 30000;
    if (stableContent && (canFinalize || forceFinalize || panicFinalize)) {
      let conversationUrl = window.location.href;
      const urlCheck = Date.now();
      while (Date.now() - urlCheck < 5000) { const cur = window.location.href; if (cur !== conversationUrl) { conversationUrl = cur; break; } await new Promise((r) => setTimeout(r, 200)); }
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      chrome.runtime.sendMessage({ channel: 'model:result', trace_id: tid, payload: { taskId, modelId, content: stableContent, conversationUrl, pageTitle: document.title, final: true } }).catch(() => {});
      logger.info(MODULE, tid, `✓ ${modelId} ${stableContent.length}字 ${elapsed}s`);
      return;
    }
    if (stableContent && stableFor > 500) {
      chrome.runtime.sendMessage({ channel: 'model:result', trace_id: tid, payload: { taskId, modelId, content: stableContent, conversationUrl: window.location.href } }).catch(() => {});
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (stableContent) {
    chrome.runtime.sendMessage({ channel: 'model:result', trace_id: tid, payload: { taskId, modelId, content: stableContent, conversationUrl: window.location.href, final: true } }).catch(() => {});
    logger.warn(MODULE, tid, `✗ ${modelId} 超时 ${elapsed}s，已提交 ${stableContent.length} 字`);
  } else {
    logger.warn(MODULE, tid, `✗ ${modelId} 超时 ${elapsed}s`);
    chrome.runtime.sendMessage({ channel: 'model:result', trace_id: tid, payload: { taskId, modelId, error: '超时' } }).catch(() => {});
  }
};

/** [BUG-FIX] F7+F15 - 提取 listener 引用以便移除 */
const onBackgroundMessage = (
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { success: boolean; data: null; error: null; trace_id: string }) => void,
) => {
  const msg: BackgroundMessage = isBackgroundMessage(message) ? message : {};
  const tid = msg?.trace_id ?? traceId;

  logger.debug(MODULE, tid, `收到 background 消息: ${msg?.channel}`);

  if (msg?.channel === 'GET_RESPONSE') {
    (async () => {
      try {
        const adapter = getAdapter(window.location.hostname);
        const content = await adapter.readResponse().catch(() => '');
        sendResponse({ success: true, data: { content } as any, error: null, trace_id: tid });
      } catch { sendResponse({ success: true, data: { content: '' } as any, error: null, trace_id: tid }); }
    })();
    return true;
  }

  if (msg?.channel === 'SEND_PROMPT' && msg?.payload) {
    const { taskId, question, attachments, batchIndex = 0, totalBatches = 1, startNew } = msg.payload;
    document.body.dataset.startNew = String(startNew !== false);
    sendCounter++;
    console.info('[CS]', tid, `SEND_PROMPT #${sendCounter}: taskId=${taskId.slice(0, 8)} batch=${batchIndex}/${totalBatches}`);
    logger.info(MODULE, tid, `SEND_PROMPT #${sendCounter}: taskId=${taskId.slice(0, 8)} batch=${batchIndex}/${totalBatches} 附件=${attachments?.length || 0}`);

    const batchKey = `${taskId}_${batchIndex}`;
    if (processedBatches.has(batchKey)) {
      logger.warn(MODULE, tid, `重复 SEND_PROMPT batch=${batchIndex}/${totalBatches}，跳过`);
      return;
    }
    processedBatches.add(batchKey);
    if (processedBatches.size > 50) {
      const first = processedBatches.values().next().value;
      if (first) processedBatches.delete(first);
    }

    processPrompt(taskId, question, attachments || []);
    return;
  }

  sendResponse({ success: true, data: null, error: null, trace_id: tid });
  return false;
};

chrome.runtime.onMessage.addListener(onBackgroundMessage);
window.addEventListener('beforeunload', cleanup);
performHandshake(traceId);

/** [BUG-FIX] F7+F15 - 导出 cleanup 函数，供模块卸载时清理 chrome listener */
export function cleanup(): void {
  chrome.runtime.onMessage.removeListener(onBackgroundMessage);
  chrome.runtime.onMessage.removeListener(onSummaryMessage);
}

// ============= SUMMARY_REQUEST 处理 =============
interface SummaryMessage {
  channel?: string;
  payload?: { content: string; fileName: string; taskId: string };
  trace_id?: string;
}

function isSummaryMessage(obj: unknown): obj is SummaryMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const m = obj as Record<string, unknown>;
  return m.channel === 'SUMMARY_REQUEST';
}

const onSummaryMessage = (
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { success: boolean }) => void,
) => {
  if (!isSummaryMessage(message)) return;
  if (!message.payload) return;

  const { content, fileName } = message.payload;
  const tid = message.trace_id || crypto.randomUUID();

  logger.info(MODULE, tid, `收到 SUMMARY_REQUEST: 内容长度=${content.length}`);

  // 立即响应，不保持通道开放
  sendResponse({ success: true });

  // 异步处理
  (async () => {
    const hostname = window.location.hostname;
    const modelInputSelector: Record<string, string> = {
      'chat.deepseek.com': 'textarea[name="search"]',
      'chatgpt.com': 'div[contenteditable="true"]#prompt-textarea, div[contenteditable="true"], #prompt-textarea',
      'chat.openai.com': 'div[contenteditable="true"]#prompt-textarea, div[contenteditable="true"], #prompt-textarea',
      'claude.ai': 'div[contenteditable="true"], [data-testid="chat-input"]',
      'gemini.google.com': 'div.ql-editor[contenteditable="true"], div[contenteditable="true"]',
      'grok.com': 'div[contenteditable="true"], textarea',
      'www.doubao.com': 'textarea.semi-input-textarea',
      'chat.stepfun.com': 'textarea[placeholder*="问我"], textarea',
      'www.qianwen.com': '[data-slate-editor="true"]',
      'chat.qwen.ai': 'textarea.message-input-textarea',
      'aistudio.tencent.com': 'textarea.t-textarea__inner',
      'www.kimi.com': '[contenteditable="true"]',
      'agent.minimaxi.com': '[contenteditable="true"]',
      'longcat.chat': '[contenteditable="true"]',
      'aistudio.xiaomimimo.com': 'textarea, [contenteditable="true"]',
    };
    const selector = modelInputSelector[hostname];
    let hasModelUI = false;
    if (selector) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (document.querySelector(selector)) { hasModelUI = true; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (!hasModelUI) {
      logger.debug(MODULE, tid, `SUMMARY_REQUEST: 当前 frame 没有 UI 元素，跳过`);
      return;
    }

    try {
      const adapter = getAdapter(hostname);
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        name: fileName,
        type: 'text/plain',
        size: content.length,
        data: btoa(unescape(encodeURIComponent(content))),
        compressed: false,
      };
      const uploaded = await adapter.uploadFiles([attachment]);
      if (uploaded.length > 0) {
        await adapter.fillAndSend('', []);
      } else {
        throw new Error('文件上传失败，不支持文件上传的模型无法进行汇总/评分');
      }

      let generated = false;
      let stableContent = '';
      let stableSince = 0;
      const start = Date.now();

      while (Date.now() - start < 120000) {
        await new Promise((r) => setTimeout(r, 500));
        const generating = await adapter.isGenerating().catch(() => false);
        if (generating && !generated) {
          generated = true;
          stableContent = '';
          stableSince = 0;
        }
        // 5s fallback: force tracking if isGenerating never returns true
        if (!generated && Date.now() - start > 5000) {
          const current = (await adapter.readResponse().catch(() => '')).trim();
          if (current) {
            stableContent = current;
            stableSince = Date.now();
            generated = true;
          }
        }
        const reply = await adapter.readResponse().catch(() => '');
        const trimmed = reply.trim();
        if (generated && trimmed && trimmed !== stableContent) {
          stableContent = trimmed;
          stableSince = Date.now();
        }
        const stableFor = Date.now() - stableSince;

        const isStable = stableContent && stableFor > 5000;
        const isStableEnough = stableContent && (stableFor > 5000 || (Date.now() - start > 120000 && stableFor > 3000));
        if ((!generating || isStableEnough) && isStable) {
          logger.info(MODULE, tid, `SUMMARY_DONE: 内容长度=${stableContent.length}`);
          chrome.runtime.sendMessage({
            channel: 'SUMMARY_DONE', trace_id: tid,
            payload: { fullContent: stableContent },
          }).catch(() => {});
          return;
        }
      }

      if (stableContent) {
        logger.warn(MODULE, tid, `SUMMARY_DONE (超时): 内容长度=${stableContent.length}`);
        chrome.runtime.sendMessage({
          channel: 'SUMMARY_DONE', trace_id: tid,
          payload: { fullContent: stableContent },
        }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({
          channel: 'SUMMARY_ERROR', trace_id: tid,
          payload: { error: '汇总超时' },
        }).catch(() => {});
      }
    } catch (err) {
      logger.error(MODULE, tid, `SUMMARY_REQUEST 失败: ${err}`);
      chrome.runtime.sendMessage({
        channel: 'SUMMARY_ERROR', trace_id: tid,
        payload: { error: String(err) },
      }).catch(() => {});
    }
  })();

  return false;
};

chrome.runtime.onMessage.addListener(onSummaryMessage);
