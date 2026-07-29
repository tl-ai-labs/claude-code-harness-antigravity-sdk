/**
 * Corpus regression test for the delegation content lint (audit.mjs).
 *
 * WHY THIS IS A SEPARATE FILE FROM audit.test.mjs. Everything in that file is a
 * unit test: a hand-written fixture, chosen to exercise one branch. This file is
 * the opposite kind of evidence — fifty REAL driver→worker hand-offs, taken from
 * the eight delegated runs that were on record when the labels were made and
 * hand-labelled on 2026-07-28, checked against the lint as a whole. The corpus
 * is FROZEN at those fifty: delegated runs recorded since are deliberately not
 * folded in, because thresholds measured against a label set that keeps growing
 * can never be failed by it. Unit tests prove the rules do what they say. Only
 * a corpus proves the rules do what we NEED, because "did the driver dictate the
 * answer?" is a judgement about English, and no fixture invented by the person
 * writing the rule can falsify that rule.
 *
 * THE NUMBER THIS FILE DEFENDS. Every threshold in lintDelegationText was
 * measured here: 6 dictations and 1 proxy-shell hand-off among 50, caught at
 * 6/6 with 0 false positives on the 44 clean ones. Those figures appear in
 * audit.mjs's comments, in DESIGN.md, and — this is the part that matters — in
 * what the study tells Google about how far the delegated claim reaches. Until
 * now they were unverifiable assertions about files on one laptop. A corpus in
 * the repo turns each of them into something that fails loudly when it stops
 * being true.
 *
 * WHY THE FILES ARE COPIED IN AND NOT READ FROM runs/. A test that reads the
 * live run directories has to skip itself when they are absent — on a fresh
 * clone, in CI, on anyone else's machine — and a skipped test reports green
 * while proving nothing. It would also make the corpus depend on directories we
 * have committed to never modifying. So the hand-offs live in
 * fixtures/delegation-corpus/, copied once, with the host path sanitised and the
 * sanitisation proven lint-neutral before it was written. See that folder's
 * README for the provenance rules.
 *
 * WHAT A FAILURE HERE MEANS. Not "the code is broken" — this lint blocks
 * nothing and voids nothing. It means the boundary between "illustrating" and
 * "dictating" moved. Read the named hand-off and decide which side is wrong,
 * the rule or the label, then change that one deliberately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lintDelegationText, fencedBlocks,
  DICTATION_MIN_LINES, SHELL_FENCE_LANGS, TREE_DRAWING_RE,
} from "./audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "fixtures", "delegation-corpus");
const HANDOFFS = join(CORPUS, "handoffs");

const rows = JSON.parse(readFileSync(join(CORPUS, "labels.json"), "utf8"));
const textOf = (row) => readFileSync(join(HANDOFFS, row.file), "utf8");
const familiesOf = (row) =>
  [...new Set(lintDelegationText(textOf(row)).map((w) => w.family))].sort();

/**
 * The two families that answer the labelled question. `driver-proxy-shell-
 * command` is a real finding but a different one — it is the driver asking the
 * worker to run a mutation, not handing it source — so it is counted
 * separately below and deliberately does NOT make a hand-off "leaked".
 */
const LEAK_FAMILIES = new Set(["driver-dictated-code", "driver-dictation-phrasing"]);
const leaks = (families) => families.some((f) => LEAK_FAMILIES.has(f));

// ── the corpus itself ───────────────────────────────────────────────────────

test("the corpus is complete: every label has a file and every file has a label", () => {
  // Both directions. A label pointing at a deleted file would make the suite
  // throw, which is at least loud; an unlabelled file sitting in handoffs/ would
  // be silently untested forever, which is exactly how a corpus rots.
  const onDisk = readdirSync(HANDOFFS).filter((f) => f.endsWith(".md")).sort();
  const labelled = rows.map((r) => r.file).sort();
  assert.deepEqual(labelled, onDisk,
    "labels.json and handoffs/ disagree about which hand-offs exist");
  // Frozen on purpose — see the header. A later delegated run landing in runs/
  // must NOT change this number; if you are here because it did, something
  // copied live files into the fixture.
  assert.equal(rows.length, 50, "the corpus is frozen at 50 hand-offs (8 runs, labelled 2026-07-28)");
  assert.equal(new Set(labelled).size, rows.length, "duplicate file in labels.json");
});

