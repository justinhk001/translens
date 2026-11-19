import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../types';
import { activateProvider, addTab, allGroups, cloneWorkspace, initialState, providerUsage, replaceState, setProviderModel, state, ws } from '../store/state';
import { PROVIDER_TEMPLATES, pickDefaultModel, providerFromTemplate, templateOf } from '../presets/providers';
import { translateAll, translateTab } from './translate';
import { dbClear } from '../store/db';

/**
 * 模拟一个 OpenAI 兼容的流式接口：把每个 <seg id="n"> 的原文原样加上前缀 "译:" 返回。
 * 这样可以精确检查每个标签拿到的是不是自己原文的译文（有没有串台）。
 */
let calls: string[] = [];
function mockFetch(delayMs = 5) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const user: string = body.messages[1].content;
    calls.push(user);
    const segs = [...user.matchAll(/<seg id="(\d+)">\n([\s\S]*?)\n<\/seg>/g)].map(m => `<seg id="${m[1]}">译:${m[2]}</seg>`);
    const text = segs.join('\n');
    const pieces = text.match(/[\s\S]{1,7}/g) || [];
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        for (const p of pieces) {
          await new Promise(r => setTimeout(r, delayMs));
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
}

async function setup(): Promise<Provider> {
  await dbClear('cache'); // 每个测试从空缓存开始
  replaceState(initialState());
  const p = providerFromTemplate(templateOf('custom'), 'p1');
  p.baseUrl = 'https://api.test/v1';
  p.model = 'test-model';
  state.providers.push(p);
  for (const t of Object.values(ws().tabs)) { t.settings.providerId = 'p1'; t.settings.model = 'test-model'; }
  return p;
}

const tgt = (id: string) => ws().tabs[id].runs.at(-1)!.segs.map(s => s.tgt);
const expected = (id: string) => ws().tabs[id].runs.at(-1)!.segs.map(s => '译:' + s.src);

