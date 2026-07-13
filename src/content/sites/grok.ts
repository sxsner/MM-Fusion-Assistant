import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { setInputValue, waitForInput } from './adapter-utils';

export class GrokAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    console.log('[GROK_DBG] 1. waitForInput start');
    const input = await waitForInput('textarea, [contenteditable="true"]') as HTMLElement;
    console.log('[GROK_DBG] 2. input found:', input.tagName, 'contenteditable:', input.contentEditable, 'class:', input.className.slice(0, 100));

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      console.log('[GROK_DBG] 3a. is textarea/input, setInputValue');
      setInputValue(input, question);
    } else {
      console.log('[GROK_DBG] 3b. is contenteditable, using grok:fill via page context');
      await chrome.runtime.sendMessage({ channel: 'grok:fill', payload: { text: question } });
    }

    console.log('[GROK_DBG] 4. text set via page context');

    if (attachments.length > 0) {
      console.log('[GROK_DBG] 4c. uploading files:', attachments.length);
      await this.uploadFiles(attachments);
    }

    await new Promise((r) => setTimeout(r, 1000));
    console.log('[GROK_DBG] 5. polling send button');
    const sendSel = 'button[aria-label*="send"], button[aria-label*="发送"], button[aria-label*="提交"], button[data-testid*="send"], button[data-testid*="submit"], button[type="submit"]';
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 10000) {
      const allBtns = document.querySelectorAll('button');
      console.log('[GROK_DBG] 5a. total buttons:', allBtns.length);
      const btn = document.querySelector<HTMLElement>(sendSel);
      console.log('[GROK_DBG] 5b. sendSel match:', btn?.tagName, btn?.getAttribute('aria-label'), btn?.getAttribute('data-testid'), 'disabled:', btn?.hasAttribute('disabled'));
      if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
        console.log('[GROK_DBG] 5c. clicking send button');
        btn.click();
        found = true;
        return;
      }
      if (!btn) {
        console.log('[GROK_DBG] 5d. no send button yet, waiting 1s');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('[GROK_DBG] 6. send button not found, trying Enter fallback, found=' + found);
    (input as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    console.log('[GROK_DBG] 7. Enter dispatched');
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
    const el = document.querySelector<HTMLElement>(sel);
    console.log('[GROK_DBG] isGenerating:', !!el, el?.tagName, el?.getAttribute('aria-label'));
    return !!el;
  }

  async readResponse(): Promise<string> {
    const selectors = [
      '[data-testid="assistant-message"], [data-testid*="message"], [class*="message"][class*="assistant"]',
      '.message-bubble, [class*="response-content"], .prose, [class*="markdown"]',
      '[data-testid="chat-message"], [class*="message"], article, [class*="chat"]',
    ];
    for (const sel of selectors) {
      const all = document.querySelectorAll<HTMLElement>(sel);
      console.log('[GROK_DBG] readResponse selector:', sel.slice(0, 50), 'count:', all.length);
      for (let i = all.length - 1; i >= 0; i--) {
        let text = all[i].textContent?.replace(/\s+/g, ' ').trim() || '';
        text = text.replace(/思考了\s*\d+\.?\d*\s*秒[，,。]?\s*/g, '');
        text = text.replace(/Thought\s+for\s+\d+\.?\d*\s*s[.,]?\s*/gi, '');
        text = text.replace(/已深度思考（用时\d+\.?\d*秒）\s*/g, '');
        if (text && text.length > 5) {
          console.log('[GROK_DBG] readResponse found:', text.slice(0, 60));
          return text;
        }
      }
    }
    console.log('[GROK_DBG] readResponse: nothing found');
    return '';
  }

  getUploadLimits() { return getLimits('grok'); }
}
