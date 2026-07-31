#!/usr/bin/env node
/**
 * replay-log.mjs — re-render a FINISHED run's terminal log, offline, at $0.
 *
 * WHY (2026-07-26). The terminal log of a delegated cc×Gemini run is a demo
 * artifact: it gets screenshared internally and to Google, paused on, screenshotted
 * and quoted. That makes its wording, spacing and ordering a deliverable — and
 * before this tool the ONLY way to look at that deliverable was to pay for a
 * live run, watch it scroll past once, and hope the phrasing landed. Reviewing
 * demo copy by spending model tokens is exactly the cost-discipline mistake
 * (verify copy offline; pay only for engine output).
 *
 * So: point this at any run directory and it prints what that run printed.
 *
 *   node tools/harness-matrix/replay-log.mjs --run-dir <run>            # whole log
 *   node tools/harness-matrix/replay-log.mjs --run-dir <run> --stage execute
 *   node tools/harness-matrix/replay-log.mjs --run-dir <run> --frames    # header+footer only
 *
 * FIDELITY — what is real and what is reconstructed, stated plainly because a
 * rehearsal that quietly differs from the real thing is worse than none:
 *
 *   real, byte-for-byte   The opening header and closing scoreboard are the
 *                         SAME functions the live run calls (logrender.mjs), fed
 *                         a descriptor rebuilt from manifest.json — not a copy
 *                         of their wording. The per-stage narration is the SAME
 *                         narrator the live run taps (runtimes.makePhaseNarrator)
 *                         fed the run's own trajectory .jsonl, so every tool
 *                         call, every delegation box, every BLOCKED line and
 *                         every worker receipt is the run's own.
 *   real, from the run    The [+m:ss] stamps and each hand-off's duration come
 *                         from the trajectory events' own timestamps (the
 *                         narrator's clock is injectable for exactly this), so
 *                         the rehearsed log carries the run's real pacing.
 *   reconstructed         The interleaved scaffold chatter a live run prints
 *                         between stages — docker build output, provisioning,
 *                         gate command logs — is NOT replayed: it is the
 *                         environment talking, not the run's evidence. Stage
 *                         banners, the model-pin line, the worker ledger and the
 *                         gate verdict ARE replayed, from the manifest.
 *   never invented        A value the manifest does not carry and the pinned
 *                         source file cannot supply prints as "(unrecoverable)".
 *
 * Contract: read-only. This tool opens a run directory and prints. It writes
 * nothing, calls no model, and touches no network.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { makePhaseNarrator } from "./runtimes.mjs";
import { sdlcHeader, sdlcFooter, sweproHeader, sweproFooter } from "./logrender.mjs";
import {
  paint, rule, kvBlock, attemptTotals, tokenSplit, fmtDur, fmtUsd, fmtInt, fitLine, sayErr,
} from "./logfmt.mjs";
import { parseYaml, bindingLabel } from "./kinds/lib.mjs";

// A value the manifest cannot supply and no pinned source file recovers. Never
// guessed: a plausible-looking wrong value in a demo rehearsal is the failure
// mode this whole tool exists to prevent.
const UNRECOVERABLE = "(unrecoverable — not in manifest.json)";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Same delegated-binding predicate as the kinds: object, not model string. */
const isDelegated = (b) => typeof b === "object" && b !== null;

/**
 * Load a file the manifest PINNED by sha256 (the task brief's parent task.json,
 * the template). Returns { data, drift } — `drift: true` when the file is still
 * there but its bytes no longer match the pin, which the replay reports rather
 * than silently rendering today's values as if they were the run's.
 */
function loadPinned(path, expectedSha, parse) {
  if (!path || !existsSync(path)) return { data: null, drift: false, missing: true };
  const raw = readFileSync(path);
  const drift = expectedSha != null && sha256(raw) !== expectedSha;
  try { return { data: parse(raw.toString("utf8")), drift, missing: false }; }
  catch { return { data: null, drift, missing: false }; }
}

// ---------------------------------------------------------------------------
// trajectory replay
// ---------------------------------------------------------------------------

/**
 * Narrate one phase-attempt's trajectory through the REAL narrator, with the
 * clock driven by the events' own timestamps.
 *
 * The clock indirection is the whole trick. `makePhaseNarrator` stamps every
 * line with elapsed-since-spawn and times each delegation by subtracting two
 * clock reads; on a wall clock during replay those all collapse to zero and the
 * rehearsal would claim every hand-off took 0s. Feeding it the trajectory's own
 * `timestamp` fields makes the rehearsed stamps the run's real ones.
 *
 * Events without a timestamp (the session-init event, task notifications) hold
 * the clock at its last known value rather than resetting it — monotonic by
 * construction, so a stamp can never run backwards on screen.
 */
