import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { setContentEditableValue, waitForEnabled } from './adapter-utils';

export class ChatGPTAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = document.querySelector<HTMLElement>('div[contenteditable="true"]#prompt-textarea')
      ?? document.querySelector<HTMLElement>('#prompt-textarea');
    if (!input) {
      throw new Error('UI element not found: chatgpt');
    }

    setContentEditableValue(input, question);

    if (attachments.length > 0) {
      await this.uploadFiles(attachments);
    }

    await new Promise((r) => setTimeout(r, 1000));
    const sendBtn = await waitForEnabled([
      '#composer-submit-button',
      '[data-testid="send-button"]',
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
    ]).catch(() => null);
    if (!sendBtn) {
      throw new Error('UI element not found: chatgpt');
    }
    sendBtn.click();
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    let fileInput = document.querySelector<HTMLInputElement>('input#upload-files, input[type="file"]');
    if (!fileInput) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null,
      );
      let currentNode: Node | null;
      while ((currentNode = walker.nextNode()) !== null) {
        const el = currentNode as Element;
        if (el.shadowRoot) {
          const found = el.shadowRoot.querySelector<HTMLInputElement>('input[type="file"]');
          if (found) { fileInput = found; break; }
        }
      }
    }
    if (!fileInput) {
      return [];
    }
    const dt = new DataTransfer();
    for (const f of files) {
      dt.items.add(FileUploadHelpers.attachmentToFile(f));
    }
    await FileUploadHelpers.injectToFileInput(fileInput, Array.from(dt.files));
    return files.map((f) => f.id);
  }

  async isGenerating(): Promise<boolean> {
    const sendBtn = document.querySelector<HTMLElement>('#composer-submit-button, [data-testid="send-button"]');
    if (sendBtn) {
      const ariaLabel = sendBtn.getAttribute('aria-label') || '';
      if (ariaLabel.includes('stop') || ariaLabel.includes('停止')) return true;
    }
    if (document.querySelector<HTMLElement>('.result-streaming, [aria-busy="true"]')) {
      return true;
    }
    const hasChatGptUI = document.querySelector<HTMLElement>('div[contenteditable="true"]#prompt-textarea, #prompt-textarea');
    if (!hasChatGptUI) {
      throw new Error('UI element not found: chatgpt');
    }
    return false;
  }

  async readResponse(): Promise<string> {
    const containers = document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]');
    if (containers.length > 0) {
      return containers[containers.length - 1].textContent?.replace(/\s+/g, ' ').trim() || '';
    }
    return '';
  }

  getUploadLimits() {
    return {
      maxFiles: 5,
      maxSizeMB: 512,
      supportedTypes: ['pdf', 'docx', 'xlsx', 'png', 'jpg'],
    };
  }
}
