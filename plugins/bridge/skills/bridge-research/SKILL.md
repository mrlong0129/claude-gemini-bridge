---
name: bridge-research
description: "Delegate research, knowledge-base augmentation, and industry insight queries to an external agent CLI (Gemini by default, Antigravity experimental). Use when the user asks a research-type question (especially cross-border e-commerce / Amazon), wants to augment an existing markdown doc with new info, or needs answers with cited sources from Google Search grounding. Pairs with Codex's native code abilities."
---

# Bridge Research

Use this skill whenever the user wants to do research, augment knowledge-base docs, or answer industry/policy/competitor questions with cited sources, via an external agent CLI.

This skill is for **breadth × knowledge** — pair it with Codex's native depth × code capabilities (Codex handles code rescue/review/debug; this skill handles research/citations).

---

## Backends

| Backend | When to use | Status |
|---|---|---|
| `gemini` (default) | Citations, Google Search grounding, long context | Stable |
| `antigravity` | Codebase audit, Antigravity-native tasks | Experimental (v0.6+) |

Pass `--backend antigravity` to use Antigravity instead of Gemini. Omit for default.

---

## Prerequisites

Assume the user has the relevant backend CLI installed and authenticated locally:
- **gemini**: `npm install -g @google/gemini-cli` + `gemini` to auth
- **antigravity**: `curl -fsSL https://antigravity.google/cli/install.sh | bash` + `agy` once to auth

**Do not run preflight checks** like `gemini --version` — it wastes a shell turn. If the backend is missing, the bridge will exit 127 with `<Backend> CLI not found` and a clear install hint; surface that to the user only if it happens.

**Sandbox caveat**: Codex sandbox blocks browser auth flows. If you see `Opening authentication page in your browser. Do you want to continue?` in stderr (typically followed by `timeout after Ns` and exit 124), tell the user to authenticate the backend CLI from a normal terminal once (or set `GEMINI_API_KEY` for gemini). Do not retry inside the sandbox.

---

## Three Modes

| Signal | Mode |
|---|---|
| "What is X?", "查一下", "look up X" + single question | `ask` |
| "Research X", "整理 X 赛道", "deep dive on X", "补齐 X 的 know-how" | `research` |
| User points to a specific existing markdown file to update | `augment` |

If the user explicitly writes `--mode <xxx>` in the request, use it directly.

When uncertain, default to `ask` (lightweight). Upgrade to `research` if the user says "go deeper" or "完整研究".

---

## Required Workflow

### Step 1: Locate the bridge script

The bridge lives at `scripts/bridge.mjs` within this plugin's install directory. Codex installs plugins under `~/.codex/plugins/cache/`.

```bash
OPENAGENT_BRIDGE="$(ls -d ~/.codex/plugins/cache/*/bridge/*/scripts/bridge.mjs 2>/dev/null | sort -V | tail -1)"
```

If `$OPENAGENT_BRIDGE` is empty, the plugin may not be installed correctly. Tell the user to reinstall via `codex plugin marketplace add mrlong0129/openagent-bridge`.

### Step 2: Load baseline (research mode only, optional for ask)

For `research` mode, find existing related docs in the user's current project (`know-how/`, `docs/`, `notes/` are common locations) to give the backend context — it sees what's already known and only adds delta info.

```bash
find . -type f -name "*.md" -path "*<keyword>*" 2>/dev/null | head -5
```

Pass paths as `--baseline "path1,path2,..."`.

### Step 3: Invoke the bridge

```bash
node "$OPENAGENT_BRIDGE" [--backend gemini|antigravity] --mode <mode> [options] -- "<task>"
```

**Argument rules**:
- `--backend <name>` optional; default `gemini`. Use `antigravity` only when the user asks for it explicitly or the task is clearly codebase-audit-shaped.
- `--mode` required (`ask` / `research` / `augment`)
- `--domain <name>` recommended for `research` (e.g. `amazon`, `ai`, `business`, `product`, `market`)
- `--topic <slug>` optional for `research`
- `--baseline "glob1,glob2"` recommended for `research`, optional for `ask`
- `--file <path>` required for `augment`
- `--output-dir <path>` optional, defaults to `./gemini-research/`
- `--model <name>` only if user explicitly specifies (default for gemini: `gemini-3.1-pro-preview`; ignored for antigravity)
- `--plan` for dry-run when the user asks to preview the prompt
- Task text goes after `--` quoted

