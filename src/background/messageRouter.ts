import { logger } from '../shared/logger';
import type { ApiResponse } from '../shared/errors';
import { failure } from '../shared/errors';

const MODULE = 'MR';

type MessageHandler = (payload: unknown, sender: chrome.runtime.MessageSender, traceId: string) => Promise<ApiResponse<unknown>>;

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
const middlewares: MiddlewareFn[] = [];
let _started = false;

export function on(channel: string, handler: MessageHandler) {
  handlers.set(channel, handler);
}

export function off(channel: string) {
  handlers.delete(channel);
}

export function use(mw: MiddlewareFn) {
  middlewares.push(mw);
}

export function start() {
  if (_started) {
    logger.warn(MODULE, crypto.randomUUID(), 'MessageRouter 已启动，忽略重复调用');
    return () => {};
  }
  _started = true;

  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ApiResponse<unknown>) => void,
  ) => {
    const msg = message as Partial<MessageEnvelope>;
    const traceId = msg?.trace_id ?? crypto.randomUUID();
    const channel = msg?.channel ?? 'unknown';

    logger.debug(MODULE, traceId, `收到消息 channel=${channel}`);

    const handler = handlers.get(channel);
    if (!handler) {
      return false;
    }

    const runPipeline = async (idx: number): Promise<ApiResponse<unknown>> => {
      if (idx < middlewares.length) {
        return middlewares[idx](msg as MessageEnvelope, sender, () => runPipeline(idx + 1));
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
  };

  chrome.runtime.onMessage.addListener(listener);
  logger.info(MODULE, crypto.randomUUID(), 'MessageRouter 已启动');

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    _started = false;
    logger.info(MODULE, crypto.randomUUID(), 'MessageRouter 已停止');
  };
}
