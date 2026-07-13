import type { SiteAdapter, Attachment } from './types';
import { FileUploadHelpers } from '../fileUploadHelpers';
import { logger } from '../../shared/logger';
import { getLimits } from './uploadLimits';
import { waitForInput, waitAndClick } from './adapter-utils';

const SEL_TEXTAREA = 'textarea.semi-input-textarea';
const SEL_SEND = ['.send-btn-wrapper button:not([disabled])', '[class*="send-btn"] button:not([disabled])'];
const SEL_STOP = '[class*="break-btn"], button[class*="stop"]';

function dbg(...args: unknown[]) { console.log('DOUBAO_DBG:', ...args); }
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function triggerRadixClick(el: HTMLElement): void {
  el.focus();
  const ptrInit: PointerEventInit = {
    bubbles: true, cancelable: true, composed: true,
    view: window, button: 0, buttons: 1,
    pointerId: 1, pointerType: 'mouse', isPrimary: true,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', ptrInit));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
  const ptrUp: PointerEventInit = { ...ptrInit, buttons: 0 };
  el.dispatchEvent(new PointerEvent('pointerup', ptrUp));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
}

function waitForPortalMenu(timeout = 2000): Promise<HTMLElement[]> {
  return new Promise((resolve) => {
    const existing = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [data-slot="dropdown-menu-item"]'));
    if (existing.length > 0) { resolve(existing); return; }
    const obs = new MutationObserver(() => {
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [data-slot="dropdown-menu-item"]'));
      if (items.length > 0) { obs.disconnect(); resolve(items); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve([]); }, timeout);
  });
}

function watchForFileInput(timeout = 5000): Promise<HTMLInputElement | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (existing) { resolve(existing); return; }
    const obs = new MutationObserver(() => {
      const inp = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (inp) { obs.disconnect(); resolve(inp); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
  });
}

function findReactFiber(el: HTMLElement): Record<string, unknown> | null {
  const reactKeys = Object.keys(el).filter(k => k.startsWith('__react'));
  if (reactKeys.length > 0) dbg('react keys on element:', reactKeys.join(', '));
  const key = reactKeys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$') || k.startsWith('__reactProps$'));
  if (!key) return null;
  return (el as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null;
}

function logAllKeys(el: HTMLElement): void {
  const allKeys = Object.keys(el);
  const specialKeys = allKeys.filter(k => k.startsWith('__') || k.startsWith('_react'));
  dbg('all special keys on element:', specialKeys.length > 0 ? specialKeys.join(', ') : 'NONE');
  if (specialKeys.length === 0) dbg('total keys:', allKeys.length);
}

function logAllKeysDeep(el: HTMLElement): void {
  let current: HTMLElement | null = el;
  for (let i = 0; i < 10 && current; i++) {
    const keys = Object.keys(current).filter(k => k.startsWith('__react'));
    if (keys.length > 0) {
      dbg(`react keys at level ${i} (${current.tagName}):`, keys.join(', '));
    }
    current = current.parentElement;
  }
}

function invokeReactOnClick(el: HTMLElement): boolean {
  const fiber = findReactFiber(el);
  if (!fiber) { dbg('no React fiber found'); return false }

  let current: Record<string, unknown> | null = fiber;
  for (let i = 0; i < 10 && current; i++) {
    const props = current.memoizedProps as Record<string, unknown> | undefined;
    if (props) {
      const onClick = props.onClick || props.onClickCapture;
      if (typeof onClick === 'function') {
        dbg('found onClick at fiber level', i);
        onClick({
          type: 'click', target: el, currentTarget: el,
          preventDefault: () => {}, stopPropagation: () => {},
          nativeEvent: new MouseEvent('click'), persist: () => {},
        });
        return true;
      }
    }
    current = current.return as Record<string, unknown> | null;
  }
  dbg('no onClick found in fiber chain');
  return false;
}

function triggerRadixClickReact(el: HTMLElement): boolean {
  el.focus();
  if (invokeReactOnClick(el)) return true;
  dbg('React fiber failed, using synthetic');
  triggerRadixClick(el);
  return false;
}

function findAllInputsDeep(root: ParentNode): HTMLInputElement[] {
  return Array.from((root as Document).querySelectorAll?.('input[type="file"]') || []);
}

function logButtonDetails(btn: HTMLElement, index: number): void {
  const text = btn.textContent?.trim()?.slice(0, 30) || '';
  const ariaLabel = btn.getAttribute('aria-label') || '';
  const title = btn.getAttribute('title') || '';
  const dataSlot = btn.getAttribute('data-slot') || '';
  const dataState = btn.getAttribute('data-state') || '';
  const hasPopup = btn.getAttribute('aria-haspopup') || '';
  const svgPaths = Array.from(btn.querySelectorAll('svg path')).map(p => p.getAttribute('d')?.slice(0, 30) || '').join(';');
  const innerHTML = btn.innerHTML?.slice(0, 100) || '';
  dbg(`  btn[${index}]: text="${text}" aria="${ariaLabel}" title="${title}" slot="${dataSlot}" state="${dataState}" hasPopup="${hasPopup}" svg="${svgPaths}" html="${innerHTML}"`);
}

// function exploreDOM(): void {
//   const textarea = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA);
//   dbg('textarea:', !!textarea);
//   const allInputs = document.querySelectorAll('input');
//   dbg('inputs:', allInputs.length);
// }

const PLUS_SVG_PATH = 'M12.0005';

function findPlusButton(): HTMLElement | null {
  const inputContainer = document.querySelector('#input-engine-container');
  if (!inputContainer) return null;
  const allButtons = Array.from(inputContainer.querySelectorAll<HTMLElement>('button'));
  for (const btn of allButtons) {
    const svgPath = btn.querySelector('svg path');
    if (svgPath) {
      const d = svgPath.getAttribute('d') || '';
      if (d.startsWith(PLUS_SVG_PATH)) {
        return btn;
      }
    }
  }
  return null;
}

async function tryUploadViaDirectFileInput(files: File[]): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const allInputs = findAllInputsDeep(document);
    const fileInput = allInputs.find(i => i.type === 'file');
    if (fileInput) {
      dbg('found hidden file input on attempt', attempt);
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(1000);
      dbg('file injected via direct file input method');
      return true;
    }
    dbg('file input not found, attempt', attempt);
    await delay(1000);
  }
  dbg('no file input found after 5 attempts');
  return false;
}

async function tryUploadViaPlusButton(files: File[]): Promise<boolean> {
  const plusBtn = findPlusButton();
  if (!plusBtn) {
    dbg('no + button found');
    return false;
  }

  dbg('found + button, checking React fiber chain');
  logAllKeys(plusBtn);
  logAllKeysDeep(plusBtn);

  triggerRadixClickReact(plusBtn);

  await delay(500);

  const menuItems = await waitForPortalMenu(2000);
  dbg('menu items after clicking +:', menuItems.length);
  menuItems.forEach((item, i) => {
    const text = item.textContent?.trim()?.slice(0, 30) || '';
    dbg(`  menu[${i}]: text="${text}"`);
  });

  let uploadItem: HTMLElement | null = null;
  for (const item of menuItems) {
    const text = item.textContent?.trim() || '';
    if (text.includes('上传文件或图片') || text.includes('上传文件') || text.includes('上传') || text.includes('选择本地文件')) {
      uploadItem = item;
      dbg('FOUND upload item:', text);
      break;
    }
  }

  if (uploadItem) {
    const fileInputPromise = watchForFileInput(5000);
    dbg('clicking upload menu item via React fiber');
    triggerRadixClickReact(uploadItem);
    const fileInput = await fileInputPromise;
    if (fileInput) {
      dbg('found file input, injecting files');
      FileUploadHelpers.injectToFileInput(fileInput, files);
      await delay(2000);
      return true;
    }
    dbg('no file input appeared after clicking upload item');
  } else {
    dbg('no upload menu item found');
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await delay(300);
  return false;
}

async function tryUploadViaToolbarIcon(files: File[]): Promise<boolean> {
  const inputContainer = document.querySelector('#input-engine-container');
  if (!inputContainer) return false;

  const allButtons = Array.from(inputContainer.querySelectorAll<HTMLElement>('button'));
  const iconButtons = allButtons.filter(b => {
    const text = b.textContent?.trim() || '';
    return text.length <= 2 && b.querySelector('svg');
  });

  dbg('icon-only buttons:', iconButtons.length);

  for (const btn of iconButtons) {
    logButtonDetails(btn, -1);
    triggerRadixClickReact(btn);
    await delay(800);

    const allInputs = findAllInputsDeep(document);
    const fileInput = allInputs.find(i => i.type === 'file');
    if (fileInput) {
      dbg('found file input after icon button click');
      FileUploadHelpers.injectToFileInput(fileInput, files);
      await delay(2000);
      return true;
    }

    const menuItems = document.querySelectorAll<HTMLElement>('[role="menuitem"], [data-slot="dropdown-menu-item"]');
    if (menuItems.length > 0) {
      dbg('menu appeared after icon button click, items:', menuItems.length);
      for (const item of menuItems) {
        const text = item.textContent?.trim() || '';
        if (text.includes('上传') || text.includes('文件')) {
          triggerRadixClickReact(item);
          await delay(1000);
          const fileInput2 = findAllInputsDeep(document).find(i => i.type === 'file');
          if (fileInput2) {
            FileUploadHelpers.injectToFileInput(fileInput2, files);
            await delay(2000);
            return true;
          }
        }
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(300);
  }
  return false;
}

async function tryUploadViaDragDrop(files: File[]): Promise<boolean> {
  const textarea = document.querySelector<HTMLTextAreaElement>(SEL_TEXTAREA);
  if (!textarea) return false;

  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));

  const targets = [textarea, textarea.parentElement, document.querySelector('#input-engine-container')].filter(Boolean) as HTMLElement[];
  for (const target of targets) {
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await delay(100);
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await delay(100);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await delay(500);
  }

  await delay(2000);
  const fileTag = document.querySelector('[class*="file"], [class*="attachment"], [data-testid*="file"]');
  return !!fileTag;
}

function setReactInput(input: HTMLTextAreaElement, value: string): void {
  input.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;
  if (nativeSetter) nativeSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(input: HTMLTextAreaElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true,
  }));
  input.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true,
  }));
}

