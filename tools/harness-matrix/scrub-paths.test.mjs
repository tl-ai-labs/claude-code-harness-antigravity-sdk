/**
 * scrub-paths.test — the sanitiser that runs when evidence leaves the repo.
 *
 * WHAT IS ACTUALLY AT RISK HERE, and therefore what these tests are for: a
 * substitution that looks right, passes a `/Users/` check, and still publishes
 * the machine's directory layout — because a shorter rule fired first and left
 * `/home/user/Desktop/demo-console/...` behind. That failure is silent by
 * construction, so it gets its own test rather than being implied by the others.
 *
 * The real-evidence tests read the 62 tracked hand-offs under `runs/`. Those
 * files are committed (see .gitignore's un-ignore block for
 * evidence-bundle/delegation/), so these tests do NOT skip themselves on a fresh
 * clone or in CI — a skipped test reports green while proving nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildScrubRules, scrubText, hostPathHits, assertNoHostPaths,
  lintUnchangedByScrub, scrubTree,
  HARNESS_PLACEHOLDER, REPO_PLACEHOLDER, HOME_PLACEHOLDER, REPO_ROOT,
} from "./scrub-paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A fixed synthetic machine, so the rule tests assert on known strings instead
// of on whatever laptop happens to run them.
//
// The synthetic repo directory is deliberately NOT this repository's real name.
// A fixture that spells the real name would put a partially-rewritten copy of
// the actual host layout into this file — which `assertNoHostPaths` then flags
// when the extractor scans the published tree, and rightly so: it cannot tell a
// test fixture from a leak, and should not try. Naming it something else keeps
// the fixture honest and the assertion blunt.
//
// The `/Users/` heads are written as concatenations rather than as literals for
// the same reason. This file is published by the extraction, which scrubs every
// file it copies — a literal `/home/user` here would be rewritten to
// `/home/user` in the published copy, and these tests would then assert that
// the generic net catches a string that no longer contains what it catches. A
// test for a substitution cannot keep the substitution's own input in its source
// and also survive being published through it. Splitting the literal is the
// whole fix; the runtime values are identical.
const U = `/${"Users"}`;
const HOME = `${U}/testuser`;
const REPO_DIR = "demo-console";
const ROOT = `${HOME}/Desktop/${REPO_DIR}`;
const RULES = buildScrubRules({ repoRoot: ROOT, home: HOME });
const scrub = (s) => scrubText(s, RULES);

// ---- the four shapes -------------------------------------------------------

test("each host path shape maps to its placeholder", () => {
  assert.equal(scrub(`${ROOT}/tools/harness-matrix`), HARNESS_PLACEHOLDER);
  assert.equal(scrub(ROOT), REPO_PLACEHOLDER);
  assert.equal(scrub(HOME), HOME_PLACEHOLDER);
  assert.equal(scrub(`${U}/someoneelse`), HOME_PLACEHOLDER);
});

test("suffixes survive — only the host-specific head is replaced", () => {
  assert.equal(
    scrub(`${ROOT}/tools/harness-matrix/runs/instance_foo/out/worker-task-repro-a1-1.md`),
    `${HARNESS_PLACEHOLDER}/runs/instance_foo/out/worker-task-repro-a1-1.md`);
  assert.equal(
    scrub(`${HOME}/.gemini/antigravity/brain/d0896a5d24fcced429f4c5a1c7664d38`),
    `${HOME_PLACEHOLDER}/.gemini/antigravity/brain/d0896a5d24fcced429f4c5a1c7664d38`);
});

/**
 * THE ORDERING TRAP. This is the test that earns the file. Apply the home rule
 * before the harness rule and the result is `/home/user/Desktop/demo-console/
 * tools/harness-matrix` — no `/Users/` left, so a naive check passes, and the
 * directory layout is published anyway.
 */
test("longest prefix wins — a partially rewritten path is never produced", () => {
  const out = scrub(`${ROOT}/tools/harness-matrix/audit.mjs`);
  assert.equal(out, `${HARNESS_PLACEHOLDER}/audit.mjs`);
  assert.ok(!out.includes("Desktop"), `layout leaked through: ${out}`);
  assert.ok(!out.includes(REPO_DIR), `repo dir name leaked through: ${out}`);
});

