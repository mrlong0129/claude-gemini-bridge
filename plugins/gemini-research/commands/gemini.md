---
description: Delegate research / know-how augmentation / industry insight queries to Gemini (long context + Google Search grounding)
argument-hint: "[ask|research|augment] [--domain <name>] [--file <path>] [--baseline <glob,...>] [--model <name>] [--output-dir <path>] [--plan] <task>"
allowed-tools: Bash(node:*), Read, Glob, Grep
---

# /gemini — Research Assistant

Route the user's request to the `gemini-research-assistant` subagent, which calls
the Gemini CLI via `${CLAUDE_PLUGIN_ROOT}/scripts/gemini-bridge.mjs`.

## 定位（与 codex 互补）

| | `codex` (深度 × 代码) | `gemini` (广度 × 知识) |
|---|---|---|
| 强项 | 卡住救援、二次实现、深度 debug | 研究、know-how 补齐、insight 搜索 |
| 输出 | 代码变更 | 结构化 markdown + 来源链接 |

## 使用

### Raw 用户请求
$ARGUMENTS

### 执行规则

**步骤**：
1. 将上述 raw 请求路由到 `gemini-research-assistant` subagent
2. subagent 会：判断 mode → 加载 baseline → 调 bridge → 后处理
3. subagent 的完整输出**原封不动**返回给用户，不要加任何前后 commentary

**Mode 识别**（subagent 执行时会做，此处仅供参考）：

| 用户意图 | mode | 典型触发语 |
|---------|------|-----------|
| 快速问答 | `ask` | "查一下"、"gemini 帮我看看"、"what is X" |
| 深度研究 | `research` | "研究 X 赛道"、"补齐 X 的 know-how"、"deep dive on X" |
| 补齐已有文件 | `augment` | "把这份文档更新一下"、"给这份文件加点新信息" |

如果 raw 请求里包含 `--mode <xxx>`，优先采用，不做自动识别。

### Flag 透传

以下 flag 传给 subagent（subagent 再传给 bridge）：
- `--model <name>` — 默认 `gemini-3.1-pro-preview`
- `--domain <name>` — research 模式的领域提示（`amazon` / `ai` / `business` / `product` / `market`）
- `--topic <slug>` — research 模式的文件名 slug
- `--file <path>` — augment 模式的目标文件
- `--baseline <glob,...>` — 额外注入的上下文文件（ask/research 用）
- `--output-dir <path>` — research 模式输出目录（默认 `./gemini-research/`）
- `--plan` — dry-run，只打印 prompt + 命令不执行（审计用）

### 输出位置

- `ask` → stdout only
- `research` → `./gemini-research/{domain}/[AI]_{slug}_{date}.md`
- `augment` → `{file}.augmented.md`

所有路径相对**用户项目根目录**（即调用 Claude Code 时的 cwd）。
