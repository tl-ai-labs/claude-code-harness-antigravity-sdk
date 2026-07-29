/**
 * Tests for the two graders — grade.mjs (SWE-bench Pro, Scale's official
 * evaluator in Docker) and grade-sdlc.mjs (scaffold build + test re-run).
 *
 * WHAT IS AND ISN'T COVERED. The Docker leg of both graders is deliberately
 * out of scope: it costs ~6-7 minutes per instance under Rosetta and needs the
 * frozen Scale images, so a unit test cannot run it and shouldn't pretend to.
 * What IS covered is everything that decides whether the grader runs at all —
 * the preconditions, the short-circuits, and the summary parsing. Those are the
 * paths a broken run actually takes, and every one of them has to produce an
 * honest verdict file rather than an exception, because a run with no
 * grade-verdict.json is a run the exporter reports as ungraded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gradeRun } from "./grade.mjs";
import { gradeSdlcRun, parseVitestCounts } from "./grade-sdlc.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "grade-test-"));

/** A Pro run directory + its corpus instance directory. */
function proFixture({ diff = "", sealed = true } = {}) {
  const root = tmp();
  const runDir = join(root, "run");
  const instanceDir = join(root, "instance");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(instanceDir, { recursive: true });
  writeFileSync(join(runDir, "model.diff"), diff);
  writeFileSync(join(instanceDir, "instance.json"),
    JSON.stringify({ instance_id: "instance_navidrome__navidrome-1234" }));
  if (sealed) {
    writeFileSync(join(instanceDir, "sealed.json"),
      JSON.stringify({ _WARNING: "sealed", patch: "gold", fail_to_pass: "[]" }));
  }
  return { runDir, instanceDir };
}

