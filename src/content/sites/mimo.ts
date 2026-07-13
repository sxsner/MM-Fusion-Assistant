import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { setContentEditableValue, setInputValue, waitForInput } from './adapter-utils';

export class MiMoAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    if (document.body.dataset.startNew === 'true') {
      const newChatBtn = document.querySelector<HTMLElement>('[class*="new"], [class*="start"], a[href*="/c"], button[aria-label*="new"], [data-testid*="new"]');
      if (newChatBtn) newChatBtn.click();
    }
    const input = await waitForInput('textarea, [contenteditable="true"]') as HTMLElement;
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, question);
    } else {
      setContentEditableValue(input, question);
    }
    if (attachments.length > 0) await this.uploadFiles(attachments);
    await new Promise((r) => setTimeout(r, 1000));
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const btn = document.querySelector<HTMLElement>('button[aria-label*="发送"], button[aria-label*="send"], button[type="submit"], button[class*="send"]');
      if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    (input as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) return [];
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector<HTMLElement>('button[aria-label*="stop"], button[aria-label*="停止"], [aria-busy="true"]');
  }

  async readResponse(): Promise<string> {
    const PREFIX_MARKER = '在保证正确性的前提下';
    const all = document.querySelectorAll<HTMLElement>('.markdown-prose, [class*="Markdown_markdown"]');
    for (let i = all.length - 1; i >= 0; i--) {
      const clone = all[i].cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-state], [class*="Collapsible"], [class*="think"], [class*="reason"], summary').forEach((el) => el.remove());
      const text = clone.textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 5 && !text.includes(PREFIX_MARKER)) return text;
    }
    const fallback = document.querySelectorAll<HTMLElement>('[class*="message"], [class*="assistant"], .markdown-body');
    for (let i = fallback.length - 1; i >= 0; i--) {
      const text = fallback[i].textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 5 && !text.includes(PREFIX_MARKER)) return text;
    }
    return '';
  }

  getUploadLimits() { return getLimits('mimo'); }
}
