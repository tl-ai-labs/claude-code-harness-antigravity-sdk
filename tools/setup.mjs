#!/usr/bin/env node
/**
 * setup.mjs — interactive onboarding for the Claude Code Harness Antigravity
 * SDK Connector.
 *
 * Three modes, one shared check library:
 *
 *   --offline   Node, pnpm, offline tests, dry-run of the plumbing.
 *               No credentials needed.
 *   --sdlc      offline + Claude Code CLI + Anthropic auth + Python venv +
 *               google-antigravity + Vertex ADC + Google Cloud project +
 *               region + Docker. Enough to run a delegated SDLC workload.
 *   --swe-pro   sdlc + Scale AI evaluator clone at pinned SHA + grading
 *               venv + free-disk check.
 *
 * Without a mode flag, the wizard asks. Each mode maps 1:1 to a section in
 * docs/setup.md, so a deliberate reader can follow the docs by hand instead
 * of running the wizard. Every check has a `fix` message that spells out
 * the exact command to run.
 *
 * Idempotent — re-running is safe.
 *
 * FOUR RULES THAT SHAPE THE FLOW (each exists because the opposite wasted a
 * reader's time on a fresh machine):
 *
 *  1. CRITICAL CHECKS STOP THE RUN. A check marked critical is one that makes
 *     every later check meaningless — no Node 22, no pnpm, no Python. Those
 *     exit immediately with their own fix line. Everything else still runs to
 *     completion first, so a merely-incomplete machine gets the whole list of
 *     what it is missing in one pass rather than one item per re-run.
 *
 *  2. THE SETUP MODES SET THINGS UP. `--sdlc` and `--swe-pro` create the
 *     worker venv, clone the pinned evaluator and build the grading venv
 *     without asking. A wizard whose every useful action sat behind a y/N was
 *     a checklist wearing a wizard's clothes. The guard is the TTY, not a
 *     prompt: with no TTY (piped, CI, `| tee`) this is a pure diagnostic and
 *     touches nothing on the machine.
 *
 *  3. AUTH IS REPORTED, NOT ENFORCED — with one exception. Missing Anthropic
 *     credentials are an informational line here, because `run-harness.mjs`
 *     preflights them for real at $0 and exits 2 with a named cause
 *     (runtimes.mjs `preflight()`), and because a user without credentials
 *     must still be able to run this wizard to find out what ELSE they need.
 *     GOOGLE_CLOUD_PROJECT is the exception and stays blocking: nothing
 *     downstream can catch it, since an unset project is a configuration
 *     error the worker cannot distinguish from a deliberate one.
 *
 *  4. THE WIZARD BUILDS INSIDE THE REPO AND NEVER CHANGES THE MACHINE. This is
 *     the line that decides which missing thing gets installed and which gets a
 *     `fix:` line, and it is not an accident of what was easy to script.
 *
 *     Installed, because each lives under this repository, is removable with a
 *     single `rm -rf`, needs no privilege, and affects nothing else the reader
 *     owns: `node_modules/` · the Gemini worker venv · the pinned Scale
 *     evaluator clone · the SWE-bench Pro grading venv. See INSTALL_TARGETS,
 *     which setup.test.mjs pins as being inside ROOT.
 *
 *     Reported with a fix line, never installed, because each is machine-global
 *     and shared with every other thing the reader does: Node · pnpm · the
 *     Claude Code CLI · Python · Docker · gcloud ADC · the environment
 *     variables. Three reasons, and any one of them is sufficient:
 *
 *       (a) Node cannot be fixed from here even in principle. This file is a
 *           Node program running on the very interpreter it would replace;
 *           installing 22 mid-run leaves the current process on the old one,
 *           with a re-exec into a binary that may not be on this shell's PATH
 *           yet. That fails intermittently on somebody else's machine, which
 *           is the exact class of bug this repository exists to not have.
 *       (b) It is not our machine. A reader's laptop may pin Node for other
 *           work, sit under corporate MDM, or manage runtimes with nvm, fnm,
 *           asdf, volta, Homebrew or a .pkg. Choosing one is choosing wrong
 *           for most people, and a repo you cloned four minutes ago silently
 *           upgrading a system runtime is a hostile act regardless.
 *       (c) Some are decisions, not installs. `gcloud auth application-default
 *           login` opens a browser and picks an identity; GOOGLE_CLOUD_PROJECT
 *           is a billing account only the reader knows. A wizard cannot answer
 *           either one on their behalf.
 *
 *     pnpm is the near-miss worth naming: `npm install -g pnpm` is one line and
 *     npm ships with Node. It stays a hint anyway — it is still a global write
 *     to a machine we do not own, and `npm i -g` vs `corepack enable` vs
 *     Homebrew is (b) in miniature.
 *
 *     The previous published deliverable
 *     (github.com/tl-ai-labs/ai-sdlc-orchestrator-claude-code-harness) draws
 *     the same line — it builds its bundled MCP server and writes its plugin
 *     files, and for Node it prints `nvm install --lts` and exits.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── ANSI + I/O helpers ────────────────────────────────────────────────
const c = {
  dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m",
  amber: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m",
};
const ok    = (m) => console.log(`  ${c.green}✓${c.reset} ${m}`);
const fail  = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`);
const step  = (n, m) => console.log(`\n${c.bold}[${n}]${c.reset} ${m}`);
const hint  = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

// The only question this wizard still asks is which profile to run. The y/N
// confirmations that used to wrap every setup step are gone — see the setup
// steps below for why — and `askYesNo` went with them rather than sitting here
// as an unused helper implying a prompt that no longer happens. (`warn`, an
// amber logger, was dead before that and went at the same time.)
const isTty = !!output.isTTY;
const rl = isTty ? createInterface({ input, output }) : null;
const ask = async (q) => rl ? rl.question(`  ${c.dim}?${c.reset} ${q} `) : "";

function which(cmd) {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function usageExit(msg) {
  if (msg) console.error(`setup: ${msg}\n`);
  console.error("usage: node tools/setup.mjs [--offline | --sdlc | --swe-pro]");
  console.error("       (no flag → interactive picker)");
  process.exit(2);
}

// ─── check registry ────────────────────────────────────────────────────
// Every check returns {ok:boolean, label:string, detail?:string, fix?:string}.

function checkNode() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  return major >= 22
    ? { ok: true, label: `Node ${process.versions.node}` }
    : { ok: false, label: `Node ${process.versions.node}`,
        detail: "this repo needs Node ≥ 22",
        fix: "Install the latest LTS from https://nodejs.org (or via nvm: nvm install --lts)" };
}

function checkPnpm() {
  const path = which("pnpm");
  if (!path) return { ok: false, label: "pnpm", fix: "npm install -g pnpm" };
  const v = run("pnpm", ["--version"]).stdout.trim();
  const major = parseInt(v.split(".")[0], 10);
  return major >= 11
    ? { ok: true, label: `pnpm ${v}` }
    : { ok: false, label: `pnpm ${v}`, detail: "this repo needs pnpm ≥ 11",
        fix: "npm install -g pnpm" };
}

// Split out of checkOfflineTests so the wizard names what it is doing while it
// does it. Folded together, a two-minute `pnpm install` printed nothing under a
// step labelled "offline tests" and read as a hang — the single most likely
// place for a first-time reader to kill the process and conclude the repo is
// broken. Two steps, two labels, and the slow one says so.
function checkWorkspaceInstall() {
  console.log(`    ${c.dim}Installing workspace dependencies (pnpm install — this can take a minute)…${c.reset}`);
  const install = run("pnpm", ["install", "--silent"], { cwd: ROOT, stdio: "inherit" });
  return install.status === 0
    ? { ok: true, label: "workspace dependencies installed" }
    : { ok: false, label: "workspace install", detail: `pnpm install exited ${install.status}`,
        fix: "See the pnpm output above, then re-run this wizard." };
}

/**
 * Read the pass/skip counts out of `node --test`'s own trailing summary.
 *
 * The counts are read back from the runner rather than written here as
 * literals. A hardcoded "290 tests pass" is a number that goes stale the first
 * time anyone adds a test, and a wizard that reports a stale fact about the
 * repo it is setting up is worse than one that reports none.
 *
 * SKIPS ARE REPORTED, NOT SWALLOWED. Several suites assert against recorded
 * runs and a corpus checkout that a fresh clone does not have, so they skip
 * themselves rather than fail — correct behaviour, but it means a bare "N tests
 * pass" overstates what was actually verified on this machine. Naming the skip
 * count is the difference between a green line the reader can trust and one
 * that quietly hides its own coverage gap.
 *
 * Split out as a pure function so the parsing is unit-tested without spawning a
 * three-hundred-test run inside the test suite (setup.test.mjs). Returns null
 * when no summary is present at all — a crashed runner, not a passing one.
 */
