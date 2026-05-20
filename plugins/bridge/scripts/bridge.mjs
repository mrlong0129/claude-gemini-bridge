#!/usr/bin/env node
// openagent-bridge — Multi-backend bridge for Claude Code + Codex CLI.
//
// Wraps an external agent CLI (gemini, antigravity, ...) with:
//   - mode-aware prompt templates (ask / research / augment)
//   - baseline file injection (read from user's project cwd)
//   - cwd sandbox (must stay under user's project root)
//   - timeout with process-group kill + 7s fallback resolve
//   - dry-run (--plan), print-prompt
//   - spawn in array mode (no shell), no env leakage
//   - pluggable backends (see ./backends/*.mjs)

import { spawn } from "node:child_process";
import { globSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildPrompt, MODES } from "./lib/prompts.mjs";
import * as geminiBackend from "./backends/gemini.mjs";
import * as antigravityBackend from "./backends/antigravity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Backend registry ----------

const BACKENDS = {
  [geminiBackend.NAME]: geminiBackend,
  [antigravityBackend.NAME]: antigravityBackend,
};
const BACKEND_NAMES = Object.keys(BACKENDS);
const DEFAULT_BACKEND = "gemini";

// ---------- Env vars (new + deprecated aliases) ----------

// Read a new-style env var, falling back to a deprecated v0.5 alias.
// Prints a one-time deprecation hint to stderr if the old name is used.
const _seenDeprecations = new Set();
function readEnv(newKey, oldKey) {
  const newVal = process.env[newKey];
  if (newVal !== undefined && newVal !== "") return newVal;
  if (oldKey && process.env[oldKey] !== undefined && process.env[oldKey] !== "") {
    if (!_seenDeprecations.has(oldKey)) {
      _seenDeprecations.add(oldKey);
      process.stderr.write(
        `[openagent-bridge] note: ${oldKey} is deprecated; please rename to ${newKey} (still honored for now)\n`
      );
    }
    return process.env[oldKey];
  }
  return undefined;
}

const ENV_PROJECT_ROOT = readEnv("OPENAGENT_BRIDGE_PROJECT_ROOT", "GEMINI_BRIDGE_PROJECT_ROOT");
const ENV_OUTPUT_DIR = readEnv("OPENAGENT_BRIDGE_OUTPUT_DIR", "GEMINI_BRIDGE_OUTPUT_DIR");
const ENV_FRONTMATTER_PRESET = readEnv("OPENAGENT_BRIDGE_FRONTMATTER_PRESET", "GEMINI_BRIDGE_FRONTMATTER_PRESET");
const ENV_BACKEND = readEnv("OPENAGENT_BRIDGE_BACKEND", null);

// User project root = cwd where the user invoked Claude Code / Codex CLI.
// Baseline globs, --file paths, and output files are all resolved against this.
const PROJECT_ROOT = ENV_PROJECT_ROOT
  ? path.resolve(ENV_PROJECT_ROOT)
  : process.cwd();

const DEFAULTS = {
  // Resolved per-backend at parseArgs time (gemini-3.1-pro-preview for gemini, null for antigravity).
  // The value here is just a fallback when --backend gemini is used without --model.
  timeoutSec: 180,
  researchTimeoutSec: 420,
  maxFiles: 40,
  maxFileBytes: 64_000,
  outputFormat: "text",
  // Default research output directory (relative to PROJECT_ROOT).
  // Override priority: --output-dir flag > OPENAGENT_BRIDGE_OUTPUT_DIR env > this default.
  researchOutputDir: ENV_OUTPUT_DIR || "gemini-research",
  // Frontmatter preset. Override priority: flag > env > "default".
  frontmatterPreset: (ENV_FRONTMATTER_PRESET === "yominos" || ENV_FRONTMATTER_PRESET === "default")
    ? ENV_FRONTMATTER_PRESET
    : "default",
  // Backend selection. Override priority: --backend flag > OPENAGENT_BRIDGE_BACKEND env > DEFAULT_BACKEND.
  backend: BACKEND_NAMES.includes(ENV_BACKEND) ? ENV_BACKEND : DEFAULT_BACKEND,
};

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svgz",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".mp3", ".mp4", ".mov", ".webm",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".so", ".dylib", ".dll", ".exe", ".wasm", ".class", ".jar", ".db", ".lockb",
]);

const IGNORED_SEGMENTS = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage",
  "archive", ".claude/plugins", "out",
]);

