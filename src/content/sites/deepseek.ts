import type { SiteAdapter } from './types';
import type { Attachment } from '../../shared/types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { waitForInput } from './adapter-utils';
import { getLimits } from './uploadLimits';

function findFileInput(): HTMLInputElement | null {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]');
  let input: HTMLInputElement | null = null;
  if (textarea) {
    input = textarea.closest('form, [class*="search"], [class*="chat"], [class*="input-container"], [class*="editor"]')?.querySelector('input[type="file"]') || null;
  }
  if (!input) input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input) return input;
  // Search shadow DOMs via TreeWalker (ChatGPT-style)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const el = node as Element;
    if (el.shadowRoot) {
      const found = el.shadowRoot.querySelector<HTMLInputElement>('input[type="file"]');
      if (found) return found;
    }
  }
  return null;
}

function getChatContainer(): HTMLElement | null {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]');
  if (!textarea) return null;
  return textarea.closest<HTMLElement>('form, [class*="search"], [class*="chat"], [class*="input-container"], [class*="editor"]');
}

function isSendButtonActive(): boolean {
  return !!document.querySelector('._52c986b:not(.ds-button--disabled), .ds-button--primary.ds-button--filled.ds-button--circle:not(.ds-button--disabled)');
}

function setTextareaValue(textarea: HTMLTextAreaElement, content: string): void {
  textarea.focus();
  textarea.value = content;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

async function waitForSendButton(timeout = 10000): Promise<HTMLElement> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const btn = document.querySelector<HTMLElement>('._52c986b:not(.ds-button--disabled), .ds-button--primary.ds-button--filled.ds-button--circle:not(.ds-button--disabled)');
    if (btn) return btn;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('发送按钮不可用');
}

export class DeepSeekAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const textareaEl = await waitForInput('textarea[name="search"]');
    if (!(textareaEl instanceof HTMLTextAreaElement)) throw new Error('未找到有效的文本输入框');
    const textarea = textareaEl as HTMLTextAreaElement;

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

    if (text) {
      setTextareaValue(textarea, text);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const sendBtn = await waitForSendButton();
    const tid2 = crypto.randomUUID();
    logger.info('DEEP', tid2, `准备点击发送按钮 text长度=${text.length}`);
    (sendBtn as HTMLElement).click();
    logger.info('DEEP', tid2, `发送按钮已点击`);
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const tid = crypto.randomUUID();
    const fileObjs = files.map((f) => FileUploadHelpers.attachmentToFile(f));
    logger.info('DEEP', tid, `文件上传: ${fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ')}`);

    // Strategy 1: injectToFileInput on hidden file input (standard React)
    const input = findFileInput();
    if (input) {
      FileUploadHelpers.injectToFileInput(input, fileObjs);
      await new Promise((r) => setTimeout(r, 3000));
      if (isSendButtonActive()) {
        logger.info('DEEP', tid, 'Strategy 1 成功: injectToFileInput');
        return files.map((f) => f.id);
      }
    }

    // Strategy 2: simulate drop events on the chat container (drag-and-drop support)
    logger.info('DEEP', tid, 'Strategy 1 失败，尝试 Strategy 2: drop on container');
    const container = getChatContainer();
    if (container) {
      const dt = new DataTransfer();
      fileObjs.forEach(f => dt.items.add(f));
      container.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      container.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      container.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 3000));
      if (isSendButtonActive()) {
        logger.info('DEEP', tid, 'Strategy 2 成功: drop on container');
        return files.map((f) => f.id);
      }
    }

    logger.warn('DEEP', tid, '所有策略失败，返回空结果');
    return [];
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector('[role="button"][class*="stop"], .ds-icon-stop');
  }

  private cleanText(text: string): string {
    return text
      // Remove reference markers like "-37" or "- 37" at line boundaries
      .replace(/-\s*\n+\s*\d+\s*/g, '')
      // Remove standalone reference lines like just "37" on its own
      .replace(/\n\s*\d+\s*\n/g, '\n')
      // Collapse multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async readResponse(): Promise<string> {
    const marks = document.querySelectorAll('.ds-markdown, .ds-message-content');
    if (marks.length > 0) {
      for (let i = marks.length - 1; i >= 0; i--) {
        const el = marks[i] as HTMLElement;
        if (el.closest('.ds-think-content')) continue;
        const text = el.innerText || '';
        if (text.trim()) return this.cleanText(text);
      }
    }
    return '';
  }

  getUploadLimits() { return getLimits('deepseek'); }
}

