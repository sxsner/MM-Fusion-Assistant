import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForInput, setInputValue } from './adapter-utils';

export class StepFunAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput('textarea[placeholder*="问我"], textarea.Publisher_textarea__pMX9t, textarea') as HTMLTextAreaElement;
    setInputValue(input, question);
    await new Promise((r) => setTimeout(r, 1000));
    if (attachments.length > 0) await this.uploadFiles(attachments);
    // Poll for send button to become enabled
    const sendSel = 'button:has(svg.custom-icon-send-outline), button[class*="send"], button[aria-label*="发送"], button[type="submit"]';
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const btn = document.querySelector<HTMLElement>(sendSel);
      if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const tid = crypto.randomUUID();
    const fileObjs = files.map((f) => FileUploadHelpers.attachmentToFile(f));
    logger.info('STEPFUN', tid, `文件上传: ${fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ')}`);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) {
      logger.warn('STEPFUN', tid, `未找�?<input type="file">`);
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    await new Promise((r) => setTimeout(r, 2000));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return document.querySelector<HTMLElement>('[class*="stop"], button[class*="stop"], svg[class*="stop"]') !== null;
  }

  async readResponse(): Promise<string> {
    // Try message-markdown content (new StepFun UI), skip reasoning and citation refs
    const mdContainers = document.querySelectorAll<HTMLElement>('[class*="message-markdown_markdown"]');
    for (let i = mdContainers.length - 1; i >= 0; i--) {
      if (mdContainers[i].className?.includes('reason-render')) continue;
      const text = mdContainers[i].textContent?.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    // Assistant message in the main chat area (skip sidebar/history)
    const chatArea = document.querySelector('[class*="chat"], [class*="conversation"], main');
    if (chatArea) {
      const assistantSelectors = ['.markdown-body', '[class*="assistant"]', '[class*="message"]', '[class*="chat-content"] [class*="content"]', '[class*="message-item"]', '[class*="chat-item"]'];
      for (const sel of assistantSelectors) {
        const containers = chatArea.querySelectorAll<HTMLElement>(sel);
        if (containers.length > 0) {
          for (let i = containers.length - 1; i >= 0; i--) {
            const text = containers[i].textContent?.replace(/\s+/g, ' ').trim();
            if (text) return text;
          }
        }
      }
    }
    return '';
  }

  getUploadLimits() { return getLimits('stepfun'); }
}

