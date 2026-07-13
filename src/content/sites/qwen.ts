import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForElement, waitForInput, setInputValue } from './adapter-utils';

const SEL_TEXTAREA = 'textarea.message-input-textarea';
const SEL_STOP = '[class*="stop"], [class*="pause"], [aria-label*="stop"], [aria-label*="停止"]';


export class QwenAdapter implements SiteAdapter {
  // Self-polling: capture full DOM every 5s, update stableContent every time
  private qwenStart = 0;
  private qwenContent = '';
  private qwenLastCapture = 0;

  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    this.qwenStart = Date.now();
    this.qwenContent = '';
    this.qwenLastCapture = 0;
    await waitForElement('.chat-messages, .sidebar, .chat-container');
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    const input = await waitForInput(`${SEL_TEXTAREA}, textarea[class*="input"], textarea[class*="textarea"], textarea[placeholder*="输入"], textarea[placeholder*="message"]`) as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 500));
    setInputValue(input as HTMLTextAreaElement, question);
    if (attachments.length > 0) await this.uploadFiles(attachments);
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    const sendBtn = document.querySelector<HTMLButtonElement>('button.send-button:not([disabled])');
    if (sendBtn) {
      sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
    const retryBtn = document.querySelector<HTMLButtonElement>('button.send-button:not([disabled])');
    if (retryBtn) {
      retryBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      retryBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
    (input as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    (input as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent('keyup', {
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
    if (this.qwenStart === 0) return '';

    if (now - this.qwenLastCapture >= 5000) {
      const texts: string[] = [];
      const textSpans = document.querySelectorAll<HTMLElement>('.qwen-markdown-text');
      if (textSpans.length > 0) {
        for (const s of textSpans) {
          const t = s.textContent?.replace(/\s+/g, ' ').trim();
          if (t) texts.push(t);
        }
        this.qwenContent = texts.join('\n');
      } else {
        const containers = document.querySelectorAll<HTMLElement>('.response-message-content .custom-qwen-markdown, .response-message-content .qwen-markdown');
        if (containers.length > 0) {
          this.qwenContent = containers[0].textContent?.replace(/\s+/g, ' ').trim() || '';
        }
      }
      this.qwenLastCapture = now;
    }

    return this.qwenContent;
  }

  getUploadLimits() { return getLimits('qwen'); }
}

