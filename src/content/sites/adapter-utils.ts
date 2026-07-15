export function readMainContent(containerSel: string, excludeSel?: string): string {
  const container = document.querySelector<HTMLElement>(containerSel);
  if (!container) return '';
  const clone = container.cloneNode(true) as HTMLElement;
  const alwaysExclude = 'script, style, link, meta, noscript, svg, [class*="iconfont"], [class*="splash"]';
  const combinedSel = excludeSel ? `${excludeSel}, ${alwaysExclude}` : alwaysExclude;
  clone.querySelectorAll(combinedSel).forEach((el) => el.remove());
  return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
}

export function waitForElement(selector: string, timeout = 15000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('超时: ' + selector)); }, timeout);
  });
}

/** Wait for element, then extra delay before using it */
let inputDelay = 2000;
let sendDelay = 1000;

export function setInputDelay(ms: number): void { inputDelay = ms; }
export function setSendDelay(ms: number): void { sendDelay = ms; }
/** Wait for the configured send interval (after typing, before clicking send) */
export async function waitSendInterval(): Promise<void> {
  await new Promise((r) => setTimeout(r, sendDelay));
}

export async function waitForInput(selector: string, timeout = 15000): Promise<Element> {
  const el = await waitForElement(selector, timeout);
  await new Promise((r) => setTimeout(r, inputDelay));
  return el;
}

export function setInputValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  input.focus();
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  // Some React versions need beforeinput + input chain
  input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setContentEditableValue(el: HTMLElement, text: string): void {
  try { el.focus(); } catch {}
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt, data: null,
    }));
  } catch {}
  if (!el.textContent?.includes(text.slice(0, 10))) {
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const sel = win.getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = doc.createRange();
        const firstBlock = el.querySelector('p, div') || el;
        range.selectNodeContents(firstBlock);
        range.collapse(false);
        sel.addRange(range);
      }
    } catch {}
    try { document.execCommand('insertText', false, text); } catch {}
    if (!el.textContent?.includes(text.slice(0, 10))) {
      const p = el.querySelector('p');
      if (p) { p.textContent = text; } else { el.textContent = text; }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

export async function waitForEnabled(selectors: string[], timeout = 10000): Promise<HTMLElement> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && !el.className.includes('disabled') && !el.className.includes('--disabled')) return el;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('未找到可用的发送按钮');
}

export async function waitAndClick(selectors: string[], timeout = 10000): Promise<void> {
  const btn = await waitForEnabled(selectors, timeout);
  if (btn.getAttribute('type') === 'submit') {
    const form = btn.closest('form');
    if (form) { form.requestSubmit(btn); return; }
  }
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Poll for send button to become enabled, click it, or fall back to Enter */
export async function pollSend(selector: string, input: HTMLElement, timeout = 10000): Promise<boolean> {
  await new Promise((r) => setTimeout(r, sendDelay));
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn = document.querySelector<HTMLElement>(selector);
    if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Fallback: Enter key
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
  }));
  return false;
}
