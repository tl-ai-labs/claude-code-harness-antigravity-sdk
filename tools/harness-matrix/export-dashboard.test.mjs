// End-to-end tests for export-dashboard.mjs — the script that turns harness run
// directories into everything the dashboard renders.
//
// WHY these are end-to-end rather than unit tests: the exporter is a CLI with
// top-level side effects (it parses process.argv and calls process.exit at
// module scope), so importing it would run it. Every test here therefore drives
// the REAL script as a subprocess, exactly the way a human does — which is also
// the only way to prove the two properties that matter most:
//
//   1. `--out` is honoured absolutely. The default output directory is the
//      dashboard's own `public/data`, i.e. checked-in files. A test that could
//      not redirect that would rewrite the repository every time it ran.
//   2. `--dry-run` writes nothing at all. It is the flag used to preview an
//      export before touching real study data, so "nothing written" has to be
//      literally true, not approximately true.
//
// The fixtures below are synthetic but shaped from a real run's manifest
// (the delegated navidrome cell). They are deliberately MINIMAL: the exporter
// documents every evidence file except manifest.json as optional, degrading to
// a dash rather than crashing, and that graceful-degradation claim is only
// worth anything if something exercises the degraded path.
//
// $0 and offline: no model, no docker, no network — run with
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test export-dashboard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER = join(HERE, "export-dashboard.mjs");

// ---- fixtures ---------------------------------------------------------------

/** One worker usage sidecar — the evidence that a call went through the SDK. */
const sidecar = () => ({
  model: "gemini-3.5-flash", thinking: "HIGH",
  usage: {
    prompt_token_count: 99657, cached_content_token_count: 73571,
    candidates_token_count: 980, thoughts_token_count: 1200, total_token_count: 101837,
  },
});

/**
 * A finished SWE-bench Pro run directory.
 *
 * `delegated` is the one axis that changes the accounting: with sidecars the
 * run has two wallets (driver + worker), without them it has one. Both shapes
 * are real — the single-seat cells produce the second.
 *
 * `audit` is the second axis, and it exists because the exporter has to keep
 * criticality alive across THREE different vintages of run directory:
 *   - "legacy"  — manifest carries the old bare `audit_flags: <int>` and there
 *                 is no audit.json to recover a critical count from;
 *   - "legacy+" — same bare integer, but audit.json sits beside it with the
 *                 full arrays, so the real breakdown is still recoverable;
 *   - an object — the current shape, written straight into the manifest.
 * A test that only ever exercised the current shape would not notice the
 * exporter silently publishing "0 critical" for a run that never knew.
 */
function proRun(root, { instance = "inst_x", policy = "all-opus", stamp = "2026-07-24T09-32-34",
  resolved = true, delegated = false, cost = 0.5, audit = null, auditJson = null } = {}) {
  const dir = join(root, instance, `claude-code--${policy}`, stamp);
  mkdirSync(dir, { recursive: true });
  if (auditJson) writeFileSync(join(dir, "audit.json"), JSON.stringify(auditJson, null, 2));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    study: "harness-swe-bench-pro",
    instance_id: instance, repo: "acme/widget", repo_language: "go",
    runtime: { name: "claude-code", version: "2.1.215 (Claude Code)" },
    policy: {
      name: policy, file: `policies/${policy}.yaml`, sha256: "abc",
      retry: { type: "flat", max_attempts: 3 },
      limits: { phase_timeout_min: 45, cmd_timeout_min: 15, phase_budget_usd: 8 },
    },
    base_image: "img:base", sealed_image: "img:sealed",
    phases: [{
      phase: "repro", model_id: "claude-opus-4-6", binding: "driver", thinking: "n/a", passed: true,
      attempts: [{
        attempt: 1, exit_code: 0, timed_out: false, wall_seconds: 350,
        cost_usd: cost, num_turns: 13, resolved_model: "claude-opus-4-6",
        delegation_calls: delegated ? 3 : 0,
        worker_usage: delegated
          ? { available: true, calls: 3, sidecars: [sidecar()] }
          : { available: false, calls: 0, sidecars: [] },
        gate: { pass: true, reason: null, warnings: [], artifacts_cleaned: [], repro_exit: 1 },
      }],
    }],
    failed_at: null,
    patch: { files_kept: ["a.go"], files_stripped: [] },
    totals: { attempts: 1, wall_seconds: 350, cost_usd: cost, cost_basis: "DRIVER ONLY" },
    // Default is the LEGACY bare integer on purpose — most fixtures here are
    // about other properties, and leaving them legacy keeps a permanent test
    // of the backwards-compatible path. `audit` overrides it with the current
    // `{ audit_flags, integrity_warnings, audit_coverage }` block.
    ...(audit ?? { audit_flags: 0 }),
    started_at: `${stamp.slice(0, 10)}T09:32:34Z`, finished_at: `${stamp.slice(0, 10)}T09:38:24Z`,
  }, null, 2));
  writeFileSync(join(dir, "grade-verdict.json"), JSON.stringify({
    instance_id: instance, resolved, grader: "local docker", raw: { [instance]: resolved },
  }));
  return dir;
}

/** A scratch workspace with `runs/` and `out/`, removed when the test ends. */
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "export-dash-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, runs: join(root, "runs"), out: join(root, "out") };
}

const run = (args) => spawnSync(process.execPath, [EXPORTER, ...args], { encoding: "utf8" });

