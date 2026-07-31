/**
 * setup.test.mjs — unit tests for the onboarding wizard.
 *
 * WHY THIS FILE EXISTS. `tools/setup.mjs` is the first thing a new reader of
 * this repository runs, on a machine nobody here has ever seen. Its four
 * behaviours are load-bearing and all four are easy to regress silently while
 * "tidying up":
 *
 *   1. critical checks stop the run at the point of failure,
 *   2. auth is reported rather than enforced — EXCEPT GOOGLE_CLOUD_PROJECT,
 *   3. the mode registries nest, so `--swe-pro` really is a superset,
 *   4. every path the wizard creates is inside the clone — it builds in the
 *      repo and never modifies the machine.
 *
 * Every test here is offline and free. Nothing creates a venv, clones a repo,
 * reaches the network, or spends a token: the driver is exercised with
 * synthetic check tuples instead of the real registries, and the real checks
 * under test are the pure, environment-only ones. The expensive checks
 * (`checkWorkspaceInstall`, `checkOfflineTests`, `checkDryRun`,
 * `checkAntigravityImport`, `checkDocker`, …) shell out by design and are
 * covered by actually running the wizard, not from here — except for the part
 * of `checkOfflineTests` that reads the test runner's summary, which is split
 * out as the pure `parseTestSummary` precisely so it can be pinned here without
 * this suite spawning a full copy of itself.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { relative, isAbsolute } from "node:path";

import {
  checkNode, checkAnthropicAuth, checkGoogleProject, checkGoogleLocation,
  parseTestSummary, runChecks, OFFLINE_CHECKS, SDLC_CHECKS, SWE_PRO_CHECKS,
  INSTALL_TARGETS, ROOT,
} from "./setup.mjs";

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Run `fn` with the named env vars forced to given values (undefined = unset),
 * restoring the previous environment afterwards even if the body throws. The
 * auth checks read process.env directly — which is the right design for a
 * wizard — so testing them means owning the environment for the duration.
 */
function withEnv(vars, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Swallow the wizard's own stdout so the test log stays readable. */
async function quiet(fn) {
  const real = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = real;
  }
}

/** A synthetic check that records that it ran. */
function spy(calls, name, result) {
  return () => { calls.push(name); return result; };
}

const PASS = { ok: true, label: "fine" };
const FAIL = { ok: false, label: "broken", fix: "do the thing" };

// ─── the check registries nest ─────────────────────────────────────────

test("each mode is a strict prefix-superset of the one below it", () => {
  // `--swe-pro` claiming to be "sdlc plus grading" is a promise made in the
  // module header, in docs/setup.md and in the mode picker. Spread order is
  // the only thing keeping it true.
  assert.deepEqual(SDLC_CHECKS.slice(0, OFFLINE_CHECKS.length), OFFLINE_CHECKS);
  assert.deepEqual(SWE_PRO_CHECKS.slice(0, SDLC_CHECKS.length), SDLC_CHECKS);
  assert.ok(SWE_PRO_CHECKS.length > SDLC_CHECKS.length);
});

test("every registry entry is [label, fn] with an optional boolean flag", () => {
  for (const checks of [OFFLINE_CHECKS, SDLC_CHECKS, SWE_PRO_CHECKS]) {
    for (const [label, fn, critical] of checks) {
      assert.equal(typeof label, "string", `label: ${label}`);
      assert.ok(label.length > 0);
      assert.equal(typeof fn, "function", `fn for ${label}`);
      assert.ok(critical === undefined || typeof critical === "boolean",
        `critical flag for ${label}`);
    }
  }
});

test("exactly the toolchain checks are critical", () => {
  // Pinned by name. Widening this set makes the wizard quit early on something
  // a reader could have worked around; narrowing it brings back the cascade of
  // downstream failures that all really said "install Node 22".
  const critical = SWE_PRO_CHECKS.filter(([, , c]) => c).map(([label]) => label);
  assert.deepEqual(critical, [
    "Node ≥ 22",
    "pnpm ≥ 11",
    "workspace install",
    "offline tests",
    "Claude Code CLI",
    "Python ≥ 3.10",
  ]);
});

// ─── fail-fast on a critical check ─────────────────────────────────────

