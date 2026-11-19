import type { FormatMode, PromptLang, PromptPreset, Provider } from '../types';
import { BLANK_PROMPT, BUILTIN_PROMPTS, FORMAT_MODES, MARKUP_RULES } from '../presets/prompts';
import { PROVIDER_TEMPLATES, isLocalProvider, pickDefaultModel, providerFromTemplate, templateOf } from '../presets/providers';
import { buildSegments } from '../core/segment';
import { buildUser, macroHits } from '../core/prompt';
import { uid } from '../core/text';
import { balance, chat, listModels } from '../llm';
import { dbClear, dbCount, requestPersist, storageInfo } from '../store/db';
import { activateProvider, focusedTab, getPrompt, initialState, providerUsage, replaceState, resolveDir, save, serialize, setProviderModel, state } from '../store/state';
import { systemFor } from '../app/translate';
import { $, ICONS, closeMenu, download, h, openMenu, toast } from './dom';
import { renderAll } from './layout';
import { applyAppearance } from './topbar';

type Section = 'providers' | 'prompts' | 'format' | 'glossary' | 'appearance' | 'data';
let section: Section = 'providers';
const expandedProviders = new Set<string>();
const expandedAdvanced = new Set<string>();
const needsSetup = (p: Provider) => !p.baseUrl.trim() || !p.model.trim() || (!isLocalProvider(p.kind) && !p.apiKey.trim());
export const settingsOpen = () => !!$('.modal-bg.settings');

export function openSettings(sec?: Section, promptId?: string): void {
  closeMenu();
  if (sec) section = sec;
  if (promptId) promptSel = promptId;
  const wasOpen = settingsOpen();
  if (!wasOpen) {
    expandedProviders.clear();
    for (const p of state.providers) if (needsSetup(p)) expandedProviders.add(p.id);
    const liveIds = new Set(state.providers.map(p => p.id));
    for (const id of expandedAdvanced) if (!liveIds.has(id)) expandedAdvanced.delete(id);
  }
  const keepScroll = $('.modal-bg.settings .content')?.scrollTop ?? 0;
  $('.modal-bg.settings')?.remove();
  const nav: [Section, string][] = [['providers', '模型服务'], ['prompts', '翻译模式（提示词）'], ['format', '格式处理'], ['glossary', '术语表'], ['appearance', '外观'], ['data', '数据与隐私']];
  const content = h('div', { class: 'content' });
  const bg = h('div', { class: 'modal-bg settings', onclick: (e: Event) => { if (e.target === bg) closeSettings(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': '设置' },
      h('nav', {}, h('div', { class: 'ttl' }, '设置'), nav.map(([k, l]) => h('button', { class: section === k ? 'on' : '', onclick: () => { section = k; openSettings(); } }, l))),
      content));
  content.appendChild(h('button', { class: 'btn sm icon ghost close', title: '关闭（Esc）', 'aria-label': '关闭', html: ICONS.x, onclick: closeSettings }));
  ({ providers: secProviders, prompts: secPrompts, format: secFormat, glossary: secGlossary, appearance: secAppearance, data: secData })[section](content);
  document.body.appendChild(bg);
  if (sec === undefined) content.scrollTop = keepScroll;
}
export function closeSettings(): void { closeMenu(); $('.modal-bg.settings')?.remove(); renderAll(); }

const field = (label: string, ...control: (HTMLElement | null)[]) => h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'ctl' }, control));
const input = (value: string | number | null, oninput: (v: string) => void, attrs: Record<string, unknown> = {}) =>
  h('input', { class: 'input', value: value ?? '', spellcheck: 'false', ...attrs, oninput: (e: Event) => oninput((e.target as HTMLInputElement).value) });
const select = (value: string, options: [string, string][], onchange: (v: string) => void) =>
  h('select', { class: 'sel', value, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) }, options.map(([v, l]) => h('option', { value: v }, l)));
const check = (checked: boolean, label: string, onchange: (v: boolean) => void) =>
  h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }), ' ' + label);

