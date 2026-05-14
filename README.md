# gemini-research

A Claude Code plugin that delegates **research / know-how augmentation / industry insight queries** to Google Gemini — long context + Google Search grounding, with cited sources.

Built for **cross-border e-commerce / Amazon operators**, but works for any domain where you want a research-grade Gemini call from inside Claude Code.

**Pairs with** [`openai-codex`](https://github.com/openai/codex):
- `codex` = depth × code (rescue, deep debug, second implementation)
- `gemini-research` = breadth × knowledge (research, know-how augmentation, citations)

---

## Install

```bash
# In Claude Code:
/plugin marketplace add mrlong0129/gemini-research
/plugin install gemini-research@gemini-research
```

Then make sure the Gemini CLI is installed and authenticated:

```bash
npm install -g @google/gemini-cli
gemini  # follow the auth flow on first run
```

---

## Usage

Three modes, one slash command:

### `/gemini ask` — quick Q&A with sources

```
/gemini Amazon SP 广告最近有哪些算法变化
```

Returns a direct answer with `[1] [2] ...` source links. Stdout only.

### `/gemini research` — deep research → markdown draft

```
/gemini 研究下跨境电商 AI Agent 赛道的现状 --domain business
```

The agent will:
1. Detect the mode (`research`)
2. Scan your project for related existing knowledge (`know-how/`, `docs/`, etc.) as **baseline**
3. Call Gemini with: task + baseline + structured output format
4. Write the result to `./gemini-research/{domain}/[AI]_<slug>_<date>.md`

The output is **delta-focused** — Gemini sees what you already know and only adds new info.

### `/gemini augment` — update an existing doc with delta

```
/gemini 把 docs/amazon-policy.md 用最新信息补一下 --file docs/amazon-policy.md
```

Reads the original, asks Gemini for:
- What's outdated (with corrections + sources)
- What's missing
- New angles / counterpoints
- Ready-to-merge paragraphs

Output lands at `docs/amazon-policy.md.augmented.md` — review and merge manually.

---

## Architecture

```
User
 │
 │  /gemini ...
 ▼
Claude Code command (commands/gemini.md)
 │
 │  routes to subagent
 ▼
gemini-research-assistant subagent (agents/...)
 │
 │  Bash: node ${CLAUDE_PLUGIN_ROOT}/scripts/gemini-bridge.mjs ...
 ▼
gemini-bridge.mjs
 │  - parses args (--mode / --baseline / --domain / --file / --plan / ...)
 │  - resolves baseline files from process.cwd() (sandboxed)
 │  - builds mode-specific prompt (lib/gemini-prompts.mjs)
 │  - spawns `gemini -p <prompt> -m <model>`
 │  - writes output to ./gemini-research/ or .augmented.md
 │
 ▼
Gemini CLI (`@google/gemini-cli`) — long context + Search grounding
```

The bridge:
- Sandboxes all file reads/writes to `process.cwd()` (your project root)
- Uses `spawn` array-mode (no shell) — argv safe
- Times out (180s default, 420s for research)
- Supports `--plan` dry-run to inspect the resolved prompt before execution

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
| `--timeout` | 180s (ask/augment), 420s (research) | Hard timeout |
| `--plan` | `false` | Dry-run: print resolved prompt + command, do not execute |
| `--print-prompt` | `false` | Print prompt to stderr before execution |

---

## Prompts

The prompt templates live in [`plugins/gemini-research/scripts/lib/gemini-prompts.mjs`](plugins/gemini-research/scripts/lib/gemini-prompts.mjs) and are tuned for:

- **Citations**: every non-trivial claim must have a source URL
- **No hallucination**: if unknown, Gemini is told to say "unknown" instead of inventing
- **Terminology preservation**: ACOS, ASIN, MCP, CVR, CPC, ROAS, BSR, SP/SD/SB, AMC stay in English
- **Bilingual**: Chinese task → Chinese reply; English task → English reply
- **Delta-focused** (research/augment): baseline-aware, only adds new info

If you want to tune for a different domain (e.g. legal research, fintech), fork and edit `gemini-prompts.mjs` — the rest of the pipeline is domain-neutral.

---

## Requirements

- Node.js ≥ 18 (uses `node:fs/promises`, `globSync`, `node:child_process`)
- `@google/gemini-cli` installed and authenticated
- Claude Code with plugin support

---

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

- Architecture inspired by [`openai-codex`](https://github.com/openai/codex) plugin (same `${CLAUDE_PLUGIN_ROOT}` pattern, command/agent/bridge layering).
- Built for the cross-border e-commerce community.