function narrateTrajectory(file, { delegated, workdir, outDir }, print) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  // Anchor at the first timestamp present. A phase's true t0 is the CLI spawn,
  // a beat before its first streamed event; anchoring here understates the
  // offsets by that beat and never overstates them.
  let cursor = null;
  for (const l of lines) {
    try { const ev = JSON.parse(l); if (ev.timestamp) { cursor = Date.parse(ev.timestamp); break; } }
    catch { /* partial line — same tolerance as the live parse */ }
  }
  if (cursor == null) cursor = 0;
  const narrate = makePhaseNarrator(
    { delegated, workdir, outDir, now: () => cursor }, print);
  for (const l of lines) {
    let ts = null;
    try { const ev = JSON.parse(l); ts = ev.timestamp ? Date.parse(ev.timestamp) : null; }
    catch { /* narration skips it, exactly as live */ }
    if (ts != null && Number.isFinite(ts) && ts > cursor) cursor = ts;
    narrate(l);
  }
}

/**
 * The per-attempt lines kinds/lib.mjs prints around each runtime call: the
 * attempt banner, the model-pin verification, the delegated-cell worker ledger
 * and the gate verdict. Replayed from the manifest's attempt records, which is
 * where every one of those numbers came from in the first place.
 *
 * Deliberately NOT replayed: gate command output (build/test logs). That is the
 * container talking — it lives in out/*.log and is not part of the run's
 * evidence about who did the work.
 */
function replayAttempts({ stageId, record, bindingLabel, cap, runtimeName, delegated, workdir, outDir, phasesDir }, print) {
  for (const a of record.attempts ?? []) {
    print("\n" + paint.bold(`▶ [${stageId}] attempt ${a.attempt}/${cap}`) +
      // The runtime NAME comes from the manifest, never a constant: runs/
      // holds antigravity cells too, and a rehearsal that labels one of those
      // `runtime claude-code` misreports the very axis the matrix compares.
      paint.dim(` · ${bindingLabel} · runtime ${runtimeName}`));
    if (a.attempt > 1) {
      print(paint.yellow("  retry: previous attempt's gate failure is quoted in this prompt"));
    }

    const traj = join(phasesDir, `${stageId}-a${a.attempt}.trajectory.jsonl`);
    if (existsSync(traj)) {
      narrateTrajectory(traj, { delegated, workdir, outDir }, print);
    } else {
      print(paint.dim(`  (no trajectory on disk for ${stageId}-a${a.attempt} — narration skipped)`));
    }

    if (a.resolved_model) {
      // The live path warns on a mismatch and confirms on a match; the manifest
      // records the resolved id, and the pin is the stage's own binding.
      print(paint.dim(`  model pin verified: session resolved '${a.resolved_model}' ` +
        `matches policy pin '${isDelegated(record.binding) ? record.binding.driver : record.binding}'`));
    }
    if (a.delegation_calls != null) {
      const t = attemptTotals([{ worker_usage: a.worker_usage }]);
      print(paint.cyan(`  worker ledger: ${a.delegation_calls} delegation(s) · ` +
        `${a.worker_usage?.calls ?? 0} usage sidecar(s)` +
        (t.toolCalls ? ` · ${t.toolCalls} worker tool call(s)` : "") +
        (t.tokens.total ? ` · ${tokenSplit(t.tokens)}` : "")));
      if (t.tokens.cached) {
        print(paint.dim(`                 of the input, ${fmtInt(t.tokens.fresh)} token(s) were fresh — ` +
          "that is the figure to price at the Vertex input rate"));
      }
    }
    for (const w of a.gate?.warnings ?? []) print(paint.yellow(`  ⚠ ${w}`));
    print(a.gate?.pass
      ? paint.green(`  ✔ gate PASS · wall ${fmtDur(a.wall_seconds)}` +
          (a.cost_usd != null ? ` · driver ${fmtUsd(a.cost_usd)}` : "") +
          (a.num_turns != null ? ` · ${fmtInt(a.num_turns)} driver turn(s)` : ""))
      : paint.red(`  ✘ gate FAIL — ${a.gate?.reason ?? "(reason not recorded)"}`));
  }
}

