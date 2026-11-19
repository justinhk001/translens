import type { Price, Provider, Run, Segment, Tab, Usage } from '../types';
import { buildSegments } from '../core/segment';
import { buildAnalysis, buildSystem, buildUser, glossaryHits, macroHits, parseGlossary, parseOutput } from '../core/prompt';
import { estimateTokens, hash, uid } from '../core/text';
import { chat, isAbort } from '../llm';
import { sleep } from '../llm/types';
import { dbGet, dbSet } from '../store/db';
import { currentRun, getPrompt, getProvider, isStale, orderedTabIds, resolveDir, save, state, tabsOf, ws } from '../store/state';
import { DEMO, demoOutput } from '../presets/samples';
import { ui } from '../ui/bridge';

export const running = new Map<string, AbortController>();
const MAX_RUNS = 10;

// ---------------------------------------------------------------------------
// 展示用文本（差异对比、复制、AI 解读共用）
// ---------------------------------------------------------------------------
export function displayText(segs: Segment[], field: 'src' | 'tgt'): string {
  return segs.map(s => s[field]).filter(t => t.trim()).join('\n\n');
}

/** 原文的段落：译文未过期时用译文的那份，保证悬停联动对齐 */
export function sourceSegs(tab: Tab): { segs: Segment[]; linked: boolean } {
  const r = currentRun(tab);
  if (r && !isStale(tab)) return { segs: r.segs, linked: true };
  return { segs: buildSegments(tab.source), linked: false };
}

/** 用于对比的"译文侧"文本：参考稿取其原文，翻译标签取当前译文 */
export function tgtTextOf(tab: Tab): string | null {
  if (tab.kind === 'reference') return tab.source.trim();
  const r = currentRun(tab);
  if (!r || r.status === 'running') return null;
  return displayText(r.segs, 'tgt');
}

// ---------------------------------------------------------------------------
// 翻译
// ---------------------------------------------------------------------------
function computeCost(u: Usage, p: Price): { value: number; currency: string } {
  const value = ((u.input - u.cacheHit) * p.input + u.cacheHit * (p.cacheHit || p.input) + u.output * p.output) / 1e6;
  return { value, currency: p.currency };
}

const cacheKey = (system: string, p: Provider, model: string, text: string) =>
  'v2:' + hash([p.protocol, p.baseUrl, model, system, text].join('\u0001'));

export async function translateTab(tabId: string, opts: { fresh?: boolean } = {}): Promise<void> {
  const tab = tabsOf()[tabId];
  if (!tab || tab.kind === 'reference') return;
  if (running.has(tabId)) { running.get(tabId)!.abort(); return; }
  if (!tab.source.trim()) { ui.toast('原文为空：先粘贴要翻译的文本'); return; }
  const prev = currentRun(tab);
  // 原文和设置都没变时再次点「翻译」= 重新生成，绕过缓存；否则只重翻改动过的段落
  const fresh = opts.fresh ?? (prev?.status === 'done' && !isStale(tab));
  const provider = getProvider(tab.settings.providerId);
  const model = provider ? (tab.settings.model || provider.model) : 'demo';
  const run: Run = {
    id: uid(), status: 'running', segs: buildSegments(tab.source), format: state.numbered ? 'numbered' : 'plain',
    sourceSnap: tab.source, latex: tab.settings.latex, dir: resolveDir(tab), promptId: tab.settings.promptId,
    providerName: provider ? provider.name : '演示模式', model, usage: { input: 0, output: 0, cacheHit: 0 },
    cachedParas: 0, totalParas: 0, startedAt: Date.now(),
  };
  tab.runs.push(run);
  if (tab.runs.length > MAX_RUNS) tab.runs.splice(0, tab.runs.length - MAX_RUNS);
  tab.current = tab.runs.length - 1;
  tab.editing = false;
  const ctrl = new AbortController();
  running.set(tabId, ctrl);
  ui.renderTab(tabId);
  try {
    if (!provider) await runDemo(run, ctrl.signal, tabId);
    else await runReal(tab, run, provider, model, ctrl.signal, fresh);
    run.status = 'done';
  } catch (e) {
    if (isAbort(e)) run.status = 'aborted';
    else { run.status = 'error'; run.error = (e as Error).message || String(e); }
  } finally {
    running.delete(tabId);
    run.finishedAt = Date.now();
    if (provider?.price) run.cost = computeCost(run.usage, provider.price);
    if (run.status === 'done') state.lastRun = { title: tab.title, model: run.model, usage: run.usage, ms: run.finishedAt - run.startedAt, cost: run.cost };
    save();
    ui.renderTab(tabId);
    ui.renderStatus();
  }
}

