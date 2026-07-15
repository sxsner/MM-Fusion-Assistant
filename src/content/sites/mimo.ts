import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { setContentEditableValue, setInputValue, waitForInput } from './adapter-utils';
import { logger } from '../../shared/logger';

export class MiMoAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const tid = crypto.randomUUID();
    logger.info('MIMO', tid, '开始填充');
    const input = await waitForInput('textarea, [contenteditable="true"]') as HTMLElement;
    logger.info('MIMO', tid, `输入元素已找到: ${input.tagName}`);
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, question);
    } else {
      setContentEditableValue(input, question);
    }
    logger.info('MIMO', tid, '文本已填充');
    if (attachments.length > 0) { logger.info('MIMO', tid, `上传 ${attachments.length} 个附件`); await this.uploadFiles(attachments); }
    await new Promise((r) => setTimeout(r, 1000));
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const btn = document.querySelector<HTMLElement>('button[data-track-id="home_send_btn"], button[aria-label*="发送"], button[aria-label*="send"], button[type="submit"], button[class*="send"]');
      if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
        logger.info('MIMO', tid, '点击发送按钮');
        btn.click();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    logger.info('MIMO', tid, '发送按钮未就绪，使用 Enter 键');
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
    const prose = document.querySelectorAll<HTMLElement>('.markdown-prose, [class*="Markdown_markdown"]');
    for (let i = prose.length - 1; i >= 0; i--) {
      const clone = prose[i].cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[class*="Collapsible"], [class*="think"], [class*="reason"], summary, [data-state], .group\\/clip, [class*="message-actions"]').forEach((el) => el.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 50) { logger.info('MIMO', 'read', `回复 ${text.length} 字`); return text; }
    }
    return '';
  }

  getUploadLimits() { return getLimits('mimo'); }
}
