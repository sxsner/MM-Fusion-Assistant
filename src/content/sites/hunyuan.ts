import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForElement } from './adapter-utils';

const SEL_TEXTAREA = 'textarea.t-textarea__inner';
const SEL_STOP = '.hy-chat-input-send-btn--loading';

function setTextareaValue(input: HTMLTextAreaElement, value: string): void {
  input.focus();
  input.select();
  if (document.execCommand('insertText', false, value)) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export class HunyuanAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    console.log('[HY_DBG] 1. waitForElement start');
    const input = (await waitForElement(SEL_TEXTAREA)) as HTMLTextAreaElement;
    console.log('[HY_DBG] 2. input found:', input.tagName, 'value length:', input.value?.length);
    await new Promise((r) => setTimeout(r, 500));
    console.log('[HY_DBG] 3. setTextareaValue');
    setTextareaValue(input, question);
    console.log('[HY_DBG] 3a. after set, value length:', input.value?.length);
    for (let i = 0; i < 5; i++) {
      const currentVal = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA)?.value || '';
      console.log('[HY_DBG] 3b. retry[' + i + '] current:', currentVal.length, 'expected:', question.length, 'match:', currentVal === question);
      if (currentVal === question) break;
      await new Promise((r) => setTimeout(r, 200));
      const freshInput = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA);
      if (freshInput) setTextareaValue(freshInput, question);
    }
    const finalVal = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA)?.value || '';
    console.log('[HY_DBG] 3c. final value length:', finalVal.length, 'match:', finalVal === question);
    if (attachments.length > 0) {
      console.log('[HY_DBG] 3d. uploading files:', attachments.length);
      await this.uploadFiles(attachments);
    }
    await new Promise((r) => setTimeout(r, 1000));
    const sendSel = '.hy-chat-input-send-btn:not(.hy-chat-input-send-btn--disabled)';
    const start = Date.now();
    console.log('[HY_DBG] 4. polling send button');
    while (Date.now() - start < 10000) {
      const btn = document.querySelector<HTMLElement>(sendSel);
      console.log('[HY_DBG] 4a. send btn:', !!btn);
      if (btn) { btn.click(); console.log('[HY_DBG] 4b. clicked send'); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('[HY_DBG] 5. send btn not found, Enter fallback');
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    console.log('[HY_DBG] 6. Enter dispatched');
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
    const el = document.querySelector<HTMLElement>(SEL_STOP);
    console.log('[HY_DBG] isGenerating:', !!el);
    return !!el;
  }

  async readResponse(): Promise<string> {
    const selectors = [
      '.hyc-content-md .hyc-common-markdown',
      '.hyc-content-md',
      '[class*="assistant"]', '.markdown-body',
      '[class*="message"]', '[class*="chat-msg"]', '[class*="chat-content"]',
      '.hy-chat-message-item', '[class*="answer"]', '[class*="reply"]',
    ];
    for (const sel of selectors) {
      const all = document.querySelectorAll<HTMLElement>(sel);
      if (all.length === 0) continue;
      console.log('[HY_DBG] readResponse sel:', sel.slice(0, 35), 'count:', all.length);
      for (let i = all.length - 1; i >= 0; i--) {
        const clone = all[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.hy-detail-block, .hy-think, .hy-collapse, [class*="think"], [class*="reason"]').forEach((el) => el.remove());
        const text = clone.textContent?.replace(/\s+/g, ' ').trim();
        console.log('[HY_DBG] readResponse[' + i + '] length:', text?.length, 'preview:', text?.slice(0, 40));
        if (text && text.length > 3) return text;
      }
    }
    console.log('[HY_DBG] readResponse: nothing found');
    return '';
  }

  getUploadLimits() { return getLimits('hunyuan'); }
}
