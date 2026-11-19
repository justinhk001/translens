import type { Dir, Format, FormatMode, MarkupRuleOverrides, PromptLang, PromptPreset } from '../types';
import { ANALYSIS_PROMPT, EXAMPLES, EXAMPLE_LABELS, GLOSSARY_HEAD, LANG_NAMES, MACROS_HEAD, MARKUP_RULES, NOTE_FORMAT, OUTPUT_RULES, USER_TEMPLATE } from '../presets/prompts';

export function parseGlossary(text: string): [string, string][] {
  return (text || '').split('\n')
    .map(l => l.split(/\s*(?:=|→|->|\t)\s*/))
    .filter(x => x.length >= 2 && x[0].trim() && x[1].trim())
    .map(x => [x[0].trim(), x[1].trim()] as [string, string]);
}

/** 只保留在原文中出现的术语 */
export function glossaryHits(entries: [string, string][], text: string): [string, string][] {
  const low = String(text).toLowerCase();
  return entries.filter(([a]) => low.includes(a.toLowerCase()));
}

/** 自定义宏说明：每行 "\ours = XNet"；只保留原文里出现的宏 */
export function macroHits(text: string, src: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of (text || '').split('\n')) {
    const m = /^\s*\\?([a-zA-Z@]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && new RegExp('\\\\' + m[1] + '(?![a-zA-Z@])').test(src)) out.push(['\\' + m[1], m[2]]);
  }
  return out;
}

export function fill(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? vars[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 当前生效的格式规则：用户改过就用用户的，否则用内置的 */
export function markupRules(lang: PromptLang, mode: FormatMode, overrides?: MarkupRuleOverrides): string {
  const o = overrides?.[mode]?.[lang];
  return o != null && o.trim() ? o : MARKUP_RULES[lang][mode];
}

export interface BuildOptions {
  preset: PromptPreset;
  lang: PromptLang;
  dir: Dir;
  mode: FormatMode;
  format: Format;
  glossary: [string, string][];
  macros?: [string, string][];
  overrides?: MarkupRuleOverrides;
}

/** 把段落包进 <seg id="n"> 块（段落可以跨多行，原样保留） */
export function segBlocks(paras: string[]): string {
  return paras.map((p, i) => `<seg id="${i + 1}">\n${p}\n</seg>`).join('\n');
}

export function buildSystem(o: BuildOptions): string {
  const [src, tgt] = o.dir === 'zh-en' ? ['zh', 'en'] as const : ['en', 'zh'] as const;
  const names = LANG_NAMES[o.lang];
  const ex = EXAMPLES[o.dir][o.mode];
  const lab = EXAMPLE_LABELS[o.lang];
  const exIn = o.format === 'numbered' ? segBlocks(ex.input) : ex.input.join('\n\n');
  const exOut = o.format === 'numbered' ? ex.output.map((t, i) => `<seg id="${i + 1}">${t}</seg>`).join('\n') : ex.output.join('\n\n');
  const example = `${lab.title}\n${lab.input}\n<translate_input>\n${exIn}\n</translate_input>\n${lab.output}\n${exOut}`;
  const blocks: string[] = [];
  if (o.glossary.length) blocks.push(GLOSSARY_HEAD[o.lang] + '\n' + o.glossary.map(([a, b]) => `- ${a} → ${b}`).join('\n'));
  if (o.macros?.length) blocks.push(MACROS_HEAD[o.lang] + '\n' + o.macros.map(([a, b]) => `- ${a} → ${b}`).join('\n'));
  const rules = markupRules(o.lang, o.mode, o.overrides);
  const output = OUTPUT_RULES[o.lang][o.format];
  return fill(o.preset.system[o.lang], {
    source_lang: names[src],
    target_lang: names[tgt],
    note: NOTE_FORMAT[tgt],
    markup_rules: rules,
    output_rules: output,
    glossary: blocks.join('\n\n'),
    example,
    // 旧变量名（早期自定义提示词）仍然可用
    latex_rules: rules,
    format_rules: output,
  });
}

export function buildUser(lang: PromptLang, paras: string[], format: Format): string {
  const text = format === 'numbered' ? segBlocks(paras) : paras.join('\n\n');
  return USER_TEMPLATE[lang].replace('{{text}}', () => text);
}

/**
 * 解析模型输出（流式过程中也会反复调用）。
 * 返回每段的译文；null 表示输出里没有这一段（用于判断是否需要补译）。
 * 1. <seg id="n">…</seg>（最后一块可能还没闭合）
 * 2. 兼容旧的 [n] 行编号
 * 3. 都没有时按空行切段，段数吻合则一一对应，否则整体放在第一段
 */
export function parseOutput(text: string, n: number): (string | null)[] {
  const out: (string | null)[] = new Array(n).fill(null);
  const body = String(text).replace(/<\/?translate_input>/g, '');
  const re = /<seg\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)(?:<\/seg>|(?=<seg\s)|$)/g;
  let m: RegExpExecArray | null, found = false;
  while ((m = re.exec(body))) {
    found = true;
    const i = +m[1] - 1;
    if (i >= 0 && i < n) out[i] = m[2].replace(/^\n+|\n+$/g, '').trim();
    if (m[0].length === 0) re.lastIndex++;
  }
  if (found) return out;
  const map: Record<number, string> = {};
  let cur: number | null = null;
  for (const line of body.split('\n')) {
    const lm = /^\s*\[(\d+)\]\s?(.*)$/.exec(line);
    if (lm) { cur = +lm[1]; map[cur] = lm[2].trim(); found = true; }
    else if (cur !== null && line.trim()) map[cur] += '\n' + line.trim();
  }
  if (found) { for (let i = 0; i < n; i++) if (map[i + 1] != null) out[i] = map[i + 1]; return out; }
  if (!body.trim()) return out;
  const paras = body.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paras.length === n) return paras;
  if (n > 0) out[0] = body.trim();
  return out;
}

export function buildAnalysis(lang: PromptLang, a: string, b: string): { system: string; user: string } {
  const p = ANALYSIS_PROMPT[lang];
  return {
    system: fill(p.system, { answer_lang: LANG_NAMES[lang].zh }),
    user: p.user.replace('{{a}}', () => a).replace('{{b}}', () => b),
  };
}