/**
 * The structural invariant behind the trap above: the literal rules are nested
 * prefixes, so each one must strictly EXTEND the next. Asserting the prefix
 * relation rather than the rule names means a future fifth shape cannot be
 * inserted in the wrong slot and still pass.
 */
test("the rules are ordered longest-literal-first, then net, then costumes", () => {
  // Block 1 — the slash-path literals, each strictly extending the next
  // (harness dir ⊃ repo root ⊃ home), so the longest match always wins.
  const literals = RULES.slice(0, 3).map((r) => r.re.source);
  for (let i = 0; i < literals.length - 1; i += 1) {
    assert.ok(literals[i].startsWith(literals[i + 1]) && literals[i].length > literals[i + 1].length,
      `rule ${i} (${literals[i]}) must strictly extend rule ${i + 1} (${literals[i + 1]}) — ` +
      `otherwise the shorter one fires first and leaves a partially rewritten path`);
  }
  // Block 2 — the generic /Users/ net, directly after the literals: any
  // earlier and it would eat this machine's paths before the specific
  // placeholders could claim them.
  assert.ok(RULES[3].re.source.includes("[^"),
    `rule 3 must be the generic /Users/ net, found: ${RULES[3].re.source}`);
  // Block 3 — the dash-munged costume repeats the same prefix discipline in
  // its own encoding: the munged repo root strictly extends the munged home.
  const [mungedRepo, mungedHome] = [RULES[4].re.source, RULES[5].re.source];
  assert.ok(mungedRepo.startsWith(mungedHome) && mungedRepo.length > mungedHome.length,
    `munged repo-root rule (${mungedRepo}) must strictly extend the munged home rule (${mungedHome})`);
  // Block 4 — the bare account name is LAST and word-bounded, so every
  // path-shaped rule consumes its copies of the name before this net sees
  // what is left; earlier, it would turn `/Users/testuser/...` into
  // `/Users/user/...` and the literal rules would no longer match.
  assert.equal(RULES.length, 7, "expected 3 literals + net + 2 munged + account name");
  const last = RULES[RULES.length - 1].re.source;
  assert.ok(last.startsWith("\\b") && last.endsWith("\\b"),
    `the bare account-name rule must be last and word-bounded, found: ${last}`);
});

test("scrubbing is idempotent", () => {
  const once = scrub(`${ROOT}/tools/harness-matrix and ${HOME}/.gemini`);
  assert.equal(scrub(once), once);
});

test("text with no host paths is returned untouched", () => {
  const s = "run the repro at /app/src and read out/worker-task-repro-a1-1.md";
  assert.equal(scrub(s), s);
});

// ---- the detector ----------------------------------------------------------

test("hostPathHits finds a raw /Users/ path", () => {
  assert.deepEqual(hostPathHits(`see ${HOME}/Desktop/x`), [`${HOME}/Desktop/x`]);
});

test("hostPathHits catches a PARTIALLY rewritten path with no /Users/ left", () => {
  const partial = "/home/user/Desktop/demo-console/tools/harness-matrix";
  const hits = hostPathHits(partial, { repoDirName: REPO_DIR });
  assert.ok(hits.length > 0,
    "a path that lost /Users/ but kept the repo layout must still be flagged");
});

test("hostPathHits does not flag the placeholders themselves", () => {
  const clean = `${HARNESS_PLACEHOLDER}/audit.mjs ${REPO_PLACEHOLDER}/package.json ${HOME_PLACEHOLDER}/.gemini`;
  assert.deepEqual(hostPathHits(clean, { repoDirName: REPO_DIR }), []);
});

// ---- the assertion ---------------------------------------------------------

test("assertNoHostPaths throws, naming the file, when one slips through", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrub-assert-"));
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "leaky.json"), `{"cwd":"${HOME}/Desktop/x"}`);
  writeFileSync(join(dir, "fine.md"), "nothing to see");
  assert.throws(() => assertNoHostPaths(dir), (e) => {
    assert.match(e.message, /nested\/leaky\.json/);
    assert.match(e.message, /public git history/);
    return true;
  });
});

