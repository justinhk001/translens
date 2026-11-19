import type { Provider } from '../types';
import { templateOf } from '../presets/providers';
import { type ChatRequest, type ChatResult, LlmError, isAbort, sleep } from './types';

export const normBase = (u: string) => (u || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
const hostOf = (u: string) => { try { return new URL(u, location.href).host; } catch { return u; } };

const STATUS_TEXT: Record<number, string> = {
  400: '请求参数有误（检查模型名）', 401: 'API Key 无效或缺失', 402: '账户余额不足', 403: '无权限或地区受限',
  404: '接口地址或模型不存在（OpenAI 兼容地址通常以 /v1 结尾）', 422: '请求参数有误', 429: '请求过于频繁或额度不足',
  500: '服务端错误', 502: '网关错误', 503: '服务繁忙，稍后重试', 504: '网关超时',
};
const KIND: Record<number, LlmError['kind']> = { 400: 'bad', 401: 'auth', 402: 'quota', 403: 'auth', 404: 'notfound', 422: 'bad', 429: 'quota' };

async function send(f: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await f(url, { ...init, signal }); }
    catch (e) {
      if (isAbort(e)) throw e;
      throw new LlmError(`无法连接 ${hostOf(url)}：可能是跨域（CORS）限制、地址错误或网络问题。可在「设置 → 模型服务」为该服务开启代理。`, 'network');
    }
    if (res.ok) return res;
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) { await sleep(1500 * (attempt + 1), signal); continue; }
    let detail = '';
    try { const t = await res.text(); try { const j = JSON.parse(t); detail = j.error?.message || j.message || t; } catch { detail = t; } } catch { /* ignore */ }
    throw new LlmError(`${res.status} ${STATUS_TEXT[res.status] || '请求失败'}${detail ? ' · ' + String(detail).slice(0, 240) : ''}`, KIND[res.status] || (res.status >= 500 ? 'server' : 'other'), res.status);
  }
}

const authHeaders = (p: Provider): Record<string, string> => (p.apiKey.trim() ? { Authorization: 'Bearer ' + p.apiKey.trim() } : {});

/** 已知不接受 temperature 参数的推理模型 */
const NO_TEMP_MODELS = /(?:^|\/)(?:o[134](?:$|[-.])|deepseek-reasoner$)/i;

/** OpenAI 兼容 /chat/completions 流式调用（DeepSeek、OpenAI、OpenRouter、Ollama 等） */
export async function openaiChat(p: Provider, model: string, req: ChatRequest, f: typeof fetch): Promise<ChatResult> {
  const base = normBase(p.baseUrl);
  if (!base) throw new LlmError('未填写 Base URL（设置 → 模型服务）', 'config');
  if (!model) throw new LlmError('未填写模型名（设置 → 模型服务）', 'config');
  const body: Record<string, unknown> = {
    model, stream: true,
    messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
  };
  if (p.temperature != null && !NO_TEMP_MODELS.test(model)) body.temperature = p.temperature;
  if (templateOf(p.kind).streamUsage) body.stream_options = { include_usage: true };
  const post = () => send(f, base + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(p) }, body: JSON.stringify(body),
  }, req.signal);
  let res: Response;
  try {
    res = await post();
  } catch (e) {
    if (body.temperature !== undefined && e instanceof LlmError && e.status === 400 && /temperature/i.test(e.message)) {
      delete body.temperature;
      res = await post();
    } else {
      throw e;
    }
  }

  type U = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  const toUsage = (u: U | null | undefined) => (u ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheHit: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0 } : null);

  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const j = await res.json();
    req.onText(j.choices?.[0]?.message?.content || '');
    return { usage: toUsage(j.usage) };
  }
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = '', usage: U | null = null, reasoningSent = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return { usage: toUsage(usage) };
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new LlmError(String(j.error.message || j.error), 'server');
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if ((d.reasoning_content || d.reasoning) && !reasoningSent) { reasoningSent = true; req.onReasoning?.(); }
      if (d.content) req.onText(d.content);
    }
  }
  return { usage: toUsage(usage) };
}

export async function openaiModels(p: Provider, f: typeof fetch): Promise<string[]> {
  const res = await send(f, normBase(p.baseUrl) + '/models', { headers: authHeaders(p) });
  const j = await res.json();
  return (j.data || j.models || []).map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean).sort();
}

/** DeepSeek 余额查询：GET /user/balance */
export async function deepseekBalance(p: Provider, f: typeof fetch): Promise<string> {
  const base = normBase(p.baseUrl).replace(/\/v1$/, '');
  const res = await send(f, base + '/user/balance', { headers: authHeaders(p) });
  const j = await res.json();
  const infos: { currency: string; total_balance: string }[] = j.balance_infos || [];
  if (!infos.length) return j.is_available === false ? '余额不足' : '无余额信息';
  return infos.map(b => `${b.total_balance} ${b.currency}`).join(' · ') + (j.is_available === false ? '（不可用）' : '');
}
