import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForInput, waitAndClick, setContentEditableValue } from './adapter-utils';

const SEL_TEXTAREA = '[contenteditable="true"]';
const SEL_SEND = ['[data-testid="send-button"]'];
const SEL_STOP = ['.streaming-cursor', '.streaming-content'];

export class MiniMaxAdapter implements SiteAdapter {
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
    logger.info('MINIMAX', tid, `文件上传: ${fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ')}`);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) {
      logger.warn('MINIMAX', tid, `未找�?<input type="file">`);
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    await new Promise((r) => setTimeout(r, 2000));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    for (const sel of SEL_STOP) {
      if (document.querySelector<HTMLElement>(sel)) return true;
    }
    return false;
  }

  async readResponse(): Promise<string> {
    const skipWords = ['思考', '抓取', '搜索', '在保证正确性的前提下'];
    const valid = (text: string) => text && text.length > 10 && !skipWords.some(w => text.includes(w));
    const mk = document.querySelectorAll<HTMLElement>('.matrix-markdown, [class*="matrix-markdown"]');
    for (let i = mk.length - 1; i >= 0; i--) {
      const text = mk[i].textContent?.replace(/\s+/g, ' ').trim() || '';
      if (valid(text)) return text;
    }
    const containers = document.querySelectorAll<HTMLElement>('[data-testid="mavis-home-content"] .matrix-markdown, [data-testid="mavis-home-content"] [class*="message"], .message-content');
    for (let i = containers.length - 1; i >= 0; i--) {
      const text = containers[i].textContent?.replace(/\s+/g, ' ').trim() || '';
      if (valid(text)) return text;
    }
    return '';
  }

  getUploadLimits() { return getLimits('minimax'); }
}