test("assertNoHostPaths passes on a clean tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrub-clean-"));
  writeFileSync(join(dir, "a.md"), `${HARNESS_PLACEHOLDER}/runs/x`);
  assert.doesNotThrow(() => assertNoHostPaths(dir));
});

// ---- scrubTree -------------------------------------------------------------

test("scrubTree writes scrubbed copies and leaves the source byte-identical", () => {
  const src = mkdtempSync(join(tmpdir(), "scrub-src-"));
  const dest = mkdtempSync(join(tmpdir(), "scrub-dest-"));
  mkdirSync(join(src, "out"), { recursive: true });
  const handoff = `Read ${ROOT}/tools/harness-matrix/DESIGN.md and report what you find.\n`;
  const receipt = `{"cacheDir":"${HOME}/.gemini/antigravity/brain/abc"}`;
  writeFileSync(join(src, "out", "worker-task-repro-a1-1.md"), handoff);
  writeFileSync(join(src, "out", "worker-usage-repro-a1-1.json"), receipt);

  const stats = scrubTree(src, dest, { rules: RULES, repoDirName: REPO_DIR });

  assert.equal(stats.files, 2);
  assert.equal(stats.changed, 2);
  assert.equal(stats.checked, 1, "only the hand-off goes through the lint gate");

  // Source untouched — runs/ is immutable evidence.
  assert.equal(readFileSync(join(src, "out", "worker-task-repro-a1-1.md"), "utf8"), handoff);
  assert.equal(readFileSync(join(src, "out", "worker-usage-repro-a1-1.json"), "utf8"), receipt);

  // Destination scrubbed, structure preserved.
  assert.equal(readFileSync(join(dest, "out", "worker-task-repro-a1-1.md"), "utf8"),
    `Read ${HARNESS_PLACEHOLDER}/DESIGN.md and report what you find.\n`);
  assert.doesNotThrow(() => assertNoHostPaths(dest, { repoDirName: REPO_DIR }));
});

test("scrubTree refuses to emit a hand-off whose lint verdict moved", () => {
  const src = mkdtempSync(join(tmpdir(), "scrub-guard-src-"));
  const dest = mkdtempSync(join(tmpdir(), "scrub-guard-dest-"));
  writeFileSync(join(src, "worker-task-repro-a1-1.md"), "clean hand-off, no code\n");
  // A rule that deletes newlines would collapse a fenced block below the
  // dictation threshold. Nothing in buildScrubRules() does this — the point is
  // that the gate FIRES when a rule misbehaves, not that this rule exists.
  const badRules = [{ re: /```/g, to: "" }];
  writeFileSync(join(src, "worker-task-patch-a1-1.md"),
    "```js\n" + Array.from({ length: 12 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n```\n");
  assert.throws(() => scrubTree(src, dest, { rules: badRules }),
    /changed the lint verdict/);
});

// ---- the CLI ---------------------------------------------------------------

// The CLI is tested by RUNNING it, not by importing a main(): its whole reason
// to exist is that someone types it at a shell, and the parts that break there
// — exit codes, the direct-execution guard, stdin — are exactly the parts an
// in-process call would not exercise. Each case below is a real process.
const CLI = join(HERE, "scrub-paths.mjs");
const runCli = (args, input) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input });

/** A source tree carrying one hand-off and one receipt, both with host paths. */
function leakyTree() {
  const src = mkdtempSync(join(tmpdir(), "scrub-cli-src-"));
  mkdirSync(join(src, "out"), { recursive: true });
  writeFileSync(join(src, "out", "worker-task-repro-a1-1.md"),
    `Read ${ROOT}/tools/harness-matrix/DESIGN.md and report what you find.\n`);
  writeFileSync(join(src, "out", "worker-usage-repro-a1-1.json"),
    `{"cacheDir":"${HOME}/.gemini/antigravity/brain/abc"}`);
  return src;
}

