/**
 * kinds/swepro.mjs — the SWE-bench Pro task kind: one frozen Scale instance
 * through the script-owned recipe REPRO → LOCALIZE → PATCH, graded by
 * Scale's official evaluator (grade.mjs).
 *
 * This file is the 2026-07-25 kind-split home of what previously lived
 * inline in run-harness.mjs — MOVED, not rewritten (the --dry-run outputs
 * before and after the split are diff-identical). Everything Pro-specific
 * is here: the sealed-image build and extraction-integrity checks (the
 * gold-fix-in-git-history threat, scaleapi issue #93), the nulled source
 * hosts, the three phase gates with their cross-phase contract state, the
 * test/repro diff stripping, Scale grading, and the opt-in image cleanup.
 * Everything shared with other kinds (policy, prompts, the attempt loop,
 * run-in-env, diff mechanics, manifest totals) comes from kinds/lib.mjs.
 *
 * Recipe-critical implementation notes (each learned, not guessed):
 *   - Repro files are named *harness_repro* (basename CONTAINS the
 *     marker, e.g. test_harness_repro.py — pytest refuses files that
 *     don't start with test_). They live inside the repo so native test
 *     runners find them, and are stripped from the graded diff, loudly.
 *   - The surrounding-suite baseline AND the patch-phase regression check
 *     run with the repro files temporarily HELD OUT of the workdir:
 *     package-scoped commands (`go test ./models/`) would otherwise sweep
 *     in the intentionally-failing repro, turn every baseline red, and
 *     hollow out the no-worse gate. The repro itself is judged by its own
 *     dedicated gate.
 *   - The patch is always `git diff sealed-base` computed by git over
 *     in-place edits — hunk headers cannot be corrupt by construction
 *     (Setup 0's corrupt-diff retries do not exist here).
 *   - Phase calls are STATELESS: each is a fresh `-p` invocation whose
 *     prompt carries the PR description plus prior phases' contract
 *     files, injected by the harness — context is byte-identical across
 *     runtimes regardless of their conversation features.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, normalize, resolve } from "node:path";
import { validateInstance } from "../../../packages/swe-bench/dist/integrity.js";
import { auditRun, manifestAuditBlock } from "../audit.mjs";
import { gradeRun } from "../grade.mjs";
import { DELEGATION_VOCAB } from "../runtimes.mjs";
import {
  HARNESS_DIR, bindingLabel, isDelegatedBinding, loadPolicy, makePromptRenderer,
  writeRunInEnv, makeExecInEnv, makeGit, classifyChanges, cleanArtifacts,
  saneRepoPath, computeDiff, runStageAttempts, costTotals, makeRunDir, sweproBaseTag,
} from "./lib.mjs";
// The shared terminal voice (2026-07-25 demo-grade logging): run header,
// phase banners and the final scoreboard all render through logfmt so the
// Pro and SDLC runs read identically. Presentation-only — every number
// printed comes from the same records that land in manifest.json.
import {
  paint, rule, kvBlock, attemptTotals, tokenSplit, fmtDur, fmtUsd, say, sayErr,
} from "../logfmt.mjs";
// The run's two BIG frames (opening header, closing scoreboard) live in
// logrender.mjs as pure functions of a plain descriptor, so replay-log.mjs can
// re-render THIS EXACT TEXT from a finished run's manifest.json at $0 — a demo
// rehearsal that renders different text from the real run is worse than none.
import { sweproHeader, sweproFooter } from "../logrender.mjs";

const REGISTRY = "jefzda/sweap-images";

// Source-code hosts nulled INSIDE the execution container (the channel a
// repo command could use to fetch the real fix). Package registries stay
// reachable — dependency traffic is legitimate. The runtime process itself
// is on the host with real DNS; its fetch surface is handled per-runtime
// (claude-code: --disallowedTools + trajectory audit) and the residual risk
// is stated in the report (DESIGN §7).
const NULLED_HOSTS = [
  "github.com", "api.github.com", "codeload.github.com",
  "raw.githubusercontent.com", "objects.githubusercontent.com",
  "gist.githubusercontent.com", "gitlab.com", "bitbucket.org",
];

// Test paths stripped from the graded diff (a patch that edits tests can
// flip verdicts without fixing anything) and forbidden as bug_files.
const TEST_PATH = [
  /(^|\/)tests?\//, /(^|\/)testdata\//, /(^|\/)__tests__\//, /(^|\/)spec\//,
  /_test\.go$/, /\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/, /(^|\/)conftest\.py$/,
];
// The repro marker: basename contains harness_repro (see header for why
// "contains", not "starts with").
const HARNESS_REPRO_PATH = /(^|\/)[^/]*harness_repro[^/]*$/;

const PHASES = ["repro", "localize", "patch"];

// Per-phase banner copy for the demo-grade terminal log: what the phase is
// FOR and what its gate actually checks, stated up front so the watcher can
// judge the pass/fail that follows. Display-only — the enforcement text of
// record is the gate code below and the prompts under prompts/.
const PHASE_META = {
  repro: {
    title: "author a failing reproduction of the reported bug",
    gate: "repro command must FAIL (non-zero, fast) on the unfixed code; only declared harness_repro files may exist",
  },
  localize: {
    title: "locate the bug and pick the surrounding test suite",
    gate: "read-only; bug_files must be existing non-test sources; the surrounding test_command must complete (red baseline allowed, timeout not)",
  },
  patch: {
    title: "author the fix",
    gate: "repro flips to PASS · surrounding suite no worse than baseline · repro files untouched · test/repro hunks stripped from the graded diff",
  },
};

/** Pro's graded-diff strip rule: test paths and the harness repro. */
const stripFn = (path) => TEST_PATH.some((re) => re.test(path)) || HARNESS_REPRO_PATH.test(path);

