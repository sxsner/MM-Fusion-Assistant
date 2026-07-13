import { logger } from '../shared/logger';

const MODULE = 'IH';

let initialized = false;

// [BUG-FIX] F8 - 提取为命名函数，便于 removeEventListener
const handleMessage = (event: MessageEvent): void => {
  // [BUG-FIX] F8 - origin 校验：仅允许当前扩展来源
  if (event.origin !== `chrome-extension://${chrome.runtime.id}`) {
    return;
  }

  if (event.data?.channel === 'iframe:ready') {
    logger.debug(MODULE, '', `iframe 就绪: origin=${event.origin}`);
  }
};

export function initIframeHost(traceId: string): void {
  if (initialized) return;
  initialized = true;

  logger.info(MODULE, traceId, 'IframeHost 已初始化');

  window.addEventListener('message', handleMessage);
}

// [BUG-FIX] F8 - 导出销毁函数，清理监听器并允许重新绑定
export function destroyIframeHost(): void {
  window.removeEventListener('message', handleMessage);
  initialized = false;
}