// ---------------------------------------------------------------------------
// 模型服务
// ---------------------------------------------------------------------------
function openProviderModelPicker(anchor: HTMLElement, p: Provider, onPick: (model: string) => void, onManual?: () => void): void {
  const all = [...new Set([...(p.model ? [p.model] : []), ...p.models].filter(Boolean))];
  const list = h('div', { class: 'picker-list' });
  const search = all.length > 8
    ? (h('input', { class: 'input picker-search', placeholder: `搜索模型（共 ${all.length} 个）…`, spellcheck: 'false' }) as HTMLInputElement)
    : null;
  let firstMatch: string | null = null;
  const renderList = (query: string) => {
    list.replaceChildren();
    const trimmed = query.trim();
    const q = trimmed.toLowerCase();
    const matches = q ? all.filter(m => m.toLowerCase().includes(q)) : all;
    firstMatch = matches[0] ?? null;
    for (const m of matches) {
      const isCur = m === p.model;
      const isCustom = !p.models.includes(m);
      list.appendChild(h('button', {
        class: isCur ? 'on' : '', role: 'menuitem',
        onclick: () => { closeMenu(); onPick(m); },
      }, (isCur ? '✓ ' : '   ') + m, isCustom ? h('span', { class: 'k' }, '当前') : null));
    }
    if (trimmed && !all.includes(trimmed)) {
      list.appendChild(h('button', { role: 'menuitem', onclick: () => { closeMenu(); onPick(trimmed); } }, `使用自定义模型 “${trimmed}”`));
    }
    if (!list.childNodes.length) {
      list.appendChild(h('div', { class: 'picker-empty' }, '没有匹配的模型'));
    }
  };
  renderList('');
  if (search) {
    search.addEventListener('input', () => renderList(search.value));
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = firstMatch || search.value.trim();
        if (pick) { closeMenu(); onPick(pick); }
      }
    });
  }
  const items: HTMLElement[] = [search, list].filter(Boolean) as HTMLElement[];
  if (onManual) {
    items.push(h('hr'), h('button', { role: 'menuitem', onclick: () => { closeMenu(); onManual(); } }, '✎ 手动输入模型名…'));
  }
  const rect = anchor.getBoundingClientRect();
  openMenu(items, rect.left, rect.bottom + 4, 'picker', anchor);
  const menu = $('.menu.picker');
  if (menu) {
    const mw = Math.max(260, Math.round(rect.width));
    menu.style.minWidth = mw + 'px';
    const mr = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - mr.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - mr.height - 8)) + 'px';
  }
  search?.focus();
}

function secProviders(c: HTMLElement): void {
  c.append(h('h3', {}, '模型服务'),
    h('p', { class: 'hint' }, 'API Key 只保存在本浏览器，请求从浏览器直接发往你填写的地址。已为各服务预设适合翻译的 temperature / 思考强度；点卡片上的「切换使用」或模型胶囊即可直接切换。'));
  const tplSel = select('deepseek', PROVIDER_TEMPLATES.map(t => [t.kind, t.name]), () => {});
  const allExpanded = state.providers.length > 0 && state.providers.every(p => expandedProviders.has(p.id));
  c.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', {}, '从模板添加：'), tplSel,
    h('button', { class: 'btn sm primary', onclick: () => {
      const p = providerFromTemplate(templateOf((tplSel as HTMLSelectElement).value), uid());
      state.providers.push(p);
      // 仍在演示模式的标签自动切到新服务
      for (const w of state.workspaces) for (const t of Object.values(w.tabs)) if (t.kind === 'translate' && t.settings.providerId === 'demo') { t.settings.providerId = p.id; t.settings.model = ''; }
      expandedProviders.clear();
      expandedProviders.add(p.id);
      save(); openSettings();
      const card = $(`.card.provider[data-provider="${p.id}"]`);
      card?.scrollIntoView({ block: 'nearest' });
      const target = !p.baseUrl.trim() ? '[data-focus="url"]' : !isLocalProvider(p.kind) ? '[data-focus="key"]' : '[data-focus="model"]';
      (card?.querySelector(target) as HTMLInputElement | null)?.focus();
    } }, '添加'),
    state.providers.length > 1 ? h('span', { class: 'spacer' }) : null,
    state.providers.length > 1 ? h('button', { class: 'btn sm ghost', onclick: () => {
      if (allExpanded) expandedProviders.clear();
      else state.providers.forEach(p => expandedProviders.add(p.id));
      openSettings();
    } }, allExpanded ? '全部收起' : '全部展开') : null)));
  if (!state.providers.length) c.append(h('div', { class: 'empty' }, '还没有模型服务。推荐先添加 DeepSeek：注册后在 platform.deepseek.com 创建 API Key，粘贴到下方即可。'));
  for (const p of state.providers) c.append(providerCard(p));

  const proxyOpen = !!(state.proxy.token || (state.proxy.url && state.proxy.url !== '/api/proxy') || state.providers.some(p => p.useProxy));
  c.append(h('details', { class: 'card proxy-card', ...(proxyOpen ? { open: true } : {}) },
    h('summary', {}, h('b', {}, '代理设置（可选）'), h('span', { class: 'hint' }, '仅浏览器直连遇跨域（CORS）限制时需要')),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, '部署到 Cloudflare Pages 时，本项目自带一个只转发、不记录的代理函数 /api/proxy：在 Cloudflare 项目设置里添加环境变量 PROXY_ALLOWED_HOSTS（如 api.deepseek.com），然后在上方服务卡片的高级设置中勾选「通过代理转发」。'),
    field('代理地址', input(state.proxy.url, v => { state.proxy.url = v; save(); }, { placeholder: '/api/proxy' })),
    field('访问口令', input(state.proxy.token, v => { state.proxy.token = v; save(); }, { type: 'password', placeholder: '与 PROXY_TOKEN 一致，未设置可留空', autocomplete: 'off' }))));
}

