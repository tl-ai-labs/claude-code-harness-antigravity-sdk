// Unit tests for benchmark-brief.mjs — the generator behind every benchmark
// study's Project Brief on the dashboard.
//
// WHY this file has tests: the generator's central design claim is written in
// its own source as "ONE outline, walked identically by both tracks. A track
// fills paragraphs; it can never add, drop or reorder a section." That claim is
// what makes the console brief and the harness brief the SAME document rather
// than two documents that merely resemble each other — and it is exactly the
// kind of claim that decays silently, because adding a track-specific section
// still renders perfectly well. So the outline is asserted, not trusted.
//
// The second claim tested here is that the brief is "free of ids/counts/seeds/
// dates/dollars by construction". Those are the facts that go stale the moment
// a new run lands; a brief that hardcoded one would quietly start lying.
//
// $0 and offline: a pure string builder — no model, no network — run with
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test tools/lib/benchmark-brief.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { benchmarkBrief } from "./benchmark-brief.mjs";

const HARNESS = { driver: "Claude Code", sdk: "Antigravity SDK" };
const sections = (md) => md.split("\n").filter((l) => l.startsWith("## "));

// Every legal combination, so a new dataset or track cannot be added without
// this list being extended deliberately.
const ALL = [
  { name: "verified · console", args: { dataset: "verified", track: "console" } },
  { name: "verified · harness single-seat", args: { dataset: "verified", track: "harness", driver: HARNESS.driver } },
  { name: "verified · harness delegated", args: { dataset: "verified", track: "harness", delegated: true, ...HARNESS } },
  { name: "pro · console", args: { dataset: "pro", track: "console" } },
  { name: "pro · harness single-seat", args: { dataset: "pro", track: "harness", driver: HARNESS.driver } },
  { name: "pro · harness delegated", args: { dataset: "pro", track: "harness", delegated: true, ...HARNESS } },
];

// ---- the outline invariant --------------------------------------------------

test("within a dataset, every track walks the identical section outline", () => {
  // This is the source's own claim: a TRACK fills paragraphs, it can never add,
  // drop or reorder a section. (Across datasets exactly one heading differs —
  // the dataset's own name — which the next-but-one test pins separately.)
  for (const dataset of ["verified", "pro"]) {
    const group = ALL.filter((c) => c.args.dataset === dataset);
    const reference = sections(benchmarkBrief(group[0].args));
    assert.ok(reference.length >= 8, "outline collapsed — expected the full brief");
    for (const { name, args } of group) {
      assert.deepEqual(sections(benchmarkBrief(args)), reference,
        `${name} added, dropped or reordered a section`);
    }
  }
});

test("the outline is the one the dashboard's brief view expects", () => {
  // Pinned by name, not just by shape: renaming a section is a dashboard-visible
  // change and should have to be made here on purpose.
  assert.deepEqual(sections(benchmarkBrief({ dataset: "pro", track: "console" })), [
    "## One-line summary",
    "## What this study is",
    "## What SWE-bench Pro is",
    "## What one instance run does",
    "## How patches are authored",
    "## How verdicts are graded",
    "## How cost is accounted",
    "## Integrity",
    "## Where the numbers are",
  ]);
});

