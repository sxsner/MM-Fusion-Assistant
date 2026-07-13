import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForInput, waitAndClick, setContentEditableValue } from './adapter-utils';

const SEL_TEXTAREA = '[contenteditable="true"]';
const SEL_SEND = ['.send-button-container:not(.disabled)', 'button[class*="send"]:not([disabled]), button[aria-label*="发�?]:not([disabled])'];
const SEL_STOP = '.send-button-container.stop';

export class KimiAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput(SEL_TEXTAREA) as HTMLElement;
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
    try {
      await waitAndClick(SEL_SEND);
    } catch {
      (input as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const tid = crypto.randomUUID();
    const fileObjs = files.map((f) => FileUploadHelpers.attachmentToFile(f));
    logger.info('KIMI', tid, `文件上传: ${fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ')}`);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) {
      logger.warn('KIMI', tid, `未找�?<input type="file">`);
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    await new Promise((r) => setTimeout(r, 2000));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector<HTMLElement>(SEL_STOP);
  }

  async readResponse(): Promise<string> {
    // Only assistant response containers, skip user messages
    const marks = document.querySelectorAll<HTMLElement>('.segment-assistant .markdown-container .markdown, .segment-assistant .markdown-body, .segment-assistant [class*="message-content"] .markdown');
    for (let i = marks.length - 1; i >= 0; i--) {
      const text = marks[i].textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 5) return text;
    }
    // Fallback: general assistant selectors
    const assistantSelectors = ['.segment-assistant', '[class*="assistant"]', '[class*="message-content"]', '[class*="chat-content"] [class*="content"]'];
    for (const sel of assistantSelectors) {
      const containers = document.querySelectorAll<HTMLElement>(sel);
      if (containers.length > 0) {
        for (let i = containers.length - 1; i >= 0; i--) {
          if (containers[i].closest('[class*="think"], [class*="reason"], [class*="thought"]')) continue;
          const raw = containers[i].textContent?.replace(/\s+/g, ' ').trim() || '';
          const thinkMarkers = ['已思考完成', '思考中', '思考过程', '推理过程'];
          let cleanText = raw;
          for (const marker of thinkMarkers) {
            const idx = cleanText.lastIndexOf(marker);
            if (idx >= 0) cleanText = cleanText.substring(idx + marker.length).trim();
          }
          if (cleanText) return cleanText;
        }
      }
    }
    return '';
  }

  getUploadLimits() { return getLimits('kimi'); }
}

