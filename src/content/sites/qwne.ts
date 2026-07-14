import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForElement, waitForInput, setContentEditableValue } from './adapter-utils';

const SEL_INPUT = '[data-slate-editor="true"]';
const SEL_STOP = 'button[aria-label="停止回答"]';
const SEL_ANSWER = 'div[class*="message-select-wrapper-answer"]';


export class QwneAdapter implements SiteAdapter {
  private qwneStart = 0;
  private qwneContent = '';
  private qwneLastCapture = 0;

  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    this.qwneStart = Date.now();
    this.qwneContent = '';
    this.qwneLastCapture = 0;
    await waitForElement('[data-chat-input-body]');
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    const input = (await waitForInput(SEL_INPUT)) as HTMLElement;
    await new Promise((r) => setTimeout(r, 500));
    setContentEditableValue(input, question);
    if (attachments.length > 0) await this.uploadFiles(attachments);
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    const sendBtn = document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    if (sendBtn) {
      sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
    const retryBtn = document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    if (retryBtn) {
      retryBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const fileInput = document.querySelector<HTMLInputElement>('input#filesUpload');
    if (!fileInput) return [];
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector<HTMLElement>(SEL_STOP);
  }

  async readResponse(): Promise<string> {
    const now = Date.now();
    if (this.qwneStart === 0) return '';

    if (now - this.qwneLastCapture >= 5000) {
      const container = document.querySelector<HTMLElement>(SEL_ANSWER);
      if (container) {
        const text = container.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (text) this.qwneContent = text;
      }
      this.qwneLastCapture = now;
    }

    return this.qwneContent;
  }

  getUploadLimits() { return getLimits('qwne'); }
}