function providerCard(p: Provider): HTMLElement {
  const tpl = templateOf(p.kind);
  const expanded = expandedProviders.has(p.id);
  const usage = providerUsage(p.id);
  const isActive = usage === 'all' || usage === 'focused';
  const status = h('span', { class: 'pill' }, '未测试');
  const setStatus = (cls: string, text: string) => { status.className = 'pill ' + cls; status.textContent = text; };

  const headTitle = h('b', {}, p.name || '未命名服务');
  const modelBadgeSlot = h('span', { class: 'model-badge-slot' });
  const keyWarn = h('span', { class: 'pill warn-pill' }, '未填 Key');
  const metaSummary = h('span', { class: 'hint hide-sm' });
  const advSummary = h('span', { class: 'hint' });

  let manualMode = p.models.length === 0;
  let modelsTa: HTMLTextAreaElement | null = null;
  const modelCtl = h('div', { class: 'ctl' });

  const syncHeader = () => {
    headTitle.textContent = p.name || '未命名服务';
    keyWarn.style.display = !isLocalProvider(p.kind) && !p.apiKey.trim() ? '' : 'none';
    const tempText = p.protocol === 'anthropic'
      ? (p.effort ? `思考 ${p.effort}` : 'Anthropic')
      : (p.temperature != null ? `温度 ${p.temperature}` : '默认温度');
    metaSummary.textContent = expanded ? '' : tempText;
    advSummary.textContent = [
      p.protocol === 'anthropic' ? `思考强度 ${p.effort || '不设置'}` : (p.temperature != null ? `温度 ${p.temperature}` : '默认温度'),
      `并发 ${p.concurrency}`,
      p.keyMode === 'session' ? '仅本次会话' : '本地保存',
      p.useProxy ? '代理' : '',
    ].filter(Boolean).join(' · ');

    modelBadgeSlot.replaceChildren();
    if (p.models.length > 0) {
      const pillBtn = h('button', {
        type: 'button', class: 'model-pill', title: '点击直接切换默认模型',
        onclick: (e: Event) => {
          e.stopPropagation();
          openProviderModelPicker(pillBtn, p, m => {
            setProviderModel(p, m); save(); renderAll(); syncHeader(); renderModelCtl();
          });
        },
      }, h('span', { class: 'sel-lbl' }, p.model || '选择模型'), h('span', { class: 'sel-caret', html: ICONS.caret }));
      modelBadgeSlot.appendChild(pillBtn);
    } else if (p.model) {
      modelBadgeSlot.appendChild(h('span', { class: 'pill' }, p.model));
    } else {
      modelBadgeSlot.appendChild(h('button', {
        type: 'button', class: 'pill warn-pill', title: '点击填写默认模型',
        onclick: (e: Event) => {
          e.stopPropagation();
          expandedProviders.add(p.id);
          openSettings();
          const card = $(`.card.provider[data-provider="${p.id}"]`);
          (card?.querySelector('[data-focus="model"]') as HTMLInputElement | null)?.focus();
        },
      }, '未填模型'));
    }
  };

  const onPickModel = (next: string, fromInput = false) => {
    setProviderModel(p, next);
    save();
    syncHeader();
    if (!fromInput) {
      renderAll();
      if (expanded) renderModelCtl();
    }
  };

  const run = async (label: string, fn: () => Promise<string>, onError?: (msg: string) => string) => {
    setStatus('', label + '…');
    try { setStatus('ok', await fn()); }
    catch (e) {
      const msg = (e as Error).message || String(e);
      setStatus('bad', (onError ? onError(msg) : msg).slice(0, 160));
    }
  };

  const fetchBtn = h('button', {
    type: 'button', class: 'btn sm',
    onclick: async () => {
      fetchBtn.disabled = true;
      try {
        await run('获取中', async () => {
          const ids = await listModels(p, state.proxy);
          if (!ids.length) {
            manualMode = true;
            renderModelCtl();
            return '未返回模型，可手动输入';
          }
          p.models = ids;
          if (modelsTa) modelsTa.value = ids.join(', ');
          if (!p.model.trim()) setProviderModel(p, pickDefaultModel(ids, p.kind));
          save();
          renderAll();
          manualMode = false;
          renderModelCtl();
          syncHeader();
          return `已获取 ${ids.length} 个模型，可直接选择`;
        }, msg => {
          if (!p.models.length) { manualMode = true; renderModelCtl(); }
          return msg.slice(0, 130) + '（可手动输入模型名）';
        });
      } finally {
        fetchBtn.disabled = false;
      }
    },
  }, '获取模型') as HTMLButtonElement;

  const focusModelInput = () => {
    (modelCtl.querySelector('[data-focus="model"]') as HTMLInputElement | null)?.focus();
  };

  const renderModelCtl = () => {
    modelCtl.replaceChildren();
    if (!manualMode && p.models.length > 0) {
      const trigger = h('button', {
        type: 'button', class: 'sel sel-btn model-trigger', title: '点击从已获取的模型列表中选择',
        onclick: () => openProviderModelPicker(trigger, p, m => onPickModel(m), () => {
          manualMode = true; renderModelCtl(); focusModelInput();
        }),
      },
        h('span', { class: 'sel-lbl' }, p.model || '请选择模型', ' ', h('span', { class: 'muted' }, `(${p.models.length})`)),
        h('span', { class: 'sel-caret', html: ICONS.caret }));
      modelCtl.append(
        trigger,
        fetchBtn,
        h('button', { type: 'button', class: 'btn sm', title: '改为手动输入模型名', onclick: () => { manualMode = true; renderModelCtl(); focusModelInput(); } }, '手动输入'),
      );
    } else {
      modelCtl.append(
        input(p.model, v => onPickModel(v.trim(), true), { 'data-focus': 'model', placeholder: tpl.model || '输入模型名，或点右侧「获取模型」' }),
        fetchBtn,
      );
      if (p.models.length > 0) {
        modelCtl.append(h('button', { type: 'button', class: 'btn sm', onclick: () => { manualMode = false; renderModelCtl(); } }, '从列表选'));
      }
    }
  };

  const switchBtn = usage === 'all'
    ? h('span', { class: 'pill ok', onclick: (e: Event) => e.stopPropagation() }, '✓ 当前使用')
    : h('button', {
      type: 'button', class: 'btn sm' + (usage === 'focused' ? ' on' : ''),
      title: usage === 'focused' ? '当前焦点标签正在使用；点击将当前工作区所有标签统一切换到此服务' : '将当前工作区切换到此模型服务',
      onclick: (e: Event) => {
        e.stopPropagation();
        activateProvider(p.id);
        save(); renderAll(); openSettings();
        toast(`已切换到「${p.name}${p.model ? ' · ' + p.model : ''}」`);
      },
    }, usage === 'focused' ? '✓ 当前标签' : '切换使用');

  const toggleExpand = () => {
    if (expandedProviders.has(p.id)) expandedProviders.delete(p.id);
    else expandedProviders.add(p.id);
    openSettings();
  };

  const head = h('div', { class: 'provider-head', onclick: toggleExpand },
    h('span', { class: 'chev' + (expanded ? ' open' : ''), html: ICONS.caret }),
    headTitle,
    modelBadgeSlot,
    keyWarn,
    metaSummary,
    h('span', { class: 'spacer' }),
    switchBtn,
    h('button', {
      type: 'button', class: 'btn sm ghost',
      onclick: (e: Event) => { e.stopPropagation(); toggleExpand(); },
    }, expanded ? '收起' : '详情'));

  syncHeader();

  if (!expanded) {
    return h('div', { class: 'card provider' + (isActive ? ' active' : ''), 'data-provider': p.id }, head);
  }

  const keyInput = input(p.apiKey, v => { p.apiKey = v; save(); syncHeader(); }, {
    'data-focus': 'key', type: 'password',
    placeholder: isLocalProvider(p.kind) ? '本地模型可留空' : 'sk-…', autocomplete: 'off',
  }) as HTMLInputElement;

  modelsTa = h('textarea', {
    class: 'ta', rows: '2', value: p.models.join(', '),
    placeholder: '可选：多个模型用逗号分隔，工具条和顶部胶囊可随时切换',
    oninput: (e: Event) => {
      p.models = (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      if (!p.models.length) manualMode = true;
      save(); renderModelCtl(); syncHeader();
    },
  }) as HTMLTextAreaElement;

  renderModelCtl();

  const price = p.price;
  const priceInput = (k: 'input' | 'output' | 'cacheHit') => input(price ? price[k] : '', v => {
    const n = parseFloat(v);
    p.price = p.price || { input: 0, output: 0, cacheHit: 0, currency: p.kind === 'deepseek' ? 'CNY' : 'USD' };
    p.price[k] = isNaN(n) ? 0 : n;
    if (!p.price.input && !p.price.output && !p.price.cacheHit) p.price = null;
    save();
  }, { type: 'number', min: '0', step: '0.01', style: { width: '90px' } });

  const advDetails = h('details', {
    class: 'adv-settings',
    ...(expandedAdvanced.has(p.id) ? { open: true } : {}),
    ontoggle: (e: Event) => {
      if ((e.currentTarget as HTMLDetailsElement).open) expandedAdvanced.add(p.id);
      else expandedAdvanced.delete(p.id);
    },
  },
    h('summary', {}, h('span', {}, '高级设置'), advSummary),
    h('div', { style: { marginTop: '8px' } },
      field('名称', input(p.name, v => { p.name = v; save(); syncHeader(); })),
      p.protocol === 'anthropic'
        ? field('思考强度', select(p.effort, [['low', 'low（预设：快、省）'], ['medium', 'medium'], ['high', 'high'], ['', '不设置（旧模型请选此项）']], v => { p.effort = v as Provider['effort']; save(); syncHeader(); }))
        : field('temperature',
          input(p.temperature, v => { const n = parseFloat(v); p.temperature = isNaN(n) ? null : n; save(); syncHeader(); }, { type: 'number', step: '0.1', min: '0', max: '2', placeholder: '留空 = 服务默认值', style: { width: '120px' } }),
          h('span', { class: 'hint' }, p.kind === 'deepseek' ? '已按官方建议预设 1.3，一般无需修改' : '已预设 0.3（适合忠实翻译），留空 = 服务默认')),
      field('可选模型', modelsTa),
      field('并发数', input(p.concurrency, v => { p.concurrency = Math.max(1, Math.min(6, parseInt(v) || 2)); save(); syncHeader(); }, { type: 'number', min: '1', max: '6', style: { width: '80px' } })),
      field('单价（每百万 tokens）',
        h('span', { class: 'hint' }, '输入'), priceInput('input'), h('span', { class: 'hint' }, '缓存命中'), priceInput('cacheHit'), h('span', { class: 'hint' }, '输出'), priceInput('output'),
        select(price?.currency || (p.kind === 'deepseek' ? 'CNY' : 'USD'), [['CNY', '¥ 人民币'], ['USD', '$ 美元']], v => { if (p.price) { p.price.currency = v as 'CNY' | 'USD'; save(); } })),
      field('Key 保存方式', select(p.keyMode, [['persist', '保存在本浏览器'], ['session', '仅本次会话（关闭浏览器后需重新填写）']], v => { p.keyMode = v as Provider['keyMode']; save(); syncHeader(); })),
      field('网络', check(p.useProxy, '通过代理转发（需先部署代理，见下方）', v => { p.useProxy = v; save(); syncHeader(); }))));

  const body = h('div', { class: 'provider-body' },
    tpl.hint ? h('p', { class: 'hint', style: { marginTop: '0' } }, tpl.hint) : null,
    field('Base URL', input(p.baseUrl, v => { p.baseUrl = v.trim(); save(); }, { 'data-focus': 'url', placeholder: 'https://api.example.com/v1' })),
    field('API Key', keyInput, h('button', { type: 'button', class: 'btn sm', onclick: (e: Event) => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; (e.target as HTMLElement).textContent = keyInput.type === 'password' ? '显示' : '隐藏'; } }, '显示')),
    h('div', { class: 'field' }, h('label', {}, '默认模型'), modelCtl),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { type: 'button', class: 'btn sm', onclick: () => {
        if (!p.model.trim()) { setStatus('bad', '请先选择或输入默认模型'); return; }
        run('测试中', async () => {
          const t0 = performance.now(); let out = '';
          await chat(p, p.model, { system: 'Translate the user text into Simplified Chinese. Output only the translation.', user: 'Hello, world.', onText: d => { out += d; } }, state.proxy);
          return `可用 · ${Math.round(performance.now() - t0)}ms · “${out.trim().slice(0, 24)}”`;
        });
      } }, '测试连接'),
      tpl.balance ? h('button', { type: 'button', class: 'btn sm', onclick: () => run('查询中', () => balance(p, state.proxy).then(b => '余额：' + b)) }, '查询余额') : null,
      status,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn sm danger', onclick: () => {
        if (!confirm(`删除模型服务「${p.name}」？`)) return;
        state.providers = state.providers.filter(x => x !== p);
        expandedProviders.delete(p.id);
        expandedAdvanced.delete(p.id);
        for (const w of state.workspaces) for (const t of Object.values(w.tabs)) if (t.settings.providerId === p.id) { t.settings.providerId = state.providers[0]?.id || 'demo'; t.settings.model = ''; }
        save(); renderAll(); openSettings();
      } }, '删除')),
    advDetails);

  return h('div', { class: 'card provider' + (isActive ? ' active' : ''), 'data-provider': p.id }, head, body);
}