function parseTestSummary(stdout) {
  const pass = /^#\s*pass\s+(\d+)/im.exec(stdout || "");
  if (!pass) return null;
  const skipped = /^#\s*skipped\s+(\d+)/im.exec(stdout || "");
  return { pass: parseInt(pass[1], 10), skipped: skipped ? parseInt(skipped[1], 10) : 0 };
}

function checkOfflineTests() {
  console.log(`    ${c.dim}Running the offline test suite…${c.reset}`);
  const test = run("pnpm", ["test"], { cwd: ROOT, stdio: "pipe" });
  const summary = parseTestSummary(test.stdout);
  if (test.status === 0 && summary) {
    return {
      ok: true,
      label: `${summary.pass} offline tests pass`,
      detail: summary.skipped
        ? `${summary.skipped} skipped — suites that need recorded runs or the ` +
          `SWE-bench Pro corpus, neither of which ships in a clone; not a failure`
        : undefined,
    };
  }
  return { ok: false, label: "offline tests", detail: `pnpm test exited ${test.status}`,
           fix: "Run `pnpm test` directly to see the failing tests." };
}

function checkDryRun() {
  const r = run("node", [
    "tools/harness-matrix/run-harness.mjs",
    "--task-dir", "examples/kudos-wall",
    "--runtime", "claude-code",
    "--policy", "tools/harness-matrix/policies/all-gemini-flash-high.yaml",
    "--dry-run",
  ], { cwd: ROOT });
  return r.status === 0
    ? { ok: true, label: "harness --dry-run resolves cleanly" }
    : { ok: false, label: "harness --dry-run",
        detail: `exit ${r.status}: ${(r.stderr || "").split("\n")[0] || ""}`,
        fix: "Re-run the dry-run command from docs/setup.md and read the error." };
}

