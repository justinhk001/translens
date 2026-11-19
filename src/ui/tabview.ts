import type { Segment, Tab } from '../types';
import { diffTexts } from '../core/diff';
import { fixPdfBreaks } from '../core/text';
import { FORMAT_MODES } from '../presets/prompts';
import { isLocalProvider } from '../presets/providers';
import { currentRun, getPrompt, getProvider, isStale, resolveDir, save, srcLang, state, tabsOf, tgtLang, ws } from '../store/state';
import { analyzeDiff, displayText, running, sourceSegs, tgtTextOf, translateTab } from '../app/translate';
import { $, $$, ICONS, closeMenu, copyText, esc, h, openMenu, toast } from './dom';
import { refreshTabHandle } from './layout';
import { openAnalysis } from './analysis';
import { openFormatHelp } from './help';
import { openSettings } from './settings';
import { type SrcEditor, sourceEditor } from './srceditor';

// ---------------------------------------------------------------------------
// 片段渲染
// ---------------------------------------------------------------------------
export function segHTML(text: string): string {
  return esc(text).replace(/【注[:：]([^】]*)】|\[Note:([^\]]*)\]/g, (m) => `<span class="note-tag">${m}</span>`);
}
function diffHTML(base: string, text: string, lang: 'en' | 'zh'): { html: string; ins: number; del: number } {
  const d = diffTexts(base, text, lang);
  let html = '';
  for (const p of d.parts) {
    const ws_ = !p.v.trim();
    if (p.t === '=' || (p.t === '+' && ws_)) html += esc(p.v);
    else if (p.t === '+') html += `<ins>${esc(p.v)}</ins>`;
    else if (!ws_) html += `<del>${esc(p.v)}</del>`;
  }
  return { html, ins: d.ins, del: d.del };
}

const baseOf = (tab: Tab): Tab | null => {
  if (!state.ui.diff) return null;
  const b = tabsOf()[ws().baseTabId];
  return b && b.id !== tab.id ? b : null;
};

