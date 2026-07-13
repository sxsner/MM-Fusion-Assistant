export interface ApiError {
  code: string;
  message: string;
  detail?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  trace_id: string;
}

export function success<T>(data: T, traceId: string): ApiResponse<T> {
  return { success: true, data, error: null, trace_id: traceId };
}

import { sanitize } from './logger';

export function failure(code: string, message: string, traceId: string, detail?: string): ApiResponse<never> {
  return {
    success: false,
    data: null,
    error: { code, message: sanitize(message), detail: detail ? sanitize(detail) : undefined },
    trace_id: traceId,
  };
}