test("only the dataset's own name varies inside the outline", () => {
  // The "What X is" heading is the single place the outline is allowed to
  // differ between datasets — everything else is literal.
  const pro = sections(benchmarkBrief({ dataset: "pro", track: "console" }));
  const ver = sections(benchmarkBrief({ dataset: "verified", track: "console" }));
  const diff = pro.filter((s, i) => s !== ver[i]);
  assert.equal(diff.length, 1, `more than the dataset name differs: ${diff.join(" | ")}`);
  assert.match(diff[0], /^## What .+ is$/);
});

// ---- the H1 is the card's identity -----------------------------------------

test("a delegated harness brief names both halves of the cable in its H1", () => {
  const md = benchmarkBrief({ dataset: "pro", track: "harness", delegated: true, ...HARNESS });
  assert.equal(md.split("\n")[0], "# Project Brief — Claude Code × Antigravity SDK · SWE-bench Pro");
});

test("a console brief's H1 is the dataset alone — there is no cable to name", () => {
  assert.equal(benchmarkBrief({ dataset: "verified", track: "console" }).split("\n")[0],
    "# Project Brief — SWE-bench Verified");
});

test("an explicit title overrides the H1 but changes nothing else", () => {
  const base = benchmarkBrief({ dataset: "pro", track: "console" });
  const titled = benchmarkBrief({ dataset: "pro", track: "console", title: "Custom Heading" });
  assert.equal(titled.split("\n")[0], "# Project Brief — Custom Heading");
  assert.equal(titled.split("\n").slice(1).join("\n"), base.split("\n").slice(1).join("\n"));
});

// ---- the "no volatile facts" construction claim -----------------------------

test("no brief contains a dollar amount, a date, a seed or an instance count", () => {
  // These are the facts that change every run. A brief is study-level and is
  // written once, so any of them appearing here would go stale immediately.
  const forbidden = [
    [/\$\s?\d/, "a dollar amount"],
    [/\b20\d{2}-\d{2}-\d{2}\b/, "a date"],
    [/\bseed\b/i, "a seed"],
    [/\b\d+\s*(instances|runs|attempts)\b/i, "a hardcoded count"],
  ];
  for (const { name, args } of ALL) {
    const md = benchmarkBrief(args);
    for (const [re, what] of forbidden) {
      const hit = md.split("\n").find((l) => re.test(l));
      assert.equal(hit, undefined, `${name} contains ${what}: ${JSON.stringify(hit)}`);
    }
  }
});

test("a delegated brief names its own cable rather than a hardcoded worker model", () => {
  // The driver and SDK are the study's fixed identity so they are named; the
  // worker MODEL is a per-column choice and must stay out of the brief.
  const md = benchmarkBrief({ dataset: "pro", track: "harness", delegated: true, ...HARNESS });
  assert.match(md, /Antigravity SDK/);
  assert.doesNotMatch(md, /gemini-[\d.]+/i, "brief hardcoded a worker model id");
});

test("a delegated brief describes the cable strip as it actually behaves", () => {
  // A COPY CONTRACT, and it has already been broken once. The brief used to
  // say the strip showed "the exact cable the newest runs used"; the strip in
  // fact read the FIRST column and, since 2026-07-26, pools every column and
  // marks a side that varies. Prose about a widget drifts silently — nothing
  // throws when a document describes a control that behaves differently — so
  // the sentence is pinned to the behaviour it claims.
  const md = benchmarkBrief({ dataset: "pro", track: "harness", delegated: true, ...HARNESS });
  assert.doesNotMatch(md, /newest runs used/,
    "brief still claims the strip shows the newest run's cable");
  assert.match(md, /varies by column/,
    "brief does not mention the strip's per-column variance marker");
});

// ---- the guard rails --------------------------------------------------------

test("an unknown dataset or track fails loudly instead of rendering a half-brief", () => {
  assert.throws(() => benchmarkBrief({ dataset: "lite", track: "console" }), /unknown dataset/);
  assert.throws(() => benchmarkBrief({ dataset: "pro", track: "local" }), /unknown track/);
});

test("a harness brief without a driver is refused — the runtime is its identity", () => {
  assert.throws(() => benchmarkBrief({ dataset: "pro", track: "harness" }),
    /harness track needs \{ driver \}/);
});

test("a delegated cable without an SDK is refused — the SDK is half the cable", () => {
  assert.throws(
    () => benchmarkBrief({ dataset: "pro", track: "harness", delegated: true, driver: "Claude Code" }),
    /delegated harness cable needs \{ sdk \}/);
});

test("a single-seat harness brief needs no SDK and does not invent one", () => {
  const md = benchmarkBrief({ dataset: "pro", track: "harness", driver: "Claude Code" });
  assert.match(md, /single-seat/);
  assert.doesNotMatch(md, /undefined/, "an absent field leaked into the copy");
});

// ---- output hygiene ---------------------------------------------------------

test("no brief ever renders the string 'undefined' or 'null'", () => {
  for (const { name, args } of ALL) {
    const md = benchmarkBrief(args);
    assert.doesNotMatch(md, /\bundefined\b/, `${name} leaked undefined`);
    assert.doesNotMatch(md, /\bnull\b/, `${name} leaked null`);
  }
});

test("every brief is markdown with a single H1 and no empty section bodies", () => {
  for (const { name, args } of ALL) {
    const lines = benchmarkBrief(args).split("\n");
    assert.equal(lines.filter((l) => l.startsWith("# ")).length, 1, `${name} has ≠1 H1`);
    const heads = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith("## "));
    for (const [head, i] of heads) {
      const body = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
      assert.ok(body, `${name}: section ${head} has no body`);
    }
  }
});
