import type { Attachment } from '../../shared/types';

export interface SiteAdapter {
  fillAndSend(question: string, attachments: Attachment[]): Promise<void>;
  uploadFiles(files: Attachment[]): Promise<string[]>;
  isGenerating(): Promise<boolean>;
  readResponse(): Promise<string>;
  getUploadLimits(): { maxFiles: number; maxSizeMB: number; supportedTypes: string[] };
}

export type { Attachment };
