#!/usr/bin/env node
/**
 * grade-sdlc.mjs — score one SDLC harness-matrix run by RE-RUNNING the
 * scaffold's own build + test in a fresh container invocation, through the
 * run's own run-in-env.sh (same image, same mount, same timeout brake the
 * whole run used).
 *
 * Why re-run when the verify stage already proved green: the same
 * separation Pro has between the run and Scale's evaluator — the verdict a
 * study reports must come from a grading step that executed AFTER the last
 * model call, not from mid-run state a later stage (review/judge are given
 * run-in-env.sh too) could theoretically have disturbed. It is cheap
 * (~1 min, no model), and grade-verdict.json lands next to manifest.json
 * with the same filename the Pro kind uses, so downstream tooling reads
 * both kinds' verdicts identically.
 *
 * `resolved` here means: the delivered service builds and its full test
 * suite (chassis + the model's own module tests) passes. Requirement-level
 * quality is the judge stage's job (manifest.judge_scores) — this file is
 * the mechanical floor under it.
 *
 * Importable (gradeSdlcRun, used by kinds/sdlc.mjs) and runnable standalone:
 *   node tools/harness-matrix/grade-sdlc.mjs \
 *     --run-dir tools/harness-matrix/runs/<task>/<runtime>--<policy>/<stamp>
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Vitest's summary line → {failed, passed, total}, or null when the run
 * printed no summary at all.
 *
 * Counts are EVIDENCE, never the verdict — the exit code decides — so a parse
 * miss must leave them null rather than guess a zero, which would read as "0
 * tests failed" on a suite that never ran. Exported (and tested in
 * grade.test.mjs, which covers BOTH graders) because the only other way to
 * reach it is a ~1-minute Docker round-trip.
 *
 * WHY SEGMENT-WISE, NOT ONE POSITIONAL REGEX (2026-07-27): the previous
 * implementation was a single ordered pattern —
 *   /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/
 * — which assumed `failed` is always immediately followed by `passed`. Vitest
 * does not guarantee that: it emits one `N label` segment per non-empty
 * outcome class, so `skipped` (and `todo`) can sit between them or before
 * them. Two concrete misreads followed from the assumption:
 *   - "Tests  2 failed | 1 skipped | 10 passed (13)" — the optional `failed`
 *     group cannot match (it is followed by "1 skipped", not "N passed"), so
 *     the engine skipped that group entirely and returned failed:0. A run with
 *     two real failures published "0 failed" as evidence: a FALSE GREEN, the
 *     one error class this file's own doctrine says must never happen.
 *   - "Tests  1 skipped | 12 passed (13)" — no match at all, so honest counts
 *     were dropped to null on a perfectly ordinary run.
 * Parsing each labelled segment independently makes the result order-agnostic
 * and immune to unknown future labels. The null-on-miss contract is unchanged:
 * a line with neither a `failed` nor a `passed` segment is still not a summary
 * we understand, and still yields null rather than a guessed zero.
 */
export function parseVitestCounts(out) {
  // The summary line is "Tests <segments> (<total>)". `[^\n(]*?` keeps us on a
  // single line and stops at the first paren, which is always the total.
  const line = String(out ?? "").match(/Tests\s+([^\n(]*?)\s*\((\d+)\)/);
  if (!line) return null;
  const segment = (label) => {
    const hit = line[1].match(new RegExp(`(\\d+)\\s+${label}\\b`));
    return hit ? Number(hit[1]) : null;
  };
  const failed = segment("failed");
  const passed = segment("passed");
  // Neither outcome class present means this is not a shape we recognise —
  // fail closed to null instead of publishing 0/0 out of a line we misread.
  if (failed === null && passed === null) return null;
  return { failed: failed ?? 0, passed: passed ?? 0, total: Number(line[2]) };
}

/**
 * The delivery diff, or "" when the run never produced one.
 *
 * WHY DEFENSIVE (2026-07-26): a run that died mid-implement can leave no
 * model.diff at all. Reading it unguarded threw ENOENT out of the grader, so
 * instead of recording the honest verdict — unresolved, empty delivery — the
 * whole grading step crashed and the run got NO verdict file. A missing diff
 * and an empty diff mean exactly the same thing here, so they are treated the
 * same.
 */
function deliveryDiff(runDir) {
  const p = join(runDir, "model.diff");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function gradeSdlcRun({ runDir }) {
  const runInEnv = join(runDir, "out", "run-in-env.sh");
  const manifestPath = join(runDir, "manifest.json");
  for (const [what, p] of [["run-in-env.sh", runInEnv], ["manifest.json", manifestPath],
    ["workdir", join(runDir, "workdir")]]) {
    if (!existsSync(p)) throw new Error(`grade-sdlc: no ${what} in ${runDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // A run that failed before a delivery exists grades unresolved without a
  // container round-trip — same cheap-and-honest shape as Pro's empty-patch
  // short-circuit.
  if (manifest.failed_at && ["requirements", "design", "plan-packets"].includes(manifest.failed_at)
      || !deliveryDiff(runDir).trim()) {
    const verdict = {
      task_id: manifest.task_id, resolved: false,
      reason: manifest.failed_at ? `run failed at ${manifest.failed_at} — no delivery` : "empty delivery diff",
    };
    writeFileSync(join(runDir, "grade-verdict.json"), JSON.stringify(verdict, null, 2));
    console.log(`${manifest.task_id}: unresolved (${verdict.reason} — grader not invoked)`);
    return verdict;
  }

  const runStep = (cmd, log) => {
    const r = spawnSync(runInEnv, [cmd], {
      encoding: "utf8",
      timeout: 15 * 60 * 1000, // host backstop; the in-container timeout is the real brake
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    writeFileSync(join(runDir, "out", log), out);
    return { exitCode: r.status ?? 1, out };
  };

  console.log(`grading ${manifest.task_id}: re-running scaffold build + test in ${manifest.env_image}…`);
  const build = runStep("pnpm build", "grade-build.log");
  let test = null, counts = null;
  if (build.exitCode === 0) {
    test = runStep("pnpm test", "grade-test.log");
    counts = parseVitestCounts(test.out);
  }

  const resolved = build.exitCode === 0 && test?.exitCode === 0;
  const verdict = {
    task_id: manifest.task_id,
    resolved,
    build: { exit_code: build.exitCode },
    tests: test ? { exit_code: test.exitCode, ...(counts ?? {}) } : { skipped: "build failed" },
    judge_scores: manifest.judge_scores ?? null,
    grader: `scaffold build+test re-run via run-in-env.sh (${manifest.env_image})`,
  };
  writeFileSync(join(runDir, "grade-verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(`\n=== VERDICT: ${manifest.task_id} → ${resolved ? "RESOLVED" : "unresolved"}` +
    (counts ? ` (${counts.passed}/${counts.total} tests)` : "") + " ===");
  return verdict;
}

// Standalone CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--run-dir");
  const runDir = i >= 0 ? resolve(args[i + 1]) : null;
  if (!runDir) {
    console.error("usage: grade-sdlc.mjs --run-dir <run dir with manifest.json + workdir>");
    process.exit(2);
  }
  gradeSdlcRun({ runDir });
}
