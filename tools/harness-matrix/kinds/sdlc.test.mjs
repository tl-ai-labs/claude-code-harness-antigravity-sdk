/**
 * SDLC kind — `--dry-run` contract.
 *
 * Why this file exists: `--dry-run` is the only way to read a column's opening
 * frame WITHOUT paying for the column. That is worth nothing if the dry run
 * prints a frame the paid run never emits. It used to: the dry-run branch had
 * its own ad-hoc `task : / template : / policy :` summary, a second
 * implementation of the header that drifted from the real one silently and for
 * free (nobody diffs a preview against a run they haven't done yet).
 *
 * The fix hoisted ONE descriptor above the dry-run branch, so both paths call
 * logrender.sdlcHeader with the same object. These tests hold that line from
 * the outside — by running the real CLI, not by importing an internal — and
 * pin the parity to a THIRD independent path, replay-log.mjs, which rebuilds
 * the descriptor from a finished run's manifest.json. Live, preview, and
 * replay all agreeing is what makes the preview evidence rather than a mockup.
 *
 * Everything here is $0 and offline: --dry-run exits before preflight, docker,
 * and any token spend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FINISHED_RUN = "runs/uptime-ping/claude-code--all-gemini-flash-high/2026-07-26T00-36-00";

const cli = (args) => execFileSync(process.execPath, args, {
  cwd: HARNESS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
});

const dryRun = (policy) => cli([
  "run-harness.mjs", "--kind", "sdlc", "--task-dir", "../../examples/uptime-ping",
  "--runtime", "claude-code", "--policy", `policies/${policy}`, "--dry-run",
]);

/** The header frame is everything through its last row, `started`. Cutting
 * there rather than at "whatever follows" keeps this comparable across
 * producers: a dry run continues into a rendered prompt, a replay continues
 * into the run's stages, and a live run into the build. Leading whitespace is
 * dropped because the frame is emitted with a blank line ahead of it. */
const headerOf = (out) => {
  const lines = out.trimStart().split("\n");
  const end = lines.findIndex((l) => /^ {2}started {2,}/.test(l));
  assert.ok(end !== -1, `no 'started' row — this is not a header frame:\n${out.slice(0, 400)}`);
  return lines.slice(0, end + 1).join("\n");
};

/** The two rows that are legitimately allowed to differ between a preview and
 * a real run: the driver build is probed at launch, and the start time does
 * not exist until the run starts. Everything above them is a pure function of
 * task + template + scaffold + policy and must match exactly. */
const dropProvenance = (frame) =>
  frame.split("\n").filter((l) => !/^ {2}(runtime|started) {2,}/.test(l)).join("\n");

test("--dry-run opens with the real header frame, not an ad-hoc summary", () => {
  const out = dryRun("all-gemini-flash-high.yaml");
  assert.match(out.trimStart(), /^╔═+╗\n║ HARNESS-MATRIX RUN · KIND: SDLC/,
    "a dry run must open with the same boxed identity frame a paid run opens with");
  assert.match(out, /WHAT YOU ARE WATCHING/);
  assert.match(out, /Lines marked BLOCKED are that lock holding/,
    "the delegation apparatus has to be explained in the preview too — it is the " +
    "part of the frame a reviewer is most likely to want reworded before paying");
  // The old second implementation, gone for good. These exact left-aligned
  // key forms were its signature and appear nowhere in the real frame.
  assert.doesNotMatch(out, /^task {5}: /m);
  assert.doesNotMatch(out, /^policy {3}: /m);
});

test("--dry-run never prints a timestamp that could pass for a real run", () => {
  const out = headerOf(dryRun("all-gemini-flash-high.yaml"));
  assert.match(out, /^ {2}started {2,}— not started \(--dry-run: nothing executed\)$/m,
    "a preview that stamps a plausible ISO time is indistinguishable from a " +
    "captured run in a screenshot — the row has to say it did not run");
  assert.doesNotMatch(out, /started {2,}\d{4}-\d{2}-\d{2}T/);
});

test("--dry-run reports the policy's own models, not the previous column's", () => {
  // The whole point of previewing a cross-generation column: the frame has to
  // change with the policy file, or the preview is confirming the wrong run.
  const gen35 = headerOf(dryRun("all-gemini-flash-high.yaml"));
  const gen25 = headerOf(dryRun("all-gemini-25-flash-high.yaml"));

  assert.match(gen35, /gemini-3\.5-flash/);
  assert.doesNotMatch(gen35, /gemini-2\.5-flash/);
  assert.match(gen25, /gemini-2\.5-flash/);
  assert.doesNotMatch(gen25, /gemini-3\.5-flash/);
  assert.match(gen25, /cell {2,}claude-code × all-gemini-25-flash-high/);

  // The 2.5 column runs its worker at thinking NONE, and NOT by choice: Vertex
  // hard-rejects thinking_level on gemini-2.5-flash, so the policy omits the
  // key (see policies/all-gemini-25-flash-high.yaml for the verbatim 400).
  // This assertion is the honest replacement for the one that used to live
  // here — "identical but for the worker" — which quietly stopped being true
  // on 2026-07-26 and would have let the two columns be reported as a clean
  // single-variable A/B that the platform does not actually permit.
  assert.match(gen25, /worker thinking NONE/);
  assert.doesNotMatch(gen25, /worker thinking HIGH/);
  assert.match(gen35, /worker thinking HIGH/);

  // Identical everywhere ELSE: same task, template, scaffold, stage walk, caps
  // and guard. Normalising the worker AND its thinking level leaves exactly
  // the study-invariant frame, so any third difference still fails here.
  const strip = (s) => s.replace(/gemini-[23]\.5-flash/g, "<worker>")
    .replace(/all-gemini(-25)?-flash-high/g, "<policy>")
    .replace(/worker thinking (HIGH|NONE)/g, "worker thinking <level>");
  assert.equal(strip(gen25), strip(gen35));
});

test("every dry-run line fits the 80-column grid", () => {
  for (const line of dryRun("all-gemini-25-flash-high.yaml").split("\n")) {
    if (line.length <= 80) continue;
    // Only a single unbreakable token (a path, an image tag) may exceed the
    // grid — wrapping one would stop it being copy-pasteable.
    const indent = line.length - line.trimStart().length;
    const longest = Math.max(...line.trim().split(/\s+/).map((w) => w.length));
    assert.ok(indent + longest > 80, `wrappable ${line.length}-column line: ${line}`);
  }
});

test("the preview frame matches what replay rebuilds from a finished run", {
  // runs/ is gitignored — machine-local evidence. Absent on a fresh clone.
  skip: existsSync(join(HARNESS_DIR, FINISHED_RUN)) ? false
    : `no finished run at ${FINISHED_RUN}`,
}, () => {
  const preview = headerOf(dryRun("all-gemini-flash-high.yaml"));
  const replayed = headerOf(cli(["replay-log.mjs", "--run-dir", FINISHED_RUN]));

  // Three producers, one frame: the live run builds the descriptor from
  // in-memory state, the dry run from the same hoisted builder, and replay
  // from manifest.json alone. Byte-identity here is what lets a replayed log
  // be treated as the run's own output rather than a re-narration of it.
  assert.equal(dropProvenance(preview), dropProvenance(replayed));
});