function checkClaudeCli() {
  const path = which("claude");
  if (!path) return { ok: false, label: "Claude Code CLI",
    fix: "npm install -g @anthropic-ai/claude-code" };
  const v = run("claude", ["--version"]);
  const version = (v.stdout || "").trim().split("\n")[0] || "installed";
  return { ok: true, label: `Claude Code CLI (${version})` };
}

function checkAnthropicAuth() {
  const oauth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  if (oauth && apiKey) {
    return { ok: true, label: "Anthropic auth", detail:
      "BOTH CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY are set — the CLI's precedence picks one. Unset the one you don't want to pay from." };
  }
  if (oauth) return { ok: true, label: "Anthropic auth (subscription seat via CLAUDE_CODE_OAUTH_TOKEN)" };
  if (apiKey) return { ok: true, label: "Anthropic auth (metered API via ANTHROPIC_API_KEY)" };
  // INFORMATIONAL, NOT BLOCKING. `runtimes.mjs` preflights this for real before
  // a launch spends anything and exits 2 naming the missing variable, so a
  // second gate here buys nothing — and it costs something: a reader with no
  // Anthropic credentials yet could not use the wizard to discover the rest of
  // what they need. Reported, and the run continues.
  return { ok: true, label: "Anthropic auth — not configured yet",
    detail: "neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set; " +
      "set one before a live run — run-harness.mjs refuses to start without it, at $0",
    hintOnly: "export CLAUDE_CODE_OAUTH_TOKEN=…   # or ANTHROPIC_API_KEY=…" };
}