/** An SDLC run directory shaped the way kinds/sdlc.mjs leaves one. */
function sdlcFixture({ manifest = {}, diff = "x", withDiff = true } = {}) {
  const runDir = tmp();
  mkdirSync(join(runDir, "out"), { recursive: true });
  mkdirSync(join(runDir, "workdir"), { recursive: true });
  writeFileSync(join(runDir, "out", "run-in-env.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(runDir, "manifest.json"),
    JSON.stringify({ task_id: "leave-requests-mini", env_image: "img:tag", ...manifest }));
  if (withDiff) writeFileSync(join(runDir, "model.diff"), diff);
  return runDir;
}

// ── grade.mjs (SWE-bench Pro) ───────────────────────────────────────────────

test("Pro: an empty patch is graded unresolved WITHOUT a Docker round-trip", () => {
  // The cheap-and-honest short-circuit. An empty diff cannot resolve anything,
  // so spending 6-7 minutes proving it would only make failures expensive.
  const { runDir, instanceDir } = proFixture({ diff: "   \n" });
  const v = gradeRun({ runDir, instanceDir });
  assert.equal(v.resolved, false);
  assert.equal(v.reason, "empty patch");
  assert.equal(v.instance_id, "instance_navidrome__navidrome-1234");
  // The verdict file is the artifact downstream tooling reads — not the return.
  const onDisk = JSON.parse(readFileSync(join(runDir, "grade-verdict.json"), "utf8"));
  assert.deepEqual(onDisk, v);
});

test("Pro: refuses to grade a run with no model.diff, naming the directory", () => {
  // Silently grading "unresolved" here would be a lie: no patch was ever
  // submitted, which is a harness failure, not a model failure.
  const { runDir, instanceDir } = proFixture();
  const noDiff = tmp();
  assert.throws(() => gradeRun({ runDir: noDiff, instanceDir }), /no model\.diff/);
  assert.ok(runDir);
});

test("Pro: refuses to grade without sealed.json — the grader owns the gold data", () => {
  // Sealed fields are FORBIDDEN near the runtime and REQUIRED here. Missing
  // them means the corpus instance is incomplete, not that the patch failed.
  const { runDir, instanceDir } = proFixture({ diff: "diff --git a b", sealed: false });
  assert.throws(() => gradeRun({ runDir, instanceDir }), /no sealed\.json/);
});

// ── grade-sdlc.mjs (scaffold build + test) ──────────────────────────────────

test("SDLC: a run that died before any delivery grades unresolved, no container", () => {
  const runDir = sdlcFixture({ manifest: { failed_at: "design" } });
  const v = gradeSdlcRun({ runDir });
  assert.equal(v.resolved, false);
  assert.equal(v.reason, "run failed at design — no delivery");
  assert.equal(v.task_id, "leave-requests-mini");
});

test("SDLC: an empty delivery diff grades unresolved", () => {
  const runDir = sdlcFixture({ diff: "  \n" });
  assert.equal(gradeSdlcRun({ runDir }).reason, "empty delivery diff");
});

test("SDLC: a MISSING model.diff is an empty delivery, not a crash", () => {
  // The 2026-07-26 fix. A run that died mid-implement can leave no model.diff
  // at all; reading it unguarded threw ENOENT out of the grader, so the run
  // ended up with NO verdict file — which the exporter reports as ungraded
  // rather than as the failure it was.
  const runDir = sdlcFixture({ withDiff: false });
  const v = gradeSdlcRun({ runDir });
  assert.equal(v.resolved, false);
  assert.equal(v.reason, "empty delivery diff");
  assert.ok(readFileSync(join(runDir, "grade-verdict.json"), "utf8"));

  // And when the manifest DOES say where it died, the verdict names the stage
  // instead of the generic message — the stage is the useful fact.
  const named = sdlcFixture({ withDiff: false, manifest: { failed_at: "implement" } });
  assert.equal(gradeSdlcRun({ runDir: named }).reason, "run failed at implement — no delivery");
});

test("SDLC: refuses to grade a run missing run-in-env.sh, manifest or workdir", () => {
  // Each required piece removed in turn — the error must NAME the missing one,
  // because "grading failed" on its own sends you reading container logs for a
  // problem that is a missing file on the host.
  for (const [missing, path] of [
    ["run-in-env.sh", join("out", "run-in-env.sh")],
    ["manifest.json", "manifest.json"],
    ["workdir", "workdir"],
  ]) {
    const runDir = sdlcFixture();
    rmSync(join(runDir, path), { recursive: true, force: true });
    assert.throws(() => gradeSdlcRun({ runDir }), new RegExp(`grade-sdlc: no ${missing.replace(".", "\\.")}`));
  }
});

test("SDLC: parses a vitest summary with and without failures", () => {
  assert.deepEqual(parseVitestCounts("Tests  11 passed (11)"), { failed: 0, passed: 11, total: 11 });
  assert.deepEqual(parseVitestCounts("Tests  2 failed | 9 passed (11)"), { failed: 2, passed: 9, total: 11 });
});

test("SDLC: reads outcome segments in any order, so skipped can't fake a green", () => {
  // REGRESSION (2026-07-27). The parser used to be one ordered pattern that
  // assumed `failed` is immediately followed by `passed`. Vitest emits one
  // segment per non-empty outcome class, so `skipped`/`todo` can sit anywhere
  // between them, and the old pattern silently dropped the failure count to
  // zero — publishing a FALSE GREEN as run evidence. These are the exact
  // shapes that misread.
  assert.deepEqual(parseVitestCounts("Tests  2 failed | 1 skipped | 10 passed (13)"),
    { failed: 2, passed: 10, total: 13 });
  // Previously returned null outright, throwing away honest counts.
  assert.deepEqual(parseVitestCounts("Tests  1 skipped | 12 passed (13)"),
    { failed: 0, passed: 12, total: 13 });
  // A label we have never seen must not disturb the two we care about.
  assert.deepEqual(parseVitestCounts("Tests  2 failed | 11 passed | 1 todo (14)"),
    { failed: 2, passed: 11, total: 14 });
  // Every test failed, so vitest prints no `passed` segment at all.
  assert.deepEqual(parseVitestCounts("Tests  3 failed (3)"), { failed: 3, passed: 0, total: 3 });
});

test("SDLC: a summary with neither failed nor passed stays NULL", () => {
  // An all-skipped suite is a shape we cannot honestly reduce to pass/fail
  // counts, so it fails closed to null exactly like an unparseable line. The
  // exit code still decides `resolved`; only the evidence numbers go absent,
  // which the dashboard renders as "—" rather than as a measured zero.
  assert.equal(parseVitestCounts("Tests  4 skipped (4)"), null);
});

test("SDLC: an unparseable summary leaves counts NULL, never a zero", () => {
  // A zero here would print "0 tests failed" over a suite that never ran —
  // the exact absent-vs-measured collapse the dashboard forbids.
  assert.equal(parseVitestCounts("no summary printed"), null);
  assert.equal(parseVitestCounts(""), null);
  assert.equal(parseVitestCounts(undefined), null);
});

test("SDLC: finds the summary inside a full test log", () => {
  const log = [
    " RUN  v2.1.9 /work",
    " ✓ test/a.test.ts (9 tests) 12ms",
    " ❯ test/b.test.ts (2 tests | 2 failed)",
    "",
    " Test Files  1 failed | 1 passed (2)",
    "      Tests  2 failed | 9 passed (11)",
  ].join("\n");
  assert.deepEqual(parseVitestCounts(log), { failed: 2, passed: 9, total: 11 });
});
