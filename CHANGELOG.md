# Changelog

## v0.6.1 — 2026-05-28

**Fix: Antigravity backend now works on agy v1.0.1+ (Google Antigravity standalone CLI).**

Google shipped `agy` v1.0.1 on 2026-05-23 as a self-contained standalone agentic CLI (Mach-O / Go binary, ~140 MB), replacing the original "IDE launcher + separate language-server binary" architecture that v0.6.0 was built against. The old `-cli -agent_mode -print --prompt` invocation now fails with `flags provided but not defined: -cli -agent_mode`.

- **Fix `backends/antigravity.mjs` `buildArgs`**: now spawns `agy -p <prompt>` (agy v1.0.1+ headless print mode). Empirically verified on macOS arm64.
- **Add `agy` to binary discovery**: `BINARY_NAMES = ["agy", "antigravity"]` searched in priority order. Existing `ANTIGRAVITY_LS` direct-path override still wins.
- **Add `~/.local/bin` to default install dirs**: covers the official `curl -fsSL https://antigravity.google/cli/install.sh | bash` install location.
- **Default fallback**: when no env/path discovery hits, `BINARY = "agy"` (was `"antigravity"`).

Verified end-to-end on agy v1.0.1 / macOS arm64:
- `ask` mode returns answers with real source URLs (advertising.amazon.com, anthropic.com, modelcontextprotocol.io, etc.) ✓
- `research` mode writes YominOS-flavored frontmatter and full report with citations ✓
- `augment` mode generates `.augmented.md` with delta analysis + ready-to-merge paragraphs ✓
- `--plan` dry-run shows resolved binary path correctly ✓

### ⚠️ Security note: `agy --sandbox` does NOT sandbox

During testing, `agy --sandbox -p "cat ~/.ssh/id_rsa"` successfully read the real SSH private key (Base64 prefix matches the on-disk file exactly), then hallucinated that the data was "mock". The flag has no enforcement.

Recommendation:
- Do not rely on `--sandbox` for security boundaries
- Scope agy's filesystem reach with `--add-dir` and OS-level permissions instead
- If true sandboxing is needed, wrap agy in `sandbox-exec` (macOS) or a container

This is an upstream agy issue, not a bridge issue. Reporting it to Google is recommended.

## v0.6.0 — 2026-05-15

**BREAKING (cosmetic): project rename + multi-backend refactor.**

Google launched Antigravity 2.0 with its own `agy` CLI today. This release renames the project to reflect that it's no longer Gemini-only, and adds Antigravity as a second backend.

- **Rename**: `claude-gemini-bridge` → `openagent-bridge`. GitHub auto-redirects the old URL.
- **Plugin rename**: `gemini` → `bridge`. New install: `/plugin install bridge@openagent-bridge`. Old install path keeps working until you reinstall.
- **Multi-backend architecture**:
  - New `--backend <gemini|antigravity>` flag (default `gemini`)
  - New env var `OPENAGENT_BRIDGE_BACKEND` for project-wide defaults
  - Backend adapters live in `plugins/bridge/scripts/backends/<name>.mjs`
- **New Antigravity backend (experimental)**:
  - Discovers local Antigravity install via `ANTIGRAVITY_LS` / `ANTIGRAVITY_HOME` / `_ROOT` / `_DIR` env vars, then common install paths (`~/Antigravity`, `/opt/Antigravity`, `/Applications/Antigravity.app/Contents/Resources/app`, etc.)
  - Spawns the `antigravity` language-server binary with `-cli -agent_mode -print` flags (per kaycke1337/antigravity-agent reverse-engineering)
  - Note: `agy` itself is an IDE launcher without headless prompt API, hence the LS spawn pattern. Status is **experimental** in v0.6 — please report issues.
- **New slash command `/antigravity`** mirrors `/gemini` with the Antigravity backend default.
- **Env var rename** (with backward-compatible aliases): `GEMINI_BRIDGE_*` → `OPENAGENT_BRIDGE_*`. Old names still work and print a one-time deprecation hint.
- **Log prefix rename**: `[gemini-bridge]` → `[openagent-bridge]` in all bridge stderr/stdout output.
- **Internal refactor**: `runGemini` → `runBackend(backend, ...)`. ENOENT error now uses `backend.LABEL` + `backend.INSTALL_HINT`. All existing safety mechanisms (process-group kill, 7s fallback resolve, stderr collapse, frontmatter sanitizer, timeout exit 124) preserved.

No behavior changes for happy-path Gemini users. Install path changes are the only thing existing v0.5 users need to do.

Verified:
- `--help` shows multi-backend usage ✓
- `--plan` gemini backend: command renders as `gemini "-p" <PROMPT> ...` ✓
- `--plan` antigravity backend: command renders as `antigravity "-cli" "-agent_mode" "-print" ...` ✓
- Antigravity ENOENT (not installed) → exit 127 with full install hint ✓
- Sanitizer 5/5 unit cases still pass against refactored bridge ✓
- All existing CLI flags / env vars work unchanged ✓

## v0.5.0 — 2026-05-14

Optimizations now that Codex sandbox v0.4.0 review confirmed all P0/P1 fixes are stable. Premise: users have Gemini CLI installed + authenticated locally.

