import type { AppState, Dir, GroupNode, LayoutNode, Run, Segment, SplitNode, Tab, TabSettings, Workspace } from '../types';
import { BUILTIN_PROMPTS, DEFAULT_PROMPT_ID } from '../presets/prompts';
import { SAMPLES } from '../presets/samples';
import { looksChinese, uid } from '../core/text';
import { dbGet, dbSet } from './db';

export const COLORS = ['#2f6feb', '#1a7f37', '#bf8700', '#cf222e', '#8250df', '#0a7ea4', '#6e7781'];

export function defaultSettings(): TabSettings {
  return { dir: 'auto', promptId: DEFAULT_PROMPT_ID, providerId: 'demo', model: '', latex: 'model', view: 'auto' };
}

export function newTab(title: string, source = '', color = COLORS[0], settings: TabSettings = defaultSettings()): Tab {
  return { id: uid(), title, color, kind: 'translate', source, settings: { ...settings }, innerRatio: 0.5, editing: true, runs: [], current: -1 };
}

function groupOf(ids: string[]): GroupNode { return { type: 'group', id: uid(), tabs: ids, active: ids[0] }; }

export function sampleWorkspace(): Workspace {
  const tabs: Record<string, Tab> = {};
  const ids: string[] = [];
  for (const s of SAMPLES) { const t = newTab(s.title, s.source, s.color); tabs[t.id] = t; ids.push(t.id); }
  const groups = ids.map(id => groupOf([id]));
  const now = Date.now();
  return {
    id: uid(), name: '示例：论文 Abstract 润色对比', tabs,
    layout: { type: 'split', id: uid(), dir: 'row', children: groups, sizes: [1, 1, 1] },
    focusGroup: groups[0].id, baseTabId: ids[0], maximized: null, createdAt: now, updatedAt: now,
  };
}

export function emptyWorkspace(name: string, settings?: TabSettings): Workspace {
  const t = newTab('版本 A', '', COLORS[0], settings);
  const g = groupOf([t.id]);
  const now = Date.now();
  return { id: uid(), name, tabs: { [t.id]: t }, layout: g, focusGroup: g.id, baseTabId: t.id, maximized: null, createdAt: now, updatedAt: now };
}

/**
 * 复制工作区：标签、窗格都换成新的 ID，副本与原工作区完全独立
 * （同 ID 会让两个工作区的翻译状态、界面刷新互相干扰）。
 */
export function cloneWorkspace(src: Workspace): Workspace {
  const w: Workspace = JSON.parse(JSON.stringify(src));
  const tabIds = new Map<string, string>(), groupIds = new Map<string, string>();
  const tabs: Record<string, Tab> = {};
  for (const [oldId, t] of Object.entries(w.tabs)) {
    const id = uid();
    tabIds.set(oldId, id);
    tabs[id] = { ...t, id };
    for (const r of tabs[id].runs) if (r.status === 'running') r.status = 'aborted';
  }
  const walk = (n: LayoutNode): void => {
    const id = uid();
    if (n.type === 'group') { groupIds.set(n.id, id); n.id = id; n.tabs = n.tabs.map(x => tabIds.get(x) ?? x); n.active = tabIds.get(n.active) ?? n.active; }
    else { n.id = id; n.children.forEach(walk); }
  };
  walk(w.layout);
  const now = Date.now();
  return {
    ...w, id: uid(), name: src.name + ' 副本', tabs,
    focusGroup: groupIds.get(w.focusGroup) ?? allGroups(w.layout)[0]?.id,
    baseTabId: tabIds.get(w.baseTabId) ?? Object.keys(tabs)[0],
    maximized: w.maximized ? groupIds.get(w.maximized) ?? null : null,
    createdAt: now, updatedAt: now,
  };
}

export function initialState(): AppState {
  const ws = sampleWorkspace();
  return {
    version: 2,
    rev: STATE_REV,
    workspaces: [ws],
    activeWs: ws.id,
    providers: [],
    prompts: BUILTIN_PROMPTS.map(p => structuredClone(p)),
    promptLang: 'en',
    numbered: true,
    cacheOn: true,
    proxy: { url: '/api/proxy', token: '' },
    markupRules: {},
    macros: '\\ours = XNet',
    glossary: 'sparse attention = 稀疏注意力\nbaseline = 基线\nbenchmark = 基准',
    glossaryOn: true,
    ui: { theme: 'auto', fs: 15, font: 'sans', sync: true, diff: false },
    lastRun: null,
  };
}

/** 数据修订号：3 = 方向独立、默认「自动」；4 = 格式全部交给模型处理（去掉本地 LaTeX 处理） */
const STATE_REV = 4;