// ---------------------------------------------------------------------------
// SDLC
// ---------------------------------------------------------------------------

function replaySdlc({ runDir, manifest, audit, only, frames }, print) {
  const outDir = join(runDir, "out");
  const workdir = join(runDir, "workdir");
  const runtimeName = manifest.runtime?.name ?? UNRECOVERABLE;
  const delegated = manifest.stages.some((s) => isDelegated(s.binding));
  const head = manifest.stages.find((s) => isDelegated(s.binding))?.binding ?? null;

  // The two values the manifest does not carry come from the files it PINNED:
  // the task's brief filename and the template's verify-repair budget. Read
  // through the pin so a drifted source is reported, not rendered as truth.
  const taskFile = join(dirname(new URL(import.meta.url).pathname), "tasks", manifest.task_id, "task.json");
  const task = loadPinned(taskFile, null, JSON.parse).data;
  const tpl = loadPinned(manifest.template?.file, manifest.template?.sha256, parseYaml);
  const verifyStage = tpl.data?.stages?.find((s) => s.executor === "verify");
  const repairRounds = verifyStage?.config?.repair?.max_rounds ?? null;
  const executeId = tpl.data?.stages
    ?.find((s) => s.executor === "llm-task" && s.config?.packet === "planned")?.id ?? null;

  print(sdlcHeader({
    taskId: manifest.task_id,
    templateId: manifest.template.id, templateVersion: manifest.template.version,
    scaffoldId: manifest.scaffold.id, scaffoldVersion: manifest.scaffold.version,
    brief: task?.brief ?? UNRECOVERABLE,
    cell: `${manifest.runtime.name} × ${manifest.policy.name}`,
    stageWalk: manifest.stages.map((s) => s.stage),
    retryType: manifest.policy.retry.type, maxAttempts: manifest.policy.retry.max_attempts,
    repairRounds: repairRounds ?? UNRECOVERABLE, executeId: executeId ?? "execute",
    timeoutMin: manifest.policy.limits.phase_timeout_min,
    budgetUsd: manifest.policy.limits.phase_budget_usd,
    // Model-driven stages = llm-task + judge, in template order — the same
    // `agentStages` set the live header lists. verify is script-owned and
    // report is the harness's finish block, so neither carries a binding row.
    stages: manifest.stages
      .filter((s) => s.executor === "llm-task" || s.executor === "judge")
      .map((s) => ({
        id: s.stage, label: labelBinding(s.binding, s.model_id),
        thinking: s.thinking, workerThinking: s.binding?.worker_thinking,
        // Replayed from the manifest binding, so a replay names the region
        // the run really called. Absent on manifests written before
        // 2026-07-31, which the renderer prints as `region unrecorded`.
        workerRegion: s.binding?.worker_region,
      })),
    delegated, driver: head?.driver, worker: head?.worker,
    envImage: manifest.env_image,
    runtime: `${manifest.runtime.name} ${manifest.runtime.version}`,
    startedAt: manifest.started_at,
  }));
  if (tpl.drift) {
    print(paint.yellow(`\n  ! template ${manifest.template.file} no longer matches the sha256 this run ` +
      "pinned — repair-round figure above is TODAY's, not the run's"));
  }

  if (!frames) {
    for (const rec of manifest.stages) {
      if (only && rec.stage !== only) continue;
      print("\n" + rule(`STAGE ${manifest.stages.indexOf(rec) + 1}/${manifest.stages.length} · ` +
        `${rec.stage.toUpperCase()} — ${stageTitle(rec)}`));
      if (rec.executor === "llm-task" || rec.executor === "judge") {
        print(kvBlock([
          ["binding", labelBinding(rec.binding, rec.model_id)],
          ["thinking", String(rec.thinking ?? "n/a")],
        ]));
        replayAttempts({
          stageId: rec.stage, record: rec,
          bindingLabel: labelBinding(rec.binding, rec.model_id),
          cap: manifest.policy.retry.max_attempts, runtimeName,
          delegated: isDelegated(rec.binding), workdir, outDir,
          phasesDir: join(outDir, "phases"),
        }, print);
      } else if (rec.executor === "verify") {
        print(kvBlock([
          ["executor", `verify (script-owned — no model call unless repairs are needed) · method ${rec.method ?? "build-and-test"}`],
          ["result", rec.passed ? "PASS" : "FAIL"],
          ...(rec.integrity ? [["chassis integrity",
            `${rec.integrity.files_checked ?? "?"} file(s) sha256-verified`]] : []),
          ["repairs used", String((rec.attempts ?? []).length)],
        ]));
        replayAttempts({
          stageId: rec.stage, record: rec, bindingLabel: labelBinding(rec.binding, rec.model_id),
          cap: repairRounds ?? (rec.attempts ?? []).length, runtimeName,
          delegated: isDelegated(rec.binding), workdir, outDir,
          phasesDir: join(outDir, "phases"),
        }, print);
      } else {
        print(kvBlock([
          ["executor", "report (script-owned — no model call)"],
          ["note", "emitted by the harness finish block below: diff → audit → manifest → grade"],
        ]));
      }
    }
  }

  print(sdlcFooter({
    taskId: manifest.task_id,
    cell: `${manifest.runtime.name} × ${manifest.policy.name}`,
    failedAt: manifest.failed_at,
    records: manifest.stages,
    totals: manifest.totals,
    audit: { editCount: audit.editCount, flags: audit.flags },
    delegated,
    deliveryCount: manifest.delivery?.files_changed?.length ?? 0,
    judgeScores: manifest.judge_scores ?? null,
    runDir,
    verifyMethod: manifest.stages.find((s) => s.executor === "verify")?.method ?? null,
  }));
}