// ---------------------------------------------------------------------------
// 翻译模式（提示词）
// ---------------------------------------------------------------------------
let promptSel: string | null = null;
let editLang: PromptLang = 'en';

function previewCard(): HTMLElement | null {
  const t = focusedTab();
  if (!t || t.kind !== 'translate') return null;
  const paras = buildSegments(t.source).slice(0, 4).map(s => s.src);
  const format = state.numbered ? 'numbered' : 'plain';
  const dir = resolveDir(t);
  const sys = systemFor(t, dir, format);
  const user = buildUser(state.promptLang, paras, format);
  const fmt = FORMAT_MODES.find(f => f.id === t.settings.latex) || FORMAT_MODES[0];
  return h('details', { class: 'card' },
    h('summary', {}, h('b', {}, `实际发送预览：当前标签「${t.title}」`), h('span', { class: 'hint' }, `  ${getPrompt(t.settings.promptId).name.zh} · ${dir === 'zh-en' ? '中→英' : '英→中'} · ${fmt.label} · ${state.promptLang === 'en' ? 'English' : '中文'}`)),
    h('div', { class: 'hint', style: { marginTop: '8px' } }, 'system'),
    h('pre', { class: 'ta pre' }, sys),
    h('div', { class: 'hint' }, 'user（前 4 段，示意）'),
    h('pre', { class: 'ta pre' }, user));
}