- **Drop preflight `gemini --version`** in the Codex `SKILL.md`. The check was wasteful (one shell turn per task) — the bridge's `ENOENT → exit 127` is the safety net. Saves a shell round-trip per Codex call.
- **Env-var overrides** for project-wide defaults:
  - `GEMINI_BRIDGE_OUTPUT_DIR` — overrides research `--output-dir`. YominOS users can set `know-how` once and `/gemini research --domain ai ...` lands at `know-how/ai/[AI]_*.md`.
  - `GEMINI_BRIDGE_FRONTMATTER_PRESET` — overrides `--frontmatter-preset`. Set to `yominos` once and every research call uses YominOS frontmatter.
  - CLI flags still win.
- **Reorder error tables** in both `agents/gemini-research-assistant.md` (Claude) and `skills/gemini-research/SKILL.md` (Codex) by real-world frequency. Timeout / sandbox auth at the top; `Gemini CLI not found` demoted to the bottom with a "rare" marker (because users have it installed).
- README env-var table now documents all three (`PROJECT_ROOT`, `OUTPUT_DIR`, `FRONTMATTER_PRESET`).

No behavior change for users without env vars set. Bridge contract unchanged.

## v0.4.0 — 2026-05-14

Second round of Codex sandbox fixes (see `outputs/codexgemini/第二次反馈.md`).

- **Fix (P0)**: Exit code on timeout is now `124` (GNU `timeout` convention), not `0`. Previously, when Gemini was killed by SIGTERM and its `close` event reported `code=null`, callers could mis-interpret the result as success. Bridge now explicitly returns `124` and discards any partial output (no file written).
- **Fix (P0)**: On timeout, partial stdout is no longer written to disk — it's emitted to stdout with a `(partial output above; treated as failure)` marker. Reasoning: a half-finished research markdown landing in `gemini-research/` was worse than nothing.
- **Fix (P0)**: Explicit non-zero exit on any Gemini failure (`code !== 0`), instead of returning whatever `child.exit` reported. File write failures also return `1`.
- **Fix (P1, yominos preset)**: Bridge now post-validates the generated frontmatter. If `attention.ai` is not a 0-5 integer (e.g. the model left the placeholder `<0-5 你基于本研究...>` untouched), bridge replaces it with `2` and prints a warning. Deterministic regardless of how well the model follows the prompt.
- **Docs**: README + Codex `SKILL.md` now flag that Gemini CLI auth opens a browser, which Codex sandbox blocks. Solution: authenticate `gemini` from a normal terminal first, or set `GEMINI_API_KEY`.

Exit code reference:
- `0` success
- `1` file write failure or generic non-zero from Gemini
- `2` argument / sandbox / internal error
- `124` timeout (matches GNU `timeout`)
- `127` Gemini CLI not installed

No breaking changes for happy-path callers.

## v0.3.0 — 2026-05-14

Robustness fixes from a Codex sandbox e2e review.

- **Fix (P0)**: Process-group kill on timeout. `spawn` now uses `detached: true` on POSIX so we can `process.kill(-pid, ...)` the whole group, including the `gemini` grandchild. Previous behavior leaked `gemini` subprocesses after `child.kill()`.
- **Fix (P0)**: Hard-fallback resolve after kill. In Codex sandboxes, stdout pipes can stay open even after the child is signaled, leaving the bridge's Promise hung forever. We now force-resolve 7s after the kill if `close` never fires, and report `[gemini-bridge] forced exit (child did not close after kill)`.
- **Fix (P1)**: Default stderr silencing on success. Gemini CLI prints non-fatal warnings (e.g. `Skill conflict detected: ...`) to stderr, which polluted Codex's successful output. Now: on `code === 0 && !timedOut`, stderr is collapsed to a single `[gemini-bridge] gemini emitted N stderr line(s)...` summary. On failure/timeout, full stderr is preserved. Use `--show-warnings` to always see full stderr.
- **New**: `--frontmatter-preset <default|yominos>` flag for research mode. `yominos` preset emits frontmatter with `attention.ai` + `attention.yomin` fields, matching the YominOS knowledge base convention. Prompt also asks Gemini to self-rate `attention.ai` (0-5). Default behavior unchanged.

No breaking changes. Both new flags are opt-in.

## v0.2.0 — 2026-05-14

Add Codex CLI support.

- New: `.agents/plugins/marketplace.json` — Codex marketplace metadata
- New: `plugins/gemini/.codex-plugin/plugin.json` — Codex plugin manifest
- New: `plugins/gemini/skills/gemini-research/SKILL.md` — Codex skill instructing the agent how to invoke the bridge
- Claude Code and Codex now **share** the same `plugins/gemini/` directory and the same `scripts/gemini-bridge.mjs` (no script duplication)
- README updated with dual install + usage instructions

## v0.1.0 — 2026-05-14

Initial release (Claude Code only).

- `/gemini` command with three modes (`ask` / `research` / `augment`)
- `gemini-research-assistant` subagent
- `gemini-bridge.mjs` runtime with cwd sandbox, baseline file injection, mode-specific prompts
- Default model: `gemini-3.1-pro-preview`
- Default research output: `./gemini-research/{domain}/[AI]_<slug>_<date>.md`
- Default augment output: `<file>.augmented.md`
- `--plan` dry-run support
- Prompts tuned for cross-border e-commerce / Amazon research (citations, no hallucination, terminology preservation)

Pairs with `@openai/codex` — codex handles depth × code, this plugin handles breadth × knowledge.