/** 旧版（本地处理 LaTeX）的译文：把 ⟦n⟧ 占位符还原成可读文字 */
function migrateRuns(t: Tab): void {
  for (const r of t.runs as (Run & { ph?: { raw: string; show: string }[] })[]) {
    if (r.ph?.length) {
      const ph = r.ph;
      const f = (x: string) => String(x || '').replace(/⟦(\d+)⟧/g, (m, n) => ph[+n - 1]?.show ?? m);
      for (const sg of r.segs) { sg.src = f(sg.src); sg.tgt = f(sg.tgt); }
    }
    delete r.ph;
    if (r.latex !== 'model' && r.latex !== 'raw') r.latex = (r.latex as string) === 'keep' ? 'raw' : 'model';
    // 旧版是按句的片段（带 kind 字段）：合并回段落；纯结构块（注释行等）且无译文的直接去掉
    const old = r.segs as (Segment & { kind?: string; warn?: unknown; ph?: unknown })[];
    if (old.some(sg => 'kind' in sg)) {
      const join = r.dir === 'en-zh' ? '' : ' ';
      const byPara = new Map<number, Segment>();
      for (const sg of old) {
        if (sg.kind === 'pass' && !sg.tgt) continue;
        const cur = byPara.get(sg.para);
        if (!cur) byPara.set(sg.para, { para: sg.para, src: sg.src, tgt: sg.tgt, ...(sg.demoMiss ? { demoMiss: true } : {}) });
        else { cur.src += (cur.src && sg.src ? ' ' : '') + sg.src; cur.tgt += (cur.tgt && sg.tgt ? join : '') + sg.tgt; }
      }
      r.segs = [...byPara.values()].map((sg, i) => ({ ...sg, para: i }));
    }
  }
}

/** 旧版内置模式 id → 新 id */
const RENAMED_PROMPTS: Record<string, string> = { zh2en: 'publish' };

/** 补齐旧数据缺失的字段，保证结构完整；未改过的内置提示词升级为最新版本 */
function normalizeState(s: AppState): AppState {
  const d = initialState();
  const out: AppState = {
    ...d, ...s,
    ui: { ...d.ui, ...(s.ui || {}) }, proxy: { ...d.proxy, ...(s.proxy || {}) },
    markupRules: { model: s.markupRules?.model, raw: s.markupRules?.raw },
  };
  const builtinIds = new Set(BUILTIN_PROMPTS.map(b => b.id));
  const customs = (out.prompts || []).filter(p => !builtinIds.has(p.id) && !(p.builtin && !p.modified));
  out.prompts = [
    ...BUILTIN_PROMPTS.map(b => { const old = (s.prompts || []).find(p => p.id === b.id); return old?.modified ? { ...structuredClone(b), ...old, builtin: true } : structuredClone(b); }),
    ...customs.map(p => ({ ...p, desc: p.desc ?? '', builtin: false })),
  ];
  if (!out.workspaces?.length) { out.workspaces = d.workspaces; out.activeWs = d.activeWs; }
  if (!out.workspaces.some(w => w.id === out.activeWs)) out.activeWs = out.workspaces[0].id;
  const promptIds = new Set(out.prompts.map(p => p.id));
  const upgradeDefaults = (s.rev ?? 2) < 3;
  delete (out as unknown as Record<string, unknown>).rules;
  out.rev = STATE_REV;
  for (const w of out.workspaces) for (const t of Object.values(w.tabs)) {
    if (upgradeDefaults && t.settings) { t.settings.dir = 'auto'; t.settings.latex = 'model'; t.settings.promptId = DEFAULT_PROMPT_ID; }
    if (t.settings && t.settings.latex !== 'model' && t.settings.latex !== 'raw') t.settings.latex = (t.settings.latex as string) === 'keep' ? 'raw' : 'model';
    migrateRuns(t);
    t.runs ||= []; if (t.current == null) t.current = t.runs.length - 1;
    t.kind ||= 'translate';
    t.settings = { ...defaultSettings(), ...t.settings };
    const pid = RENAMED_PROMPTS[t.settings.promptId] || t.settings.promptId;
    t.settings.promptId = promptIds.has(pid) ? pid : DEFAULT_PROMPT_ID;
    for (const r of t.runs) if (r.status === 'running') r.status = 'aborted';
    if (t.analysis?.status === 'running') { t.analysis.status = 'error'; t.analysis.text += '\n\n（上次分析被中断）'; }
  }
  return out;
}

export let state: AppState = initialState();
export let storageMode: 'idb' | 'local' | 'memory' | 'pending' = 'pending';
export let savedAt: Date | null = null;

const SESSION_KEYS = 'translens.sessionKeys';

export async function loadState(): Promise<void> {
  const s = await dbGet<AppState>('kv', 'state');
  if (s && s.version === 2) state = normalizeState(s);
  try {
    const keys = JSON.parse(sessionStorage.getItem(SESSION_KEYS) || '{}');
    for (const p of state.providers) if (p.keyMode === 'session' && keys[p.id]) p.apiKey = keys[p.id];
  } catch { /* ignore */ }
}

