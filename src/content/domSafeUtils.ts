import DOMPurify from 'dompurify';
import { logger } from '../shared/logger';

export function safeSetText(element: Element, text: string): void {
  element.textContent = text;
}

export function safeSetHTML(element: Element, html: string): void {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'br', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote'] });
  element.innerHTML = clean;
}

export function safeQuerySelector<K extends keyof HTMLElementTagNameMap>(
  selectors: K,
  parent?: ParentNode,
): HTMLElementTagNameMap[K] | null;
export function safeQuerySelector<K extends keyof SVGElementTagNameMap>(
  selectors: K,
  parent?: ParentNode,
): SVGElementTagNameMap[K] | null;
export function safeQuerySelector<E extends Element = Element>(
  selectors: string,
  parent?: ParentNode,
): E | null { // [BUG-FIX] WG89 - 删除冗余的第三重载签名（与实现签名完全相同）
  try {
    const root = parent ?? document;
    return root.querySelector<E>(selectors);
  } catch (err) {
    logger.warn('CONTENT', crypto.randomUUID(), 'safeQuerySelector failed: ' + err);
    return null;
  }
}