/** Stage titles for the banner; the manifest records the stage id, not prose. */
function stageTitle(rec) {
  const TITLES = {
    requirements: "turn the brief into numbered, testable requirements",
    design: "choose the shape of the solution and record why",
    "plan-packets": "cut the design into independently buildable work packets",
    execute: "build the packets — the only stage that writes product code",
    verify: "chassis integrity + build + tests, with a bounded repair loop",
    report: "diff → audit → manifest → grade",
  };
  return TITLES[rec.stage] ?? `${rec.executor} stage`;
}

/**
 * Binding label for a manifest record — delegating to the SAME bindingLabel the
 * live run prints, never a lookalike. (An earlier draft here re-wrote the
 * wording by hand and immediately drifted: "driving" instead of "→", the cable
 * dropped. Exactly the failure this tool exists to prevent, one file over.)
 * A script-owned stage has no binding, so its model_id — or "script" — stands in.
 */
function labelBinding(binding, modelId) {
  if (binding == null) return modelId ?? "script";
  return bindingLabel(binding);
}

// ---------------------------------------------------------------------------
// SWE-bench Pro
// ---------------------------------------------------------------------------

const PRO_TITLES = {
  repro: "make the bug fail on demand, inside the sealed container",
  localize: "find the non-test source files that hold the bug (READ-ONLY)",
  patch: "fix it, then prove the repro flips and nothing else regresses",
};