function checkPython() {
  const path = which("python3") || which("python");
  if (!path) return { ok: false, label: "Python 3", fix: "Install Python ≥ 3.10" };
  const v = run(path.endsWith("python") ? "python" : "python3", ["--version"]);
  const m = /(\d+)\.(\d+)/.exec(v.stdout + v.stderr);
  if (!m) return { ok: false, label: "Python 3",
    fix: "Install Python ≥ 3.10 and re-run this wizard" };
  const [_, maj, min] = m;
  return (+maj >= 3 && +min >= 10)
    ? { ok: true, label: `Python ${maj}.${min}` }
    : { ok: false, label: `Python ${maj}.${min}`, detail: "need ≥ 3.10",
        fix: "Install Python ≥ 3.10" };
}

const WORKER_VENV = join(ROOT, "tools/harness-matrix/sdk-probe/sdkprobe");
const WORKER_PY = process.env.GEMINI_WORKER_PYTHON || join(WORKER_VENV, "bin/python");

function checkWorkerVenvExists() {
  return existsSync(WORKER_PY)
    ? { ok: true, label: "worker venv exists" }
    : { ok: false, label: "worker venv",
        detail: `not found at ${WORKER_PY.replace(ROOT + "/", "")}`,
        fix: `python3 -m venv tools/harness-matrix/sdk-probe/sdkprobe` };
}

function checkAntigravityImport() {
  if (!existsSync(WORKER_PY)) {
    return { ok: false, label: "google-antigravity import",
      detail: "worker venv missing",
      fix: "See 'worker venv' above" };
  }
  const r = run(WORKER_PY, ["-c", "import google.antigravity as ag; print(ag.__version__ if hasattr(ag, '__version__') else 'ok')"]);
  if (r.status !== 0) {
    return { ok: false, label: "google-antigravity import",
      detail: (r.stderr || "").split("\n")[0] || "import failed",
      fix: `${WORKER_PY.replace(ROOT + "/", "")} -m pip install google-antigravity` };
  }
  return { ok: true, label: `google-antigravity ${r.stdout.trim()}` };
}

function checkVertexAdc() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit && existsSync(explicit)) return { ok: true, label: `Vertex creds (GOOGLE_APPLICATION_CREDENTIALS)` };
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const adc = join(home, ".config/gcloud/application_default_credentials.json");
  if (existsSync(adc)) return { ok: true, label: "Vertex ADC on disk" };
  return { ok: false, label: "Vertex auth",
    detail: "no Application Default Credentials and no GOOGLE_APPLICATION_CREDENTIALS",
    fix: "gcloud auth application-default login" };
}

// The one auth-shaped check that stays BLOCKING, deliberately, against the rule
// above. The other two are informational because something downstream catches
// them at $0. Nothing catches this one: an unset project is indistinguishable
// from a deliberate one to every layer below, so a wizard that waved it through
// would hand the reader a green screen and a Vertex permission error later.
// `gemini_worker.py` used to paper over it with a default project ID, which was
// worse still — it pointed a stranger's run at somebody else's billing account.
// It now refuses to start unset, and this is where a reader finds that out.
function checkGoogleProject() {
  const p = process.env.GOOGLE_CLOUD_PROJECT;
  return p
    ? { ok: true, label: `GOOGLE_CLOUD_PROJECT=${p}` }
    : { ok: false, label: "GOOGLE_CLOUD_PROJECT",
        detail: "unset — the Gemini worker refuses to start without it, and there is no default",
        fix: "export GOOGLE_CLOUD_PROJECT=your-gcp-project-id" };
}

