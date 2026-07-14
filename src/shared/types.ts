export type ModelType = 'chatgpt' | 'claude' | 'gemini' | 'deepseek' | 'grok' | 'doubao' | 'glm' | 'qwne' | 'qwnc' | 'hunyuan' | 'kimi' | 'minimax' | 'longcat' | 'stepfun' | 'mimo';

export type TaskStatus =
  | 'pending'
  | 'distributing'
  | 'collecting'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'partial_timeout';

export type ModelResultStatus =
  | 'pending'
  | 'sending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
  compressed: boolean;
  originalSize?: number;
}

export interface ModelResult {
  modelId: ModelType;
  status: ModelResultStatus;
  content?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  tabId?: number;
  retryCount: number;
}

export interface SummaryResult {
  content: string;
  modelUsed: string;
  apiCall: boolean;
  completedAt: number;
}

export interface Task {
  id: string;
  question: string;
  attachments: Attachment[];
  targetModels: ModelType[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  timeoutMs: number;
  results: Partial<Record<ModelType, ModelResult>>;
  summaryResult?: SummaryResult;
  error?: string;
  conversationId?: string;
  pageTitle?: string;
  conversationUrls?: Partial<Record<string, string>>;
}

export interface SummaryConfig {
  provider: 'openai' | 'claude-api' | 'gemini-api' | 'custom';
  apiKey: string;
  apiEndpoint?: string;
  modelName?: string;
  promptTemplate: string;
  useWebOnly: boolean;
  timeoutMs: number;
}

export interface SummarySettings {
  mode: 'api' | 'web';
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  webModelId?: ModelType;
  bringModelToFront?: boolean;
}

export interface TaskSubmitMessage {
  channel: 'task:submit';
  payload: { text: string; timestamp: number; targetModels: ModelType[]; attachments?: Attachment[]; conversationUrls?: Partial<Record<string, string>>; conversationId?: string };
  trace_id: string;
}

export interface ModelScoreEntry {
  totalScore: number;
  count: number;
}

export interface SiteAdapter {
  fillAndSend(question: string, attachments: Attachment[]): Promise<void>;
  uploadFiles(files: Attachment[]): Promise<string[]>;
  isGenerating(): Promise<boolean>;
  readResponse(): Promise<string>;
  getUploadLimits(): { maxFiles: number; maxSizeMB: number; supportedTypes: string[] };
}
