# claude-gemini-bridge

A plugin that brings **Google Gemini** into both [**Claude Code**](https://claude.com/claude-code) and the [**Codex CLI**](https://github.com/openai/codex) — long context + Google Search grounding, with cited sources.

Use it to delegate research, augment your knowledge base, and answer industry questions without leaving your terminal.

**Pairs with** [`openai-codex`](https://github.com/openai/codex):

| | `codex` | `gemini` (this plugin) |
|---|---|---|
| Strength | Depth × code | Breadth × knowledge |
| Use for | Rescue stuck implementations, deep debug, second-pass review | Research, knowledge augmentation, industry insight with citations |
| Output | Code changes | Structured markdown + source links |

Built with **cross-border e-commerce / Amazon** workflows in mind — prompts preserve domain terminology (ACOS, ASIN, ROAS, BSR, AMC, etc.) and enforce source citations.

---

## Install

### Claude Code

```
/plugin marketplace add mrlong0129/claude-gemini-bridge
/plugin install gemini@claude-gemini-bridge
```

### Codex CLI

```bash
codex plugin marketplace add mrlong0129/claude-gemini-bridge
```

Then enable the plugin by adding the following to `~/.codex/config.toml`:

```toml
[plugins."gemini@claude-gemini-bridge"]
enabled = true
```

The first time you run `codex` after enabling, the plugin is cached to `~/.codex/plugins/cache/claude-gemini-bridge/gemini/<version>/` and the `gemini-research` skill becomes available.

### Prerequisite (both)

Make sure the Gemini CLI is installed and authenticated:

```bash
npm install -g @google/gemini-cli
gemini  # first run triggers auth
```

> **Sandbox note**: First-time `gemini` auth opens a browser. If Codex (or any agent runtime) runs this plugin in a network/browser-restricted sandbox, you'll see `Opening authentication page in your browser. Do you want to continue?` and the call will hang. Authenticate `gemini` from a normal terminal **before** invoking the plugin from inside Codex sandbox. For headless/CI usage, set `GEMINI_API_KEY` in the environment instead.

---

## Usage

### From Claude Code

One slash command, three modes:

```
/gemini Amazon SP 广告最近有哪些算法变化
/gemini 研究跨境电商 AI Agent 赛道现状 --domain business
/gemini 把这份文档更新一下 --file docs/amazon.md
```

### From Codex CLI

Just ask in natural language — the `gemini-research` skill auto-activates:

```
codex "research recent Amazon advertising algorithm changes"
codex "augment docs/amazon-policy.md with new info from Gemini"
codex "find industry news on cross-border e-commerce AI agents"
```

Codex picks up the skill and invokes the bridge automatically.

### Three Modes

- **`ask`** — Quick Q&A with sources. Stdout only.
- **`research`** — Deep research → markdown draft at `./gemini-research/{domain}/[AI]_<slug>_<date>.md`. Baseline-aware (sees existing docs in your project and only adds delta info).
- **`augment`** — Reads an existing markdown file, writes a delta-style update at `<file>.augmented.md` (outdated content, gaps, new angles, ready-to-merge paragraphs).

---

## Architecture

```
User
 │
 ├─ Claude Code: /gemini ...
 │       │
 │       ▼
 │  commands/gemini.md → agents/gemini-research-assistant.md
 │       │
 │       │  Bash: node ${CLAUDE_PLUGIN_ROOT}/scripts/gemini-bridge.mjs ...
 │       │
 └─ Codex CLI: natural-language request
         │
         ▼
    skills/gemini-research/SKILL.md
         │
         │  Bash: node $(ls ~/.codex/plugins/cache/*/gemini/*/scripts/gemini-bridge.mjs | tail -1) ...
         │
         ▼
    gemini-bridge.mjs (shared by both plugins)
         │  - parses args (--mode / --baseline / --domain / --file / --plan)
         │  - resolves baseline files from process.cwd() (sandboxed)
         │  - builds mode-specific prompt (lib/gemini-prompts.mjs)
         │  - spawns `gemini -p <prompt> -m <model>`
         │  - writes output to ./gemini-research/ or .augmented.md
         │
         ▼
    Gemini CLI (`@google/gemini-cli`)
```

The bridge:
- Sandboxes all file reads/writes to `process.cwd()` (your project root)
- Uses `spawn` array-mode (no shell) — argv-safe
- Times out (180s default, 420s for research)
- Supports `--plan` dry-run to inspect the resolved prompt before execution

---

## Repo Layout

The Claude Code plugin and Codex plugin share the same `plugins/gemini/` directory — their marker files (`.claude-plugin/` vs `.codex-plugin/`) and command directories (`commands+agents` vs `skills`) don't collide, and they share the `scripts/` directory.

```
claude-gemini-bridge/
├── .claude-plugin/marketplace.json         # Claude Code marketplace
├── .agents/plugins/marketplace.json        # Codex marketplace
├── plugins/gemini/
│   ├── .claude-plugin/plugin.json          # Claude manifest
│   ├── .codex-plugin/plugin.json           # Codex manifest
│   ├── commands/gemini.md                  # Claude /gemini command
│   ├── agents/gemini-research-assistant.md # Claude subagent
│   ├── skills/gemini-research/SKILL.md     # Codex skill
│   └── scripts/                            # Shared by both
│       ├── gemini-bridge.mjs
│       └── lib/gemini-prompts.mjs
└── README.md
```

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GEMINI_BRIDGE_PROJECT_ROOT` | `process.cwd()` | Override project root (where output + baseline globs resolve) |

CLI flags (see `node gemini-bridge.mjs --help`):

| Flag | Default | Purpose |
|---|---|---|
| `--mode` | _required_ | `ask` / `research` / `augment` |
| `--model` | `gemini-3.1-pro-preview` | Gemini model name |
| `--domain` | _(empty)_ | Domain hint (becomes subdirectory under output) |
| `--topic` | _(auto-slugify)_ | Filename slug for research output |
| `--baseline` | _(empty)_ | Glob(s) for files to inject as "already known" context |
| `--file` | _required for augment_ | Target markdown file to augment |
| `--output-dir` | `gemini-research` | Output directory for research mode |
| `--output-file` | _(auto)_ | Explicit output file path |
| `--no-output-file` | `false` | Disable file writing (stdout only) |
| `--timeout` | 180s (ask/augment), 420s (research) | Hard timeout (kills the whole gemini process group, with a 7s fallback resolve if `close` never fires — important in sandboxed runtimes like Codex) |
| `--plan` | `false` | Dry-run: print resolved prompt + command, do not execute |
| `--print-prompt` | `false` | Print prompt to stderr before execution |
| `--show-warnings` | `false` | Pass Gemini CLI stderr through on success (default: collapse to one-line summary) |
| `--frontmatter-preset` | `default` | Frontmatter template for research mode. `default` = minimal `created/source/tool/domain`. `yominos` = `attention.ai` + `attention.yomin` block matching YominOS convention. |

---

## Prompts

Prompt templates live in [`plugins/gemini/scripts/lib/gemini-prompts.mjs`](plugins/gemini/scripts/lib/gemini-prompts.mjs) and are tuned for:

- **Citations**: every non-trivial claim must have a source URL
- **No hallucination**: if unknown, Gemini is told to say "unknown" instead of inventing
- **Terminology preservation**: ACOS, ASIN, MCP, CVR, CPC, ROAS, BSR, SP/SD/SB, AMC stay in English
- **Bilingual**: Chinese task → Chinese reply; English task → English reply
- **Delta-focused** (research/augment): baseline-aware, only adds new info

Fork and edit `gemini-prompts.mjs` to tune for a different domain — the rest of the pipeline is domain-neutral.

---

## Requirements

- Node.js ≥ 18 (uses `node:fs/promises`, `globSync`, `node:child_process`)
- `@google/gemini-cli` installed and authenticated
- Claude Code with plugin support **OR** Codex CLI with plugin support

---

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

Architecture inspired by [`openai-codex`](https://github.com/openai/codex) (`${CLAUDE_PLUGIN_ROOT}` pattern) and [`openai/plugins`](https://github.com/openai/plugins) (Codex marketplace structure). Built for the cross-border e-commerce community.
