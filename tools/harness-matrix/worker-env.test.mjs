/**
 * worker-env.test.mjs — the Python side's configuration contract.
 *
 * WHY THIS FILE EXISTS (2026-07-31). Every Python entry point that talks to
 * Vertex used to carry the Google Cloud project this harness was developed
 * against, as a literal default:
 *
 *     PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "ai-studies-console")
 *
 * Inside one company that is a convenience. In a published repository it is a
 * defect with two failure modes, both bad: a reader who forgot the export gets
 * a Vertex permission error naming a project they have never heard of (the
 * message points nowhere near the real mistake), or — if they happen to hold
 * access — their run quietly bills an account that is not theirs.
 *
 * The fix is that an unset project is a configuration error, reported as one,
 * at $0, before any token is spent. These tests hold that contract from the
 * outside, the way the harness itself invokes these scripts.
 *
 * WHY .mjs FOR PYTHON CODE: the root test script is `node --test
 * "tools/**\/*.test.mjs"`, and a test nobody runs protects nothing. Each case
 * spawns the real script as a subprocess and reads its exit status and stderr.
 *
 * $0, offline, and no worker venv needed: the project check deliberately sits
 * ABOVE the `google.antigravity` import in each script, so it fires under any
 * stock Python 3. If no `python3` is on PATH the suite skips rather than
 * failing — an absent interpreter is an environment fact, not a regression.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON ?? "python3";

/** Is there any Python at all here? Probed once; absence skips, never fails. */
const pythonAvailable = spawnSync(PY, ["-c", "pass"], { encoding: "utf8" }).status === 0;

/**
 * Run a script with GOOGLE_CLOUD_PROJECT forcibly UNSET.
 *
 * The delete matters: this suite runs on developer machines that have the
 * variable exported, and inheriting it would turn every assertion below into a
 * silent pass.
 */
function runWithoutProject(relPath, args = []) {
  const env = { ...process.env };
  delete env.GOOGLE_CLOUD_PROJECT;
  return spawnSync(PY, [join(HERE, relPath), ...args], { encoding: "utf8", env });
}

const source = (relPath) => readFileSync(join(HERE, relPath), "utf8");

// Every entry point that can reach Vertex and spend money.
const VERTEX_ENTRY_POINTS = [
  ["gemini_worker.py", "gemini_worker"],
  ["sdk-probe/probe_vertex.py", "probe_vertex"],
  ["sdk-probe/probe_managed_agent.py", "probe_managed_agent"],
];