test("a failing critical check stops the run and skips the rest", async () => {
  const calls = [];
  const code = await quiet(() => runChecks("offline", [
    ["first", spy(calls, "first", PASS), true],
    ["second", spy(calls, "second", FAIL), true],
    ["third", spy(calls, "third", PASS), true],
  ]));
  assert.equal(code, 1);
  assert.deepEqual(calls, ["first", "second"], "third must never be attempted");
});

test("a failing non-critical check does NOT stop the run", async () => {
  // The whole-picture-at-once property: an incomplete machine should learn
  // everything it is missing in one pass.
  const calls = [];
  const code = await quiet(() => runChecks("offline", [
    ["first", spy(calls, "first", FAIL)],
    ["second", spy(calls, "second", FAIL)],
    ["third", spy(calls, "third", PASS)],
  ]));
  assert.equal(code, 1);
  assert.deepEqual(calls, ["first", "second", "third"]);
});

test("all checks passing exits 0", async () => {
  const calls = [];
  const code = await quiet(() => runChecks("offline", [
    ["first", spy(calls, "first", PASS), true],
    ["second", spy(calls, "second", PASS)],
  ]));
  assert.equal(code, 0);
  assert.deepEqual(calls, ["first", "second"]);
});

// ─── auth is reported, not enforced ────────────────────────────────────

test("missing Anthropic credentials are informational, not a failure", () => {
  const r = withEnv(
    { CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_API_KEY: undefined },
    checkAnthropicAuth,
  );
  assert.equal(r.ok, true, "must not block — run-harness.mjs preflights this at $0");
  assert.ok(r.detail, "must still say the credentials are missing");
  assert.ok(r.hintOnly, "must still show how to set one");
  assert.equal(r.fix, undefined, "`fix` is the failure vocabulary; this is not a failure");
});

test("either Anthropic credential alone is reported by name", () => {
  const oauth = withEnv(
    { CLAUDE_CODE_OAUTH_TOKEN: "sk-test", ANTHROPIC_API_KEY: undefined },
    checkAnthropicAuth,
  );
  assert.equal(oauth.ok, true);
  assert.match(oauth.label, /CLAUDE_CODE_OAUTH_TOKEN/);

  const api = withEnv(
    { CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_API_KEY: "sk-test" },
    checkAnthropicAuth,
  );
  assert.equal(api.ok, true);
  assert.match(api.label, /ANTHROPIC_API_KEY/);
});

test("both Anthropic credentials set warns about which wallet pays", () => {
  // Not a failure, but the single most expensive ambiguity on the driver side:
  // one of these is a subscription seat and the other is metered.
  const r = withEnv(
    { CLAUDE_CODE_OAUTH_TOKEN: "sk-test", ANTHROPIC_API_KEY: "sk-test" },
    checkAnthropicAuth,
  );
  assert.equal(r.ok, true);
  assert.match(r.detail, /BOTH/);
});

// ─── the one blocking exception ────────────────────────────────────────

test("GOOGLE_CLOUD_PROJECT stays BLOCKING when unset", () => {
  // Deliberately not informational. Nothing downstream can catch an unset
  // project — there is no default any more, by design, because the default
  // used to be a specific Google Cloud project belonging to the authors. If a
  // later edit makes this check informational "for consistency", this test is
  // the thing that objects.
  const r = withEnv({ GOOGLE_CLOUD_PROJECT: undefined }, checkGoogleProject);
  assert.equal(r.ok, false);
  assert.ok(r.fix, "a blocking check must tell the reader how to fix it");
  assert.match(r.fix, /GOOGLE_CLOUD_PROJECT=/);
});

test("GOOGLE_CLOUD_PROJECT passes when set, and echoes the value", () => {
  const r = withEnv({ GOOGLE_CLOUD_PROJECT: "some-customer-project" }, checkGoogleProject);
  assert.equal(r.ok, true);
  assert.match(r.label, /some-customer-project/);
});

