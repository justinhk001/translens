export { esc } from '../core/markdown';

export const $ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll(sel)) as T[];

type Attrs = Record<string, unknown>;
type Kid = Node | string | number | null | undefined | false | Kid[];

/** 轻量的 DOM 构造器：h('div', {class: 'x', onclick}, ...children) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  let value: unknown;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'value') value = v;
    else if (k === 'checked') (el as unknown as HTMLInputElement).checked = !!v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (kid: Kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(add); return; }
    el.append(typeof kid === 'object' ? kid : String(kid));
  };
  kids.forEach(add);
  if (value !== undefined) (el as unknown as HTMLInputElement).value = String(value);
  return el;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, action?: string, fn?: () => void): void {
  $('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, msg, action ? h('button', { onclick: () => { el.remove(); fn?.(); } }, action) : null);
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 2400);
}

let menuEl: HTMLElement | null = null;
let menuAnchor: HTMLElement | null = null;
let lastClosedAnchor: HTMLElement | null = null;
export const menuOpen = () => !!menuEl;
export function closeMenu(): void { menuEl?.remove(); menuEl = null; menuAnchor = null; }
export function openMenu(content: HTMLElement[], x: number, y: number, cls = '', anchor?: HTMLElement): void {
  if (anchor && anchor === lastClosedAnchor) { lastClosedAnchor = null; return; }
  closeMenu();
  menuAnchor = anchor ?? null;
  menuEl = h('div', { class: 'menu ' + cls, role: 'menu' }, content);
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
export const menuItem = (label: string, fn: () => void, key?: string, cls = '') =>
  h('button', { class: cls, role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, label, key ? h('span', { class: 'k' }, key) : null);
document.addEventListener('pointerdown', e => {
  if (menuEl && !menuEl.contains(e.target as Node)) {
    lastClosedAnchor = menuAnchor;
    setTimeout(() => { lastClosedAnchor = null; }, 0);
    closeMenu();
  }
});

export async function copyText(text: string, okMsg: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }) as HTMLTextAreaElement;
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch { toast('复制失败，请手动选择文本'); }
    ta.remove();
  }
}

export function download(name: string, text: string, type = 'text/plain'): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }) as HTMLAnchorElement;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const ICONS = {
  single: '<svg width="18" height="14" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  cols2: '<svg width="18" height="14" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 1v12" stroke="currentColor" stroke-width="1.4"/></svg>',
  cols3: '<svg width="18" height="14" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.3 1v12M11.7 1v12" stroke="currentColor" stroke-width="1.4"/></svg>',
  rows2: '<svg width="18" height="14" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 7h16" stroke="currentColor" stroke-width="1.4"/></svg>',
  grid: '<svg width="18" height="14" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 1v12M1 7h16" stroke="currentColor" stroke-width="1.4"/></svg>',
  splitR: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1.5" width="12" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 1.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
  splitD: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1.5" width="12" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1 7h12" stroke="currentColor" stroke-width="1.3"/></svg>',
  max: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M8.5 1.5h4v4M5.5 12.5h-4v-4M12.5 1.5 8 6M1.5 12.5 6 8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  min: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M12.5 5.5h-4v-4M1.5 8.5h4v4M8.5 5.5l4-4M5.5 8.5l-4 4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" stroke-width="1.4"/></svg>',
  caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  // 主题按钮：跟随系统 / 浅色 / 深色
  themeAuto: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
  themeLight: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  themeDark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/></svg>',
};
