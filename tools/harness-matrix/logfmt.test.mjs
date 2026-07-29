// Unit tests for logfmt.mjs — the formatting layer every harness run prints
// and every demo recording shows on screen.
//
// WHY these functions get tests at all: attemptTotals() is the only place the
// harness rolls raw attempt records up into the numbers a human reads (wall,
// driver cost, driver turns, delegation count, worker token split). It is
// deliberately NULL-HONEST — a killed CLI that reported no cost must surface
// as "n/a", never as "$0.0000", because a fake zero reads as "this cell was
// free" in a comparison table. That distinction is invisible to typechecking
// and survives only if a test asserts it, so it is asserted here.
//
// $0 and offline: pure functions, no model, no docker, no network — run with
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test logfmt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtInt, fmtUsd, fmtDur, table, kvBlock, heavyBox, attemptTotals, tokenSplit,
  cachePct, tokenLedgerRows, costRows, gutter, ACTOR, fitLine, rule }
  from "./logfmt.mjs";

// ANSI codes are emitted unconditionally by paint(); strip them so assertions
// describe the TEXT a reader sees rather than the escape sequences around it.
const plain = (s) => s.replace(/\[[0-9;]*m/g, "");

// paint() resolves color ONCE at import, and `node --test` is not a TTY — so
// paint.* is the identity function in here. Colored fixtures are built by hand
// instead: the escapes under test have to be real wherever the suite runs, and
// a fixture that silently lost its color would turn the color assertions below
// into assertions about nothing.
const ansi = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;

// ---- scalar formatters: the null contract -----------------------------------

test("null and undefined format as 'n/a', never as a zero", () => {
  for (const f of [fmtInt, fmtUsd, fmtDur]) {
    assert.equal(f(null), "n/a", `${f.name}(null)`);
    assert.equal(f(undefined), "n/a", `${f.name}(undefined)`);
  }
});

test("a real zero still formats as a zero", () => {
  // The mirror of the test above, and the reason it matters: 0 is a legitimate
  // measurement (a phase that cost nothing because it never called a model),
  // and it must stay distinguishable from "we do not know".
  assert.equal(fmtInt(0), "0");
  assert.equal(fmtUsd(0), "$0.0000");
  assert.equal(fmtDur(0), "0s");
});

test("fmtInt groups thousands", () => {
  assert.equal(fmtInt(12345), "12,345");
  assert.equal(fmtInt(999), "999");
  assert.equal(fmtInt(1000000), "1,000,000");
});

test("fmtUsd always shows four decimals", () => {
  // Four, not two: driver costs land in the $0.0001–$0.001 range often enough
  // that two decimals would round a real cost to $0.00.
  assert.equal(fmtUsd(1.6817), "$1.6817");
  assert.equal(fmtUsd(0.00012), "$0.0001");
  assert.equal(fmtUsd(12), "$12.0000");
});

test("fmtDur switches to m/s past a minute and zero-pads the seconds", () => {
  assert.equal(fmtDur(47), "47s");
  assert.equal(fmtDur(59.4), "59s");        // rounds before deciding
  assert.equal(fmtDur(60), "1m00s");        // boundary
  assert.equal(fmtDur(723), "12m03s");      // the pad is what makes it scannable
  assert.equal(fmtDur(2001), "33m21s");     // a real Pro run's wall time
});

// ---- attemptTotals: the roll-up the whole ledger depends on -----------------

const sidecar = (prompt, out, thinking, total) => ({
  model: "gemini-3.5-flash", thinking: "HIGH",
  usage: {
    prompt_token_count: prompt, candidates_token_count: out,
    thoughts_token_count: thinking, total_token_count: total,
  },
});

test("attemptTotals sums wall, cost, turns, delegations and worker tokens", () => {
  const t = attemptTotals([
    { wall_seconds: 350, cost_usd: 0.5, num_turns: 13, delegation_calls: 3,
      worker_usage: { available: true, calls: 2, sidecars: [sidecar(100, 20, 5, 125)] } },
    { wall_seconds: 651, cost_usd: 1.1817, num_turns: 9, delegation_calls: 1,
      worker_usage: { available: true, calls: 1, sidecars: [sidecar(200, 30, 0, 230)] } },
  ]);
  assert.equal(t.attempts, 2);
  assert.equal(t.wall, 1001);
  assert.equal(t.usd.toFixed(4), "1.6817");
  assert.equal(t.turns, 22);
  assert.equal(t.delegations, 4);
  assert.equal(t.sidecars, 2);
  assert.deepEqual(t.tokens,
    { prompt: 300, cached: 0, fresh: 300, output: 50, thinking: 5, total: 355 });
});

test("attemptTotals rolls up cached input and derives the fresh remainder", () => {
  // The 2026-07-26 finding: gemini_worker.py has always recorded
  // cached_content_token_count and the display layer always discarded it. On
  // the first delegated SDLC run 86% of input tokens were cache reads, which
  // bill far below fresh input — pricing the undifferentiated `prompt` figure
  // overstates the worker's cost several-fold.
  const t = attemptTotals([
    { wall_seconds: 10, worker_usage: { available: true, calls: 1, sidecars: [
      { tool_call_count: 24, usage: {
        prompt_token_count: 550298, cached_content_token_count: 479916,
        candidates_token_count: 5614, thoughts_token_count: 5854,
        total_token_count: 561766 } },
    ] } },
  ]);
  assert.equal(t.tokens.prompt, 550298);
  assert.equal(t.tokens.cached, 479916);
  assert.equal(t.tokens.fresh, 70382, "fresh = prompt - cached, the figure to price");
  assert.equal(t.toolCalls, 24, "one delegation is a whole agentic session, not one call");
  assert.equal(cachePct(t.tokens), 87);
});

test("a sidecar predating cache/tool-call capture degrades to the old behaviour", () => {
  // Older runs (before 2026-07-26) have neither field. Absent must read as
  // zero cached — which collapses `fresh` back to `prompt`, i.e. the
  // pre-cache-awareness figure, never a fabricated discount.
  const t = attemptTotals([
    { wall_seconds: 10, worker_usage: { available: true, calls: 1, sidecars: [sidecar(100, 20, 5, 125)] } },
  ]);
  assert.equal(t.tokens.cached, 0);
  assert.equal(t.tokens.fresh, 100, "no cache field must not invent a discount");
  assert.equal(t.toolCalls, 0);
  assert.equal(cachePct(t.tokens), 0);
});

test("cachePct is null when there was no input at all, not NaN", () => {
  assert.equal(cachePct({ prompt: 0, cached: 0 }), null);
  assert.equal(cachePct(null), null);
});

test("an attempt that reported no cost leaves the total null, not zero", () => {
  // The killed-CLI case. A timed-out attempt has wall time but no usage line,
  // so cost and turns are unknown. Summing them as 0 would let a cell that
  // burned 45 minutes render as free.
  const t = attemptTotals([{ wall_seconds: 2700, timed_out: true }]);
  assert.equal(t.wall, 2700);
  assert.equal(t.usd, null, "cost must stay unknown");
  assert.equal(t.turns, null, "turns must stay unknown");
  assert.equal(fmtUsd(t.usd), "n/a");
});

test("one reporting attempt among several makes the total known, not partial-null", () => {
  // Mixed case: attempt 1 timed out silently, attempt 2 reported. The total is
  // then a real (if incomplete) figure, and must not be poisoned back to null.
  const t = attemptTotals([
    { wall_seconds: 600, timed_out: true },
    { wall_seconds: 120, cost_usd: 0.25, num_turns: 4 },
  ]);
  assert.equal(t.wall, 720);
  assert.equal(t.usd, 0.25);
  assert.equal(t.turns, 4);
});

test("attemptTotals on no attempts is all-zero-and-null, and does not throw", () => {
  const t = attemptTotals();
  assert.equal(t.attempts, 0);
  assert.equal(t.wall, 0);
  assert.equal(t.usd, null);
  assert.equal(t.delegations, 0);
  assert.equal(t.toolCalls, 0);
  assert.deepEqual(t.tokens, { prompt: 0, cached: 0, fresh: 0, output: 0, thinking: 0, total: 0 });
});

test("a delegation that produced no sidecar still counts as a delegation", () => {
  // delegation_calls comes from the guard hook; sidecars come from the worker
  // process. A worker that died before writing usage must not erase the fact
  // that the driver DID delegate — the zero-delegation gate reads this count.
  const t = attemptTotals([
    { wall_seconds: 30, delegation_calls: 2, worker_usage: { available: false, sidecars: [] } },
  ]);
  assert.equal(t.delegations, 2);
  assert.equal(t.sidecars, 0);
  assert.equal(t.tokens.total, 0);
});

// ---- tokenSplit -------------------------------------------------------------

test("tokenSplit omits the thinking clause when there is no thinking", () => {
  assert.equal(
    tokenSplit({ prompt: 12003, cached: 0, output: 30110, thinking: 0, total: 45120 }),
    "45,120 tok · in 12,003 · out 30,110");
});

test("tokenSplit shows the thinking clause when the worker thought", () => {
  assert.equal(
    tokenSplit({ prompt: 12003, cached: 0, output: 30110, thinking: 3007, total: 45120 }),
    "45,120 tok · in 12,003 · out 30,110 · think 3,007");
});

test("tokenSplit carries the cache share alongside the input figure", () => {
  // Input and its cache share are only meaningful together: the whole point
  // of printing them is that a reader should not price the input figure flat.
  assert.equal(
    tokenSplit({ prompt: 550298, cached: 479916, output: 5614, thinking: 5854, total: 561766 }),
    "561,766 tok · in 550,298 (87% cached) · out 5,614 · think 5,854");
});

test("tokenSplit stays inside an 80-column terminal at run-total magnitudes", () => {
  // These lines are read on a screenshared terminal; a wrap turns the run's
  // headline cost evidence into pulp. Guards the real 2026-07-26 totals.
  const line = tokenSplit(
    { prompt: 1634042, cached: 1409518, output: 27735, thinking: 29966, total: 1691743 });
  assert.ok(line.length <= 80, `token line must not wrap at 80 cols (was ${line.length}): ${line}`);
});

// ---- tokenLedgerRows / costRows ---------------------------------------------

test("tokenLedgerRows separates cache reads from the fresh input to be priced", () => {
  const rows = tokenLedgerRows(
    { prompt: 550298, cached: 479916, fresh: 70382, output: 5614, thinking: 5854, total: 561766 });
  const flat = rows.map(([k, v]) => `${k} ${v}`).join("\n");
  assert.match(flat, /cache reads.*479,916.*87%/);
  assert.match(flat, /fresh input.*70,382/);
  assert.match(flat, /price at the input rate/,
    "the reader must be told which figure a cost model multiplies");
});

test("tokenLedgerRows is empty when nothing was delegated", () => {
  assert.deepEqual(tokenLedgerRows({ total: 0 }), []);
  assert.deepEqual(tokenLedgerRows(null), []);
});

test("costRows says plainly that the Max seat issues no invoice", () => {
  const rows = costRows(
    { usd: 3.4241, tokens: { fresh: 224524, cached: 1409518, output: 27735 } },
    { delegated: true, workerModel: "gemini-3.5-flash", region: "asia-south1" });
  const flat = rows.map(([k, v]) => `${k} ${v}`).join("\n");
  assert.match(flat, /\$3\.4241/);
  assert.match(flat, /no invoice/, "the 'is that real money' question must be pre-answered");
  assert.match(flat, /224,524 fresh/);
  assert.match(flat, /asia-south1/);
  // No fabricated worker dollar figure: the rate pin is verified per-run.
  assert.match(flat, /rate pin/);
});

test("costRows on an undelegated run mentions no worker economy at all", () => {
  const rows = costRows({ usd: 1.8298, tokens: {} }, { delegated: false });
  assert.equal(rows.length, 1);
  assert.match(rows[0][1], /no invoice/);
});

// ---- actor gutter -----------------------------------------------------------

test("gutter tags are fixed width so the clock column stays aligned", () => {
  const tags = [ACTOR.driver, ACTOR.worker, ACTOR.handoff, ACTOR.script]
    .map((t) => gutter(t, true));
  assert.equal(new Set(tags.map((t) => t.length)).size, 1,
    "every gutter must be the same width or the timestamps stagger");
});

test("a non-delegated run gets plain indent — one actor needs no column", () => {
  assert.equal(gutter(ACTOR.driver, false), "  ");
  assert.notEqual(gutter(ACTOR.driver, true), "  ");
});

test("tokenSplit collapses to a bare 0 when nothing was measured", () => {
  // Not "n/a": zero worker tokens is a real state (an undelegated cell), and
  // the surrounding line already says whether delegation was expected.
  assert.equal(tokenSplit(null), "0");
  assert.equal(tokenSplit(undefined), "0");
  assert.equal(tokenSplit({ prompt: 0, output: 0, thinking: 0, total: 0 }), "0");
});

// ---- table / kvBlock / heavyBox: layout invariants --------------------------

test("table right-aligns the columns marked 'r' and left-aligns the rest", () => {
  const rendered = plain(table(
    ["PHASE", "WALL"],
    [["repro", "5m50s"], ["localize", "47s"]],
    ["l", "r"],
  )).split("\n");
  const [header, , row1, row2] = rendered;
  // The header is padded to the widest CELL, not to its own width — "PHASE"
  // stretches to fit "localize" below it, which is what keeps the columns true.
  assert.equal(header.indexOf("WALL") + "WALL".length, row1.length,
    `header's right-aligned column must end where the rows do: ${JSON.stringify(header)}`);
  assert.ok(row1.endsWith("5m50s"), row1);
  assert.ok(row2.endsWith("   47s"), `short value padded left: ${JSON.stringify(row2)}`);
  assert.match(row1, /^ {2}repro {4}/, "left column padded right");
});

test("every table row is the same width, so the ledger is a rectangle", () => {
  const lines = plain(table(
    ["A", "LONGHEADER"],
    [["x", "1"], ["averyverylongcell", "22"]],
    ["l", "r"],
  )).split("\n");
  const widths = new Set(lines.map((l) => l.length));
  assert.equal(widths.size, 1, `ragged table: ${[...widths].join(",")}`);
});

test("table survives non-string cells", () => {
  // Rows come straight from manifest numbers; String() coercion is the contract.
  const out = plain(table(["N"], [[42], [0]], ["r"]));
  assert.match(out, /42/);
  assert.match(out, /0/);
});

test("kvBlock aligns values on the widest label", () => {
  const lines = plain(kvBlock([["runtime", "claude-code"], ["policy", "all-opus"]])).split("\n");
  const col = lines.map((l) => l.indexOf("claude-code") >= 0 ? l.indexOf("claude-code") : l.indexOf("all-opus"));
  assert.equal(new Set(col).size, 1, `values not aligned: ${col.join(",")}`);
});

test("heavyBox is rectangular and stays closed on every row", () => {
  const lines = plain(heavyBox(["short", "a considerably longer line"])).split("\n");
  const widths = new Set(lines.map((l) => l.length));
  assert.equal(widths.size, 1, "box is not rectangular");
  assert.ok(lines[0].startsWith("╔") && lines[0].endsWith("╗"));
  assert.ok(lines.at(-1).startsWith("╚") && lines.at(-1).endsWith("╝"));
  for (const l of lines.slice(1, -1)) assert.ok(l.startsWith("║") && l.endsWith("║"), l);
});

// ---- the 80-column grid -----------------------------------------------------
// Every assertion below exists because the corresponding failure was FOUND, on
// 2026-07-26, by replaying a finished run through replay-log.mjs and measuring
// the output — 87 of 352 lines ran past the grid. Source review had passed
// these same functions repeatedly; only measurement caught them.

test("a line inside the grid is returned byte-identical", () => {
  // The load-bearing property: fitLine is applied to EVERY write, including
  // pre-formatted boxes, rules and tables. If it touched short lines at all it
  // could break output that was already correct.
  for (const s of ["", "  ok", "─".repeat(80), "x".repeat(80), "a b c\n  d e"]) {
    assert.equal(fitLine(s), s, JSON.stringify(s));
  }
});

test("an over-long line wraps, and every fragment lands inside the grid", () => {
  const out = fitLine("  " + "word ".repeat(40).trim()).split("\n");
  assert.ok(out.length > 1, "did not wrap");
  for (const l of out) assert.ok(l.length <= 80, `${l.length} cols: ${l}`);
});

test("wrapped continuations are indented past the actor gutter", () => {
  // The gutter column identifies WHO acted ([C] driver, [G] worker, [C→G] the
  // hand-off). A continuation that started at column 0 would put prose in that
  // column and make a wrapped worker line look like a new driver line.
  const out = fitLine("[C→G] " + "narration ".repeat(15).trim()).split("\n");
  assert.ok(out.length > 1);
  assert.match(out[0], /^\[C→G\] narration/);
  for (const l of out.slice(1)) {
    assert.match(l, /^ {8}\S/, `continuation not hanging under the gutter: ${JSON.stringify(l)}`);
  }
});

test("fitLine never breaks a single over-long token", () => {
  // A split path stops being copy-pasteable, which is the whole point of
  // printing it. One over-long line is the deliberate, documented exception.
  const path = "/home/user/" + "segment/".repeat(20) + "manifest.json";
  assert.equal(fitLine("  run dir  " + path).split("\n").at(-1).trim(), path);
});

test("fitLine preserves whole-phrase color, including nested painters", () => {
  const long = "delegated ".repeat(15).trim();
  for (const painted of [ansi("2")(long), ansi("1")(ansi("35")(long))]) {
    const out = fitLine(painted).split("\n");
    assert.ok(out.length > 1, "did not wrap");
    for (const l of out) {
      assert.match(l, /\x1b\[[0-9;]*m/, "fragment lost its color");
      assert.match(l, /\x1b\[0m$/, "fragment left an escape unclosed");
    }
  }
});

test("fitLine leaves a line with INTERIOR color alone rather than corrupting it", () => {
  // Losing the grid on a rare line beats emitting a half-closed escape.
  const mixed = "  label " + ansi("31")("BAD") + " " + "tail ".repeat(20).trim();
  assert.equal(fitLine(mixed), mixed);
});

test("fitLine is stable across repeated calls on painted input", () => {
  // Regression guard for the /g-regex lastIndex trap: a /g regex reused across
  // .test() calls carries lastIndex and answers differently on alternate calls,
  // which would show up as randomly-unwrapped lines rather than a hard failure.
  const s = ansi("2")("token ".repeat(25).trim());
  assert.equal(fitLine(s), fitLine(s));
  assert.equal(fitLine(s), fitLine(s));
});

test("heavyBox clamps to the grid instead of growing past it", () => {
  // Found on SWE-bench Pro: a 90-character instance id in the verdict box made
  // a 112-column box, so the loudest frame in the log wrapped its own border.
  const lines = plain(heavyBox(["VERDICT · " + "instance_navidrome__navidrome-".repeat(3)])).split("\n");
  for (const l of lines) assert.equal(l.length, 80, `${l.length} cols: ${l}`);
  assert.ok(lines.length > 3, "long content should wrap onto extra rows");
});

test("rule() is exactly 80 columns, labeled or not", () => {
  // The labeled form was 81 for its whole life — one past the grid, which a
  // terminal answers by dropping a lone "────" onto the next line.
  assert.equal(plain(rule()).length, 80);
  for (const label of ["STAGE 1/8 · REQUIREMENTS", "x", "STAGE 1/8 · " + "y".repeat(200)]) {
    assert.equal(plain(rule(label)).length, 80, `label ${label.length} chars`);
  }
});