test("the ground truth is 44 clean and 6 solution-leaked", () => {
  const by = (l) => rows.filter((r) => r.label === l).length;
  assert.equal(by("clean"), 44);
  assert.equal(by("solution-leaked"), 6);
  assert.equal(by("clean") + by("solution-leaked"), rows.length,
    "a row carries a label this test does not know about");
});

test("no committed hand-off leaked a host path back in", () => {
  // A privacy regression, not a lint one. The sanitisation pass replaced one
  // absolute path; the danger is someone later adding a row by copying a file
  // straight out of runs/ and undoing that in the same commit.
  for (const r of rows) {
    const t = textOf(r);
    assert.ok(!t.includes("/Users/"), `${r.file} carries an absolute home path`);
    assert.ok(!/\bDesktop\/ai-studies-console\b/.test(t),
      `${r.file} carries the un-sanitised checkout path`);
  }
});

// ── what the lint makes of it ───────────────────────────────────────────────

test("zero false positives: no clean hand-off reads as dictated", () => {
  // The direction that decides whether this lint survives contact with use. A
  // check that flags ordinary task files gets ignored, then switched off, and
  // then it is protecting nothing. 44 of 50 are ordinary task files.
  const wrong = rows.filter((r) => r.label === "clean" && leaks(familiesOf(r)));
  assert.deepEqual(wrong.map((r) => r.file), [],
    "the lint flagged a hand-off that a human read as clean");
});

test("full recall: every hand-off that hands over code is caught", () => {
  const missed = rows.filter((r) => r.label === "solution-leaked" && !leaks(familiesOf(r)));
  assert.deepEqual(missed.map((r) => r.file), [],
    "the lint missed a hand-off that a human read as dictated");
});

test("every row still produces exactly the families recorded with it", () => {
  // The strongest assertion in the file, and the reason labels.json stores
  // families rather than just the verdict. The two tests above would still pass
  // if a rule change moved a finding from one family to another, or added a
  // second family to a hand-off that already had one — both are real changes in
  // what we would report to a reviewer, so both have to break something.
  const drifted = [];
  for (const r of rows) {
    const now = familiesOf(r);
    if (JSON.stringify(now) !== JSON.stringify(r.families)) {
      drifted.push(`${r.file}: recorded ${JSON.stringify(r.families)}, now ${JSON.stringify(now)}`);
    }
  }
  assert.deepEqual(drifted, [], "the lint's output moved on hand-offs it already judged");
});

test("the family tally across the whole corpus is what the study publishes", () => {
  const tally = {};
  for (const r of rows) for (const f of familiesOf(r)) tally[f] = (tally[f] ?? 0) + 1;
  assert.deepEqual(tally, {
    "driver-dictated-code": 6,
    "driver-dictation-phrasing": 1,
    "driver-proxy-shell-command": 1,
  }, "the corpus-wide counts quoted in audit.mjs and DESIGN.md no longer hold");
});

test("nothing in the corpus is critical, because no guard denial preceded it", () => {
  // guard-evasion-by-proxy is the only critical family the lint can raise, and
  // it needs deniedCommands — evidence that the guard refused the driver the
  // same command earlier in the same phase-attempt. Called without that, as
  // here, the lint must never manufacture one from the text alone.
  for (const r of rows) {
    const critical = lintDelegationText(textOf(r)).filter((w) => w.critical);
    assert.deepEqual(critical, [], `${r.file} raised a critical warning with no denial to justify it`);
  }
});

test("the one proxy-shell hand-off is the pnpm-lock checkout, and it is not a leak", () => {
  // Kept as its own test because it is the finding most likely to be quietly
  // reclassified. Handing the worker `git checkout -- pnpm-lock.yaml` is the
  // driver getting a mutation performed on its behalf; it is NOT the driver
  // writing the patch, and folding the two together would overstate the finding.
  const proxied = rows.filter((r) => familiesOf(r).includes("driver-proxy-shell-command"));
  assert.equal(proxied.length, 1);
  assert.match(proxied[0].file, /execute-a1-2\.md$/);
  assert.equal(proxied[0].label, "clean",
    "a proxy-shell hand-off is a separate finding from a dictated one");
});