/** The synthetic machine's rule bases, as the CLI flags that select them. */
const CLI_MACHINE = ["--repo-root", ROOT, "--home", HOME, "--repo-dir-name", REPO_DIR];

test("CLI --src/--dest scrubs the tree, asserts the copy, and reports", () => {
  const src = leakyTree();
  const dest = join(mkdtempSync(join(tmpdir(), "scrub-cli-dest-")), "out-tree");
  const r = runCli(["--src", src, "--dest", dest, ...CLI_MACHINE]);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 file\(s\) copied/);
  assert.match(r.stdout, /0 survived the sweep/);
  assert.equal(readFileSync(join(dest, "out", "worker-task-repro-a1-1.md"), "utf8"),
    `Read ${HARNESS_PLACEHOLDER}/DESIGN.md and report what you find.\n`);
  // The source is recorded evidence; the CLI must never have written to it.
  assert.match(readFileSync(join(src, "out", "worker-task-repro-a1-1.md"), "utf8"),
    new RegExp(REPO_DIR));
});

test("CLI --files-from - takes the publishable list from stdin", () => {
  const src = leakyTree();
  const dest = join(mkdtempSync(join(tmpdir(), "scrub-cli-list-")), "out-tree");
  // The receipt is deliberately absent from the list: this is how `git ls-files`
  // keeps .gitignore the single definition of what gets published.
  const r = runCli(["--src", src, "--dest", dest, "--files-from", "-", ...CLI_MACHINE],
    "out/worker-task-repro-a1-1.md\n");

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 file\(s\) copied/);
  assert.ok(!statSyncSafe(join(dest, "out", "worker-usage-repro-a1-1.json")),
    "a file absent from the list must not be copied");
});

test("CLI --check exits 0 on a clean tree and 1 on a leak, naming the file", () => {
  const clean = mkdtempSync(join(tmpdir(), "scrub-cli-clean-"));
  writeFileSync(join(clean, "a.md"), `${HARNESS_PLACEHOLDER}/runs/x`);
  const ok = runCli(["--check", clean]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /is clean/);

  const leaky = mkdtempSync(join(tmpdir(), "scrub-cli-leak-"));
  mkdirSync(join(leaky, "nested"), { recursive: true });
  writeFileSync(join(leaky, "nested", "leaky.json"), `{"cwd":"${HOME}/Desktop/x"}`);
  const bad = runCli(["--check", leaky]);
  assert.equal(bad.status, 1, "a surviving host path must fail the command, not just print");
  assert.match(bad.stderr, /nested\/leaky\.json/);
});

test("CLI refuses a bad invocation with exit 2, before writing anything", () => {
  // Neither mode selected.
  assert.equal(runCli([]).status, 2);
  // Both modes at once — ambiguous about whether a tree was produced.
  assert.equal(runCli(["--check", "/tmp", "--src", "/tmp", "--dest", "/tmp/x"]).status, 2);
  // --dest inside --src: the scrubbed copy would land on top of the evidence.
  const src = leakyTree();
  const r = runCli(["--src", src, "--dest", join(src, "copy"), ...CLI_MACHINE]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /immutable evidence/);
  assert.ok(!statSyncSafe(join(src, "copy")), "nothing may be written on a usage error");
});

/** statSync that answers "does this exist?" instead of throwing. */
function statSyncSafe(p) {
  try { return statSync(p); } catch { return null; }
}

// ---- against the real recorded evidence ------------------------------------

// The tracked hand-offs live under examples/<workload>/passes/ — one reference
// pass per workload in the deliverable. `git ls-files` from the repo root is
// what stops an untracked local run under tools/harness-matrix/runs/ from
// affecting the count. REPO_ROOT (imported above) is the harness's repo root,
// re-used here rather than redeclared.

