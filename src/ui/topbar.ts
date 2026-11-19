import { applyPreset, cloneWorkspace, currentRun, emptyWorkspace, orderedTabIds, save, savedAt, state, storageMode, tabsOf, ws } from '../store/state';
import { displayText } from '../app/translate';
import { $, ICONS, download, h, menuItem, openMenu, toast } from './dom';
import { renderAll } from './layout';

export function renderTopbar(): void {
  const name = $('#wsName')!;
  // 切换了工作区就强制刷新名称（即使输入框正处于编辑状态）
  if (document.activeElement !== name || name.dataset.ws !== ws().id) {
    if (document.activeElement === name) name.blur();
    name.textContent = ws().name;
    name.dataset.ws = ws().id;
  }
  const presets = $('#presets')!;
  presets.replaceChildren(...([['single', '单栏'], ['cols2', '左右两栏'], ['cols3', '三栏'], ['rows2', '上下两栏'], ['grid', '田字格']] as const)
    .map(([k, label]) => h('button', { class: 'btn', title: '布局：' + label, 'aria-label': '布局：' + label, html: ICONS[k], onclick: () => { applyPreset(k); save(); renderAll(); } })));
  $('#btnSync')!.classList.toggle('on', state.ui.sync);
  $('#btnDiff')!.classList.toggle('on', state.ui.diff);
}

export function renderStatus(): void {
  const lr = state.lastRun;
  const demo = !state.providers.length;
  // 还没配置模型服务时，在「设置」按钮上加提示点
  const sb = $('#btnSettings');
  if (sb) {
    sb.classList.toggle('need', demo);
    sb.title = demo ? '还没有配置模型服务：点这里添加 DeepSeek 等，填入你的 API Key' : '设置：模型服务（API Key）、提示词、格式规则、术语表、外观、数据备份';
  }
  const cost = lr?.cost ? ` · ${lr.cost.currency === 'CNY' ? '¥' : '$'}${lr.cost.value.toFixed(4)}` : '';
  const storeText = storageMode === 'memory' ? '⚠ 浏览器禁止本地存储，关闭页面后内容会丢失' : savedAt ? `已保存 ${savedAt.toLocaleTimeString()}` : '自动保存';
  $('#status')!.replaceChildren(...[
    h('span', { class: 'lock' }, '🔒 数据仅保存在本浏览器'),
    h('span', { class: 'hide-sm' }, demo ? '演示模式 · 在 ⚙ 设置中添加 DeepSeek 等模型服务即可真实翻译' : `${state.providers.length} 个模型服务 · 提示词：${state.promptLang === 'en' ? 'English' : '中文'}`),
    lr ? h('span', { class: 'hide-sm' }, `上次：「${lr.title}」 ${lr.model} · ${lr.usage.input}→${lr.usage.output} tokens${cost} · ${(lr.ms / 1000).toFixed(1)}s`) : null,
    h('span', { class: 'spacer' }),
    h('span', { class: storageMode === 'memory' ? 'warn' : '' }, storeText),
  ].filter(Boolean) as HTMLElement[]);
}

export function applyAppearance(): void {
  const root = document.documentElement;
  if (state.ui.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = state.ui.theme;
  root.style.setProperty('--fs', state.ui.fs + 'px');
  const tb = $('#btnTheme');
  if (tb) {
    const t = state.ui.theme;
    tb.innerHTML = ICONS[t === 'auto' ? 'themeAuto' : t === 'light' ? 'themeLight' : 'themeDark'];
    tb.title = `主题：${{ auto: '跟随系统', light: '浅色', dark: '深色' }[t]}（点击切换）`;
  }
  root.style.setProperty('--font-read', state.ui.font === 'serif' ? 'Charter, Georgia, "Songti SC", "Noto Serif SC", "SimSun", serif' : 'var(--font-ui)');
}

/** 导出当前工作区为 Markdown（每个标签：原文 + 译文） */
function exportMarkdown(): void {
  const w = ws();
  const parts = [`# ${w.name}`, `> 导出时间：${new Date().toLocaleString()}`];
  for (const id of orderedTabIds()) {
    const t = tabsOf()[id];
    parts.push(`## ${t.title}${t.kind === 'reference' ? '（参考稿）' : ''}`);
    if (t.kind === 'reference') { parts.push(t.source); continue; }
    parts.push('### 原文', t.source || '（空）');
    const r = currentRun(t);
    if (r) parts.push(`### 译文（${r.model}）`, displayText(r.segs, 'tgt'));
  }
  download(`${w.name.replace(/[\\/:*?"<>|]/g, '_')}.md`, parts.join('\n\n'), 'text/markdown');
}

export function openWorkspaceMenu(anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const cur = ws();
  openMenu([
    h('div', { class: 'menu-title' }, '工作区'),
    ...state.workspaces.map(w => menuItem((w.id === cur.id ? '✓ ' : '   ') + w.name, () => { state.activeWs = w.id; save(); renderAll(); }, `${Object.keys(w.tabs).length} 个标签`, w.id === cur.id ? 'on' : '')),
    h('hr'),
    menuItem('新建工作区', () => {
      const w = emptyWorkspace('新工作区 ' + (state.workspaces.length + 1), tabsOf()[orderedTabIds()[0]]?.settings);
      state.workspaces.push(w); state.activeWs = w.id; save(); renderAll();
      setTimeout(() => { const el = $('#wsName'); el?.focus(); document.getSelection()?.selectAllChildren(el!); }, 30);
    }),
    menuItem('复制当前工作区', () => {
      const w = cloneWorkspace(cur);
      state.workspaces.push(w); state.activeWs = w.id; save(); renderAll();
    }),
    menuItem('重命名', () => { const el = $('#wsName'); el?.focus(); document.getSelection()?.selectAllChildren(el!); }),
    menuItem('导出为 Markdown', exportMarkdown),
    h('hr'),
    menuItem('删除当前工作区', () => {
      if (state.workspaces.length === 1) { toast('至少保留一个工作区'); return; }
      if (!confirm(`删除工作区「${cur.name}」及其中所有标签和译文？此操作无法撤销。`)) return;
      state.workspaces = state.workspaces.filter(w => w.id !== cur.id);
      state.activeWs = state.workspaces[0].id; save(); renderAll();
    }, undefined, 'danger'),
  ], r.left, r.bottom + 4);
}