// ── the threshold, re-derived from the evidence ─────────────────────────────

test("DICTATION_MIN_LINES sits in the one-line gap the corpus actually leaves", () => {
  // The constant is 9 because the largest illustrative fence measured 8 and the
  // smallest dictated one measured 9. That margin is the whole justification for
  // the number, it is quoted in three places, and it is a property of these
  // files — so it is computed from them here rather than restated. Imported
  // SHELL_FENCE_LANGS / TREE_DRAWING_RE, not local copies: a second definition
  // of "which fences count" would let the check and the rule drift apart.
  const biggest = (row) => fencedBlocks(textOf(row))
    .filter((b) => !SHELL_FENCE_LANGS.has(b.lang) && !TREE_DRAWING_RE.test(b.text))
    .reduce((max, b) => Math.max(max, b.lines), 0);

  const clean = rows.filter((r) => r.label === "clean");
  const leaked = rows.filter((r) => r.label === "solution-leaked");
  const maxClean = Math.max(...clean.map(biggest));
  const minLeaked = Math.min(...leaked.map(biggest));

  assert.equal(maxClean, 8, "a clean hand-off now illustrates with a bigger block than 8 lines");
  assert.equal(minLeaked, 9, "the smallest dictation in the corpus is no longer 9 lines");
  assert.ok(maxClean < DICTATION_MIN_LINES && DICTATION_MIN_LINES <= minLeaked,
    `DICTATION_MIN_LINES=${DICTATION_MIN_LINES} no longer separates ${maxClean} from ${minLeaked}`);
  assert.equal(minLeaked - maxClean, 1,
    "the margin is one line — if this grows, say so; if it inverts, the rule cannot work");
});

test("the tree exclusion is load-bearing: without it a clean hand-off false-positives", () => {
  // TREE_DRAWING_RE exists because of exactly one file. Pinning WHICH one, and
  // that there is one, stops it being deleted as speculative defensiveness the
  // next time someone simplifies the lint.
  const wouldWarn = rows.filter((r) => r.label === "clean" &&
    fencedBlocks(textOf(r)).some((b) =>
      !SHELL_FENCE_LANGS.has(b.lang) && TREE_DRAWING_RE.test(b.text) &&
      b.lines >= DICTATION_MIN_LINES));
  assert.deepEqual(wouldWarn.map((r) => r.file), ["38-kudos-wall-07262119-review-a1-1.md"],
    "the set of hand-offs that only the tree exclusion keeps clean has changed");
});

test("the shell exclusion is a rule about kind, and this corpus does not exercise it", () => {
  // Stated as a measurement rather than a boast. SHELL_FENCE_LANGS is correct on
  // principle — telling the worker HOW to reproduce or verify is the driver's
  // job, at any length — but on these fifty hand-offs it changes no verdict:
  // the longest shell fence anyone wrote is 2 lines, well under the threshold.
  //
  // That makes it an UNEXERCISED exclusion, which is worth knowing rather than
  // glossing: unexercised code is where a bug sits unnoticed. Its behaviour is
  // covered by a hand-written case in audit.test.mjs instead. If a future
  // hand-off pushes this number past DICTATION_MIN_LINES the assertion breaks,
  // and at that point the exclusion has become load-bearing and this test should
  // be rewritten to say so.
  const shellFences = rows.flatMap((r) =>
    fencedBlocks(textOf(r)).filter((b) => SHELL_FENCE_LANGS.has(b.lang)));
  assert.equal(shellFences.length, 3, "the corpus no longer carries 3 shell fences");
  const longest = Math.max(...shellFences.map((b) => b.lines));
  assert.equal(longest, 2);
  assert.ok(longest < DICTATION_MIN_LINES,
    "a shell fence is now long enough that the exclusion changes a verdict — see the note above");
});
