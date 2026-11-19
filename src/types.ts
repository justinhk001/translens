export type Dir = 'en-zh' | 'zh-en';
/** 用户在工具条里选的方向：auto = 按原文自动判断（中文→英文，其他→中文） */
export type DirSetting = 'auto' | Dir;
/**
 * 格式处理方式（全部由模型按提示词处理，本地不改动原文）：
 * model = 去除无关格式标记
 * raw   = 保留原格式，只翻译文字
 */
export type FormatMode = 'model' | 'raw';
export type PromptLang = 'zh' | 'en';
export type View = 'auto' | 'row' | 'col' | 'tgt';
/** numbered = 按段编号（<seg id="n">），可按段对照；plain = 整篇一起发送 */
export type Format = 'numbered' | 'plain';

/** 一个段落（以空行分隔），原样发送 */
export interface Segment {
  para: number;
  src: string;
  tgt: string;
  demoMiss?: boolean;
}

export interface Usage { input: number; output: number; cacheHit: number }

export interface Run {
  id: string;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
  segs: Segment[];
  format: Format;
  sourceSnap: string;
  latex: FormatMode;
  dir: Dir;
  promptId: string;
  providerName: string;
  model: string;
  usage: Usage;
  cost?: { value: number; currency: string };
  cachedParas: number;
  totalParas: number;
  reasoning?: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface TabSettings {
  dir: DirSetting;
  promptId: string;
  providerId: string;
  model: string;
  /** 格式处理方式（字段名沿用旧版） */
  latex: FormatMode;
  view: View;
}

export interface Analysis {
  baseId: string;
  baseTitle: string;
  text: string;
  status: 'running' | 'done' | 'error';
  model: string;
  at: number;
  /** 分析时两个版本的原文快照，原文变了就重新分析 */
  sourceSnap: string;
}

export interface Tab {
  id: string;
  title: string;
  color: string;
  kind: 'translate' | 'reference';
  source: string;
  settings: TabSettings;
  innerRatio: number;
  editing: boolean;
  runs: Run[];
  current: number;
  analysis?: Analysis;
}

export interface SplitNode { type: 'split'; id: string; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }
export interface GroupNode { type: 'group'; id: string; tabs: string[]; active: string }
export type LayoutNode = SplitNode | GroupNode;

export interface Workspace {
  id: string;
  name: string;
  tabs: Record<string, Tab>;
  layout: LayoutNode;
  focusGroup: string;
  baseTabId: string;
  maximized: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Price { input: number; output: number; cacheHit: number; currency: 'CNY' | 'USD' }

export interface Provider {
  id: string;
  kind: string;
  protocol: 'openai' | 'anthropic';
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  model: string;
  useProxy: boolean;
  keyMode: 'persist' | 'session';
  temperature: number | null;
  effort: '' | 'low' | 'medium' | 'high';
  concurrency: number;
  price: Price | null;
}

export interface PromptPreset {
  id: string;
  name: { zh: string; en: string };
  /** 一句话说明这个翻译模式适合什么场景 */
  desc: string;
  builtin: boolean;
  /** 内置模式被用户改过（升级时不会被覆盖，可一键重置） */
  modified?: boolean;
  system: { zh: string; en: string };
}

/** 格式规则的用户修改（键：model / raw） */
export type MarkupRuleOverrides = Partial<Record<FormatMode, Partial<Record<PromptLang, string>>>>;

export interface AppState {
  version: 2;
  /** 数据修订号：用于一次性迁移 */
  rev?: number;
  workspaces: Workspace[];
  activeWs: string;
  providers: Provider[];
  prompts: PromptPreset[];
  promptLang: PromptLang;
  numbered: boolean;
  cacheOn: boolean;
  proxy: { url: string; token: string };
  markupRules: MarkupRuleOverrides;
  /** 自定义宏说明（每行 \宏名 = 含义），原文中出现时写进提示词告诉模型 */
  macros: string;
  glossary: string;
  glossaryOn: boolean;
  ui: { theme: 'auto' | 'light' | 'dark'; fs: number; font: 'sans' | 'serif'; sync: boolean; diff: boolean };
  lastRun: { title: string; model: string; usage: Usage; ms: number; cost?: { value: number; currency: string } } | null;
}
