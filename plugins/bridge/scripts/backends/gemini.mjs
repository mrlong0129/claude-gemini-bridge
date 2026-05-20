// Gemini backend — wraps `@google/gemini-cli`.
//
// Contract for openagent-bridge backend modules:
//   - NAME: short id used in --backend flag
//   - LABEL: human-readable display name
//   - BINARY: executable name (resolved via PATH unless absolute)
//   - DEFAULT_MODEL: model name to pass via -m (null if not applicable)
//   - INSTALL_HINT: shown when binary is missing
//   - buildArgs({ prompt, model, outputFormat }): returns argv for spawn

export const NAME = "gemini";
export const LABEL = "Gemini";
export const BINARY = "gemini";
export const DEFAULT_MODEL = "gemini-3.1-pro-preview";
export const INSTALL_HINT =
  "Install: npm install -g @google/gemini-cli (or: brew install gemini-cli), then run `gemini` once to authenticate.";

export function buildArgs({ prompt, model, outputFormat }) {
  return ["-p", prompt, "-m", model, "--output-format", outputFormat];
}

// Optional: backend-specific argv-renderer for --plan dry-runs (so we don't dump
// the full prompt twice). Returning null means use the default rendering.
export function renderPlanCommand(argv, prompt) {
  return null; // use generic rendering
}
