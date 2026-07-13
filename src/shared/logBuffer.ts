import { logger } from './logger';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  traceId: string;
  message: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let listeners: Array<() => void> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function appendLog(level: LogLevel, module: string, traceId: string, message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString().slice(11, 23),
    level,
    module,
    traceId: traceId.slice(0, 8),
    message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  scheduleFlush();
  for (const fn of listeners) {
    try { fn(); } catch { logger.warn('LOGBUF', crypto.randomUUID(), 'listener invocation failed'); }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      const tail = entries.slice(-200);
      chrome.storage?.local?.set({ __log_tail: tail });  // [BUG-FIX] WG2-2 - 移除冗余内层.catch，外层try-catch已覆盖异常处理
    } catch { logger.warn('LOGBUF', crypto.randomUUID(), 'storage.set failed'); }
  }, 3000);
}

export async function loadPersistedLogs(): Promise<void> {
  try {
    const data = await chrome.storage?.local?.get('__log_tail');
    if (data?.__log_tail) {
      for (const e of data.__log_tail) entries.push(e);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    }
  } catch { logger.warn('LOGBUF', crypto.randomUUID(), 'initial load failed'); }
}

export function getLogs(): LogEntry[] {
  return entries;
}

export function onLog(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function clearLogs(): void {
  entries.length = 0;
  listeners.forEach((fn) => fn());
  try { chrome.storage?.local?.remove('__log_tail').catch(() => {}); } catch { logger.warn('LOGBUF', crypto.randomUUID(), 'storage.remove failed'); }
}