const filesUnder = (dir) => {
  const out = [];
  const walk = (d, prefix = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${prefix}${e.name}/`);
      else out.push(prefix + e.name);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
};

// ---- the argument guards ----------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const r = run([]);
  assert.notEqual(r.status, 0, "exporter exited 0 with no input");
  assert.match(r.stderr, /usage: node export-dashboard\.mjs/);
});

test("a runs-root holding no run directory fails loudly and names the path", () => {
  const t = mkdtempSync(join(tmpdir(), "export-dash-empty-"));
  try {
    const r = run(["--runs-root", t, "--out", join(t, "out")]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no run directory .*found under/);
    assert.match(r.stderr, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("a run-dir without a manifest is rejected rather than half-exported", (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws.runs, "not-a-run"), { recursive: true });
  const r = run(["--run-dir", join(ws.runs, "not-a-run"), "--out", ws.out]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no manifest\.json in/);
  assert.equal(existsSync(ws.out), false, "a rejected run still created the output tree");
});

// ---- --dry-run and --out: the two safety properties -------------------------

test("--dry-run reports the full export but writes absolutely nothing", (t) => {
  const ws = workspace(t);
  const dir = proRun(ws.runs, { delegated: true });
  const r = run(["--run-dir", dir, "--out", ws.out, "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--dry-run: nothing written/);
  assert.match(r.stdout, /instances\.json/, "dry-run must still preview what it would write");
  assert.equal(existsSync(ws.out), false, "--dry-run created the output directory");
});

test("--out redirects every write, so an export never touches the dashboard's data", (t) => {
  const ws = workspace(t);
  const r = run(["--run-dir", proRun(ws.runs), "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);
  // Everything written lives under the directory we asked for — proven by the
  // fact that the run reported writing files and they are all here.
  const files = filesUnder(ws.out);
  assert.ok(files.length >= 5, `expected a full export, got ${files.join(", ")}`);
  assert.match(r.stdout, /wrote \d+ file\(s\)/);
});

// ---- a full export ----------------------------------------------------------

test("a single Pro run exports the whole set of dashboard artifacts", (t) => {
  const ws = workspace(t);
  const r = run(["--run-dir", proRun(ws.runs), "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);

  const files = filesUnder(ws.out);
  assert.ok(files.includes("studies.json"), "registry not written");
  for (const want of ["telemetry.jsonl", "manifest.json", "instances.json", "policy_snapshot.yaml"]) {
    assert.ok(files.some((f) => f.endsWith(want)), `${want} missing from ${files.join(", ")}`);
  }
  assert.ok(files.some((f) => f.endsWith("brief.md")), "study brief not written");
});

test("the run's own policy snapshot ships beside it, so limits are readable per run", (t) => {
  // This is the mechanism that keeps runs made under different limits honest:
  // each column carries the policy it actually ran under instead of inheriting
  // whatever the policy file says today.
  //
  // ASSERTING CONTENT, NOT JUST EXISTENCE (2026-07-26). This case used
  // to check only that a file was written — and the file is ALWAYS written,
  // because a policy that cannot be found falls back to a two-line stub. So it
  // passed for months while every column shipped that stub: the manifest
  // records the path relative to the harness directory and the exporter joined
  // it to the repo root, which never resolved. The Implementation Approach tab
  // renders this file as its policy exhibit, so the bug's whole visible form
  // was an empty code block. Pin the body.
  const ws = workspace(t);
  run(["--run-dir", proRun(ws.runs), "--out", ws.out]);
  const snap = filesUnder(ws.out).find((f) => f.endsWith("policy_snapshot.yaml"));
  assert.ok(snap, "no policy snapshot");
  const body = readFileSync(join(ws.out, snap), "utf8");
  assert.ok(!body.includes("not found at export time"),
    `policy snapshot is the not-found stub, so the tab has no policy exhibit:\n${body}`);
  // HERE is the harness directory — the same base the exporter must resolve
  // `policies/…` against, which is the whole point of the fix being tested.
  const real = readFileSync(join(HERE, "policies", "all-opus.yaml"), "utf8");
  assert.equal(body, real, "policy snapshot is not byte-true to the file that ran");
});

test("a policy file that cannot be found writes a stub AND says so out loud", (t) => {
  // The stub is the right behaviour — a missing policy does not invalidate the
  // column's telemetry — but it must never be quiet, because the reader of the
  // dashboard cannot tell an empty exhibit from a policy with nothing in it.
  const ws = workspace(t);
  sdlcRun(ws.runs, { policy: "policy-that-does-not-exist" });
  const r = run(["--runs-root", ws.runs, "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING\s+: policy file/,
    `a missing policy file exported silently:\n${r.stdout}`);
  const snap = filesUnder(ws.out).find((f) => f.endsWith("policy_snapshot.yaml"));
  assert.match(readFileSync(join(ws.out, snap), "utf8"), /not found at export time/);
});

test("the exported manifest names the agent runtime that drove the run", (t) => {
  // `harness.runtime` is what the dashboard's Compare view keys on to answer
  // "what drove this run end to end". It is the RIGHT test for harness-vs-
  // orchestrator because an orchestrator-track manifest simply has no such
  // field — the SDLC orchestrator (a separate application that feeds the same
  // dashboard) walks the template's stages itself and no agent CLI is involved
  // anywhere in it.
  //
  // Pinned because the failure is silent and was real: that row used to render
  // a hardcoded "Claude Code" in every column, so four orchestrator SDLC runs
  // claimed an agent CLI drove them. Nothing errored and nothing looked odd —
  // it just asserted the opposite of the finding the harness study exists to
  // show. If this field stops being written, the view now degrades the other
  // way and calls a harness run "Console orchestrator", which is equally
  // wrong and equally quiet.
  const ws = workspace(t);
  run(["--run-dir", proRun(ws.runs), "--out", ws.out]);
  const rel = filesUnder(ws.out).find((f) => f.endsWith("manifest.json"));
  assert.ok(rel, "no manifest was exported at all");
  const manifest = JSON.parse(readFileSync(join(ws.out, rel), "utf8"));
  assert.equal(manifest.harness?.runtime?.name, "claude-code",
    "a harness export must name its runtime, not leave the view to guess");
  assert.match(manifest.harness.runtime.version ?? "", /^2\.1\.215/,
    "the runtime version must survive the export — it is what the row prints");
});

test("the registry lists the exported study", (t) => {
  const ws = workspace(t);
  run(["--run-dir", proRun(ws.runs), "--out", ws.out]);
  const registry = JSON.parse(readFileSync(join(ws.out, "studies.json"), "utf8"));
  const blob = JSON.stringify(registry);
  assert.match(blob, /harness-swe-bench-pro/);
});

// ---- the two-wallet accounting ---------------------------------------------

test("a delegated run reports driver and worker as two wallets, never one blended total", (t) => {
  const ws = workspace(t);
  const r = run(["--run-dir", proRun(ws.runs, { delegated: true }), "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split("\n").find((l) => l.startsWith("cost"));
  assert.ok(line, "no cost line in the export summary");
  assert.match(line, /driver \$\d+\.\d{4} \+ worker \$\d+\.\d{4} = \$\d+\.\d{4}/, line);

  const m = line.match(/driver \$([\d.]+) \+ worker \$([\d.]+) = \$([\d.]+)/);
  const [driver, worker, total] = m.slice(1).map(Number);
  assert.ok(worker > 0, "delegated run priced its worker tokens at zero");
  assert.equal((driver + worker).toFixed(4), total.toFixed(4), "wallets do not sum to the total");
});

test("a single-seat run reports a zero worker wallet rather than omitting it", (t) => {
  // A missing worker line and a $0 worker line mean different things. The cell
  // genuinely spent nothing on a worker, and the accounting says so out loud.
  const ws = workspace(t);
  const r = run(["--run-dir", proRun(ws.runs, { delegated: false }), "--out", ws.out]);
  assert.match(r.stdout, /worker \$0\.0000/);
});

test("worker cost comes from the sidecar's own token counts", (t) => {
  // Doubling the worker's tokens must move the worker wallet and leave the
  // driver wallet untouched — i.e. the two are computed from separate evidence,
  // which is the entire claim the cost split makes.
  const ws = workspace(t);
  const one = run(["--run-dir", proRun(ws.runs, { delegated: true }), "--out", ws.out]);
  const workerOf = (out) => Number(out.match(/worker \$([\d.]+)/)[1]);
  const driverOf = (out) => Number(out.match(/driver \$([\d.]+)/)[1]);

  const ws2 = workspace(t);
  const dir = proRun(ws2.runs, { delegated: true });
  const mPath = join(dir, "manifest.json");
  const man = JSON.parse(readFileSync(mPath, "utf8"));
  man.phases[0].attempts[0].worker_usage.sidecars.push(sidecar());   // second call
  writeFileSync(mPath, JSON.stringify(man, null, 2));
  const two = run(["--run-dir", dir, "--out", ws2.out]);

  assert.equal(driverOf(two.stdout), driverOf(one.stdout), "driver wallet moved with worker tokens");
  assert.ok(workerOf(two.stdout) > workerOf(one.stdout), "worker wallet ignored the second sidecar");
});

// ---- instances.json: the per-instance evidence the Instances tab reads ------

test("instances.json records the verdict and the per-phase cost split", (t) => {
  const ws = workspace(t);
  run(["--run-dir", proRun(ws.runs, { delegated: true, resolved: true }), "--out", ws.out]);
  const p = filesUnder(ws.out).find((f) => f.endsWith("instances.json"));
  const inst = JSON.parse(readFileSync(join(ws.out, p), "utf8"));

  assert.equal(inst.totals.instances, 1);
  assert.equal(inst.instances.length, 1);
  const one = inst.instances[0];
  assert.equal(one.id, "inst_x");
  assert.equal(one.repo, "acme/widget");
  assert.equal(one.language, "go");

  const phase = one.cost_by_phase.find((c) => c.phase === "repro");
  assert.ok(phase, "no per-phase cost entry");
  assert.ok(phase.driver_cost_usd > 0 && phase.worker_cost_usd > 0,
    "per-phase split lost one of the two wallets");
  assert.deepEqual(phase.worker_models, ["gemini-3.5-flash"],
    "the worker model must be derived from evidence, not typed");
});

test("an unresolved instance is counted as unresolved, never rounded up", (t) => {
  const ws = workspace(t);
  run(["--run-dir", proRun(ws.runs, { resolved: false }), "--out", ws.out]);
  const p = filesUnder(ws.out).find((f) => f.endsWith("instances.json"));
  const inst = JSON.parse(readFileSync(join(ws.out, p), "utf8"));
  assert.equal(inst.totals.resolved, 0);
  assert.equal(inst.totals.unresolved, 1);
});

// ---- batching: many runs, one column ---------------------------------------

test("--runs-root discovers runs at whatever depth the harness nested them", (t) => {
  const ws = workspace(t);
  proRun(ws.runs, { instance: "inst_a" });
  proRun(ws.runs, { instance: "inst_b" });
  const r = run(["--runs-root", ws.runs, "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 run\(s\)/, "both runs should land in one batch");
});

test("a batch of instances exports as one column, not one column per instance", (t) => {
  // The unit of export is the BATCH — that is what makes a 12-instance pass a
  // single dated column on the dashboard instead of twelve.
  const ws = workspace(t);
  proRun(ws.runs, { instance: "inst_a", resolved: true });
  proRun(ws.runs, { instance: "inst_b", resolved: false });
  run(["--runs-root", ws.runs, "--out", ws.out]);

  const passDirs = readdirSync(join(ws.out, "studies", "harness-swe-bench-pro"), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  assert.equal(passDirs.length, 1, `expected one pass, got ${passDirs.join(", ")}`);

  const inst = JSON.parse(readFileSync(
    join(ws.out, "studies", "harness-swe-bench-pro", passDirs[0], "instances.json"), "utf8"));
  assert.equal(inst.totals.instances, 2);
  assert.equal(inst.totals.resolved, 1);
  assert.equal(inst.totals.unresolved, 1);
});

test("re-exporting the same batch is idempotent", (t) => {
  // Exports get re-run constantly while a dashboard change is being checked;
  // the second run must replace the column, not append a second one.
  const ws = workspace(t);
  const dir = proRun(ws.runs);
  run(["--run-dir", dir, "--out", ws.out]);
  const first = filesUnder(ws.out);
  run(["--run-dir", dir, "--out", ws.out]);
  assert.deepEqual(filesUnder(ws.out), first, "a repeat export changed the output tree");
});

// ---- labels carry the year --------------------------------------------------

test("every run label carries its year", (t) => {
  // Decided deliberately: these cards are the durable artifact and are shown
  // long after the run, so a column reading "24 Jul 09:32" is undated the
  // moment the portfolio outlives the year that produced it.
  const ws = workspace(t);
  const r = run(["--run-dir", proRun(ws.runs, { stamp: "2026-07-24T09-32-34" }), "--out", ws.out]);
  assert.match(r.stdout, /24 Jul 2026/);
  assert.doesNotMatch(r.stdout, /\b24 Jul 09:32\b/, "a label lost its year");
});

// ---- the SDLC path ----------------------------------------------------------
// Everything above drives SWE-bench Pro runs. The SDLC kind is the OTHER half
// of the exporter and had no coverage at all, which is how a study-card change
// for it could ship unverified. These cases pin the two facts the dashboard
// routes on: the vertical (which picks the Implementation Approach narrative and
// the Compare tab) and the card colour (which is the only thing separating two
// harness tiles on the Portfolio grid).

/**
 * A finished delegated SDLC run directory, shaped from the real kudos-wall
 * manifest. `workers` drives how many distinct worker bindings the column used
 * — one for a clean single-generation column, two for a tiered one.
 */
function sdlcRun(root, { task = "kudos-wall", policy = "all-gemini-flash-high",
  stamp = "2026-07-26T06-10-19", workers = ["gemini-3.5-flash"], cost = 1.5,
  audit = null, auditJson = null } = {}) {
  const dir = join(root, task, `claude-code--${policy}`, stamp);
  mkdirSync(dir, { recursive: true });
  if (auditJson) writeFileSync(join(dir, "audit.json"), JSON.stringify(auditJson, null, 2));
  const stage = (name, worker) => ({
    stage: name, executor: "llm-task", model_id: "tier", thinking: "high", passed: true,
    binding: { driver: "claude-opus-4-6", worker },
    attempts: [{
      attempt: 1, exit_code: 0, timed_out: false, wall_seconds: 100,
      cost_usd: cost, num_turns: 10, resolved_model: "claude-opus-4-6",
      delegation_calls: 1,
      worker_usage: { available: true, calls: 1, sidecars: [sidecar()], task_files: [] },
      gate: { pass: true, reason: null, warnings: [], artifacts_cleaned: [] },
    }],
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    study: "harness-matrix", kind: "sdlc", task_id: task,
    template: { id: "sdlc-mini", version: "0.8.0", file: "templates/sdlc-mini/template.yaml", sha256: "t" },
    scaffold: { id: "service-web", version: "0.2.0" },
    brief_sha256: "b",
    runtime: { name: "claude-code", version: "2.1.215 (Claude Code)" },
    policy: {
      name: policy, file: `policies/${policy}.yaml`, sha256: "abc",
      retry: { type: "flat", max_attempts: 3 },
      limits: { phase_timeout_min: 45, cmd_timeout_min: 15, phase_budget_usd: 8 },
    },
    env_image: "sdlc-env:node22", prompt_fields: [],
    // One stage per worker binding, so a tiered column really does report two.
    stages: workers.map((w, i) => stage(i === 0 ? "requirements" : "execute", w)),
    failed_at: null,
    delivery: { files_changed: ["src/modules/kudos/kudos.service.ts"] },
    judge_scores: { requirements_fidelity: 9, code_quality: 9, test_quality: 7, overall: 8.5 },
    totals: { attempts: workers.length, wall_seconds: 100, cost_usd: cost, cost_basis: "DRIVER ONLY" },
    // Legacy bare integer by default, same reasoning as proRun above.
    ...(audit ?? { audit_flags: 0 }),
    started_at: `${stamp.slice(0, 10)}T06:10:19Z`, finished_at: `${stamp.slice(0, 10)}T06:40:19Z`,
  }, null, 2));
  return dir;
}

test("an SDLC run exports as the SDLC vertical, which is what routes its tabs", (t) => {
  // `vertical` is not decoration: the dashboard reads it to choose the
  // Implementation Approach narrative and to decide whether Compare Runs
  // exists. An SDLC column stamped as a benchmark would lose the one tab its
  // two columns were run to fill.
  const ws = workspace(t);
  sdlcRun(ws.runs);
  const r = run(["--runs-root", ws.runs, "--out", ws.out]);
  assert.equal(r.status, 0, r.stderr);
  const registry = JSON.parse(readFileSync(join(ws.out, "studies.json"), "utf8"));
  const study = registry.studies.find((s) => s.vertical === "SDLC");
  assert.ok(study, `no SDLC study in registry: ${JSON.stringify(registry.studies.map((s) => s.vertical))}`);
});

test("the SDLC card does not reuse the SWE-bench Pro card's colour", (t) => {
  // Both harness tracks are Claude-driven, so both "deserve" coral — and two
  // coral tiles on the Portfolio grid read as one study exported twice. Pro
  // keeps coral because it has already shipped; the SDLC card takes the
  // palette's other Anthropic-family token.
  // Two roots, one output. A single root holding both kinds is not a case the
  // exporter accepts (a batch is one kind), so the colours have to be compared
  // the way they actually arrive in the registry: two exports, merged.
  const ws = workspace(t);
  const sdlcRoot = join(ws.root, "runs-sdlc"), proRoot = join(ws.root, "runs-pro");
  sdlcRun(sdlcRoot);
  const a = run(["--runs-root", sdlcRoot, "--out", ws.out]);
  assert.equal(a.status, 0, a.stderr);
  proRun(proRoot, { instance: "inst_pro", delegated: true });
  const b = run(["--runs-root", proRoot, "--out", ws.out]);
  assert.equal(b.status, 0, b.stderr);

  const registry = JSON.parse(readFileSync(join(ws.out, "studies.json"), "utf8"));
  const byVertical = Object.fromEntries(registry.studies.map((s) => [s.vertical, s.headerColor]));
  assert.equal(byVertical["SDLC"], "terracotta");
  assert.equal(byVertical["SWE-bench Pro"], "coral");
});

test("a delegated SDLC column publishes the cable the harness variant routes on", (t) => {
  // `manifest.harness.cable` is the ONLY signal that separates the delegated
  // SDLC card from the SDLC orchestrator's own cards, and choosing
  // wrong there renders a page about subagents and an MCP bridge that never
  // existed. If this field stops shipping, that page silently comes back.
  const ws = workspace(t);
  sdlcRun(ws.runs);
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const files = filesUnder(ws.out);
  const manifestPath = files.find((f) => f.endsWith("manifest.json"));
  const manifest = JSON.parse(readFileSync(join(ws.out, manifestPath), "utf8"));
  assert.ok(manifest.harness?.cable, `no harness.cable on the exported manifest: ${Object.keys(manifest)}`);
});

// ---- the delegated SDLC study brief -----------------------------------------
//
// WHAT THIS CARD INHERITS, AND WHY IT IS TESTED (2026-07-26). The
// delegated SDLC card has two parents and takes a different thing from each:
// the PROJECT SPEC from an orchestrator SDLC card (uptime-ping opens with the
// endpoint it had to build), and the delegated-track framing from the
// Claude Code × Antigravity SDK · SWE-bench Pro card. Both halves are silent
// failures if they regress — a brief that drops the spec still renders as a
// perfectly confident document about a study whose subject is missing.

const readBrief = (out) => {
  const p = filesUnder(out).find((f) => f.endsWith("brief.md"));
  assert.ok(p, "no study brief written");
  return readFileSync(join(out, p), "utf8");
};

test("the delegated SDLC brief opens with the task spec, word for word", (t) => {
  // The inheritance from the orchestrator's SDLC cards. Without this the card answers
  // "what did it cost" and "how was it wired" but never "what was it asked to
  // build" — which is the first question an SDLC reader arrives with, and the
  // only one the cost numbers are meaningless without.
  const ws = workspace(t);
  sdlcRun(ws.runs);
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const brief = readBrief(ws.out);

  const spec = readFileSync(join(HERE, "..", "..", "examples", "kudos-wall", "brief.md"), "utf8").trim();
  // Every non-heading line of the real spec must appear verbatim. Heading lines
  // are exempt because the reproduction lifts the title into the section header
  // and demotes the rest so a task's `## Scope` cannot outrank the study
  // brief's own sections — the WORDS are exact, the levels are typography.
  const specLines = spec.split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const line of specLines) {
    assert.ok(brief.includes(line), `task spec line missing from the study brief: ${line}`);
  }
  assert.match(brief, /^## The task/m, "no task section in the delegated SDLC brief");
});