function secPrompts(c: HTMLElement): void {
  promptSel = promptSel && state.prompts.some(p => p.id === promptSel) ? promptSel : state.prompts[0].id;
  const p = state.prompts.find(x => x.id === promptSel)!;
  const builtin = BUILTIN_PROMPTS.find(b => b.id === p.id);
  const touch = () => { if (p.builtin) p.modified = true; save(); };
  c.append(h('h3', {}, '翻译模式（提示词）'),
    h('p', { class: 'hint' }, '翻译模式决定「怎么翻」：直译检查、通顺阅读、论文表达等。翻译方向（英→中 / 中→英 / 自动）在工具条里单独选择，提示词会自动适配。每个模式都有内容等价的英文版和中文版，可以随意修改；内置模式随时能重置为原始版本。'),
    h('div', { class: 'card' },
      field('发送语言', h('div', { class: 'seg' }, (['en', 'zh'] as const).map(l => h('button', { class: state.promptLang === l ? 'on' : '', onclick: () => { state.promptLang = l; save(); openSettings(); } }, l === 'en' ? 'English 版' : '中文版'))),
        h('span', { class: 'hint' }, '各家模型对英文指令通常执行得更严格')),
      field('按段对照', check(state.numbered, '原文按空行分段、给每段编号（<seg id="1">…）发送，译文与原文逐段对应、悬停联动；关闭后整篇一起发送、整体输出', v => { state.numbered = v; save(); }))));

  const status = !p.builtin ? h('span', { class: 'pill' }, '自定义') : p.modified ? h('span', { class: 'pill warn-pill' }, '内置 · 已修改') : h('span', { class: 'pill ok' }, '内置 · 原始版本');
  const ta = h('textarea', { class: 'ta', rows: '22', value: p.system[editLang], oninput: (e: Event) => { p.system[editLang] = (e.target as HTMLTextAreaElement).value; touch(); } });
  const newPreset = (base: PromptPreset | null) => {
    const n: PromptPreset = base
      ? { ...structuredClone(base), id: uid(), builtin: false, modified: false, name: { zh: base.name.zh + ' 副本', en: base.name.en + ' copy' } }
      : { id: uid(), builtin: false, name: { zh: '我的翻译模式', en: 'My mode' }, desc: '', system: { ...BLANK_PROMPT } };
    state.prompts.push(n); promptSel = n.id; save(); openSettings();
  };
  c.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      select(p.id, state.prompts.map(x => [x.id, x.name.zh + (x.modified ? '（已修改）' : '') + (x.builtin ? '' : '（自定义）')]), v => { promptSel = v; openSettings(); }),
      status,
      h('span', { class: 'spacer' }),
      builtin ? h('button', { class: 'btn sm' + (p.modified ? ' primary' : ''), disabled: !p.modified, title: '把名称、说明和中英文提示词全部恢复为内置的原始版本', onclick: () => {
        if (!confirm(`把「${builtin.name.zh}」重置为原始提示词？你对它的修改会丢失。`)) return;
        Object.assign(p, structuredClone(builtin), { modified: false }); save(); openSettings(); toast('已重置为原始提示词');
      } }, '重置为原始提示词') : null,
      h('button', { class: 'btn sm', onclick: () => newPreset(p) }, '复制为新模式'),
      h('button', { class: 'btn sm', onclick: () => newPreset(null) }, '新建空白模式'),
      !builtin ? h('button', { class: 'btn sm danger', onclick: () => {
        if (!confirm(`删除翻译模式「${p.name.zh}」？`)) return;
        state.prompts = state.prompts.filter(x => x !== p);
        for (const w of state.workspaces) for (const t of Object.values(w.tabs)) if (t.settings.promptId === p.id) t.settings.promptId = BUILTIN_PROMPTS[0].id;
        promptSel = null; save(); openSettings();
      } }, '删除') : null),
    field('名称', input(p.name.zh, v => { p.name.zh = v; touch(); }, { placeholder: '中文名' }), input(p.name.en, v => { p.name.en = v; touch(); }, { placeholder: 'English name' })),
    field('适用场景', input(p.desc, v => { p.desc = v; touch(); }, { placeholder: '一句话说明，鼠标悬停在工具条上的模式名时显示' })),
    h('div', { class: 'row', style: { margin: '12px 0 6px' } },
      h('div', { class: 'seg' }, (['en', 'zh'] as const).map(l => h('button', { class: editLang === l ? 'on' : '', onclick: () => { editLang = l; openSettings(); } }, l === 'en' ? 'English 版' : '中文版'))),
      h('span', { class: 'hint' }, editLang === state.promptLang ? '← 当前发送的就是这个版本' : '（当前发送的是另一个版本，可在上方切换）')),
    ta,
    h('div', { class: 'hint' },
      h('p', {}, '可用变量（翻译时自动填入，也可以不用，完全自己写）：'),
      h('ul', {},
        h('li', {}, h('code', {}, '{{source_lang}} {{target_lang}}'), '：源语言 / 目标语言，随翻译方向变化'),
        h('li', {}, h('code', {}, '{{note}}'), '：歧义注释格式，译成中文时是【注：…】'),
        h('li', {}, h('code', {}, '{{markup_rules}}'), '：格式规则，随工具条里的「格式处理」变化，可在「格式处理」页修改'),
        h('li', {}, h('code', {}, '{{glossary}}'), '：本次原文命中的术语和自定义宏说明；没有命中时整段自动删除'),
        h('li', {}, h('code', {}, '{{output_rules}}'), '：输出格式（按段编号）。去掉它会失去逐段对照，程序会按空行解析输出'),
        h('li', {}, h('code', {}, '{{example}}'), '：与当前方向、格式处理匹配的示例')))));
  const pv = previewCard();
  if (pv) c.append(pv);
}