const USAGE = `openagent-bridge — Multi-backend bridge to agent CLIs

Usage:
  node bridge.mjs --mode <ask|research|augment> [--backend <name>] [options] <task>

Modes:
  ask        Direct Q&A, stdout only
  research   Deep research on a topic, emits a structured markdown draft
  augment    Augment an existing markdown file with delta info

Backends (--backend, default ${DEFAULTS.backend}):
  gemini       Google Gemini CLI (stable)
  antigravity  Google Antigravity language-server (experimental, v0.6)

Common options:
  --task <text>              Task text (alternative to trailing args)
  --model <name>             Backend model (default: gemini → gemini-3.1-pro-preview; antigravity → backend default)
  --timeout <sec>            Timeout in seconds
  --plan                     Print the resolved prompt + command, do not execute
  --print-prompt             Print the full prompt to stderr before executing
  --output-format <fmt>      text | json | stream-json  (default: text)

Context (ask / research):
  --baseline <glob,...>      Files/globs to inject as "already known" baseline
  --max-files <n>            Max baseline files to inline (default: ${DEFAULTS.maxFiles})
  --max-file-bytes <n>       Max bytes per file (default: ${DEFAULTS.maxFileBytes})

Augment-specific:
  --file <path>              Target markdown file to augment (required)

Research-specific:
  --domain <name>            Domain hint (amazon / ai / business / ...)
  --topic <slug>             Topic slug for filename (auto-derived if absent)
  --output-dir <path>        Directory for research output (default: ${DEFAULTS.researchOutputDir}/)
  --frontmatter-preset <p>   Frontmatter template: default | yominos  (default: default)

Output:
  --output-file <path>       Explicit output file (overrides --output-dir)
  --no-output-file           Disable file writing (stdout only)

Diagnostics:
  --show-warnings            Print backend stderr even on success (default: silent on success)

Environment (project-wide defaults, CLI flags override):
  OPENAGENT_BRIDGE_BACKEND           Default --backend ("gemini" | "antigravity")
  OPENAGENT_BRIDGE_PROJECT_ROOT      Override project root (default: process.cwd())
  OPENAGENT_BRIDGE_OUTPUT_DIR        Override research --output-dir (e.g. "know-how" for YominOS)
  OPENAGENT_BRIDGE_FRONTMATTER_PRESET Override --frontmatter-preset ("default" | "yominos")

  (Deprecated v0.5 aliases still honored: GEMINI_BRIDGE_PROJECT_ROOT,
   GEMINI_BRIDGE_OUTPUT_DIR, GEMINI_BRIDGE_FRONTMATTER_PRESET)

Antigravity backend extras (--backend antigravity):
  ANTIGRAVITY_LS                    Absolute path to antigravity LS binary (highest priority)
  ANTIGRAVITY_HOME / _ROOT / _DIR   Install dir containing the antigravity binary

Examples:
  node bridge.mjs --mode ask "Amazon 2026 Q1 新政策"
  node bridge.mjs --mode research --domain business "跨境电商 AI Agent 赛道"
  node bridge.mjs --mode augment --file docs/amazon.md "补齐最近变化"
  node bridge.mjs --backend antigravity --mode ask "audit this repo"
  node bridge.mjs --mode ask --plan "test prompt"
`;

// ---------- arg parsing ----------

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return v;
}

