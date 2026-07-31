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
