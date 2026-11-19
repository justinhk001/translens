import type { Provider } from '../types';
import { type ChatRequest, type ChatResult, LlmError, isAbort } from './types';

/** 支持服务端拒答回退（server-side fallbacks）的模型 */
const FALLBACK_MODELS = /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/;

async function client(p: Provider, f?: typeof fetch) {
  // 按需加载官方 SDK：不用 Claude 的用户不会下载这部分代码
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return {
    Anthropic,
    c: new Anthropic({
      apiKey: p.apiKey.trim(),
      baseURL: p.baseUrl.trim() || undefined,
      dangerouslyAllowBrowser: true, // Key 由用户自己填写并只保存在本地浏览器
      fetch: f,
      maxRetries: 2,
    }),
  };
}

function mapError(Anthropic: typeof import('@anthropic-ai/sdk').default, e: unknown): never {
  if (isAbort(e)) throw e;
  if (e instanceof Anthropic.AuthenticationError) throw new LlmError('401 API Key 无效或缺失', 'auth', 401);
  if (e instanceof Anthropic.PermissionDeniedError) throw new LlmError('403 无权限使用该模型', 'auth', 403);
  if (e instanceof Anthropic.NotFoundError) throw new LlmError('404 模型不存在，请检查模型名', 'notfound', 404);
  if (e instanceof Anthropic.RateLimitError) throw new LlmError('429 请求过于频繁或额度不足', 'quota', 429);
  if (e instanceof Anthropic.BadRequestError) throw new LlmError('400 请求参数有误：' + e.message.slice(0, 240), 'bad', 400);
  if (e instanceof Anthropic.APIConnectionError) throw new LlmError('无法连接 Anthropic：可能是网络或跨域限制，可为该服务开启代理。', 'network');
  if (e instanceof Anthropic.APIError) throw new LlmError(`${e.status ?? ''} ${e.message.slice(0, 240)}`, (e.status ?? 0) >= 500 ? 'server' : 'other', e.status ?? undefined);
  throw e;
}

export async function anthropicChat(p: Provider, model: string, req: ChatRequest, f?: typeof fetch): Promise<ChatResult> {
  if (!model) throw new LlmError('未填写模型名（设置 → 模型服务）', 'config');
  const { Anthropic, c } = await client(p, f);
  const base = {
    model,
    max_tokens: 32000,
    system: req.system,
    messages: [{ role: 'user' as const, content: req.user }],
    // 翻译不需要深度思考：用 effort 控制思考深度（新模型不接受 temperature 等采样参数，因此不发送）
    ...(p.effort ? { output_config: { effort: p.effort } } : {}),
  };
  try {
    const stream = FALLBACK_MODELS.test(model)
      ? c.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: req.signal })
      : c.messages.stream(base, { signal: req.signal });
    for await (const ev of stream as AsyncIterable<any>) {
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') req.onReasoning?.();
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') req.onText(ev.delta.text);
    }
    const msg: any = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      const cat = msg.stop_details?.category ? `（${msg.stop_details.category}）` : '';
      throw new LlmError('模型拒绝了这次请求' + cat + '，可换一个模型重试。', 'refusal');
    }
    const u = msg.usage || {};
    const cacheHit = u.cache_read_input_tokens ?? 0;
    return { usage: { input: (u.input_tokens ?? 0) + cacheHit + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cacheHit } };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    mapError(Anthropic, e);
  }
}

export async function anthropicModels(p: Provider, f?: typeof fetch): Promise<string[]> {
  const { Anthropic, c } = await client(p, f);
  try {
    const ids: string[] = [];
    for await (const m of c.models.list()) ids.push(m.id);
    return ids;
  } catch (e) { mapError(Anthropic, e); }
}