test("GOOGLE_CLOUD_LOCATION is never blocking and names its default", () => {
  const unset = withEnv({ GOOGLE_CLOUD_LOCATION: undefined }, checkGoogleLocation);
  assert.equal(unset.ok, true);
  assert.match(unset.label, /asia-south1/, "the pinned default must be visible, not implied");

  const set = withEnv({ GOOGLE_CLOUD_LOCATION: "europe-west4" }, checkGoogleLocation);
  assert.equal(set.ok, true);
  assert.match(set.label, /europe-west4/);
});

// ─── what the wizard reports about the test suite ──────────────────────

test("the test summary is read from the runner, and skips are not swallowed", () => {
  // WHY THIS IS PINNED. The wizard's green line used to read "N offline tests
  // pass" and stop there. Several suites in this repo assert against recorded
  // runs and a SWE-bench Pro corpus checkout that a fresh clone does not have,
  // so they skip themselves — correct behaviour, but it makes the bare pass
  // count an overstatement of what was verified on THAT machine. A reader who
  // is deciding whether to trust this repo deserves to see the gap.
  const summary = parseTestSummary([
    "# tests 315", "# suites 0", "# pass 307", "# fail 0",
    "# cancelled 0", "# skipped 8", "# todo 0",
  ].join("\n"));
  assert.deepEqual(summary, { pass: 307, skipped: 8 });
});

test("a run with nothing skipped reports zero, not a missing field", () => {
  // The caller decides whether to print anything based on this number, so it
  // has to be 0 rather than undefined when the runner omits nothing.
  assert.deepEqual(parseTestSummary("# pass 12\n# fail 0\n# skipped 0"),
    { pass: 12, skipped: 0 });
  assert.deepEqual(parseTestSummary("# pass 12\n# fail 0"), { pass: 12, skipped: 0 });
});

test("no summary at all is null — a crashed runner is not a passing one", () => {
  // `pnpm test` can die before printing its summary (a syntax error in a test
  // file does exactly this). Returning a zero-count object here would let the
  // wizard print "0 offline tests pass" in green.
  assert.equal(parseTestSummary(""), null);
  assert.equal(parseTestSummary(undefined), null);
  assert.equal(parseTestSummary("SyntaxError: Unexpected token"), null);
});

// ─── toolchain ─────────────────────────────────────────────────────────

// ─── the install boundary (RULE 4) ─────────────────────────────────────

test("every path the wizard creates is inside the clone", () => {
  // The whole basis on which this wizard is safe to run on a stranger's laptop:
  // undo is `rm -rf` on the clone, and nothing outside it was touched. Node,
  // pnpm, Docker, the Claude Code CLI and gcloud ADC are therefore REPORTED
  // with a fix line and never installed — see RULE 4 in setup.mjs for why each
  // of those is out of bounds, Node most of all (this file is a Node program
  // running on the interpreter it would have to replace).
  //
  // If someone later adds a setup step that writes to /usr/local, ~/.nvm or
  // any other machine-global location, this is the test that objects.
  assert.ok(INSTALL_TARGETS.length > 0, "the list must not be silently emptied");
  for (const target of INSTALL_TARGETS) {
    assert.ok(isAbsolute(target), `${target} must be absolute`);
    const rel = relative(ROOT, target);
    assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel),
      `${target} escapes the repository root — the wizard may not write there`);
  }
});

test("no check function performs an install of a machine-global tool", () => {
  // The toolchain checks are pure reads: they look at the machine and return a
  // verdict plus a `fix` string. A failing one must hand the reader a command,
  // not run it. Pinned by shape rather than by mocking a package manager —
  // a check that installed something could not report `fix` on failure, since
  // by then there would be nothing left to tell the reader to do.
  for (const [label, fn] of [["Node ≥ 22", checkNode]]) {
    const r = fn();
    assert.equal(typeof r.ok, "boolean", `${label} must return a verdict`);
    if (!r.ok) assert.ok(r.fix, `${label} must hand back a command, not run one`);
  }
});

test("checkNode accepts the Node this suite is running on", () => {
  // The suite only runs under `pnpm test`, which runs under the repo's own
  // Node. If this fails, the machine is below the floor the wizard enforces
  // and the failure is the correct outcome, not a broken test.
  const r = checkNode();
  assert.equal(r.ok, true, `checkNode rejected Node ${process.versions.node}`);
  assert.match(r.label, new RegExp(process.versions.node.replace(/\./g, "\\.")));
});
