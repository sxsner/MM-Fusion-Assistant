const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const currentLevel: LogLevel = 'DEBUG';

function timestamp(): string {
  const d = new Date();
  return d.toISOString().replace('T', ' ').slice(0, 23);
}

import { appendLog } from './logBuffer';

function log(level: LogLevel, module: string, traceId: string, message: string) {
  if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(currentLevel)) return;
  const line = `[${timestamp()}] [${level}] [${module}] [${traceId}] ${message}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  try { appendLog(level, module, traceId, message); } catch { console.warn('appendLog failed', module, traceId); }
  if (_relayFn) { try { _relayFn(level, module, traceId, message); } catch { console.warn('relay failed', module, traceId); } }
}

let _relayFn: ((level: LogLevel, module: string, traceId: string, message: string) => void) | null = null;

export function setLogRelay(fn: (level: LogLevel, module: string, traceId: string, message: string) => void): void {
  _relayFn = fn;
}

const SENSITIVE_PATTERNS: { regex: RegExp; replacement: string }[] = [
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-***' },
  { regex: /(api[_-]?key|apikey|token|password|secret)=[^&\s"]+/gi, replacement: '$1=***' },
  { regex: /"apiKey"\s*:\s*"[^"]+"/gi, replacement: '"apiKey":"***"' },
  { regex: /"token"\s*:\s*"[^"]+"/gi, replacement: '"token":"***"' },
  { regex: /Bearer\s+[a-zA-Z0-9._-]+/g, replacement: 'Bearer ***' },
];

export function sanitize(str: unknown): string {
  // [BUG-FIX] F4 - guard against null/undefined to prevent TypeError on .replace()
  if (str == null) return '';
  let result = String(str);
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export const logger = {
  debug: (mod: string, tid: string, msg: string) => log('DEBUG', mod, tid, sanitize(msg)),
  info: (mod: string, tid: string, msg: string) => log('INFO', mod, tid, sanitize(msg)),
  warn: (mod: string, tid: string, msg: string) => log('WARN', mod, tid, sanitize(msg)),
  error: (mod: string, tid: string, msg: string) => log('ERROR', mod, tid, sanitize(msg)),
};
