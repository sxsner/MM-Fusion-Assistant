import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForElement } from './adapter-utils';
import { logger } from '../../shared/logger';

const SEL_TEXTAREA = 'textarea.t-textarea__inner';
const SEL_STOP = '.hy-chat-input-send-btn--loading';

function setTextareaValue(input: HTMLTextAreaElement, value: string, tid: string): void {
  logger.info('HY', tid, `setTextareaValue 开始, value.length=${value.length}`);
  input.focus();
  logger.info('HY', tid, `focus 后 activeElement=${document.activeElement === input ? 'textarea' : '其他'}, value=${input.value.length}字`);
  input.select();
  logger.info('HY', tid, `select 后 selection=${input.selectionStart}-${input.selectionEnd}, value=${input.value.length}字`);
  const before = input.value;
  document.execCommand('insertText', false, value);
  logger.info('HY', tid, `execCommand 后 value=${input.value.length}字, 成功=${input.value !== before}`);
  if (input.value !== value) {
    logger.info('HY', tid, `execCommand 不完整, 当前=${input.value.length}字, 期望=${value.length}字, 尝试 native setter`);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
      logger.info('HY', tid, `native setter 后 value=${input.value.length}字`);
    } else {
      input.value = value;
      logger.info('HY', tid, `直接赋值后 value=${input.value.length}字`);
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    logger.info('HY', tid, '事件已派发');
  } else {
    logger.info('HY', tid, 'execCommand 完全成功');
  }
  logger.info('HY', tid, `最终 input.value=${input.value.length}字, 匹配=${input.value === value}`);
}

export class HunyuanAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const tid = crypto.randomUUID();
    logger.info('HY', tid, `等待输入元素: ${SEL_TEXTAREA}`);
    const input = (await waitForElement(SEL_TEXTAREA)) as HTMLTextAreaElement;
    logger.info('HY', tid, '输入元素已找到');
    await new Promise((r) => setTimeout(r, 500));
    setTextareaValue(input, question, tid);
    logger.info('HY', tid, '文本已填充');
    for (let i = 0; i < 5; i++) {
      const currentVal = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA)?.value || '';
      logger.info('HY', tid, `验证[${i}]: 当前=${currentVal.length}字, 期望=${question.length}字, 匹配=${currentVal === question}`);
      if (currentVal === question) break;
      await new Promise((r) => setTimeout(r, 200));
      const freshInput = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA);
      if (freshInput) { logger.info('HY', tid, `重试填充[${i}]`); setTextareaValue(freshInput, question, tid); }
    }
    if (attachments.length > 0) {
      logger.info('HY', tid, `上传 ${attachments.length} 个附件`);
      await this.uploadFiles(attachments);
    }
    await new Promise((r) => setTimeout(r, 1000));
    const inputVal = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA)?.value || '';
    logger.info('HY', tid, `准备发送: 输入框内容=${inputVal.length}字, 首20字="${inputVal.slice(0, 20)}"`);
    const sendSel = '.hy-chat-input-send-btn:not(.hy-chat-input-send-btn--disabled)';
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const btn = document.querySelector<HTMLElement>(sendSel);
      if (btn) { logger.info('HY', tid, '点击发送按钮'); btn.click(); return; }
      const anyBtn = document.querySelector<HTMLElement>('.hy-chat-input-send-btn');
      if (!anyBtn) logger.info('HY', tid, '发送按钮元素不存在');
      else logger.info('HY', tid, `发送按钮存在但禁用: disabled=${anyBtn.hasAttribute('disabled')} class=${anyBtn.className.slice(0, 40)}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    logger.info('HY', tid, '发送按钮未就绪，使用 Enter 键');
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    logger.info('HY', tid, 'Enter 已发送，等待页面响应');
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) return [];
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector<HTMLElement>(SEL_STOP);
  }

  async readResponse(): Promise<string> {
    const selectors: [string, string][] = [
      ['.hyc-common-markdown', 'hyc-common-markdown'],
      ['.hyc-content-md .hyc-common-markdown', 'hyc-content-md .hyc-common-markdown'],
      ['.hyc-content-md', 'hyc-content-md'],
      ['[class*="assistant"]', 'assistant'],
      ['.markdown-body', 'markdown-body'],
      ['[class*="message"]', 'message'],
      ['[class*="chat-msg"]', 'chat-msg'],
      ['[class*="chat-content"]', 'chat-content'],
      ['.hy-chat-message-item', 'hy-chat-message-item'],
      ['[class*="answer"]', 'answer'],
      ['[class*="reply"]', 'reply'],
    ];
    for (const [sel, label] of selectors) {
      const all = document.querySelectorAll<HTMLElement>(sel);
      if (all.length === 0) continue;
      for (let i = all.length - 1; i >= 0; i--) {
        const clone = all[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.hy-detail-block, .hy-think, .hy-collapse, [class*="think"], [class*="reason"]').forEach((el) => el.remove());
        const text = clone.textContent?.replace(/\s+/g, ' ').trim();
        if (text && text.length > 3) { logger.info('HY', 'read', `回复 ${text.length} 字 (${label})`); return text; }
      }
    }
    return '';
  }

  getUploadLimits() { return getLimits('hunyuan'); }
}
