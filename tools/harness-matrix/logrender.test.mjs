// Unit tests for logrender.mjs (the run's two BIG frames) and replay-log.mjs
// (the $0 offline rehearsal that renders them from a finished run on disk).
//
// WHY these get tests, and why they get tested TOGETHER: the frames used to be
// inline console.log(kvBlock([...])) arrays inside each kind runner, so the only
// way to look at the header or the scoreboard was to pay for a live run — and
// any offline rehearsal necessarily RE-IMPLEMENTED them and drifted. The fix
// was to extract both frames into pure functions of a plain descriptor, which
// the live kinds build from in-memory state and replay-log.mjs builds from
// manifest.json. Byte-identity is then a property of the design rather than of
// somebody remembering to copy an edit across. These tests defend exactly that:
//   - the frames render from a descriptor alone (no run, no model, no docker),
//   - everything they emit lands inside the 80-column grid,
//   - the delegated-cell facts a partner team reads off the screen are present,
//   - and replaying the REAL runs on disk reproduces them without throwing.
//
// $0 and offline: pure functions plus read-only reads of runs/ — no model, no
// network, no container. Run with
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test logrender.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sdlcHeader, sdlcFooter, sweproHeader, sweproFooter } from "./logrender.mjs";
import { replayRun, listRuns } from "./replay-log.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const lines = (s) => plain(s).split("\n");
/**
 * Assert every line lands inside the 80-column grid — allowing only the one
 * documented exception: a line whose LONGEST SINGLE TOKEN already overflows at
 * its own indent, so no amount of wrapping could have saved it (an absolute run
 * directory, a docker image tag). Those stay whole on purpose, because a split
 * path stops being copy-pasteable. Any other over-long line is a real defect:
 * a terminal wraps at the window edge with zero indent, so it returns to column
 * 0 and merges with the next line on the screenshare.
 */
const gridClean = (text, label) => {
  for (const l of lines(text)) {
    if (l.length <= 80) continue;
    const indent = l.length - l.trimStart().length;
    const longest = Math.max(...l.trim().split(/\s+/).map((w) => w.length));
    assert.ok(indent + longest > 80,
      `${label}: ${l.length}-column line that COULD have wrapped: ${l}`);
  }
};

// ---- descriptors ------------------------------------------------------------
// Shaped like the real ones, with the values that historically broke layout:
// a long delegated binding label, a cache-heavy token split, an instance id
// that is a single 90-character token.

const delegatedStage = (id) => ({
  id,
  label: "claude-opus-4-6 → gemini-3.5-flash (delegated via Antigravity SDK)",
  thinking: "high",
  // `worker` is what marks the stage delegated for the binding row — the
  // thinking level is a property OF the worker, not evidence one exists (see
  // stageBindingRows). kinds/sdlc.mjs has always passed both; the fixture now
  // does too, so it cannot pass a test the real descriptor would fail.
  worker: "gemini-3.5-flash",
  workerThinking: "HIGH",
});

const workerUsage = {
  available: true, calls: 1,
  sidecars: [{
    model: "gemini-3.5-flash", thinking: "HIGH", region: "asia-south1",
    tool_call_count: 24,
    usage: {
      prompt_token_count: 550298, cached_content_token_count: 479916,
      candidates_token_count: 5614, thoughts_token_count: 5854,
      total_token_count: 561766,
    },
  }],
};

const attempt = {
  attempt: 1, wall_seconds: 207, cost_usd: 0.6408, num_turns: 12,
  delegation_calls: 1, worker_usage: workerUsage,
  gate: { pass: true, warnings: [] },
};

const SDLC = {
  taskId: "uptime-ping", templateId: "sdlc-mini", templateVersion: "0.8.0",
  scaffoldId: "service-web", scaffoldVersion: "0.2.0",
  brief: "brief.md", cell: "claude-code × all-gemini-flash-high",
  stageWalk: ["requirements", "design", "plan-packets", "execute", "verify", "review", "judge", "report"],
  retryType: "flat", maxAttempts: 3, repairRounds: 3, executeId: "execute",
  timeoutMin: 45, budgetUsd: 8,
  stages: ["requirements", "execute", "judge"].map(delegatedStage),
  delegated: true, driver: "claude-opus-4-6", worker: "gemini-3.5-flash",
  envImage: "sdlc-env:node22-pnpm9.12.3",
  runtime: "claude-code 2.1.215 (Claude Code)", startedAt: "2026-07-26T00:36:23.319Z",
  failedAt: null,
  records: [
    { stage: "requirements", executor: "llm-task", passed: true,
      binding: { driver: "claude-opus-4-6", worker: "gemini-3.5-flash" }, attempts: [attempt] },
    { stage: "verify", executor: "verify", passed: true, binding: null, attempts: [] },
    { stage: "report", executor: "report", binding: null, attempts: [] },
  ],
  totals: { wall_seconds: 1207, attempts: 1 },
  audit: { editCount: 0, flags: [{ family: "driver-predelegation-inspection" }] },
  deliveryCount: 5,
  judgeScores: { overall: 9, requirements_fidelity: 10, code_quality: 9, test_quality: 8.5 },
  runDir: "/home/user/runs/uptime-ping/claude-code--all-gemini-flash-high/2026-07-26T00-36-00",
  verifyMethod: "build-and-test",
};

