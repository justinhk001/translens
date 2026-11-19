import { describe, expect, it } from 'vitest';
import { buildSegments, paragraphAt, paragraphRanges, splitParagraphs } from './segment';
import { diffTexts } from './diff';
import { fixPdfBreaks, hash, looksChinese } from './text';
import { buildAnalysis, buildSystem, buildUser, glossaryHits, macroHits, parseGlossary, parseOutput } from './prompt';
import { renderMarkdown } from './markdown';
import { BUILTIN_PROMPTS, MARKUP_RULES } from '../presets/prompts';
import { DEMO, demoOutput, SAMPLES } from '../presets/samples';

describe('分段：本地只按空行分段，原文一字不改', () => {
  it('段内换行、注释、宏、格式标记原样保留', () => {
    const src = '% note\nWe use \\ours{} (Eq.~\\eqref{eq:a}). % tail\nIt improves by 2.3%.\n\n\n\\section{Intro}\n\n- **item** one\n- item two';
    expect(splitParagraphs(src)).toEqual([
      '% note\nWe use \\ours{} (Eq.~\\eqref{eq:a}). % tail\nIt improves by 2.3%.',
      '\\section{Intro}',
      '- **item** one\n- item two',
    ]);
  });
  it('只有空白的行也算空行；Windows 换行；首尾空行去掉', () => {
    expect(splitParagraphs('\r\nA\r\n  \r\nB  \n\n')).toEqual(['A', 'B']);
  });
  it('段落位置与分段一一对应；光标定位到段落', () => {
    const src = '\n% c\nA line\n\n\n  \nB para  \n\nC';
    const ranges = paragraphRanges(src);
    expect(ranges.length).toBe(splitParagraphs(src).length);
    expect(ranges.map(([a, b]) => src.slice(a, b))).toEqual(['% c\nA line', 'B para', 'C']);
    expect(paragraphAt(src, 0)).toBe(0);
    expect(paragraphAt(src, src.indexOf('B'))).toBe(1);
    expect(paragraphAt(src, src.length)).toBe(2);
  });
  it('精确差异：保留【注】，"=" 与 "+" 片段拼起来等于新文本', () => {
    const text = 'We propose XNet【注：x】, which improves accuracy.';
    const d = diffTexts('We propose a method, which improves accuracy.', text, 'en', true);
    expect(d.parts.filter(p => p.t !== '-').map(p => p.v).join('')).toBe(text);
  });
  it('生成段落片段', () => {
    expect(buildSegments('A\n\nB')).toEqual([{ para: 0, src: 'A', tgt: '' }, { para: 1, src: 'B', tgt: '' }]);
  });
});

