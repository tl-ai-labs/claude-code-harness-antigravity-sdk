/**
 * Tests for the kind-agnostic harness library (tools/harness-matrix/kinds/lib.mjs).
 *
 * This module is the part of the harness both kinds share, so a bug here is a
 * bug in EVERY cell of the matrix at once. The cases below pin the rules that
 * decide what a run is allowed to have touched, what its patch contains, what
 * it cost, and how a delegated cell is described — the four things a reader of
 * the exhibit takes on trust.
 *
 * Git-backed helpers are exercised against real throwaway repositories rather
 * than a stubbed `git`, because the behaviour under test IS git's (porcelain
 * field packing, rename records, `add -N` making new files visible in a diff).
 * A stub would only prove the stub.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ARTIFACT_PATH, HARNESS_DIR, bindingLabel, classifyChanges, cleanArtifacts, computeDiff,
  costTotals, isDelegatedBinding, makeGit, makePromptRenderer, makeRunDir, parseYaml,
  saneRepoPath, statusEntries, sweproBaseTag, writeRunInEnv,
} from "./lib.mjs";

/** A real git repo with one committed file and an `anchor` tag on it. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "lib-test-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "app.js"), "const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "anchor");
  return { dir, git: makeGit(dir) };
}

// ── delegated bindings ──────────────────────────────────────────────────────

test("a delegated cell NEVER reads as a single-model result", () => {
  // The cc×gemini cell is a composition — an Anthropic driver in Claude Code's
  // seat delegating authorship to a Gemini worker through the Antigravity SDK.
  // Printing it as one model would attribute the whole result to the driver.
  const b = { driver: "claude-opus-4-6", worker: "gemini-3.5-flash" };
  assert.equal(isDelegatedBinding(b), true);
  assert.equal(bindingLabel(b), "claude-opus-4-6 → gemini-3.5-flash (delegated via Antigravity SDK)");
});

test("a plain model binding is printed verbatim", () => {
  assert.equal(isDelegatedBinding("claude-opus-4-6"), false);
  assert.equal(bindingLabel("claude-opus-4-6"), "claude-opus-4-6");
});

test("null is not a delegated binding", () => {
  // `typeof null === "object"` — the classic trap. A null binding reaching
  // bindingLabel as delegated would throw on `.driver` mid-run.
  assert.equal(isDelegatedBinding(null), false);
});

// ── path safety ─────────────────────────────────────────────────────────────

test("contract paths must be relative and inside the repo", () => {
  assert.equal(saneRepoPath("src/app.ts"), true);
  assert.equal(saneRepoPath("a/b/../c.ts"), true); // normalizes to a/c.ts — still inside
  assert.equal(saneRepoPath("/etc/passwd"), false);
  assert.equal(saneRepoPath("../outside.ts"), false);
  assert.equal(saneRepoPath("a/../../outside.ts"), false);
  assert.equal(saneRepoPath(""), false);
  assert.equal(saneRepoPath(null), false);
  assert.equal(saneRepoPath(42), false);
});

// ── status + change classification ──────────────────────────────────────────

test("statusEntries survives renames, which pack TWO fields per record", () => {
  // `git status --porcelain -z` writes a rename as `R  new\0old\0`. Reading the
  // source path as its own entry would report a phantom file the agent never
  // touched — and, since it isn't in the allowlist, fail the gate.
  const { dir, git } = repo();
  execFileSync("git", ["-C", dir, "mv", "app.js", "renamed.js"]);
  const entries = statusEntries(git);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code[0], "R");
  assert.equal(entries[0].path, "renamed.js");
});

test("classifyChanges separates violations from cleanable artifacts", () => {
  // Running a suite drops caches into the repo. Those are cleaned and RECORDED,
  // never counted as the agent editing files it wasn't allowed to.
  const { dir, git } = repo();
  writeFileSync(join(dir, "allowed.js"), "1");
  writeFileSync(join(dir, "forbidden.js"), "1");
  mkdirSync(join(dir, "__pycache__"), { recursive: true });
  writeFileSync(join(dir, "__pycache__", "x.pyc"), "1");

  const { violations, artifacts } = classifyChanges(git, ["allowed.js"]);
  // git reports an untracked directory as one `__pycache__/` entry, not per
  // file — the pattern has to match the directory form or the whole cache
  // lands in `violations` and fails an otherwise-clean gate.
  assert.deepEqual(artifacts, ["__pycache__/"]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /forbidden\.js$/);
});

test("classifyChanges accepts a PREDICATE, for gates that allow path families", () => {
  // SDLC's execute gate allows the scaffold's declared slots, not a pre-known
  // file list, so an exact-path Set would be the wrong shape.
  const { dir, git } = repo();
  writeFileSync(join(dir, "src/") .replace(/\/$/, "") + "-new.js", "1");
  mkdirSync(join(dir, "modules"), { recursive: true });
  writeFileSync(join(dir, "modules", "leave.ts"), "1");

  const { violations } = classifyChanges(git, (p) => p.startsWith("modules/"));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /src-new\.js$/);
});

test("every artifact pattern matches the ephemera it names, and nothing else", () => {
  const hits = ["__pycache__/a.pyc", "x/__pycache__/a.py", "a.pyc", ".pytest_cache/v/x",
    ".mypy_cache/x", ".ruff_cache/x", ".tox/x", ".cache/x", "node_modules/p/i.js", ".nyc_output/x",
    // Package-manager stores — the .pnpm-store entry is the 2026-07-26
    // regression: pnpm put its store inside the graded tree and the gate read
    // 5,238 toolchain files as agent violations.
    ".pnpm-store/v3/files/00/abc", "sub/.pnpm-store/x", ".npm/_cacache/x", ".yarn/cache/p.zip"];
  for (const p of hits) {
    assert.ok(ARTIFACT_PATH.some((re) => re.test(p)), `${p} should be an artifact`);
  }
  for (const p of ["src/app.ts", "tests/test_a.py", "modules/cache.ts", "docs/node_modules.md"]) {
    assert.ok(!ARTIFACT_PATH.some((re) => re.test(p)), `${p} must NOT be an artifact`);
  }
});

test("cleanArtifacts removes exactly the paths it was handed", () => {
  const { dir } = repo();
  mkdirSync(join(dir, "__pycache__"), { recursive: true });
  writeFileSync(join(dir, "__pycache__", "x.pyc"), "1");
  cleanArtifacts(dir, ["__pycache__"]);
  assert.equal(existsSync(join(dir, "__pycache__")), false);
  assert.equal(existsSync(join(dir, "app.js")), true);
});

// ── diff ────────────────────────────────────────────────────────────────────

test("computeDiff sees files the agent CREATED — without add -N they vanish", () => {
  // The bug this guards: `git diff <anchor>` alone ignores untracked files, so
  // a patch that consisted entirely of new files came out empty and the run
  // graded as "no patch" despite the agent having done the work.
  const { dir, git } = repo();
  writeFileSync(join(dir, "brand-new.js"), "const b = 2;\n");
  const { raw, kept } = computeDiff(git, "anchor");
  assert.match(raw, /brand-new\.js/);
  assert.deepEqual(kept.map((k) => k.path), ["brand-new.js"]);
});

test("computeDiff RETURNS what it stripped instead of silently truncating", () => {
  // Pro strips test/repro hunks from the graded patch. Dropping them quietly
  // would read as "the agent edited no tests", which is a different claim.
  const { dir, git } = repo();
  writeFileSync(join(dir, "src.js"), "const a = 2;\n");
  writeFileSync(join(dir, "tests_new.py"), "def test(): pass\n");
  const { kept, stripped } = computeDiff(git, "anchor", (p) => p.startsWith("tests_"));
  assert.deepEqual(kept.map((k) => k.path), ["src.js"]);
  assert.deepEqual(stripped.map((s) => s.path), ["tests_new.py"]);
});

test("computeDiff on an untouched repo is empty, not an error", () => {
  const { git } = repo();
  const { raw, kept, stripped } = computeDiff(git, "anchor");
  assert.equal(raw, "");
  assert.deepEqual(kept, []);
  assert.deepEqual(stripped, []);
});

// ── prompts ─────────────────────────────────────────────────────────────────

/** Placeholders a shipped template actually declares. */
const placeholdersOf = (name) => [...new Set(
  (readFileSync(join(HARNESS_DIR, "prompts", `${name}.md`), "utf8").match(/\{\{[A-Z_]+\}\}/g) ?? [])
    .map((p) => p.slice(2, -2)),
)];

