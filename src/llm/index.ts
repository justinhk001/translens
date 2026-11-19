import type { AppState, Provider } from '../types';
import { anthropicChat, anthropicModels } from './anthropic';
import { deepseekBalance, openaiChat, openaiModels } from './openai';
import type { ChatRequest, ChatResult } from './types';

export { LlmError, isAbort } from './types';
export type { ChatRequest, ChatResult } from './types';

/**
 * 经由自部署代理（Cloudflare Pages Function /api/proxy）转发：
 * 真实目标地址放在 x-target-url 头里，代理只做转发、不记录。
 */
export function proxiedFetch(proxy: AppState['proxy']): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-target-url', url);
    if (proxy.token) headers.set('x-proxy-token', proxy.token);
    return fetch(proxy.url || '/api/proxy', { ...init, headers });
  };
}

const fetchFor = (p: Provider, proxy: AppState['proxy']) => (p.useProxy ? proxiedFetch(proxy) : undefined);
const plainFetch: typeof fetch = (i, init) => fetch(i, init);

export function chat(p: Provider, model: string, req: ChatRequest, proxy: AppState['proxy']): Promise<ChatResult> {
  const f = fetchFor(p, proxy);
  return p.protocol === 'anthropic' ? anthropicChat(p, model, req, f) : openaiChat(p, model, req, f ?? plainFetch);
}

export function listModels(p: Provider, proxy: AppState['proxy']): Promise<string[]> {
  const f = fetchFor(p, proxy);
  return p.protocol === 'anthropic' ? anthropicModels(p, f) : openaiModels(p, f ?? plainFetch);
}

export function balance(p: Provider, proxy: AppState['proxy']): Promise<string> {
  return deepseekBalance(p, fetchFor(p, proxy) ?? plainFetch);
}