for (const [rel, name] of VERTEX_ENTRY_POINTS) {
  test(`${name} refuses to start without GOOGLE_CLOUD_PROJECT`, (t) => {
    if (!pythonAvailable) return t.skip(`no ${PY} on PATH`);
    const r = runWithoutProject(rel);
    assert.notEqual(r.status, 0, "an unset project must be a hard, visible failure");
    // The error has to name the variable AND the fix. "Permission denied on
    // project X" — the old behaviour — named neither.
    assert.match(r.stderr, /GOOGLE_CLOUD_PROJECT/,
      `stderr must name the variable; got: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stderr, /export GOOGLE_CLOUD_PROJECT=/,
      "stderr must show the exact command that fixes it");
  });

  test(`${name} carries no hardcoded Google Cloud project`, () => {
    // A defaulted project reintroduces the exact defect this suite exists for,
    // and it would not fail the test above if the default were spelled as a
    // fallback argument to os.environ.get.
    const src = source(rel);
    assert.doesNotMatch(src, /ai-studies-console/,
      "a specific Google Cloud project is hardcoded again");
    assert.doesNotMatch(src, /environ\.get\(\s*["']GOOGLE_CLOUD_PROJECT["']\s*,/,
      "GOOGLE_CLOUD_PROJECT must have NO default — an unset project is an error");
  });
}

test("the region keeps its pinned default, which the environment can override", () => {
  // The asymmetry with project is deliberate and worth pinning: a region is a
  // quota/performance choice with a known-good value (the global Gemini
  // endpoint was quota-starved 2026-07-16), not an identity. Removing this
  // default would break every policy that assumes the regional endpoint.
  for (const rel of ["gemini_worker.py", "sdk-probe/probe_vertex.py"]) {
    assert.match(source(rel), /environ\.get\(\s*["']GOOGLE_CLOUD_LOCATION["']\s*,\s*["']asia-south1["']/,
      `${rel} lost its region default`);
  }
});

// ---- --region: the policy's declaration outranks the ambient environment ----
// B-REGION regression guards (2026-07-31). The test above pins the DEFAULT; this
// one pins that the default can be beaten by the caller. Both matter, and they
// fail in opposite directions: lose the default and the sdk-probe scripts and
// one-off `export`-driven runs break; lose the override and a policy declaring
// `region: global` silently bills every token in asia-south1 — the state this
// worker shipped in until today, and the state in which the Flash-Lite pin
// (served on `global` only) would have 404'd on its first delegation.
test("gemini_worker accepts a --region that outranks GOOGLE_CLOUD_LOCATION", () => {
  const src = source("gemini_worker.py");
  // Declared, and declared OPTIONAL. A required flag here would break every
  // legacy (v1) policy replay, whose bindings carry no region at all.
  assert.match(src, /add_argument\(\s*["']--region["']\s*,\s*default=None/,
    "gemini_worker no longer accepts --region");
  // The precedence itself, in the one line that encodes it. `args.region or
  // LOCATION` is the whole contract: flag wins, env is the fallback.
  assert.match(src, /location\s*=\s*args\.region\s+or\s+LOCATION/,
    "the --region flag no longer takes precedence over the environment");
});

test("the worker's sidecar records the region it USED, not the one it inherited", () => {
  // The exact bug that made the defect invisible. The sidecar wrote the
  // module-level constant — the ambient GOOGLE_CLOUD_LOCATION — so the receipt
  // agreed with the environment no matter where the call actually went. A
  // provenance artifact that cannot contradict the environment cannot be
  // evidence of anything, which is why this is asserted as ABSENCE of the
  // constant rather than presence of the variable.
  const src = source("gemini_worker.py");
  assert.match(src, /"vertex_location":\s*location\b/,
    "the sidecar stopped recording the resolved location");
  assert.doesNotMatch(src, /"vertex_location":\s*LOCATION\b/,
    "the sidecar records the ambient env again, not the location actually used");
});

test("the offline probe never names a real project, and never overwrites one", () => {
  // probe_offline.py authenticates against nothing — it only checks that
  // VertexEndpoint reads its config from the environment. A real project id in
  // a file that never calls out is an identifier waiting to be copied into one
  // that does; and setdefault (not assignment) keeps it from stomping on the
  // reader's own export when they run the offline and live probes in sequence.
  const src = source("sdk-probe/probe_offline.py");
  assert.doesNotMatch(src, /ai-studies-console/);
  assert.match(src, /setdefault\(\s*["']GOOGLE_CLOUD_PROJECT["']\s*,\s*["']example-project-id["']/);
});

// ---------------------------------------------------------------------------
// The JS-side preflight holds the same contract (2026-07-31, post-P4b).
//
// The Python fail-fast above is necessary but arrives too late to be cheap:
// it fires inside the run, on the first delegation, after the driver has
// already spent paid turns. The 2026-07-31 SWE-bench Pro validation run
// proved it — the launch environment omitted GOOGLE_CLOUD_PROJECT, preflight
// passed (venv, import and ADC were all fine), and delegation 1 died on the
// worker's own guard; the driver then burned turns diagnosing the environment
// and exporting the variable itself. workerProjectError() is the $0 preflight
// twin of that guard: same contract, enforced before anything is spent. These
// tests import it directly — it is a pure function of the env object, which
// is precisely why it was extracted from preflight() instead of inlined.
// ---------------------------------------------------------------------------

test("preflight refuses a delegated cell without GOOGLE_CLOUD_PROJECT", async () => {
  const { workerProjectError } = await import("./runtimes.mjs");
  const msg = workerProjectError({});
  assert.ok(msg, "an unset project must produce an error, not null");
  assert.match(msg, /GOOGLE_CLOUD_PROJECT/,
    "the message must name the variable the reader has to set");
  assert.match(msg, /export GOOGLE_CLOUD_PROJECT=/,
    "the message must carry the literal fix, like every other preflight error");
});

test("preflight treats a whitespace-only project id as unset", async () => {
  // `GOOGLE_CLOUD_PROJECT="" node run-harness.mjs …` is the same mistake in a
  // costume: truthy enough to skip a naive `!env.X` check, still refused by
  // Vertex. The trim is the difference between catching it at $0 and mid-run.
  const { workerProjectError } = await import("./runtimes.mjs");
  assert.ok(workerProjectError({ GOOGLE_CLOUD_PROJECT: "   " }));
  assert.ok(workerProjectError({ GOOGLE_CLOUD_PROJECT: "" }));
});

test("preflight passes a delegated cell when the project id is set", async () => {
  const { workerProjectError } = await import("./runtimes.mjs");
  assert.equal(workerProjectError({ GOOGLE_CLOUD_PROJECT: "example-project-id" }), null);
});
