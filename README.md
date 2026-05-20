# openagent-bridge

A multi-backend plugin that bridges [**Claude Code**](https://claude.com/claude-code) and the [**Codex CLI**](https://github.com/openai/codex) to external agent CLIs — currently **Google Gemini** (stable) and **Google Antigravity** (experimental, v0.6+).

Use it to delegate research, augment your knowledge base, and answer industry questions without leaving your terminal.

**Pairs with** [`openai-codex`](https://github.com/openai/codex):

| | `codex` | `bridge` (this plugin) |
|---|---|---|
| Strength | Depth × code | Breadth × knowledge |
| Use for | Rescue stuck implementations, deep debug, second-pass review | Research, knowledge augmentation, industry insight with citations |
| Output | Code changes | Structured markdown + source links |

Built with **cross-border e-commerce / Amazon** workflows in mind — prompts preserve domain terminology (ACOS, ASIN, ROAS, BSR, AMC, etc.) and enforce source citations.

> **v0.6.0 rename**: This project was previously `claude-gemini-bridge` with a single `gemini` plugin. It has been renamed to `openagent-bridge` and refactored to support multiple backends. Old GitHub URLs auto-redirect. The `GEMINI_BRIDGE_*` env vars still work as deprecated aliases.

---

## Install

### Claude Code

```
/plugin marketplace add mrlong0129/openagent-bridge
/plugin install bridge@openagent-bridge
```

This gives you two slash commands:
- `/gemini` — defaults to `--backend gemini`
- `/antigravity` — defaults to `--backend antigravity` (experimental)

### Codex CLI

```bash
codex plugin marketplace add mrlong0129/openagent-bridge
```

Then enable the plugin by adding the following to `~/.codex/config.toml`:

```toml
[plugins."bridge@openagent-bridge"]
enabled = true
```

The first time you run `codex` after enabling, the plugin is cached to `~/.codex/plugins/cache/openagent-bridge/bridge/<version>/` and the `bridge-research` skill becomes available.

### Prerequisites

For the **Gemini backend** (default):

```bash
npm install -g @google/gemini-cli
gemini  # first run triggers auth
```

For the **Antigravity backend** (experimental):

```bash
# Unix
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows
irm https://antigravity.google/cli/install.ps1 | iex

agy  # open Antigravity once, complete browser auth
```

> **Sandbox note**: First-time auth opens a browser. If Codex (or any agent runtime) runs this plugin in a network/browser-restricted sandbox, you'll see `Opening authentication page in your browser. Do you want to continue?` and the call will hang/timeout. Authenticate from a normal terminal **before** invoking the plugin from inside a sandbox. For headless/CI usage, set `GEMINI_API_KEY` in the environment (Gemini only; Antigravity does not yet support headless API key auth).

---

## Usage

### From Claude Code

```
/gemini Amazon SP 广告最近有哪些算法变化
/gemini 研究跨境电商 AI Agent 赛道现状 --domain business
/gemini 把这份文档更新一下 --file docs/amazon.md

/antigravity audit this codebase architecture
/antigravity ask --backend gemini "..."   # override default backend
```

### From Codex CLI

Just ask in natural language — the `bridge-research` skill auto-activates:

```
codex "research recent Amazon advertising algorithm changes"
codex "use antigravity to audit this codebase"
codex "augment docs/amazon-policy.md with new info"
```

### Three Modes

- **`ask`** — Quick Q&A with sources. Stdout only.
- **`research`** — Deep research → markdown draft at `./gemini-research/{domain}/[AI]_<slug>_<date>.md`. Baseline-aware (sees existing docs in your project and only adds delta info).
- **`augment`** — Reads an existing markdown file, writes a delta-style update at `<file>.augmented.md` (outdated content, gaps, new angles, ready-to-merge paragraphs).

---

## Architecture

```
User
 │
 ├─ Claude Code: /gemini | /antigravity ...
 │       │
 │       ▼  routes to subagent
 │  bridge-research-assistant
 │       │
 │       │  Bash: node ${CLAUDE_PLUGIN_ROOT}/scripts/bridge.mjs --backend <name> ...
 │       │
 └─ Codex CLI: natural-language request
         │
         ▼  skill auto-activates
    skills/bridge-research/SKILL.md
         │
         │  Bash: node $(ls ~/.codex/plugins/cache/*/bridge/*/scripts/bridge.mjs | tail -1) --backend <name> ...
         │
         ▼
    bridge.mjs (multi-backend dispatcher)
         │  - parses args, applies env defaults (OPENAGENT_BRIDGE_*)
         │  - loads backend adapter from scripts/backends/<name>.mjs
         │  - sandbox + process-group kill + 7s fallback resolve
         │  - mode-specific prompt (lib/prompts.mjs)
         │  - spawns backend.BINARY with backend.buildArgs(...)
         │  - writes output to ./gemini-research/ or .augmented.md
         │
         ├──▶ backends/gemini.mjs    →  gemini -p ... -m ... --output-format
         └──▶ backends/antigravity.mjs →  antigravity -cli -agent_mode -print ...
```

Both Claude Code and Codex plugins share the same `plugins/bridge/` directory and the same `scripts/bridge.mjs` — zero script duplication.

---

## Configuration

CLI flags always win. Use env vars to pin project-wide defaults (e.g. in a YominOS repo's `.envrc`, in `direnv`, or your shell rc).

| Env var | Default | Purpose |
|---|---|---|
| `OPENAGENT_BRIDGE_BACKEND` | `gemini` | Default `--backend` (`gemini` \| `antigravity`) |
| `OPENAGENT_BRIDGE_PROJECT_ROOT` | `process.cwd()` | Project root (where output files + baseline globs resolve) |
| `OPENAGENT_BRIDGE_OUTPUT_DIR` | `gemini-research` | Default `--output-dir` for research mode (e.g. `know-how` for YominOS workflow) |
| `OPENAGENT_BRIDGE_FRONTMATTER_PRESET` | `default` | Default `--frontmatter-preset` (`default` \| `yominos`) |
| `ANTIGRAVITY_LS` | _(none)_ | Absolute path to antigravity binary (highest priority for Antigravity discovery) |
| `ANTIGRAVITY_HOME` / `_ROOT` / `_DIR` | _(none)_ | Antigravity install directory (we probe for `./antigravity` inside) |

Deprecated v0.5 aliases still honored (with a one-time stderr deprecation hint): `GEMINI_BRIDGE_PROJECT_ROOT`, `GEMINI_BRIDGE_OUTPUT_DIR`, `GEMINI_BRIDGE_FRONTMATTER_PRESET`.

CLI flags (see `node bridge.mjs --help`):

| Flag | Default | Purpose |
|---|---|---|
| `--mode` | _required_ | `ask` / `research` / `augment` |
| `--backend` | `gemini` | `gemini` \| `antigravity` |
| `--model` | per-backend | Gemini default: `gemini-3.1-pro-preview`; Antigravity: ignored |
| `--domain` | _(empty)_ | Domain hint (becomes subdirectory under output) |
| `--topic` | _(auto-slugify)_ | Filename slug for research output |
| `--baseline` | _(empty)_ | Glob(s) for files to inject as "already known" context |
| `--file` | _required for augment_ | Target markdown file to augment |
| `--output-dir` | `gemini-research` | Output directory for research mode |
| `--output-file` | _(auto)_ | Explicit output file path |
| `--no-output-file` | `false` | Disable file writing (stdout only) |
| `--timeout` | 180s (ask/augment), 420s (research) | Hard timeout (kills the whole backend process group; 7s fallback resolve if `close` never fires) |
| `--plan` | `false` | Dry-run: print resolved prompt + command, do not execute |
| `--print-prompt` | `false` | Print prompt to stderr before execution |
| `--show-warnings` | `false` | Pass backend stderr through on success (default: collapse to one-line summary) |
| `--frontmatter-preset` | `default` | `default` \| `yominos` (YominOS knowledge-base format) |

---

## Backend status

| Backend | Status | Caveat |
|---|---|---|
| `gemini` | Stable since v0.1 | Needs `@google/gemini-cli` installed + authenticated |
| `antigravity` | **Experimental** (v0.6+) | `agy` is an IDE launcher, not a headless CLI. This backend spawns the underlying `antigravity` language-server binary with `-cli -agent_mode -print`. May fail in surprising ways. Report issues with full stderr. |

---

## Prompts

Prompt templates live in [`plugins/bridge/scripts/lib/prompts.mjs`](plugins/bridge/scripts/lib/prompts.mjs) and are tuned for:

- **Citations**: every non-trivial claim must have a source URL
- **No hallucination**: if unknown, the model is told to say "unknown" instead of inventing
- **Terminology preservation**: ACOS, ASIN, MCP, CVR, CPC, ROAS, BSR, SP/SD/SB, AMC stay in English
- **Bilingual**: Chinese task → Chinese reply; English task → English reply
- **Delta-focused** (research/augment): baseline-aware, only adds new info

Fork and edit `prompts.mjs` to tune for a different domain — the rest of the pipeline is domain-neutral.

---

## Migration from v0.5 (`claude-gemini-bridge` / plugin name `gemini`)

If you were on v0.5.x:

1. Old `mrlong0129/claude-gemini-bridge` GitHub repo auto-redirects to `mrlong0129/openagent-bridge`.
2. Old plugin name `gemini` is now `bridge`. Re-install:
   ```
   /plugin marketplace remove claude-gemini-bridge
   /plugin marketplace add mrlong0129/openagent-bridge
   /plugin install bridge@openagent-bridge
   ```
3. Slash command `/gemini` still works (now routes to `bridge.mjs --backend gemini`). Same UX.
4. Old `GEMINI_BRIDGE_*` env vars still work and print a one-time deprecation hint. Rename to `OPENAGENT_BRIDGE_*` at your leisure.

---

## Requirements

- Node.js ≥ 18 (uses `node:fs/promises`, `globSync`, `node:child_process`)
- `@google/gemini-cli` installed and authenticated (for `gemini` backend)
- `antigravity` installed and authenticated (for `antigravity` backend, optional)
- Claude Code with plugin support **OR** Codex CLI with plugin support

---

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

Architecture inspired by [`openai-codex`](https://github.com/openai/codex) (`${CLAUDE_PLUGIN_ROOT}` pattern) and [`openai/plugins`](https://github.com/openai/plugins) (Codex marketplace structure). Antigravity backend discovery pattern adapted from [`kaycke1337/antigravity-agent`](https://github.com/kaycke1337/antigravity-agent). Built for the cross-border e-commerce community.
