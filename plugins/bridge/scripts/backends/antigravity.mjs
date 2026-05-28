// Antigravity backend — wraps the local `agy` Antigravity CLI.
//
// [YominOS patch 2026-05-28] As of agy v1.0.1 (May 23, 2026), agy is a
// self-contained standalone agentic CLI with proper headless `-p / --print`
// mode. The old assumption (agy is an IDE launcher needing -cli -agent_mode)
// no longer holds — those flags are rejected by agy v1.0.1 with
// "flags provided but not defined: -cli -agent_mode".
//
// This module discovers the local agy install via env-var priority + common
// install dirs + extra YominOS path (~/.local/bin/agy), then spawns it with
// the modern `-p <prompt>` CLI surface.
//
// Status: experimental but functionally validated on agy v1.0.1 / macOS arm64.

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
  path.join(HOME, ".local/bin"), // YominOS / curl-based install (agy binary directly here)
  path.join(HOME, "Antigravity"),
  path.join(HOME, ".local/share/Antigravity"),
  "/opt/Antigravity",
  // macOS .app bundle (Antigravity 2.0 desktop install)
  "/Applications/Antigravity.app/Contents/Resources/app",
];

// Possible binary names — modern installs use "agy", legacy LSP-style use "antigravity"
const BINARY_NAMES = ["agy", "antigravity"];

function existsAsFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

// Returns absolute path to antigravity/agy binary, or null if not found via
// known search rules. Returning null falls through to PATH lookup at spawn time.
export function discoverBinary() {
  for (const { key, kind } of ENV_PATHS) {
    const v = process.env[key];
    if (!v) continue;
    if (kind === "binary") {
      if (existsAsFile(v)) return v;
      continue;
    }
    for (const name of BINARY_NAMES) {
      const candidate = path.join(v, name);
      if (existsAsFile(candidate)) return candidate;
    }
  }
  for (const dir of COMMON_INSTALL_DIRS) {
    for (const name of BINARY_NAMES) {
      const candidate = path.join(dir, name);
      if (existsAsFile(candidate)) return candidate;
    }
  }
  return null;
}

// BINARY: absolute path if discovered, else "agy" (rely on PATH).
// We resolve at import time so --plan shows the correct path.
export const BINARY = discoverBinary() || "agy";

export function buildArgs({ prompt /* model and outputFormat are ignored */ }) {
  // agy v1.0.1+ headless interface:
  //   -p / --print / --prompt   Run a single prompt non-interactively, print to stdout
  //   --print-timeout <dur>     Print mode timeout (default 5m)
  //
  // We pass the prompt as -p's value. Empirically tested 2026-05-28 on agy v1.0.1.
  return ["-p", prompt];
}

export function renderPlanCommand(argv, prompt) {
  // For --plan, show the resolved BINARY path alongside the args.
  const argsStr = argv
    .map((a) => (a === prompt ? "<PROMPT>" : JSON.stringify(a)))
    .join(" ");
  return `${BINARY} ${argsStr}`;
}