test("an unfilled prompt placeholder is a HARD error, never a silent gap", () => {
  // A prompt that ships with `{{WORKDIR}}` still in it produces a
  // plausible-looking run that was never actually told where to work.
  const render = makePromptRenderer(["repro"]);
  assert.throws(() => render("repro", {}), /unfilled placeholder \{\{[A-Z_]+\}\}/);
});

test("every placeholder every shipped prompt declares can be filled", () => {
  // Asserts the MECHANISM, not one template's field list: discover each
  // prompt's own placeholders, fill them, and require that none survive. A
  // prompt that gains a field is covered the day it lands.
  const names = ["repro", "localize", "patch", "sdlc-requirements", "sdlc-design",
    "sdlc-plan-packets", "sdlc-execute", "sdlc-review", "sdlc-judge"];
  const render = makePromptRenderer(names);
  for (const n of names) {
    const ctx = Object.fromEntries(placeholdersOf(n).map((k) => [k, `<${k}>`]));
    const out = render(n, ctx);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(out), `${n}: a placeholder survived rendering`);
    for (const k of Object.keys(ctx)) assert.ok(out.includes(`<${k}>`), `${n}: ${k} was not substituted`);
  }
});

// ── cost ────────────────────────────────────────────────────────────────────

const stage = (...costs) => ({ attempts: costs.map((c) => ({ cost_usd: c })) });