// ---------------------------------------------------------------------------
// 格式处理
// ---------------------------------------------------------------------------
let ruleLang: PromptLang = 'en';
function secFormat(c: HTMLElement): void {
  c.append(h('h3', {}, '格式处理'),
    h('p', { class: 'hint' }, '原文里常带有与意思无关的格式标记：LaTeX 命令、Markdown 符号、HTML 标签、从 PDF 复制来的引用编号和断行等。格式的去除和保留全部交给模型，按下面的规则处理；本地只按空行分段，原文一个字都不改。每个标签可以在工具条里选择：'),
    h('ul', { class: 'hint' }, FORMAT_MODES.map(f => h('li', {}, h('b', {}, f.label), '：', f.desc))),
    h('div', { class: 'row', style: { margin: '6px 0' } },
      h('span', { class: 'hint' }, '规则语言：'),
      h('div', { class: 'seg' }, (['en', 'zh'] as const).map(l => h('button', { class: ruleLang === l ? 'on' : '', onclick: () => { ruleLang = l; openSettings(); } }, l === 'en' ? 'English 版' : '中文版'))),
      h('span', { class: 'hint' }, ruleLang === state.promptLang ? '← 当前发送的就是这个版本' : '（当前发送的是另一个版本，可在「翻译模式」页切换）')));

  for (const f of FORMAT_MODES) c.append(ruleEditor(f.id, f.label));

  const sampleSrc = String.raw`\section{Method}
We build on prior work~\citep{he2016deep} and define the loss as $\mathcal{L}$.
\textbf{Importantly}, \ours{} is trained end-to-end. % TODO`;
  const macroPreview = h('pre', { class: 'ta pre' });
  const refresh = () => {
    const hits = macroHits(state.macros, sampleSrc);
    macroPreview.textContent = hits.length ? hits.map(([a, b]) => `- ${a} → ${b}`).join('\n') : '（样例里没有用到已定义的宏）';
  };
  c.append(h('h3', { style: { marginTop: '22px' } }, '自定义宏说明'),
    h('p', { class: 'hint' }, '论文里的自定义宏（如 \\ours）模型不认识。每行写一个：\\宏名 = 它代表的文字。原文里出现时，这些说明会和术语表一起写进提示词，由模型自己替换或保留；本地不会展开。原文里自带的 \\newcommand 定义模型本身也能看到。'),
    h('textarea', { class: 'ta', rows: '3', value: state.macros, oninput: (e: Event) => { state.macros = (e.target as HTMLTextAreaElement).value; save(); refresh(); } }),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, '以这段样例为原文时，写进提示词的宏说明：'),
    h('pre', { class: 'ta pre' }, sampleSrc), macroPreview);
  refresh();
}

