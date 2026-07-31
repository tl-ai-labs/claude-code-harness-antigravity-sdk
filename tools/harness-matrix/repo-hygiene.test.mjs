/**
 * repo-hygiene.test — this repository is published to a third party, so no
 * source file in it may name an individual.
 *
 * WHY THIS EXISTS (2026-07-31). The harness grew up as internal work, and its
 * comments recorded decisions the way internal work does: "X's instruction for
 * the Google-facing runs", "X parked the CLI", "(Name, 2026-07-25)" stamped on
 * a rationale. Thirty-one of those accumulated across fifteen files before
 * anyone counted, including four in `sdk-probe/probe_managed_agent.py` that
 * named a Google employee in full and attributed opinions to them. Every one of
 * those comments was TRUE and worth keeping — what they should not carry is the
 * person. A named colleague is not a fact about the harness, and a named
 * external contact quoted from a meeting is somebody else's words shipped
 * without their say-so. They were rewritten to roles ("the deliverable owner",
 * "the platform lead", "a Google engineer") and to bare dates, which preserves
 * every "why" and drops every "who".
 *
 * WHY IT IS A TEST AND NOT A ONE-OFF SWEEP. The sweep was the easy half. These
 * comments are written at the moment a decision lands, by whoever is deep in
 * the change — exactly when "Ravi asked for this on Slack" is the most natural
 * thing to type. A one-time cleanup regresses on the next such comment and
 * nobody notices until the repo is already in someone else's hands. This test
 * runs on `pnpm test`, offline, in milliseconds, at $0.
 *
 * WHY THE DENYLIST BELOW IS ACCEPTABLE even though it spells the names. A
 * denylist that cannot be read is a denylist that silently stops working, and
 * the alternatives are worse: a list kept in an untracked file makes the test
 * skip itself on a fresh clone, which reports green while proving nothing.
 * These bare tokens carry no role, no opinion and no internal decision — which
 * is precisely the property that made the original comments a problem and this
 * list not one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

// People who appear in this project's history. First names only, because that
// is how they appeared — a full-name-only check would have missed every hit
// the 2026-07-31 sweep actually found.
const NAMES = [
  "Ravi", "Teja", "Sanjit", "Kiran", "Vaibhav", "Dinesh", "Chandu", "Sriram",
  "Mehta",
];

// Whole-word, case-insensitive. Word boundaries matter: without them "Ravi"
// matches inside unrelated identifiers and the test becomes noise that someone
// eventually deletes.
const NAME_RE = new RegExp(`\\b(${NAMES.join("|")})\\b`, "i");

// The authorship parenthetical the sweep removed sixteen of: `(Name, DATE)`.
// Checked SEPARATELY from the denylist and by SHAPE, so it also catches a name
// nobody thought to list — the far likelier future regression, since the next
// person to stamp a comment this way will not be on a list written today.
const ATTRIBUTION_RE = /\(\s*[A-Z][a-z]+\s*,\s*20\d\d-\d\d-\d\d[^)]*\)/;

const SCANNED_EXT = new Set([
  ".mjs", ".mts", ".ts", ".js", ".md", ".yaml", ".yml", ".py", ".json",
  ".sh", ".toml",
]);

// Not source: dependency trees, build output, and lockfiles nobody authors.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".pnpm-store", "sdkprobe",
]);

// Recorded evidence is verbatim by definition — see the second test.
const isEvidence = (rel) => rel.includes("/runs/") || rel.includes("/passes/");

// A run writes its own absolute host paths into the evidence it records —
// `audit.json` evidence pointers, the generated hook settings, the worker
// skill's `cat > "<abs path>"` lines. On a laptop whose account name happens
// to be on the denylist above, every one of those lines matches NAME_RE and
// the evidence test fails on a run that is entirely clean. That happened on
// 2026-07-31: one live SDLC run turned a green suite red with twenty-odd hits,
// all of them the string `/Users/<account>/Desktop/...`.
//
// Blanket-skipping those files would gut the guard. What is actually true is
// narrower: a host path is not a person reaching the record. It is the
// machine's own filesystem, it is already handled on the publish path by
// `scrub-paths.mjs` (which rewrites the repo root to `/harness`, with
// `--check` asserting the result), and `runs/` is gitignored so it never
// reaches a clone at all. What the guard is for is a name in PROSE — in a
// hand-off, a rationale, a commit message quoted into a record.
//
// So: erase the two absolute prefixes a run can legitimately bake in, then
// match what is left. A hand-off that says "the deliverable owner" survives;
// one that says a colleague's name still fails, at that same line.
const HOST_PREFIXES = [REPO_ROOT, homedir()]
  // Longest first: REPO_ROOT usually sits under homedir(), and erasing the
  // shorter one first would leave the tail of the longer one behind.
  .filter(Boolean).sort((a, b) => b.length - a.length);

const withoutHostPaths = (line) =>
  HOST_PREFIXES.reduce((acc, p) => acc.split(p).join("<host>"), line);

// This file necessarily spells the names; excluding it is not a loophole,
// since a name reaching the repo through this file alone would carry no
// context about anyone.
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (SCANNED_EXT.has(extname(entry)) && basename(entry) !== "pnpm-lock.yaml") out.push(abs);
  }
  return out;
}

const ALL = walk(REPO_ROOT).map((abs) => ({ abs, rel: relative(REPO_ROOT, abs) }));

// A guard on the guard: if the walk ever returns nothing — a renamed root, a
// broken skip rule — every assertion below passes vacuously and the repo is
// unprotected while CI is green.
test("the hygiene scan actually reaches this repository's source", () => {
  assert.ok(ALL.length > 100, `walked only ${ALL.length} files — the scan is not seeing the repo`);
  assert.ok(ALL.some((f) => f.rel === "README.md"), "README.md not scanned");
  assert.ok(ALL.some((f) => f.rel.startsWith("tools/harness-matrix/policies/")), "policies not scanned");
});

test("no authored source file names an individual", () => {
  const hits = [];
  for (const { abs, rel } of ALL) {
    if (rel === SELF || isEvidence(rel)) continue;
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      if (NAME_RE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, [],
    "This repository is published. Rewrite the person as their role — " +
    "\"the deliverable owner\", \"the platform lead\", \"a Google engineer\" — " +
    `and keep the reason:\n${hits.join("\n")}`);
});

test("no authored source file carries a `(Name, DATE)` attribution stamp", () => {
  const hits = [];
  for (const { abs, rel } of ALL) {
    if (rel === SELF || isEvidence(rel)) continue;
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      if (ATTRIBUTION_RE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, [],
    "Drop the name and keep the date — `(2026-07-25)`. The date is what makes " +
    `a rationale checkable against the history; the name adds nothing:\n${hits.join("\n")}`);
});

// Split out with its own remediation, deliberately. Everything under `runs/`
// and `examples/*/passes/` is a RECORD of something that happened — the exact
// text a driver sent a worker, the SDK's own token receipt. The fix for a name
// in a record is never to edit the record: it is to fix whatever put the name
// into a live hand-off, and to re-run or not publish. Folding these into the
// test above would invite exactly the wrong repair.
test("recorded evidence carries no individual's name either", () => {
  const hits = [];
  for (const { abs, rel } of ALL) {
    if (!isEvidence(rel)) continue;
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      if (NAME_RE.test(withoutHostPaths(line))) {
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(hits, [],
    "A name reached RECORDED EVIDENCE. Do NOT edit these files — they are the " +
    "record. Find what put the name into a live hand-off, fix that, and re-run " +
    `or withhold the affected pass:\n${hits.join("\n")}`);
});

// Guards on the host-path carve-out. Without these, widening it later — one
// more prefix, one looser replace — silently turns the evidence test into a
// no-op, and the failure mode is a green suite, which nobody investigates.
test("the host-path carve-out erases machine paths but not names in prose", () => {
  const runPath = join(REPO_ROOT, "tools/harness-matrix/runs/kudos-wall/x/audit.json");
  assert.equal(NAME_RE.test(withoutHostPaths(`  "evidence": "${runPath}"`)), false,
    "a run's own absolute host path must not read as a name reaching evidence");

  // …and the thing the test actually exists to catch still fails, on the same
  // kind of line: a name in the prose a driver sent a worker.
  assert.equal(NAME_RE.test(withoutHostPaths("Ravi asked for this shape on Slack")), true,
    "a colleague named in a hand-off must still be caught");
  assert.equal(
    NAME_RE.test(withoutHostPaths(`wrote ${runPath} because Teja wanted it`)), true,
    "a host path on the same line must not launder a name beside it");
});

test("the host-path prefixes are ordered longest-first", () => {
  const lens = HOST_PREFIXES.map((p) => p.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a),
    "erasing homedir() before REPO_ROOT would leave the repo-root tail behind");
});
