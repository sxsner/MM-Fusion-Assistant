import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { setInputValue, waitForInput } from './adapter-utils';

export class GrokAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput('textarea, [contenteditable="true"]') as HTMLElement;

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, question);
    } else {
      await chrome.runtime.sendMessage({ channel: 'grok:fill', payload: { text: question } });
    }

    if (attachments.length > 0) {
      await this.uploadFiles(attachments);
    }

    await new Promise((r) => setTimeout(r, 1000));
    const sendSel = 'button[aria-label*="send"], button[aria-label*="发送"], button[aria-label*="提交"], button[data-testid*="send"], button[data-testid*="submit"], button[type="submit"]';
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const btn = document.querySelector<HTMLElement>(sendSel);
      if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    (input as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
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
    const sel = 'button[aria-label*="stop" i], [data-testid*="stop"], [class*="stop"]:not([class*="send"])';
    return !!document.querySelector<HTMLElement>(sel);
  }

  async readResponse(): Promise<string> {
    const selectors = [
      '[data-testid="assistant-message"], [data-testid*="message"], [class*="message"][class*="assistant"]',
      '.message-bubble, [class*="response-content"], .prose, [class*="markdown"]',
      '[data-testid="chat-message"], [class*="message"], article, [class*="chat"]',
    ];
    const THINK_RE = /思考了\s*\d+\.?\d*\s*秒[，,。]?\s*/g;
    const THINK_RE_EN = /Thought\s+for\s+\d+\.?\d*\s*s[.,]?\s*/gi;
    const THINK_RE_ZH = /已深度思考（用时\d+\.?\d*秒）\s*/g;
    for (const sel of selectors) {
      const all = document.querySelectorAll<HTMLElement>(sel);
      for (let i = all.length - 1; i >= 0; i--) {
        const clone = all[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[class*="notes"], [class*="think"], [class*="reason"], [class*="thought"], [data-testid*="thinking"]').forEach((el) => el.remove());
        let text = clone.textContent?.replace(/\s+/g, ' ').trim() || '';
        text = text.replace(THINK_RE, '');
        text = text.replace(THINK_RE_EN, '');
        text = text.replace(THINK_RE_ZH, '');
        if (text && text.length > 5) return text;
      }
    }
    return '';
  }

  getUploadLimits() { return getLimits('grok'); }
}
