import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { waitForInput, waitForElement } from './adapter-utils';

export class ClaudeAdapter implements SiteAdapter {
  async fillAndSend(question: string, _attachments: Attachment[]): Promise<void> {
    if (document.body.dataset.startNew === 'true') {
      const newChatBtn = document.querySelector<HTMLElement>('a[href="/new"], button[aria-label*="New chat"], [data-testid="new-chat"]');
      if (newChatBtn) newChatBtn.click();
    }
    const input = await waitForInput('[data-testid="chat-input"], [contenteditable="true"]') as HTMLElement;
    input.focus();
    await chrome.runtime.sendMessage({ channel: 'claude:fill', payload: { text: question } });
    let sendBtn: HTMLElement | null = null;
    try {
      sendBtn = await waitForElement('button[aria-label="Send message"]:not([disabled]):not([data-trigger-disabled])', 15000) as HTMLElement;
    } catch { /* send button timeout */ }
    if (sendBtn) {
      sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      }));
    }
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) {
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    const stopBtn = document.querySelector<HTMLElement>(
      '[aria-label*="Stop"], [aria-label*="stop"], [aria-label*="停止"]',
    );
    if (stopBtn) return true;
    return false;
  }

  async readResponse(): Promise<string> {
    const allStreaming = document.querySelectorAll<HTMLElement>('[data-is-streaming="false"]');
    const lastStreaming = allStreaming[allStreaming.length - 1];
    if (lastStreaming) {
      const mark = lastStreaming.querySelector<HTMLElement>('.standard-markdown');
      if (mark) {
        const text = mark.textContent?.trim();
        if (text) return text;
      }
    }
    const lastMessage = document.querySelector<HTMLElement>('[data-last-message="true"]');
    if (lastMessage) {
      const mark = lastMessage.querySelector<HTMLElement>('.standard-markdown');
      if (mark) {
        const text = mark.textContent?.trim();
        if (text) return text;
      }
    }
    const allMarks = document.querySelectorAll<HTMLElement>('.standard-markdown');
    const last = allMarks[allMarks.length - 1];
    if (last) {
      const text = last.textContent?.trim();
      if (text) return text;
    }
    return '';
  }

  getUploadLimits() {
    return { maxFiles: 5, maxSizeMB: 30, supportedTypes: ['pdf', 'docx', 'txt', 'csv', 'png', 'jpg', 'jpeg', 'gif', 'webp'] };
  }
}

