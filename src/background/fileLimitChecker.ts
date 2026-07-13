import type { ModelType } from '../shared/types';
import { getLimits, getAllLimits } from '../content/sites/uploadLimits';

const mimeToExt: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'video/x-msvideo': 'avi',
  'video/quicktime': 'mov',
};

export interface FileInfo {
  name: string;
  size: number;
  type: string;
}

export interface CheckResult {
  modelId: ModelType;
  canUpload: boolean;
  maxFiles: number;
  maxSizeMB: number;
  oversizedFiles: FileInfo[];
  unsupportedFiles: FileInfo[];
  skippedReason?: string;
}

function getExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (mimeToExt[lower]) return mimeToExt[lower];
  const match = lower.match(/\/(\w+)$/);
  return match ? match[1] : lower;
}

export class FileLimitChecker {
  checkModel(modelId: ModelType, files: FileInfo[]): CheckResult {
    const limits = getLimits(modelId);
    const oversizedFiles: FileInfo[] = [];
    const unsupportedFiles: FileInfo[] = [];
    const maxSizeBytes = limits.maxSizeMB * 1024 * 1024;

    for (const file of files) {
      if (file.size > maxSizeBytes) {
        oversizedFiles.push(file);
      }
      const ext = getExtension(file.type);
      if (!limits.supportedTypes.includes(ext)) {
        unsupportedFiles.push(file);
      }
    }

    const canUpload =
      files.length <= limits.maxFiles &&
      oversizedFiles.length === 0 &&
      unsupportedFiles.length === 0;

    return {
      modelId,
      canUpload,
      maxFiles: limits.maxFiles,
      maxSizeMB: limits.maxSizeMB,
      oversizedFiles,
      unsupportedFiles,
    };
  }

  checkAll(files: FileInfo[]): Record<ModelType, CheckResult> {
    const allLimits = getAllLimits();
    const result = {} as Record<ModelType, CheckResult>;
    for (const modelId of Object.keys(allLimits) as ModelType[]) {
      result[modelId] = this.checkModel(modelId, files);
    }
    return result;
  }

  getPassingModels(files: FileInfo[]): ModelType[] {
    const all = this.checkAll(files);
    return (Object.keys(all) as ModelType[]).filter((m) => all[m].canUpload);
  }

  getSkippedModels(files: FileInfo[]): ModelType[] {
    const all = this.checkAll(files);
    return (Object.keys(all) as ModelType[]).filter((m) => !all[m].canUpload);
  }
}
