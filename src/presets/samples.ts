import { splitParagraphs } from '../core/segment';
import type { FormatMode } from '../types';

/** 内置示例：同一段 Abstract 的原稿与两个 AI 润色版本（用于演示模式，不调用任何 API） */
export const SAMPLES = [
  {
    title: '原稿', color: '#2f6feb',
    source: String.raw`% Abstract · 初稿 v0
Long document understanding is a important problem in NLP, but existing methods based on Transformer~\cite{vaswani2017attention} suffer from the $\mathcal{O}(n^2)$ complexity. In this paper, we propose \ours{}, a novel sparse attention method that can reduce the complexity to $\mathcal{O}(n \log n)$. Experiments on three benchmarks show that \ours{} improves the accuracy by 2.3\% compared with baselines (see Table~\ref{tab:main}). The code will be released.`,
    clean: String.raw`长文档理解是 NLP 中的一个重要问题，但现有基于 Transformer 的方法受困于 $\mathcal{O}(n^2)$ 的复杂度。【注：原文 “a important” 应为 “an important”。】在本文中，我们提出了 XNet，一种新颖的稀疏注意力方法，能够将复杂度降低到 $\mathcal{O}(n \log n)$。在三个基准上的实验表明，与基线相比，XNet 将准确率提高了 2.3%。代码将会发布。`,
    zh: [
      String.raw`长文档理解是 NLP 中的一个重要问题，但现有基于 Transformer~\cite{vaswani2017attention} 的方法受困于 $\mathcal{O}(n^2)$ 的复杂度。【注：原文 “a important” 应为 “an important”。】`,
      String.raw`在本文中，我们提出了 \ours{}，一种新颖的稀疏注意力方法，能够将复杂度降低到 $\mathcal{O}(n \log n)$。`,
      String.raw`在三个基准上的实验表明，与基线相比，\ours{} 将准确率提高了 2.3\%（见表~\ref{tab:main}）。`,
      String.raw`代码将会发布。`,
    ],
  },
  {
    title: 'GPT 润色', color: '#1a7f37',
    source: String.raw`Understanding long documents is a fundamental challenge in natural language processing; however, existing Transformer-based approaches~\cite{vaswani2017attention} are hindered by their $\mathcal{O}(n^2)$ complexity. In this paper, we propose \ours{}, a novel sparse attention mechanism that reduces this complexity to $\mathcal{O}(n \log n)$. Experiments on three benchmarks demonstrate that \ours{} consistently improves accuracy by 2.3\% over strong baselines (Table~\ref{tab:main}). Our code will be made publicly available.`,
    clean: String.raw`理解长文档是自然语言处理中的一项根本性挑战；然而，现有基于 Transformer 的方法受制于其 $\mathcal{O}(n^2)$ 的复杂度。在本文中，我们提出了 XNet，一种新颖的稀疏注意力机制，可将该复杂度降低至 $\mathcal{O}(n \log n)$。在三个基准上的实验表明，与强基线相比，XNet 能够持续地将准确率提升 2.3%。我们的代码将会公开发布。`,
    zh: [
      String.raw`理解长文档是自然语言处理中的一项根本性挑战；然而，现有基于 Transformer 的方法~\cite{vaswani2017attention} 受制于其 $\mathcal{O}(n^2)$ 的复杂度。`,
      String.raw`在本文中，我们提出了 \ours{}，一种新颖的稀疏注意力机制，可将该复杂度降低至 $\mathcal{O}(n \log n)$。`,
      String.raw`在三个基准上的实验表明，与强基线相比，\ours{} 能够持续地将准确率提升 2.3\%（表~\ref{tab:main}）。`,
      String.raw`我们的代码将会公开发布。`,
    ],
  },
  {
    title: 'Claude 润色', color: '#8250df',
    source: String.raw`Long-document understanding remains an important problem in NLP, yet existing Transformer-based methods~\cite{vaswani2017attention} scale poorly due to their $\mathcal{O}(n^2)$ complexity. We propose \ours{}, a sparse attention method that lowers the complexity to $\mathcal{O}(n \log n)$. On three benchmarks, \ours{} improves accuracy by up to 2.3\% compared with baselines (Table~\ref{tab:main}). We will release our code.`,
    clean: String.raw`长文档理解仍然是 NLP 中的一个重要问题，然而现有基于 Transformer 的方法由于其 $\mathcal{O}(n^2)$ 的复杂度而扩展性较差。我们提出了 XNet，一种将复杂度降低至 $\mathcal{O}(n \log n)$ 的稀疏注意力方法。在三个基准上，与基线相比，XNet 将准确率最多提高了 2.3%。我们将发布我们的代码。`,
    zh: [
      String.raw`长文档理解仍然是 NLP 中的一个重要问题，然而现有基于 Transformer 的方法~\cite{vaswani2017attention} 由于其 $\mathcal{O}(n^2)$ 的复杂度而扩展性较差。`,
      String.raw`我们提出了 \ours{}，一种将复杂度降低至 $\mathcal{O}(n \log n)$ 的稀疏注意力方法。`,
      String.raw`在三个基准上，与基线相比，\ours{} 将准确率最多提高了 2.3\%（表~\ref{tab:main}）。`,
      String.raw`我们将发布我们的代码。`,
    ],
  },
];