function ruleEditor(mode: FormatMode, label: string): HTMLElement {
  const cur = state.markupRules[mode]?.[ruleLang];
  const modified = cur != null && cur.trim() !== '' && cur !== MARKUP_RULES[ruleLang][mode];
  const pill = h('span', { class: 'pill ' + (modified ? 'warn-pill' : 'ok') }, modified ? '已修改' : '原始版本');
  const resetBtn = h('button', { class: 'btn sm' + (modified ? ' primary' : ''), disabled: !modified, onclick: () => {
    if (!confirm(`把「${label}」的规则重置为原始版本？`)) return;
    const o = { ...(state.markupRules[mode] || {}) }; delete o[ruleLang];
    state.markupRules[mode] = o; save(); openSettings(); toast('已重置为原始规则');
  } }, '重置为原始规则') as HTMLButtonElement;
  const ta = h('textarea', { class: 'ta', rows: mode === 'model' ? '14' : '6', value: cur ?? MARKUP_RULES[ruleLang][mode], oninput: (e: Event) => {
    const v = (e.target as HTMLTextAreaElement).value;
    state.markupRules[mode] = { ...(state.markupRules[mode] || {}), [ruleLang]: v };
    save();
    const changed = v.trim() !== '' && v !== MARKUP_RULES[ruleLang][mode];
    pill.className = 'pill ' + (changed ? 'warn-pill' : 'ok'); pill.textContent = changed ? '已修改' : '原始版本';
    resetBtn.disabled = !changed; resetBtn.classList.toggle('primary', changed);
  } });
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, label), pill, h('span', { class: 'spacer' }), resetBtn),
    h('div', { class: 'hint', style: { margin: '4px 0 6px' } }, '填进提示词的 {{markup_rules}} 位置。可以按需要增删，例如加上你常遇到的其他格式。'),
    ta);
}

// ---------------------------------------------------------------------------
// 术语表
// ---------------------------------------------------------------------------
function secGlossary(c: HTMLElement): void {
  c.append(h('h3', {}, '术语表'),
    h('p', { class: 'hint' }, '每行一条：原文术语 = 指定译法（也支持 → 或 Tab 分隔）。翻译时只把本次原文里出现的术语注入提示词，节省 token。'),
    h('div', { class: 'card' },
      check(state.glossaryOn, '启用术语表', v => { state.glossaryOn = v; save(); }),
      h('textarea', { class: 'ta', rows: '14', style: { marginTop: '8px' }, value: state.glossary, oninput: (e: Event) => { state.glossary = (e.target as HTMLTextAreaElement).value; save(); } })));
}

