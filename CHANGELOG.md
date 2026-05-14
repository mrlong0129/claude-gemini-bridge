# Changelog

## v0.1.0 — 2026-05-14

Initial release.

- `/gemini` command with three modes (`ask` / `research` / `augment`)
- `gemini-research-assistant` subagent
- `gemini-bridge.mjs` runtime with cwd sandbox, baseline file injection, mode-specific prompts
- Default model: `gemini-3.1-pro-preview`
- Default research output: `./gemini-research/{domain}/[AI]_<slug>_<date>.md`
- Default augment output: `<file>.augmented.md`
- `--plan` dry-run support
- Prompts tuned for cross-border e-commerce / Amazon research (citations, no hallucination, terminology preservation)

Pairs with `@openai/codex` — codex handles depth × code, this plugin handles breadth × knowledge.
