import type { Tab } from '../types';
import { diffTexts } from '../core/diff';
import { paragraphAt, paragraphRanges } from '../core/segment';
import { esc, h } from './dom';

/**
 * 始终可编辑的原文：文本框在上，下面叠一层与它逐字对齐的「高亮底层」。
 * 底层只画背景色（文字透明），用来显示差异（新增绿底、删除处红色竖线）和段落联动高亮，
 * 编辑完全不受影响，也不需要点「编辑」切换。
 */
export interface SrcEditor extends HTMLDivElement {
  paint: (opts?: { hl?: number | null }) => void;
  textarea: HTMLTextAreaElement;
}

export interface EditorOptions {
  tab: Tab;
  label: string;
  placeholder: string;
  /** 同步滚动分组 */
  sync: 'src' | 'tgt';
  /** 差异模式下的对比基准；返回 null 表示不显示差异 */
  diffBase: () => { text: string; lang: 'en' | 'zh' } | null;
  onInput: () => void;
  /** 打字后高亮底层重画完成（差异统计随之更新） */
  onRepaint?: () => void;
  /** 光标移动到第 i 段（点击或方向键） */
  onCaret?: (para: number) => void;
}

export function sourceEditor(o: EditorOptions): SrcEditor {
  const back = h('div', { class: 'src-back', 'aria-hidden': 'true' });
  const ta = h('textarea', {
    class: 'src-edit', spellcheck: 'false', 'data-scroll': o.tab.id + ':ta', 'data-sync': o.sync,
    'aria-label': o.label, placeholder: o.placeholder, value: o.tab.source,
  }) as HTMLTextAreaElement;
  const wrap = h('div', { class: 'src-wrap', 'data-role': 'src' }, back, ta) as SrcEditor;
  wrap.textarea = ta;
  let hl: number | null = null;

  // 底层与文本框的可用宽度一致（扣掉文本框滚动条），滚动位置同步
  const fit = () => {
    back.style.paddingRight = `calc(14px + ${ta.offsetWidth - ta.clientWidth}px)`;
    back.scrollTop = ta.scrollTop;
  };

  const html = (): string => {
    const text = ta.value;
    const d = o.diffBase();
    if (d) {
      const res = diffTexts(d.text, text, d.lang, true);
      wrap.dataset.stat = `+${res.ins} −${res.del} 词`;
      let out = '';
      for (const p of res.parts) {
        if (p.t === '=') out += esc(p.v);
        else if (p.t === '+') out += p.v.trim() ? `<mark class="ins">${esc(p.v)}</mark>` : esc(p.v);
        else if (p.v.trim()) out += '<span class="del-mark"></span>';
      }
      return out;
    }
    delete wrap.dataset.stat;
    if (hl != null) {
      const r = paragraphRanges(text)[hl];
      if (r) return esc(text.slice(0, r[0])) + `<mark class="hl">${esc(text.slice(r[0], r[1]))}</mark>` + esc(text.slice(r[1]));
    }
    return esc(text);
  };

  wrap.paint = (opts = {}) => {
    if ('hl' in opts) hl = opts.hl ?? null;
    back.innerHTML = html() + '​'; // 结尾换行时保持高度一致
    fit();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  ta.addEventListener('input', () => {
    o.tab.source = ta.value;
    hl = null;
    o.onInput();
    clearTimeout(timer);
    // 差异计算较重，打字时稍作延迟；普通情况立即重画
    if (o.diffBase()) timer = setTimeout(() => { wrap.paint(); o.onRepaint?.(); }, 150); else wrap.paint();
  });
  ta.addEventListener('scroll', () => { back.scrollTop = ta.scrollTop; }, { passive: true });
  const caret = () => o.onCaret?.(paragraphAt(ta.value, ta.selectionStart));
  ta.addEventListener('click', caret);
  ta.addEventListener('keyup', e => { if (/^(Arrow|Page|Home|End)/.test(e.key)) caret(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(ta);

  wrap.paint();
  return wrap;
}
