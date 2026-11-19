import type { GroupNode, LayoutNode, SplitNode, Tab } from '../types';
import { COLORS, addTab, currentRun, defaultSettings, detachTab, findNode, groupOfTab, isStale, moveTab, newTab, nextColor, nextTitle, orderedTabIds, save, splitGroup, tabsOf, ws, type Zone } from '../store/state';
import { running } from '../app/translate';
import { $, $$, ICONS, h, menuItem, openMenu, toast } from './dom';
import { renderTabBody } from './tabview';
import { applyAppearance, renderStatus, renderTopbar } from './topbar';

export function renderAll(): void {
  const scrolls: Record<string, number> = {};
  $$('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll!] = el.scrollTop; });
  const w = ws();
  const maxNode = w.maximized ? findNode(w.maximized)?.node : null;
  $('#workspace')!.replaceChildren(renderNode(maxNode || w.layout));
  $$('[data-scroll]').forEach(el => { const v = scrolls[el.dataset.scroll!]; if (v != null) el.scrollTop = v; });
  renderTopbar();
  renderStatus();
  applyAppearance();
}

function renderNode(node: LayoutNode): HTMLElement {
  if (node.type === 'group') return renderGroup(node);
  const el = h('div', { class: 'split ' + node.dir });
  node.children.forEach((c, k) => {
    if (k > 0) el.appendChild(makeDivider(node, k - 1, el));
    const cell = h('div', { class: 'cell' });
    cell.style.flex = `${node.sizes[k]} 1 0px`;
    cell.appendChild(renderNode(c));
    el.appendChild(cell);
  });
  return el;
}

function makeDivider(node: SplitNode, k: number, container: HTMLElement): HTMLElement {
  const d = h('div', { class: 'divider', title: '拖动调整大小 · 双击均分', role: 'separator' });
  d.addEventListener('dblclick', () => { node.sizes = node.sizes.map(() => 1); save(); renderAll(); });
  d.addEventListener('pointerdown', e => {
    e.preventDefault();
    const row = node.dir === 'row';
    const cells = Array.from(container.children).filter(x => x.classList.contains('cell')) as HTMLElement[];
    const total = row ? container.clientWidth : container.clientHeight;
    const sum = node.sizes.reduce((a, b) => a + b, 0);
    const start = row ? e.clientX : e.clientY;
    const sa = node.sizes[k], sb = node.sizes[k + 1];
    const minU = 170 / total * sum;
    d.classList.add('drag');
    document.body.classList.add('resizing', row ? 'rz-col' : 'rz-row');
    const move = (ev: PointerEvent) => {
      let delta = ((row ? ev.clientX : ev.clientY) - start) / total * sum;
      delta = Math.max(minU - sa, Math.min(sb - minU, delta));
      node.sizes[k] = sa + delta; node.sizes[k + 1] = sb - delta;
      cells[k].style.flex = `${node.sizes[k]} 1 0px`;
      cells[k + 1].style.flex = `${node.sizes[k + 1]} 1 0px`;
    };
    const up = () => {
      d.classList.remove('drag');
      document.body.classList.remove('resizing', 'rz-col', 'rz-row');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return d;
}

let dragTabId: string | null = null;

function renderGroup(g: GroupNode): HTMLElement {
  const w = ws();
  const isMax = w.maximized === g.id;
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' }, g.tabs.map(id => tabsOf()[id]).filter(Boolean).map(t => renderTabHandle(t, g)));
  const bar = h('div', { class: 'tabbar' },
    tabsEl,
    h('button', { class: 'tab-add', title: '在此窗格新建标签（Alt+T）', onclick: () => { addTab({ groupId: g.id }); save(); renderAll(); focusEditor(); } }, '+'),
    h('div', { class: 'tabbar-actions' },
      h('button', { class: 'btn', title: '向右拆分（Ctrl/⌘+\\）', html: ICONS.splitR, onclick: () => splitWithNew(g.id, 'row') }),
      h('button', { class: 'btn', title: '向下拆分（Ctrl/⌘+Shift+\\）', html: ICONS.splitD, onclick: () => splitWithNew(g.id, 'col') }),
      h('button', { class: 'btn', title: isMax ? '还原' : '最大化', html: isMax ? ICONS.min : ICONS.max, onclick: () => { w.maximized = isMax ? null : g.id; save(); renderAll(); } })));
  bar.addEventListener('dragover', e => {
    if (!dragTabId) return;
    e.preventDefault();
    $$('.tab.drop-before').forEach(x => x.classList.remove('drop-before'));
    const before = $$('.tab', tabsEl).find(x => { const r = x.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    before?.classList.add('drop-before');
  });
  bar.addEventListener('dragleave', () => $$('.tab.drop-before', bar).forEach(x => x.classList.remove('drop-before')));
  bar.addEventListener('drop', e => {
    e.preventDefault();
    const before = $('.tab.drop-before', bar)?.dataset.tab;
    if (dragTabId && before !== dragTabId) moveTab(dragTabId, g.id, 'center', before);
    dragTabId = null; save(); renderAll();
  });

  const tab = tabsOf()[g.active];
  const ov = h('div', { class: 'drop-ov' });
  const content = h('div', { class: 'group-body' }, tab ? renderTabBody(tab) : h('div', { class: 'empty' }, '空窗格'), ov);
  let zone: Zone | null = null;
  content.addEventListener('dragover', e => {
    if (!dragTabId) return;
    e.preventDefault();
    const r = content.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const near = (Object.entries({ left: x, right: 1 - x, top: y, bottom: 1 - y }) as [Zone, number][]).sort((a, b) => a[1] - b[1])[0];
    zone = near[1] < 0.28 ? near[0] : 'center';
    const pos = { left: [0, 0, 50, 100], right: [50, 0, 50, 100], top: [0, 0, 100, 50], bottom: [0, 50, 100, 50], center: [0, 0, 100, 100] }[zone];
    Object.assign(ov.style, { display: 'block', left: `calc(${pos[0]}% + 6px)`, top: `calc(${pos[1]}% + 6px)`, width: `calc(${pos[2]}% - 12px)`, height: `calc(${pos[3]}% - 12px)` });
  });
  content.addEventListener('dragleave', e => { if (!content.contains(e.relatedTarget as Node)) ov.style.display = 'none'; });
  content.addEventListener('drop', e => {
    e.preventDefault();
    ov.style.display = 'none';
    if (dragTabId && zone) moveTab(dragTabId, g.id, zone);
    dragTabId = null; save(); renderAll();
  });

  const el = h('div', { class: 'group' + (w.focusGroup === g.id ? ' focus' : ''), 'data-group': g.id }, bar, content);
  el.addEventListener('pointerdown', () => {
    if (w.focusGroup === g.id) return;
    w.focusGroup = g.id;
    $$('.group.focus').forEach(x => x.classList.remove('focus'));
    el.classList.add('focus');
    save();
  }, true);
  return el;
}

export function renderTabHandle(t: Tab, g: GroupNode): HTMLElement {
  const r = currentRun(t);
  const w = ws();
  const st = running.has(t.id) ? h('span', { class: 'st run', title: '翻译中' })
    : r?.status === 'error' ? h('span', { class: 'st err', title: '出错' }, '⚠')
    : r && isStale(t) ? h('span', { class: 'st', title: '原文已修改，译文已过期' }, '●') : null;
  const el = h('div', {
    class: 'tab' + (g.active === t.id ? ' active' : ''), draggable: 'true', role: 'tab', 'data-tab': t.id,
    style: { '--tc': t.color }, title: '双击重命名 · 右键更多 · 拖到其他窗格可拆分',
  },
    h('span', { class: 'dot' }),
    t.kind === 'reference' ? h('span', { class: 'ref-tag', title: '参考稿：不翻译，可作对比基准' }, '参') : null,
    h('span', { class: 'title' }, t.title),
    w.baseTabId === t.id ? h('span', { class: 'base', title: '对比基准' }, '★') : null,
    st,
    h('button', { class: 'x', title: '关闭（Alt+W）', html: ICONS.x, onclick: (e: Event) => { e.stopPropagation(); closeTab(t.id); } }));
  el.style.setProperty('--tc', t.color);
  el.addEventListener('click', () => { if (g.active !== t.id) { g.active = t.id; w.focusGroup = g.id; save(); renderAll(); } });
  el.addEventListener('dblclick', e => { e.preventDefault(); startRename(t.id, el); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); openTabMenu(t, g, e.clientX, e.clientY); });
  el.addEventListener('dragstart', e => { dragTabId = t.id; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', t.title); setTimeout(() => el.classList.add('dragging')); });
  el.addEventListener('dragend', () => { dragTabId = null; el.classList.remove('dragging'); $$('.drop-ov').forEach(x => { x.style.display = 'none'; }); $$('.drop-before').forEach(x => x.classList.remove('drop-before')); });
  return el;
}

export function startRename(tabId: string, el?: HTMLElement | null): void {
  el = el || $(`.tab[data-tab="${tabId}"]`);
  const t = tabsOf()[tabId];
  if (!el || !t) return;
  const input = h('input', { class: 'rename', value: t.title, maxlength: '40', 'aria-label': '标签名称' }) as HTMLInputElement;
  $('.title', el)!.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return; done = true;
    if (ok && input.value.trim()) t.title = input.value.trim();
    save(); renderAll();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('dblclick', e => e.stopPropagation());
}

export function splitWithNew(groupId: string, dir: 'row' | 'col'): void {
  const g = findNode(groupId)?.node as GroupNode | undefined;
  if (!g) return;
  if (g.tabs.length > 1) moveTab(g.active, groupId, dir === 'row' ? 'right' : 'bottom');
  else {
    const cur = tabsOf()[g.active];
    const t = newTab(nextTitle(), '', nextColor(), cur ? cur.settings : defaultSettings());
    ws().tabs[t.id] = t;
    splitGroup(groupId, dir, false, t.id);
  }
  save(); renderAll(); focusEditor();
}

export function focusEditor(): void {
  setTimeout(() => $<HTMLTextAreaElement>('.group.focus textarea.src-edit')?.focus(), 30);
}

export function closeTab(tabId: string): void {
  const w = ws();
  const t = w.tabs[tabId];
  if (!t) return;
  const snapshot = JSON.stringify({ tabs: w.tabs, layout: w.layout, focusGroup: w.focusGroup, baseTabId: w.baseTabId });
  running.get(tabId)?.abort();
  detachTab(tabId);
  delete w.tabs[tabId];
  if (!Object.keys(w.tabs).length) {
    const nt = newTab('版本 A');
    w.tabs[nt.id] = nt;
    w.layout = { type: 'group', id: nt.id + 'g', tabs: [nt.id], active: nt.id };
    w.focusGroup = w.layout.id;
  }
  if (w.baseTabId === tabId) w.baseTabId = orderedTabIds()[0];
  save(); renderAll();
  toast(`已关闭「${t.title}」`, '撤销', () => {
    const s = JSON.parse(snapshot);
    Object.assign(w, s);
    save(); renderAll();
  });
}

function openTabMenu(t: Tab, g: GroupNode, x: number, y: number): void {
  const w = ws();
  const moveTo = (zone: Zone) => () => {
    if (g.tabs.length < 2) { toast('窗格里只有这一个标签'); return; }
    moveTab(t.id, g.id, zone); save(); renderAll();
  };
  openMenu([
    menuItem('重命名', () => startRename(t.id), 'F2'),
    menuItem(w.baseTabId === t.id ? '★ 已是对比基准' : '设为对比基准', () => { w.baseTabId = t.id; save(); renderAll(); }),
    menuItem('复制此标签（含原文）', () => { addTab({ groupId: g.id, source: t.source, title: t.title + ' 副本', copyFrom: t, kind: t.kind }); save(); renderAll(); }),
    menuItem(t.kind === 'reference' ? '转为翻译标签' : '转为参考稿（如中文初稿，不翻译）', () => { t.kind = t.kind === 'reference' ? 'translate' : 'reference'; save(); renderAll(); }),
    menuItem('移到右侧新窗格', moveTo('right')),
    menuItem('移到下方新窗格', moveTo('bottom')),
    h('hr'),
    h('div', { class: 'colors' }, COLORS.map(c => h('button', {
      class: 'sw' + (t.color === c ? ' on' : ''), style: { background: c }, title: '标签颜色', 'aria-label': '标签颜色 ' + c,
      onclick: () => { t.color = c; save(); renderAll(); document.querySelector('.menu')?.remove(); },
    }))),
    h('hr'),
    menuItem('关闭', () => closeTab(t.id), 'Alt+W'),
  ], x, y);
}

export function refreshTabHandle(tabId: string): void {
  const handle = $(`.tab[data-tab="${tabId}"]`);
  const t = tabsOf()[tabId];
  const g = groupOfTab(tabId);
  if (handle && t && g) handle.replaceWith(renderTabHandle(t, g));
}
