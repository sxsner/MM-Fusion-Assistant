const RELAY_INIT_KEY = '__omnicast_console_relay_inited';

export function initConsoleRelay(): void {
  if ((console as unknown as Record<string, unknown>)[RELAY_INIT_KEY]) return;
  (console as unknown as Record<string, unknown>)[RELAY_INIT_KEY] = true;

  const _origLog = console.log;
  const _origWarn = console.warn;
  const _origError = console.error;

  console.log = (...args: unknown[]) => {
    _origLog.apply(console, args);
    chrome.runtime.sendMessage({
      channel: 'log:relay',
      payload: { level: 'INFO', msg: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') },
      trace_id: crypto.randomUUID(),
    }).catch(() => {});
  };
  console.warn = (...args: unknown[]) => {
    _origWarn.apply(console, args);
    chrome.runtime.sendMessage({
      channel: 'log:relay',
      payload: { level: 'WARN', msg: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') },
      trace_id: crypto.randomUUID(),
    }).catch(() => {});
  };
  console.error = (...args: unknown[]) => {
    _origError.apply(console, args);
    chrome.runtime.sendMessage({
      channel: 'log:relay',
      payload: { level: 'ERROR', msg: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') },
      trace_id: crypto.randomUUID(),
    }).catch(() => {});
  };
}