test("costTotals sums every attempt, not just the successful one", () => {
  // A failed attempt still spent money. Counting only the winner would make a
  // three-try run look as cheap as a one-try run.
  const t = costTotals([stage(0.5, 0.25), stage(1.0)], new Date().toISOString(), false);
  assert.equal(t.attempts, 3);
  assert.equal(t.cost_usd, 1.75);
});

test("costTotals reports NULL — not zero — when nothing reported a cost", () => {
  // Zero would publish a free run. Null says "not measured", which is true.
  const t = costTotals([{ attempts: [{ cost_usd: null }] }, { attempts: [{}] }],
    new Date().toISOString(), false);
  assert.equal(t.cost_usd, null);
  assert.equal(t.attempts, 2);
});

test("costTotals counts attempts even for a stage that recorded none", () => {
  const t = costTotals([{}, stage(1)], new Date().toISOString(), false);
  assert.equal(t.attempts, 1);
  assert.equal(t.cost_usd, 1);
});

test("a delegated run states that its dollars are DRIVER ONLY", () => {
  // The single most misreadable number in the exhibit: on a delegated cell the
  // cost is the Anthropic driver's alone — the Gemini worker's spend is carried
  // as token counts and priced downstream. The basis string is what stops a
  // reader treating it as the run's full cost.
  const solo = costTotals([stage(1)], new Date().toISOString(), false);
  const deleg = costTotals([stage(1)], new Date().toISOString(), true);
  assert.match(deleg.cost_basis, /DRIVER ONLY/);
  assert.match(deleg.cost_basis, /worker Gemini spend/);
  assert.match(deleg.cost_basis, /asia-south1/);          // the pinned Vertex region
  assert.doesNotMatch(solo.cost_basis, /DRIVER ONLY/);
});

test("both bases disclose that Max-seat costs are modeled, not wallet-real", () => {
  for (const delegated of [true, false]) {
    const t = costTotals([stage(1)], new Date().toISOString(), delegated);
    assert.match(t.cost_basis, /modeled, not wallet-real/);
  }
});

test("costTotals rounds to four decimals — the ledger's precision", () => {
  const t = costTotals([stage(0.00005, 0.00005)], new Date().toISOString(), false);
  assert.equal(t.cost_usd, 0.0001);
});

// ── run directories ─────────────────────────────────────────────────────────