const sig = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '').slice(0, 160);

/** 演示查表键：段落里的英文字母（与格式处理方式无关） */
export const demoKey = (src: string) => sig(src);

/**
 * 演示译文（预先写好，不做任何本地处理）：
 * - 去除无关格式标记：干净的中文
 * - 保留原格式：带 LaTeX 的中文，注释行原样保留
 */
export function demoOutput(src: string, mode: FormatMode): string | null {
  const s = SAMPLES.find(x => sig(x.source) === sig(src));
  if (!s) return null;
  if (mode === 'model') return s.clean;
  const comment = /^\s*%.*$/m.exec(s.source)?.[0];
  return (comment ? comment + '\n' : '') + s.zh.join('');
}

const ANALYSIS_GPT = `| # | A 的表述 | B 的表述 | 变化类型 | 影响说明 |
|---|---|---|---|---|
| 1 | improves the accuracy by 2.3% compared with baselines | **consistently** improves accuracy by 2.3% over **strong** baselines | 论断强度增强 | 新增 “consistently（持续地）” 和 “strong（强）”，暗示在所有设置下都稳定提升、且对比对象更强。请确认实验结果是否支持。 |
| 2 | a important problem | a **fundamental challenge** | 程度增强 | “根本性挑战”比“重要问题”语气更强。 |
| 3 | The code will be released. | Our code will be made **publicly** available. | 承诺范围更明确 | 增加 “publicly（公开）”，对代码开放的承诺更具体。 |`;

const ANALYSIS_CLAUDE = `| # | A 的表述 | B 的表述 | 变化类型 | 影响说明 |
|---|---|---|---|---|
| 1 | improves the accuracy by 2.3% | improves accuracy by **up to** 2.3% | 数据含义变化 | “up to（最多）”把总体提升变成了最大值，结论被削弱。 |
| 2 | a **novel** sparse attention method | a sparse attention method | 信息删除 | 删去 “novel（新颖的）”，弱化了创新性表述。 |
| 3 | suffer from the O(n^2) complexity | **scale poorly** due to their O(n^2) complexity | 因果表述变化 | 从“受困于复杂度”变为“因复杂度而扩展性差”，更具体，含义相近。 |`;

function build() {
  const whole = (src: string) => sig(splitParagraphs(src).join(' '));
  const analysis = new Map<string, string>([
    [whole(SAMPLES[0].source) + '|' + whole(SAMPLES[1].source), ANALYSIS_GPT],
    [whole(SAMPLES[0].source) + '|' + whole(SAMPLES[2].source), ANALYSIS_CLAUDE],
  ]);
  return { analysis, whole };
}

export const DEMO = build();
