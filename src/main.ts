import './styles.css';
import { addTab, focusedGroup, focusedTab, groupOfTab, loadState, onSaved, orderedTabIds, save, state, tabsOf, ws } from './store/state';
import { tabsToTranslate, translateAll, translateTab } from './app/translate';
import { ui } from './ui/bridge';
import { $, closeMenu, menuOpen, toast } from './ui/dom';
import { closeTab, focusEditor, renderAll, splitWithNew, startRename } from './ui/layout';
import { renderTab, scheduleTgt } from './ui/tabview';
import { applyAppearance, openWorkspaceMenu, renderStatus, renderTopbar } from './ui/topbar';
import { closeSettings, openSettings, settingsOpen } from './ui/settings';
import { analysisOpen, closeAnalysis, updateAnalysis } from './ui/analysis';

Object.assign(ui, { renderAll, renderTab, scheduleTgt, renderStatus, toast, updateAnalysis });

function toggleDiff(): void {
  state.ui.diff = !state.ui.diff;
  const w = ws();
  if (!tabsOf()[w.baseTabId]) w.baseTabId = orderedTabIds()[0];
  save(); renderAll();
  if (state.ui.diff) toast(`差异：相对「${tabsOf()[w.baseTabId].title}」高亮（右键标签可更换基准）`);
}

/** 顶栏「翻译所有标签」：超过一个标签时先列出来让用户确认，避免误触批量翻译 */
function confirmTranslateAll(): void {
  const ids = tabsToTranslate();
  if (!ids.length) { toast('所有标签都已是最新译文，没有需要翻译的标签'); return; }
  if (ids.length > 1) {
    const names = ids.map(id => `· ${tabsOf()[id].title}`).join('\n');
    if (!confirm(`将翻译以下 ${ids.length} 个标签（未翻译、出错或原文改过的；已是最新的不会重翻）：\n\n${names}\n\n只想翻译当前标签的话，请点该标签原文右上角的「翻译本标签」。继续吗？`)) return;
  }
  translateAll(ids);
}

function wireTopbar(): void {
  $('#btnSync')!.onclick = () => { state.ui.sync = !state.ui.sync; save(); renderTopbar(); toast(state.ui.sync ? '已开启同步滚动' : '已关闭同步滚动'); };
  $('#btnDiff')!.onclick = toggleDiff;
  $('#btnAll')!.onclick = confirmTranslateAll;
  $('#btnNew')!.onclick = () => { addTab(); save(); renderAll(); focusEditor(); };
  $('#btnSettings')!.onclick = () => openSettings();
  $('#btnTheme')!.onclick = () => {
    state.ui.theme = ({ auto: 'light', light: 'dark', dark: 'auto' } as const)[state.ui.theme];
    save(); applyAppearance();
    toast('主题：' + { auto: '跟随系统', light: '浅色', dark: '深色' }[state.ui.theme]);
  };
  const name = $('#wsName')!;
  name.addEventListener('input', () => {
    const w = state.workspaces.find(x => x.id === name.dataset.ws) || ws();
    w.name = name.textContent?.trim() || '未命名工作区';
    save();
  });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  $('#btnWs')!.onclick = e => openWorkspaceMenu(e.currentTarget as HTMLElement);
}

function wireShortcuts(): void {
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (menuOpen()) { closeMenu(); return; }
      if (analysisOpen()) { closeAnalysis(); return; }
      if (settingsOpen()) { closeSettings(); return; }
    }
    if (settingsOpen() || analysisOpen()) return;
    const tab = focusedTab(), g = focusedGroup();
    if (mod && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) confirmTranslateAll(); else if (tab) translateTab(tab.id); return; }
    if (mod && e.code === 'Backslash') { e.preventDefault(); if (g) splitWithNew(g.id, e.shiftKey ? 'col' : 'row'); return; }
    if (e.altKey && !mod) {
      if (e.code === 'KeyT') { e.preventDefault(); addTab(); save(); renderAll(); focusEditor(); return; }
      if (e.code === 'KeyW') { e.preventDefault(); if (tab) closeTab(tab.id); return; }
      if (e.code === 'KeyD') { e.preventDefault(); toggleDiff(); return; }
      if (/^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const id = orderedTabIds()[+e.code.slice(5) - 1];
        const tg = id ? groupOfTab(id) : undefined;
        if (tg && id) { tg.active = id; ws().focusGroup = tg.id; save(); renderAll(); }
        return;
      }
    }
    if (e.key === 'F2' && tab) { e.preventDefault(); startRename(tab.id); }
  });
}

async function main(): Promise<void> {
  await loadState();
  onSaved(renderStatus);
  wireTopbar();
  wireShortcuts();
  renderAll();
  save();
  if (!state.providers.length && !sessionStorage.getItem('translens.welcomed')) {
    sessionStorage.setItem('translens.welcomed', '1');
    toast('演示模式：点任一标签的「翻译本标签」试试内置示例；点右上角「设置」添加 DeepSeek 等模型即可翻译任意文本');
  }
}

main();