export const swepro = {
  id: "swe-bench-pro",
  agentStages: PHASES,

  async run({ dir: instanceDir, runtimeName, runtime, policyPath, dryRun, skipGrade, cleanupImages }) {
    const policy = loadPolicy(policyPath, runtimeName, PHASES);

    // ---- instance load + sealed-field gate ---------------------------------
    // validateInstance asserts no sealed field (gold patch, eval test lists…)
    // is anywhere in the object that prompts are built from. sealed.json is
    // NEVER read by this kind — only grade.mjs touches it, in a separate
    // process against the original Scale image.
    const instPath = join(resolve(instanceDir), "instance.json");
    const instance = validateInstance(JSON.parse(readFileSync(instPath, "utf8")), instPath);

    const renderPrompt = makePromptRenderer(PHASES);

    // ---- dry run -----------------------------------------------------------
    if (dryRun) {
      say(`instance : ${instance.instance_id}`);
      say(`runtime  : ${runtimeName}`);
      say(`policy   : ${policy.raw.name} (retry ${policy.raw.retry.type}×${policy.maxAttempts})`);
      for (const phase of PHASES) {
        const r = policy.resolved[phase];
        say(`  ${phase.padEnd(8)} → ${bindingLabel(r.binding)}  (thinking: ${r.thinking ?? "n/a"})`);
      }
      say("\n--dry-run: rendered REPRO prompt below, nothing executed\n");
      say(renderPrompt("repro", {
        WORKDIR: "<run-dir>/workdir",
        OUT_DIR: "<run-dir>/out",
        LANGUAGE: instance.repo_language ?? "unknown",
        PROBLEM_STATEMENT: instance.problem_statement,
        ATTEMPT_NOTE: "",
      }));
      process.exit(0);
    }

    // ---- preflight (all $0, all before any build or spend) -----------------
    try {
      runtime.preflight({ binding: policy.resolved.repro.binding });
      execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    } catch (err) {
      sayErr(`preflight failed: ${err.message ?? err}`);
      process.exit(2);
    }
    if (!skipGrade) {
      // Grading inputs verified up front — discovering a missing venv AFTER a
      // 30-minute agent run wastes the run.
      const ROOT = resolve(HARNESS_DIR, "../..");
      const gradePython = join(ROOT, ".venv-swe-pro/bin/python");
      const harnessClone = join(ROOT, "studies/swe-pro-corpus/.harness/SWE-bench_Pro-os");
      for (const [what, p] of [["grading venv", gradePython], ["Scale harness clone", harnessClone],
        ["sealed.json", join(resolve(instanceDir), "sealed.json")]]) {
        if (!existsSync(p)) {
          sayErr(`preflight failed: ${what} missing at ${p} (or pass --skip-grade)`);
          process.exit(2);
        }
      }
    }
    const runtimeVersion = runtime.version();

    // ---- sealed image (base + git seal + coreutils; no agent layer) --------
    // Image naming is a port of create_dockerhub_tag (swe_bench_pro_eval.py);
    // the sealed tag is keyed by a short hash because docker tags cap at 128
    // chars and the base tag already flirts with it.
    const [repoBase] = instance.repo.toLowerCase().split("/");
    const baseTag = sweproBaseTag(instance.instance_id, instance.repo);
    const baseImage = `${REGISTRY}:${baseTag}`;
    const shortKey = Buffer.from(baseTag).toString("base64url").slice(0, 16).toLowerCase();
    const sealedImage = `swe-harness:${repoBase}-${shortKey}`;

    // Run identity header (demo-grade logging): the boxed block a watcher —
    // or a reviewer reading a captured log — needs to know EXACTLY what this
    // run is before a single paid token moves: the instance, the cell, every
    // phase's binding, whose seat pays for what, and what the delegation
    // guard enforces. Same visual grammar as the SDLC kind's header.
    // Rendered by logrender.sweproHeader from a plain descriptor, NOT inline —
    // identical treatment to the SDLC kind so the two demos read the same, and
    // so replay-log.mjs can re-render this exact frame from manifest.json at $0.
    // See kinds/sdlc.mjs for the full rationale; in short, a partner team
    // watching this scroll past needs to know who writes the code before any of
    // the numbers mean anything.
    const delegatedRun = PHASES.some((p) => isDelegatedBinding(policy.resolved[p].binding));
    const headDelegate = delegatedRun ? policy.resolved[PHASES[0]].binding : null;
    say(sweproHeader({
      instanceId: instance.instance_id,
      repo: instance.repo, repoLanguage: instance.repo_language,
      cell: `${runtimeName} × ${policy.raw.name}`,
      retryType: policy.raw.retry.type, maxAttempts: policy.maxAttempts,
      timeoutMin: policy.limits.phase_timeout_min,
      budgetUsd: policy.limits.phase_budget_usd,
      stages: PHASES.map((p) => ({
        id: p,
        label: bindingLabel(policy.resolved[p].binding),
        thinking: policy.resolved[p].thinking,
        // The worker Gemini thinking level, named separately from the driver
        // effort above — a delegated stage has two, and one bare "thinking"
        // label for both is the ambiguity this row exists to remove.
        workerThinking: policy.resolved[p].binding?.worker_thinking,
      })),
      delegated: delegatedRun,
      driver: headDelegate?.driver, worker: headDelegate?.worker,
      baseImage, sealedImage,
      runtime: `${runtimeName} ${runtimeVersion}`,
      startedAt: new Date().toISOString(),
    }));

    // Step labels from here on: a run is long and mostly silent without them —
    // each expensive stage announces itself so a watcher always knows what the
    // harness is doing and what comes next.
    say("\n[build] sealing the instance image (docker build; cached layers make re-runs fast)…");
    execFileSync("docker", [
      "build", "--platform", "linux/amd64",
      "-f", join(HARNESS_DIR, "Dockerfile"),
      "--build-arg", `BASE_IMAGE=${baseImage}`,
      "-t", sealedImage,
      HARNESS_DIR,
    ], { stdio: "inherit" });

    // ---- run dir + workdir extraction --------------------------------------
    const { stamp, runDir, workdir, outDir } = makeRunDir(instance.instance_id, runtimeName, policy.raw.name);

    // docker create + cp: the workdir leaves the image as a plain directory,
    // carrying the sealed one-commit .git and the sealed-base tag with it.
    say(`[extract] copying the sealed workdir out of the image → ${workdir}`);
    const tmpCtr = `swe-harness-x-${shortKey}-${stamp.replace(/[^0-9a-z]/gi, "").slice(-6)}`;
    execFileSync("docker", ["create", "--platform", "linux/amd64", "--name", tmpCtr, sealedImage], { stdio: "pipe" });
    try {
      execFileSync("docker", ["cp", `${tmpCtr}:/app/.`, workdir], { stdio: "pipe" });
    } finally {
      execFileSync("docker", ["rm", tmpCtr], { stdio: "pipe" });
    }

    const git = makeGit(workdir);

    // Extraction integrity: the seal must have TRAVELLED. A dirty status here
    // (macOS case-collision, symlink loss…) or surviving remotes/history means
    // the diff anchor is unreliable — abort loudly rather than run on it.
    try {
      git("rev-parse", "--verify", "sealed-base");
    } catch {
      sayErr("extraction integrity: sealed-base tag missing in extracted workdir");
      process.exit(1);
    }
    if (git("remote").trim() !== "") {
      sayErr("extraction integrity: git remotes survived the seal — refusing to run");
      process.exit(1);
    }
    if (git("rev-list", "--count", "HEAD").trim() !== "1") {
      sayErr("extraction integrity: history beyond the sealed commit — refusing to run");
      process.exit(1);
    }
    {
      const dirty = git("status", "--porcelain").trim();
      if (dirty !== "") {
        sayErr("extraction integrity: workdir not clean after extraction (case-collision or " +
          `symlink loss on the host FS?):\n${dirty.split("\n").slice(0, 20).join("\n")}`);
        process.exit(1);
      }
    }

    // ---- containerized command path ----------------------------------------
    const runInEnv = writeRunInEnv({
      outDir, workdir, image: sealedImage,
      cmdTimeoutS: Math.floor(policy.limits.cmd_timeout_min * 60),
      nulledHosts: NULLED_HOSTS,
      platform: "linux/amd64",
      // Scale images carry a shell ENTRYPOINT, so the image consumes `-c`
      // directly — no interposed shell needed (unlike the SDLC env image).
      shell: null,
    });
    const execInEnv = makeExecInEnv({ runInEnv, cmdTimeoutMin: policy.limits.cmd_timeout_min });

    // ---- cross-phase contract state ----------------------------------------
    let reproContract = null;   // { command, files } once REPRO passes
    let reproFiles = [];        // repro file paths (snapshot lives in out/repro-files)
    let localizeContract = null; // { bug_files, test_command } once LOCALIZE passes
    let baseline = null;        // { exit_code, timed_out } of the surrounding suite

    /** Full reset to the sealed base; optionally restore the repro snapshot. */
    function resetWorkdir({ restoreRepro }) {
      git("reset", "--hard", "sealed-base");
      git("clean", "-fdq");
      if (restoreRepro) {
        for (const f of reproFiles) {
          mkdirSync(dirname(join(workdir, f)), { recursive: true });
          cpSync(join(outDir, "repro-files", f), join(workdir, f));
        }
      }
    }

    /**
     * Run fn with the harness_repro files temporarily HELD OUT of the workdir
     * (see header: keeps the surrounding-suite baseline and regression check
     * honest for package-scoped test commands that would sweep the repro in).
     */
    function withReproHeldOut(fn) {
      const hold = join(outDir, ".repro-hold");
      for (const f of reproFiles) {
        mkdirSync(dirname(join(hold, f)), { recursive: true });
        cpSync(join(workdir, f), join(hold, f));
        rmSync(join(workdir, f));
      }
      try {
        return fn();
      } finally {
        for (const f of reproFiles) {
          mkdirSync(dirname(join(workdir, f)), { recursive: true });
          cpSync(join(hold, f), join(workdir, f));
        }
        rmSync(hold, { recursive: true, force: true });
      }
    }

    // ---- gates -------------------------------------------------------------
    // Each gate returns { pass, reason, warnings[], artifacts_cleaned[] } and
    // its reason is fed VERBATIM into the retry prompt — the model is told
    // exactly what to address, not "try again".

    function readContract(name, shapeCheck) {
      const p = join(outDir, `${name}.json`);
      if (!existsSync(p)) return { err: `${name}.json was not written to the output directory` };
      let parsed;
      try { parsed = JSON.parse(readFileSync(p, "utf8")); } catch (e) {
        return { err: `${name}.json is not valid JSON: ${e.message}` };
      }
      const shapeErr = shapeCheck(parsed);
      return shapeErr ? { err: `${name}.json: ${shapeErr}` } : { value: parsed };
    }

    function gateRepro(logPrefix) {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };

      const c = readContract("repro", (v) =>
        typeof v?.command !== "string" || !v.command.trim() ? "\"command\" must be a non-empty string"
        : !Array.isArray(v.files) || v.files.length === 0 ? "\"files\" must be a non-empty array"
        : null);
      if (c.err) { g.reason = c.err; return g; }
      const { command, files } = c.value;

      for (const f of files) {
        if (!saneRepoPath(f)) { g.reason = `repro.json files: '${f}' is not a plain repository-relative path`; return g; }
        if (!HARNESS_REPRO_PATH.test(normalize(f))) {
          g.reason = `repro.json files: '${f}' — every repro file name must contain 'harness_repro' ` +
            "(e.g. test_harness_repro.py, harness_repro_test.go)"; return g;
        }
        if (!existsSync(join(workdir, f))) { g.reason = `repro.json files: '${f}' does not exist in the repository`; return g; }
      }

      // The phase may ONLY have created the declared repro files. Undeclared
      // changes are a gate failure (declared files are also the restore
      // snapshot — completeness matters); test-run ephemera are cleaned and
      // recorded.
      const cls = classifyChanges(git, files);
      if (cls.violations.length) {
        g.reason = "the REPRO phase changed repository files beyond the declared repro files " +
          `(modify nothing, declare every created file):\n${cls.violations.join("\n")}`;
        return g;
      }
      cleanArtifacts(workdir, cls.artifacts);
      g.artifacts_cleaned = cls.artifacts;

      // THE gate: the reproduction must fail on the unfixed code — and fail
      // fast (a hanging repro would poison the patch gate).
      const r = execInEnv(command, join(outDir, "repro-baseline.log"));
      if (r.timedOut) { g.reason = `the repro command timed out after ${policy.limits.cmd_timeout_min} min — it must fail fast, not hang`; return g; }
      if (r.exitCode === 0) {
        g.reason = "the repro command exited 0 on the UNFIXED code — it must fail (exit non-zero) " +
          "because of the described bug, and pass only once the bug is fixed"; return g;
      }

      // Snapshot for restore-after-failed-patch-attempts.
      for (const f of files) {
        mkdirSync(dirname(join(outDir, "repro-files", f)), { recursive: true });
        cpSync(join(workdir, f), join(outDir, "repro-files", f));
      }
      reproContract = { command, files };
      reproFiles = files.map((f) => normalize(f));
      g.pass = true;
      g.repro_exit = r.exitCode;
      return g;
    }

    function gateLocalize(logPrefix) {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };

      const c = readContract("localize", (v) =>
        !Array.isArray(v?.bug_files) || v.bug_files.length === 0 ? "\"bug_files\" must be a non-empty array"
        : typeof v.test_command !== "string" || !v.test_command.trim() ? "\"test_command\" must be a non-empty string"
        : null);
      if (c.err) { g.reason = c.err; return g; }
      const { bug_files, test_command } = c.value;

      for (const f of bug_files) {
        if (!saneRepoPath(f)) { g.reason = `localize.json bug_files: '${f}' is not a plain repository-relative path`; return g; }
        if (!existsSync(join(workdir, f))) { g.reason = `localize.json bug_files: '${f}' does not exist in the repository`; return g; }
        if (TEST_PATH.some((re) => re.test(normalize(f))) || HARNESS_REPRO_PATH.test(normalize(f))) {
          g.reason = `localize.json bug_files: '${f}' is a test/repro file — bug_files must be the ` +
            "NON-TEST source files a correct fix would edit"; return g;
        }
      }
      if (/harness_repro/.test(test_command)) {
        g.reason = "localize.json test_command targets the harness_repro reproduction — it must be the " +
          "PRE-EXISTING surrounding suite (the repro has its own gate)"; return g;
      }

      // Read-only phase: only the repro files may be present as changes.
      const cls = classifyChanges(git, reproFiles);
      if (cls.violations.length) {
        g.reason = "the LOCALIZE phase is read-only but repository files changed " +
          `(undo/avoid all edits):\n${cls.violations.join("\n")}`;
        return g;
      }
      cleanArtifacts(workdir, cls.artifacts);
      g.artifacts_cleaned = cls.artifacts;

      // Baseline snapshot of the surrounding suite — run with the repro files
      // held out (see header) so package-scoped commands stay honest. A red
      // baseline is allowed (no-worse waiver at the patch gate); a TIMEOUT is
      // not — "scope it tightly" is enforced here, where retrying is cheap.
      const b = withReproHeldOut(() => execInEnv(test_command, join(outDir, "baseline.log")));
      if (b.timedOut) {
        g.reason = `the surrounding test_command timed out after ${policy.limits.cmd_timeout_min} min — ` +
          "choose a tighter scope (one package/module) that completes within a few minutes"; return g;
      }
      baseline = { test_command, exit_code: b.exitCode, timed_out: false };
      writeFileSync(join(outDir, "baseline.json"), JSON.stringify(
        { ...baseline, note: "run with harness_repro files held out of the tree" }, null, 2));

      localizeContract = { bug_files, test_command };
      g.pass = true;
      g.baseline_exit = b.exitCode;
      return g;
    }

    function gatePatch(logPrefix) {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };

      // Repro files must have survived the phase (agents editing/deleting the
      // reproduction is a known cheat family).
      const missing = reproFiles.filter((f) => !existsSync(join(workdir, f)));
      if (missing.length) {
        g.reason = `the PATCH phase deleted repro file(s): ${missing.join(", ")} — the reproduction ` +
          "must be left untouched"; return g;
      }

      // Ephemera from the agent's own test runs: clean before diffing so the
      // graded patch is source-only.
      const cls = classifyChanges(git, []);
      cleanArtifacts(workdir, cls.artifacts);
      g.artifacts_cleaned = cls.artifacts;

      // Gate 1 — a non-test, non-repro change exists.
      const diff = computeDiff(git, "sealed-base", stripFn);
      writeFileSync(join(runDir, "raw.diff"), diff.raw);
      if (diff.kept.length === 0) {
        g.reason = "no non-test source change was made — the fix must edit repository source files " +
          "(test and harness_repro edits are stripped before grading)"; return g;
      }
      if (diff.stripped.length) {
        const testStrips = diff.stripped.filter((s) => !HARNESS_REPRO_PATH.test(s.path));
        if (testStrips.length) {
          g.warnings.push(`test-path hunks stripped from the graded diff: ${testStrips.map((s) => s.path).join(", ")}`);
        }
      }

      // Gate 2 — the fail-to-pass flip: the reproduction now passes.
      const r = execInEnv(reproContract.command, join(outDir, "phases", `${logPrefix}.gate-repro.log`));
      if (r.timedOut) { g.reason = "the repro command timed out after the fix — it must pass (exit 0) quickly"; return g; }
      if (r.exitCode !== 0) {
        g.reason = `the repro command still fails (exit ${r.exitCode}) after the fix — the bug is not fixed ` +
          `(see the reproduction in ${reproFiles.join(", ")})`; return g;
      }

      // Gate 3 — surrounding suite no worse than baseline (repro held out, as
      // at baseline time). Exit codes cannot count per-test failures across
      // four languages, so a red baseline waives this gate with a RECORDED
      // warning instead of failing it (DESIGN §7 no-worse waiver).
      const t = withReproHeldOut(() =>
        execInEnv(localizeContract.test_command, join(outDir, "phases", `${logPrefix}.gate-tests.log`)));
      if (t.timedOut) { g.reason = "the surrounding test suite timed out after the fix (it completed at baseline) — likely a hang introduced by the change"; return g; }
      if (t.exitCode !== 0) {
        if (baseline.exit_code === 0) {
          g.reason = `the surrounding test suite regressed: baseline was green, now exit ${t.exitCode} ` +
            `(command: ${localizeContract.test_command})`; return g;
        }
        g.warnings.push(`no-worse waiver: baseline was already red (exit ${baseline.exit_code}), ` +
          `post-patch exit ${t.exitCode} — accepted, recorded (per-language failure-set diffing is a listed refinement)`);
      }

      g.pass = true;
      g.tests_exit = t.exitCode;
      return g;
    }

    // ---- phase loop --------------------------------------------------------
    const startedAt = new Date().toISOString();
    const phaseRecords = [];
    let failedAt = null;

    for (const phase of PHASES) {
      const cfg = policy.resolved[phase];

      // Phase banner (demo-grade logging): purpose + gate contract stated
      // BEFORE the attempts run, so the pass/fail lines that follow are
      // judged against a rule the watcher has already read.
      say("\n" + rule(`PHASE ${PHASES.indexOf(phase) + 1}/${PHASES.length} · ` +
        `${phase.toUpperCase()} — ${PHASE_META[phase].title}`));
      say(kvBlock([
        ["binding", bindingLabel(cfg.binding)],
        ["thinking", String(cfg.thinking ?? "n/a")],
        ["gate", PHASE_META[phase].gate],
      ]));

      const { passed, attempts } = await runStageAttempts({
        stage: phase, cfg, policy, runtime, runtimeName, outDir, workdir,
        buildPrompt: (attemptNote) => {
          const ctx = {
            WORKDIR: workdir,
            OUT_DIR: outDir,
            LANGUAGE: instance.repo_language ?? "unknown",
            PROBLEM_STATEMENT: instance.problem_statement,
            ATTEMPT_NOTE: attemptNote,
          };
          if (phase !== "repro") ctx.REPRO_JSON = JSON.stringify(reproContract, null, 2);
          if (phase === "patch") {
            ctx.LOCALIZE_JSON = JSON.stringify(localizeContract, null, 2);
            ctx.BASELINE_EXIT = String(baseline.exit_code);
            ctx.BASELINE_STATUS = baseline.exit_code === 0
              ? "passing" : "already failing before any fix — the no-worse rule applies";
          }
          return renderPrompt(phase, ctx);
        },
        gate: (logPrefix) => phase === "repro" ? gateRepro(logPrefix)
          : phase === "localize" ? gateLocalize(logPrefix)
          : gatePatch(logPrefix),
        // Cleanup discipline between attempts: REPRO retries start from the
        // sealed tree; LOCALIZE/PATCH retries start from sealed + the repro
        // snapshot. (First attempts start clean by construction.) Stale
        // contract files must not satisfy this attempt's gate.
        beforeRetry: () => {
          resetWorkdir({ restoreRepro: phase !== "repro" });
          rmSync(join(outDir, `${phase}.json`), { force: true });
        },
        delegationWhat: phase === "repro" ? "authoring the failing reproduction test"
          : phase === "localize" ? "analysing where the bug lives (the localization)"
          : "authoring the fix",
        // Pro passes back the exact wording the Skill used to hard-code, so the
        // rendered prompt bytes are unchanged by the parameterization — asserted
        // in guard.test.mjs, not assumed (Sriram, 2026-07-25).
        delegationVocab: DELEGATION_VOCAB.swepro,
      });

      phaseRecords.push({ phase, model_id: cfg.modelId, binding: cfg.binding, thinking: cfg.thinking, passed, attempts });
      // Phase roll-up line: the attempt loop printed per-attempt verdicts;
      // this one line is the phase's own row of the final ledger, early.
      {
        const pt = attemptTotals(attempts);
        say(paint.dim(`  phase totals: ${pt.attempts} attempt(s) · wall ${fmtDur(pt.wall)}` +
          (pt.usd != null ? ` · driver ${fmtUsd(pt.usd)}` : "") +
          (isDelegatedBinding(cfg.binding)
            ? ` · ${pt.delegations} delegation(s) · ${tokenSplit(pt.tokens)} worker tokens` : "")));
      }
      if (!passed) {
        failedAt = phase;
        // No patch can exist for this run: reset so the finish-step diff below
        // is honestly empty (repro files restored → stripped from the diff).
        resetWorkdir({ restoreRepro: phase !== "repro" && reproFiles.length > 0 });
        break;
      }
    }

    // ---- finish: diff → predictions → audit → manifest → grade -------------
    say("\n[finish] computing the graded diff, trajectory audit and manifest…");
    const finalDiff = computeDiff(git, "sealed-base", stripFn);
    writeFileSync(join(runDir, "raw.diff"), finalDiff.raw);
    const modelPatch = finalDiff.kept.map((k) => k.section).join("");
    writeFileSync(join(runDir, "model.diff"), modelPatch);
    if (finalDiff.stripped.length) {
      console.warn(`STRIPPED ${finalDiff.stripped.length} test/repro file(s) from the graded diff:`);
      for (const s of finalDiff.stripped) console.warn(`  - ${s.path}`);
    }

    writeFileSync(join(runDir, "predictions.jsonl"), JSON.stringify({
      instance_id: instance.instance_id,
      model_name_or_path: `harness-matrix+${runtimeName}+${policy.raw.name}`,
      model_patch: modelPatch,
    }) + "\n");

    // The audit's delegated-cell check (a driver editing the tree itself via
    // Bash, bypassing the worker) needs to know this is a delegated run and
    // where the workdir / out dir are, to tell a tree write from a legitimate
    // contract write. (delegatedRun is computed once, up at the run header.)
    //
    // expectByPhase adds the second question — not just WHO did the work, but
    // whether the delegation asked for the model + thinking level the policy
    // ordered (2026-07-26; see audit.mjs delegationMismatches for the run that
    // motivated it). Built from phaseRecords, the same array the manifest is
    // written from, so audit and manifest cannot disagree. Pro policies are
    // untiered today — every phase resolves to the same binding — but the
    // check is per phase anyway: a future tiered Pro column must not be able
    // to ship with this silently un-covered.
    const audit = auditRun(outDir, runtimeName, {
      delegated: delegatedRun, workdir, outDir,
      expectByPhase: Object.fromEntries(
        phaseRecords.filter((r) => r.binding?.worker).map((r) => [r.phase, r.binding])),
    });
    writeFileSync(join(runDir, "audit.json"), JSON.stringify(audit, null, 2));

    const manifest = {
      study: "harness-matrix",
      instance_id: instance.instance_id,
      repo: instance.repo,
      repo_language: instance.repo_language ?? null,
      runtime: {
        name: runtimeName,
        version: runtimeVersion,
      },
      policy: {
        name: policy.raw.name,
        file: policyPath,
        sha256: createHash("sha256").update(readFileSync(policyPath)).digest("hex"),
        retry: policy.raw.retry,
        limits: policy.limits,
      },
      base_image: baseImage,
      sealed_image: sealedImage,
      prompt_fields: ["problem_statement"],
      phases: phaseRecords,
      failed_at: failedAt,
      patch: {
        files_kept: finalDiff.kept.map((k) => k.path),
        files_stripped: finalDiff.stripped.map((s) => s.path),
      },
      totals: costTotals(phaseRecords, startedAt, delegatedRun),
      // Same three-part audit block sdlc.mjs writes, from the same helper:
      // { total, critical, by_family } for the who-did-the-work flags and for
      // the delegation content lint, plus the coverage fields that keep a zero
      // from reading as "clean" when it means "not checked".
      ...manifestAuditBlock(audit),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // Final scoreboard (demo-grade logging): the boxed verdict + a per-phase
    // ledger + honest totals + the boundary block — the terminal's own copy of
    // manifest.json, so a captured log carries the whole story without opening a
    // single file. Rendered by logrender.sweproFooter from a plain descriptor,
    // the same one replay-log.mjs reconstructs from manifest.json: the rehearsed
    // frame and the live frame are one code path, not two copies of the wording.
    say(sweproFooter({
      instanceId: instance.instance_id,
      cell: `${runtimeName} × ${policy.raw.name}`,
      failedAt,
      records: phaseRecords,
      totals: manifest.totals,
      audit: { editCount: audit.editCount, flags: audit.flags },
      delegated: delegatedRun,
      keptCount: finalDiff.kept.length,
      strippedCount: finalDiff.stripped.length,
      runDir,
    }));

    if (skipGrade) {
      say("(--skip-grade: grade later with grade.mjs --run-dir … --instance-dir …)");
    } else {
      try {
        gradeRun({ runDir, instanceDir: resolve(instanceDir) });
      } catch (err) {
        // A grading infra failure must not lose the run — everything above is
        // already on disk; record and exit non-zero so a batch loop notices.
        writeFileSync(join(runDir, "grade-error.txt"), String(err.stack ?? err));
        sayErr(`grading failed (run artifacts preserved): ${err.message ?? err}`);
        process.exit(1);
      }
    }

    // ---- optional image cleanup (MACHINE-SPECIFIC, opt-in) -----------------
    // Off unless --cleanup-images is passed, because "delete the images" is a
    // fact about THIS machine, not about the study: a sealed instance image is
    // ~4.4 GB and this Mac runs with ~23 GB free, so a 12-instance cell cannot
    // hold the corpus at once. A machine with disk to spare should keep them
    // cached — the same 12 base images are reused by every cell, and re-pulling
    // costs real time.
    //
    // Deleting is safe for the study's integrity, for three separate reasons:
    //   1. Nothing evidentiary lives in an image. model.diff, raw.diff,
    //      manifest.json, audit.json, the trajectories and grade-verdict.json
    //      are all written to runs/ on the host.
    //   2. `sealed-base`, the diff anchor, is a git tag inside the EXTRACTED
    //      workdir — not a property of the image. The patch stays computable.
    //   3. The base image is pinned by digest, recorded here before deletion,
    //      so a later re-pull is provably the same bits rather than "probably
    //      the same".
    // The residual risk is availability, not correctness: if the upstream
    // registry stops serving that digest, a deleted instance can no longer be
    // re-run.
    //
    // Ordering: the base image only goes once a grade has actually run in THIS
    // invocation, because grade.mjs executes Scale's evaluator in that original
    // image. Under --skip-grade the base is kept for the deferred grade, and
    // only the sealed image (a thin layer, rebuildable in seconds) is dropped.
    if (cleanupImages) {
      let baseDigest = null;
      try {
        baseDigest = execFileSync("docker",
          ["image", "inspect", "--format", "{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}", baseImage],
          { encoding: "utf8" }).trim() || null;
      } catch { /* already absent — nothing to record, nothing to remove */ }

      const pruned = [];
      for (const img of skipGrade ? [sealedImage] : [sealedImage, baseImage]) {
        try {
          execFileSync("docker", ["rmi", "-f", img], { stdio: "pipe" });
          pruned.push(img);
        } catch (err) {
          // Never fail a completed run over cleanup — the science is already on
          // disk. Warn so a disk that silently stops draining is visible.
          console.warn(`cleanup: could not remove ${img} (continuing): ${err.message ?? err}`);
        }
      }

      manifest.cleanup = {
        images_pruned: pruned,
        base_image_digest: baseDigest,
        base_image_kept: skipGrade,
        note: skipGrade
          ? "base image kept: --skip-grade defers grading, which needs it"
          : "base image removed after grading; re-pull by the recorded digest is byte-identical",
      };
      writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      say(`cleanup: removed ${pruned.length} image(s)` +
        (baseDigest ? ` | base pinned at ${baseDigest.split("@")[1] ?? baseDigest}` : ""));
    }
    process.exit(0);
  },
};