export function systemFor(tab: Tab, dir = resolveDir(tab), format: Run['format'] = state.numbered ? 'numbered' : 'plain'): string {
  return buildSystem({
    preset: getPrompt(tab.settings.promptId), lang: state.promptLang, dir, mode: tab.settings.latex, format,
    glossary: state.glossaryOn ? glossaryHits(parseGlossary(state.glossary), tab.source) : [],
    macros: macroHits(state.macros, tab.source),
    overrides: state.markupRules,
  });
}

async function runReal(tab: Tab, run: Run, provider: Provider, model: string, signal: AbortSignal, fresh: boolean): Promise<void> {
  const system = systemFor(tab, run.dir, run.format);
  run.totalParas = run.segs.length;

  // 整篇一起发送（关闭了按段对照）
  if (run.format === 'plain') {
    const user = buildUser(state.promptLang, run.segs.map(s => s.src), 'plain');
    let acc = '';
    const apply = () => { const out = parseOutput(acc, run.segs.length); run.segs.forEach((s, i) => { s.tgt = out[i] ?? ''; }); };
    const res = await chat(provider, model, { system, user, signal, onText: d => { acc += d; apply(); ui.scheduleTgt(tab.id); }, onReasoning: () => { run.reasoning = true; ui.scheduleTgt(tab.id); } }, state.proxy);
    apply();
    addUsage(run, res.usage, system + user, acc);
    return;
  }

  // 按段：先查缓存，只把没命中的段落发给模型
  const pending: number[] = [];
  for (let i = 0; i < run.segs.length; i++) {
    const hit = state.cacheOn && !fresh ? await dbGet<string>('cache', cacheKey(system, provider, model, run.segs[i].src)) : undefined;
    if (hit != null) { run.segs[i].tgt = hit; run.cachedParas++; }
    else pending.push(i);
  }
  ui.scheduleTgt(tab.id);

  const chunks: number[][] = [];
  let cur: number[] = [], len = 0;
  for (const i of pending) {
    const L = run.segs[i].src.length;
    if (cur.length && len + L > 2400) { chunks.push(cur); cur = []; len = 0; }
    cur.push(i); len += L;
  }
  if (cur.length) chunks.push(cur);

  const missing: number[] = [];
  const runChunk = async (idxs: number[]) => {
    const user = buildUser(state.promptLang, idxs.map(i => run.segs[i].src), 'numbered');
    let acc = '';
    let out: (string | null)[] = [];
    const apply = () => { out = parseOutput(acc, idxs.length); idxs.forEach((i, k) => { if (out[k] != null) run.segs[i].tgt = out[k]!; }); };
    const res = await chat(provider, model, {
      system, user, signal,
      onText: d => { acc += d; apply(); ui.scheduleTgt(tab.id); },
      onReasoning: () => { run.reasoning = true; ui.scheduleTgt(tab.id); },
    }, state.proxy);
    apply();
    addUsage(run, res.usage, system + user, acc);
    idxs.forEach((i, k) => { if (out[k] == null) missing.push(i); });
    if (state.cacheOn) for (let k = 0; k < idxs.length; k++) {
      if (out[k] != null) await dbSet('cache', cacheKey(system, provider, model, run.segs[idxs[k]].src), out[k]);
    }
  };
  let next = 0;
  const worker = async () => { while (next < chunks.length) await runChunk(chunks[next++]); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(provider.concurrency || 2, chunks.length)) }, worker));

  // 模型漏掉的段落单独补译一次
  if (missing.length && missing.length < pending.length) {
    const retry = missing.splice(0);
    await runChunk(retry);
  }
}

function addUsage(run: Run, u: Usage | null, sent: string, received: string): void {
  run.usage.input += u?.input ?? estimateTokens(sent);
  run.usage.output += u?.output ?? estimateTokens(received);
  run.usage.cacheHit += u?.cacheHit ?? 0;
}