// ---------------------------------------------------------------------------
// 标签主体
// ---------------------------------------------------------------------------
function openTabModelMenu(anchor: HTMLElement, tab: Tab, setS: (patch: Partial<Tab['settings']>) => void): void {
  const s = tab.settings;
  const curProvider = getProvider(s.providerId);
  const activeModel = curProvider ? (s.model || curProvider.model) : '';
  const totalModels = state.providers.reduce((sum, p) => sum + new Set([p.model, ...p.models].filter(Boolean)).size, 0);
  const list = h('div', { class: 'picker-list' });
  const search = totalModels > 10
    ? (h('input', { class: 'input picker-search', placeholder: '搜索服务或模型…', spellcheck: 'false' }) as HTMLInputElement)
    : null;
  const expandedGroups = new Set<string>();

  const renderList = (query: string) => {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!state.providers.length) {
        list.appendChild(h('div', { class: 'picker-empty' }, '还没有模型服务，点击下方「管理模型服务」添加'));
        return;
      }
      for (const p of state.providers) {
        const models = [...new Set([p.model, ...p.models].filter(Boolean))];
        const warn = !isLocalProvider(p.kind) && !p.apiKey.trim() ? '（未填 Key）' : '';
        list.appendChild(h('div', { class: 'menu-title' }, p.name + warn));
        if (!models.length) {
          list.appendChild(h('button', { role: 'menuitem', onclick: () => { closeMenu(); openSettings('providers'); } }, '   未填模型（去设置）'));
          continue;
        }
        const curForP = s.providerId === p.id ? activeModel : '';
        let visible = models;
        if (models.length > 6 && !expandedGroups.has(p.id)) {
          visible = [...new Set([p.model, curForP].filter(Boolean))];
          if (!visible.length) visible = models.slice(0, 1);
        }
        for (const m of visible) {
          const isCur = s.providerId === p.id && activeModel === m;
          list.appendChild(h('button', {
            class: isCur ? 'on' : '', role: 'menuitem',
            onclick: () => { closeMenu(); setS({ providerId: p.id, model: m === p.model ? '' : m }); },
          }, (isCur ? '✓ ' : '   ') + m, m === p.model ? h('span', { class: 'k' }, '默认') : null));
        }
        if (models.length > 6 && !expandedGroups.has(p.id)) {
          list.appendChild(h('button', {
            class: 'picker-more', role: 'menuitem',
            onclick: (e: Event) => { e.stopPropagation(); expandedGroups.add(p.id); renderList(query); },
          }, `   展开全部 ${models.length} 个模型 ▾`));
        }
      }
      return;
    }

    const hits: { p: typeof state.providers[number]; m: string }[] = [];
    for (const p of state.providers) {
      const models = [...new Set([p.model, ...p.models].filter(Boolean))];
      const nameHit = p.name.toLowerCase().includes(q);
      for (const m of models) {
        if (nameHit || m.toLowerCase().includes(q)) hits.push({ p, m });
      }
    }
    const maxShow = 60;
    for (const { p, m } of hits.slice(0, maxShow)) {
      const isCur = s.providerId === p.id && activeModel === m;
      list.appendChild(h('button', {
        class: isCur ? 'on' : '', role: 'menuitem',
        onclick: () => { closeMenu(); setS({ providerId: p.id, model: m === p.model ? '' : m }); },
      }, (isCur ? '✓ ' : '   ') + `${p.name} · ${m}`, m === p.model ? h('span', { class: 'k' }, '默认') : null));
    }
    if (hits.length > maxShow) {
      list.appendChild(h('div', { class: 'picker-empty' }, `共 ${hits.length} 项匹配，仅显示前 ${maxShow} 项`));
    }
    if (!hits.length) {
      list.appendChild(h('div', { class: 'picker-empty' }, '没有匹配的模型'));
    }
  };

  renderList('');
  if (search) search.addEventListener('input', () => renderList(search.value));

  const r = anchor.getBoundingClientRect();
  openMenu([
    ...(search ? [search] : []),
    list,
    h('hr'),
    h('button', {
      class: !curProvider ? 'on' : '', role: 'menuitem',
      onclick: () => { closeMenu(); setS({ providerId: 'demo', model: '' }); },
    }, (!curProvider ? '✓ ' : '   ') + '演示模式（内置示例）'),
    h('button', {
      role: 'menuitem',
      onclick: () => { closeMenu(); openSettings('providers'); },
    }, '⚙ 管理模型服务…'),
  ], r.left, r.bottom + 4, 'picker', anchor);
  search?.focus();
}

