import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForElement, waitForInput, setInputValue } from './adapter-utils';

const SEL_TEXTAREA = 'textarea#chat-input';
const SEL_STOP = ['.thinking-pulse', 'button:has(svg[class*="stop"])', '#send-message-button:disabled'];

export class GLMAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const tid = crypto.randomUUID();
    logger.info('GLM', tid, `等待输入元素: ${SEL_TEXTAREA}`);
    const input = await waitForInput(SEL_TEXTAREA) as HTMLTextAreaElement;
    logger.info('GLM', tid, '输入元素已找到');

    const doSend = async (): Promise<boolean> => {
      setInputValue(input, question);
      logger.info('GLM', tid, '文本已填充');
      await new Promise((r) => setTimeout(r, 1000));
      if (attachments.length > 0) { logger.info('GLM', tid, `上传 ${attachments.length} 个附件`); await this.uploadFiles(attachments); }
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const btn = document.querySelector<HTMLElement>('button#send-message-button');
        if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
          logger.info('GLM', tid, '点击发送按钮');
          const form = btn.closest('form');
          if (form) { form.requestSubmit(btn); } else { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
          return true;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      logger.info('GLM', tid, '发送按钮未就绪');
      return false;
    };

    if (await doSend()) {
      await new Promise((r) => setTimeout(r, 2000));
      for (const btn of document.querySelectorAll<HTMLElement>('button')) {
        if (btn.textContent?.includes('切换到')) {
          logger.info('GLM', tid, '检测到"切换到"按钮，点击后重新发送');
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
    const THINK_SEL = '[class*="thinking-chain"], [class*="thinking"], [class*="bugqhi"]';
    const Q_PREFIX = '在保证正确性的前提下';
    const containers = document.querySelectorAll<HTMLElement>('.markdown-prose, .chat-assistant');
    for (let i = containers.length - 1; i >= 0; i--) {
      const clone = containers[i].cloneNode(true) as HTMLElement;
      clone.querySelectorAll(THINK_SEL).forEach((el) => el.remove());
      const paras = clone.querySelectorAll<HTMLElement>('p[class^="svelte-"]');
      if (paras.length > 0) {
        const texts: string[] = [];
        for (const p of paras) {
          const t = p.textContent?.replace(/\s+/g, ' ').trim();
          if (t && !t.includes(Q_PREFIX)) texts.push(t);
        }
        const joined = texts.join('\n').trim();
        if (joined && joined.length > 5) { logger.info('GLM', 'read', `回复 ${joined.length} 字 (p标签)`); return joined; }
      }
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 5 && !text.includes(Q_PREFIX)) { logger.info('GLM', 'read', `回复 ${text.length} 字 (清理后)`); return text; }
    }
    return '';
  }

  getUploadLimits() { return getLimits('glm'); }
}
