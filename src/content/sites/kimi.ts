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
    const tid = crypto.randomUUID();
    logger.info('KIMI', tid, `等待输入元素: ${SEL_TEXTAREA}`);
    const input = await waitForInput(SEL_TEXTAREA) as HTMLElement;
    logger.info('KIMI', tid, '输入元素已找到');
    let text = question;
    if (attachments.length > 0) {
      logger.info('KIMI', tid, `处理 ${attachments.length} 个附件`);
      const uploaded = await this.uploadFiles(attachments);
      if (uploaded.length === 0) {
        logger.info('KIMI', tid, '文件上传失败，嵌入文本内容');
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
    logger.info('KIMI', tid, '文本已填充');
    await new Promise((r) => setTimeout(r, 1000));
    try {
      logger.info('KIMI', tid, '等待发送按钮');
      await waitAndClick(SEL_SEND);
      logger.info('KIMI', tid, '发送按钮已点击');
    } catch {
      logger.info('KIMI', tid, '发送按钮不可用，使用 Enter 键');
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
    const THINKING_SEL = '[class*="thinking-container"], [class*="toolcall-container"], [class*="think"], [class*="reason"]';
    const pickFirst = (els: NodeListOf<HTMLElement>, label: string): string => {
      for (let i = els.length - 1; i >= 0; i--) {
        const clone = els[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll(THINKING_SEL).forEach((el) => el.remove());
        const text = clone.textContent?.replace(/\s+/g, ' ').trim();
        if (text && text.length > 5) { logger.info('KIMI', 'read', `回复 ${text.length} 字 (${label})`); return text; }
      }
      return '';
    };
    let r = pickFirst(document.querySelectorAll<HTMLElement>('.segment-assistant .markdown-container .markdown, .segment-assistant .markdown-body, .segment-assistant [class*="message-content"] .markdown'), '主选择器');
    if (r) return r;
    const assistantSelectors: [string, string][] = [['.segment-assistant', 'segment-assistant'], ['[class*="assistant"]', 'assistant'], ['[class*="message-content"]', 'message-content'], ['[class*="chat-content"] [class*="content"]', 'chat-content']];
    for (const [sel, label] of assistantSelectors) {
      r = pickFirst(document.querySelectorAll<HTMLElement>(sel), label);
      if (r) return r;
    }
    return '';
  }

  getUploadLimits() { return getLimits('kimi'); }
}

