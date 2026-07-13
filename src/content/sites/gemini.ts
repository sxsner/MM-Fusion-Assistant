import type { SiteAdapter } from './types';
import type { Attachment } from '../../shared/types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { waitForElement, waitForInput, setContentEditableValue } from './adapter-utils';

export class GeminiAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    await waitForElement('[data-test-id="overflow-container"], .chat-history, .sidebar');
    let prevUrl = '';
    let stableMs = 0;
    const waitDeadline = Date.now() + 10000;
    let hasOldConversation = false;
    while (Date.now() < waitDeadline) {
      const cur = window.location.pathname;
      const parts = cur.split('/').filter(Boolean);
      if (parts.length > 1) { hasOldConversation = true; break; }
      if (cur === prevUrl) {
        stableMs += 300;
        if (stableMs >= 3000) break;
      } else { stableMs = 0; }
      prevUrl = cur;
      await new Promise((r) => setTimeout(r, 300));
    }
    const startNew = document.body.dataset.startNew !== 'false';
    if (startNew && hasOldConversation) {
      window.location.href = '/app';
      await new Promise(() => {});
    }
    const editor = await waitForInput('div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"], [contenteditable="true"]');
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
    const editEl = editor as HTMLElement;
    setContentEditableValue(editEl, question);

    if (attachments.length > 0) {
      await this.uploadFiles(attachments);
    }

    await new Promise((r) => setTimeout(r, 2000));
    editEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    editEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const uploadBtn = document.querySelector<HTMLElement>(
      'gem-icon-button[aria-label*="上传"], button[aria-label*="上传"]'
    );
    if (uploadBtn) {
      uploadBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return [];
    const dt = new DataTransfer();
    for (const f of files) {
      dt.items.add(FileUploadHelpers.attachmentToFile(f));
    }
    await FileUploadHelpers.injectToFileInput(input, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return document.querySelector<HTMLElement>(
      'button[mat-icon-button].send-button.stop, ' +
      'gem-icon-button.send-button.stop'
    ) !== null;
  }

  async readResponse(): Promise<string> {
    const PREFIX_MARKER = '在保证正确性的前提下';
    const panels = document.querySelectorAll<HTMLElement>('.markdown-main-panel, message-content .markdown, structured-content-container.model-response-text .markdown');
    for (let i = panels.length - 1; i >= 0; i--) {
      const text = panels[i].textContent?.replace(/\s+/g, ' ').trim() || '';
      if (text && text.length > 5 && !text.includes(PREFIX_MARKER)) return text;
    }
    for (let i = panels.length - 1; i >= 0; i--) {
      const text = panels[i].textContent?.replace(/\s+/g, ' ').trim() || '';
      if (text && text.length > 5) return text;
    }
    return '';
  }

  getUploadLimits() {
    return { maxFiles: 10, maxSizeMB: 100, supportedTypes: ['png', 'jpg', 'pdf', 'docx', 'mp4'] };
  }
}



