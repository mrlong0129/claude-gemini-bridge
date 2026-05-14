// Prompt templates for Gemini Research plugin
// Three modes: ask / research / augment
//
// Shared rules (baked into every prompt):
//   - Cite sources (URL) for every non-trivial claim
//   - No hallucination: if unknown, say "unknown" instead of inventing
//   - Language: match the user's task language (Chinese task → Chinese reply)
//   - Preserve original terms (ACOS, ASIN, MCP, CVR, etc. — do not translate)

export const MODES = ["ask", "research", "augment"];

const TODAY = () => new Date().toISOString().slice(0, 10);

function formatBaseline(baseline) {
  if (!baseline || baseline.included.length === 0) {
    return "（无 baseline 文件 / no baseline files）";
  }
  const blocks = baseline.included
    .map(
      (f) => `<baseline path="${f.path}" bytes="${f.bytes}" truncated="${f.truncated}">
${f.content}
</baseline>`
    )
    .join("\n\n");
  const skipped =
    baseline.skipped.length > 0
      ? `\n跳过的文件: ${baseline.skipped.map((s) => `${s.path}(${s.reason})`).join(", ")}`
      : "";
  return `共 ${baseline.included.length} 个 baseline 文件${skipped}\n\n${blocks}`;
}

const SHARED_RULES = `<rules>
- 每一个非常识性论断必须附来源 URL。没有来源就说"来源不确定"或"需要验证"，不要编。
- 保留专业术语原文（ACOS、ASIN、MCP、CVR、CPC、ROAS、BSR、SP/SD/SB、AMC 等），不翻译。
- 如果用户用中文提问，用中文回答。如果用英文提问，用英文回答。
- 语言风格：直接、无废话、无营销话术。
- 不确定的信息，明确标注"不确定"或"待验证"。
- 区分事实、推理、观点。
</rules>`;

// ---------- ASK mode ----------
// Simple Q&A: scoped to one question, direct answer with citations.
function askPrompt({ task, baseline }) {
  return `你是一名研究助手，擅长跨境电商领域（Amazon、TikTok Shop、Shopify 等）和 AI Agent 技术。

${SHARED_RULES}

<baseline_context>
${formatBaseline(baseline)}
</baseline_context>

<task>
${task}
</task>

<output_format>
## 回答
[直接回答问题，关键事实带行内来源标注，如 "根据 Amazon 官方公告 [1]"]

## 来源
[1] 标题 — URL
[2] 标题 — URL
...

## 置信度
- 高/中/低 + 简短理由
</output_format>`;
}

// ---------- RESEARCH mode ----------
// Deep research producing a structured knowledge-base draft.
function researchPrompt({ task, baseline, domain, topic }) {
  const date = TODAY();
  const domainLabel = domain || "（未指定，请推断）";

  return `你是一名深度研究助手。用户是跨境电商行业的从业者（产品 / 运营 / 工程），需要在特定主题上获得深度、有来源、结构化的 know-how。

${SHARED_RULES}

<research_task>
${task}
</research_task>

<research_context>
领域: ${domainLabel}
主题 slug: ${topic || "（由你根据 task 推断）"}
研究日期: ${date}
</research_context>

<baseline_knowhow>
以下是用户已有的相关 know-how。你的研究应该**对这些已有认知产生增量**——重复已有内容无价值。

${formatBaseline(baseline)}
</baseline_knowhow>

<output_format>
严格按以下 Markdown 格式输出，这将直接写入用户的知识库文件：

---
created: ${date}
source: gemini
tool: gemini
domain: ${domainLabel}
---

# {主题标题}

## Meta

| 属性 | 值 |
|------|-----|
| 研究方向 | {领域} |
| 主题 | {主题关键词，英文逗号分隔} |
| 来源 | 🤖 Gemini 研究（${date}） |
| 研究日期 | ${date} |

## 核心发现（TL;DR）

3-5 条 bullet，每条附内联来源 [n]。

## 详细内容

按逻辑分节展开。每节必须：
- 附具体数据、案例、时间点
- 关键论断必须有 [n] 标注对应下方来源
- 避免空泛的"一般来说"、"通常"

## 与已有 know-how 的增量

对照 baseline，明确列出：
- 🆕 **新发现**（baseline 没有的）
- ✅ **已验证**（baseline 已有、本次研究确认）
- ⚠️ **与已有认知冲突**（如有）
- 🔄 **已有内容的最新状态**（如有更新）

如果 baseline 为空，直接写"无 baseline，全部为新内容"。

## 待校准

2-4 条 open question 或需人工验证的假设。这些是 Gemini 不确定、但对用户决策重要的点。

## 来源

[1] 标题 — URL（发布日期）
[2] ...
[n] ...

至少 5 个来源，优先官方源（亚马逊公告、官方博客、SEC filings、一手数据）。
</output_format>

开始研究，输出完整的 Markdown。不要添加任何开场白或结尾总结——用户要的是可直接落盘的内容。`;
}

// ---------- AUGMENT mode ----------
// Augment an existing knowledge file with delta info.
function augmentPrompt({ task, baseline, augmentPath, augmentContent }) {
  const date = TODAY();

  return `你是一名 know-how 增补助手。用户的知识库里已有一份文件，他想让你在**不改原文**的前提下，基于最新信息给出补充。

${SHARED_RULES}

<augment_task>
${task}
</augment_task>

<original_file path="${augmentPath}">
${augmentContent}
</original_file>

<extra_baseline>
${formatBaseline(baseline)}
</extra_baseline>

<instructions>
你的任务不是重写原文，而是**针对原文产生 delta**：
- 哪些内容已经过时？给出最新版本
- 哪些空白没写？补上
- 有什么新角度/新数据原文没提到？
- 原文的哪些论断现在被推翻/修正了？

禁止：
- 重复原文已有的内容（除非需要修正它）
- 编造原文没有但又"通常这样"的泛泛之谈
- 没有来源的新增内容
</instructions>

<output_format>
严格按以下格式输出（会写入 \`${augmentPath}.augmented.md\`，用户手动 review 后合入原文）：

# Augment Report — ${augmentPath}
生成日期: ${date}
工具: Gemini
Augment 任务: ${task}

## 1. 过时内容（需修正）

针对原文中具体段落/数据：
- **原文引用**: "..."
- **当前实际情况**: ...
- **来源**: [n]

如无，写"无"。

## 2. 空白补齐

原文没有但应该有的内容：

### {新增章节 1}
内容 + [n] 来源

### {新增章节 2}
...

如无，写"无"。

## 3. 新角度 / 反面观点

原文没提到的视角、反面数据、行业辩论等：
- ...

## 4. 直接可合入原文的段落（Ready-to-merge）

如果有可以直接 copy-paste 到原文对应位置的段落，以 Markdown 形式给出，并标注建议插入位置（如 "在 '## 核心机制' 之后"）。

## 5. 来源

[1] 标题 — URL（日期）
[2] ...

## 6. 用户需确认

- 要合入原文吗？哪些部分？
- 哪些需要你亲自验证？
</output_format>

直接输出 Markdown 报告，不要开场白。`;
}

// ---------- dispatcher ----------

export function buildPrompt({ mode, task, baseline, augmentPath, augmentContent, domain, topic }) {
  switch (mode) {
    case "ask":
      return askPrompt({ task, baseline });
    case "research":
      return researchPrompt({ task, baseline, domain, topic });
    case "augment":
      return augmentPrompt({ task, baseline, augmentPath, augmentContent });
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}
