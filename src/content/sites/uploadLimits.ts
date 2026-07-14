import { ModelType } from '../../shared/types';

export type ModelId = ModelType;

export interface UploadLimit {
  maxFiles: number;
  maxSizeMB: number;
  supportedTypes: string[];
  notes?: string;
}

const limits: Record<ModelId, UploadLimit> = {
  chatgpt: {
    maxFiles: 5,
    maxSizeMB: 512,
    supportedTypes: ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: 'Free: 5 files. Plus: 25 files. Pro: 40 files.',
  },
  claude: {
    maxFiles: 5,
    maxSizeMB: 30,
    supportedTypes: ['pdf', 'docx', 'txt', 'csv', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: 'Free: ~5 files. Pro: up to 20 files.',
  },
  gemini: {
    maxFiles: 10,
    maxSizeMB: 100,
    supportedTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'txt', 'csv', 'mp3', 'mp4', 'avi', 'mov'],
    notes: 'Supports images, documents, and audio/video.',
  },
  deepseek: {
    maxFiles: 3,
    maxSizeMB: 100,
    supportedTypes: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: 'Free: 3 files. Pro: 5 files.',
  },
  grok: {
    maxFiles: 1,
    maxSizeMB: 25,
    supportedTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: 'Primarily image uploads. Very limited file support.',
  },
  doubao: {
    maxFiles: 5,
    maxSizeMB: 100,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  glm: {
    maxFiles: 10,
    maxSizeMB: 50,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  qwnc: {
    maxFiles: 5,
    maxSizeMB: 100,
    supportedTypes: ['pdf', 'docx', 'xlsx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  hunyuan: {
    maxFiles: 5,
    maxSizeMB: 50,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  kimi: {
    maxFiles: 5,
    maxSizeMB: 100,
    supportedTypes: ['pdf', 'docx', 'xlsx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  minimax: {
    maxFiles: 5,
    maxSizeMB: 50,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  longcat: {
    maxFiles: 3,
    maxSizeMB: 30,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  stepfun: {
    maxFiles: 5,
    maxSizeMB: 50,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
  mimo: {
    maxFiles: 5,
    maxSizeMB: 30,
    supportedTypes: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    notes: '',
  },
};

export function getLimits(modelId: ModelId): UploadLimit {
  return limits[modelId];
}

export function getAllLimits(): Record<ModelId, UploadLimit> {
  return { ...limits };
}
