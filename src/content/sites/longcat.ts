import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForInput, setContentEditableValue } from './adapter-utils';

export class LongCatAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput('[contenteditable="true"]') as HTMLElement;
    let text = question;
    if (attachments.length > 0) {
      const uploaded = await this.uploadFiles(attachments);
      if (uploaded.length === 0) {
        const decoder = new TextDecoder();
        const contents = attachments.map((a) => {
          const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
          const content = decoder.decode(bytes);
          return `[文件: ${a.name}]\n${content}`;
        });
        text = text ? text + '\n\n' + contents.join('\n\n') : contents.join('\n\n');
      }
    }
    setContentEditableValue(input, text);
    await new Promise((r) => setTimeout(r, 1000));
    const sendBtn = document.querySelector<HTMLElement>('.send-btn:not(.send-btn-disabled), .send-wrap .send-btn');
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const tid = crypto.randomUUID();
    const fileObjs = files.map((f) => FileUploadHelpers.attachmentToFile(f));
    logger.info('LONGCAT', tid, `文件上传: ${fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ')}`);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) {
      logger.warn('LONGCAT', tid, `未找�?<input type="file">`);
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    await new Promise((r) => setTimeout(r, 2000));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return document.querySelector<HTMLElement>('.stop-generate') !== null;
  }

  async readResponse(): Promise<string> {
    const all = document.querySelectorAll<HTMLElement>('.md-show-container.markdown, .mt-markdown-body, .markdown-body, [class*="assistant"], [class*="message-item"], [class*="chat-content"] [class*="content"], [class*="chat-item"]:not([class*="sidebar"]):not([class*="history"]):not([class*="input"]), [class*="message-content"]');
    for (let i = all.length - 1; i >= 0; i--) {
      const text = all[i].textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 5) return text;
    }
    return '';
  }

  getUploadLimits() { return getLimits('longcat'); }
}