describe('提示词', () => {
  const base = { preset: BUILTIN_PROMPTS[0], dir: 'en-zh' as const, mode: 'model' as const, format: 'numbered' as const, glossary: [] };
  it('所有模式 × 中英文版本 × 方向 × 格式处理 × 输出格式都填满变量', () => {
    for (const preset of BUILTIN_PROMPTS) for (const lang of ['zh', 'en'] as const) for (const dir of ['en-zh', 'zh-en'] as const)
      for (const mode of ['model', 'raw'] as const) for (const format of ['numbered', 'plain'] as const) {
        const s = buildSystem({ ...base, preset, lang, dir, mode, format });
        expect(s).not.toMatch(/\{\{\w+\}\}/);
        expect(s).toContain('<translate_input>');
      }
  });
  it('方向由参数决定，与翻译模式无关', () => {
    expect(buildSystem({ ...base, lang: 'en', dir: 'zh-en' })).toContain('Translate the Simplified Chinese text inside <translate_input> into English');
    expect(buildSystem({ ...base, lang: 'zh', dir: 'en-zh' })).toContain('把 <translate_input> 中的英文文本翻译成简体中文');
  });
  it('去除无关格式：覆盖 LaTeX、Markdown、HTML、PDF；保留原格式：要求原样保留', () => {
    const m = buildSystem({ ...base, lang: 'en', mode: 'model' });
    expect(m).toContain('Markdown and HTML');
    expect(m).toContain('put each heading on its own line');
    const r = buildSystem({ ...base, lang: 'en', mode: 'raw' });
    expect(r).toContain('Keep every command');
    expect(r).not.toContain('Markdown and HTML: remove');
  });
  it('用户修改的格式规则优先', () => {
    const custom = buildSystem({ ...base, lang: 'en', overrides: { model: { en: 'MY RULE' } } });
    expect(custom).toContain('MY RULE');
    expect(custom).not.toContain(MARKUP_RULES.en.model.slice(0, 40));
  });
  it('旧变量名仍可用', () => {
    const old = { ...BUILTIN_PROMPTS[0], system: { en: 'A {{latex_rules}} B {{format_rules}}', zh: '' } };
    const s = buildSystem({ ...base, preset: old, lang: 'en' });
    expect(s).not.toMatch(/\{\{/);
    expect(s).toContain('<seg id=');
  });
  it('术语表与宏说明只注入原文出现的条目', () => {
    expect(buildSystem({ ...base, lang: 'en' })).not.toContain('Glossary');
    const g = glossaryHits(parseGlossary('sparse attention = 稀疏注意力\nfoo = 甲'), 'A sparse attention method');
    expect(g).toEqual([['sparse attention', '稀疏注意力']]);
    const macros = macroHits('\\ours = XNet\n\\unused = Y\n\\our = Z', 'We propose \\ours{}.');
    expect(macros).toEqual([['\\ours', 'XNet']]);
    const s = buildSystem({ ...base, lang: 'en', glossary: g, macros });
    expect(s).toContain('- sparse attention → 稀疏注意力');
    expect(s).toContain('- \\ours → XNet');
  });
  it('用户消息：段落包进 <seg> 块，段内换行保留', () => {
    expect(buildUser('en', ['A\nB', 'C'], 'numbered')).toContain('<translate_input>\n<seg id="1">\nA\nB\n</seg>\n<seg id="2">\nC\n</seg>\n</translate_input>');
    expect(buildUser('en', ['A', 'C'], 'plain')).toContain('<translate_input>\nA\n\nC\n</translate_input>');
  });
  it('解析 <seg> 输出：多行、未闭合（流式中途）、缺失、空块', () => {
    expect(parseOutput('<seg id="1">甲\n乙</seg>\n<seg id="2"></seg>', 3)).toEqual(['甲\n乙', '', null]);
    expect(parseOutput('<seg id="1">甲</seg><seg id="2">正在输', 2)).toEqual(['甲', '正在输']);
    expect(parseOutput('<translate_input>\n<seg id=2>乙</seg>\n</translate_input>', 2)).toEqual([null, '乙']);
  });
  it('解析兼容：[n] 编号与无编号', () => {
    expect(parseOutput('[1] 甲\n续\n[2] 乙', 3)).toEqual(['甲\n续', '乙', null]);
    expect(parseOutput('甲段\n\n乙段', 2)).toEqual(['甲段', '乙段']);
    expect(parseOutput('', 2)).toEqual([null, null]);
  });
  it('差异解读提示词：忽略格式标记', () => {
    const p = buildAnalysis('zh', 'A text', 'B text');
    expect(p.system).toContain('简体中文');
    expect(p.system).toContain('格式标记');
    expect(p.user).toContain('<version_a>\nA text\n</version_a>');
  });
});

describe('差异', () => {
  it('中文按词并合并碎片', () => {
    const d = diffTexts('与基线相比，XNet 将准确率提高了 2.3%', '与强基线相比，XNet 能够持续地将准确率提升 2.3%', 'zh');
    expect(d.parts.filter(p => p.t !== '=').map(p => p.t + p.v).join('|')).toContain('持续');
    expect(d.ins).toBeGreaterThan(0);
  });
  it('忽略【注】', () => {
    const d = diffTexts('甲。【注：x】', '甲。', 'zh');
    expect(d.ins + d.del).toBe(0);
  });
});

describe('杂项', () => {
  it('PDF 断行修复（用户手动触发）', () => {
    expect(fixPdfBreaks('This is a transla-\ntion test\nacross lines.\n\nNew para % c\nkeep')).toBe('This is a translation test across lines.\n\nNew para % c\nkeep');
  });
  it('自动方向：主要是中文 → 中译英', () => {
    expect(looksChinese('我们提出了一种新方法 XNet。')).toBe(true);
    expect(looksChinese('We propose XNet, a sparse attention method (稀疏注意力).')).toBe(false);
    expect(looksChinese('大语言模型会读取\\emph{长}上下文~\\cite{a,b}，如图~\\ref{fig:x}所示。')).toBe(true);
  });
  it('哈希稳定', () => { expect(hash('abc')).toBe(hash('abc')); expect(hash('abc')).not.toBe(hash('abd')); });
  it('Markdown 表格与转义', () => {
    const html = renderMarkdown('| # | A |\n|---|---|\n| 1 | <b>x</b> **y** |');
    expect(html).toContain('<table>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; <b>y</b>');
  });
  it('Markdown 流式中途的不完整表格不会卡死', () => {
    for (const partial of ['| # | ', '| # | A |', '| # | A |\n|--', '| a |\n| b |']) expect(renderMarkdown(partial).length).toBeGreaterThan(0);
  });
});

describe('演示数据', () => {
  it('三个示例在两种格式处理方式下都有译文', () => {
    for (const s of SAMPLES) {
      const [p] = splitParagraphs(s.source);
      expect(demoOutput(p, 'model')).toBe(s.clean);
      expect(demoOutput(p, 'raw')).toContain('\\cite{vaswani2017attention}');
    }
    expect(demoOutput(splitParagraphs(SAMPLES[0].source)[0], 'raw')).toMatch(/^% Abstract/);
    expect(DEMO.analysis.size).toBe(2);
  });
});