export function replaceState(s: AppState) { state = normalizeState(s); }

let timer: ReturnType<typeof setTimeout> | undefined;
const listeners: (() => void)[] = [];
export const onSaved = (fn: () => void) => listeners.push(fn);

/** 序列化：去掉仅本次会话保存的 Key */
export function serialize(includeKeys: boolean): AppState {
  const copy: AppState = JSON.parse(JSON.stringify(state));
  for (const p of copy.providers) if (!includeKeys || p.keyMode === 'session') p.apiKey = '';
  return copy;
}

export function save(): void {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const w = ws();
    if (w) w.updatedAt = Date.now();
    try {
      const keys: Record<string, string> = {};
      for (const p of state.providers) if (p.keyMode === 'session' && p.apiKey) keys[p.id] = p.apiKey;
      sessionStorage.setItem(SESSION_KEYS, JSON.stringify(keys));
    } catch { /* ignore */ }
    storageMode = await dbSet('kv', 'state', serialize(true));
    savedAt = new Date();
    listeners.forEach(fn => fn());
  }, 400);
}

// ---------------------------------------------------------------------------
// 工作区 / 标签 / 布局
// ---------------------------------------------------------------------------
export const ws = (): Workspace => state.workspaces.find(w => w.id === state.activeWs) || state.workspaces[0];
export const tabsOf = (): Record<string, Tab> => ws().tabs;

export function findNode(id: string, node: LayoutNode = ws().layout, parent: SplitNode | null = null): { node: LayoutNode; parent: SplitNode | null } | null {
  if (node.id === id) return { node, parent };
  if (node.type === 'split') for (const c of node.children) { const r = findNode(id, c, node); if (r) return r; }
  return null;
}
export function allGroups(node: LayoutNode = ws().layout, acc: GroupNode[] = []): GroupNode[] {
  if (node.type === 'group') acc.push(node); else node.children.forEach(c => allGroups(c, acc));
  return acc;
}
export const groupOfTab = (tabId: string) => allGroups().find(g => g.tabs.includes(tabId));
export const orderedTabIds = () => allGroups().flatMap(g => g.tabs);

function replaceNode(old: LayoutNode, neu: LayoutNode, parent: SplitNode | null) {
  if (!parent) ws().layout = neu;
  else parent.children[parent.children.indexOf(old)] = neu;
}

export function normalizeLayout(node: LayoutNode = ws().layout, parent: SplitNode | null = null): void {
  if (node.type !== 'split') return;
  node.children.slice().forEach(c => normalizeLayout(c, node));
  for (let k = 0; k < node.children.length; k++) {
    const c = node.children[k];
    if (c.type === 'split' && c.dir === node.dir) {
      const total = node.sizes[k], sum = c.sizes.reduce((a, b) => a + b, 0) || 1;
      node.children.splice(k, 1, ...c.children);
      node.sizes.splice(k, 1, ...c.sizes.map(x => x / sum * total));
      k += c.children.length - 1;
    }
  }
  if (node.children.length === 1) replaceNode(node, node.children[0], parent);
}

export function splitGroup(groupId: string, dir: 'row' | 'col', before: boolean, tabId: string): void {
  const found = findNode(groupId);
  if (!found) return;
  const { node: g, parent } = found;
  const ng = groupOf([tabId]);
  if (parent && parent.dir === dir) {
    const idx = parent.children.indexOf(g);
    const half = parent.sizes[idx] / 2;
    parent.sizes[idx] = half;
    const at = before ? idx : idx + 1;
    parent.children.splice(at, 0, ng);
    parent.sizes.splice(at, 0, half);
  } else {
    replaceNode(g, { type: 'split', id: uid(), dir, children: before ? [ng, g] : [g, ng], sizes: [1, 1] }, parent);
  }
  ws().focusGroup = ng.id;
}

export function detachTab(tabId: string): void {
  const w = ws();
  const g = groupOfTab(tabId);
  if (!g) return;
  const idx = g.tabs.indexOf(tabId);
  g.tabs.splice(idx, 1);
  if (g.active === tabId) g.active = g.tabs[Math.min(idx, g.tabs.length - 1)];
  if (g.tabs.length) return;
  const found = findNode(g.id);
  if (!found?.parent) return;
  const parent = found.parent;
  const i = parent.children.indexOf(g), sz = parent.sizes[i];
  parent.children.splice(i, 1); parent.sizes.splice(i, 1);
  parent.sizes[Math.max(0, i - 1)] += sz;
  if (w.focusGroup === g.id) w.focusGroup = allGroups(parent)[0]?.id;
  if (w.maximized === g.id) w.maximized = null;
  normalizeLayout();
}

