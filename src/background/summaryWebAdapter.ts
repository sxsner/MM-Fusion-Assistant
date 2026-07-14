import { logger } from '../shared/logger';
import type { ModelType } from '../shared/types';
import { WindowManager } from './windowManager';

const MODULE = 'SWA';

const NEW_CONVERSATION_URLS: Partial<Record<ModelType, string>> = {
  deepseek: 'https://chat.deepseek.com/',
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/',
  doubao: 'https://www.doubao.com/chat/',
  glm: 'https://chat.z.ai/',
  qwne: 'https://chat.qwen.ai/',
  qwnc: 'https://www.qianwen.com/',
  hunyuan: 'https://aistudio.tencent.com/',
  kimi: 'https://www.kimi.com/?chat_enter_method=new_chat',
  minimax: 'https://agent.minimaxi.com/',
  longcat: 'https://longcat.chat/',
  stepfun: 'https://chat.stepfun.com/chats/new',
  mimo: 'https://aistudio.xiaomimimo.com/#/c',
};

export class SummaryWebAdapter {
  constructor(private windowManager: WindowManager) {}

  async summarizeViaWeb(
    modelId: ModelType,
    params: { content: string; fileName: string },
    _onChunk: (chunk: string) => void,
  ): Promise<string> {
    const traceId = crypto.randomUUID();
    logger.info(MODULE, traceId, '网页端汇总开始: ' + modelId);

    const newConvUrl = NEW_CONVERSATION_URLS[modelId];
    const { tabId } = await this.windowManager.openOrReuseTab(modelId, newConvUrl);

    // 等待 content script 准备就绪
    await this.waitForTabReady(tabId, traceId);

    // 发送汇总请求（含文件内容）
    await chrome.tabs.sendMessage(tabId, {
      channel: 'SUMMARY_REQUEST',
      payload: { content: params.content, fileName: params.fileName, taskId: traceId },
      trace_id: traceId,
    });

    // 监听 SUMMARY_DONE
    const result = await this.listenForSummaryDone(traceId);
    logger.info(MODULE, traceId, '网页端汇总完成');
    return result;
  }

  private waitForTabReady(tabId: number, traceId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const handler = (
        message: { channel?: string; payload?: { hostname?: string }; trace_id?: string },
        sender: chrome.runtime.MessageSender,
      ) => {
        if (done) return;
        if (message.channel === 'content:ready' && sender.tab?.id === tabId) {
          done = true;
          chrome.runtime.onMessage.removeListener(handler);
          clearTimeout(timeoutId);
          logger.debug(MODULE, traceId, 'content script 已就绪');
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(handler);
      const timeoutId = setTimeout(() => {
        if (done) return;
        done = true;
        chrome.runtime.onMessage.removeListener(handler);
        logger.warn(MODULE, traceId, '等待 content script 超时，强制继续');
        resolve();
      }, 8000);
    });
  }

  private listenForSummaryDone(traceId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let done = false;
      const handler = (
        message: { channel?: string; payload?: { fullContent?: string; error?: string }; trace_id?: string },
        _sender: chrome.runtime.MessageSender,
      ) => {
        if (done) return;
        if (message.trace_id !== traceId) return;
        if (message.channel === 'SUMMARY_DONE' || message.channel === 'SUMMARY_ERROR') {
          done = true;
          chrome.runtime.onMessage.removeListener(handler);
          clearTimeout(timeoutId);
          if (message.channel === 'SUMMARY_DONE' && message.payload?.fullContent) {
            resolve(message.payload.fullContent);
          } else {
            reject(new Error(message.payload?.error || '汇总失败'));
          }
        }
      };
      chrome.runtime.onMessage.addListener(handler);
      const timeoutId = setTimeout(() => {
        if (done) return;
        done = true;
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('汇总超时'));
      }, 120000);
    });
  }
}