export class DoubaoAdapter implements SiteAdapter {
  async fillAndSend(question: string, attachments: Attachment[]): Promise<void> {
    const input = await waitForInput(SEL_TEXTAREA) as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 1000));

    setReactInput(input, question);
    await new Promise((r) => setTimeout(r, 800));

    if (attachments.length > 0) {
      await this.uploadFiles(attachments);
    }

    // Button click sends; Enter clears input in Doubao's new UI
    try {
      await waitAndClick(SEL_SEND);
    } catch {
      setReactInput(input, question);
      await new Promise((r) => setTimeout(r, 500));
      pressEnter(input);
    }
  }

  async uploadFiles(files: Attachment[]): Promise<string[]> {
    const tid = crypto.randomUUID();
    const fileObjs = files.map((f) => FileUploadHelpers.attachmentToFile(f));
    const fileDesc = fileObjs.map(f => f.name + '(' + f.size + 'b)').join(', ');
    dbg('uploadFiles start:', fileDesc);
    logger.info('DOUBAO', tid, `文件上传: ${fileDesc}`);

    // await exploreDOM();

    dbg('Method 0: direct file input');
    if (await tryUploadViaDirectFileInput(fileObjs)) {
      logger.info('DOUBAO', tid, `直接注入文件成功`);
      dbg('Method 0 SUCCESS');
      return files.map((f) => f.id);
    }
    dbg('Method 0 FAILED');

    dbg('Method 1: + button');
    if (await tryUploadViaPlusButton(fileObjs)) {
      logger.info('DOUBAO', tid, `+按钮上传成功`);
      dbg('Method 1 SUCCESS');
      return files.map((f) => f.id);
    }
    dbg('Method 1 FAILED');

    dbg('Method 2: toolbar icon buttons');
    if (await tryUploadViaToolbarIcon(fileObjs)) {
      logger.info('DOUBAO', tid, `工具栏图标上传成功`);
      dbg('Method 2 SUCCESS');
      return files.map((f) => f.id);
    }
    dbg('Method 2 FAILED');

    dbg('Method 3: drag and drop');
    if (await tryUploadViaDragDrop(fileObjs)) {
      logger.info('DOUBAO', tid, `拖拽上传成功`);
      dbg('Method 3 SUCCESS');
      return files.map((f) => f.id);
    }
    dbg('Method 3 FAILED');

    logger.warn('DOUBAO', tid, `所有上传方法均失败`);
    dbg('ALL METHODS FAILED');
    return [];
  }

  async isGenerating(): Promise<boolean> {
    return !!document.querySelector<HTMLElement>(SEL_STOP);
  }

  async readResponse(): Promise<string> {
    const PREFIX_MARKER = '在保证正确性的前提下';
    const pick = (els: NodeListOf<HTMLElement>): string => {
      let best = '';
      for (const el of els) {
        const txt = el.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (txt.length > best.length && !txt.includes(PREFIX_MARKER)) best = txt;
      }
      return best;
    };
    const r1 = pick(document.querySelectorAll<HTMLElement>('[data-streaming="false"].md-box-root'));
    if (r1.length > 5) return r1;
    const r2 = pick(document.querySelectorAll<HTMLElement>('[data-streaming="false"]'));
    if (r2.length > 5) return r2;
    return '';
  }

  getUploadLimits() { return getLimits('doubao'); }
}