beforeEach(() => { calls = []; vi.stubGlobal('fetch', mockFetch()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('标签之间互相独立', () => {
  it('新建标签翻译新内容，只影响这个标签', async () => {
    await setup();
    const [a, b, c] = Object.values(ws().tabs);
    await translateTab(a.id);
    const aBefore = JSON.stringify(a.runs);

    const n = addTab({ source: 'Brand new content.\n\nSecond paragraph.' });
    await translateTab(n.id);

    expect(tgt(n.id)).toEqual(['译:Brand new content.', '译:Second paragraph.']);
    expect(JSON.stringify(a.runs)).toBe(aBefore);   // 已有标签的译文没变
    expect(b.runs).toHaveLength(0);                 // 没翻译过的标签仍然没翻译
    expect(c.runs).toHaveLength(0);
    expect(calls).toHaveLength(2);                  // 只发了两次请求：a 一次、新标签一次
  });

  it('多个标签同时翻译，流式结果不会串到别的标签', async () => {
    await setup();
    const tabs = Object.values(ws().tabs);
    const extra = addTab({ source: Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1} of the extra tab.`).join('\n\n') });
    await Promise.all([...tabs.map(t => translateTab(t.id)), translateTab(extra.id)]);
    for (const t of [...tabs, extra]) expect(tgt(t.id)).toEqual(expected(t.id));
  });

  it('长文分块并发：每段译文对应自己的原文', async () => {
    await setup();
    state.providers[0].concurrency = 3;
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: ` + 'lorem ipsum '.repeat(30)).join('\n\n');
    const t = addTab({ source: long });
    await translateTab(t.id);
    expect(calls.length).toBeGreaterThan(1);       // 确实分成了多块
    expect(tgt(t.id)).toEqual(expected(t.id));
  });

  it('复制工作区：副本的标签 ID 全新，翻译副本不影响原工作区', async () => {
    await setup();
    const orig = ws();
    const [a] = Object.values(orig.tabs);
    await translateTab(a.id);
    const copy = cloneWorkspace(orig);
    state.workspaces.push(copy);
    const origIds = new Set(Object.keys(orig.tabs));
    expect(Object.keys(copy.tabs).some(id => origIds.has(id))).toBe(false);
    expect(allGroups(copy.layout).flatMap(g => g.tabs).every(id => copy.tabs[id])).toBe(true);
    state.activeWs = copy.id;
    const ca = Object.values(copy.tabs).find(t => t.title === a.title)!;
    ca.source += '\n\nAn extra paragraph only in the copy.';
    await translateTab(ca.id);
    expect(ca.runs).toHaveLength(2);
    expect(a.runs).toHaveLength(1);
    expect(a.source).not.toContain('only in the copy');
  });

  it('「全部翻译」只翻译未翻译或原文改过的标签', async () => {
    await setup();
    const [a, b, c] = Object.values(ws().tabs);
    await translateTab(a.id);
    calls = [];
    translateAll();
    await vi.waitFor(() => { expect(b.runs.at(-1)?.status).toBe('done'); expect(c.runs.at(-1)?.status).toBe('done'); }, { timeout: 5000 });
    expect(a.runs).toHaveLength(1);                 // 已是最新的 a 不会被重翻
    expect(calls).toHaveLength(2);
  });

  it('改了一个标签的原文，重新翻译只重翻改动的段落（其他段走缓存）', async () => {
    await setup();
    const t = addTab({ source: 'First para.\n\nSecond para.\n\nThird para.' });
    await translateTab(t.id);
    calls = [];
    t.source = 'First para.\n\nSecond para CHANGED.\n\nThird para.';
    await translateTab(t.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Second para CHANGED.');
    expect(calls[0]).not.toContain('First para.');
    expect(tgt(t.id)).toEqual(['译:First para.', '译:Second para CHANGED.', '译:Third para.']);
  });
});

describe('模型服务预设、温度与切换', () => {
  it('从模板创建时预先设置合适的 temperature（DeepSeek 1.3，Anthropic 不传，其余 0.3）', () => {
    for (const tpl of PROVIDER_TEMPLATES) {
      const p = providerFromTemplate(tpl, 'id-' + tpl.kind);
      if (tpl.kind === 'deepseek') expect(p.temperature).toBe(1.3);
      else if (tpl.kind === 'anthropic') { expect(p.temperature).toBeNull(); expect(p.effort).toBe('low'); }
      else expect(p.temperature).toBe(0.3);
    }
  });

  it('获取模型后优先挑选适合翻译的聊天模型，跳过 embedding/whisper 等', () => {
    expect(pickDefaultModel(['babbage-002', 'text-embedding-3-small', 'whisper-1', 'gpt-4o-mini', 'gpt-4o'], 'openai')).toBe('gpt-4o');
    expect(pickDefaultModel(['text-embedding-v3', 'rerank-v2', 'my-chat-model'], 'custom')).toBe('my-chat-model');
    expect(pickDefaultModel([], 'openai')).toBe('');
  });

  it('普通模型发送预设温度；已知推理模型跳过温度；400 报 temperature 错误时自动降级重试', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.model === 'custom-reasoner' && body.temperature !== undefined) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported value: temperature is not supported' } }), { status: 400 });
      }
      const user = String((body.messages as { content: string }[])[1].content);
      const segs = [...user.matchAll(/<seg id="(\d+)">\n([\s\S]*?)\n<\/seg>/g)].map(m => `<seg id="${m[1]}">译:${m[2]}</seg>`);
      return new Response(JSON.stringify({ choices: [{ message: { content: segs.join('\n') } }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));

    const p = await setup();
    p.temperature = 0.3;
    const t = addTab({ source: 'Hello.' });

    // 普通模型带 temperature
    await translateTab(t.id, { fresh: true });
    expect(bodies[0].temperature).toBe(0.3);

    // 已知推理模型（o3-mini / deepseek-reasoner）不带 temperature
    bodies.length = 0;
    t.settings.model = 'o3-mini';
    await translateTab(t.id, { fresh: true });
    expect(bodies[0].temperature).toBeUndefined();

    bodies.length = 0;
    t.settings.model = 'deepseek-reasoner';
    await translateTab(t.id, { fresh: true });
    expect(bodies[0].temperature).toBeUndefined();

    // 未知模型返回 400 temperature 错误时自动去掉 temperature 重试一次
    bodies.length = 0;
    t.settings.model = 'custom-reasoner';
    await translateTab(t.id, { fresh: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].temperature).toBe(0.3);
    expect(bodies[1].temperature).toBeUndefined();
    expect(tgt(t.id)).toEqual(['译:Hello.']);
  });

  it('旧版数据（rev < 5）迁移补全预设 temperature；新版保留用户显式留空的 null', () => {
    const s = initialState();
    const ds = providerFromTemplate(templateOf('deepseek'), 'ds');
    const oa = providerFromTemplate(templateOf('openai'), 'oa');
    ds.temperature = null;
    oa.temperature = null;
    s.providers = [ds, oa];

    // rev 4 → 迁移补齐默认值
    replaceState({ ...s, rev: 4 });
    expect(state.providers[0].temperature).toBe(1.3);
    expect(state.providers[1].temperature).toBe(0.3);

    // rev 5 → 保留显式 null
    const s5 = initialState();
    const oa5 = providerFromTemplate(templateOf('openai'), 'oa5');
    oa5.temperature = null;
    s5.providers = [oa5];
    replaceState({ ...s5, rev: 5 });
    expect(state.providers[0].temperature).toBeNull();
  });

  it('切换当前使用服务与更新默认模型，参考稿不受影响', () => {
    replaceState(initialState());
    const p1 = providerFromTemplate(templateOf('deepseek'), 'p1');
    const p2 = providerFromTemplate(templateOf('openai'), 'p2');
    p2.model = 'gpt-4o';
    state.providers = [p1, p2];

    const tabs = Object.values(ws().tabs);
    tabs[0].settings.providerId = 'p1';
    tabs[1].settings.providerId = 'p2';
    tabs[2].kind = 'reference';
    tabs[2].settings.providerId = 'demo';

    expect(providerUsage('p1')).toBe('focused');
    expect(providerUsage('p2')).toBe('some');

    activateProvider('p2');
    expect(providerUsage('p2')).toBe('all');
    expect(providerUsage('p1')).toBe('none');
    expect(tabs[0].settings.providerId).toBe('p2');
    expect(tabs[0].settings.model).toBe('');
    expect(tabs[2].settings.providerId).toBe('demo'); // 参考稿不动

    // 显式指定别的模型不会被 setProviderModel 覆盖，而跟随旧默认模型的会随默认更新
    tabs[0].settings.model = 'gpt-4o';
    tabs[1].settings.model = 'gpt-4o-mini';
    setProviderModel(p2, 'gpt-4.1');
    expect(p2.model).toBe('gpt-4.1');
    expect(tabs[0].settings.model).toBe('');
    expect(tabs[1].settings.model).toBe('gpt-4o-mini');
  });
});
