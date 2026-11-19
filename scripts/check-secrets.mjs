#!/usr/bin/env node
/**
 * 检查会进入 git 仓库的文件里有没有 API Key 等密钥。
 *
 *   node scripts/check-secrets.mjs           扫描所有会被提交的文件（已跟踪 + 未被 .gitignore 忽略的新文件）
 *   node scripts/check-secrets.mjs --staged  只扫描暂存区（.githooks/pre-commit 用）
 *
 * 确实需要保留的行（例如文档里的假 Key 示例），在该行加注释 secret-scan:ignore。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES = [
  ['sk- 开头的 API Key（DeepSeek / OpenAI / Claude / OpenRouter / 硅基流动 / 百炼 / Moonshot 等）', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Google / Gemini API Key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['智谱 API Key', /\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/],
  ['xAI API Key', /\bxai-[A-Za-z0-9]{20,}/],
  ['GitHub Token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Cloudflare / 其他 Bearer Token', /\bBearer\s+[A-Za-z0-9._-]{30,}/],
  ['私钥', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JSON 里填了值的 apiKey 字段（可能是导出的备份）', /"apiKey"\s*:\s*"[^"\s]{8,}"/],
];

const staged = process.argv.includes('--staged');
const git = (...args) => execFileSync('git', args, { maxBuffer: 256 << 20 });

let files;
try {
  const out = staged
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard');
  files = out.toString('utf8').split('\0').filter(Boolean);
} catch {
  console.error('check-secrets：需要在 git 仓库里运行（先执行 git init）。');
  process.exit(2);
}

const mask = s => s.slice(0, 6) + '****' + (s.length > 14 ? s.slice(-2) : '');
const hits = [];
for (const f of files) {
  let buf;
  try { buf = staged ? git('show', ':' + f) : readFileSync(f); } catch { continue; }
  if (buf.length > 5 << 20 || buf.includes(0)) continue; // 跳过二进制和超大文件
  buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.includes('secret-scan:ignore')) return;
    for (const [name, re] of RULES) {
      const m = line.match(re);
      if (m) hits.push(`  ${f}:${i + 1}  ${name}  →  ${mask(m[0])}`);
    }
  });
}

if (hits.length) {
  console.error(`\n✖ 发现 ${hits.length} 处疑似密钥，已阻止：\n\n${hits.join('\n')}\n`);
  console.error('请删除这些内容（Key 只应填在网页的「设置 → 模型服务」里，或通过环境变量传给测试）。');
  console.error('如果已经提交或推送过，请立即到对应平台作废并重新生成 Key。\n');
  process.exit(1);
}
console.log(`✓ 已检查 ${files.length} 个文件，没有发现 API Key 等密钥。`);
