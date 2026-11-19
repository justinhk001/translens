/** 极简 Markdown 渲染（表格、列表、段落、粗体、行内代码），先转义再加标签，杜绝注入 */
export const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

export function renderMarkdown(md: string): string {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|?\s*$/.test(lines[i]) && lines[i].includes('|')) { rows.push(cells(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hm) { out.push(`<h4>${inline(hm[2])}</h4>`); i++; continue; }
    if (!line.trim()) { i++; continue; }
    // 普通段落：至少消费当前行（流式输出时可能出现不完整的表格行，不能卡住）
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*\|/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}
