import type { Provider } from '../types';

export interface ProviderTemplate {
  kind: string;
  name: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  models: string[];
  model: string;
  /** 是否发送 stream_options.include_usage（不认识该字段的服务会报错，只对确认支持的服务开启） */
  streamUsage?: boolean;
  /** 是否支持查询余额（DeepSeek） */
  balance?: boolean;
  effort?: Provider['effort'];
  hint: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    kind: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'], model: 'deepseek-chat', streamUsage: true, balance: true,
    hint: 'deepseek-chat 适合翻译；deepseek-reasoner 会先思考，更慢也更贵。官方建议翻译场景 temperature 设为 1.3（留空为默认值）。支持查询余额与缓存命中统计。',
  },
  {
    kind: 'anthropic', name: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], model: 'claude-opus-5-5', effort: 'low',
    hint: '使用 Anthropic 官方 SDK 从浏览器直连。claude-haiku-5-5 最便宜最快；翻译建议思考强度 low。Opus 5.5 / Sonnet 5.5 默认开启服务端拒答回退（fallbacks）。',
  },
  { kind: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', models: [], model: '', streamUsage: true, hint: '填入模型名，或点「获取模型列表」。' },
  { kind: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', models: [], model: '', streamUsage: true, hint: '一个 Key 调用多家模型，模型名形如 deepseek/deepseek-chat。' },
  { kind: 'siliconflow', name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', models: [], model: '', hint: '国内可用，提供 DeepSeek、Qwen 等开源模型。' },
  { kind: 'dashscope', name: '阿里百炼（兼容模式）', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [], model: '', hint: '通义千问等模型。' },
  { kind: 'moonshot', name: 'Moonshot（Kimi）', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', models: [], model: '', hint: '' },
  { kind: 'zhipu', name: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: [], model: '', hint: '' },
  { kind: 'gemini', name: 'Gemini（OpenAI 兼容）', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [], model: '', hint: '使用 Google 的 OpenAI 兼容接口。' },
  { kind: 'ollama', name: 'Ollama（本地）', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', models: [], model: '', hint: '本地模型，数据不出本机。需设置环境变量 OLLAMA_ORIGINS 允许本站来源（如 OLLAMA_ORIGINS=*）。' },
  { kind: 'lmstudio', name: 'LM Studio（本地）', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', models: [], model: '', hint: '在 LM Studio 中开启本地服务器与 CORS。' },
  { kind: 'custom', name: '自定义（OpenAI 兼容）', protocol: 'openai', baseUrl: '', models: [], model: '', hint: '任何兼容 /chat/completions 的服务。Base URL 通常以 /v1 结尾。' },
];

export const templateOf = (kind: string) => PROVIDER_TEMPLATES.find(t => t.kind === kind) || PROVIDER_TEMPLATES[PROVIDER_TEMPLATES.length - 1];

export function providerFromTemplate(t: ProviderTemplate, id: string): Provider {
  return {
    id, kind: t.kind, protocol: t.protocol, name: t.name, baseUrl: t.baseUrl, apiKey: '',
    models: [...t.models], model: t.model, useProxy: false, keyMode: 'persist',
    temperature: null, effort: t.effort ?? '', concurrency: 2, price: null,
  };
}
