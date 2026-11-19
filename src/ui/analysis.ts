import { renderMarkdown } from '../core/markdown';
import { tabsOf } from '../store/state';
import { analyzeDiff, isAnalyzing, stopAnalysis } from '../app/translate';
import { $, ICONS, copyText, h } from './dom';

let openFor: string | null = null;

export function closeAnalysis(): void { $('.modal-bg.analysis')?.remove(); openFor = null; }
export const analysisOpen = () => !!openFor;

export function openAnalysis(tabId: string): void {
  closeAnalysis();
  const tab = tabsOf()[tabId];
  if (!tab?.analysis) return;
  openFor = tabId;
  const body = h('div', { class: 'analysis-body md', 'data-role': 'analysis' });
  const head = h('div', { class: 'analysis-head' },
    h('div', {}, h('h3', {}, `「${tab.title}」相对「${tab.analysis.baseTitle}」的语义变化`), h('div', { class: 'hint', 'data-role': 'analysis-meta' })),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', 'data-role': 'analysis-rerun', onclick: () => { if (isAnalyzing(tabId)) stopAnalysis(tabId); else analyzeDiff(tabId); } }, '重新分析'),
      h('button', { class: 'btn sm', onclick: () => copyText(tabsOf()[tabId]?.analysis?.text || '', '已复制分析结果') }, '复制'),
      h('button', { class: 'btn sm icon ghost', title: '关闭（Esc）', html: ICONS.x, onclick: closeAnalysis })));
  const bg = h('div', { class: 'modal-bg analysis', onclick: (e: Event) => { if (e.target === bg) closeAnalysis(); } },
    h('div', { class: 'modal analysis-modal', role: 'dialog', 'aria-label': 'AI 解读差异' }, head, body,
      h('div', { class: 'hint foot' }, '只列出意思上的变化（语气强弱、数据、范围、增删信息、逻辑关系），纯措辞调整会被忽略。结果由模型生成，请自行核对。')));
  document.body.appendChild(bg);
  updateAnalysis(tabId);
}

export function updateAnalysis(tabId: string): void {
  const tab = tabsOf()[tabId];
  const an = tab?.analysis;
  if (!an) return;
  if (openFor !== tabId) {
    if (an.status === 'running' && !an.text) openAnalysis(tabId);
    return;
  }
  const body = $('[data-role="analysis"]');
  if (body) body.innerHTML = an.text ? renderMarkdown(an.text) : '<div class="empty">正在分析……</div>';
  const meta = $('[data-role="analysis-meta"]');
  if (meta) meta.textContent = `${an.model} · ${an.status === 'running' ? '分析中…' : an.status === 'error' ? '出错' : new Date(an.at).toLocaleString()}`;
  const btn = $('[data-role="analysis-rerun"]');
  if (btn) btn.textContent = an.status === 'running' ? '■ 停止' : '重新分析';
}
