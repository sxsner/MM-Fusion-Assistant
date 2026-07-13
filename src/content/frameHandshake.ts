import { logger } from '../shared/logger';

const MODULE = 'CS';

export async function performHandshake(traceId: string): Promise<boolean> {
  const hostname = window.location.hostname;

  logger.info(MODULE, traceId, '发送 CONTENT_READY');

  try {
    const response = await chrome.runtime.sendMessage({
      channel: 'content:ready',
      payload: { hostname },
      trace_id: traceId,
    });

    if (!response) {
      // [BUG-FIX] WG6-catch-as - as 类型断言前校验 response 非 undefined
      logger.error(MODULE, traceId, '握手失败: 未收到响应');
      return false;
    }

    const res = response as { success: boolean; data?: { registered: boolean }; error?: { message: string } };

    if (res.success && res.data?.registered) {
      logger.debug(MODULE, traceId, '握手完成，已注册');
      return true;
    }

    logger.error(MODULE, traceId, `握手失败: ${res.error?.message}`);
    return false;
  } catch (err) {
    logger.error(MODULE, traceId, `握手异常: ${err}`);
    return false;
  }
}