function splitList(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parsePositiveInt(v, flag) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer (got: ${v})`);
  }
  return n;
}

export function parseArgs(argv) {
  const out = {
    mode: undefined,
    task: "",
    backend: DEFAULTS.backend,
    model: undefined, // resolved after argv parse via backend.DEFAULT_MODEL
    timeoutSec: undefined,
    plan: false,
    printPrompt: false,
    outputFormat: DEFAULTS.outputFormat,
    baseline: [],
    maxFiles: DEFAULTS.maxFiles,
    maxFileBytes: DEFAULTS.maxFileBytes,
    file: undefined,
    domain: undefined,
    topic: undefined,
    outputDir: DEFAULTS.researchOutputDir,
    outputFile: undefined,
    noOutputFile: false,
    showWarnings: false,
    frontmatterPreset: DEFAULTS.frontmatterPreset,
    help: false,
  };

  const taskTokens = [];
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--") {
      taskTokens.push(...argv.slice(i + 1));
      break;
    }
    switch (t) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--mode": {
        const v = takeValue(argv, i, t);
        if (!MODES.includes(v)) {
          throw new Error(`Invalid --mode "${v}". Expected one of: ${MODES.join(", ")}`);
        }
        out.mode = v;
        i += 1;
        break;
      }
      case "--backend": {
        const v = takeValue(argv, i, t);
        if (!BACKEND_NAMES.includes(v)) {
          throw new Error(`Invalid --backend "${v}". Expected one of: ${BACKEND_NAMES.join(", ")}`);
        }
        out.backend = v;
        i += 1;
        break;
      }
      case "--task":
        out.task = takeValue(argv, i, t);
        i += 1;
        break;
      case "--model":
        out.model = takeValue(argv, i, t);
        i += 1;
        break;
      case "--timeout":
        out.timeoutSec = parsePositiveInt(takeValue(argv, i, t), t);
        i += 1;
        break;
      case "--plan":
        out.plan = true;
        break;
      case "--print-prompt":
        out.printPrompt = true;
        break;
      case "--output-format": {
        const v = takeValue(argv, i, t);
        if (!["text", "json", "stream-json"].includes(v)) {
          throw new Error(`Invalid --output-format "${v}"`);
        }
        out.outputFormat = v;
        i += 1;
        break;
      }
      case "--baseline":
        out.baseline.push(...splitList(takeValue(argv, i, t)));
        i += 1;
        break;
      case "--max-files":
        out.maxFiles = parsePositiveInt(takeValue(argv, i, t), t);
        i += 1;
        break;
      case "--max-file-bytes":
        out.maxFileBytes = parsePositiveInt(takeValue(argv, i, t), t);
        i += 1;
        break;
      case "--file":
        out.file = takeValue(argv, i, t);
        i += 1;
        break;
      case "--domain":
        out.domain = takeValue(argv, i, t);
        i += 1;
        break;
      case "--topic":
        out.topic = takeValue(argv, i, t);
        i += 1;
        break;
      case "--output-dir":
        out.outputDir = takeValue(argv, i, t);
        i += 1;
        break;
      case "--output-file":
        out.outputFile = takeValue(argv, i, t);
        i += 1;
        break;
      case "--no-output-file":
        out.noOutputFile = true;
        break;
      case "--show-warnings":
        out.showWarnings = true;
        break;
      case "--frontmatter-preset": {
        const v = takeValue(argv, i, t);
        const allowed = ["default", "yominos"];
        if (!allowed.includes(v)) {
          throw new Error(`Invalid --frontmatter-preset "${v}". Expected one of: ${allowed.join(", ")}`);
        }
        out.frontmatterPreset = v;
        i += 1;
        break;
      }
      default:
        taskTokens.push(t);
    }
  }

  if (!out.task) out.task = taskTokens.join(" ").trim();

  if (out.help) return out;

  if (!out.mode) {
    throw new Error("Missing --mode. See --help.");
  }
  if (out.mode === "augment" && !out.file) {
    throw new Error("Mode 'augment' requires --file <path>.");
  }
  if (!out.task && out.mode !== "augment") {
    throw new Error("Missing task text.");
  }
  if (out.mode === "augment" && !out.task) {
    out.task = "Augment this file with new information from recent research.";
  }

  if (out.timeoutSec === undefined) {
    out.timeoutSec = out.mode === "research" ? DEFAULTS.researchTimeoutSec : DEFAULTS.timeoutSec;
  }

  // Resolve model from backend default unless explicitly set via --model.
  if (out.model === undefined) {
    out.model = BACKENDS[out.backend].DEFAULT_MODEL;
  }

  return out;
}

// ---------- cwd sandbox ----------

function assertInsideProject(absPath, label = "path") {
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error(`${label} escapes project root: ${resolved}\n  (project root: ${PROJECT_ROOT})`);
  }
  return resolved;
}

// ---------- file collection ----------

function isIgnored(relPath) {
  return relPath.split("/").some((seg) => IGNORED_SEGMENTS.has(seg));
}

function isBinary(absPath, buf) {
  if (BINARY_EXT.has(path.extname(absPath).toLowerCase())) return true;
  return buf.includes(0);
}

async function collectFiles({ patterns, maxFiles, maxFileBytes }) {
  const matched = new Set();
  for (const pattern of patterns) {
    // Resolve glob relative to PROJECT_ROOT
    const hits = globSync(pattern, {
      cwd: PROJECT_ROOT,
      absolute: true,
      nodir: true,
    });
    for (const h of hits) {
      assertInsideProject(h, "baseline match");
      matched.add(h);
    }
  }

  const included = [];
  const skipped = [];
  const sorted = [...matched].sort();

  for (const abs of sorted) {
    const rel = path.relative(PROJECT_ROOT, abs);
    if (isIgnored(rel)) {
      skipped.push({ path: rel, reason: "ignored-path" });
      continue;
    }
    if (included.length >= maxFiles) {
      skipped.push({ path: rel, reason: "max-files-exceeded" });
      continue;
    }
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: "not-file" });
        continue;
      }
      const buf = await fs.readFile(abs);
      if (isBinary(abs, buf)) {
        skipped.push({ path: rel, reason: "binary" });
        continue;
      }
      const truncated = buf.length > maxFileBytes;
      const content = (truncated ? buf.subarray(0, maxFileBytes) : buf).toString("utf8");
      included.push({ path: rel, bytes: buf.length, truncated, content });
    } catch (err) {
      skipped.push({ path: rel, reason: `read-error: ${err.message}` });
    }
  }

  return { included, skipped };
}

// ---------- backend invocation ----------

function runBackend(backend, { args, timeoutSec }) {
  return new Promise((resolve) => {
    // detached: true on POSIX so we get a new process group → can kill children too
    const usePosixGroup = process.platform !== "win32";
    const child = spawn(backend.BINARY, args, {
      cwd: PROJECT_ROOT,
      shell: false,
      detached: usePosixGroup,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out = [];
    const err = [];
    let timedOut = false;
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const killTree = (sig) => {
      try {
        if (usePosixGroup && child.pid) {
          // negative pid → kill the whole process group
          process.kill(-child.pid, sig);
        } else if (child.pid) {
          child.kill(sig);
        }
      } catch (_) {
        /* already dead */
      }
    };

    const to = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5000).unref();
      // Hard fallback: if 'close' never fires (sandbox-stuck pipes), force resolve.
      setTimeout(() => {
        settle({
          code: -1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr:
            Buffer.concat(err).toString("utf8") +
            `\n[openagent-bridge] forced exit (child did not close after kill)\n`,
          error: null,
          timedOut: true,
        });
      }, 7000).unref();
    }, timeoutSec * 1000);

    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));

    child.on("error", (e) => {
      clearTimeout(to);
      settle({ code: -1, stdout: "", stderr: e.message, error: e, timedOut: false });
    });

    child.on("close", (code) => {
      clearTimeout(to);
      settle({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        error: null,
        timedOut,
      });
    });
  });
}

// ---------- file writing ----------

async function writeOutputFile({ absPath, content }) {
  assertInsideProject(absPath, "output file");
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf8");
}

// ---------- main ----------

async function mainInner(argv) {
  const parsed = parseArgs(argv);

  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Collect baseline files (ask/research) or target file (augment)
  let baselineCtx = { included: [], skipped: [] };
  let augmentContent = "";

  if (parsed.baseline.length > 0) {
    baselineCtx = await collectFiles({
      patterns: parsed.baseline,
      maxFiles: parsed.maxFiles,
      maxFileBytes: parsed.maxFileBytes,
    });
  }

  if (parsed.mode === "augment") {
    const abs = assertInsideProject(path.resolve(PROJECT_ROOT, parsed.file), "augment file");
    try {
      augmentContent = await fs.readFile(abs, "utf8");
    } catch (err) {
      process.stderr.write(`Cannot read --file: ${err.message}\n`);
      return 2;
    }
  }

  const backend = BACKENDS[parsed.backend];

  const prompt = buildPrompt({
    mode: parsed.mode,
    task: parsed.task,
    baseline: baselineCtx,
    augmentPath: parsed.file,
    augmentContent,
    domain: parsed.domain,
    topic: parsed.topic,
    preset: parsed.frontmatterPreset,
    backend: backend.NAME,
  });

  const backendArgs = backend.buildArgs({
    prompt,
    model: parsed.model,
    outputFormat: parsed.outputFormat,
  });

  if (parsed.printPrompt) {
    process.stderr.write(`---PROMPT---\n${prompt}\n---END PROMPT---\n`);
  }

  if (parsed.plan) {
    const rendered = backend.renderPlanCommand?.(backendArgs, prompt)
      || [backend.BINARY, ...backendArgs.map((a) => (a === prompt ? "<PROMPT>" : JSON.stringify(a)))].join(" ");
    process.stdout.write(`# DRY RUN (--plan)\n`);
    process.stdout.write(`backend: ${backend.NAME} (${backend.LABEL})\n`);
    process.stdout.write(`mode: ${parsed.mode}\n`);
    process.stdout.write(`model: ${parsed.model ?? "(backend default)"}\n`);
    process.stdout.write(`project root: ${PROJECT_ROOT}\n`);
    process.stdout.write(`timeout: ${parsed.timeoutSec}s\n`);
    process.stdout.write(`baseline files: ${baselineCtx.included.length} included, ${baselineCtx.skipped.length} skipped\n`);
    process.stdout.write(`prompt bytes: ${Buffer.byteLength(prompt, "utf8")}\n`);
    process.stdout.write(`command: ${rendered}\n`);
    process.stdout.write(`---PROMPT---\n${prompt}\n`);
    return 0;
  }

  const result = await runBackend(backend, { args: backendArgs, timeoutSec: parsed.timeoutSec });

  // ENOENT (backend CLI missing) — diagnose and bail.
  if (result.error && result.error.code === "ENOENT") {
    process.stderr.write(
      `${backend.LABEL} CLI not found (looked for "${backend.BINARY}"). ${backend.INSTALL_HINT}\n`
    );
    return 127;
  }

  // Helper: emit stderr respecting --show-warnings policy.
  const emitStderr = ({ failed }) => {
    const trimmed = (result.stderr || "").replace(/\s+$/, "");
    if (!trimmed) return;
    const lineCount = trimmed.split("\n").length;
    if (failed || parsed.showWarnings) {
      process.stderr.write(trimmed + "\n");
    } else {
      process.stderr.write(
        `[openagent-bridge:${parsed.backend}] ${lineCount} stderr line(s) emitted; rerun with --show-warnings to view\n`
      );
    }
  };

  // Timeout — exit early with 124 (GNU timeout convention).
  // Do NOT write the partial output to file: it's almost certainly incomplete or corrupt.
  if (result.timedOut) {
    process.stderr.write(`\n[openagent-bridge] timeout after ${parsed.timeoutSec}s — output discarded (no file written)\n`);
    emitStderr({ failed: true });
    if (result.stdout) {
      process.stdout.write(result.stdout);
      process.stdout.write("\n[openagent-bridge] (partial output above; treated as failure)\n");
    }
    return 124;
  }

  emitStderr({ failed: result.code !== 0 });

  // Non-zero gemini exit — surface error, no file write.
  if (result.code !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    return result.code || 1;
  }

  // Success path — sanitize body, then optionally write to file.
  const body = sanitizeBody(result.stdout, parsed);

  // Default output-file behavior:
  //   research → <outputDir>/[AI]_<topic>_<date>.md
  //   augment  → <file>.augmented.md
  //   ask      → stdout only
  let outFile = parsed.outputFile;
  if (!outFile && !parsed.noOutputFile) {
    if (parsed.mode === "research") {
      const date = new Date().toISOString().slice(0, 10);
      const slug = slugify(parsed.topic || parsed.task).slice(0, 60);
      const domainSub = parsed.domain ? `${parsed.domain}/` : "";
      outFile = path.join(PROJECT_ROOT, parsed.outputDir, domainSub, `[AI]_${slug}_${date}.md`);
    } else if (parsed.mode === "augment" && parsed.file) {
      outFile = path.resolve(PROJECT_ROOT, `${parsed.file}.augmented.md`);
    }
  }

  if (outFile && body) {
    const abs = path.isAbsolute(outFile) ? outFile : path.resolve(PROJECT_ROOT, outFile);
    try {
      await writeOutputFile({ absPath: abs, content: body });
      process.stdout.write(body);
      process.stdout.write(`\n\n---\n[openagent-bridge] wrote: ${path.relative(PROJECT_ROOT, abs)}\n`);
    } catch (err) {
      process.stderr.write(`\n[openagent-bridge] failed to write ${outFile}: ${err.message}\n`);
      process.stdout.write(body);
      return 1;
    }
  } else {
    process.stdout.write(body);
  }

  return 0;
}