function checkGoogleLocation() {
  const loc = process.env.GOOGLE_CLOUD_LOCATION;
  if (loc) return { ok: true, label: `GOOGLE_CLOUD_LOCATION=${loc}` };
  return { ok: true, label: "GOOGLE_CLOUD_LOCATION=asia-south1 (default)",
    detail: "override only if your Vertex quota lives elsewhere" };
}

function checkDocker() {
  if (!which("docker")) {
    return { ok: false, label: "Docker CLI",
      fix: "Install Docker Desktop or the docker engine, then start it." };
  }
  const r = run("docker", ["info"], { stdio: "pipe" });
  return r.status === 0
    ? { ok: true, label: "Docker daemon reachable" }
    : { ok: false, label: "Docker daemon", detail: "docker info failed",
        fix: "Start Docker Desktop (or `sudo systemctl start docker` on Linux)." };
}

const SWE_HARNESS = join(ROOT, "studies/swe-pro-corpus/.harness/SWE-bench_Pro-os");
const SWE_PIN = "ca10a60a5fcae51e6948ffe1485d4153d421e6c5";
const SWE_VENV = join(ROOT, ".venv-swe-pro");
const SWE_VENV_PY = join(SWE_VENV, "bin/python");

function checkSweEvaluator() {
  if (!existsSync(SWE_HARNESS)) {
    return { ok: false, label: "Scale evaluator clone",
      detail: `missing at studies/swe-pro-corpus/.harness/SWE-bench_Pro-os`,
      fix: "git clone https://github.com/scaleapi/SWE-bench_Pro-os studies/swe-pro-corpus/.harness/SWE-bench_Pro-os && git -C studies/swe-pro-corpus/.harness/SWE-bench_Pro-os checkout ca10a60a" };
  }
  const r = run("git", ["-C", SWE_HARNESS, "rev-parse", "HEAD"], { stdio: "pipe" });
  const head = (r.stdout || "").trim();
  return head === SWE_PIN
    ? { ok: true, label: `Scale evaluator @ ${head.slice(0, 8)} (pinned)` }
    : { ok: false, label: "Scale evaluator",
        detail: `HEAD is ${head.slice(0, 8) || "?"}, need ${SWE_PIN.slice(0, 8)}`,
        fix: `git -C studies/swe-pro-corpus/.harness/SWE-bench_Pro-os checkout ${SWE_PIN.slice(0, 8)}` };
}

function checkSweGradingVenv() {
  if (!existsSync(SWE_VENV_PY)) {
    return { ok: false, label: "SWE-bench Pro grading venv",
      detail: "not found at .venv-swe-pro",
      fix: "python3 -m venv .venv-swe-pro && .venv-swe-pro/bin/pip install pandas tqdm docker requests" };
  }
  const r = run(SWE_VENV_PY, ["-c", "import pandas, tqdm, docker, requests; print('ok')"], { stdio: "pipe" });
  return r.status === 0
    ? { ok: true, label: "SWE-bench Pro grading venv" }
    : { ok: false, label: "SWE-bench Pro grading venv",
        detail: (r.stderr || "").split("\n")[0] || "import failed",
        fix: ".venv-swe-pro/bin/pip install pandas tqdm docker requests" };
}

function checkFreeDisk() {
  try {
    const st = statfsSync(ROOT);
    const freeGB = (Number(st.bavail) * Number(st.bsize)) / 1e9;
    if (freeGB >= 30) return { ok: true, label: `~${freeGB.toFixed(1)} GB free (need ≥ 30 GB)` };
    return { ok: false, label: `~${freeGB.toFixed(1)} GB free`,
      detail: "SWE-bench Pro needs ~30 GB for per-instance Docker images",
      fix: "Free up disk on the volume containing this repo, or move the corpus to a larger volume." };
  } catch {
    return { ok: true, label: "disk space (skipped — statfs unavailable)" };
  }
}

