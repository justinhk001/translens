import type { Usage } from '../types';

export interface ChatRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  /** 模型进入"思考"阶段（DeepSeek reasoner 的 reasoning_content、Claude 的 thinking 块） */
  onReasoning?: () => void;
}

export interface ChatResult { usage: Usage | null }

export type LlmErrorKind = 'config' | 'network' | 'auth' | 'quota' | 'notfound' | 'bad' | 'server' | 'refusal' | 'other';

export class LlmError extends Error {
  constructor(message: string, public kind: LlmErrorKind, public status?: number) { super(message); this.name = 'LlmError'; }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, fail) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

export const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError' || (e as { name?: string })?.name === 'APIUserAbortError';