// Body sanitizers — deterministic fixups so we don't rely solely on the model
// following the prompt format. Currently:
//   - yominos preset: replace `attention.ai: <placeholder>` with a valid 0-5 int
export function sanitizeBody(body, parsed) {
  if (!body) return body;
  if (parsed.frontmatterPreset !== "yominos") return body;

  // Match the `attention:\n  ai: <value>` block at the top of the file.
  // The frontmatter block is bounded by `---` lines; we only touch the first one.
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return body;
  const fmBlock = fmMatch[1];

  const aiMatch = fmBlock.match(/(^|\n)(\s*ai:\s*)([^\n]*)/);
  if (!aiMatch) return body;
  const aiValue = aiMatch[3].trim();
  if (/^[0-5]$/.test(aiValue)) return body; // valid

  process.stderr.write(
    `[openagent-bridge] attention.ai was "${aiValue}" — not a valid 0-5 integer; falling back to 2\n`
  );
  const fixedFmBlock = fmBlock.replace(/(^|\n)(\s*ai:\s*)([^\n]*)/, "$1$22");
  return body.replace(fmBlock, fixedFmBlock);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    return await mainInner(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`openagent-bridge error: ${msg}\n`);
    return 2;
  }
}

function slugify(s) {
  return (s || "untitled")
    .toLowerCase()
    .replace(/[^\w一-龥-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exit(code);
}
