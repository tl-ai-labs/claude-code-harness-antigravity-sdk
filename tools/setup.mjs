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
 * Idempotent — re-running is safe. No destructive action ever runs without
 * confirmation. All checks execute before the summary, so a failure names
 * every missing prereq at once, not one at a time.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const warn  = (m) => console.log(`  ${c.amber}!${c.reset} ${m}`);
const fail  = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`);
const step  = (n, m) => console.log(`\n${c.bold}[${n}]${c.reset} ${m}`);
const hint  = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

const isTty = !!output.isTTY;
const rl = isTty ? createInterface({ input, output }) : null;
const ask = async (q) => rl ? rl.question(`  ${c.dim}?${c.reset} ${q} `) : "";
async function askYesNo(q, defaultYes = true) {
  if (!rl) return defaultYes;
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await ask(`${q} ${suffix}`)).trim().toLowerCase();
  if (a === "") return defaultYes;
  return a === "y" || a === "yes";
}

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

function checkOfflineTests() {
  console.log(`    ${c.dim}Installing workspace deps and running the 290 offline tests…${c.reset}`);
  const install = run("pnpm", ["install", "--silent"], { cwd: ROOT, stdio: "inherit" });
  if (install.status !== 0) {
    return { ok: false, label: "offline tests", detail: "pnpm install failed",
             fix: "See the pnpm output above and re-run this wizard." };
  }
  const test = run("pnpm", ["test"], { cwd: ROOT, stdio: "pipe" });
  const passed = /pass\s+\d+/i.test(test.stdout || "") && test.status === 0;
  return passed
    ? { ok: true, label: "290 offline tests pass" }
    : { ok: false, label: "offline tests", detail: `pnpm test exited ${test.status}`,
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
  return { ok: false, label: "Anthropic auth",
    detail: "neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set",
    fix: "export CLAUDE_CODE_OAUTH_TOKEN=…   # or ANTHROPIC_API_KEY=…" };
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

function checkGoogleProject() {
  const p = process.env.GOOGLE_CLOUD_PROJECT;
  return p
    ? { ok: true, label: `GOOGLE_CLOUD_PROJECT=${p}` }
    : { ok: false, label: "GOOGLE_CLOUD_PROJECT",
        detail: "unset — the worker will refuse to run",
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
// Each mode is an ordered list of check functions. Some checks offer to
// remediate; those live below.

const OFFLINE_CHECKS = [
  ["Node ≥ 22", checkNode],
  ["pnpm ≥ 11", checkPnpm],
  ["offline tests + workspace install", checkOfflineTests],
  ["harness --dry-run", checkDryRun],
];

const SDLC_CHECKS = [
  ...OFFLINE_CHECKS,
  ["Claude Code CLI", checkClaudeCli],
  ["Anthropic auth", checkAnthropicAuth],
  ["Python ≥ 3.10", checkPython],
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

// ─── remediation offers (opt-in, y/N, defaults to no) ──────────────────

async function offerCreateWorkerVenv() {
  if (existsSync(WORKER_PY)) return true;
  console.log("");
  const yes = await askYesNo(
    "The worker venv is missing. Create it now? (python3 -m venv + pip install google-antigravity)",
    true,
  );
  if (!yes) return false;
  const py = which("python3") || which("python");
  if (!py) { fail("no python3 on PATH"); return false; }
  console.log(`    ${c.dim}Creating venv…${c.reset}`);
  const create = run(py.endsWith("python") ? "python" : "python3",
    ["-m", "venv", WORKER_VENV], { stdio: "inherit" });
  if (create.status !== 0) { fail("venv creation failed"); return false; }
  console.log(`    ${c.dim}Installing google-antigravity…${c.reset}`);
  const pip = run(join(WORKER_VENV, "bin/pip"), ["install", "google-antigravity"],
    { stdio: "inherit" });
  return pip.status === 0;
}

async function offerCloneSweEvaluator() {
  if (existsSync(SWE_HARNESS)) return true;
  console.log("");
  const yes = await askYesNo(
    "The Scale evaluator clone is missing. git clone it at the pinned SHA now?",
    true,
  );
  if (!yes) return false;
  console.log(`    ${c.dim}Cloning Scale evaluator…${c.reset}`);
  run("mkdir", ["-p", dirname(SWE_HARNESS)], { stdio: "inherit" });
  const clone = run("git", ["clone", "https://github.com/scaleapi/SWE-bench_Pro-os", SWE_HARNESS],
    { stdio: "inherit" });
  if (clone.status !== 0) return false;
  const checkout = run("git", ["-C", SWE_HARNESS, "checkout", SWE_PIN.slice(0, 8)],
    { stdio: "inherit" });
  return checkout.status === 0;
}

async function offerCreateSweGradingVenv() {
  if (existsSync(SWE_VENV_PY)) return true;
  console.log("");
  const yes = await askYesNo(
    "The SWE-bench Pro grading venv is missing. Create it now?",
    true,
  );
  if (!yes) return false;
  const py = which("python3") || which("python");
  if (!py) { fail("no python3 on PATH"); return false; }
  console.log(`    ${c.dim}Creating grading venv…${c.reset}`);
  const create = run(py.endsWith("python") ? "python" : "python3",
    ["-m", "venv", SWE_VENV], { stdio: "inherit" });
  if (create.status !== 0) return false;
  console.log(`    ${c.dim}Installing pandas tqdm docker requests…${c.reset}`);
  const pip = run(join(SWE_VENV, "bin/pip"),
    ["install", "pandas", "tqdm", "docker", "requests"],
    { stdio: "inherit" });
  return pip.status === 0;
}

// ─── driver ────────────────────────────────────────────────────────────

async function runChecks(mode, checks) {
  console.log(`\n${c.bold}Claude Code Harness — setup (${mode} profile)${c.reset}`);
  console.log(`${c.dim}Every check runs before the summary; you'll see the whole picture at once.${c.reset}`);

  // Remediation offers happen before the check itself, so a fresh clone can
  // create the venv and then have its own check pass on the same run. They
  // are strictly interactive — a headless run (no TTY) is a pure diagnostic
  // and never touches the system.
  if (isTty && (mode === "sdlc" || mode === "swe-pro")) {
    step("pre", "Optional setup steps");
    await offerCreateWorkerVenv();
  }
  if (isTty && mode === "swe-pro") {
    await offerCloneSweEvaluator();
    await offerCreateSweGradingVenv();
  }

  const results = [];
  let i = 1;
  for (const [label, fn] of checks) {
    step(String(i++), label);
    const r = fn();
    if (r.ok) {
      ok(r.label);
      if (r.detail) hint(r.detail);
    } else {
      fail(r.label);
      if (r.detail) hint(r.detail);
      if (r.fix) hint(`fix: ${r.fix}`);
    }
    results.push(r);
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

main().catch((e) => { console.error(e); process.exit(1); });