**Default output**:
- `ask` → stdout only
- `research` → `./gemini-research/{domain}/[AI]_<slug>_<date>.md`
- `augment` → `<file>.augmented.md`

### Step 4: Return result

Return the bridge's stdout **verbatim** to the user. Do not re-summarize, re-translate, or layer your own commentary on top.

If the bridge wrote a file, append one short line at the end:
- `research`: `→ Written to <path>. Review before merging.`
- `augment`: `→ Written to <path>. Diff-style; review and merge manually.`

### Step 5: Error handling

Ordered by real-world frequency (assumes user has the backend installed locally):

| Bridge output | Exit code | Your action |
|---|---|---|
| `timeout after <N>s` | 124 | Suggest `--timeout <larger>` or narrow the task. Do not retry. |
| `Opening authentication page...` then timeout | 124 | Sandbox blocked browser auth. Tell user to run the backend CLI once from a normal terminal, or set `GEMINI_API_KEY`. Do not retry. |
| `escapes project root` | 2 | The user's path is outside the project sandbox. Surface the error. |
| `failed to write ...` | 1 | Filesystem write failed (permission/disk). Surface stderr to user. |
| Non-zero exit, other | passthrough | Return stderr as-is. Do not guess root cause. |
| `<Backend> CLI not found` | 127 | **Rare** (assumes user has it installed). Surface the install hint from stderr. |

---

## Constraints

- **One call per task**. Do not chain or retry the bridge unless the user asks.
- **Do not re-interpret the backend's output**. The output is the deliverable.
- **Do not fabricate citations**. If output is light on sources, tell the user — don't fill in fake URLs.
- **Do not modify the backend's output**. Formatting/wording/structure stays as-is. Only append the one-line "→ Written to ..." note.
- **Stay in your lane**. If the user asks something code-heavy (debugging, refactoring, implementation), tell them Codex's native abilities handle that better.

---

## Example: Full Execution (Gemini backend)

User: "研究下跨境电商 AI Agent 赛道现状"

Your internal reasoning:
1. Mode = `research`
2. Domain = `business`
3. Baseline search: `find . -name "*.md" -path "*ai*agent*"` → 3 files
4. Topic slug = `cross-border-ai-agents`
5. Backend = default (gemini)

```bash
OPENAGENT_BRIDGE="$(ls -d ~/.codex/plugins/cache/*/bridge/*/scripts/bridge.mjs 2>/dev/null | sort -V | tail -1)"

node "$OPENAGENT_BRIDGE" \
  --mode research \
  --domain business \
  --topic cross-border-ai-agents \
  --baseline "know-how/**/*ai*agent*.md,docs/**/*agent*.md" \
  -- "研究跨境电商 AI Agent 赛道现状：主要玩家、商业模式、融资情况、产品形态、近 6 个月变化"
```

Bridge output (example):

```
---
created: 2026-05-15
source: gemini
...
---
# 跨境电商 AI Agent 赛道研究
...
---
[openagent-bridge] wrote: gemini-research/business/[AI]_cross-border-ai-agents_2026-05-15.md
```

Your reply: bridge output verbatim, then:

```
→ Written to gemini-research/business/[AI]_cross-border-ai-agents_2026-05-15.md. Review before merging.
```

## Example: Antigravity Backend

User: "use antigravity to audit this codebase"

```bash
OPENAGENT_BRIDGE="$(ls -d ~/.codex/plugins/cache/*/bridge/*/scripts/bridge.mjs 2>/dev/null | sort -V | tail -1)"

node "$OPENAGENT_BRIDGE" --backend antigravity --mode ask \
  -- "audit this codebase: identify architectural risks, missing tests, and code smell hotspots"
```

Done.