// ---------------------------------------------------------------------------
// 外观
// ---------------------------------------------------------------------------
function secAppearance(c: HTMLElement): void {
  const fsLabel = h('span', {}, state.ui.fs + 'px');
  c.append(h('h3', {}, '外观'),
    field('主题', select(state.ui.theme, [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']], v => { state.ui.theme = v as typeof state.ui.theme; save(); applyAppearance(); })),
    field('正文字号', h('input', { type: 'range', min: '12', max: '22', value: String(state.ui.fs), oninput: (e: Event) => { state.ui.fs = +(e.target as HTMLInputElement).value; fsLabel.textContent = state.ui.fs + 'px'; save(); applyAppearance(); } }), fsLabel),
    field('正文字体', select(state.ui.font, [['sans', '无衬线'], ['serif', '衬线']], v => { state.ui.font = v as typeof state.ui.font; save(); applyAppearance(); })),
    h('h3', { style: { marginTop: '22px' } }, '快捷键'),
    h('table', { class: 'rules' }, ([
      ['翻译本标签', 'Ctrl/⌘ + Enter'], ['翻译所有标签（会先确认）', 'Ctrl/⌘ + Shift + Enter'], ['新建标签', 'Alt + T'], ['关闭标签', 'Alt + W'],
      ['向右拆分 / 向下拆分', 'Ctrl/⌘ + \\  /  Ctrl/⌘ + Shift + \\'], ['重命名标签', 'F2'], ['切换到第 n 个标签', 'Alt + 1…9'],
      ['差异开关', 'Alt + D'], ['关闭弹窗 / 菜单', 'Esc'],
    ] as const).map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('span', { class: 'kbd' }, b))))));
}

// ---------------------------------------------------------------------------
// 数据与隐私
// ---------------------------------------------------------------------------
function secData(c: HTMLElement): void {
  const info = h('span', {}, '正在读取…');
  const cacheInfo = h('span', { class: 'hint' }, '');
  storageInfo().then(s => {
    const mb = (n?: number) => (n == null ? '?' : (n / 1024 / 1024).toFixed(1) + ' MB');
    info.textContent = `已用 ${mb(s.usage)} / 可用 ${mb(s.quota)} · ${s.persisted ? '已申请持久化存储' : '未申请持久化（浏览器空间紧张时可能被清理）'}`;
  });
  dbCount('cache').then(n => { cacheInfo.textContent = `当前 ${n} 条`; });
  const incl = h('input', { type: 'checkbox' }) as HTMLInputElement;
  c.append(h('h3', {}, '数据与隐私'),
    h('p', { class: 'hint' }, '本站没有后端、账号或统计脚本。工作区、标签、译文、设置都保存在本浏览器的 IndexedDB。网络请求只有一种：从浏览器发往你配置的模型服务（或你自己部署的代理）。清理浏览器数据会丢失内容，请定期导出备份。'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, info, h('button', { class: 'btn sm', onclick: async () => { toast((await requestPersist()) ? '已申请持久化存储' : '浏览器未批准持久化存储'); openSettings(); } }, '申请持久化'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, check(state.cacheOn, '启用段落缓存：改了一个段落，重新翻译时只重翻这一段', v => { state.cacheOn = v; save(); }), cacheInfo,
        h('button', { class: 'btn sm', onclick: async () => { await dbClear('cache'); toast('已清空翻译缓存'); openSettings(); } }, '清空缓存'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: () => download(`translens-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(serialize(incl.checked), null, 2), 'application/json') }, '导出全部数据（JSON）'),
        h('label', { class: 'check' }, incl, ' 包含 API Key'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('label', { class: 'btn sm' }, '从备份导入…', h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onchange: async (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          try {
            const s = JSON.parse(await f.text());
            if (s.version !== 2 || !Array.isArray(s.workspaces)) throw new Error('格式不正确');
            const keys = Object.fromEntries(state.providers.map(p => [p.id, p.apiKey]));
            for (const p of s.providers || []) if (!p.apiKey && keys[p.id]) p.apiKey = keys[p.id];
            replaceState(s); save(); closeSettings(); toast('已导入备份');
          } catch (err) { toast('导入失败：' + (err as Error).message); }
        } })),
        h('span', { class: 'hint' }, '导入会替换当前全部内容（已有的 API Key 会保留）'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => { if (!confirm('添加一个内置示例工作区？')) return; const s = initialState(); state.workspaces.push(s.workspaces[0]); state.activeWs = s.workspaces[0].id; save(); closeSettings(); } }, '添加示例工作区'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!confirm('确定清除本浏览器中的全部工作区、译文、设置和 API Key？此操作无法撤销。')) return;
          await dbClear('kv'); await dbClear('cache');
          try { sessionStorage.clear(); } catch { /* ignore */ }
          location.reload();
        } }, '清除全部数据'))));
}
