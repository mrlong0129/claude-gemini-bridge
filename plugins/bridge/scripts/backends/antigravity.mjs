// Antigravity backend — wraps the local Antigravity language-server binary.
//
// IMPORTANT: As of 2026-05-15, the `agy` CLI is a VS-Code-style IDE launcher
// and has no `-p "prompt"`-style headless mode. The actual agent logic lives
// in the Antigravity language-server binary (named `antigravity`), which is
// invoked with `-cli -agent_mode -print [-enable_lsp -lsp_port <port>]`.
//
// This module discovers the local Antigravity install via the same env-var
// priority that community wrappers (kaycke1337/antigravity-agent) use, then
// spawns the LS in `-print` mode for stdout streaming.
//
// Status: experimental. If your environment doesn't match the discovery rules
// below, set ANTIGRAVITY_LS=/abs/path/to/antigravity explicitly.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NAME = "antigravity";
export const LABEL = "Antigravity";
export const DEFAULT_MODEL = null; // Antigravity picks its own underlying model
export const INSTALL_HINT =
  "Install from https://antigravity.google/cli/install.sh (Unix) or https://antigravity.google/cli/install.ps1 (Windows). If installed at a non-standard path, set ANTIGRAVITY_LS=/abs/path/to/antigravity.";

const HOME = os.homedir();

// Env vars checked in priority order. ANTIGRAVITY_LS is a direct path to the
// LS binary; the others are install-root dirs that we probe for `./antigravity`.
const ENV_PATHS = [
  { key: "ANTIGRAVITY_LS", kind: "binary" },
  { key: "ANTIGRAVITY_HOME", kind: "dir" },
  { key: "ANTIGRAVITY_ROOT", kind: "dir" },
  { key: "ANTIGRAVITY_DIR", kind: "dir" },
];

const COMMON_INSTALL_DIRS = [
  path.join(HOME, "Antigravity"),
  path.join(HOME, ".local/share/Antigravity"),
  "/opt/Antigravity",
  // macOS .app bundle (Antigravity 2.0 desktop install)
  "/Applications/Antigravity.app/Contents/Resources/app",
];

function existsAsFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

// Returns absolute path to antigravity binary, or null if not found via known
// search rules. Returning null falls through to PATH lookup at spawn time.
export function discoverBinary() {
  for (const { key, kind } of ENV_PATHS) {
    const v = process.env[key];
    if (!v) continue;
    if (kind === "binary") {
      if (existsAsFile(v)) return v;
      continue;
    }
    const candidate = path.join(v, "antigravity");
    if (existsAsFile(candidate)) return candidate;
  }
  for (const dir of COMMON_INSTALL_DIRS) {
    const candidate = path.join(dir, "antigravity");
    if (existsAsFile(candidate)) return candidate;
  }
  return null;
}

// BINARY: absolute path if discovered, else "antigravity" (rely on PATH).
// We resolve at import time so --plan shows the correct path.
export const BINARY = discoverBinary() || "antigravity";

export function buildArgs({ prompt /* model and outputFormat are ignored */ }) {
  // -cli         enable CLI mode (no IDE)
  // -agent_mode  run as agent (not language-server-only)
  // -print       stream agent output to stdout and exit
  // --prompt     the task text (this is our best guess; may need to switch to
  //              stdin if -print mode rejects --prompt)
  return ["-cli", "-agent_mode", "-print", "--prompt", prompt];
}

export function renderPlanCommand(argv, prompt) {
  // For --plan, show the resolved BINARY path alongside the args.
  const argsStr = argv
    .map((a) => (a === prompt ? "<PROMPT>" : JSON.stringify(a)))
    .join(" ");
  return `${BINARY} ${argsStr}`;
}