test("the delegated SDLC brief states what ran, instead of hedging over both shapes", (t) => {
  // The generic SDLC brief describes "two shapes of cell — single-seat OR
  // delegated" because a single-seat column really can be either. Every column
  // that reaches this card is delegated, and the card's own label, description
  // and cable strip all say so — a brief that hedged would be the only surface
  // on the page unsure of what it ran.
  const ws = workspace(t);
  sdlcRun(ws.runs);
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const brief = readBrief(ws.out);
  assert.ok(!/single-seat/i.test(brief), "the delegated brief still hedges about single-seat cells");
  // …and it must carry the framing inherited from the SWE-bench Pro card.
  assert.match(brief, /cannot (edit files|write)/i, "no delegation contract in the brief");
  assert.match(brief, /Two wallets/i, "no two-wallet cost accounting in the brief");
  // …plus the two sections neither parent has.
  assert.match(brief, /^## What the worker is allowed to touch/m, "no slot-discipline section");
  assert.match(brief, /^## How a delivery is scored/m, "no judge section");
});

test("a second task adds its spec to the brief rather than replacing the first", (t) => {
  // The brief is study-level and is rewritten from whichever batch was exported
  // last. If it only ever described THAT batch, exporting a second task would
  // quietly delete the first task's spec from the card while both columns
  // stayed on it — the reader would then see a column whose subject is
  // undocumented. Task ids are collected from every column's own manifest.
  const ws = workspace(t);
  const first = join(ws.root, "runs-a"), second = join(ws.root, "runs-b");
  sdlcRun(first, { task: "kudos-wall" });
  assert.equal(run(["--runs-root", first, "--out", ws.out]).status, 0);
  sdlcRun(second, { task: "uptime-ping", policy: "gemini35-plus-25-flash-high",
    stamp: "2026-07-26T08-00-00" });
  const r = run(["--runs-root", second, "--out", ws.out, "--rewrite-brief"]);
  assert.equal(r.status, 0, r.stderr);

  const brief = readBrief(ws.out);
  assert.match(brief, /^## The tasks/m, "a two-task card still uses the single-task heading");
  for (const task of ["kudos-wall", "uptime-ping"]) {
    const spec = readFileSync(join(HERE, "..", "..", "examples", task, "brief.md"), "utf8").trim();
    const firstBodyLine = spec.split("\n").map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    assert.ok(brief.includes(firstBodyLine), `${task}'s spec is not in the brief`);
  }
});

// ---- the SWE-bench Pro study brief ------------------------------------------
//
// WHY THESE ARE HERE (2026-07-31). The Pro brief used to render from a
// shared template, `tools/lib/benchmark-brief.mjs`, and was tested there over
// every {Verified, Pro} × {orchestrator, harness} combination. Three of those
// four are unreachable from this repository, so the template was inlined into
// the exporter and its two surviving properties moved here — where they are now
// checked against the file the exporter actually WRITES, which is what a reader
// sees, rather than against the string a helper returned.
//
// Both properties fail silently. A brief that drops or reorders a section still
// renders as a perfectly confident document, and a brief that absorbs one
// batch's numbers looks right on the day it is written and is wrong the day the
// next batch lands.

/** The `##` section headings of a brief, in order. */
const outline = (md) => md.split("\n").filter((l) => l.startsWith("## "));

test("the Pro brief walks one section outline whether the cell is delegated or single-seat", (t) => {
  // The two shapes fill different paragraphs into the SAME outline. Letting one
  // of them grow a section the other lacks is how two descriptions of one
  // benchmark start to look like descriptions of two benchmarks.
  const a = workspace(t), b = workspace(t);
  assert.equal(run(["--run-dir", proRun(a.runs, { delegated: true }), "--out", a.out]).status, 0);
  assert.equal(run(["--run-dir", proRun(b.runs, { delegated: false }), "--out", b.out]).status, 0);

  const delegatedBrief = readBrief(a.out), singleSeat = readBrief(b.out);
  assert.deepEqual(outline(delegatedBrief), outline(singleSeat),
    "the delegated and single-seat Pro briefs no longer walk the same outline");
  assert.deepEqual(outline(delegatedBrief), [
    "## One-line summary",
    "## What this study is",
    "## What SWE-bench Pro is",
    "## What one instance run does",
    "## How patches are authored",
    "## How verdicts are graded",
    "## How cost is accounted",
    "## Integrity",
    "## Where the numbers are",
  ], "the Pro brief's section outline changed");
});

test("the Pro brief states its cell shape and never hedges over the other one", (t) => {
  // A delegated column's headline claim is that the driver could not have
  // written the patch. A single-seat column's is the opposite — one agent, one
  // wallet. A brief carrying both sentences would be the only surface on the
  // page unsure of what it ran.
  const a = workspace(t), b = workspace(t);
  run(["--run-dir", proRun(a.runs, { delegated: true }), "--out", a.out]);
  run(["--run-dir", proRun(b.runs, { delegated: false }), "--out", b.out]);

  const delegatedBrief = readBrief(a.out), singleSeat = readBrief(b.out);
  assert.match(delegatedBrief, /Antigravity SDK/, "the delegated brief does not name the cable");
  assert.match(delegatedBrief, /cannot\s+edit files/, "no delegation contract in the delegated brief");
  assert.ok(!/single-seat/i.test(delegatedBrief), "the delegated brief hedges about single-seat cells");

  assert.match(singleSeat, /single-seat/i, "the single-seat brief does not say so");
  assert.ok(!/Antigravity SDK/.test(singleSeat),
    "the single-seat brief claims a worker SDK that never ran");
});

test("no Pro brief carries an instance id, a count, a seed, a date or a dollar", (t) => {
  // The rule this brief exists to enforce. The generator it replaced was
  // titled "SWE-bench Pro × 12 instance(s)" and listed the seed and all twelve
  // ids inline, which made the study's DESCRIPTION a run artifact: correct for
  // exactly one batch, stale for every batch after it. The brief takes no
  // argument through which any of those could arrive, and this is the test that
  // notices when somebody adds one.
  const ws = workspace(t);
  proRun(ws.runs, { instance: "inst_alpha", stamp: "2026-07-24T09-32-34", cost: 4.25 });
  proRun(ws.runs, { instance: "inst_beta", stamp: "2026-07-24T10-00-00", cost: 1.5 });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);

  const brief = readBrief(ws.out);
  for (const id of ["inst_alpha", "inst_beta"]) {
    assert.ok(!brief.includes(id), `the brief names instance ${id}`);
  }
  assert.ok(!/\$\s?\d/.test(brief), "the brief carries a dollar amount");
  assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(brief), "the brief carries a run date");
  assert.ok(!/\bseeds?\b/i.test(brief), "the brief carries a sampling seed");
  assert.ok(!/\b\d+\s+instances?\b/i.test(brief), "the brief carries an instance count");
});

// ---- audit criticality, from the run directory to the dashboard -------------
//
// The exporter used to publish `audit_flags: <one summed integer>`. A sum is
// the worst possible shape for this number: a column of twelve instances with
// one critical between them and a column with none both collapse to a plain
// integer, and no reader can tell them apart. The tests below pin the three
// things that fix has to get right, because each one fails SILENTLY — a
// wrong answer here still renders a confident, well-formed dashboard.
//
//   1. a current run publishes total / critical / by_family, per column AND
//      per instance row;
//   2. a run that cannot know its critical count publishes null, never 0;
//   3. a legacy run that still has its audit.json gets its REAL breakdown
//      recovered from it, rather than being written off as unknowable.

/** The full audit.json shape, with whatever flags/warnings a test needs. */
const auditFile = ({ flags = [], warnings = [], handoffs = 0, checked = true } = {}) => ({
  runtime: "claude-code", auditable: true, delegated: true,
  skipped_check_families: [], delegation_policy_checked: true,
  delegation_content_checked: checked,
  flags, integrity_warnings: warnings,
  bashCount: 10, editCount: 0, handoffs_scanned: handoffs, files: ["execute-a1.trajectory.jsonl"],
});

/** The manifest-side block, written the way manifestAuditBlock writes it. */
const auditBlock = ({ flags = {}, warnings = {}, handoffs = 0, checked = true } = {}) => ({
  audit_flags: { total: Object.values(flags).reduce((a, b) => a + b, 0), critical: 0, by_family: flags },
  integrity_warnings: {
    total: Object.values(warnings).reduce((a, b) => a + b, 0), critical: 0, by_family: warnings,
  },
  audit_coverage: {
    auditable: true, handoffs_scanned: handoffs, delegation_content_checked: checked,
    delegation_policy_checked: true, skipped_check_families: [],
  },
});

const readPassManifest = (out) => {
  const p = filesUnder(out).find((f) => f.endsWith("manifest.json"));
  assert.ok(p, "no pass manifest written");
  return JSON.parse(readFileSync(join(out, p), "utf8"));
};

test("a column publishes its audit as total/critical/by_family, not one lump", (t) => {
  const ws = workspace(t);
  sdlcRun(ws.runs, {
    audit: auditBlock({ flags: { "driver-predelegation-inspection": 2 }, handoffs: 4 }),
  });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const m = readPassManifest(ws.out);

  assert.equal(m.harness.audit.flags.total, 2);
  assert.equal(m.harness.audit.flags.critical, 0);
  assert.deepEqual(m.harness.audit.flags.by_family, { "driver-predelegation-inspection": 2 });
  assert.equal(m.harness.audit.coverage.handoffs_scanned, 4);
  // The flat integer stays, so nothing downstream that reads a number breaks.
  assert.equal(m.harness.audit_flags, 2);
});

test("a critical finding survives to the column instead of averaging away", (t) => {
  // The whole point of the breakdown. One flagged run in a two-run column has
  // to leave the column marked; if it did not, the column would present as
  // clean and the finding would exist only inside a file nobody opens.
  const ws = workspace(t);
  sdlcRun(ws.runs, { task: "kudos-wall", auditJson: auditFile({
    warnings: [{ family: "guard-evasion-by-proxy", critical: true, evidence: "git checkout -- x" }],
    handoffs: 6,
  }) });
  sdlcRun(ws.runs, { task: "uptime-ping", stamp: "2026-07-26T07-00-00",
    auditJson: auditFile({ handoffs: 5 }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const m = readPassManifest(ws.out);

  assert.equal(m.harness.audit.integrity_warnings.total, 1);
  assert.equal(m.harness.audit.integrity_warnings.critical, 1);
  assert.deepEqual(m.harness.audit.integrity_warnings.by_family, { "guard-evasion-by-proxy": 1 });
  assert.match(m.harness.audit.note, /1 critical finding/);
  // And the reader can find WHICH run without leaving the manifest.
  const flagged = m.harness.runs.filter((r) => r.integrity_warnings.critical > 0);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].subject_id, /kudos-wall/);
});

test("a run that cannot know its critical count reports unknown, never zero", (t) => {
  // The legacy path with NO audit.json beside it: the manifest holds a bare
  // integer and the information needed to answer "was any of it critical?"
  // was never written down. Publishing 0 there would be a fabricated clean
  // bill of health, which is worse than saying so.
  const ws = workspace(t);
  sdlcRun(ws.runs);                       // default fixture = legacy `audit_flags: 0`
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const m = readPassManifest(ws.out);

  assert.equal(m.harness.audit.flags.critical, null);
  assert.equal(m.harness.audit.flags.critical_known, false);
  assert.match(m.harness.audit.note, /UNKNOWN, not zero/);
});

test("a legacy manifest with an audit.json beside it recovers the real breakdown", (t) => {
  // Same bare integer, but audit.json kept the full arrays all along. Falling
  // back to it turns an "unknown" into a real answer for every run exported
  // before the breakdown existed — which is most of the evidence we have.
  const ws = workspace(t);
  sdlcRun(ws.runs, { auditJson: auditFile({
    flags: [{ family: "driver-direct-edit", critical: false, evidence: "sed -i" }],
    warnings: [{ family: "driver-dictated-code", critical: false, evidence: "```ts" }],
    handoffs: 3,
  }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const m = readPassManifest(ws.out);

  assert.equal(m.harness.audit.flags.critical, 0, "a recoverable run still reported unknown");
  assert.equal(m.harness.audit.flags.critical_known, true);
  assert.deepEqual(m.harness.audit.flags.by_family, { "driver-direct-edit": 1 });
  assert.deepEqual(m.harness.audit.integrity_warnings.by_family, { "driver-dictated-code": 1 });
});

// ---- attribution: typed_by vs authored_by ----------------------------------
//
// One line became two. The old sentence said the driver "authored none of the
// patch", which is really two claims with very different strengths welded
// together: the worker TYPED every byte (structural — the driver has no edit
// tools and a hook blocks tree-writing shell commands, so nothing can make it
// false), and the driver did not DICTATE what to type (not structural at all —
// the hand-off channel is prose, and prose can carry a finished file). The
// audit found runs where the second was false while the first stayed true, so
// a single sentence covering both is a sentence that can be wrong.

test("a clean delegated column claims typed_by structurally and authored_by as measured", (t) => {
  const ws = workspace(t);
  sdlcRun(ws.runs, { auditJson: auditFile({ handoffs: 6 }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const a = readPassManifest(ws.out).harness.cable.attribution;

  assert.match(a.typed_by, /STRUCTURAL/);
  assert.match(a.authored_by, /^worker — MEASURED/);
  assert.match(a.authored_by, /all 6 driver→worker hand-off\(s\)/);
  assert.equal(a.handoffs_scanned, 6);
  assert.equal(a.passages_flagged, 0);
  assert.equal(a.runs_flagged, 0);
});

test("one dictated hand-off makes the whole column read MIXED, not clean", (t) => {
  // Worst-first resolution. A column that averaged its way back to "clean"
  // over a flagged run is the exact dishonesty the split exists to prevent —
  // and it is invisible, because the clean wording is the wording a reader
  // expects to see.
  const ws = workspace(t);
  sdlcRun(ws.runs, { task: "kudos-wall", auditJson: auditFile({
    warnings: [{ family: "driver-dictated-code", critical: false, evidence: "```ts\n…" }],
    handoffs: 6,
  }) });
  sdlcRun(ws.runs, { task: "uptime-ping", stamp: "2026-07-26T07-00-00",
    auditJson: auditFile({ handoffs: 5 }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const a = readPassManifest(ws.out).harness.cable.attribution;

  assert.match(a.authored_by, /^MIXED/);
  assert.match(a.authored_by, /driver-dictated-code/);
  assert.equal(a.runs_flagged, 1);
  assert.equal(a.passages_flagged, 1);
  // typed_by is untouched: the worker still typed every byte.
  assert.match(a.typed_by, /STRUCTURAL/);
});

test("an unscanned run makes the column say UNKNOWN rather than clean", (t) => {
  // The honesty field doing its job. `delegation_content_checked: false` means
  // nobody looked — which must not render as the same sentence as "we looked
  // and it was clean". UNKNOWN outranks MIXED outranks clean.
  const ws = workspace(t);
  sdlcRun(ws.runs, { task: "kudos-wall", auditJson: auditFile({ handoffs: 0, checked: false }) });
  sdlcRun(ws.runs, { task: "uptime-ping", stamp: "2026-07-26T07-00-00",
    auditJson: auditFile({ handoffs: 5 }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const a = readPassManifest(ws.out).harness.cable.attribution;

  assert.match(a.authored_by, /^UNKNOWN/);
  assert.match(a.authored_by, /Not a clean bill of health/);
  assert.equal(a.runs_unchecked, 1);
});

test("a Pro instance row carries its own attribution, agreeing with its column", (t) => {
  // Two surfaces, one wording. A column that says MIXED over rows that each
  // say "worker" would leave a reader to decide which one to believe.
  const ws = workspace(t);
  proRun(ws.runs, { instance: "inst_a", delegated: true, auditJson: auditFile({
    warnings: [{ family: "driver-proxy-shell-command", critical: false, evidence: "sed -i" }],
    handoffs: 4,
  }) });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const passDir = readdirSync(join(ws.out, "studies", "harness-swe-bench-pro"),
    { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)[0];
  const inst = JSON.parse(readFileSync(
    join(ws.out, "studies", "harness-swe-bench-pro", passDir, "instances.json"), "utf8"));
  const row = inst.instances[0];

  assert.match(row.delegation.authored_by, /^MIXED/);
  assert.match(row.delegation.typed_by, /STRUCTURAL/);
  assert.equal(row.integrity_warnings.total, 1);
  assert.deepEqual(row.integrity_warnings.by_family, { "driver-proxy-shell-command": 1 });
  assert.match(readPassManifest(ws.out).harness.cable.attribution.authored_by, /^MIXED/);
});

// ---- whose project paid, and where it ran -----------------------------------
//
// WHY THIS SECTION EXISTS (2026-07-31). The exporter used to write the Google
// Cloud project these runs were developed against into every export, as a
// literal string: `worker_auth: "Google ADC on the ai-studies-console project"`.
// Harmless inside one company, wrong the moment the repository is published —
// a reader exporting their own run got a dashboard asserting that somebody
// else's project paid for it. Region had the same shape: a module constant
// describing a policy pin, applied to runs that might not have honoured it.
//
// Both now come from the run's own worker sidecars (`vertex_project`,
// `vertex_location`), which is the only place either fact is actually
// recorded. These tests hold that line: an exporter that "simplifies" back to
// a constant fails here, and so does one that invents a project when the
// evidence does not carry one.

/** Rewrite every worker sidecar in a run's manifest through `patch`. */
function patchSidecars(runDir, patch) {
  const mPath = join(runDir, "manifest.json");
  const man = JSON.parse(readFileSync(mPath, "utf8"));
  let n = 0;
  for (const ph of man.phases ?? []) {
    for (const a of ph.attempts ?? []) {
      for (const sc of a.worker_usage?.sidecars ?? []) { patch(sc); n += 1; }
    }
  }
  assert.ok(n > 0, "fixture carried no sidecars to patch");
  writeFileSync(mPath, JSON.stringify(man, null, 2));
  return runDir;
}

test("the exported cable names the project from the run's own sidecars", (t) => {
  const ws = workspace(t);
  patchSidecars(proRun(ws.runs, { delegated: true }), (sc) => {
    sc.vertex_project = "customer-project-42";
    sc.vertex_location = "europe-west4";
  });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  const cable = readPassManifest(ws.out).harness.cable;

  assert.equal(cable.worker_project, "customer-project-42");
  assert.equal(cable.worker_region, "europe-west4");
  assert.match(cable.worker_auth, /customer-project-42/);
  assert.match(cable.billing_note, /customer-project-42/);
  assert.match(cable.worker_transport, /europe-west4/);
  assert.match(cable.worker_display, /europe-west4/);
  assert.match(cable.summary, /europe-west4/);
});

test("no exported string names a project the evidence never mentioned", (t) => {
  // The whole published artifact, not just the field that was wrong: a leftover
  // project id in a brief or a routing reason is the same defect in a different
  // file. The fixture's sidecars carry no vertex_project at all, so ANY project
  // id in the output would have to have been invented by the exporter.
  const ws = workspace(t);
  proRun(ws.runs, { delegated: true });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);

  for (const f of filesUnder(ws.out)) {
    const body = readFileSync(join(ws.out, f), "utf8");
    assert.doesNotMatch(body, /ai-studies-console/, `${f} names a hardcoded Google Cloud project`);
  }
  const cable = readPassManifest(ws.out).harness.cable;
  assert.equal(cable.worker_project, null, "an unrecorded project must stay null, not be guessed");
  assert.match(cable.worker_auth, /not recorded in this run's evidence/);
  assert.doesNotMatch(cable.billing_note, /project /);
});

test("a sidecar with no region falls back to the pinned default, not to nothing", (t) => {
  // Runs recorded before gemini_worker.py wrote vertex_location still have to
  // price and describe correctly — the pin is what they actually ran on.
  const ws = workspace(t);
  proRun(ws.runs, { delegated: true });
  assert.equal(run(["--runs-root", ws.runs, "--out", ws.out]).status, 0);
  assert.equal(readPassManifest(ws.out).harness.cable.worker_region, "asia-south1");
});

test("worker spend is priced in the region the sidecar recorded", (t) => {
  // The +10% non-global Vertex surcharge is a property of the endpoint that
  // served the call. Pricing every run at the pinned region would overcharge a
  // run that went through `global` by exactly that 10%, silently.
  const workerOf = (out) => Number(out.match(/worker \$([\d.]+)/)[1]);

  const regional = workspace(t);
  patchSidecars(proRun(regional.runs, { delegated: true }), (sc) => {
    sc.vertex_location = "asia-south1";
  });
  const wsGlobal = workspace(t);
  patchSidecars(proRun(wsGlobal.runs, { delegated: true }), (sc) => {
    sc.vertex_location = "global";
  });

  const a = workerOf(run(["--runs-root", regional.runs, "--out", regional.out]).stdout);
  const b = workerOf(run(["--runs-root", wsGlobal.runs, "--out", wsGlobal.out]).stdout);
  assert.ok(a > b, `regional (${a}) must cost more than global (${b})`);
  // gemini-3.5-flash is a Gemini 3 model, so the surcharge applies in full.
  assert.ok(Math.abs(a / b - 1.1) < 0.005, `expected the +10% surcharge, got ${a / b}`);
});