export function renderTabBody(tab: Tab): HTMLElement {
  if (tab.kind === 'reference') return renderReference(tab);
  const s = tab.settings;
  const isRun = running.has(tab.id);
  const provider = getProvider(s.providerId);
  const sel = (value: string, options: [string, string][], onchange: (v: string) => void, title: string) =>
    h('select', { class: 'sel', title, 'aria-label': title, value, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) }, options.map(([v, l]) => h('option', { value: v }, l)));
  // 方向、翻译模式、格式处理互相独立，改一个不会影响另一个
  const setS = (patch: Partial<Tab['settings']>) => { Object.assign(s, patch); save(); renderTab(tab.id); };
  const activeModel = provider ? (s.model || provider.model) : '';
  const modelLabel = provider ? `${provider.name} · ${activeModel || '未填模型'}` : '演示模式（内置示例）';
  const modelBtn = h('button', {
    type: 'button', class: 'sel sel-btn', title: '模型：' + modelLabel, 'aria-label': '模型',
    onclick: () => openTabModelMenu(modelBtn, tab, setS),
  }, h('span', { class: 'sel-lbl' }, modelLabel), h('span', { class: 'sel-caret', html: ICONS.caret }));
  const preset = getPrompt(s.promptId);
  const fmt = FORMAT_MODES.find(f => f.id === s.latex) || FORMAT_MODES[0];
  const dirSel = sel(s.dir, [['auto', '自动（中 ⇄ 英）'], ['en-zh', '英 → 中'], ['zh-en', '中 → 英']], v => setS({ dir: v as Tab['settings']['dir'] }), '翻译方向：自动 = 原文是中文就译成英文，否则译成中文');
  const modeSel = sel(s.promptId, state.prompts.map(p => [p.id, p.name.zh + (p.modified ? '（已修改）' : '') + (p.builtin ? '' : '（自定义）')]), v => setS({ promptId: v }), '翻译模式');
  modeSel.title = '翻译模式：' + preset.desc;
  const fmtSel = sel(s.latex, FORMAT_MODES.map(f => [f.id, f.short]), v => setS({ latex: v as Tab['settings']['latex'] }), '格式处理');
  fmtSel.title = '格式处理：' + fmt.desc;
  const translateBtn = h('button', { class: 'btn sm ' + (isRun ? '' : 'primary'), title: '只翻译这个标签，不影响其他标签（Ctrl/⌘ + Enter）', onclick: () => translateTab(tab.id) }, isRun ? '■ 停止' : '翻译本标签');
  const toolbar = h('div', { class: 'toolbar' },
    dirSel,
    h('span', { class: 'sel-group' }, modeSel,
      h('button', { class: 'btn sm icon ghost', title: '查看 / 修改这个翻译模式的提示词（可重置为原始版本）', 'aria-label': '编辑提示词', onclick: () => openSettings('prompts', s.promptId) }, '✎')),
    modelBtn,
    h('span', { class: 'sel-group' }, fmtSel,
      h('button', { class: 'btn sm icon ghost', title: '几种格式处理方式有什么区别？', 'aria-label': '格式处理说明', onclick: (e: MouseEvent) => openFormatHelp(e.currentTarget as HTMLElement) }, '?')),
    h('div', { class: 'seg', title: '标签内布局' },
      ([['auto', '自动'], ['row', '左右'], ['col', '上下'], ['tgt', '仅译文']] as const).map(([v, l]) => h('button', { class: s.view === v ? 'on' : '', onclick: () => setS({ view: v }) }, l))),
    s.view === 'tgt' ? translateBtn : null);

  // 原文：始终可编辑
  const srcActs = h('div', { class: 'acts' });
  const srcPane = h('section', { class: 'pane pane-src' }, h('header', {}, h('b', {}, '原文'), h('span', { class: 'meta', 'data-role': 'srcmeta' }), srcActs));
  const editor = sourceEditor({
    tab, label: '原文', sync: 'src',
    placeholder: '在此粘贴要翻译的文本（LaTeX、Markdown、普通文本都可以）……\n\n· 直接编辑即可，改动会自动保存\n· Ctrl/⌘ + Enter 翻译\n· 从 PDF 复制的文本可点右上角「整理断行」',
    diffBase: () => { const b = baseOf(tab); return b && b.kind === 'translate' ? { text: b.source, lang: srcLang(tab) } : null; },
    onInput: () => onSourceInput(tab),
    onRepaint: () => updateTabChrome(tab),
    onCaret: i => highlightTarget(tab, i),
  });
  srcPane.appendChild(editor);
  const base = baseOf(tab);
  if (base) srcActs.append(h('button', { class: 'btn sm ghost', title: `让模型说明本标签相对「${base.title}」在意思上的变化`, onclick: () => { if (tab.analysis?.baseId === base.id && tab.analysis.status === 'done' && tab.analysis.sourceSnap === tab.source + '\u0000' + base.source) openAnalysis(tab.id); else analyzeDiff(tab.id); } }, 'AI 解读差异'));
  srcActs.append(h('button', { class: 'btn sm ghost', title: '合并 PDF 复制带来的硬换行和连字符断词', onclick: () => {
    tab.source = fixPdfBreaks(tab.source); editor.textarea.value = tab.source; editor.paint(); onSourceInput(tab); toast('已整理断行');
  } }, '整理断行'));
  if (s.view !== 'tgt') srcActs.append(translateBtn);

  // 译文
  const histSel = tab.runs.length > 1 ? h('select', {
    class: 'sel hist', title: '译文历史', 'aria-label': '译文历史', value: String(tab.current),
    onchange: (e: Event) => { tab.current = +(e.target as HTMLSelectElement).value; save(); renderTab(tab.id); },
  }, tab.runs.map((r, i) => h('option', { value: String(i) }, `v${i + 1} · ${new Date(r.startedAt).toLocaleTimeString().slice(0, 5)} · ${r.model}`)).reverse()) : null;
  const tgtPane = h('section', { class: 'pane pane-tgt' },
    h('header', {}, h('b', {}, '译文'), h('span', { class: 'meta', 'data-role': 'tgtmeta' }),
      h('div', { class: 'acts' }, histSel,
        h('button', { class: 'btn sm ghost', onclick: () => copyResult(tab, false) }, '复制'),
        h('button', { class: 'btn sm ghost', title: '原文与译文逐句交替', onclick: () => copyResult(tab, true) }, '复制双语'))),
    h('div', { class: 'body text', 'data-scroll': tab.id + ':tgt', 'data-sync': 'tgt', 'data-role': 'tgt' }));

  const inner = h('div', { class: 'inner v-' + s.view }, srcPane, innerDivider(tab, srcPane, tgtPane), tgtPane);
  const body = h('div', { class: 'tabbody', 'data-tab': tab.id }, toolbar, h('div', { 'data-role': 'banner' }), inner);
  wireBody(body);
  fillSource(tab, body);
  fillTarget(tab, body);
  updateTabChrome(tab, body);
  return body;
}