// ─── modes ─────────────────────────────────────────────────────────────
// Each mode is an ordered list of `[label, fn]`, or `[label, fn, CRITICAL]`.
//
// CRITICAL means "every check after this one is noise if this fails". Node,
// pnpm and Python are the toolchain the rest of the list is measured with; a
// broken workspace install makes the test and dry-run steps meaningless; a
// missing Claude Code CLI makes every driver-side check below it moot. Those
// stop the run at the point of failure. Criticality is declared here, once per
// check, rather than inside the check functions — the same function is critical
// in every mode that uses it, and a check has no business knowing how badly the
// caller needs it.
const CRITICAL = true;

const OFFLINE_CHECKS = [
  ["Node ≥ 22", checkNode, CRITICAL],
  ["pnpm ≥ 11", checkPnpm, CRITICAL],
  ["workspace install", checkWorkspaceInstall, CRITICAL],
  ["offline tests", checkOfflineTests, CRITICAL],
  ["harness --dry-run", checkDryRun],
];

const SDLC_CHECKS = [
  ...OFFLINE_CHECKS,
  ["Claude Code CLI", checkClaudeCli, CRITICAL],
  ["Anthropic auth", checkAnthropicAuth],
  ["Python ≥ 3.10", checkPython, CRITICAL],
  ["worker venv", checkWorkerVenvExists],
  ["google-antigravity", checkAntigravityImport],
  ["Vertex ADC", checkVertexAdc],
  ["GOOGLE_CLOUD_PROJECT", checkGoogleProject],
  ["GOOGLE_CLOUD_LOCATION", checkGoogleLocation],
  ["Docker", checkDocker],
];

const SWE_PRO_CHECKS = [
  ...SDLC_CHECKS,
  ["Scale evaluator clone at pinned SHA", checkSweEvaluator],
  ["SWE-bench Pro grading venv", checkSweGradingVenv],
  ["free disk (≥ 30 GB)", checkFreeDisk],
];

// ─── setup steps (run, don't ask) ──────────────────────────────────────
//
// These used to be y/N offers. They are not any more, and the reason is worth
// stating: `--sdlc` and `--swe-pro` are requests to set the machine up. Asking
// "shall I create the venv you just asked me to create?" is a prompt with one
// sensible answer, and a reader who mistypes at it gets a red screen listing the
// very thing the wizard was about to fix.
//
// Each is idempotent — present means done, and it returns before touching
// anything. Each is also gated on a TTY by its caller, which is the real safety
// property: piped or in CI, this file is a read-only diagnostic.

function ensureWorkerVenv() {
  if (existsSync(WORKER_PY)) { ok("worker venv already present"); return true; }
  const py = which("python3") || which("python");
  if (!py) { fail("no python3 on PATH — cannot create the worker venv"); return false; }
  console.log(`    ${c.dim}Creating the Gemini worker venv…${c.reset}`);
  const create = run(py.endsWith("python") ? "python" : "python3",
    ["-m", "venv", WORKER_VENV], { stdio: "inherit" });
  if (create.status !== 0) { fail("venv creation failed"); return false; }
  console.log(`    ${c.dim}Installing google-antigravity…${c.reset}`);
  const pip = run(join(WORKER_VENV, "bin/pip"), ["install", "google-antigravity"],
    { stdio: "inherit" });
  if (pip.status !== 0) { fail("pip install google-antigravity failed"); return false; }
  ok("worker venv created with google-antigravity");
  return true;
}

function ensureSweEvaluator() {
  if (existsSync(SWE_HARNESS)) { ok("Scale evaluator already cloned"); return true; }
  console.log(`    ${c.dim}Cloning the Scale evaluator at the pinned SHA…${c.reset}`);
  run("mkdir", ["-p", dirname(SWE_HARNESS)], { stdio: "inherit" });
  const clone = run("git", ["clone", "https://github.com/scaleapi/SWE-bench_Pro-os", SWE_HARNESS],
    { stdio: "inherit" });
  if (clone.status !== 0) { fail("git clone failed"); return false; }
  const checkout = run("git", ["-C", SWE_HARNESS, "checkout", SWE_PIN.slice(0, 8)],
    { stdio: "inherit" });
  if (checkout.status !== 0) { fail(`checkout ${SWE_PIN.slice(0, 8)} failed`); return false; }
  ok(`Scale evaluator cloned at ${SWE_PIN.slice(0, 8)}`);
  return true;
}

