---
name: gemini-research
description: "Delegate research, knowledge-base augmentation, and industry insight queries to Google Gemini. Use when the user asks a research-type question (especially cross-border e-commerce / Amazon), wants to augment an existing markdown doc with new info, or needs answers with cited sources from Google Search grounding."
---

# Gemini Research

Use this skill whenever the user wants Gemini to do research, augment knowledge-base docs, or answer industry/policy/competitor questions with cited sources.

This skill is for **breadth × knowledge** — pair it with Codex's native depth × code capabilities (Codex handles code rescue/review/debug; Gemini handles research/citations).

---

## Prerequisites

Assume the user has Gemini CLI installed and authenticated locally (`npm install -g @google/gemini-cli` + `gemini` to auth). **Do not run `gemini --version` as a preflight check** — it wastes a shell turn. If Gemini is actually missing, the bridge will exit 127 with a clear `Gemini CLI not found` message; surface that to the user only if it happens.

**Sandbox caveat**: Codex sandbox blocks Gemini CLI's browser auth flow. If you see `Opening authentication page in your browser. Do you want to continue?` in stderr (typically followed by a `timeout after Ns` and exit 124), the user needs to either authenticate `gemini` from a normal terminal once, or set `GEMINI_API_KEY` in the environment. Surface this and stop — do not retry.

---

## Three Modes

| Signal | Mode |
|---|---|
| "What is X?", "查一下", "Gemini look at..." + single question | `ask` |
| "Research X", "整理 X 赛道", "deep dive on X", "补齐 X 的 know-how" | `research` |
| User points to a specific existing markdown file to update | `augment` |

If the user explicitly writes `--mode <xxx>` in the request, use it directly.

When uncertain, default to `ask` (lightweight). Upgrade to `research` if the user says "go deeper" or "做完整研究".

---

## Required Workflow

### Step 1: Locate the bridge script

The bridge script lives at `scripts/gemini-bridge.mjs` within this plugin's install directory. Codex installs plugins under `~/.codex/plugins/cache/`.

Find the script (one-liner, safe across versions):

```bash
GEMINI_BRIDGE="$(ls -d ~/.codex/plugins/cache/*/gemini/*/scripts/gemini-bridge.mjs 2>/dev/null | sort -V | tail -1)"
```

If `$GEMINI_BRIDGE` is empty, the plugin may not be installed correctly. Tell the user to reinstall via `codex plugin marketplace add mrlong0129/claude-gemini-bridge`.

### Step 2: Load baseline (research mode only, optional for ask)

For `research` mode, find existing related docs in the user's current project (`know-how/`, `docs/`, `notes/` are common locations) to give Gemini context — Gemini sees what's already known and only adds delta info.

```bash
# Example: find related markdown files in the project
find . -type f -name "*.md" -path "*<keyword>*" 2>/dev/null | head -5
```

Then pass the paths as `--baseline "path1,path2,..."`.

### Step 3: Invoke the bridge

```bash
node "$GEMINI_BRIDGE" --mode <mode> [options] -- "<task>"
```

**Argument rules**:
- `--mode` required (`ask` / `research` / `augment`)
- `--domain <name>` recommended for `research` (e.g. `amazon`, `ai`, `business`, `product`, `market`)
- `--topic <slug>` optional for `research` (auto-derived from task if absent)
- `--baseline "glob1,glob2"` recommended for `research`, optional for `ask`
- `--file <path>` required for `augment`
- `--output-dir <path>` optional, defaults to `./gemini-research/`
- `--model <name>` only if user explicitly specifies (default: `gemini-3.1-pro-preview`)
- `--plan` for dry-run when the user asks to preview the prompt
- Task text goes after `--` quoted

**Default output**:
- `ask` → stdout only
- `research` → `./gemini-research/{domain}/[AI]_<slug>_<date>.md`
- `augment` → `<file>.augmented.md`

### Step 4: Return result

Return Gemini's output **verbatim** to the user. Do not re-summarize, re-translate, or layer your own commentary on top. The bridge already formats the output (markdown with citations).

If the bridge wrote a file, append one short line at the end:
- `research`: `→ Written to <path>. Review before merging.`
- `augment`: `→ Written to <path>. Diff-style; review and merge manually.`

### Step 5: Error handling

Ordered by real-world frequency (assumes user has Gemini CLI installed locally):

| Bridge output | Exit code | Your action |
|---|---|---|
| `timeout after <N>s` | 124 | Suggest `--timeout <larger>` or narrow the task. Do not retry. |
| `Opening authentication page...` then timeout | 124 | Sandbox blocked browser auth. Tell user to run `gemini` once from a normal terminal, or set `GEMINI_API_KEY`. Do not retry. |
| `escapes project root` | 2 | The user's path is outside the project sandbox. Surface the error. |
| `failed to write ...` | 1 | Filesystem write failed (permission/disk). Surface stderr to user. |
| Non-zero exit, other | passthrough | Return stderr as-is. Do not guess root cause. |
| `Gemini CLI not found` | 127 | **Rare** (assumes user has it installed). Tell user to `npm install -g @google/gemini-cli && gemini`. |

---

## Constraints

- **One call per task**. Do not chain or retry the bridge unless the user asks.
- **Do not re-interpret Gemini's output**. The output is the deliverable.
- **Do not fabricate citations**. If Gemini's output is light on sources, tell the user — don't fill in fake URLs.
- **Do not modify Gemini's output**. Formatting/wording/structure stays as-is. Only append the one-line "→ Written to ..." note.
- **Stay in your lane**. If the user asks something code-heavy (debugging, refactoring, implementation), tell them codex's native abilities handle that better.

---

## Example: Full Execution

User: "研究下跨境电商 AI Agent 赛道现状"

Your internal reasoning:
1. Mode = `research` ("研究" + "赛道")
2. Domain = `business`
3. Baseline search: `find . -name "*.md" -path "*ai*agent*" -o -path "*跨境*"`
4. Found 3 related files → pass as `--baseline`
5. Topic slug = `cross-border-ai-agents`

Bash invocation:

```bash
GEMINI_BRIDGE="$(ls -d ~/.codex/plugins/cache/*/gemini/*/scripts/gemini-bridge.mjs 2>/dev/null | sort -V | tail -1)"

node "$GEMINI_BRIDGE" \
  --mode research \
  --domain business \
  --topic cross-border-ai-agents \
  --baseline "know-how/**/*ai*agent*.md,docs/**/*agent*.md" \
  -- "研究跨境电商 AI Agent 赛道现状：主要玩家、商业模式、融资情况、产品形态、近 6 个月变化"
```

Bridge output (example):

```
---
created: 2026-05-14
source: gemini
...
---
# 跨境电商 AI Agent 赛道研究
...
---
[gemini-bridge] wrote: gemini-research/business/[AI]_cross-border-ai-agents_2026-05-14.md
```

Your reply: return the bridge output verbatim, then:

```
→ Written to gemini-research/business/[AI]_cross-border-ai-agents_2026-05-14.md. Review before merging.
```

Done.
