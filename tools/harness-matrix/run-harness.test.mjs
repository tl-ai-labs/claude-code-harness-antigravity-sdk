/**
 * run-harness.test.mjs — the CLI's argument contract.
 *
 * WHY THIS FILE EXISTS (2026-07-31). Both kinds open a descriptor file as
 * their first act — `instance.json` for SWE-bench Pro, `task.json` for SDLC —
 * and pointing a selector at a directory without one used to produce a raw
 * Node ENOENT stack trace from inside the kind module, exiting 1
 * ("infrastructure error") for what is plainly a usage mistake.
 *
 * It is also the easiest mistake to make on a first run, because the obvious
 * guess is wrong in a defensible way: `examples/swe-bench-pro/` is the Pro
 * workload's documentation and its committed exemplars, while what
 * `--instance-dir` actually wants is a corpus entry the fetch script writes
 * into `studies/swe-pro-corpus/`. A reader who has just cloned the repo and
 * read the README will try the directory the README names.
 *
 * These tests run the REAL CLI as a subprocess, which is the only way to hold
 * an exit code and a stderr message honestly. Everything here is $0 and
 * offline: every case exits during argument validation, before preflight,
 * before Docker, before the dynamic kind import, and before any token spend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HARNESS_DIR, "..", "..");
const POLICY = "tools/harness-matrix/policies/all-gemini-flash-high.yaml";

/** Run the CLI from the repo root and hand back status + stderr. */
const cli = (args) => spawnSync(process.execPath, ["tools/harness-matrix/run-harness.mjs", ...args], {
  cwd: ROOT, encoding: "utf8",
});

test("--instance-dir at a directory with no instance.json is a usage error", () => {
  // examples/swe-bench-pro/ is the exact wrong guess a reader makes, so it is
  // the exact case pinned here rather than a synthetic empty directory.
  const r = cli(["--instance-dir", "examples/swe-bench-pro",
                 "--runtime", "claude-code", "--policy", POLICY, "--dry-run"]);
  assert.equal(r.status, 2, "usage errors exit 2 — nothing was spent — never 1");
  assert.match(r.stderr, /no instance\.json here/);
  // The message has to point at where instances actually come from. Without
  // this the reader knows only that they were wrong, not what to do next.
  assert.match(r.stderr, /studies\/swe-pro-corpus/);
  assert.doesNotMatch(r.stderr, /ENOENT|at Object\.run/, "must not be a raw stack trace");
});

test("--task-dir at a directory with no task.json is a usage error", () => {
  const r = cli(["--task-dir", "examples",
                 "--runtime", "claude-code", "--policy", POLICY, "--dry-run"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no task\.json here/);
  assert.match(r.stderr, /examples\/kudos-wall/, "must name the reference workload");
  assert.doesNotMatch(r.stderr, /ENOENT|at Object\.run/);
});

test("the check fires before the kind module is imported", () => {
  // swepro.mjs statically depends on packages/swe-bench/dist. Validating the
  // selector after the dynamic import would mean a mis-typed --instance-dir
  // first demanded a build the reader has no reason to have done, and would
  // report a missing dist instead of the actual mistake.
  const r = cli(["--instance-dir", "no/such/directory/anywhere",
                 "--runtime", "claude-code", "--policy", POLICY, "--dry-run"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no instance\.json here/);
  assert.doesNotMatch(r.stderr, /swe-bench.*dist|Cannot find module/i);
});

test("a valid workload directory still resolves and dry-runs at $0", () => {
  // The guard above must reject what is wrong without rejecting what is right.
  const r = cli(["--task-dir", "examples/kudos-wall",
                 "--runtime", "claude-code", "--policy", POLICY, "--dry-run"]);
  assert.equal(r.status, 0, `dry run failed:\n${r.stderr.slice(0, 600)}`);
});
