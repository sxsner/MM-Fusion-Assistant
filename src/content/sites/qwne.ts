import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { getLimits } from './uploadLimits';
import { waitForInput, setInputValue } from './adapter-utils';
import { logger } from '../../shared/logger';

const SEL_INPUT = 'div[role="textbox"][data-slate-editor="true"], textarea.message-input-textarea';
const SEL_SEND = 'button[aria-label="发送消息"], .message-input-right-button-send';
const SEL_STOP = 'button[aria-label="停止回答"], button.send-button:disabled';

function clickButton(btn: HTMLElement): void {
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

export class QwneAdapter implements SiteAdapter {
  private qwneStart = 0;
  private qwneContent = '';

  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const tid = crypto.randomUUID();
    this.qwneStart = Date.now();
    this.qwneContent = '';
    logger.info('QWNE', tid, `等待输入元素: ${SEL_INPUT}`);
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    const input = (await waitForInput(SEL_INPUT)) as HTMLElement;
    logger.info('QWNE', tid, `输入元素已找到: ${input.tagName}`);
    await new Promise((r) => setTimeout(r, 500));
    const isTextarea = input.tagName === 'TEXTAREA';
    if (isTextarea) {
      logger.info('QWNE', tid, '使用 setInputValue 填充文本');
      setInputValue(input as HTMLTextAreaElement, question);
    } else {
      logger.info('QWNE', tid, '使用 slateFill 填充文本');
      await this.slateFill(input, question);
    }
    if (attachments.length > 0) {
      logger.info('QWNE', tid, `上传 ${attachments.length} 个附件`);
      await this.uploadFiles(attachments);
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      const sendBtn = document.querySelector<HTMLElement>(SEL_SEND);
      if (sendBtn && !sendBtn.hasAttribute('disabled') && sendBtn.getAttribute('aria-disabled') !== 'true') {
        logger.info('QWNE', tid, `发送按钮已就绪: ${sendBtn.className.slice(0,40)}`);
        if (sendBtn.classList.contains('message-input-right-button-send')) {
          const targetBtn = sendBtn.querySelector<HTMLElement>('button.send-button, .chat-prompt-send-button, .omni-button-content-btn');
          if (targetBtn && targetBtn.style.opacity !== '0') {
            const btn = targetBtn.tagName === 'BUTTON' ? targetBtn : targetBtn.querySelector('button');
            if (btn) { logger.info('QWNE', tid, '点击发送按钮'); clickButton(btn); return; }
            logger.info('QWNE', tid, '点击目标按钮(非button)'); clickButton(targetBtn); return;
          }
        } else {
          logger.info('QWNE', tid, '点击button发送按钮'); clickButton(sendBtn);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    logger.info('QWNE', tid, '发送按钮未就绪，使用 Enter 键发送');
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
    let fileInput = document.querySelector<HTMLInputElement>('input#filesUpload');
    if (!fileInput) {
      const uploadBtn = document.querySelector<HTMLElement>('[class*="upload"], [class*="attach"], button[aria-label*="上传"]');
      if (uploadBtn) {
        uploadBtn.click();
        await new Promise((r) => setTimeout(r, 1000));
        fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      }
    }
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
    if (this.qwneStart === 0) return '';
    const Q_PREFIX = '在保证正确性的前提下';
    const pickLast = (sel: string, minLen = 10, clsFilter?: string): string => {
      const els = document.querySelectorAll<HTMLElement>(sel);
      for (let i = els.length - 1; i >= 0; i--) {
        const clone = els[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.reference-wrap-iEjeb3, [class*="reference-wrap"], .qwen-markdown-citation, [class*="markdown-citation"]').forEach((el) => el.remove());
        let text = '';
        if (!clsFilter || els[i].classList.contains(clsFilter)) {
          if (clsFilter === 'qwen-markdown') {
            const texts: string[] = [];
            clone.querySelectorAll('.qwen-markdown-text').forEach((el) => {
              const t = el.textContent?.trim();
              if (t) texts.push(t);
            });
            text = texts.join(' ').replace(/\s+/g, ' ').trim();
          } else {
            text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
          }
          if (text && text.length > minLen && !text.includes(Q_PREFIX)) return text;
        }
      }
      return '';
    };
    let best = pickLast('.qwen-markdown', 10, 'qwen-markdown');
    if (!best) best = pickLast('.response-message-content, .phase-answer', 10);
    if (!best) best = pickLast('div[class*="message-select-wrapper-answer"], [class*="chat-conversation"] [class*="content"], [class*="answer-content"], [class*="message-content"]', 50);
    if (!best) {
      const fallbacks = document.querySelectorAll<HTMLElement>('[class*="chat-conversation"] > div:last-child [class*="content"], [class*="answer"], [class*="message"]:not([class*="input"]):not([class*="send"])');
      for (let i = fallbacks.length - 1; i >= 0; i--) {
        const t = fallbacks[i].textContent?.replace(/\s+/g, ' ').trim();
        if (t && t.length > 50 && !t.includes(Q_PREFIX)) { best = t; break; }
      }
    }
    if (best && best !== this.qwneContent) logger.info('QWNE', 'read', `新内容 ${best.length} 字`);
    if (best) this.qwneContent = best;
    return this.qwneContent;
  }

  getUploadLimits() { return getLimits('qwne'); }
}

