import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForElement, waitForInput, setInputValue } from './adapter-utils';

const SEL_TEXTAREA = 'textarea#chat-input';
const SEL_STOP = ['.thinking-pulse', '[class*="stop"]', '.svelte-1k62fay button:disabled'];

export class GLMAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput(SEL_TEXTAREA) as HTMLTextAreaElement;

    const doSend = async (): Promise<boolean> => {
      setInputValue(input, question);
      await new Promise((r) => setTimeout(r, 1000));
      if (attachments.length > 0) await this.uploadFiles(attachments);
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const btn = document.querySelector<HTMLElement>('button#send-message-button');
        if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
          const form = btn.closest('form');
          if (form) { form.requestSubmit(btn); } else { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
          return true;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    };

    if (await doSend()) {
      await new Promise((r) => setTimeout(r, 2000));
      for (const btn of document.querySelectorAll<HTMLElement>('button')) {
        if (btn.textContent?.includes('切换到')) {
          btn.click();
          await new Promise((r) => setTimeout(r, 2000));
          doSend();
          break;
        }
      }
    }
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const uploadBtn = document.querySelector<HTMLElement>('#upload-file-button');
    if (uploadBtn) {
      uploadBtn.click();
      try {
        const fileInput = await waitForElement('input[type="file"]', 5000) as HTMLInputElement;
        if (!fileInput) return [];
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(FileUploadHelpers.attachmentToFile(f));
        await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
        await new Promise((r) => setTimeout(r, 2000));
        return files.map((f) => f.id);
      } catch {
        logger.warn('GLM', crypto.randomUUID(), '动态文件输入未出现');
        return [];
      }
    }
    return [];
  }

  async isGenerating(): Promise<boolean> {
    for (const sel of SEL_STOP) {
      if (document.querySelector<HTMLElement>(sel)) return true;
    }
    return false;
  }

  async readResponse(): Promise<string> {
    const assistants = document.querySelectorAll<HTMLElement>('.chat-assistant');
    for (let i = assistants.length - 1; i >= 0; i--) {
      const paras = assistants[i].querySelectorAll<HTMLElement>('p[class^="svelte-"]');
      if (paras.length > 0) {
        const texts: string[] = [];
        for (const p of paras) texts.push(p.textContent?.replace(/\s+/g, ' ').trim() || '');
        const joined = texts.join('\n').trim();
        if (joined && joined.length > 5) return joined;
      }
    }
    for (let i = assistants.length - 1; i >= 0; i--) {
      const hasThinking = assistants[i].querySelector('[class*="bugqhi"], [class*="thinking"]');
      if (hasThinking) continue;
      const text = assistants[i].textContent?.replace(/\s+/g, ' ').trim() || '';
      if (text && text.length > 5) return text;
    }
    return '';
  }

  getUploadLimits() { return getLimits('glm'); }
}