// ---------------------------------------------------------------------------
// 演示模式（不调用 API，内置示例可"翻译"）
// ---------------------------------------------------------------------------
async function runDemo(run: Run, signal: AbortSignal, tabId: string): Promise<void> {
  await sleep(300, signal);
  run.totalParas = run.segs.length;
  for (const seg of run.segs) {
    let full = run.dir === 'en-zh' ? demoOutput(seg.src, run.latex) : null;
    if (!full) { seg.demoMiss = true; full = '【演示模式】这段不在内置示例中，无法翻译。到 ⚙ 设置 → 模型服务添加 DeepSeek 等服务后即可翻译任意文本。'; }
    const chars = Array.from(full);
    for (let k = 0; k < chars.length; k += 3) {
      seg.tgt = chars.slice(0, k + 3).join('');
      ui.scheduleTgt(tabId);
      await sleep(14, signal);
    }
    seg.tgt = full;
    run.usage.input += estimateTokens(seg.src);
    run.usage.output += estimateTokens(full);
  }
}

/** 需要翻译的标签：当前工作区里未翻译、出错或原文 / 设置改过的翻译标签（已是最新的不会重翻） */
export function tabsToTranslate(): string[] {
  return orderedTabIds().filter(id => {
    const t = tabsOf()[id];
    const r = currentRun(t);
    return t.kind === 'translate' && t.source.trim() && !running.has(id) && (!r || isStale(t) || r.status !== 'done');
  });
}

/** 批量翻译（只由顶栏「翻译所有标签」触发，界面层会先让用户确认） */
export function translateAll(ids = tabsToTranslate()): void {
  if (!ids.length) { ui.toast('所有标签都已是最新译文'); return; }
  ids.forEach(id => { translateTab(id, { fresh: false }); });
}

// ---------------------------------------------------------------------------
// AI 差异解读
// ---------------------------------------------------------------------------
const analysisRunning = new Map<string, AbortController>();
export const isAnalyzing = (tabId: string) => analysisRunning.has(tabId);

export async function analyzeDiff(tabId: string): Promise<void> {
  const tab = tabsOf()[tabId];
  const base = tabsOf()[ws().baseTabId];
  if (!tab || !base || base.id === tab.id) return;
  analysisRunning.get(tabId)?.abort();
  // 参考稿（如中文初稿）与本标签的译文比较；否则比较两个版本的原文（格式标记由模型忽略）
  const a = base.source.trim();
  const b = base.kind === 'reference' ? (tgtTextOf(tab) || '') : tab.source.trim();
  if (!a || !b) { ui.toast(base.kind === 'reference' ? '先翻译此标签，再与参考稿对比' : '两个标签都需要有原文'); return; }
  const provider = getProvider(tab.settings.providerId);
  const model = provider ? (tab.settings.model || provider.model) : 'demo';
  const an = { baseId: base.id, baseTitle: base.title, text: '', status: 'running' as 'running' | 'done' | 'error', model, at: Date.now(), sourceSnap: tab.source + '\u0000' + base.source };
  tab.analysis = an;
  const ctrl = new AbortController();
  analysisRunning.set(tabId, ctrl);
  ui.updateAnalysis(tabId);
  try {
    if (!provider) {
      const canned = DEMO.analysis.get(DEMO.whole(base.source) + '|' + DEMO.whole(tab.source));
      const full = canned || '演示模式只能解读内置示例（以「原稿」为基准，对比「GPT 润色」或「Claude 润色」）。添加模型服务后可解读任意文本。';
      for (let k = 0; k < full.length; k += 6) { an.text = full.slice(0, k + 6); ui.updateAnalysis(tabId); await sleep(12, ctrl.signal); }
      an.text = full;
    } else {
      const p = buildAnalysis(state.promptLang, a, b);
      await chat(provider, model, { system: p.system, user: p.user, signal: ctrl.signal, onText: d => { an.text += d; ui.updateAnalysis(tabId); } }, state.proxy);
    }
    an.status = 'done';
  } catch (e) {
    an.status = 'error';
    if (!isAbort(e)) an.text += (an.text ? '\n\n' : '') + '⚠ ' + ((e as Error).message || String(e));
  } finally {
    analysisRunning.delete(tabId);
    save();
    ui.updateAnalysis(tabId);
  }
}

export function stopAnalysis(tabId: string) { analysisRunning.get(tabId)?.abort(); }