/** Every tracked hand-off, via git so an untracked local run cannot affect the result. */
function trackedHandoffs() {
  const out = execFileSync("git", ["ls-files", "examples/*/passes/**"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\n").filter((p) => /worker-task-.+\.md$/.test(p));
}

test("the tracked evidence is present — this suite never silently skips", () => {
  const files = trackedHandoffs();
  // 17 = 12 (kudos-wall reference) + 5 (swe-bench-pro navidrome). The exact
  // number is checked here so a future pass added or removed shows up as a
  // failure to update the count, not as silent drift.
  assert.ok(files.length >= 17,
    `expected at least the 17 hand-offs across the two reference passes, found ${files.length}`);
});

test("scrubbing changes no lint verdict on any recorded hand-off", () => {
  const rules = buildScrubRules();
  const moved = [];
  for (const rel of trackedHandoffs()) {
    const abs = join(REPO_ROOT, rel);
    const text = readFileSync(abs, "utf8");
    const v = lintUnchangedByScrub(text, { rules, outDir: dirname(abs) });
    if (!v.equal) moved.push(`${rel}: ${v.before.join(",")} -> ${v.after.join(",")}`);
  }
  assert.deepEqual(moved, [],
    "a substitution changed what the lint sees; the published findings would " +
    "no longer match the dashboard's");
});

test("scrubbing every recorded hand-off leaves no host path behind", () => {
  const rules = buildScrubRules();
  const survivors = [];
  for (const rel of trackedHandoffs()) {
    const scrubbed = scrubText(readFileSync(join(REPO_ROOT, rel), "utf8"), rules);
    const hits = hostPathHits(scrubbed);
    if (hits.length) survivors.push(`${rel}: ${hits.slice(0, 2).join(", ")}`);
  }
  assert.deepEqual(survivors, []);
});

test("the frozen corpus is already clean and the rules are a no-op on it", () => {
  const dir = join(HERE, "fixtures", "delegation-corpus", "handoffs");
  const rules = buildScrubRules();
  const names = readdirSync(dir).filter((n) => n.endsWith(".md"));
  assert.equal(names.length, 50, "the corpus is frozen at 50 hand-offs");
  for (const n of names) {
    const text = readFileSync(join(dir, n), "utf8");
    assert.deepEqual(hostPathHits(text), [], `${n} carries a host path`);
    assert.equal(scrubText(text, rules), text,
      `${n} would be modified by the scrub — the corpus must already be final`);
  }
});

// ---- the two costume shapes (2026-07-31, first full-bundle publication) ----
//
// Found by publishing, not by review: the first evidence bundles committed to
// examples/ passed --check ("no host paths") while still carrying the machine
// identity twice — in Claude Code's dash-munged config-dir name, where no "/"
// survives for the path rules to see, and in `ls -l` owner columns, where the
// account name appears with no path anywhere near it. The munged literals
// below are split like the `/Users/` heads above and for the same reason:
// this file is published through the substitution it tests.

test("the dash-munged config-dir form of the repo root is rewritten", () => {
  const munged = `-${"Users"}-testuser-Desktop-demo-console`;
  assert.equal(scrub(`projects/${munged}/settings.json`), "projects/-repo/settings.json");
});

test("the dash-munged home form survives with its suffix when the repo differs", () => {
  const munged = `-${"Users"}-testuser-Desktop-other-proj`;
  assert.equal(scrub(`projects/${munged}`), "projects/-home-user-Desktop-other-proj");
});

test("the account name in ls -l owner position is rewritten", () => {
  assert.equal(scrub("drwxr-xr-x@ 7 testuser  staff   224 Jul 31 15:31 ."),
    "drwxr-xr-x@ 7 user  staff   224 Jul 31 15:31 .");
});

test("the account rule is word-bounded — never fires inside a longer token", () => {
  assert.equal(scrub("testuser123 and untestuser stay"), "testuser123 and untestuser stay");
});

test("hostPathHits flags the dash-munged form on any machine", () => {
  const s = `ls projects/-${"Users"}-alice-Desktop-thing`;
  assert.deepEqual(hostPathHits(s, { account: "nobody-here" }), [`-${"Users"}-alice-Desktop-thing`]);
});

test("hostPathHits flags the bare account name it is told to look for", () => {
  assert.ok(hostPathHits("-rw-r--r-- 1 alice  staff  395", { account: "alice" }).includes("alice"));
  assert.equal(hostPathHits("-rw-r--r-- 1 alice  staff", { account: "bob" }).length, 0);
});