function ensureSweGradingVenv() {
  if (existsSync(SWE_VENV_PY)) { ok("grading venv already present"); return true; }
  const py = which("python3") || which("python");
  if (!py) { fail("no python3 on PATH — cannot create the grading venv"); return false; }
  console.log(`    ${c.dim}Creating the SWE-bench Pro grading venv…${c.reset}`);
  const create = run(py.endsWith("python") ? "python" : "python3",
    ["-m", "venv", SWE_VENV], { stdio: "inherit" });
  if (create.status !== 0) { fail("venv creation failed"); return false; }
  console.log(`    ${c.dim}Installing pandas tqdm docker requests…${c.reset}`);
  const pip = run(join(SWE_VENV, "bin/pip"),
    ["install", "pandas", "tqdm", "docker", "requests"],
    { stdio: "inherit" });
  if (pip.status !== 0) { fail("pip install failed"); return false; }
  ok("grading venv created");
  return true;
}

// ─── driver ────────────────────────────────────────────────────────────

async function runChecks(mode, checks) {
  console.log(`\n${c.bold}Claude Code Harness — setup (${mode} profile)${c.reset}`);
  console.log(`${c.dim}Non-critical checks all run before the summary, so you see the whole picture at once.${c.reset}`);

  // Setup steps happen before the checks that look for their output, so a fresh
  // clone can build the venv and then have its own check pass on the same run.
  // The TTY gate is the safety property, not a prompt: piped or in CI this file
  // is a pure diagnostic and never writes to the machine.
  if (isTty && (mode === "sdlc" || mode === "swe-pro")) {
    step("setup", "Preparing the machine");
    ensureWorkerVenv();
  }
  if (isTty && mode === "swe-pro") {
    ensureSweEvaluator();
    ensureSweGradingVenv();
  }

  const results = [];
  let i = 1;
  for (const [label, fn, critical] of checks) {
    step(String(i++), label);
    // Criticality is merged onto the result rather than returned by the check,
    // so `r` carries everything the failure path needs in one object.
    const r = { ...fn(), critical: !!critical };
    if (r.ok) {
      ok(r.label);
      if (r.detail) hint(r.detail);
      // Reported-but-not-required next step (e.g. auth that preflight enforces
      // later). Distinct from `fix`, which only ever appears under a failure.
      if (r.hintOnly) hint(r.hintOnly);
    } else {
      fail(r.label);
      if (r.detail) hint(r.detail);
      if (r.fix) hint(`fix: ${r.fix}`);
    }
    results.push(r);

    // Stop here rather than printing a cascade of failures that all say the
    // same thing. Returning (not process.exit) keeps the whole driver testable
    // — main() is the only place that turns a code into an exit.
    if (!r.ok && r.critical) {
      console.log("");
      console.log(`${c.bold}${c.red}Stopped: ${label} is required before the remaining checks mean anything.${c.reset}`);
      console.log(`${c.dim}Fix it and re-run this wizard — the checks after this one were not attempted.${c.reset}\n`);
      return 1;
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`${c.bold}${c.green}All checks passed.${c.reset}`);
    console.log(`\nNext:`);
    if (mode === "offline") {
      console.log(`  Kick the tires with a dry-run:`);
      console.log(`    node tools/harness-matrix/run-harness.mjs \\`);
      console.log(`      --task-dir examples/kudos-wall \\`);
      console.log(`      --runtime claude-code \\`);
      console.log(`      --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \\`);
      console.log(`      --dry-run`);
    } else if (mode === "sdlc") {
      console.log(`  Run a live SDLC pass (~$3–4, 20–30 min):`);
      console.log(`    node tools/harness-matrix/run-harness.mjs \\`);
      console.log(`      --task-dir examples/kudos-wall \\`);
      console.log(`      --runtime claude-code \\`);
      console.log(`      --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml`);
    } else {
      console.log(`  Fetch a SWE-bench Pro instance and run it (~$2, 15–40 min):`);
      console.log(`    node tools/swe/fetch-instances-pro.mjs \\`);
      console.log(`      --ids navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a`);
      console.log(`    node tools/harness-matrix/run-harness.mjs \\`);
      console.log(`      --instance-dir studies/swe-pro-corpus/navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a \\`);
      console.log(`      --runtime claude-code \\`);
      console.log(`      --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml`);
    }
    console.log("");
    return 0;
  }
  console.log(`${c.bold}${c.red}${failed.length} check${failed.length === 1 ? "" : "s"} failed.${c.reset} See the fix lines above.`);
  console.log(`${c.dim}Re-run this wizard once you've addressed them.${c.reset}\n`);
  return 1;
}