function replaySwepro({ runDir, manifest, audit, only, frames }, print) {
  const outDir = join(runDir, "out");
  const workdir = join(runDir, "workdir");
  const runtimeName = manifest.runtime?.name ?? UNRECOVERABLE;
  const delegated = manifest.phases.some((p) => isDelegated(p.binding));
  const head = manifest.phases.find((p) => isDelegated(p.binding))?.binding ?? null;

  print(sweproHeader({
    instanceId: manifest.instance_id,
    repo: manifest.repo, repoLanguage: manifest.repo_language,
    cell: `${manifest.runtime.name} × ${manifest.policy.name}`,
    retryType: manifest.policy.retry.type, maxAttempts: manifest.policy.retry.max_attempts,
    timeoutMin: manifest.policy.limits.phase_timeout_min,
    budgetUsd: manifest.policy.limits.phase_budget_usd,
    stages: manifest.phases.map((p) => ({
      id: p.phase, label: labelBinding(p.binding, p.model_id),
      thinking: p.thinking, workerThinking: p.binding?.worker_thinking,
      // Same as the SDLC header above: region from the manifest binding.
      workerRegion: p.binding?.worker_region,
    })),
    delegated, driver: head?.driver, worker: head?.worker,
    baseImage: manifest.base_image, sealedImage: manifest.sealed_image,
    runtime: `${manifest.runtime.name} ${manifest.runtime.version}`,
    startedAt: manifest.started_at,
  }));

  if (!frames) {
    for (const rec of manifest.phases) {
      if (only && rec.phase !== only) continue;
      print("\n" + rule(`PHASE ${manifest.phases.indexOf(rec) + 1}/${manifest.phases.length} · ` +
        `${rec.phase.toUpperCase()} — ${PRO_TITLES[rec.phase] ?? "phase"}`));
      print(kvBlock([
        ["binding", labelBinding(rec.binding, rec.model_id)],
        ["thinking", String(rec.thinking ?? "n/a")],
      ]));
      replayAttempts({
        stageId: rec.phase, record: rec,
        bindingLabel: labelBinding(rec.binding, rec.model_id),
        cap: manifest.policy.retry.max_attempts, runtimeName,
        delegated: isDelegated(rec.binding), workdir, outDir,
        phasesDir: join(outDir, "phases"),
      }, print);
    }
  }

  print(sweproFooter({
    instanceId: manifest.instance_id,
    cell: `${manifest.runtime.name} × ${manifest.policy.name}`,
    failedAt: manifest.failed_at,
    records: manifest.phases,
    totals: manifest.totals,
    audit: { editCount: audit.editCount, flags: audit.flags },
    delegated,
    keptCount: manifest.patch?.files_kept?.length ?? 0,
    strippedCount: manifest.patch?.files_stripped?.length ?? 0,
    runDir,
  }));
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Replay a run directory. Exported (not just CLI-invoked) so the unit tests can
 * drive it against the real runs on disk and assert on the rendered text
 * without spawning a process or writing a file.
 */
export function replayRun({ runDir, stage = null, frames = false }, print = console.log) {
  // The 80-column grid is a property of the OUTPUT, not of who happens to be
  // printing it. On the live path that is guaranteed by say(); here the caller
  // supplies the writer (the CLI passes console.log, the test suite passes a
  // collector), so the fit is applied on this side of the boundary instead.
  // fitLine is idempotent — a line already inside the grid comes back
  // byte-identical — so wrapping a writer that already fits costs nothing.
  const emit = (s) => print(fitLine(s));
  const dir = resolve(runDir);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no manifest.json in ${dir} — not a harness-matrix run directory`);
  }
  const manifest = readJson(manifestPath);
  // audit.json is written at the end of a run; a killed run may not have one.
  // Empty-but-shaped beats crashing: the footer's flag rows then read 0, which
  // is what "no audit was produced" honestly renders as.
  const auditPath = join(dir, "audit.json");
  const audit = existsSync(auditPath) ? readJson(auditPath) : { editCount: 0, flags: [] };

  const kind = manifest.kind ?? (manifest.instance_id ? "swepro" : "sdlc");
  if (kind === "sdlc") replaySdlc({ runDir: dir, manifest, audit, only: stage, frames }, emit);
  else replaySwepro({ runDir: dir, manifest, audit, only: stage, frames }, emit);
  return { kind, manifest };
}

/**
 * List the run directories under runs/ — the no-args help is a real index, and
 * the test suite enumerates the same list to replay every run on disk.
 *
 * ABSOLUTE paths on purpose. This used to return `runs/<task>/<cell>/<stamp>`,
 * which only resolves when the caller happens to be cwd-ed into the harness
 * directory — a trap for any programmatic caller. The CLI shortens them again
 * for display; correctness lives here, cosmetics live at the print site.
 */
export function listRuns(harnessDir) {
  const root = join(harnessDir, "runs");
  const out = [];
  if (!existsSync(root)) return out;
  for (const task of readdirSync(root)) {
    const taskDir = join(root, task);
    for (const cell of safeReaddir(taskDir)) {
      for (const stamp of safeReaddir(join(taskDir, cell))) {
        if (existsSync(join(taskDir, cell, stamp, "manifest.json"))) {
          out.push(join(taskDir, cell, stamp));
        }
      }
    }
  }
  return out;
}
const safeReaddir = (p) => { try { return readdirSync(p); } catch { return []; } };

// CLI guard: `node replay-log.mjs …` runs; `import` from a test does not.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const runDir = flag("run-dir");
  const HARNESS_DIR = dirname(new URL(import.meta.url).pathname);
  if (!runDir) {
    sayErr("usage: node replay-log.mjs --run-dir <run> [--stage <id>] [--frames]\n");
    sayErr("runs on disk:");
    for (const r of listRuns(HARNESS_DIR)) sayErr(`  ${relative(HARNESS_DIR, r)}`);
    process.exit(2);
  }
  try {
    replayRun({ runDir, stage: flag("stage"), frames: argv.includes("--frames") });
  } catch (err) {
    sayErr(`replay failed: ${err.message ?? err}`);
    process.exit(1);
  }
}

export { UNRECOVERABLE };
