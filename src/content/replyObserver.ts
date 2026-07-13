import { logger } from '../shared/logger';
import type { ModelType } from '../shared/types';

const MODULE = 'OBS';

export class ReplyObserver {
  private modelId: ModelType;
  private targetElement: () => HTMLElement | null;
  private observer: MutationObserver | null = null;
  private content: string = '';
  private traceId: string;

  constructor(modelId: ModelType, targetElement: () => HTMLElement | null) {
    this.modelId = modelId;
    this.targetElement = targetElement;
    this.traceId = crypto.randomUUID();
  }

  start(onUpdate: (content: string) => void): void {
    // [BUG-FIX] WG3-3 - 防重入: 先断开旧observer再创建新observer
    if (this.observer) { this.observer.disconnect(); }
    const el = this.targetElement();
    if (!el) {
      logger.warn(MODULE, this.traceId, '目标元素不存在');
      return;
    }

    logger.info(MODULE, this.traceId, `开始观测: ${this.modelId}`);
    this.content = el.textContent || '';

    this.observer = new MutationObserver(() => {
      const current = this.targetElement()?.textContent || '';
      if (current !== this.content) {
        this.content = current;
        logger.debug(MODULE, this.traceId, `内容更新, 长度=${this.content.length}`);
        onUpdate(this.content);
      }
    });

    this.observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    logger.info(MODULE, this.traceId, `停止观测: ${this.modelId}`);
  }

  getCurrentContent(): string {
    return this.content;
  }
}