async function pickMode() {
  console.log(`\n${c.bold}Which setup profile?${c.reset}`);
  console.log(`  1) ${c.bold}offline${c.reset}  — Node + pnpm, run offline tests, dry-run. No credentials.`);
  console.log(`  2) ${c.bold}sdlc${c.reset}     — offline + Claude Code + Anthropic auth + worker venv + ADC + Docker.`);
  console.log(`  3) ${c.bold}swe-pro${c.reset}  — sdlc + Scale evaluator + grading venv + ~30 GB free disk.`);
  const a = (await ask("Pick 1, 2, or 3:")).trim();
  if (a === "1") return "offline";
  if (a === "2") return "sdlc";
  if (a === "3") return "swe-pro";
  usageExit(`unknown choice ${JSON.stringify(a)}`);
}

async function main() {
  const args = process.argv.slice(2);
  let mode = null;
  for (const a of args) {
    if (a === "--offline") mode = "offline";
    else if (a === "--sdlc") mode = "sdlc";
    else if (a === "--swe-pro") mode = "swe-pro";
    else if (a === "--help" || a === "-h") usageExit();
    else usageExit(`unknown flag ${a}`);
  }
  if (!mode) {
    if (!isTty) usageExit("no --mode flag and not a TTY — pass one of --offline, --sdlc, --swe-pro");
    mode = await pickMode();
  }
  const checks = mode === "offline" ? OFFLINE_CHECKS
    : mode === "sdlc" ? SDLC_CHECKS
    : SWE_PRO_CHECKS;
  const code = await runChecks(mode, checks);
  if (rl) rl.close();
  process.exit(code);
}

// Run only when invoked as a script. Imported — which is how tools/setup.test.mjs
// exercises the driver and the pure checks — this file defines and returns.
// Without the guard, `import` would run the whole wizard inside the test process.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

// Every path this wizard is allowed to create, in the order the setup steps
// create them. RULE 4 in the header is the reason this list exists as data
// rather than as prose: a boundary nobody can check is a boundary that erodes.
// setup.test.mjs asserts each entry resolves inside ROOT, so an `ensureNode()`
// that writes to /usr/local, or a venv relocated onto an absolute path outside
// the clone, fails the suite instead of quietly changing a stranger's machine.
const INSTALL_TARGETS = [
  join(ROOT, "node_modules"),   // checkWorkspaceInstall  — pnpm install
  WORKER_VENV,                  // ensureWorkerVenv       — Gemini worker venv
  SWE_HARNESS,                  // ensureSweEvaluator     — Scale evaluator, pinned SHA
  SWE_VENV,                     // ensureSweGradingVenv   — Pro grading venv
];

// Exported for tools/setup.test.mjs. Everything here is side-effect-free to
// call except runChecks, which is driven in tests with synthetic check tuples
// rather than the real registries — no venv, no network, no spend.
export {
  checkNode, checkAnthropicAuth, checkGoogleProject, checkGoogleLocation,
  parseTestSummary, runChecks, OFFLINE_CHECKS, SDLC_CHECKS, SWE_PRO_CHECKS,
  INSTALL_TARGETS, ROOT,
};
