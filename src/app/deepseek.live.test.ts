import { describe, expect, it } from 'vitest';
import { addTab, initialState, replaceState, state, ws } from '../store/state';
import { providerFromTemplate, templateOf } from '../presets/providers';
import { SAMPLES } from '../presets/samples';
import { dbClear } from '../store/db';
import { translateTab } from './translate';

/**
 * 真实调用 DeepSeek 的冒烟测试（默认跳过）。
 * 运行方式：DEEPSEEK_API_KEY=sk-... npx vitest run src/app/deepseek.live.test.ts
 * Key 只从环境变量读取，不写入任何文件。
 */
const KEY: string | undefined = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DEEPSEEK_API_KEY;

describe.skipIf(!KEY)('DeepSeek 真实调用', () => {
  async function setup() {
    await dbClear('cache');
    replaceState(initialState());
    const p = providerFromTemplate(templateOf('deepseek'), 'ds');
    p.apiKey = KEY!;
    state.providers.push(p);
    for (const t of Object.values(ws().tabs)) { t.settings.providerId = 'ds'; t.settings.model = 'deepseek-chat'; }
  }
  const run = (id: string) => ws().tabs[id].runs.at(-1)!;
  const show = (label: string, id: string) => {
    const r = run(id);
    console.log(`\n===== ${label} · ${r.status} · ${r.usage.input}→${r.usage.output} tokens =====\n` + r.segs.map((s, i) => `[${i + 1}] ${s.tgt}`).join('\n') + (r.error ? '\nERROR: ' + r.error : ''));
  };

  it('默认组合：互译检查 + 去除无关格式（LaTeX 原稿）', async () => {
    await setup();
    const tab = Object.values(ws().tabs).find(t => t.title === '原稿')!;
    await translateTab(tab.id);
    show('原稿 · 去除无关格式', tab.id);
    const out = run(tab.id).segs.map(s => s.tgt).join('\n');
    expect(run(tab.id).status).toBe('done');
    expect(out).toMatch(/[一-鿿]/);
    expect(out).not.toMatch(/\\cite|\\ref|% Abstract/);
    expect(out).not.toMatch(/表\s*\d/);   // 不编造表格编号
    expect(out).toContain('$');
  }, 120000);

  it('保留原格式：LaTeX 命令原样保留', async () => {
    await setup();
    const tab = Object.values(ws().tabs).find(t => t.title === 'GPT 润色')!;
    tab.settings.latex = 'raw';
    await translateTab(tab.id);
    show('GPT 润色 · 保留原格式', tab.id);
    const out = run(tab.id).segs.map(s => s.tgt).join('\n');
    expect(out).toContain('\\cite{vaswani2017attention}');
    expect(out).toMatch(/\\ref\{tab:main\}/);
  }, 120000);

  it('多段 Markdown / PDF 文本：段落一一对应', async () => {
    await setup();
    const t = addTab({ source: '## Results\n\nOur method improves accuracy by up to 2.3% over strong base-\nlines [12].\n\n- **Fast** inference\n- Low memory usage' });
    t.settings.providerId = 'ds'; t.settings.model = 'deepseek-chat';
    await translateTab(t.id);
    show('Markdown / PDF · 去除无关格式', t.id);
    const segs = run(t.id).segs;
    expect(segs).toHaveLength(3);
    expect(segs.every(s => s.tgt.trim())).toBe(true);
    expect(segs[1].tgt).toMatch(/最多|至多/);   // up to 的语气保留
    expect(segs[1].tgt).not.toContain('[12]');
    expect(segs.map(s => s.tgt).join('')).not.toContain('**');
  }, 120000);

  it('自动方向：中文原文译成英文', async () => {
    await setup();
    const t = addTab({ source: '我们提出了一种稀疏注意力方法，可能将复杂度降低到 $O(n \\log n)$。' });
    t.settings.providerId = 'ds'; t.settings.model = 'deepseek-chat';
    await translateTab(t.id);
    show('中文 → 英文（自动方向）', t.id);
    const out = run(t.id).segs[0].tgt;
    expect(out).toMatch(/[A-Za-z]{4,}/);
    expect(out).not.toMatch(/[一-鿿]{3,}/);
    expect(out).toMatch(/may|might|could|can/i);  // "可能" 的语气保留
  }, 120000);

  it('SAMPLES 未被修改', () => { expect(SAMPLES).toHaveLength(3); });
});
