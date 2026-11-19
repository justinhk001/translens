/** 合并 PDF 复制带来的硬换行与连字符断词；保护 LaTeX 注释与结构行 */
export function fixPdfBreaks(t: string): string {
  const lines = String(t).replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  lines.forEach((line, i) => {
    if (i === 0) { out = line; return; }
    const prev = lines[i - 1];
    const join = prev.trim() && line.trim() && !/(^|[^\\])%/.test(prev) && !/^\s*\\(begin|end|item|section|subsection)/.test(line);
    if (!join) { out += '\n' + line; return; }
    if (/[A-Za-z]-$/.test(out) && /^\s*[a-z]/.test(line)) out = out.slice(0, -1) + line.trim();
    else out = out.replace(/\s+$/, '') + ' ' + line.trim();
  });
  return out.replace(/[ \t]{2,}/g, ' ');
}

export function estimateTokens(text: string): number {
  let ascii = 0, other = 0;
  for (const ch of String(text)) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 4 + other * 0.7);
}

/** cyrb53：快速、同步的字符串哈希，用于缓存键 */
export function hash(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 简单判断主要语言（用于自动方向提示） */
export function looksChinese(text: string): boolean {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cjk > latin * 0.3;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
