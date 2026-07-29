#!/usr/bin/env node
/**
 * run-harness — the harness-matrix engine: one KIND (what the work is) ×
 * one RUNTIME (who does the work) × one POLICY (model/thinking/retry/limit
 * config), through a script-owned recipe to a graded verdict.
 *
 * 2026-07-25 kind split — mirroring the console's segregation logic
 * (run-executor.ts iterates a template's stages and dispatches on executor
 * kind; the task-type specifics live in the template data, not the engine):
 * this file no longer contains any benchmark-specific code. It resolves the
 * two adapters and hands over:
 *
 *   kinds/swepro.mjs — SWE-bench Pro: sealed Scale instance images,
 *     REPRO → LOCALIZE → PATCH, Scale's official evaluator. Selected by
 *     --instance-dir. Behavior is byte-identical to the pre-split engine
 *     (verified by --dry-run diff at the split commit).
 *   kinds/sdlc.mjs — SDLC: the console's own templates/sdlc-mini/
 *     template.yaml driven end to end by an agent runtime against a fresh
 *     copy of scaffolds/service-web, graded by the scaffold's build+test.
 *     Selected by --task-dir.
 *
 * The script owns the loop — stage sequence, gates, retries, cleanup,
 * logging (kinds + kinds/lib.mjs). The runtime owns the inside of a phase —
 * which files to read, what to run, how to edit (runtimes.mjs). That split
 * is the study: procedure held byte-identical across runtimes, so
 * differences in outcome read as runtime effect, not procedural drift.
 * Runtimes run on the HOST; every repo command — the agent's and the
 * gates', identically — executes inside the kind's container via
 * out/run-in-env.sh (DESIGN §1.1).
 *
 * Usage (single task; a multi-task run is a shell loop over this):
 *   PATH=/opt/homebrew/opt/node@22/bin:$PATH \
 *     node tools/harness-matrix/run-harness.mjs \
 *       ( --instance-dir studies/swe-pro-corpus/instance_...   # SWE-bench Pro
 *       | --task-dir tools/harness-matrix/tasks/kudos-wall )   # SDLC
 *       --runtime claude-code \
 *       --policy tools/harness-matrix/policies/all-opus.yaml \
 *       [--dry-run] [--skip-grade] [--cleanup-images]
 *
 * Auth: claude-code cells need CLAUDE_CODE_OAUTH_TOKEN (Max) or
 * ANTHROPIC_API_KEY on the host; a DELEGATED cc×Gemini cell additionally
 * needs the google-antigravity SDK venv + Vertex ADC (preflight verifies
 * both at $0). The `antigravity` runtime (agy CLI) was removed 2026-07-23;
 * it returns later as an SDK harness.
 *
 * Exit codes: 0 run completed (resolved or not — the verdict lives in
 * grade-verdict.json); 1 infra error; 2 usage/preflight error.
 */

import { existsSync } from "node:fs";
import { RUNTIMES } from "./runtimes.mjs";

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const instanceDir = flag("instance-dir");
const taskDir = flag("task-dir");
const runtimeName = flag("runtime");
const policyPath = flag("policy");
const dryRun = args.includes("--dry-run");
const skipGrade = args.includes("--skip-grade");
// Opt-in, and deliberately NOT the default: whether images are worth keeping
// is a property of the machine, not of the study. See the cleanup block in
// kinds/swepro.mjs for the safety argument. (The SDLC kind ignores it — its
// one small env image is shared by every SDLC run and costs nothing to keep.)
const cleanupImages = args.includes("--cleanup-images");

function usageExit(msg) {
  console.error(msg);
  console.error("usage: run-harness.mjs (--instance-dir <dir> | --task-dir <dir>) " +
    "--runtime claude-code --policy <yaml> [--dry-run] [--skip-grade] [--cleanup-images]");
  process.exit(2);
}
// Exactly one kind selector: the input directory names the kind. This is the
// same move run-executor.ts makes with template_id — dispatch is data-driven,
// the engine has no benchmark conditionals past this point.
if (!instanceDir && !taskDir) usageExit("required: --instance-dir (SWE-bench Pro) or --task-dir (SDLC)");
if (instanceDir && taskDir) usageExit("--instance-dir and --task-dir are mutually exclusive — one run is one kind");
if (!runtimeName || !RUNTIMES[runtimeName]) {
  usageExit(`required: --runtime, one of: ${Object.keys(RUNTIMES).join(", ")}`);
}
if (!policyPath || !existsSync(policyPath)) usageExit("required: --policy <existing yaml file>");
const runtime = RUNTIMES[runtimeName];

// Dynamic per-kind import, deliberately not a pair of static imports: only
// the SELECTED kind's module loads. swepro.mjs statically depends on
// packages/swe-bench/dist (Teja's integrity build) — an SDLC-only machine
// without that dist built must still be able to run the SDLC kind, and a
// Pro run must not depend on the SDLC kind's files existing either.
const kind = instanceDir
  ? (await import("./kinds/swepro.mjs")).swepro
  : (await import("./kinds/sdlc.mjs")).sdlc;
await kind.run({
  dir: instanceDir ?? taskDir,
  runtimeName, runtime, policyPath, dryRun, skipGrade, cleanupImages,
});
