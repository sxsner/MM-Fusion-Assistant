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
    const tid = crypto.randomUUID();
    logger.info('MINIMAX', tid, `等待输入元素: ${SEL_TEXTAREA}`);
    const input = await waitForInput(SEL_TEXTAREA) as HTMLElement;
    logger.info('MINIMAX', tid, '输入元素已找到');
    let text = question;
    if (attachments.length > 0) {
      logger.info('MINIMAX', tid, `处理 ${attachments.length} 个附件`);
      const uploaded = await this.uploadFiles(attachments);
      if (uploaded.length === 0) {
        logger.info('MINIMAX', tid, '文件上传失败，嵌入文本内容');
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
    logger.info('MINIMAX', tid, '文本已填充');
    await new Promise((r) => setTimeout(r, 1000));
    try {
      logger.info('MINIMAX', tid, '等待发送按钮');
      await waitAndClick(SEL_SEND);
      logger.info('MINIMAX', tid, '发送按钮已点击');
    } catch {
      logger.info('MINIMAX', tid, '发送按钮不可用，使用 Enter 键');
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
    const items = document.querySelectorAll<HTMLElement>('[data-testid="message-item"]');
    for (let i = items.length - 1; i >= 0; i--) {
      const activeFlow = items[i].querySelector<HTMLElement>('[data-testid="assistant-active-flow"]');
      if (!activeFlow) continue;
      const clone = activeFlow.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-testid="message-actions"], [class*="message-actions"]').forEach((el) => el.remove());
      const mk = clone.querySelectorAll<HTMLElement>('.matrix-markdown, [class*="matrix-markdown"]');
      if (mk.length === 0) continue;
      const texts: string[] = [];
      for (let j = 0; j < mk.length; j++) {
        const t = mk[j].textContent?.replace(/\s+/g, ' ').trim();
        if (t) texts.push(t);
      }
      const joined = texts.join('\n').trim();
      if (joined && joined.length > 10) { logger.info('MINIMAX', 'read', `回复 ${joined.length} 字`); return joined; }
    }
    return '';
  }

  getUploadLimits() { return getLimits('minimax'); }
}

