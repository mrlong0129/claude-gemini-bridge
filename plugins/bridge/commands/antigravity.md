---
description: Delegate research / codebase audit / industry insight queries to Google Antigravity (experimental, requires local antigravity install)
argument-hint: "[ask|research|augment] [--domain <name>] [--file <path>] [--baseline <glob,...>] [--output-dir <path>] [--plan] <task>"
allowed-tools: Bash(node:*), Read, Glob, Grep
---

# /antigravity — Research Assistant (Antigravity backend, experimental)

Route the user's request to the `bridge-research-assistant` subagent, which calls
`${CLAUDE_PLUGIN_ROOT}/scripts/bridge.mjs` with `--backend antigravity`.

**Status**: experimental as of v0.6.0. Antigravity's native `agy` CLI is an IDE
launcher, not a headless prompt API. This backend spawns the underlying
`antigravity` language-server binary in `-print` mode. May fail in surprising
ways if the LS doesn't support the exact spawn args we use. If you hit issues,
use `/gemini` instead and report the failure.

## Prerequisites

- Antigravity installed locally (`curl -fsSL https://antigravity.google/cli/install.sh | bash`)
- `antigravity` binary discoverable via PATH, or set `ANTIGRAVITY_LS=/abs/path/to/antigravity`
- Antigravity authenticated (run `agy` once interactively to complete browser auth)

## 使用

### Raw 用户请求
$ARGUMENTS

### 执行规则

1. Route to `bridge-research-assistant` subagent, **default `--backend antigravity`**
2. Subagent identifies mode, loads baseline if relevant, invokes the bridge
3. Return Antigravity's output verbatim

### Flag 透传

Same flags as `/gemini`, but `--model` is ignored (Antigravity picks its own
underlying model). Output paths default identically (`./gemini-research/` —
yes, the directory name is historical; override with `--output-dir`).
