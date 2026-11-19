import type { Provider } from '../types';

export interface ProviderTemplate {
  kind: string;
  name: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  models: string[];
  model: string;
  /** 默认 temperature；null 表示不传（如 Anthropic 新模型） */
  temperature?: number | null;
  /** 获取模型列表后优先自动选中的聊天/翻译模型匹配顺序 */
  preferredModels?: RegExp[];
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
    models: ['deepseek-chat', 'deepseek-reasoner'], model: 'deepseek-chat', temperature: 1.3,
    preferredModels: [/^deepseek-chat$/i, /deepseek-chat/i],
    streamUsage: true, balance: true,
    hint: 'deepseek-chat 适合翻译；deepseek-reasoner 会先思考，更慢也更贵。已按官方翻译建议预设 temperature = 1.3（高级设置可调）。支持查询余额与缓存命中统计。',
  },
  {
    kind: 'anthropic', name: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], model: 'claude-opus-5-5', temperature: null, effort: 'low',
    preferredModels: [/claude-sonnet/i, /claude-opus/i, /claude-haiku/i],
    hint: '使用 Anthropic 官方 SDK 从浏览器直连。claude-haiku-5-5 最便宜最快；已预设思考强度 low。Opus 5.5 / Sonnet 5.5 默认开启服务端拒答回退（fallbacks）。',
  },
  {
    kind: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', models: [], model: '', temperature: 0.3,
    preferredModels: [/^gpt-4o$/i, /^gpt-4\.1$/i, /^gpt-4o-mini$/i, /^gpt-4\.1-mini$/i, /^gpt-5(?:-chat)?$/i, /^gpt-4/i],
    streamUsage: true, hint: '已预设温度 0.3（适合忠实翻译）。填写 API Key 后点「获取模型」直接选择，也可手动输入。',
  },
  {
    kind: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', models: [], model: '', temperature: 0.3,
    preferredModels: [/deepseek\/deepseek-chat/i, /openai\/gpt-4o$/i, /anthropic\/claude.*sonnet/i],
    streamUsage: true, hint: '一个 Key 调用多家模型，模型名形如 deepseek/deepseek-chat。已预设温度 0.3。',
  },
  {
    kind: 'siliconflow', name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', models: [], model: '', temperature: 0.3,
    preferredModels: [/DeepSeek-V3/i, /Qwen2\.5-72B-Instruct/i, /Qwen3/i, /DeepSeek/i],
    hint: '国内可用，提供 DeepSeek、Qwen 等开源模型。已预设温度 0.3。',
  },
  {
    kind: 'dashscope', name: '阿里百炼（兼容模式）', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [], model: '', temperature: 0.3,
    preferredModels: [/^qwen-plus$/i, /^qwen-max$/i, /^qwen-turbo$/i, /^qwen/i],
    hint: '通义千问等模型。已预设温度 0.3。',
  },
  {
    kind: 'moonshot', name: 'Moonshot（Kimi）', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', models: [], model: '', temperature: 0.3,
    preferredModels: [/^kimi-k2/i, /^moonshot-v1-32k$/i, /^moonshot-v1-8k$/i, /kimi|moonshot/i],
    hint: '已预设温度 0.3。',
  },
  {
    kind: 'zhipu', name: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: [], model: '', temperature: 0.3,
    preferredModels: [/^glm-4-plus$/i, /^glm-4\.5/i, /^glm-4-air$/i, /^glm-4/i],
    hint: '已预设温度 0.3。',
  },
  {
    kind: 'gemini', name: 'Gemini（OpenAI 兼容）', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [], model: '', temperature: 0.3,
    preferredModels: [/gemini-2\.5-flash$/i, /gemini-2\.5-pro$/i, /gemini-2\.0-flash$/i, /gemini.*flash/i, /gemini/i],
    hint: '使用 Google 的 OpenAI 兼容接口。已预设温度 0.3。',
  },
  {
    kind: 'ollama', name: 'Ollama（本地）', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', models: [], model: '', temperature: 0.3,
    hint: '本地模型，数据不出本机。需设置环境变量 OLLAMA_ORIGINS 允许本站来源（如 OLLAMA_ORIGINS=*）。已预设温度 0.3。',
  },
  {
    kind: 'lmstudio', name: 'LM Studio（本地）', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', models: [], model: '', temperature: 0.3,
    hint: '在 LM Studio 中开启本地服务器与 CORS。已预设温度 0.3。',
  },
  {
    kind: 'custom', name: '自定义（OpenAI 兼容）', protocol: 'openai', baseUrl: '', models: [], model: '', temperature: 0.3,
    hint: '任何兼容 /chat/completions 的服务。Base URL 通常以 /v1 结尾。已预设温度 0.3。',
  },
];

export const templateOf = (kind: string) => PROVIDER_TEMPLATES.find(t => t.kind === kind) || PROVIDER_TEMPLATES[PROVIDER_TEMPLATES.length - 1];

export const isLocalProvider = (kind: string): boolean => kind === 'ollama' || kind === 'lmstudio';

const NON_CHAT_MODEL = /(?:^|[-_/.:])(embed|embedding|whisper|tts|dall-e|imagen|moderation|rerank|reranker|audio|realtime|transcribe|speech|vision-preview|babbage|davinci|omni-moderation|sora|veo|lyria|aqa|text-embedding)(?:$|[-_/.:])/i;

/** 从获取到的模型列表里挑一个适合作为默认值的聊天/翻译模型 */
export function pickDefaultModel(ids: string[], kind: string): string {
  if (!ids.length) return '';
  const preferred = templateOf(kind).preferredModels;
  if (preferred) {
    for (const re of preferred) {
      const hit = ids.find(id => re.test(id));
      if (hit) return hit;
    }
  }
  return ids.find(id => !NON_CHAT_MODEL.test(id)) || ids[0];
}

export function providerFromTemplate(t: ProviderTemplate, id: string): Provider {
  return {
    id, kind: t.kind, protocol: t.protocol, name: t.name, baseUrl: t.baseUrl, apiKey: '',
    models: [...t.models], model: t.model, useProxy: false, keyMode: 'persist',
    temperature: t.temperature ?? null, effort: t.effort ?? '', concurrency: 2, price: null,
  };
}
