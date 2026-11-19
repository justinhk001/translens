import type { Segment } from '../types';

/**
 * 原文 → 段落。
 * 本地只做一件事：按空行分段。段落内容（换行、注释、宏、格式标记）原样保留，
 * 格式的去除 / 保留全部交给模型按提示词处理，避免本地规则改坏原文。
 */
export function splitParagraphs(src: string): string[] {
  return String(src || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map(p => p.replace(/^\s*\n|\n\s*$/g, '').replace(/[ \t]+$/gm, ''))
    .filter(p => p.trim());
}

/**
 * 每个段落在原文中的位置 [起点, 终点)，与 splitParagraphs 的段落一一对应。
 * 用于在可编辑的原文上高亮某一段、根据光标位置找到所在段落。
 */
export function paragraphRanges(src: string): [number, number][] {
  const out: [number, number][] = [];
  const text = String(src || '');
  const push = (a: number, b: number) => {
    const seg = text.slice(a, b);
    if (!seg.trim()) return;
    const lead = seg.length - seg.replace(/^\s*\n/, '').length;
    const trail = seg.length - seg.replace(/\s+$/, '').length;
    out.push([a + lead, b - trail]);
  };
  const re = /\n[ \t]*\n/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) { push(last, m.index); last = m.index + m[0].length; }
  push(last, text.length);
  return out;
}

/** 光标位置所在（或紧随其后）的段落序号 */
export function paragraphAt(src: string, pos: number): number {
  const rs = paragraphRanges(src);
  const i = rs.findIndex(([, b]) => pos <= b);
  return i < 0 ? rs.length - 1 : i;
}

export function buildSegments(src: string): Segment[] {
  return splitParagraphs(src).map((p, i) => ({ para: i, src: p, tgt: '' }));
}
