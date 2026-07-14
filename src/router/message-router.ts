import { logger } from '../shared/logger';
import type { ApiResponse } from '../shared/errors';
import { failure } from '../shared/errors';

const MODULE = 'ROUTER';

/* [BUG-FIX] F2 - 运行时校验: 验证消息信封格式 */
function validateMessageEnvelope(msg: unknown): msg is MessageEnvelope {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return typeof m.channel === 'string' && typeof m.trace_id === 'string';
}

/* [BUG-FIX] F2 - 运行时校验: 验证 API 响应格式 */
function validateApiResponse<T>(res: unknown): res is ApiResponse<T> {
  if (!res || typeof res !== 'object') return false;
  const r = res as Record<string, unknown>;
  return typeof r.success === 'boolean' && typeof r.trace_id === 'string';
}

type MessageHandler<T = unknown> = (
  payload: T,
  sender: chrome.runtime.MessageSender,
  traceId: string,
) => Promise<ApiResponse<T>>;

export interface MessageEnvelope {
  channel: string;
  payload: unknown;
  trace_id: string;
}

type MiddlewareFn = (
  message: MessageEnvelope,
  sender: chrome.runtime.MessageSender,
  next: () => Promise<ApiResponse<unknown>>,
) => Promise<ApiResponse<unknown>>;

const handlers = new Map<string, MessageHandler>();
/* [BUG-FIX] WG0-4 - 将 const 改为 let 以便 stop() 中能重新赋值清空 */
let middlewares: MiddlewareFn[] = [];
let listenerAttached = false;

export function createMessage(channel: string, payload: unknown, traceId?: string): MessageEnvelope {
  return {
    channel,
    payload,
    trace_id: traceId ?? crypto.randomUUID(),
  };
}

export async function send<T = unknown>(
  channel: string,
  payload: unknown,
  tabId?: number,
  traceId?: string,
): Promise<ApiResponse<T>> {
  const msg = createMessage(channel, payload, traceId);
  try {
    let response: unknown;
    if (tabId !== undefined) {
      response = await chrome.tabs.sendMessage(tabId, msg);
    } else {
      response = await chrome.runtime.sendMessage(msg);
    }
    /* [BUG-FIX] F2 - 运行时校验 API 响应格式 */
    if (!validateApiResponse<T>(response)) {
      const tid = msg.trace_id;
      logger.error(MODULE, tid, '收到无效响应格式');
      return failure('MR_INVALID_RESP', '响应格式无效', tid);
    }
    return response;
  } catch (err) {
    const tid = msg.trace_id;
    logger.error(MODULE, tid, `sendMessage 失败: ${err}`);
    return failure('MR_SEND_ERR', `消息发送失败: ${err}`, tid);
  }
}

function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ApiResponse<unknown>) => void,
) {
  /* [BUG-FIX] F2 - 运行时校验消息格式，拒绝无效消息 */
  if (!validateMessageEnvelope(message)) {
    const traceId = crypto.randomUUID();
    logger.error(MODULE, traceId, '收到无效消息格式: 缺少 channel 或 trace_id');
    sendResponse(failure('MR_INVALID_MSG', '消息格式无效', traceId));
    return false;
  }

  const msg = message;
  const traceId = msg.trace_id;
  const channel = msg.channel;

  if (channel !== 'tabs:list') logger.debug(MODULE, traceId, `收到消息 channel=${channel}`);

  const handler = handlers.get(channel);
  if (!handler) {
    sendResponse(failure('MR_UNKNOWN_CHANNEL', `未知消息通道: ${channel}`, traceId));
    return false;
  }

  const runPipeline = async (idx: number): Promise<ApiResponse<unknown>> => {
    if (idx < middlewares.length) {
      return middlewares[idx](msg, sender, () => runPipeline(idx + 1));
    }
    return handler(msg.payload, sender, traceId);
  };

  runPipeline(0)
    .then((res) => sendResponse(res))
    .catch((err) => {
      logger.error(MODULE, traceId, `handler 异常: ${err}`);
      sendResponse(failure('MR_HANDLER_ERR', 'handler 内部错误', traceId));
    });

  return true;
}

export function on<T = unknown>(channel: string, handler: MessageHandler<T>) {
  handlers.set(channel, handler as MessageHandler);

  if (!listenerAttached) {
    chrome.runtime.onMessage.addListener(handleMessage);
    listenerAttached = true;
  }
}

export function off(channel: string) {
  handlers.delete(channel);
  if (handlers.size === 0 && listenerAttached) {
    chrome.runtime.onMessage.removeListener(handleMessage);
    listenerAttached = false;
  }
}

export function stop() {
  handlers.clear();
  /* [BUG-FIX] WG0-4 - 清空中间件数组，避免 stop() 后残留 */
  middlewares = [];
  if (listenerAttached) {
    chrome.runtime.onMessage.removeListener(handleMessage);
    listenerAttached = false;
  }
}

const MAX_MIDDLEWARES = 10;

export function use(mw: MiddlewareFn) {
  /* [BUG-FIX] WG0-3 - 中间件数量上限检查，最多允许10个，超限则抛出错误 */
  if (middlewares.length >= MAX_MIDDLEWARES) {
    throw new Error(`中间件数量已达上限(${MAX_MIDDLEWARES})，无法注册更多中间件`);
  }
  middlewares.push(mw);
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://claude.ai',
  'https://gemini.google.com',
  'https://chat.deepseek.com',
  'https://grok.com',
  'https://www.doubao.com',
  'https://chat.z.ai',
  'https://www.qianwen.com',
  'https://chat.qwen.ai',
  'https://aistudio.tencent.com',
  'https://www.kimi.com',
  'https://agent.minimaxi.com',
  'https://longcat.chat',
];

export function sourceValidator(allowedOrigins?: string[]): MiddlewareFn {
  const origins = allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
  return async (message, sender, next) => {
    if (!sender.id) {
      return failure('MR_FORBIDDEN', '缺少发送者身份标识', message.trace_id);
    }

    const isContentScript = !!sender.tab;
    if (isContentScript) {
      if (!sender.tab?.id) {
        return failure('MR_FORBIDDEN', '内容脚本消息缺少 tab 信息', message.trace_id);
      }
      if (!sender.url) {
        return failure('MR_FORBIDDEN', '内容脚本消息缺少来源 URL', message.trace_id);
      }
      const senderOrigin = new URL(sender.url).origin;
      const allowed = origins.some((o) => {
        // [BUG-FIX] WG0-2 - 使用URL构造器解析origin比较，防止startsWith绕过
        try {
          return senderOrigin === new URL(o).origin;
        } catch {
          return false;
        }
      });
      if (!allowed) {
        return failure('MR_FORBIDDEN', `来源站点未授权: ${senderOrigin}`, message.trace_id);
      }
      return next();
    }

    const isPopupOrBg = sender.url?.startsWith('chrome-extension://');
    if (!isPopupOrBg) {
      return failure('MR_FORBIDDEN', '非扩展内部消息已被拒绝', message.trace_id);
    }
    return next();
  };
}

export const logMiddleware: MiddlewareFn = async (message, sender, next) => {
  logger.info(MODULE, message.trace_id, `[middleware] channel=${message.channel} sender=${sender.id ?? 'unknown'}`);
  return next();
};
