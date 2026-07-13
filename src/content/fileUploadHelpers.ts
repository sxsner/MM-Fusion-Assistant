import { logger } from '../shared/logger';

export class FileUploadHelpers {
  static attachmentToFile(attachment: { data: string; name: string; type: string }): File {
    const parts = attachment.data.split(',');
    const raw = parts.length > 1 ? parts[1] : attachment.data;
    const byteString = atob(raw);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: attachment.type });
    return new File([blob], attachment.name, { type: attachment.type });
  }

  static createFile(name: string, type: string, size: number): File { // [BUG-FIX] WG89 - 去除虚假 async（体内无 await）
    const blob = new Blob([new Uint8Array(size)], { type });
    return new File([blob], name, { type, lastModified: Date.now() });
  }

  static simulateDragAndDrop(fileInput: HTMLInputElement, files: File[]): void { // [BUG-FIX] WG89 - 去除虚假 async（体内无 await）
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));

    fileInput.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    fileInput.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
    fileInput.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }

  static injectToFileInput(fileInput: HTMLInputElement, files: File[]): void {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));

    // Direct assignment works better with React than Object.defineProperty
    fileInput.files = dt.files;

    // Dispatch change event for React
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  static async uploadFiles(fileInput: HTMLInputElement, files: File[]): Promise<void> {
    try {
      await this.injectToFileInput(fileInput, files);
    } catch (err) {
      logger.warn('CONTENT', crypto.randomUUID(), 'injectToFileInput failed, fallback to simulateDragAndDrop: ' + err);
      await this.simulateDragAndDrop(fileInput, files);
    }
  }
}
