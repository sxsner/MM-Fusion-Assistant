import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForElement, waitForInput } from './adapter-utils';

const SEL_INPUT = 'div[role="textbox"][data-slate-editor="true"]';
const SEL_SEND = 'button[aria-label="发送消息"]';
const SEL_STOP = 'button[aria-label="停止回答"]';
const SEL_ANSWER = 'div[class*="message-select-wrapper-answer"]';

function clickButton(btn: HTMLButtonElement): void {
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

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
    await this.slateFill(input, question);
    if (attachments.length > 0) await this.uploadFiles(attachments);
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    let sendBtn: HTMLButtonElement | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      sendBtn = document.querySelector<HTMLButtonElement>(SEL_SEND);
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
        clickButton(sendBtn);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  private async slateFill(el: HTMLElement, text: string): Promise<void> {
    el.focus();
    await new Promise((r) => setTimeout(r, 200));
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    }));
    await new Promise((r) => setTimeout(r, 500));
    let contentAfter = el.textContent?.trim() || '';
    if (!contentAfter.includes(text.slice(0, 20))) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      }
      document.execCommand('delete', false);
      await new Promise((r) => setTimeout(r, 100));
      document.execCommand('insertText', false, text);
      await new Promise((r) => setTimeout(r, 500));
      contentAfter = el.textContent?.trim() || '';
    }
    if (!contentAfter.includes(text.slice(0, 20))) {
      const textSpan = el.querySelector('[data-slate-string]');
      if (textSpan) {
        textSpan.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else {
        const p = el.querySelector('p');
        if (p) { p.textContent = text; } else { el.textContent = text; }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
        const clone = container.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.reference-wrap-iEjeb3, [class*="reference-wrap"]').forEach((el) => el.remove());
        const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) this.qwneContent = text;
      }
      this.qwneLastCapture = now;
    }
    return this.qwneContent;
  }

  getUploadLimits() { return getLimits('qwne'); }
}