export type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center';
export function moveTab(tabId: string, targetGroupId: string, zone: Zone, beforeTabId?: string): void {
  const w = ws();
  const src = groupOfTab(tabId);
  const target = findNode(targetGroupId)?.node as GroupNode | undefined;
  if (!src || !target) return;
  if (zone === 'center') {
    if (src === target && !beforeTabId) { target.active = tabId; return; }
    detachTab(tabId);
    const tgt = (findNode(targetGroupId)?.node as GroupNode | undefined) || allGroups()[0];
    const at = beforeTabId ? tgt.tabs.indexOf(beforeTabId) : -1;
    if (at >= 0) tgt.tabs.splice(at, 0, tabId); else tgt.tabs.push(tabId);
    tgt.active = tabId; w.focusGroup = tgt.id;
    return;
  }
  if (src === target && src.tabs.length === 1) return;
  detachTab(tabId);
  splitGroup(targetGroupId, zone === 'left' || zone === 'right' ? 'row' : 'col', zone === 'left' || zone === 'top', tabId);
}

export function nextTitle(): string {
  const used = new Set(Object.values(tabsOf()).map(t => t.title));
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has('版本 ' + L)) return '版本 ' + L;
  return '版本 ' + (Object.keys(tabsOf()).length + 1);
}
export function nextColor(): string {
  const used = new Set(Object.values(tabsOf()).map(t => t.color));
  return COLORS.find(c => !used.has(c)) || COLORS[Object.keys(tabsOf()).length % COLORS.length];
}

export function focusedGroup(): GroupNode {
  const f = findNode(ws().focusGroup || '');
  return f && f.node.type === 'group' ? f.node : allGroups()[0];
}
export const focusedTab = (): Tab | undefined => tabsOf()[focusedGroup()?.active];

export function addTab(o: { groupId?: string; source?: string; title?: string; copyFrom?: Tab; kind?: Tab['kind'] } = {}): Tab {
  const w = ws();
  const g = (o.groupId && (findNode(o.groupId)?.node as GroupNode)) || focusedGroup();
  const ref = o.copyFrom || tabsOf()[g.active];
  const t = newTab(o.title || nextTitle(), o.source ?? '', nextColor(), ref ? ref.settings : defaultSettings());
  if (o.kind) t.kind = o.kind;
  w.tabs[t.id] = t;
  g.tabs.splice(g.tabs.indexOf(g.active) + 1, 0, t.id);
  g.active = t.id; w.focusGroup = g.id;
  return t;
}

export function applyPreset(kind: 'single' | 'cols2' | 'cols3' | 'rows2' | 'grid'): void {
  const w = ws();
  const need = { single: 1, cols2: 2, cols3: 3, rows2: 2, grid: 4 }[kind];
  const ids = orderedTabIds();
  const settings = focusedTab()?.settings;
  while (ids.length < need) { const t = newTab(nextTitle(), '', nextColor(), settings); w.tabs[t.id] = t; ids.push(t.id); }
  const groups: GroupNode[] = [];
  for (let k = 0; k < need; k++) groups.push(groupOf(k < need - 1 ? [ids[k]] : ids.slice(k)));
  const sp = (dir: 'row' | 'col', children: LayoutNode[]): SplitNode => ({ type: 'split', id: uid(), dir, children, sizes: children.map(() => 1) });
  w.layout = kind === 'single' ? groups[0]
    : kind === 'cols2' || kind === 'cols3' ? sp('row', groups)
    : kind === 'rows2' ? sp('col', groups)
    : sp('col', [sp('row', groups.slice(0, 2)), sp('row', groups.slice(2))]);
  w.focusGroup = groups[0].id;
  w.maximized = null;
}

export const currentRun = (t: Tab): Run | undefined => t.runs[t.current] ?? t.runs[t.runs.length - 1];

/** 实际方向：自动时按原文判断（主要是中文 → 译成英文，否则译成中文） */
export function resolveDir(t: Tab): Dir {
  if (t.settings.dir !== 'auto') return t.settings.dir;
  return looksChinese(t.source) ? 'zh-en' : 'en-zh';
}

export function isStale(t: Tab): boolean {
  const r = currentRun(t);
  return !!(r && (r.sourceSnap !== t.source || r.latex !== t.settings.latex || r.dir !== resolveDir(t)));
}

export const getPrompt = (id: string) => state.prompts.find(p => p.id === id) || state.prompts[0];
export const getProvider = (id: string) => state.providers.find(p => p.id === id) || null;
export const srcLang = (t: Tab): 'en' | 'zh' => (resolveDir(t) === 'zh-en' ? 'zh' : 'en');
export const tgtLang = (t: Tab): 'en' | 'zh' => (resolveDir(t) === 'zh-en' ? 'en' : 'zh');
