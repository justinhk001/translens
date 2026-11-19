export type DiffPart = { t: '=' | '-' | '+'; v: string };

export function tokenize(text: string, lang: 'en' | 'zh'): string[] {
  if (lang === 'zh' && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(text), s => s.segment);
  }
  return String(text).match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}]/gu) || [];
}

/** 基于 LCS 的词级差异 */
export function diffTokens(a: string[], b: string[]): DiffPart[] {
  const n = a.length, m = b.length;
  const out: DiffPart[] = [];
  const push = (t: DiffPart['t'], v: string) => { const L = out[out.length - 1]; if (L && L.t === t) L.v += v; else out.push({ t, v }); };
  let pre = 0; while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const A = a.slice(pre, n - suf), B = b.slice(pre, m - suf);
  const N = A.length, M = B.length;
  a.slice(0, pre).forEach(v => push('=', v));
  if (N * M > 6e6) { A.forEach(v => push('-', v)); B.forEach(v => push('+', v)); }
  else {
    const dp = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
    for (let x = N - 1; x >= 0; x--) for (let y = M - 1; y >= 0; y--) dp[x][y] = A[x] === B[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    let x = 0, y = 0;
    while (x < N && y < M) {
      if (A[x] === B[y]) { push('=', A[x]); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { push('-', A[x]); x++; }
      else { push('+', B[y]); y++; }
    }
    while (x < N) push('-', A[x++]);
    while (y < M) push('+', B[y++]);
  }
  a.slice(n - suf).forEach(v => push('=', v));
  return out;
}

/** 语义清理：把夹在两处改动之间的很短的相同片段并入改动，减少碎片化高亮 */
export function cleanupDiff(parts: DiffPart[], lang: 'en' | 'zh'): DiffPart[] {
  const maxLen = lang === 'zh' ? 2 : 3;
  const regroup = (ps: DiffPart[]) => {
    const out: DiffPart[] = [];
    let del = '', ins = '';
    const flush = () => { if (del) out.push({ t: '-', v: del }); if (ins) out.push({ t: '+', v: ins }); del = ins = ''; };
    for (const p of ps) {
      if (p.t === '=') { flush(); const L = out[out.length - 1]; if (L && L.t === '=') L.v += p.v; else out.push({ ...p }); }
      else if (p.t === '-') del += p.v; else ins += p.v;
    }
    flush();
    return out;
  };
  let cur = regroup(parts);
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    const next: DiffPart[] = [];
    cur.forEach((p, i) => {
      const prevChange = i > 0 && cur[i - 1].t !== '=';
      const nextChange = i < cur.length - 1 && cur[i + 1].t !== '=';
      if (p.t === '=' && prevChange && nextChange && p.v.trim().length <= maxLen) { next.push({ t: '-', v: p.v }, { t: '+', v: p.v }); changed = true; }
      else next.push(p);
    });
    cur = regroup(next);
    if (!changed) break;
  }
  return cur;
}

export const stripNotes = (t: string) => t.replace(/\s*(【注[:：][^】]*】|\[Note:[^\]]*\])/g, '');

/**
 * 词级差异。exact = true 时不去掉【注】，保证 "=" 与 "+" 片段按顺序拼起来恰好等于 text
 * （可编辑原文的高亮底层需要与文本框逐字对齐）。
 */
export function diffTexts(base: string, text: string, lang: 'en' | 'zh', exact = false): { parts: DiffPart[]; ins: number; del: number } {
  const prep = exact ? (s: string) => s : stripNotes;
  const parts = cleanupDiff(diffTokens(tokenize(prep(base), lang), tokenize(prep(text), lang)), lang);
  let ins = 0, del = 0;
  for (const p of parts) {
    if (p.t === '=') continue;
    const n = tokenize(p.v, lang).filter(x => x.trim()).length;
    if (p.t === '+') ins += n; else del += n;
  }
  return { parts, ins, del };
}