test("makeRunDir creates the workdir/out/phases tree the kinds assume", () => {
  const { stamp, runDir, workdir, outDir } = makeRunDir("test-task", "claude-code", "policy-x");
  try {
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    assert.ok(runDir.includes(join("runs", "test-task", "claude-code--policy-x")));
    assert.ok(existsSync(workdir));
    assert.ok(existsSync(join(outDir, "phases")));
  } finally {
    rmSync(join(runDir, ".."), { recursive: true, force: true });
  }
});

// ---- the 2026-07-26 uptime-ping incident ------------------------------------
// Three defects, one cause. pnpm requires its content-addressable store on the
// same filesystem as node_modules to hardlink; /app is a bind mount and the
// container's $HOME is not, so pnpm relocated the store INTO the graded tree.
// 5,238 store files then (1) blew makeGit's 1 MB default buffer with a 61 MB
// diff, killing the run outright, and (2) would have failed the "repository
// untouched" gate as agent violations. These tests pin all three fixes.

test("run-in-env keeps the package store OUT of the mounted repo", () => {
  const outDir = mkdtempSync(join(tmpdir(), "rie-store-"));
  const store = join(outDir, "pkg-store");
  try {
    const p = writeRunInEnv({
      outDir, workdir: "/tmp/wd", image: "img:tag", cmdTimeoutS: 60,
      shell: "bash", pkgStoreDir: store,
    });
    const script = readFileSync(p, "utf8");
    // Mounted somewhere that is NOT under the repo mount, and pointed at by
    // the variable pnpm actually reads.
    assert.match(script, /-v "[^"]*pkg-store:\/pkg-store"/);
    assert.match(script, /-e npm_config_store_dir=\/pkg-store\/pnpm/);
    // The store path must never resolve inside /app, or the whole fix is moot.
    assert.ok(!/npm_config_store_dir=\/app/.test(script));
    // Created eagerly: docker would otherwise create it root-owned on first run.
    assert.ok(existsSync(store), "store directory should be created up front");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("run-in-env without a store dir is byte-identical to the old script", () => {
  // The Pro kind passes no store — its images install nothing at run time.
  // This pins that the SDLC fix did not silently change Pro's environment,
  // which would invalidate every Pro run recorded before it.
  const outDir = mkdtempSync(join(tmpdir(), "rie-nostore-"));
  try {
    const script = readFileSync(
      writeRunInEnv({ outDir, workdir: "/tmp/wd", image: "img:tag", cmdTimeoutS: 60 }),
      "utf8",
    );
    assert.ok(!script.includes("pkg-store"), "no store plumbing when none was asked for");
    assert.ok(!script.includes("npm_config_store_dir"));
    assert.ok(!script.includes("/app/node_modules"), "no volume plumbing when none was asked for");
    assert.match(script, /-v "\/tmp\/wd:\/app"/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("run-in-env keeps node_modules OFF the macOS bind mount", () => {
  // The other half of the store lesson, found on the 2026-07-26 kudos-wall
  // tiered run. With the store on /pkg-store and node_modules still on the
  // bind-mounted repo, pnpm cannot hardlink between them and copies across the
  // VirtioFS boundary instead; a name collision there produces macOS-style
  // ` 2` duplicate directories rather than an overwrite, which shadowed the
  // real package tree and made @rollup/rollup-linux-arm64-gnu "disappear".
  // The driver then spent ~4 minutes of paid time chasing the npm
  // optional-dependency bug the error message names — infra misread as the
  // model failing to build, which DESIGN §11 forbids.
  const outDir = mkdtempSync(join(tmpdir(), "rie-nm-"));
  try {
    const script = readFileSync(writeRunInEnv({
      outDir, workdir: "/tmp/wd", image: "img:tag", cmdTimeoutS: 60,
      shell: "bash", nodeModulesVolume: "sdlc-nm-testrun",
    }), "utf8");
    assert.match(script, /-v "sdlc-nm-testrun:\/app\/node_modules"/);
    // ORDER MATTERS: a volume only shadows a bind mount if docker sees the
    // deeper mountpoint too — and the repo mount must still be there, or the
    // container has no source tree at all.
    assert.match(script, /-v "\/tmp\/wd:\/app"/);
    assert.ok(script.indexOf('/tmp/wd:/app"') < script.indexOf("/app/node_modules"),
      "the repo mount must be declared before the node_modules volume");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("makeGit survives output far past Node's 1 MB execFileSync default", () => {
  // The literal crash: `spawnSync git ENOBUFS`, unhandled, mid-stage, after
  // the phase had already been paid for. A big diff must be returnable DATA so
  // a gate can fail with the paths named — never a process kill.
  const { dir, git } = repo();
  try {
    // ~4 MB in one file: 4x the old ceiling, comfortably under the new 64 MB.
    writeFileSync(join(dir, "big.txt"), "x".repeat(4 * 1024 * 1024) + "\n");
    const { raw } = computeDiff(git, "anchor");
    assert.ok(raw.length > 1024 * 1024, "diff should exceed the old 1 MB buffer");
    assert.match(raw, /diff --git a\/big\.txt b\/big\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a relocated package store reads as ephemera, never as agent violations", () => {
  // Defence in depth for the same incident: even if a store reappears in the
  // tree, the gate must classify it as cleanable toolchain output. Recording
  // it as "the agent edited 5,238 forbidden files" is the infra-read-as-model
  // -failure the study must never manufacture.
  const { dir, git } = repo();
  try {
    mkdirSync(join(dir, ".pnpm-store/v3/files/00"), { recursive: true });
    writeFileSync(join(dir, ".pnpm-store/v3/files/00/deadbeef"), "pkg\n");
    writeFileSync(join(dir, "src.js"), "const b = 2;\n");
    const { violations, artifacts } = classifyChanges(git, ["src.js"]);
    assert.deepEqual(violations, [], "store files must not be violations");
    assert.ok(artifacts.some((p) => p.startsWith(".pnpm-store/")), "store files must be artifacts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Base-image tag construction (sweproBaseTag).
 *
 * These are not invented expectations — every string below is a tag that
 * actually exists on docker.io/jefzda/sweap-images, verified with `docker
 * manifest inspect` at the time of writing. That matters because the failure
 * mode this pins is not "wrong-looking tag", it is "tag nobody published":
 * the run prints its whole identity frame, pulls, and only then dies with
 * `not found`, which reads like a registry outage instead of our bug.
 *
 * The NodeBB case is the regression itself. It cost a real run on 2026-07-26.
 */
test("strips the -vnan placeholder, which upstream drops before tagging", () => {
  assert.equal(
    sweproBaseTag("instance_NodeBB__NodeBB-f083cd559d69c16481376868c8da65172729c0ca-vnan", "NodeBB/NodeBB"),
    "nodebb.nodebb-NodeBB__NodeBB-f083cd559d69c16481376868c8da65172729c0ca",
  );
});

test("leaves a real -v<sha> environment-commit suffix alone", () => {
  // The half of the corpus that always worked — proof the -vnan strip is
  // anchored to the placeholder and does not eat legitimate suffixes.
  assert.equal(
    sweproBaseTag(
      "instance_ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59",
      "ansible/ansible",
    ),
    "ansible.ansible-ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59",
  );
  assert.equal(
    sweproBaseTag("instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a", "navidrome/navidrome"),
    "navidrome.navidrome-navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a",
  );
});

test("renames element-web to element, honouring upstream's one pinned exception", () => {
  assert.equal(
    sweproBaseTag("instance_element-hq__element-web-71fe08ea0f159ccb707904d87f0a4aef205a167c-vnan", "element-hq/element-web"),
    "element-hq.element-element-hq__element-web-71fe08ea0f159ccb707904d87f0a4aef205a167c",
  );
  // The single id upstream hard-codes to keep the full repo name AND its -vnan.
  assert.equal(
    sweproBaseTag("instance_element-hq__element-web-ec0f940ef0e8e3b61078f145f34dc40d1938e6c5-vnan", "element-hq/element-web"),
    "element-hq.element-web-element-hq__element-web-ec0f940ef0e8e3b61078f145f34dc40d1938e6c5-vnan",
  );
});

test("truncates at 128 chars the way upstream does, rather than hashing", () => {
  const tag = sweproBaseTag(`instance_${"a".repeat(200)}`, "owner/repo");
  assert.equal(tag.length, 128);
  assert.ok(tag.startsWith("owner.repo-aaa"));
});

// ── the five shipped policies: what each one pins ───────────────────────────
// These read the YAML directly rather than going through loadPolicy, on
// purpose: the assertion is about what the FILES DECLARE, which is what a
// reader — and Google — sees. A resolver-level test would still pass if the
// resolver started substituting a default the file never stated.
const policyDoc = (name) =>
  parseYaml(readFileSync(join(HARNESS_DIR, "policies", `${name}.yaml`), "utf8"));
const leavesOf = (doc) => doc.models.filter((m) => m.model_name);

// B-DRIVER48 (2026-07-31). The three CURRENT cells were re-pinned together from
// claude-opus-4-6 to claude-opus-4-8. Pinned as a test because the value of the
// arrangement is that the three agree: the only thing separating these cells is
// how much work is delegated, and a driver drifting on one of them silently
// converts every delta between them into a two-variable comparison. That is the
// exact state the re-pin corrected — opus48-plus-lite had arrived on 4.8 alone,
// leaving the anchor a generation behind the cells it anchors.
//
// Verified against the CLI before this was written: `claude --model
// claude-opus-4-8 --effort high -p …` answers on the Max OAuth seat. A pin no
// runtime accepts is a broken policy, not a strict one.
test("the three CURRENT cells share one driver pin, exactly", () => {
  for (const name of ["all-opus", "all-gemini-flash-high", "opus48-plus-lite"]) {
    const drivers = leavesOf(policyDoc(name)).filter((m) => m.api === "anthropic");
    assert.ok(drivers.length > 0, `${name} declares no Anthropic driver leaf`);
    for (const d of drivers) {
      assert.equal(d.model_name, "claude-opus-4-8", `${name} driver drifted off the shared pin`);
      assert.equal(d.reasoning?.effort, "high", `${name} driver drifted off --effort high`);
    }
  }
});

// The other half of that decision, and the more load-bearing one. Both
// historical columns were DELIBERATELY left on 4.6 because their exemplar
// passes — shipped in this repo under examples/kudos-wall/passes/reference/ —
// ran on 4.6. Re-pinning a frozen study column to a driver it never ran on
// would make the policy describe a run that did not happen, which is worse than
// a column that is merely old. Same reasoning that kept them from being
// deleted; asserted here so a future bulk re-pin cannot take them along.
test("the two HISTORICAL columns stay on the driver they actually ran with", () => {
  for (const name of ["all-gemini-25-flash-high", "gemini35-plus-25-flash-high"]) {
    for (const d of leavesOf(policyDoc(name)).filter((m) => m.api === "anthropic"))
      assert.equal(d.model_name, "claude-opus-4-6",
        `${name} was re-pinned away from the driver its recorded pass used`);
  }
});

// B-REGION, at the schema level. The loader already rejects a vertex leaf with
// no region, so this does not test the validator — it tests the FILES, and it is
// the assertion that would have caught the Flash-Lite defect at authoring time
// rather than on the first paid call: gemini-3.5-flash-lite is served on
// `global` ONLY, so a leaf naming that model beside any other region is a policy
// that cannot run, however well-formed it looks.
test("every vertex worker leaf declares a region its model is actually served in", () => {
  const GLOBAL_ONLY = new Set(["gemini-3.5-flash-lite"]);
  for (const name of ["all-opus", "all-gemini-flash-high", "opus48-plus-lite",
                      "all-gemini-25-flash-high", "gemini35-plus-25-flash-high"]) {
    for (const w of leavesOf(policyDoc(name)).filter((m) => m.api === "vertex")) {
      assert.ok(w.region, `${name}: vertex leaf ${w.id} declares no region`);
      if (GLOBAL_ONLY.has(w.model_name))
        assert.equal(w.region, "global",
          `${name}: ${w.model_name} is served only on the global endpoint`);
    }
  }
});