const PRO = {
  instanceId: "instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a",
  repo: "navidrome/navidrome", repoLanguage: "go",
  cell: "claude-code × all-gemini-flash-high",
  retryType: "flat", maxAttempts: 3, timeoutMin: 10, budgetUsd: 5,
  stages: ["repro", "localize", "patch"].map(delegatedStage),
  delegated: true, driver: "claude-opus-4-6", worker: "gemini-3.5-flash",
  baseImage: "jefzda/sweap-images:navidrome.navidrome-navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a",
  sealedImage: "harness-sealed:navidrome",
  runtime: "claude-code 2.1.215 (Claude Code)", startedAt: "2026-07-24T09:32:34.000Z",
  failedAt: null,
  records: [{ phase: "repro", passed: true,
    binding: { driver: "claude-opus-4-6", worker: "gemini-3.5-flash" }, attempts: [attempt] }],
  totals: { wall_seconds: 2001, attempts: 1 },
  audit: { editCount: 0, flags: [] },
  keptCount: 2, strippedCount: 1,
  runDir: "/home/user/runs/instance_navidrome/claude-code--all-gemini-flash-high/2026-07-24T09-32-34",
};

// ---- the frames render from a descriptor alone ------------------------------

test("all four frames render from a plain descriptor — no run, no model, no docker", () => {
  // The property that makes offline rehearsal possible at all: if any frame
  // reached back into live state (a file, a spawn, a clock) it could not be
  // replayed, and demo copy would once again only be reviewable by paying for
  // a run.
  for (const [name, out] of Object.entries({
    sdlcHeader: sdlcHeader(SDLC), sdlcFooter: sdlcFooter(SDLC),
    sweproHeader: sweproHeader(PRO), sweproFooter: sweproFooter(PRO),
  })) {
    assert.ok(out.length > 0, `${name} rendered nothing`);
    gridClean(out, name);
  }
});

test("a header states who drives, who writes, and how that is enforced", () => {
  // The three facts the delegated cell exists to demonstrate. A partner team
  // reads them off the top of the screenshare; if any goes missing the rest of
  // the log is read wrongly.
  for (const out of [plain(sdlcHeader(SDLC)), plain(sweproHeader(PRO))]) {
    assert.match(out, /Claude Code \(claude-opus-4-6\) runs the pipeline/);
    assert.match(out, /gemini-3\.5-flash/);
    assert.match(out, /Antigravity SDK/);
    assert.match(out, /NO edit tools/);
    assert.match(out, /BLOCKED/, "the BLOCKED lines must be explained BEFORE they appear");
  }
});

test("a stage row names BOTH thinking settings and never one bare 'thinking'", () => {
  // There are two, and they belong to different models: the driver's Claude
  // Code effort and the worker's Gemini thinking level. A single unqualified
  // "· thinking high" next to a label that already said "(thinking HIGH)" was
  // read as a contradiction.
  const row = lines(sdlcHeader(SDLC)).find((l) => l.includes("driver effort"));
  assert.ok(row, "no stage binding row carried a driver effort");
  assert.match(plain(sdlcHeader(SDLC)), /driver effort high · worker thinking HIGH/);
});

test("a non-delegated descriptor omits the delegation apparatus entirely", () => {
  // The single-model cells (all-opus) share these frames. Printing "0
  // delegations" or a worker token ledger there would invent a comparison.
  const solo = { ...SDLC, delegated: false, driver: null, worker: null,
    stages: SDLC.stages.map((s) => ({ ...s, label: "claude-opus-4-6",
      worker: null, workerThinking: null })) };
  const head = plain(sdlcHeader(solo));
  const foot = plain(sdlcFooter(solo));
  assert.doesNotMatch(head, /WHAT YOU ARE WATCHING/);
  assert.doesNotMatch(head, /Antigravity/);
  assert.doesNotMatch(foot, /hand-off\(s\) to Gemini/);
  assert.doesNotMatch(foot, /Claude edits/);
  gridClean(head, "solo header");
  gridClean(foot, "solo footer");
});

test("the footer reports cache reads separately from fresh input", () => {
  // 86% of this run's input was cache reads, which bill far below fresh input.
  // An undifferentiated input total is the number a reader multiplies by the
  // Vertex input rate, overstating the worker's cost several-fold.
  const out = plain(sdlcFooter(SDLC));
  assert.match(out, /cache reads\s+479,916/);
  assert.match(out, /fresh input\s+70,382/);
});

test("the footer never renders a lock engagement as an unexplained flag count", () => {
  // In a delegated run nearly every audit flag is the delegate-first lock
  // firing — the control working. Printed as one number it reads as N problems.
  const out = plain(sdlcFooter(SDLC));
  assert.match(out, /lock held\s+1 time\(s\)/);
  assert.match(out, /audit flags\s+0 beyond the lock engagements \(clean\)/);
});