function renderReference(tab: Tab): HTMLElement {
  const pane = h('section', { class: 'pane pane-src', style: { flex: '1 1 0px' } }, h('header', {}, h('b', {}, '参考稿'), h('span', { class: 'meta', 'data-role': 'srcmeta' })));
  pane.appendChild(sourceEditor({
    tab, label: '参考稿', sync: 'tgt',
    placeholder: '粘贴参考文本，例如你的中文初稿。\n\n设为对比基准（右键标签）后，其他标签的译文会与它比较，用来检查英文润色稿有没有漏掉或多出信息。',
    diffBase: () => { const b = baseOf(tab); const bt = b ? tgtTextOf(b) : null; return bt ? { text: bt, lang: /[一-鿿]/.test(tab.source) ? 'zh' : 'en' } : null; },
    onInput: () => onSourceInput(tab),
    onRepaint: () => updateTabChrome(tab),
  }));
  const toolbar = h('div', { class: 'toolbar' },
    h('span', { class: 'hint' }, '参考稿不翻译。设为对比基准后，其他标签的译文会与它逐词比较。'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn sm', onclick: () => { tab.kind = 'translate'; save(); renderTab(tab.id); refreshTabHandle(tab.id); } }, '转为翻译标签'));
  const body = h('div', { class: 'tabbody', 'data-tab': tab.id }, toolbar, h('div', { 'data-role': 'banner' }), h('div', { class: 'inner' }, pane));
  wireBody(body);
  fillSource(tab, body);
  updateTabChrome(tab, body);
  return body;
}

function innerDivider(tab: Tab, srcPane: HTMLElement, tgtPane: HTMLElement): HTMLElement {
  const ratio = tab.innerRatio || 0.5;
  srcPane.style.flex = `${ratio} 1 0px`;
  tgtPane.style.flex = `${1 - ratio} 1 0px`;
  const div = h('div', { class: 'inner-div', title: '拖动调整原文/译文比例 · 双击还原', role: 'separator' });
  div.addEventListener('dblclick', () => { tab.innerRatio = 0.5; srcPane.style.flex = '0.5 1 0px'; tgtPane.style.flex = '0.5 1 0px'; save(); });
  div.addEventListener('pointerdown', e => {
    e.preventDefault();
    const inner = div.parentElement!;
    const row = getComputedStyle(inner).flexDirection === 'row';
    const rect = inner.getBoundingClientRect();
    div.classList.add('drag');
    document.body.classList.add('resizing', row ? 'rz-col' : 'rz-row');
    const move = (ev: PointerEvent) => {
      const r = Math.max(0.15, Math.min(0.85, row ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height));
      tab.innerRatio = r;
      srcPane.style.flex = `${r} 1 0px`; tgtPane.style.flex = `${1 - r} 1 0px`;
    };
    const up = () => { div.classList.remove('drag'); document.body.classList.remove('resizing', 'rz-col', 'rz-row'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return div;
}

function wireBody(body: HTMLElement): void {
  // 悬停译文某段 → 原文对应段落在高亮底层上标黄
  let last: number | null = null;
  const paintSrc = (i: number | null) => {
    if (i === last) return;
    last = i;
    ($('.src-wrap', body) as SrcEditor | null)?.paint({ hl: i });
  };
  body.addEventListener('mouseover', e => {
    const sp = (e.target as HTMLElement).closest('[data-role="tgt"] .s[data-i]') as HTMLElement | null;
    $$('.s.hl', body).forEach(x => x.classList.remove('hl'));
    if (sp) sp.classList.add('hl');
    paintSrc(sp ? +sp.dataset.i! : null);
  });
  body.addEventListener('mouseleave', () => { $$('.s.hl', body).forEach(x => x.classList.remove('hl')); paintSrc(null); });
  $$('[data-sync]', body).forEach(el => el.addEventListener('scroll', () => syncScroll(el), { passive: true }));
}

// ---------------------------------------------------------------------------
// 填充原文 / 译文
// ---------------------------------------------------------------------------
/** 原文编辑器只重画高亮底层（差异 / 段落高亮），文本框本身不动，光标不受影响 */
export function fillSource(_tab: Tab, body: HTMLElement): void {
  ($('.src-wrap', body) as SrcEditor | null)?.paint();
}

/** 原文改动：保存、刷新状态；若它是对比基准，其他标签的差异稍后一起刷新 */
let othersTimer: ReturnType<typeof setTimeout> | undefined;
function onSourceInput(tab: Tab): void {
  save();
  updateTabChrome(tab);
  if (state.ui.diff && ws().baseTabId === tab.id) {
    clearTimeout(othersTimer);
    othersTimer = setTimeout(() => refreshOthers(tab.id), 300);
  }
}

/** 光标所在段落 → 高亮对应译文段落，并滚动到可见位置 */
function highlightTarget(tab: Tab, i: number): void {
  const body = $(`.tabbody[data-tab="${tab.id}"]`);
  if (!body) return;
  $$('[data-role="tgt"] .s.hl', body).forEach(x => x.classList.remove('hl'));
  const t = $(`[data-role="tgt"] .s[data-i="${i}"]`, body);
  const box = $('[data-role="tgt"]', body);
  if (!t || !box) return;
  t.classList.add('hl');
  const r = t.getBoundingClientRect(), br = box.getBoundingClientRect();
  if (r.top < br.top || r.bottom > br.bottom) box.scrollTop += r.top - br.top - 24;
}

/** 按段渲染；段内换行原样保留，悬停时原文与译文的同一段一起高亮 */
function renderSegs(segs: Segment[], field: 'src' | 'tgt', linked: boolean, opts: { running?: boolean; lastIdx?: number } = {}): string {
  return segs.map((sg, i) => {
    const text = sg[field];
    if (field === 'tgt' && !text && opts.running) return '';
    const cls = 's' + (field === 'tgt' && sg.demoMiss ? ' note' : '') + (i === opts.lastIdx ? ' typing' : '');
    const inner = text ? segHTML(text) : `<span class="muted">${field === 'tgt' ? '（此段处理后为空）' : '（空）'}</span>`;
    return `<p class="para"><span class="${cls}"${linked ? ` data-i="${i}"` : ''}>${inner}</span></p>`;
  }).join('');
}

export function fillTarget(tab: Tab, body: HTMLElement): void {
  const el = $('[data-role="tgt"]', body);
  if (!el) return;
  const r = currentRun(tab);
  if (!r) {
    const demo = !getProvider(tab.settings.providerId);
    el.innerHTML = `<div class="empty">点「翻译本标签」开始，或按 <span class="kbd">Ctrl/⌘</span> + <span class="kbd">Enter</span><br>只会翻译这个标签，不影响其他标签${demo ? '<br>当前为演示模式：内置的 3 个示例版本可直接翻译' : ''}</div>`;
    delete el.dataset.stat;
    return;
  }
  const lang = tgtLang(tab);
  const base = baseOf(tab);
  const bt = base ? tgtTextOf(base) : null;
  if (base && bt && r.status !== 'running') {
    const d = diffHTML(bt, displayText(r.segs, 'tgt'), lang);
    el.innerHTML = `<div class="diffview">${d.html}</div>`;
    el.dataset.stat = `相对「${base.title}」${base.kind === 'reference' ? '' : '的译文'} +${d.ins} −${d.del} 词`;
    return;
  }
  delete el.dataset.stat;
  const isRun = r.status === 'running';
  let lastIdx = -1;
  if (isRun) r.segs.forEach((sg, i) => { if (sg.tgt) lastIdx = i; });
  const html = renderSegs(r.segs, 'tgt', !isStale(tab), { running: isRun, lastIdx });
  el.innerHTML = html || `<div class="empty">${r.reasoning ? '模型正在思考……' : '正在等待模型返回……'}</div>`;
}

export function updateTabChrome(tab: Tab, body?: HTMLElement | null): void {
  body = body || $(`.tabbody[data-tab="${tab.id}"]`);
  if (!body) return;
  const srcEl = $('[data-role="src"]', body);
  const srcMeta = $('[data-role="srcmeta"]', body);
  if (srcMeta) {
    const b = baseOf(tab);
    const stat = srcEl?.dataset.stat && b ? `相对「${b.title}」${tab.kind === 'reference' ? '的译文' : ''} ${srcEl.dataset.stat}（绿 = 新增，红线 = 删除）` : '';
    srcMeta.title = stat ? '差异直接画在可编辑的原文上：绿色底 = 相对基准新增的词；红色竖线 = 这里删掉了基准中的词（删掉的内容见译文侧或基准标签）' : '';
    if (tab.kind === 'reference') srcMeta.textContent = stat || `${tab.source.length} 字符 · 不翻译`;
    else {
      const n = sourceSegs(tab).segs.length;
      const parts = [`${n} 段`, `${tab.source.length} 字符`];
      if (tab.source.trim()) {
        const d = resolveDir(tab) === 'zh-en' ? '中 → 英' : '英 → 中';
        parts.push(tab.settings.dir === 'auto' ? `自动识别：${d}` : d);
      }
      srcMeta.textContent = stat || parts.join(' · ');
    }
  }
  const r = currentRun(tab);
  const tgtMeta = $('[data-role="tgtmeta"]', body);
  if (tgtMeta) {
    let meta = '';
    if (r) {
      const nText = r.segs.length;
      const done = r.segs.filter(x => x.tgt).length;
      const cost = r.cost ? ` · ${r.cost.currency === 'CNY' ? '¥' : '$'}${r.cost.value < 0.01 ? r.cost.value.toFixed(4) : r.cost.value.toFixed(3)}` : '';
      const cached = r.cachedParas ? ` · 缓存 ${r.cachedParas}/${r.totalParas} 段` : '';
      const hit = r.usage.cacheHit ? `（命中 ${r.usage.cacheHit}）` : '';
      meta = r.status === 'running' ? (r.reasoning && !done ? '思考中…' : `翻译中 ${done}/${nText} 段…`) + cached
        : r.status === 'done' ? `完成 · ${r.model} · ${r.usage.input}${hit}→${r.usage.output} tokens${cost} · ${(((r.finishedAt ?? r.startedAt) - r.startedAt) / 1000).toFixed(1)}s${cached}`
        : r.status === 'aborted' ? '已停止' : '出错';
      const st = $('[data-role="tgt"]', body)?.dataset.stat;
      if (st) meta = st;
    }
    tgtMeta.textContent = meta;
  }
  const banner = $('[data-role="banner"]', body)!;
  banner.replaceChildren();
  if (r?.status === 'error') {
    banner.appendChild(h('div', { class: 'banner err' }, '⚠ ' + r.error,
      h('button', { class: 'btn sm', onclick: () => openSettings('providers') }, '检查模型服务'),
      h('button', { class: 'btn sm', onclick: () => translateTab(tab.id) }, '重试')));
  } else if (r && isStale(tab) && r.status !== 'running' && tab.kind === 'translate') {
    banner.appendChild(h('div', { class: 'banner warn' }, '原文或设置已修改，译文已过期（重新翻译时只会重翻改动过的段落）',
      h('button', { class: 'btn sm', onclick: () => translateTab(tab.id) }, '重新翻译')));
  } else if (state.ui.diff && ws().baseTabId === tab.id) {
    banner.appendChild(h('div', { class: 'banner info' }, '★ 这是对比基准，其他标签相对它高亮差异（右键标签可更换基准）'));
  }
  refreshTabHandle(tab.id);
}

/** 重新渲染某个标签（保留滚动位置）；差异模式下基准变化会连带刷新其他标签 */
export function renderTab(tabId: string): void {
  const tab = tabsOf()[tabId];
  const body = $(`.tabbody[data-tab="${tabId}"]`);
  if (!tab || !body) { refreshTabHandle(tabId); return; }
  const scrolls: Record<string, number> = {};
  $$('[data-scroll]', body).forEach(el => { scrolls[el.dataset.scroll!] = el.scrollTop; });
  const nb = renderTabBody(tab);
  body.replaceWith(nb);
  $$('[data-scroll]', nb).forEach(el => { const v = scrolls[el.dataset.scroll!]; if (v != null) el.scrollTop = v; });
  if (state.ui.diff && ws().baseTabId === tabId) refreshOthers(tabId);
}
export function refreshOthers(exceptId: string): void {
  for (const id of Object.keys(tabsOf())) {
    if (id === exceptId) continue;
    const b = $(`.tabbody[data-tab="${id}"]`);
    if (b) { fillSource(tabsOf()[id], b); fillTarget(tabsOf()[id], b); updateTabChrome(tabsOf()[id], b); }
  }
}

const pending = new Set<string>();
export function scheduleTgt(tabId: string): void {
  if (pending.has(tabId)) return;
  pending.add(tabId);
  requestAnimationFrame(() => {
    pending.delete(tabId);
    const tab = tabsOf()[tabId], body = $(`.tabbody[data-tab="${tabId}"]`);
    if (!tab || !body) return;
    const el = $('[data-role="tgt"]', body);
    const follow = el && el.scrollTop > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    fillTarget(tab, body);
    updateTabChrome(tab, body);
    if (el && follow) el.scrollTop = el.scrollHeight;
  });
}

let syncLock: { el: HTMLElement; t: number } | null = null;
function syncScroll(el: HTMLElement): void {
  if (!state.ui.sync) return;
  const now = performance.now();
  if (syncLock && syncLock.el !== el && now - syncLock.t < 150) return;
  syncLock = { el, t: now };
  const max = el.scrollHeight - el.clientHeight;
  const ratio = max > 0 ? el.scrollTop / max : 0;
  $$(`[data-sync="${el.dataset.sync}"]`).forEach(o => {
    if (o === el) return;
    const m = o.scrollHeight - o.clientHeight;
    if (m > 0) o.scrollTop = ratio * m;
  });
}

function copyResult(tab: Tab, bilingual: boolean): void {
  const r = currentRun(tab);
  if (!r) { toast('还没有译文'); return; }
  const text = bilingual
    ? r.segs.map(s => s.src + '\n' + s.tgt).join('\n\n')
    : displayText(r.segs, 'tgt');
  copyText(text, bilingual ? '已复制双语对照' : '已复制译文');
}
