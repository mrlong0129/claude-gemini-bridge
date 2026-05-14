# Changelog

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