test("a failed run's footer promises no delivery and drops the not-established note", () => {
  const out = plain(sdlcFooter({ ...SDLC, failedAt: "execute" }));
  assert.match(out, /RUN FAILED at EXECUTE/);
  assert.match(out, /none — run failed before delivery/);
  assert.doesNotMatch(out, /NOT ESTABLISHED/);
});

test("a 90-character instance id cannot break the verdict box", () => {
  // The Pro instance id is a single unbreakable token wider than the grid.
  // The box's contract is that it is rectangular and closed; that beats the
  // never-split-a-token rule inside a frame.
  const box = lines(sweproFooter(PRO)).filter((l) => /^[╔║╚]/.test(l));
  assert.ok(box.length >= 3);
  for (const l of box) assert.equal(l.length, 80, `box row is ${l.length} cols: ${l}`);
});

// ---- replay over the REAL runs on disk --------------------------------------

const RUNS = join(HERE, "runs");
const realRuns = existsSync(RUNS) ? listRuns(HERE) : [];

test("listRuns finds the runs on disk (or the suite says why it skipped)", { skip: !realRuns.length && "no runs/ on this machine" }, () => {
  assert.ok(realRuns.length > 0);
  for (const r of realRuns) assert.ok(existsSync(join(r, "manifest.json")), r);
});

for (const runDir of realRuns) {
  const label = runDir.split("/").slice(-3).join("/");
  test(`replay reproduces ${label} inside the grid and without throwing`, () => {
    // The regression this catches is the one source review kept missing: a
    // template literal that renders past 80 columns. Measuring the OUTPUT of a
    // real run is the only thing that has ever caught it.
    const out = [];
    replayRun({ runDir }, (s) => out.push(s));
    const text = plain(out.join("\n"));
    // Structural, not a line count: some runs on disk are old cells with no
    // trajectories to narrate (the agy cell predates trajectory capture), and a
    // threshold tuned to the chatty runs would fail on those for no reason.
    // What EVERY replay must produce is the identity header, at least one
    // attempt banner, and the verdict box.
    assert.match(text, /HARNESS-MATRIX RUN · KIND:/, "no header frame");
    assert.match(text, /^▶ \[/m, "no attempt banner");
    assert.match(text, /RUN (COMPLETE|FAILED)/, "no verdict frame");
    gridClean(text, label);
  });
}

test("replay narrates with the RUN's elapsed times, not the wall clock", { skip: !realRuns.length && "no runs/ on this machine" }, () => {
  // The narrator stamps [+m:ss] by subtracting two clock reads. On a wall clock
  // during replay every stamp collapses to [+0:00] and every hand-off reports
  // 0s — a rehearsal that silently misrepresents the run's pacing, which is the
  // one thing the stamps exist to show. Replay drives the clock from each
  // event's own timestamp instead, so a real run must show real movement.
  const withTrajectories = realRuns.find((r) =>
    existsSync(join(r, "out", "phases")) &&
    readdirSync(join(r, "out", "phases")).some((f) => f.endsWith(".trajectory.jsonl")));
  assert.ok(withTrajectories, "no run on disk has a trajectory to narrate");
  const out = [];
  replayRun({ runDir: withTrajectories }, (s) => out.push(s));
  const stamps = plain(out.join("\n")).match(/\[\+\d+:\d\d\]/g) ?? [];
  assert.ok(stamps.length > 5, `only ${stamps.length} elapsed stamps`);
  assert.ok(new Set(stamps).size > 1, "every stamp identical — the clock was not injected");
});

test("replay of a missing run fails loudly rather than rendering an empty log", () => {
  // A silently-empty rehearsal is worse than an error: it looks like a run that
  // did nothing, and the numbers are what this tool exists to show.
  assert.throws(() => replayRun({ runDir: join(HERE, "runs", "no-such-run") }, () => {}));
});

test("a delegated stage with NO worker thinking still renders as delegated", () => {
  // Regression for 2026-07-26. The binding row used to switch on
  // workerThinking being truthy, so the gemini-2.5-flash tier — which MUST omit
  // worker_thinking, because Vertex rejects thinking_level on that model —
  // rendered as an ordinary non-delegated stage (`· thinking high`, no worker
  // clause). The header a demo viewer reads to learn how the cell is wired
  // would have hidden both the delegation and the worker's actual setting.
  const tiered = { ...SDLC, stages: SDLC.stages.map((s) =>
    s.id === "execute"
      ? { ...s, label: "claude-opus-4-6 → gemini-2.5-flash (delegated via Antigravity SDK)",
          worker: "gemini-2.5-flash", workerThinking: undefined }
      : s) };
  // The row wraps inside the 80-column grid, so collapse whitespace before
  // matching — the assertion is about the row's CONTENT, not where it folds.
  const head = plain(sdlcHeader(tiered)).replace(/\s+/g, " ");
  assert.match(head, /gemini-2\.5-flash \(delegated via Antigravity SDK\) · driver effort high · worker thinking NONE/);
  // …and the untouched 3.5 stages still print their real level, so a tiered
  // header shows the split rather than flattening it.
  assert.match(head, /gemini-3\.5-flash \(delegated via Antigravity SDK\) · driver effort high · worker thinking HIGH/);
});
