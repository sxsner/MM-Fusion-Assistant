import { MODEL_IDS } from './constants';
import type { ModelType, ModelResult, ModelResultStatus } from './types';

const MODEL_SET = new Set<string>(MODEL_IDS);

const VALID_STATUSES = new Set<ModelResultStatus>(['pending', 'sending', 'generating', 'completed', 'failed', 'timeout']);

export function isModelType(v: string): v is ModelType {
  return MODEL_SET.has(v);
}

export function isModelResult(v: unknown): v is ModelResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.modelId === 'string'
    && isModelType(r.modelId)
    && typeof r.status === 'string'
    && VALID_STATUSES.has(r.status as ModelResultStatus)
    && typeof r.startedAt === 'number';
}
