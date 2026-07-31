/**
 * export-dashboard.mjs — renders harness-matrix run directories into the exact
 * static shapes the presentation dashboard eats.
 *
 * WHY THIS EXISTS (2026-07-25): the harness writes rich, honest evidence
 * (manifest.json / audit.json / grade-verdict.json / model.diff), but the
 * dashboard has its own frozen input contract — `/data/studies.json` plus
 * `/data/studies/<study>/<pass>/{telemetry.jsonl, manifest.json,
 * instances.json, policy_snapshot.yaml}`. apps/api/src/export-dashboard.ts
 * already renders that contract from the ORCHESTRATION side (SQLite + v2
 * telemetry). This script is the same seam for the HARNESS side: same output
 * shapes, different source. The dashboard cannot tell which producer wrote a
 * study, which is the whole point — one presentation layer, two engines.
 *
 * Usage:
 *   node export-dashboard.mjs --run-dir <path> [--run-dir <path> ...]
 *   node export-dashboard.mjs --runs-root <dir>          # every run under it
 *     [--study <id>] [--pass <id>] [--label <text>] [--out <dir>]
 *     [--rewrite-brief] [--dry-run]
 *
 * Both task kinds are supported and auto-detected from the manifest
 * (`instance_id` + `phases` = SWE-bench Pro; `task_id` + `stages` = SDLC).
 *
 * ── STUDY / PASS / INSTANCE — WHAT EACH ONE IS ──────────────────────────
 *
 * Rewritten 2026-07-25 because the first version wired all three together:
 * one run directory produced one pass inside a study whose id carried that
 * run's INSTANCE NAME and CLOCK. That made the study identity a run detail —
 * run five instances tomorrow and you got a fifth unrelated card, each with a
 * "study overview" that was really a run report. The three levels are now
 * separate, and only the bottom one is allowed to know about a specific run:
 *
 *   STUDY   the TRACK. `harness-swe-bench-pro` / `harness-sdlc`. Never carries
 *           an instance name, a model, a cable or a timestamp, so its title,
 *           description and brief stay true no matter what is run next. New
 *           work is added as columns, never as new cards.
 *
 *   PASS    one export BATCH = one CELL (runtime × policy) over the instances
 *           handed to THIS invocation, stamped with the batch's date. Immutable:
 *           a later batch writes a new column and never mutates an existing one,
 *           so a published number can never change under a reader. Repeating an
 *           instance is therefore a second column, not an overwrite.
 *
 *   INSTANCE one run directory = one row in instances.json, carrying its own
 *           verdict, per-phase cost split and run timestamp.
 *
 * Guards enforce that a pass really is one cell: mixing kinds, mixing
 * runtime/policy, or handing the same instance twice in one batch are hard
 * errors with the fix in the message, never silently averaged together.
 *
 * ── THE THREE HONESTY DECISIONS ─────────────────────────────────────────
 *
 * 1. THE DRIVER'S SPEND IS EXPLAINED, NOT JUST ASSERTED.
 *    A delegated run invites one obvious objection: "the worker wrote all the
 *    code, so why does the driver cost twice as much?" Answering it needs the
 *    driver's TOKENS, not only its dollars — so every driver event carries the
 *    real ledger from Claude Code's `result` event (prompt incl. cache reads,
 *    output) plus its turn count. Those tokens are orchestration and
 *    verification: composing each worker task, reading back replies, diffs and
 *    test output, deciding whether to re-delegate. They are not code
 *    authoring, which the driver has no tools to do.
 *    The dollars remain CLI-MODELED — the run billed a Max seat, not a metered
 *    API key — and `harness.driver_cost_basis` says so wherever they appear.
 *    A runtime that reports no usage exports 0 with
 *    `harness.driver_tokens_reported: false`, so 0 never reads as "free".
 *
 * 2. WORKER COST IS COMPUTED HERE — THIS IS THE "PRICED DOWNSTREAM" STEP.
 *    The harness deliberately records worker spend as raw token counts and
 *    refuses to convert them to dollars (a partial dollar total would be
 *    worse than an honest split). THIS script is that downstream: it prices
 *    each usage sidecar through @harness/pricing `getVertexRates(model,
 *    region)`, which applies the +10% non-global Vertex surcharge. The region
 *    and the paying Google Cloud project both come from the sidecar itself
 *    (`vertex_location` / `vertex_project`), so a run executed outside the
 *    default region is priced and described as what it was, and no exported
 *    dashboard ever names a project that did not pay for it.
 *    No rate is ever inlined here (operating rule #4) — the
 *    pricing package stays the single source of truth, imported by relative
 *    path because the harness tree has no package.json of its own.
 *
 * 3. WORKER LATENCY IS ZERO BECAUSE IT IS NESTED, NOT MISSING.
 *    A delegation is a blocking call: the worker's wall time happens INSIDE
 *    the driver attempt's wall time. The driver event already carries the
 *    full attempt duration, so giving worker events their own latency would
 *    double-count every hand-off. Cost is different — driver and worker bill
 *    to genuinely separate wallets (Max seat vs Vertex project), so both
 *    costs are additive and both are counted.
 *
 * Event timestamps are RECONSTRUCTED: the harness records per-attempt wall
 * seconds but not per-attempt start instants, so we accumulate durations from
 * each run's `started_at`. Ordering and durations are exact (attempts are
 * strictly sequential); only the absolute offsets are approximate, because
 * un-attributed gaps (docker build, image sealing, grading) are not modeled.
 * Nothing downstream reads these timestamps as billing facts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The single source of truth for prices. Relative into the built package
// because tools/harness-matrix is a plain .mjs tree with no node_modules —
// workspace resolution ("@harness/pricing") is not available here.
import { getVertexRates, costMicroUsd, microToUsd, PRICING_VERSION } from "../../packages/pricing/dist/index.js";
import { benchmarkBrief } from "../lib/benchmark-brief.mjs";
// The audit's own readers. Imported rather than re-derived here so the shape
// the run kinds WRITE into manifest.json and the shape this exporter READS can
// never disagree — and so the legacy-integer fallback lives in exactly one
// place instead of being re-guessed at every call site.
//
// attributionSplit / runFlagSummary / WORKER_SDK_LABEL used to be defined in
// THIS file and moved into audit.mjs on 2026-07-29 (finding C6), when the
// evidence bundler became a second publisher of the same two sentences. Two
// copies of a claim that must agree is how they stop agreeing.
import {
  readFlagSummary, mergeFlagSummaries, summariseFlagList,
  runFlagSummary, attributionSplit, resolvedIntegrity, lintRecordedHandoffs, WORKER_SDK_LABEL,
} from "./audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/**
 * Resolve a manifest-recorded, harness-relative path (`policies/x.yaml`,
 * `examples/kudos-wall/brief.md`) to somewhere on disk.
 *
 * WHY THIS EXISTS AS A HELPER (Sriram, 2026-07-26). The policy snapshot used
 * to be resolved with a bare `join(ROOT, m.policy.file)`. The runner records
 * that path relative to the HARNESS directory, not to the repo root, so the
 * join always landed on a file that does not exist — and the miss was silent,
 * because the caller fell back to writing a two-line "# policy file not found"
 * stub. Every delegated SDLC column therefore shipped an empty policy exhibit
 * while the export log printed the path as if it had been copied. Both the
 * harness-relative and root-relative readings are tried (in that order, since
 * the harness is what writes the manifest), an absolute path is honoured as
 * given, and the caller is expected to WARN on null rather than paper over it.
 */
function resolveHarnessPath(rel) {
  if (!rel) return null;
  const candidates = rel.startsWith("/") ? [rel] : [join(HERE, rel), join(ROOT, rel)];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// The Gemini worker DEFAULTS to asia-south1 (the global endpoint was
// quota-starved 2026-07-16), and GOOGLE_CLOUD_LOCATION overrides it. Kept as a
// named constant so the +10% regional surcharge is applied by getVertexRates()
// rather than assumed anywhere in this file — but it is only ever a FALLBACK
// here: every worker sidecar records the region it actually ran in
// (`vertex_location`), and evidence outranks a constant. The constant is used
// for sidecars written before that field existed.
const WORKER_REGION_FALLBACK = "asia-south1";

// THE CABLE. The delegated cell's whole point is CROSS-RUNTIME: a Claude Code
// driver reaching Gemini through Google's Antigravity SDK, not a bare Gemini
// API call. Naming only the model would hide the integration that IS the
// study, so the SDK is threaded into every layer the dashboard renders —
// registry labels, per-call routing reasons, the manifest and the brief.
// Verified in gemini_worker.py: `import google.antigravity as ag` with
// types.VertexEndpoint + vertex=True (NOT the parked `agy` CLI, and NOT the
// google-genai SDK).
const WORKER_SDK = "google-antigravity";
// WORKER_SDK_LABEL is imported from audit.mjs — it is written into the
// published attribution sentence, which the evidence bundler also emits, so it
// has to have exactly one definition. WORKER_SDK and the region fallback stay
// here: they are pricing and routing facts, not attribution ones.

/**
 * Where the worker actually ran, per sidecar. Reads the run's own evidence and
 * falls back to the pinned region only for sidecars written before
 * gemini_worker.py started recording it. Used for BOTH pricing (the +10%
 * non-global Vertex surcharge is regional) and display, so a run executed in,
 * say, europe-west4 is never priced or described as asia-south1.
 */
const sidecarRegion = (sc) => sc.vertex_location || WORKER_REGION_FALLBACK;

/**
 * Which Google Cloud project paid for the worker side, per sidecar.
 *
 * This used to be a hardcoded string naming the project these runs were
 * originally developed against — which meant every exported dashboard, on any
 * machine, asserted that OUR project paid for the reader's run. It is a
 * billing claim, so it comes from the run's own receipt or it is not made at
 * all: null when the sidecar predates the field, and the callers word the
 * sentence without a project name in that case.
 */
const sidecarProject = (sc) => sc.vertex_project || null;

/** Join a set of evidence values for display; null when nothing was recorded. */
const listOrNull = (vals) => (vals.length ? [...new Set(vals)].sort().join(", ") : null);

/**
 * Best-effort version of the Antigravity SDK, read from the worker venv's
 * dist-info at EXPORT time. Deliberately reported as "at export" rather than
 * "at run": the harness does not stamp the SDK version into a run's evidence,
 * so claiming it as the version that produced these numbers would be an
 * unverifiable assertion. null when the venv is absent.
 */
function workerSdkVersionAtExport() {
  try {
    const sp = join(HERE, "sdk-probe", "sdkprobe", "lib");
    const py = readdirSync(sp).find((d) => d.startsWith("python"));
    if (!py) return null;
    const dist = readdirSync(join(sp, py, "site-packages"))
      .find((d) => /^google_antigravity-.*\.dist-info$/.test(d));
    return dist ? dist.replace(/^google_antigravity-/, "").replace(/\.dist-info$/, "") : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- args ----
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
// --run-dir is REPEATABLE: a batch is the unit of export now, so collecting
// every occurrence (rather than the first) is what makes N instances land in
// one column. A single --run-dir still works exactly as it did.
const argsOf = (k) => argv.reduce((acc, v, i) => (v === k && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);

const DRY_RUN = argv.includes("--dry-run");
const REWRITE_BRIEF = argv.includes("--rewrite-brief");
const OUT = resolve(argOf("--out") ?? join(ROOT, "apps", "dashboard", "public", "data"));

const USAGE = "usage: node export-dashboard.mjs --run-dir <run dir> [--run-dir <run dir> ...]\n" +
  "       node export-dashboard.mjs --runs-root <dir>\n" +
  "       [--study <id>] [--pass <id>] [--label <text>] [--out <dir>] " +
  "[--rewrite-brief] [--dry-run]";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readJsonOrNull = (p) => {
  try { return existsSync(p) ? readJson(p) : null; } catch { return null; }
};

/**
 * Every finished run directory under `root`.
 *
 * A directory that holds a manifest.json IS a run and is not descended into —
 * that single rule is what lets `--runs-root runs/` pick up whatever layout the
 * harness happened to use (instance dir → cell dir → timestamp dir) without
 * this script hardcoding that nesting.
 */
function findRunDirs(root, depth = 0) {
  if (depth > 6) return [];
  let ents;
  try { ents = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  if (ents.some((e) => e.isFile() && e.name === "manifest.json")) return [root];
  const out = [];
  for (const e of ents) if (e.isDirectory()) out.push(...findRunDirs(join(root, e.name), depth + 1));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Run-directory clock, parsed once into every form this file needs. */
function stampOf(runDir) {
  const b = basename(runDir);                     // 2026-07-24T09-32-34
  const mm = b.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  if (!mm) return { key: "unstamped", pretty: b, dayPretty: b, sort: b };
  const [, Y, M, D, h, min] = mm;
  return {
    key: `${D}${M}-${h}${min}`,                   // 2407-0932 — pass-id suffix
    // Year is part of BOTH forms (Sriram, 2026-07-25). A column that reads
    // "24 Jul 09:32" is undated the moment this portfolio outlives the year it
    // was produced in — and these cards are the durable artifact, kept and
    // shown long after the run. dayPretty already carried the year; pretty did
    // not, so single-run columns (the common case for a delegated cable) were
    // the only ones missing it. Now every label level agrees.
    pretty: `${D} ${MONTHS[+M - 1]} ${Y} ${h}:${min}`, // 24 Jul 2026 09:32
    dayPretty: `${D} ${MONTHS[+M - 1]} ${Y}`,          // 24 Jul 2026
    sort: `${Y}${M}${D}${h}${min}`,
  };
}

// Resolve the batch. --runs-root and --run-dir compose, so a root can be
// swept and one stray directory added by hand in the same invocation.
const runDirs = [
  ...(argOf("--runs-root") ? findRunDirs(resolve(argOf("--runs-root"))) : []),
  ...argsOf("--run-dir").map((d) => resolve(d)),
];
const uniqueRunDirs = [...new Set(runDirs)].sort((a, b) => stampOf(a).sort.localeCompare(stampOf(b).sort));

if (!uniqueRunDirs.length) {
  console.error(argOf("--runs-root")
    ? `no run directory (a dir containing manifest.json) found under ${resolve(argOf("--runs-root"))}`
    : USAGE);
  process.exit(2);
}
for (const d of uniqueRunDirs) {
  if (!existsSync(join(d, "manifest.json"))) {
    console.error(`no manifest.json in ${d} — is that a finished harness run directory?`);
    process.exit(2);
  }
}

/**
 * Parse ONE run directory into everything the batch needs from it.
 *
 * Everything that used to be module-level per-run state lives in here now, so
 * N runs can be read into N independent records with no shared mutable state
 * between them. The inner helpers stay closures over `runDir` / `isPro` /
 * `subjectId` deliberately — that keeps their signatures (and therefore the
 * reviewed logic inside them) byte-identical to the single-run version, with
 * the one real fix that `driverTokens` now reads the trajectory from THIS
 * run's directory instead of a module-level path.
 */
function readRun(runDir) {
  const m = readJson(join(runDir, "manifest.json"));
  const audit = readJsonOrNull(join(runDir, "audit.json"));
  const verdict = readJsonOrNull(join(runDir, "grade-verdict.json"));

  // Re-read this run's hand-off files and lint them NOW (2026-07-29, C6).
  //
  // Every delegated run on record was executed BEFORE the delegation content
  // lint existed, so every one of their audit.json files lacks the field, and
  // attributionSplit is obliged to publish "UNKNOWN — never checked". That is
  // honest but useless: the hand-offs are still on disk, byte-for-byte, so the
  // question CAN be answered — the check just has to be run again here. Read
  // only; nothing under runs/ is written by the exporter.
  const handoffRecheck = lintRecordedHandoffs(join(runDir, "out"), {
    workdir: join(runDir, "workdir"),
  });

  // Kind detection from the record's own shape rather than a `kind` field:
  // the Pro manifest predates that field, so shape is the robust discriminator.
  const kind = m.kind ?? (m.instance_id ? "swepro" : "sdlc");
  const isPro = kind === "swepro";
  const legs = (isPro ? m.phases : m.stages) ?? [];
  const subjectId = isPro ? m.instance_id : m.task_id;
  const runtimeName = m.runtime?.name ?? "unknown-runtime";
  const policyName = m.policy?.name ?? "unknown-policy";
  const stamp = stampOf(runDir);

  /**
   * The graded test evidence behind a Pro verdict, read from the benchmark's
   * own grader output rather than re-derived.
   *
   * `grade-verdict.json` answers only resolved / not-resolved. The Instances
   * tab asks the harder question — WHICH tests, and were the required ones
   * among them — and rendered a dash for it because nothing was extracting the
   * detail the grader already wrote to disk:
   *   - grade/out/<instance>/harness_output.json → [{name, status}] per test
   *   - grade/sample.jsonl → the instance's own `fail_to_pass` / `pass_to_pass`,
   *     i.e. the tests the benchmark REQUIRES, as stringified Python lists.
   *
   * `required_passed` counts required tests observed PASSED; anything required
   * but never executed is reported separately as `missing_required` — a silent
   * no-run is a different failure from a red test and must not read as one.
   * Every field is optional: a run without grader output degrades to a dash.
   */
  function readGradedTests() {
    if (!isPro) return null;
    const gradeDir = join(runDir, "grade");
    const out = readJsonOrNull(join(gradeDir, "out", subjectId, "harness_output.json"));
    const observed = Array.isArray(out?.tests) ? out.tests : null;

    // The Pro dataset ships these as Python list literals inside a JSON string
    // ("['TestCache']"), so they need one more unwrapping step than an array.
    const pyList = (v) => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v !== "string") return [];
      try { return JSON.parse(v.replace(/'/g, '"')).map(String); } catch { return []; }
    };
    let required = [];
    try {
      const first = readFileSync(join(gradeDir, "sample.jsonl"), "utf8").trim().split("\n")[0];
      const s = JSON.parse(first);
      required = [...pyList(s.fail_to_pass ?? s.FAIL_TO_PASS), ...pyList(s.pass_to_pass ?? s.PASS_TO_PASS)];
    } catch { /* no sample on disk — required stays unknown */ }

    if (!observed && !required.length) return null;

    const passedNames = new Set((observed ?? []).filter((t) => t.status === "PASSED").map((t) => t.name));
    const failed = (observed ?? []).filter((t) => t.status !== "PASSED").map((t) => t.name);
    const ranNames = new Set((observed ?? []).map((t) => t.name));
    return {
      tests: {
        passed: passedNames.size,
        failed: failed.length,
        ...(required.length ? {
          required: required.length,
          required_passed: required.filter((t) => passedNames.has(t)).length,
        } : {}),
      },
      // Capped at 40 to match the contract the Instances tab documents; the
      // counts above stay exact so "+N more" is derivable.
      ...(failed.length ? { failed_tests: failed.slice(0, 40) } : {}),
      ...(required.some((t) => !ranNames.has(t))
        ? { missing_required: required.filter((t) => !ranNames.has(t)).slice(0, 40) }
        : {}),
    };
  }

  // --------------------------------------------- delegation detection ---
  // A leg ran delegated iff any of its attempts carried worker usage sidecars.
  // Derived from evidence (the sidecars themselves), never from the policy name.
  const attemptsOf = (leg) => leg.attempts ?? [];
  const sidecarsOf = (a) => a.worker_usage?.sidecars ?? [];
  const anySidecars = legs.some((l) => attemptsOf(l).some((a) => sidecarsOf(a).length > 0));

  /**
   * The DRIVER's own token ledger for one stage attempt.
   *
   * Two sources, in order of preference:
   *   1. `attempt.driver_usage` — recorded by the harness at run time (runs from
   *      2026-07-25 on).
   *   2. the attempt's trajectory file — Claude Code's `result` event carries
   *      the same `usage` object, so runs that finished BEFORE the harness
   *      started recording it are still fully reportable. That retroactive path
   *      is the whole reason this reads from disk instead of demanding a re-run.
   *
   * Anthropic's split is mapped to the DASHBOARD's telemetry contract, which is a
   * DIFFERENT convention from the pricing package's: here `input_tokens` is the
   * WHOLE prompt and `input_tokens_cached` is the cached slice of it. Cache
   * CREATION counts as fresh — those tokens were read and written for the first
   * time on this call.
   *
   * Returns zeros when neither source exists, which is the honest reading for a
   * runtime that reports no usage at all.
   */
  function driverTokens(a, legId) {
    let u = a.driver_usage ?? null;
    if (!u) {
      const traj = join(runDir, "out", "phases", `${legId}-a${a.attempt ?? 1}.trajectory.jsonl`);
      if (existsSync(traj)) {
        for (const line of readFileSync(traj, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "result" && ev.usage) u = ev.usage;
          } catch { /* partial line from a killed run — tolerated */ }
        }
      }
    }
    if (!u) return { input: 0, cached: 0, output: 0, reported: false };
    const cached = u.cache_read_input_tokens ?? 0;
    const fresh = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    return { input: fresh + cached, cached, output: u.output_tokens ?? 0, reported: true };
  }

  // ----------------------------------------------------- v1 events ----
  const events = [];
  let clock = Date.parse(m.started_at ?? new Date().toISOString());
  const MODULE = isPro ? "swe-bench-pro" : "sdlc-mini";
  const taskTypeOf = (legId) => (isPro ? `swe_${legId}` : `sdlc_${legId}`);
  const taskIdOf = (legId) => `tp_${taskTypeOf(legId)}__${subjectId}`;

  const unpricedModels = new Set();
  let workerCallCount = 0;
  // Run-level roll-up of the driver ledger, so the manifest can state the
  // driver's work in tokens and turns instead of leaving a dollar unexplained.
  const driverLedger = { input: 0, cached: 0, output: 0, turns: 0, reported: false };
  // Model ids by SIDE, tallied where the side is unambiguous (an attempt is the
  // driver, a sidecar is the worker) rather than inferred later from the
  // latency==0 proxy — a driver attempt that finished in under a millisecond
  // would otherwise be filed as a worker call.
  const driverModelSet = new Set();
  const workerModelSet = new Set();
  // WHERE the worker ran and WHO paid, taken from the sidecars rather than
  // from a constant in this file. Both are per-run sets because a single run
  // could in principle span regions (a retry after a quota failure), and the
  // export must be able to say so instead of averaging it away.
  const workerRegionSet = new Set();
  const workerProjectSet = new Set();

  /**
   * Per-leg cost split, accumulated as the events are built.
   *
   * WHY: an instance row's single "model spend" figure is unreadable on a
   * delegated run — it is the sum of two different wallets across three phases,
   * and a reviewer who expands the row finds per-attempt worker costs that add
   * up to a fraction of it. Recording driver-vs-worker PER PHASE here is what
   * lets the Instances tab show where the money actually went (repro is usually
   * the expensive phase, not patch) and who spent it, instead of one number the
   * evidence underneath appears to contradict.
   *
   * Built from the legs rather than from the emitted events on purpose: the leg
   * loop is the only place both sides of a hand-off are unambiguously in hand
   * (attempt = driver, sidecars = worker), so nothing has to be re-derived from
   * a proxy field later.
   */
  const phaseSplit = new Map();
  const splitOf = (legId) => {
    let s = phaseSplit.get(legId);
    if (!s) {
      s = { phase: legId, driver_cost_usd: 0, worker_cost_usd: 0, attempts: 0, worker_calls: 0, driver_model: null, worker_models: [] };
      phaseSplit.set(legId, s);
    }
    return s;
  };

  for (const leg of legs) {
    const legId = leg.phase ?? leg.stage;
    // Script-owned legs (SDLC's verify with 0 repair rounds, report) contribute
    // no model calls — they legitimately produce no telemetry rows.
    for (const a of attemptsOf(leg)) {
      const wallMs = Math.round((a.wall_seconds ?? 0) * 1000);
      const attemptStart = clock;
      const success = a.gate?.pass === true;
      const split = splitOf(legId);
      const driverModel = a.resolved_model ?? leg.model_id ?? "unknown";
      split.attempts += 1;
      split.driver_cost_usd += a.cost_usd ?? 0;
      split.driver_model ??= driverModel;
      driverModelSet.add(driverModel);

      // 1. The driver event: real cost AND real tokens (see honesty note #1).
      const dt = driverTokens(a, legId);
      driverLedger.input += dt.input;
      driverLedger.cached += dt.cached;
      driverLedger.output += dt.output;
      driverLedger.turns += a.num_turns ?? 0;
      if (dt.reported) driverLedger.reported = true;
      events.push({
        ts: iso(attemptStart),
        pass: null,                       // stamped once the batch's pass id exists
        phase: legId,
        task_type: taskTypeOf(legId),
        task_id: taskIdOf(legId),
        module: MODULE,
        model: driverModel,
        routed_by: anySidecars ? `${runtimeName} driver → ${WORKER_SDK_LABEL} worker` : "harness",
        routing: {
          policy_name: policyName,
          policy_version: 1,
          rule_index: 0,
          rule_reason: sidecarsOf(a).length
            ? `driver seat, no edit tools — all file work delegated via the ${WORKER_SDK_LABEL}`
            : "single-model seat",
        },
        input_tokens: dt.input,
        input_tokens_cached: dt.cached,
        output_tokens: dt.output,
        cost_usd: r6(a.cost_usd ?? 0),
        latency_ms: wallMs,
        success,
        retry_count: (a.attempt ?? 1) - 1,
      });

      // 2. One event per worker hand-off: real tokens, computed cost, zero
      //    latency (nested inside the driver attempt — see honesty note #3).
      const scs = sidecarsOf(a);
      scs.forEach((sc, i) => {
        const p = priceSidecar(sc);
        if (!p.priced) unpricedModels.add(sc.model ?? "unknown");
        workerCallCount += 1;
        split.worker_cost_usd += p.usd;
        split.worker_calls += 1;
        if (sc.model && !split.worker_models.includes(sc.model)) split.worker_models.push(sc.model);
        workerModelSet.add(sc.model ?? "unknown-worker");
        workerRegionSet.add(sidecarRegion(sc));
        if (sidecarProject(sc)) workerProjectSet.add(sidecarProject(sc));
        events.push({
          // Spread the hand-offs across the attempt window purely so the
          // timeline orders them correctly inside their parent attempt.
          ts: iso(attemptStart + Math.round((wallMs * (i + 1)) / (scs.length + 1))),
          pass: null,
          phase: legId,
          task_type: taskTypeOf(legId),
          task_id: taskIdOf(legId),
          module: MODULE,
          model: sc.model ?? "unknown-worker",
          routed_by: `${runtimeName} driver → ${WORKER_SDK_LABEL} worker`,
          routing: {
            policy_name: policyName,
            policy_version: 1,
            rule_index: 1,
            // The per-call audit line. Names the SDK, not just the model, so a
            // reviewer reading one row can tell HOW Gemini was reached.
            rule_reason: `worker via ${WORKER_SDK_LABEL} (${WORKER_SDK}) → Vertex ` +
              `${sidecarRegion(sc)} · thinking ${sc.thinking ?? "n/a"}`,
          },
          // TWO DIFFERENT CONVENTIONS, DELIBERATELY NOT MIXED UP. The pricing
          // package needs DISJOINT buckets (fresh and cache_read are billed at
          // different rates, so double-counting would overcharge). The dashboard's
          // telemetry contract is the opposite: `input_tokens` is the WHOLE
          // prompt and `input_tokens_cached` is the cached slice of it — see
          // lib/simulate.ts (`fresh = input_tokens - input_tokens_cached`) and
          // lib/metrics.ts (`cacheHitRate = cached / input`). Emitting the
          // disjoint fresh count here produced cache-hit rates above 100% on the
          // Engineering View. So: price off the disjoint split, REPORT the total.
          input_tokens: p.tokens.input_fresh + p.tokens.cache_read,
          input_tokens_cached: p.tokens.cache_read,
          output_tokens: p.tokens.output,
          ...(p.reasoning ? { output_tokens_reasoning: p.reasoning } : {}),
          cost_usd: r6(p.usd),
          latency_ms: 0,
          success,
          retry_count: (a.attempt ?? 1) - 1,
        });
      });

      clock = attemptStart + wallMs;
    }
  }

  const splits = [...phaseSplit.values()];
  const driverCost = r6(splits.reduce((s, x) => s + x.driver_cost_usd, 0));
  const workerCost = r6(splits.reduce((s, x) => s + x.worker_cost_usd, 0));
  const totalCost = r6(driverCost + workerCost);

  const patch = diffStats(join(runDir, "model.diff"));
  const resolved = verdict?.resolved === true;
  const submitted = (patch?.files ?? 0) > 0;

  // ------------------------------------------- instances.json row (Pro) ---
  // Delegated-cell semantics. The tab's columns ask "who authored this patch?"
  // and "what did this instance cost?", so for a delegated cell they must
  // answer with the WORKER, not the driver: the driver runs with Edit / Write /
  // MultiEdit / NotebookEdit disallowed and a PreToolUse hook that denies every
  // tree-writing Bash command, so it is structurally incapable of authoring a
  // line of the patch — Gemini wrote all of it. Naming the driver as "final
  // patch author" would be plainly false, so `attempts[].model` and
  // `final_model` report the worker, and each attempt's `cost_usd` is that
  // attempt's WORKER spend (real Vertex tokens, priced above).
  //
  // The driver is not hidden by this: its CLI-modeled spend is a first-class
  // row of the manifest's model_breakdown / phase_breakdown (shown on Overview
  // and Runs Result), the row's `cost_usd` here is the TRUE instance total
  // (driver + worker), and the `delegation` block below states the split
  // explicitly — which is also why the row total exceeds the sum of the
  // per-attempt worker costs.
  let instanceRow = null;
  if (isPro) {
    const patchLeg = legs.find((l) => (l.phase ?? l.stage) === "patch");
    const localizeLeg = legs.find((l) => (l.phase ?? l.stage) === "localize");
    // Per-attempt author + spend. For a delegated cell the author is the worker
    // and the spend is its priced Vertex tokens; for a single-model cell it is
    // the driver itself and its CLI-reported cost. One helper, both regimes.
    const attemptAuthor = (a) => {
      const scs = sidecarsOf(a);
      if (!scs.length) return { model: a.resolved_model ?? "unknown", cost: r6(a.cost_usd ?? 0) };
      return {
        // Workers within one attempt are the same pinned model; take the last
        // one to answer "who wrote the final version" if that ever changes.
        model: scs[scs.length - 1].model ?? "unknown-worker",
        cost: r6(scs.reduce((s, sc) => s + priceSidecar(sc).usd, 0)),
      };
    };
    const legCost = (leg) => r6(attemptsOf(leg ?? {}).reduce((s, a) => s + attemptAuthor(a).cost, 0));
    const rowVerdict = !submitted ? "no_patch" : verdict ? (resolved ? "resolved" : "unresolved") : "error";

    instanceRow = {
      id: subjectId,
      repo: m.repo,
      base_commit: m.base_commit ?? undefined,
      language: m.repo_language,
      verdict: rowVerdict,
      // When this instance actually ran. A column can hold instances from more
      // than one day (a --runs-root sweep), and even when it does not, the row
      // is the only place a reader can see WHEN without opening the manifest.
      // The run-DIR stamp, not manifest.started_at: manifest timestamps are
      // reconstructed from per-attempt durations (offsets approximate, and in
      // a different clock than the folder name), so a row stamped from them
      // showed "15:04" under a column labeled "09:32". The folder stamp is
      // the wall clock the run actually started on and is what every column
      // label is built from — rows and columns must agree. No timezone
      // marker on purpose: the browser parses it as local time, matching how
      // the label was written.
      run_at: stamp.key === "unstamped" ? (m.started_at ?? undefined)
        : basename(runDir).replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3"),
      // Graded test evidence, verbatim from the benchmark's own grader output.
      ...(readGradedTests() ?? {}),
      attempts: attemptsOf(patchLeg ?? {}).map((a) => ({
        n: a.attempt,
        model: attemptAuthor(a).model,
        cost_usd: attemptAuthor(a).cost,
      })),
      escalated: false,
      ...(localizeLeg ? {
        localize: {
          model: attemptAuthor(attemptsOf(localizeLeg)[0] ?? {}).model,
          cost_usd: legCost(localizeLeg),
        },
      } : {}),
      ...(patch?.paths?.length ? { patch_files: patch.paths } : {}),
      ...(patch ? { patch_stats: { files: patch.files, added: patch.added, removed: patch.removed } } : {}),
      // Same authorship rule as attempts[] above: the last patch attempt's
      // AUTHOR, which for a delegated cell is the worker. Reading
      // `resolved_model` here would silently re-credit the driver and
      // contradict the attempts[] rows immediately above it.
      final_model: attemptsOf(patchLeg ?? {}).length
        ? attemptAuthor(attemptsOf(patchLeg).slice(-1)[0]).model
        : undefined,
      cost_usd: totalCost,
      // Where the row's money went, phase by phase, with the two wallets kept
      // apart. This is what makes `cost_usd` above auditable: sum every
      // phase's driver + worker and you get it back exactly. Emitted for
      // single-model runs too — there the worker side is simply 0.00 and the
      // table still answers "which phase was expensive".
      cost_by_phase: splits.map((s) => ({
        phase: s.phase,
        driver_cost_usd: r6(s.driver_cost_usd),
        worker_cost_usd: r6(s.worker_cost_usd),
        total_cost_usd: r6(s.driver_cost_usd + s.worker_cost_usd),
        attempts: s.attempts,
        worker_calls: s.worker_calls,
        driver_model: s.driver_model,
        worker_models: s.worker_models,
      })),
      cost_split: { driver_cost_usd: driverCost, worker_cost_usd: workerCost },
      // Per-instance audit criticality, so the Instances tab can mark the one
      // row that carries a finding instead of sending the reader to audit.json.
      audit: runFlagSummary({ m, audit }, "audit_flags", "flags"),
      // Resolved, not raw: for the runs that predate the content lint this is
      // the bundle/export-time re-read of their own hand-off files, and
      // `measured_at` says so. Taking the raw manifest value here would show a
      // clean badge on the Instances tab over an authored_by line that says
      // MIXED — the exact contradiction the split exists to prevent.
      integrity_warnings: resolvedIntegrity(m, audit, handoffRecheck),
      ...(anySidecars ? {
        delegation: {
          driver: attemptsOf(patchLeg ?? {}).slice(-1)[0]?.resolved_model ?? null,
          driver_runtime: m.runtime?.name ?? null,
          worker: [...workerModelSet],
          worker_sdk: WORKER_SDK,
          worker_sdk_label: WORKER_SDK_LABEL,
          worker_transport: `Vertex ${listOrNull([...workerRegionSet]) ?? WORKER_REGION_FALLBACK}`,
          // The billing surface for this instance's worker spend, from its own
          // receipts. Absent (not guessed) when the sidecars predate the field.
          worker_project: listOrNull([...workerProjectSet]),
          driver_cost_usd: driverCost,
          worker_cost_usd: workerCost,
          worker_calls: workerCallCount,
          // ---- attribution, split in two because they are two claims -------
          // The old single line said the driver "authored none of the patch".
          // That conflates two different facts, and only one of them is
          // structurally guaranteed. Split, no number changes:
          //
          //   typed_by    — whose tokens produced the bytes. Structural: the
          //                 driver's Edit / Write / MultiEdit / NotebookEdit
          //                 tools are removed and a PreToolUse hook blocks
          //                 every tree-writing shell command, so the patch can
          //                 only have come back through the worker. Nothing in
          //                 a trajectory can make this false.
          //   authored_by — whether the driver DICTATED what the worker typed.
          //                 Not structural. The hand-off channel is prose, and
          //                 prose can carry a finished file, so this can only
          //                 be measured after the fact — by the delegation
          //                 content lint, whose finding for THIS instance is
          //                 reported here rather than assumed clean.
          ...attributionSplit(m, audit, handoffRecheck),
          note: `attempts[] and final_model report the WORKER — Gemini reached through the ` +
            `${WORKER_SDK_LABEL} (${WORKER_SDK}); the row cost_usd is driver + worker combined. ` +
            `See typed_by / authored_by for what that does and does not claim.`,
        },
      } : {}),
    };
  }

  return {
    runDir, m, audit, handoffRecheck, verdict, kind, isPro, legs, subjectId, runtimeName, policyName, stamp,
    events, anySidecars, workerCallCount, unpricedModels, driverLedger,
    driverModels: [...driverModelSet], workerModels: [...workerModelSet],
    workerRegions: [...workerRegionSet], workerProjects: [...workerProjectSet],
    driverCost, workerCost, totalCost, patch, resolved, submitted, instanceRow,
  };
}

// ------------------------------------------------- shared small helpers ---
const iso = (ms) => new Date(ms).toISOString();
const r6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Price one worker usage sidecar. Vertex `UsageMetadata` counts are mapped to
 * the pricing package's DISJOINT TokenCounts:
 *   prompt_token_count INCLUDES cached, so fresh = prompt - cached;
 *   thoughts are billed at the output rate, so output = candidates + thoughts.
 * Verified against a real sidecar: prompt+candidates+thoughts === total.
 */
function priceSidecar(sc) {
  const u = sc.usage ?? {};
  const prompt = u.prompt_token_count ?? 0;
  const cached = u.cached_content_token_count ?? 0;
  const candidates = u.candidates_token_count ?? 0;
  const thoughts = u.thoughts_token_count ?? 0;
  const tokens = {
    input_fresh: Math.max(0, prompt - cached),
    cache_read: cached,
    output: candidates + thoughts,
  };
  let usd = 0;
  let priced = false;
  try {
    // Priced in the region the sidecar says it ran in: the surcharge is a
    // property of the endpoint that served the call, not of our policy pin.
    usd = microToUsd(costMicroUsd(tokens, getVertexRates(sc.model, sidecarRegion(sc))).total);
    priced = true;
  } catch {
    // Unknown model id in the price table → cost stays 0 and `priced:false`
    // is surfaced in the export summary rather than silently guessed.
    usd = 0;
  }
  return { tokens, reasoning: thoughts, usd, priced, model: sc.model };
}

/** Patch stats from the graded diff (Pro) or the delivery diff (SDLC). */
function diffStats(p) {
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  if (!raw.trim()) return { files: 0, added: 0, removed: 0, paths: [] };
  const paths = [];
  let added = 0, removed = 0;
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ b/")) paths.push(line.slice(6).trim());
    else if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { files: paths.length, added, removed, paths };
}

// ------------------------------------------------------ read the batch ----
const runs = uniqueRunDirs.map(readRun);

// A PASS IS ONE CELL OVER ONE SAMPLE. Each guard below rejects a batch whose
// aggregates would be meaningless rather than averaging incompatible runs into
// a single column, and each says how to split the export instead.
const kinds = [...new Set(runs.map((r) => r.kind))];
if (kinds.length > 1) {
  console.error(`mixed task kinds in one batch (${kinds.join(", ")}). A study column is one kind — ` +
    "export the swepro runs and the sdlc runs separately.");
  process.exit(2);
}
const cells = [...new Set(runs.map((r) => `${r.runtimeName} × ${r.policyName}`))];
if (cells.length > 1) {
  console.error(`mixed cells in one batch (${cells.join(" | ")}). A column IS a runtime × policy cell — ` +
    "export one invocation per cell so the columns stay comparable.");
  process.exit(2);
}
const seen = new Map();
for (const r of runs) seen.set(r.subjectId, (seen.get(r.subjectId) ?? 0) + 1);
const repeated = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
if (repeated.length) {
  console.error(`the same instance appears more than once in this batch: ${repeated.join(", ")}.\n` +
    "A repeat run is a SECOND column, not a second row — the two verdicts belong side by side, not\n" +
    "averaged. Export each repeat in its own invocation (the default pass id already carries the\n" +
    "run clock, so they will not collide).");
  process.exit(2);
}

const first = runs[0];
const { kind, isPro, runtimeName, policyName } = first;

// ------------------------------------------------------- identity/ids ----
// STUDY = the track. No instance, no cable, no clock — see the header block.
// A cell or a sample belongs to a COLUMN, and a column is what gets added when
// tomorrow's batch is exported.
const STUDY_ID = argOf("--study") ?? (isPro ? "harness-swe-bench-pro" : "harness-sdlc");
// PASS = this batch. `<runtime>--<policy>--DDMM-HHMM` of the earliest run in
// it: the cell says what was tested, the clock keeps repeats of that cell from
// colliding, and re-exporting the same batch lands on the same id (idempotent).
const batchStamp = runs[0].stamp;
const PASS_ID = argOf("--pass") ?? `${runtimeName}--${policyName}--${batchStamp.key}`;

// Every event carries its column id; it is only knowable once the batch is
// resolved, so the per-run parse leaves it null and it is stamped here.
// Sorted by reconstructed timestamp so the Engineering View timeline reads as
// one chronological stream across the batch (Array#sort is stable, so attempts
// inside a run keep their emitted order when two stamps collide).
const events = runs.flatMap((r) => r.events).sort((a, b) => a.ts.localeCompare(b.ts));
for (const ev of events) ev.pass = PASS_ID;

// ------------------------------------------------- batch-level rollups ----
const anySidecars = runs.some((r) => r.anySidecars);
const driverCost = r6(runs.reduce((s, r) => s + r.driverCost, 0));
const workerCost = r6(runs.reduce((s, r) => s + r.workerCost, 0));
const totalCost = r6(driverCost + workerCost);
const workerCallCount = runs.reduce((s, r) => s + r.workerCallCount, 0);
const unpricedModels = new Set(runs.flatMap((r) => [...r.unpricedModels]));
const driverModels = [...new Set(runs.flatMap((r) => r.driverModels))];
const workerModels = [...new Set(runs.flatMap((r) => r.workerModels))];
// Column-level "where it ran" and "who paid", from the runs' own sidecars.
// workerProject is null when NO run in the column recorded one — the cable
// sentences below then omit the project rather than naming a wrong one.
const workerRegion = listOrNull(runs.flatMap((r) => r.workerRegions)) ?? WORKER_REGION_FALLBACK;
const workerProject = listOrNull(runs.flatMap((r) => r.workerProjects));
const driverLedger = runs.reduce((acc, r) => ({
  input: acc.input + r.driverLedger.input,
  cached: acc.cached + r.driverLedger.cached,
  output: acc.output + r.driverLedger.output,
  turns: acc.turns + r.driverLedger.turns,
  reported: acc.reported || r.driverLedger.reported,
}), { input: 0, cached: 0, output: 0, turns: 0, reported: false });

const gradedCount = runs.filter((r) => r.verdict != null).length;
const resolvedCount = runs.filter((r) => r.resolved).length;
const deliveredCount = runs.filter((r) => !r.m.failed_at).length;

/**
 * Identity of the SAMPLE this column covered — sorted instance ids, hashed.
 *
 * WHY it is exported: two columns are only comparable when they ran the SAME
 * instances. Batches here are added over time (one instance today, two
 * tomorrow), so a side-by-side cost/token matrix across columns with different
 * samples compares nothing — and the what-if projector on that surface can
 * model cost but cannot model whether a test would have passed. The dashboard
 * uses this key to show the comparison surface only when it is honest, which
 * is a decision the run evidence has to carry, not the view.
 */
const sampleIds = runs.map((r) => String(r.subjectId)).sort();
const sampleKey = createHash("sha256").update(sampleIds.join("\n")).digest("hex").slice(0, 12);

// ------------------------------------------------------- v1 manifest ----
// Breakdown blocks are computed from the events just built, exactly as the
// orchestration exporter does, so both producers yield identical structures.
const model_breakdown = {};
const phase_breakdown = {};
const module_breakdown = {};
const task_type_breakdown = {};
for (const ev of events) {
  const mb = (model_breakdown[ev.model] ??= { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 });
  mb.calls++; mb.cost_usd = r6(mb.cost_usd + ev.cost_usd);
  mb.input_tokens += ev.input_tokens; mb.output_tokens += ev.output_tokens;

  const pb = (phase_breakdown[ev.phase] ??= {
    calls: 0, cost_usd: 0, models: [],
    input_tokens: 0, input_tokens_cached: 0, output_tokens: 0, by_model: {},
  });
  pb.calls++; pb.cost_usd = r6(pb.cost_usd + ev.cost_usd);
  pb.input_tokens += ev.input_tokens; pb.input_tokens_cached += ev.input_tokens_cached;
  pb.output_tokens += ev.output_tokens;
  if (!pb.models.includes(ev.model)) pb.models.push(ev.model);
  const pbm = (pb.by_model[ev.model] ??= {
    calls: 0, cost_usd: 0, input_tokens: 0, input_tokens_cached: 0, output_tokens: 0,
  });
  pbm.calls++; pbm.cost_usd = r6(pbm.cost_usd + ev.cost_usd);
  pbm.input_tokens += ev.input_tokens; pbm.input_tokens_cached += ev.input_tokens_cached;
  pbm.output_tokens += ev.output_tokens;

  const mo = (module_breakdown[ev.module] ??= { calls: 0, cost_usd: 0 });
  mo.calls++; mo.cost_usd = r6(mo.cost_usd + ev.cost_usd);
  const tt = (task_type_breakdown[ev.task_type] ??= { calls: 0, cost_usd: 0 });
  tt.calls++; tt.cost_usd = r6(tt.cost_usd + ev.cost_usd);
}

// The artifacts block drives the dashboard's headline result tile. For a Pro
// column the unit is instances resolved; for SDLC it is tasks delivered.
//
// `build_ok` is the "everything green" signal the result tiles key off, so on a
// benchmark it must mean EVERY instance in the sample resolved. It used to be
// `!failed_at` — "the pipeline ran to completion" — which rendered a green tick
// over an unresolved 0/1 column, the pipeline having completed perfectly while
// resolving nothing.
const patchFiles = runs.reduce((s, r) => s + (r.patch?.files ?? (r.m.delivery?.files_changed?.length ?? 0)), 0);
const patchLoc = runs.reduce((s, r) => s + (r.patch?.added ?? 0) + (r.patch?.removed ?? 0), 0);
const artifacts = isPro
  ? {
      tests: runs.length,
      tests_passed: resolvedCount,
      tests_failed: runs.length - resolvedCount,
      build_ok: resolvedCount === runs.length,
      // Separate from build_ok on purpose (Sriram, 2026-07-25): this says the
      // verdict came from Scale's Docker evaluator rather than from us, which
      // is true whether or not the instance resolved. The card badge reads THIS;
      // build_ok above stays "everything in this column resolved" so the green
      // "Resolved ✓" tile keeps meaning what it says. The SDLC orchestrator's
      // own exporter stamps the same field for the same reason.
      harness_graded: true,
      test_pass_rate: runs.length ? resolvedCount / runs.length : 0,
      files: patchFiles,
      loc: patchLoc,
      result_label: "resolved",
      result_unit: "instances",
    }
  : {
      tests: runs.length,
      tests_passed: deliveredCount,
      tests_failed: runs.length - deliveredCount,
      build_ok: deliveredCount === runs.length,
      test_pass_rate: runs.length ? deliveredCount / runs.length : 0,
      files: patchFiles,
      loc: patchLoc,
      result_label: "delivered",
      result_unit: "tasks",
    };

// ------------------------------------------------- batch audit summary ---
// Roll the per-run audit up to the column WITHOUT flattening it to one number.
//
// Where each run's numbers come from, in order of preference:
//   1. manifest.json's `{ total, critical, by_family }` block — what runs
//      written after 2026-07-29 carry;
//   2. audit.json's full arrays — the fallback for runs whose manifest still
//      holds the old bare integer. audit.json kept the whole list all along,
//      so a legacy run sitting next to its audit.json still yields a REAL
//      critical count rather than an "unknown";
//   3. nothing at all — `critical: null`, meaning unknown, never 0.
//
// mergeFlagSummaries propagates that null: one unknowable run makes the whole
// column's critical count unknowable, and `critical_known: false` says so out
// loud instead of publishing a confident zero.
/**
 * The column-level version. `typed_by` is identical for every run in a cell
 * (same runtime, same guard), so it is taken from the first. `authored_by` is
 * resolved WORST-FIRST — an unchecked run beats a mixed one, a mixed one beats
 * a clean one — so a column can never read cleaner than the run inside it.
 */
function columnAttribution(runs) {
  const perRun = runs.map((r) => attributionSplit(r.m, r.audit, r.handoffRecheck));
  const worst = perRun.find((a) => a.authored_by.startsWith("UNKNOWN"))
    ?? perRun.find((a) => a.authored_by.startsWith("MIXED"))
    ?? perRun[0];
  // The counts have to come from the SAME resolution the sentence used. Reading
  // the raw manifest values here instead would publish "0 passages flagged"
  // under an authored_by line that says MIXED, for every run that predates the
  // content lint — a column contradicting itself in adjacent fields.
  const resolved = runs.map((r) => resolvedIntegrity(r.m, r.audit, r.handoffRecheck));
  const totals = mergeFlagSummaries(resolved);
  return {
    typed_by: perRun[0]?.typed_by ?? null,
    authored_by: worst?.authored_by ?? null,
    // The column's own arithmetic, so the sentence above is checkable.
    handoffs_scanned: resolved.reduce((s, r) => s + (r.scanned ?? 0), 0),
    passages_flagged: totals.total,
    runs_flagged: perRun.filter((a) => a.authored_by.startsWith("MIXED")).length,
    runs_unchecked: perRun.filter((a) => a.authored_by.startsWith("UNKNOWN")).length,
    // Which measurement each run's number came from — "run" for a run whose own
    // audit ran the lint, "re-read" for one measured after the fact from its
    // recorded hand-offs, "never" for one where neither was possible.
    measured_at: [...new Set(resolved.map((r) => r.measured_at))].sort(),
  };
}

function batchFlagSummary(runs, manifestKey, auditKey) {
  return mergeFlagSummaries(runs.map((r) => runFlagSummary(r, manifestKey, auditKey)));
}

function auditSummaryForBatch(runs) {
  const flags = batchFlagSummary(runs, "audit_flags", "flags");
  // Same resolution as columnAttribution — the batch total must count the
  // re-read findings for runs that predate the lint, or the study header would
  // publish 0 while the column beneath it publishes MIXED.
  const resolved = runs.map((r) => resolvedIntegrity(r.m, r.audit, r.handoffRecheck));
  const integrity = mergeFlagSummaries(resolved);
  // Coverage, so a pair of zeros can never be mistaken for a clean bill of
  // health. `runs_audited` counts the runs that produced a trajectory at all
  // (agy print mode produces none, and that gap is a finding, not a pass);
  // `handoffs_scanned` is how many driver→worker task files the content lint
  // actually read, at run time or on the after-the-fact re-read.
  const covered = runs.filter((r) => r.audit?.auditable ?? r.m.audit_coverage?.auditable ?? false);
  return {
    flags,
    integrity_warnings: integrity,
    coverage: {
      runs: runs.length,
      runs_audited: covered.length,
      handoffs_scanned: resolved.reduce((s, r) => s + (r.scanned ?? 0), 0),
      delegation_content_checked: resolved.every((r) => r.measured_at !== "never"),
      // Never collapse the two provenances into one boolean: a column measured
      // entirely after the fact cannot raise guard-evasion-by-proxy, and a
      // reader has to be able to see that from the record.
      delegation_content_measured_at: [...new Set(resolved.map((r) => r.measured_at))].sort(),
    },
    note: flags.critical === null || integrity.critical === null
      ? "At least one run in this column predates the criticality breakdown and has no audit.json " +
        "to recover it from, so the column's critical count is UNKNOWN, not zero."
      : `${flags.critical + integrity.critical} critical finding(s) across ` +
        `${flags.total + integrity.total} audit record(s). A critical finding does not void the ` +
        `run — it is still graded, because discarding evidence is worse than publishing it — but ` +
        `it is marked here, in the evidence bundle, and on the dashboard.`,
  };
}

const sdkVersion = workerSdkVersionAtExport();
const batchAudit = auditSummaryForBatch(runs);
const v1Manifest = {
  pass: PASS_ID,
  policy_name: policyName,
  // The column's window: earliest start to latest finish across its runs. The
  // duration is the SUM of the runs' own wall clocks rather than the span
  // between those two instants, because the harness executes a batch
  // sequentially and the gaps between runs are operator time, not run time.
  started_at: runs.map((r) => r.m.started_at).filter(Boolean).sort()[0] ?? null,
  ended_at: runs.map((r) => r.m.finished_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  duration_sec: runs.reduce((s, r) => s + (r.m.totals?.wall_seconds ?? 0), 0),
  total_cost_usd: totalCost,
  total_input_tokens: events.reduce((s, e) => s + e.input_tokens, 0),
  total_input_tokens_cached: events.reduce((s, e) => s + e.input_tokens_cached, 0),
  total_output_tokens: events.reduce((s, e) => s + e.output_tokens, 0),
  model_breakdown,
  phase_breakdown,
  module_breakdown,
  task_type_breakdown,
  artifacts,
  // Additive, harness-specific provenance. The dashboard ignores unknown
  // fields; this block is what makes the exported numbers auditable without
  // going back to the run directories.
  harness: {
    kind,
    instances: runs.length,
    sample_key: sampleKey,
    sample_ids: sampleIds,
    runtime: first.m.runtime,
    policy_sha256: [...new Set(runs.map((r) => r.m.policy?.sha256).filter(Boolean))],
    delegated: anySidecars,
    // The integration under test, stated once and structurally: which runtime
    // drove, which SDK carried the delegation, where the worker executed, and
    // which seat/credential paid for each side.
    cable: anySidecars ? {
      driver_runtime: `${first.m.runtime?.name} ${first.m.runtime?.version ?? ""}`.trim(),
      driver_models: driverModels,
      driver_auth: "Claude Code Max seat (OAuth) — not the metered Anthropic API",
      worker_sdk: WORKER_SDK,
      worker_sdk_label: WORKER_SDK_LABEL,
      worker_sdk_version_at_export: sdkVersion,
      worker_models: workerModels,
      worker_transport: `Vertex endpoint (vertex=True) · ${workerRegion}`,
      // Named from the sidecars, never from a constant: this is the sentence
      // that tells a reader whose Google Cloud bill the worker side landed on.
      worker_auth: workerProject
        ? `Google ADC on the ${workerProject} project`
        : "Google ADC — the operator's own Google Cloud project (not recorded in this run's evidence)",
      worker_project: workerProject,
      worker_region: workerRegion,
      summary: `${runtimeName} driver → ${WORKER_SDK_LABEL} worker (Gemini on Vertex ${workerRegion})`,
      // ---- display-ready strings -----------------------------------------
      // The dashboard renders these VERBATIM in the cable strip that sits above
      // every study tab. They are composed HERE, in the harness, on purpose: the
      // harness is the only thing that knows what actually ran, so the dashboard
      // stays a renderer and can never drift into asserting a cable that the
      // evidence does not support. A column with no cable emits none of this
      // and the strip does not render at all.
      driver_display: `${first.m.runtime?.name} ${first.m.runtime?.version ?? ""}`.trim() +
        " · Max seat (OAuth) · file-edit tools disabled",
      worker_display: `via ${WORKER_SDK_LABEL} (${WORKER_SDK}` +
        (sdkVersion ? ` ${sdkVersion}` : "") + `) → Vertex ${workerRegion}`,
      // Structural claim only. What the driver may have DICTATED down the
      // hand-off channel is a separate, measured claim and lives in
      // `attribution` below — never folded into this sentence, because the two
      // have different strengths and one of them can be false.
      handoff_note: `The driver holds the plan but cannot touch the tree — Edit / Write / MultiEdit ` +
        `are disallowed and a pre-tool hook blocks every tree-writing shell command. ` +
        `Every line of code in this column came back through the ${WORKER_SDK_LABEL}: ` +
        `${workerCallCount} hand-off(s) across ${runs.length} instance(s).`,
      // The column's own typed_by / authored_by, worded exactly as the
      // instance rows word theirs, and computed from the WORST run in the
      // column: if one instance is mixed, the column is mixed. A column that
      // averaged its way back to "clean" over a flagged run would be the
      // specific dishonesty this block exists to prevent.
      attribution: columnAttribution(runs),
      billing_note: `Driver spend is billed to a Claude Code Max seat (OAuth), not the metered ` +
        `Anthropic API, so it is CLI-modeled rather than wallet-real. Worker spend is real ` +
        `Vertex billing on Google ADC` +
        (workerProject ? ` (project ${workerProject})` : "") +
        `, priced here from the SDK's own token counts.`,
      // Answers the first question a reviewer asks about these two numbers.
      // Every figure in it is measured, not estimated: turns and tokens come
      // from the driver's own result events, hand-offs from the trajectory.
      driver_cost_note: `The driver is the larger number even though it wrote no code, and that ` +
        `is the finding, not a glitch. Across ${driverLedger.turns} turns it read ` +
        `${driverLedger.input.toLocaleString("en-US")} prompt tokens ` +
        `(${driverLedger.cached.toLocaleString("en-US")} of them cache reads) and wrote ` +
        `${driverLedger.output.toLocaleString("en-US")} — all of it orchestration and ` +
        `verification: composing each task, reading back replies, diffs and test output, and ` +
        `judging whether to accept or re-delegate. Reviewing on a premium model costs more than ` +
        `authoring on a cheap one.`,
    } : null,
    // The two cost regimes, never blended into one unexplained total.
    driver_cost_usd: driverCost,
    driver_cost_basis: "cli-reported by Claude Code on a Max seat — MODELED, not wallet-real",
    driver_tokens_reported: driverLedger.reported,
    // What the driver's dollars actually bought. Turns and tokens make the
    // orchestration visible, so "the driver costs more than the model that
    // wrote the code" reads as a finding instead of a discrepancy.
    driver_work: {
      turns: driverLedger.turns,
      input_tokens: driverLedger.input,
      input_tokens_cached: driverLedger.cached,
      output_tokens: driverLedger.output,
      what_it_spent_on: "orchestration and verification — composing each worker task, " +
        "reading back the worker's replies, git diffs and test output, and deciding whether " +
        "to accept or re-delegate. It cannot author code: Edit / Write / MultiEdit / " +
        "NotebookEdit are disallowed and a pre-tool hook blocks tree-writing shell commands.",
    },
    worker_cost_usd: workerCost,
    worker_cost_basis: anySidecars
      ? `computed here from real SDK token counts via @harness/pricing ` +
        `getVertexRates(model, "${workerRegion}") — the region comes from each sidecar, and a ` +
        `non-global Vertex endpoint carries a +10% surcharge`
      : "n/a (non-delegated cell)",
    worker_calls: workerCallCount,
    pricing_version: PRICING_VERSION,
    ...(unpricedModels.size ? { unpriced_models: [...unpricedModels] } : {}),
    // ---- audit, with criticality intact -----------------------------------
    // This used to be `audit_flags: <one summed integer>`. A sum is the worst
    // possible shape here: twelve instances with one critical between them and
    // twelve instances with none both collapse to a number, and the reader has
    // no way to tell which. Every batch now publishes both lists as
    // { total, critical, by_family }, plus the coverage fields that say what
    // was actually checked. `audit_flags` is kept as the flat total so nothing
    // that already reads a number breaks.
    audit: batchAudit,
    audit_flags: batchAudit.flags.total,
    ...(isPro ? { graded: { instances: runs.length, graded: gradedCount, resolved: resolvedCount } } : {}),
    // Per-run provenance INSIDE the column. Without it a batched column is a
    // set of totals with no way back to the directories that produced them.
    runs: runs.map((r) => ({
      subject_id: r.subjectId,
      run_dir: r.runDir.replace(ROOT + "/", ""),
      started_at: r.m.started_at ?? null,
      wall_seconds: r.m.totals?.wall_seconds ?? null,
      total_cost_usd: r.totalCost,
      driver_cost_usd: r.driverCost,
      worker_cost_usd: r.workerCost,
      worker_calls: r.workerCallCount,
      failed_at: r.m.failed_at ?? null,
      ...(r.isPro ? { resolved: r.verdict ? r.resolved : null } : { delivered: !r.m.failed_at }),
      ...(r.m.judge_scores ? { judge_scores: r.m.judge_scores } : {}),
      // Per-run criticality, so a reader who sees a non-zero critical count on
      // the column can find WHICH run carries it without opening any run dir.
      audit: runFlagSummary(r, "audit_flags", "flags"),
      integrity_warnings: resolvedIntegrity(r.m, r.audit, r.handoffRecheck),
    })),
    timestamps_reconstructed: true,
  },
};

// ------------------------------------------------- instances.json (Pro) ---
// One row per instance in the batch. Identical shape to the 12× benchmark
// export, so the Instances tab renders it with no special-casing.
const instancesReport = isPro
  ? {
      schema: 1,
      totals: {
        instances: runs.length,
        submitted: runs.filter((r) => r.submitted).length,
        graded: gradedCount,
        resolved: resolvedCount,
        unresolved: runs.filter((r) => r.verdict && !r.resolved).length,
        errors: runs.filter((r) => !r.verdict && r.submitted).length,
        no_patch: runs.filter((r) => !r.submitted).length,
      },
      // The harness uses FLAT retry (same binding every attempt) — there is no
      // escalation ladder to report, so these are structurally zero, not unknown.
      escalation: { triggered: 0, rescued: 0, extra_cost_usd: 0 },
      instances: runs.map((r) => r.instanceRow),
    }
  : null;

// ----------------------------------------------------------- registry ----
// One display form of the runtime for EVERY label level. The study card says
// "Claude Code" — a column that says "claude-code" reads as a different thing
// than the card it sits under, so the raw slug never reaches a label.
const prettyRuntime = runtimeName.split("-").map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1)).join(" ");

// Cell naming. For a delegated column the cell is a CABLE, not a policy name:
// "claude-code × all-gemini-flash-high" says nothing about the Antigravity SDK
// that carries every hand-off, which is the integration the study exists to
// demonstrate. Model ids are pulled from the runs (evidence), never typed —
// and they appear ONLY here on the column, never on the study card: the cell's
// fixed identity is runtime × SDK, the worker binding is per-column.
const cellLabel = anySidecars
  ? `${prettyRuntime} (${driverModels.join(", ")}) × ${WORKER_SDK_LABEL} (${workerModels.join(", ")})`
  : `${prettyRuntime} × ${policyName}`;
// Compact form for chips and run cards, where the long form would wrap badly.
const cellShort = anySidecars ? `${prettyRuntime} × ${WORKER_SDK_LABEL}` : `${prettyRuntime} × ${policyName}`;

// When the batch ran. A single run keeps its clock (two runs of one cell on the
// same day are told apart by it); a multi-run batch reads as a day, or a range
// when a --runs-root sweep spanned days.
const days = [...new Set(runs.map((r) => r.stamp.dayPretty))];
const batchWhen = runs.length === 1
  ? runs[0].stamp.pretty
  : days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}`;
const outcomeBit = isPro
  ? `${runs.length} instance${runs.length === 1 ? "" : "s"} · ${resolvedCount} resolved`
  : `${runs.length} task${runs.length === 1 ? "" : "s"} · ${deliveredCount} delivered`;

const passEntry = {
  id: PASS_ID,
  policy: policyName,
  directory: PASS_ID,
  // The batch clock is part of both labels because a study holds the SAME cell
  // more than once, and when it does, the only honest way to show it is side by
  // side with the dates and the outcomes visible. Without the clock two runs of
  // one cable render as indistinguishable columns.
  label: argOf("--label") ?? `${cellLabel} — ${batchWhen} · ${outcomeBit}`,
  shortLabel: `${cellShort} · ${batchWhen} · $${totalCost.toFixed(4)}`,
  // PLACEHOLDER — do not tune this value, and do not derive it from the run
  // (2026-07-26). The registry merge below reassigns every column's headerColor
  // from COLUMN_ACCENTS by position, unconditionally, so whatever is written
  // here is overwritten before it reaches studies.json. Deriving a "meaningful"
  // colour here (by worker binding, say) produces code that reads as live,
  // tests as live, and has no effect whatsoever. Column colour is decided in
  // exactly one place: COLUMN_ACCENTS.
  headerColor: "coral",
  ...(instancesReport ? { has_instances: true } : {}),
};

// The study is the TRACK. Everything here has to stay true after any future
// batch — no instance, no repo, no model id, no date, no count. Anything that
// would change when tomorrow's runs land belongs on the column above or on the
// Instances tab, not in this card.
//
// NAMING RULE (Sriram, 2026-07-25): model names are banned from the card —
// instances can be run under any worker binding, so "gemini-3.5-flash" on the
// card would be stale the day a different model is delegated to. The SDK is
// NOT banned: for a delegated track the cable (driver runtime × Antigravity
// SDK) IS the story the card exists to tell, and the SDK can carry different
// models without the card changing. A future different cable (another driver,
// another SDK) is a different story → export it as a different study with
// --study, don't relabel this one.
const studyLabel = anySidecars
  ? `${prettyRuntime} × ${WORKER_SDK_LABEL} · ${isPro ? "SWE-bench Pro" : "SDLC"}`
  : `${prettyRuntime} Harness · ${isPro ? "SWE-bench Pro" : "SDLC"}`;
const studyEntry = {
  id: STUDY_ID,
  label: studyLabel,
  shortLabel: anySidecars
    ? `${prettyRuntime} × ${WORKER_SDK_LABEL}`
    : `${prettyRuntime} Harness · ${isPro ? "Pro" : "SDLC"}`,
  phase: "Study Console",
  vertical: isPro ? "SWE-bench Pro" : "SDLC",
  // Two harness study cards sit on the same Portfolio grid, and `coral` was
  // already taken by the SWE-bench Pro card (and by leave-requests-mini). A
  // third coral tile makes the grid read as one repeated study. Terracotta is
  // the palette's documented "Anthropic-family, distinct from coral" token —
  // so the SDLC track still reads as part of the same Claude-driven family
  // while being separable at a glance. Pro keeps coral: it has shipped.
  headerColor: isPro ? "coral" : "terracotta",
  description: isPro
    ? (anySidecars
        // "typed", not "authored" (2026-07-29, finding C8). Typing is the claim
        // the harness makes structurally — the driver has no file-edit tools and
        // the hook refuses tree-writing shell commands. Authorship (did the
        // driver DICTATE what the worker typed?) is a weaker claim that only the
        // post-run lint can answer, and the card is too small to carry both, so
        // it states the one that cannot be wrong and leaves the other to the
        // brief and to `cable.attribution`.
        ? `Frozen SWE-bench Pro instances (Scale AI) solved by a ${prettyRuntime} driver that cannot ` +
          `edit files — every line of every patch is typed by a worker model reached through ` +
          `Google's ${WORKER_SDK_LABEL}. Columns accumulate as batches land; verdicts come from the ` +
          `benchmark's own Docker harness; driver and worker spend stay separate.`
        : `Frozen SWE-bench Pro instances (Scale AI) solved end-to-end by a ${prettyRuntime} CLI agent ` +
          `under the harness-matrix runner. Columns accumulate as batches land; verdicts come from ` +
          `the benchmark's own Docker harness.`)
    : (anySidecars
        ? `SDLC delivery tasks built end-to-end by a ${prettyRuntime} driver that cannot edit files — ` +
          // Same one-word narrowing as the Pro card above, same reason.
          `every file in the deliverable is typed by a worker model reached through Google's ` +
          `${WORKER_SDK_LABEL}. Columns accumulate as batches land; deliveries are build- and ` +
          `test-verified; driver and worker spend stay separate.`
        : `SDLC delivery tasks built end-to-end by a ${prettyRuntime} CLI agent under the ` +
          `harness-matrix runner. Columns accumulate as batches land; deliveries are build- and ` +
          `test-verified.`),
  directory: STUDY_ID,
  passes_root: STUDY_ID,
  passes: [passEntry],
};

// -------------------------------------------------------------- write ----
// Paths and the registry merge are resolved BEFORE anything is rendered,
// because the brief is study-level. Everything here is read-only, so --dry-run
// still gets an accurate preview.
const studyDir = join(OUT, "studies", STUDY_ID);
const passDir = join(studyDir, PASS_ID);
const registryPath = join(OUT, "studies.json");
const briefPath = join(studyDir, "brief.md");

// Registry merge: replace the study in place when it exists (preserving the
// dashboard's display order), and merge THIS column into that study's list so
// exporting a second cell — or tomorrow's batch — adds a column instead of
// replacing the first.
let studies = [];
if (existsSync(registryPath)) {
  try { studies = readJson(registryPath).studies ?? []; } catch { studies = []; }
}
const existingIdx = studies.findIndex((s) => s.id === STUDY_ID);
// Ghost-pass prune. A pass id encodes the batch clock, so re-exporting under a
// corrected id used to leave the OLD id behind in the registry pointing at a
// directory that no longer exists — the dashboard then renders a permanently
// "queued" column with no telemetry behind it. Drop any column of THIS study
// whose data directory is gone; other studies are never touched.
const existingPasses = existingIdx >= 0
  ? (studies[existingIdx].passes ?? []).filter((p) => {
      if (p.id === PASS_ID) return false;                 // replaced below
      const dir = join(studyDir, p.directory ?? p.id);
      if (existsSync(dir)) return true;
      console.log(`  pruned stale registry pass "${p.id}" (no data at ${dir})`);
      return false;
    })
  : [];
// Per-column accent (Sriram, 2026-07-25). Every batch used to export as
// "coral", so a study holding two columns drew two identically-coloured series
// in the Runs Result lane chart and the Compare matrix — the reader could only
// tell them apart by bar position, and the delegated driver/worker stack made
// that four indistinguishable swatches. Colour is assigned by the column's
// position in the (chronologically merged) pass list rather than stored per
// batch, so re-exporting or pruning a column can never leave two columns
// sharing a hue. Names must exist in the dashboard's ACCENT map (lib/theme.ts).
// Deliberately skips emerald/rose — those read as resolved/failed verdicts
// elsewhere on the page and must not double as a column identity.
const COLUMN_ACCENTS = ["coral", "indigo", "amber", "violet", "cyan", "terracotta"];
const mergedPasses = (existingIdx >= 0 ? existingPasses.concat([passEntry]) : [passEntry])
  .map((p, i) => ({ ...p, headerColor: COLUMN_ACCENTS[i % COLUMN_ACCENTS.length] }));
if (existingIdx >= 0) {
  studies[existingIdx] = { ...studies[existingIdx], ...studyEntry, passes: mergedPasses };
} else {
  studies.push(studyEntry);
}

/**
 * The task brief(s) this CARD covers — the literal specification handed to the
 * models, collected across every column, not just the batch being exported.
 *
 * WHY THIS IS HERE AT ALL. An orchestrator SDLC card's brief IS
 * the project spec: open uptime-ping and you read the endpoint it had to build,
 * its scope and its out-of-scope, and only then look at what four policies made
 * of it. The harness SDLC card shipped a generated *study* brief instead, so
 * the one question an SDLC reader arrives with — "what was it asked to build?"
 * — had no answer anywhere on the card. The task brief is a study-level fact
 * (it is frozen input, sha256'd into every manifest as `brief_sha256`), so it
 * belongs in the study brief, and it is read from the task directory rather
 * than retyped so the two can never drift.
 *
 * Collected across ALL columns because the brief is written once per study: a
 * later batch on a second task must ADD its spec, not silently replace the
 * first one. Columns already exported are read back from their own manifests
 * (`harness.sample_ids`); the column being written now is not on disk yet, so
 * its ids come from this batch.
 */
const trackTaskIds = [...new Set(
  mergedPasses.flatMap((p) => {
    if (p.id === PASS_ID) return sampleIds;
    const mf = readJsonOrNull(join(studyDir, p.directory ?? p.id, "manifest.json"));
    return mf?.harness?.sample_ids ?? [];
  }),
)].sort();
const trackTaskBriefs = isPro ? [] : trackTaskIds.map((id) => {
  const p = resolveHarnessPath(join("examples", id, "brief.md"));
  return { id, markdown: p ? readFileSync(p, "utf8").trim() : null };
});

/**
 * Reproduce a task brief inside the study brief as a blockquote.
 *
 * The words are exact — this is the spec, and a paraphrase of a spec is not a
 * spec. Only two structural things change, both purely for typography inside a
 * host document: the leading `# Title` is lifted out (it becomes part of the
 * section heading, so the page does not carry two h1s), and any remaining ATX
 * heading is demoted to at least h4 so a task's `## Scope` cannot outrank the
 * study brief's own sections.
 */
function quoteTaskBrief(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = null;
  if (/^#\s+/.test(lines[0] ?? "")) title = lines.shift().replace(/^#\s+/, "").trim();
  while (lines.length && lines[0].trim() === "") lines.shift();
  const quoted = lines.map((l) => {
    const demoted = l.replace(/^(#{1,3})\s+/, "#### ");
    return demoted.trim() === "" ? ">" : `> ${demoted}`;
  });
  return { title, quoted };
}

/**
 * The study brief — a GENERIC project brief, not a run report.
 *
 * It used to be generated from the run being exported: the cable's models, the
 * dollar totals, a verdict table. That made the study's own overview page the
 * one surface guaranteed to go stale — every new batch either contradicted it
 * or silently rewrote it. So it now describes only what is true of the track
 * itself (what the benchmark is, what one run does, how patches are authored,
 * how verdicts are graded, how the two wallets are accounted) and contains no
 * number, no model id and no date. Everything run-specific has a home already:
 * Runs Result for the column totals, Instances for the per-instance evidence.
 *
 * Written only when absent, or with --rewrite-brief, so hand-edits survive
 * every subsequent export.
 */
// The BENCHMARK brief is no longer written here (Sriram, 2026-07-25). It was
// ~110 lines of hand-maintained markdown that said the same things as the
// orchestrator's own brief generator, in a second voice, in a second file — so the two
// paths could describe one benchmark two different ways and neither would look
// wrong on its own. Both now render from tools/lib/benchmark-brief.mjs, which
// walks ONE section outline and accepts only fixed identity (dataset, cable,
// cell shape). Nothing a run produces can reach it, so the brief cannot go
// stale when the next batch lands.
//
// The SDLC-task variant below stays inline on purpose: it is a different
// document about a different subject — no dataset, no instances, no held-out
// tests — and bending it into the benchmark outline would make both worse.

/**
 * The DELEGATED SDLC study brief.
 *
 * WHAT IT INHERITS, AND FROM WHERE (Sriram, 2026-07-26). This card has two
 * parents and the brief takes a different thing from each:
 *
 *   From an orchestrator SDLC card (uptime-ping, recipe-box, leave-requests-mini):
 *   the brief LEADS WITH THE PROJECT SPEC. That is what makes an SDLC card
 *   readable — you see what was asked before you see what it cost — and it is
 *   the whole reason `## The task` sits above the machinery here.
 *
 *   From the Claude Code × Antigravity SDK · SWE-bench Pro card: the TRACK
 *   framing (a card is a fixed cell that accumulates columns, so the sample is
 *   a property of a column), the delegation contract, the two-wallet cost
 *   accounting, the integrity note and the closing "where the numbers are"
 *   pointer. Those sections are the delegated cable's story and are true on
 *   either leg.
 *
 * Two things come from NEITHER parent, because neither parent has them: slot
 * discipline (the SDLC orchestrator writes a whole repo; here the worker may
 * touch three paths inside a chassis that is hashed and proven green first) and
 * the four-dimension judge. They are what makes "a model built this" checkable
 * on this card, so they are sections, not footnotes.
 *
 * The single-seat variant below it keeps the hedged "two shapes of cell" copy,
 * because a single-seat column really can be either. This one does not hedge:
 * every column that reaches it is delegated (`anySidecars`), and the study
 * label, description and cable strip all already say so — a brief that hedged
 * would be the only surface on the card unsure of what it ran.
 *
 * As with every generated brief: no number a run produced, no model id, no
 * date. The task spec is not run output — it is frozen input, hashed into each
 * manifest as `brief_sha256` — so reproducing it cannot go stale.
 */
function delegatedSdlcBrief() {
  const taskSections = [];
  if (trackTaskBriefs.length === 1 && trackTaskBriefs[0].markdown) {
    const { title, quoted } = quoteTaskBrief(trackTaskBriefs[0].markdown);
    taskSections.push(
      `## The task — ${title ?? trackTaskBriefs[0].id}`,
      "",
      "Every column on this card was handed this and nothing else. There was no follow-up",
      "conversation, no clarifying answer and no worked example: the driver read the brief, and",
      "everything downstream — the plan, the schema, the code, the tests — is what came back.",
      "Reproduced word for word:",
      "",
      ...quoted,
      "",
    );
  } else if (trackTaskBriefs.length > 1) {
    taskSections.push(
      "## The tasks",
      "",
      "This card has covered more than one delivery task. Each was handed to its column whole and",
      "on its own — there was no follow-up conversation and no worked example. Which task a given",
      "column ran is on that column; the specs themselves, word for word:",
      "",
    );
    for (const t of trackTaskBriefs) {
      if (!t.markdown) {
        taskSections.push(`### ${t.id}`, "", `Spec not readable at export time; it is at \`tasks/${t.id}/brief.md\`.`, "");
        continue;
      }
      const { title, quoted } = quoteTaskBrief(t.markdown);
      taskSections.push(`### ${title ?? t.id}`, "", ...quoted, "");
    }
  } else if (trackTaskBriefs.length === 1) {
    // The id is known but the spec file was not found. Say so and point at it
    // rather than quietly dropping the section — a missing spec is a fact about
    // the export, not something to hide behind a shorter document.
    taskSections.push(
      "## The task",
      "",
      `This card covers \`${trackTaskBriefs[0].id}\`. Its brief was not readable at export time;`,
      `it lives at \`tasks/${trackTaskBriefs[0].id}/brief.md\` in the harness.`,
      "",
    );
  }

  return [
    `# Project Brief — ${studyLabel}`,
    "",
    "## One-line summary",
    "A small delivery task built end to end by a " + prettyRuntime + " driver that cannot edit files —",
    // "typed", not "authored" — see the study-card comment above (finding C8).
    `every line of the deliverable is typed by a worker model reached through Google's`,
    `${WORKER_SDK_LABEL} — then built, tested and scored from the delivered tree.`,
    "",
    ...taskSections,
    "## What this study is",
    "",
    "This card is a **track**, not a single experiment, and its cell is **fixed**: every run column",
    `is the same cable — a **${prettyRuntime}** driver wired to the **${WORKER_SDK_LABEL}**. What`,
    "varies from column to column is the routing policy, the worker model the SDK carried that day,",
    "and the date. Columns are added over time, so a batch is a property of a column and never of",
    "the study.",
    "",
    "Because every column runs the same task through the same stages, the columns are directly",
    "comparable — that comparison is **Compare Runs**, and a column's own totals are on",
    "**Runs Result**.",
    "",
    "## What one task run does",
    "",
    "Eight stages, in order, each a fresh agent session whose only input is the previous stage's",
    "written output — never a shared chat history:",
    "",
    "`requirements` → `design` → `plan-packets` → `execute` → `verify` → `review` → `judge` → `report`",
    "",
    "Two of the eight make no model call at all. **verify** installs, builds and runs the tests, and",
    "**report** assembles the manifest — both are the harness's own code, so a delivery cannot be",
    "declared working by a model that says it is.",
    "",
    "Retries are **flat**: a stage that fails its gate is retried on the same binding. There is no",
    "escalation ladder — no stage is quietly promoted to a more expensive model, so a column's cost",
    "cannot be explained away by \"it escalated\". Timeouts and the per-stage budget are part of the",
    "study definition and are identical in every column; each column ships the exact policy it ran",
    "as `policy_snapshot.yaml`.",
    "",
    "## Who writes the code",
    "",
    `The driver — the ${prettyRuntime} CLI — *drives* but cannot write: its file-edit tools are`,
    "disallowed and a pre-tool hook blocks every tree-writing shell command, so it is structurally",
    "incapable of typing a line of the deliverable. Every file is typed by a worker model",
    `reached through the ${WORKER_SDK_LABEL}: the driver composes each hand-off, the SDK carries it,`,
    "and the driver reads back the reply, the diff and the build output, then accepts or",
    "re-delegates.",
    "",
    // The section is titled "Who writes the code", so it is the one surface that
    // has room to state the ceiling honestly rather than only the strong half
    // (2026-07-29, finding C8). The old text said "incapable of AUTHORING a
    // line", which reads as a structural guarantee about authorship — and the
    // harness guarantees no such thing, because the hand-off channel is free
    // text by design.
    "That is a claim about **who typed the bytes**, and it is structural — no run can violate it.",
    "Whether the driver *dictated* what the worker typed is a separate and weaker claim: the",
    "hand-off is free text, so nothing stops a driver from spelling out a fix, and only a post-run",
    "lint over every hand-off can tell. Each column reports that separately, measured rather than",
    "assumed — and a column where the lint found dictated passages says so rather than being",
    "quietly dropped.",
    "",
    `The driver runtime and the ${WORKER_SDK_LABEL} are this study's fixed identity. **Which worker`,
    "model** sits behind the SDK is a per-column choice — each column states its own binding in its",
    // "the newest runs used" was wrong twice over (Sriram, 2026-07-26): the
    // strip took the FIRST column's cable, not the newest, and it now shows the
    // union across every column with each side marked when the columns
    // disagree. Describe what it actually does, so the brief and the strip
    // cannot tell a reader two different stories about the same widget.
    "label, and the strip above these tabs shows the cable itself — driver, worker, SDK version",
    "and region — pooled across every column, with a side marked *varies by column* when the",
    "columns bound different models there.",
    "",
    "## What the worker is allowed to touch",
    "",
    "The worker does not start from an empty directory. It is given a running **chassis** — the",
    "framework wiring, the test runner, the build config — and may write in exactly three places:",
    "",
    "- `src/modules/**` — the feature code",
    "- `test/modules/**` — its tests",
    "- `prisma/schema.prisma` — append-only, below a marker; the chassis text above it must survive",
    "  byte-identically",
    "",
    "Every other file is chassis and is recorded in a sha256 manifest. If a chassis file's content",
    "changes, the run is not repaired — it is reported, because a delivery that only builds because",
    "the scaffold moved is not a delivery. The chassis is built and its tests are green **before**",
    "the first model call, so a red build afterwards is attributable to the model rather than to",
    "the starting conditions.",
    "",
    "This is what makes the claim checkable: the delivered tree can be diffed against the scaffold,",
    "and everything that appears in that diff came back through the SDK.",
    "",
    "## How a delivery is verified",
    "",
    "Verification is executed, not judged: dependencies are installed, the project is built, and its",
    "tests are run against the delivered tree. A stage that cannot be built or cannot pass its own",
    "tests fails its gate, and the failure is recorded verbatim rather than summarised away.",
    "",
    "## How a delivery is scored",
    "",
    "Scoring is separate from verification and never overrides it. A judge stage reads the brief and",
    "the delivered tree and returns four scores on a 0–10 scale — **requirements fidelity**, **code",
    "quality**, **test quality**, and an **overall** — with a written rationale for each. The scores",
    "describe a delivery that already built and passed its tests; they cannot rescue one that did",
    "not.",
    "",
    "## How cost is accounted",
    "",
    "Two wallets, never blended into one unexplained total:",
    "",
    "- **Driver** — reported by the CLI itself. On a Max seat this is **modeled, not wallet-real**: the",
    "  seat is a flat subscription, so the figure is what those tokens would have cost on the metered",
    "  API. Every surface that shows it says so.",
    "- **Worker** — computed from the SDK's own token counts at the worker's Vertex region rates,",
    "  including the non-global surcharge where it applies, through this repo's single pricing",
    "  package. No rate is ever typed into the exporter. (Vertex scopes that surcharge to \"Gemini 3",
    "  and later families\", so a 3.5-flash worker carries it and a 2.5 worker does not.)",
    "",
    "A runtime that reports no token counts exports zeros with `driver_tokens_reported: false`, so a 0",
    "never reads as \"free\".",
    "",
    "## Integrity",
    "",
    "The task brief above is frozen input: its sha256 is recorded in every run's manifest, so a",
    "column can be checked against the spec it claims to have been given. Telemetry timestamps are",
    "reconstructed from per-attempt durations (the harness records how long each attempt took, not",
    "when it started), so ordering and durations are exact while absolute offsets are approximate;",
    "nothing downstream reads them as billing facts.",
    "",
    "## Where the numbers are",
    "",
    "Nothing on this tab is a result. Per-column totals, cost and stage timings are on **Runs",
    "Result**; the column-against-column view is on **Compare Runs**; the raw call-by-call audit,",
    "including every hand-off the driver made to the worker, is on **Engineering View**.",
    "",
  ].join("\n");
}

const briefMd = isPro
  ? benchmarkBrief({
      dataset: "pro",
      track: "harness",
      delegated: anySidecars,
      driver: prettyRuntime,
      sdk: WORKER_SDK_LABEL,
      title: studyLabel,
    })
  : anySidecars
  ? delegatedSdlcBrief()
  : [
  `# Project Brief — ${studyLabel}`,
  "",
  "## One-line summary",
  "Small, self-contained delivery tasks built end-to-end by a CLI coding agent under the",
  "harness-matrix runner, then build- and test-verified from the delivered tree.",
  "",
  "## What this study is",
  "",
  "This card is a **track**, not a single experiment. Every run column is one *cell* — one CLI",
  "runtime paired with one routing policy — evaluated on the batch of tasks that column covered.",
  "Batches are added over time, so the task set is a property of a column and never of the study.",
  "A column's totals are on **Runs Result**; the stage-by-stage detail is on **Engineering View**.",
  "",
  "## What one task run does",
  "",
  "A fixed stage walk, each stage a fresh agent session whose input is the previous stage's written",
  "output: the spec is turned into a plan, the plan into an implementation, and the implementation",
  "is then verified by actually installing, building and running it — not by asking a model whether",
  "it looks right.",
  "",
  "Retries are **flat**: a stage that fails its gate is retried on the same binding. There is no",
  "escalation ladder — no stage is quietly promoted to a more expensive model.",
  "",
  "## How the deliverable is authored",
  "",
  "Two shapes of cell, and every column states which one it is:",
  "",
  "- **Single-seat** — the CLI agent reads, reasons, edits and tests with its own tools. One model,",
  "  one wallet.",
  "- **Delegated** — the CLI agent *drives* but cannot write: its file-edit tools are disallowed and",
  "  a pre-tool hook blocks every tree-writing shell command, so every file in the deliverable is",
  "  authored by a second model reached through an SDK. The driver composes each task, reads back",
  "  the reply, diff and build output, and decides whether to accept or re-delegate.",
  "",
  "A delegated column shows its exact cable — which driver, which worker, which SDK, which region —",
  "in the strip above these tabs. That is a property of the run, so it is never asserted here.",
  "",
  "## How a delivery is verified",
  "",
  "Verification is executed, not judged: dependencies are installed, the project is built, and its",
  "tests are run against the delivered tree. A stage that cannot be built or cannot pass its own",
  "tests fails its gate, and the failure is recorded verbatim rather than summarised away.",
  "",
  "## How cost is accounted",
  "",
  "Two wallets, never blended into one unexplained total:",
  "",
  "- **Driver** — reported by the CLI itself. On a Max seat this is **modeled, not wallet-real**: the",
  "  seat is a flat subscription, so the figure is what those tokens would have cost on the metered",
  "  API. Every surface that shows it says so.",
  "- **Worker** — computed from the SDK's own token counts at the worker's Vertex region rates,",
  "  including the non-global surcharge, through this repo's single pricing package. No rate is",
  "  ever typed into the exporter.",
  "",
  "A runtime that reports no token counts exports zeros with `driver_tokens_reported: false`, so a 0",
  "never reads as \"free\".",
  "",
  "## Integrity",
  "",
  "Telemetry timestamps are reconstructed from per-attempt durations (the harness records how long",
  "each attempt took, not when it started), so ordering and durations are exact while absolute",
  "offsets are approximate; nothing downstream reads them as billing facts.",
  "",
].join("\n");

const briefExists = existsSync(briefPath);
const writeBrief = REWRITE_BRIEF || !briefExists;

// Resolved HERE, above the plan print, so a miss is visible in --dry-run too.
// Every run in a column shares one cell, so the first run's policy is the
// column's. See resolveHarnessPath for why a bare join(ROOT, …) was wrong.
const policyFile = resolveHarnessPath(first.m.policy?.file);

const plan = [
  ["telemetry.jsonl", `${events.length} event(s)`],
  ["manifest.json", `$${totalCost.toFixed(4)} total · ${Object.keys(model_breakdown).length} model(s)`],
  ...(instancesReport
    ? [["instances.json", `${runs.length} instance(s) · ${resolvedCount} resolved`]]
    : []),
  ["policy_snapshot.yaml", policyFile
    ? first.m.policy.file
    : `STUB — ${first.m.policy?.file ?? "no policy recorded"} not found`],
  ["../brief.md", writeBrief
    ? `${briefMd.split("\n").length} lines${briefExists ? " (rewritten)" : ""}`
    : "kept (exists — pass --rewrite-brief to regenerate)"],
];

console.log(`kind         : ${kind}${anySidecars ? " (DELEGATED)" : ""}`);
console.log(`cell         : ${cellLabel}`);
console.log(`batch        : ${runs.length} run(s) · sample ${sampleKey}`);
for (const r of runs) {
  const outcome = r.isPro
    ? (r.verdict ? (r.resolved ? "resolved" : "unresolved") : "ungraded")
    : (r.m.failed_at ? `failed at ${r.m.failed_at}` : "delivered");
  console.log(`  ${r.stamp.pretty}  ${String(r.subjectId).padEnd(44)} ${outcome.padEnd(11)} ` +
    `$${r.totalCost.toFixed(4)} (driver $${r.driverCost.toFixed(4)} + worker $${r.workerCost.toFixed(4)})`);
}
console.log(`study / pass : ${STUDY_ID} / ${PASS_ID}`);
console.log(`out          : ${passDir}`);
for (const [f, note] of plan) console.log(`  ${f.padEnd(22)} ${note}`);
console.log(`cost         : driver $${driverCost.toFixed(4)} + worker $${workerCost.toFixed(4)} = $${totalCost.toFixed(4)}`);
if (unpricedModels.size) {
  console.log(`WARNING      : no price table entry for ${[...unpricedModels].join(", ")} — ` +
    "those worker calls are counted at $0 and listed in manifest.harness.unpriced_models");
}
// A missing policy file is not fatal — the column's telemetry and manifest are
// still true — but it is never routine: the snapshot is the Implementation
// Approach tab's only policy exhibit, and the stub renders as an empty code
// block. It used to fail silently and shipped that empty block on every
// delegated SDLC column; say it out loud instead.
if (!policyFile) {
  console.log(`WARNING      : policy file "${first.m.policy?.file ?? "(none recorded)"}" not found ` +
    "under the harness or the repo root — writing a stub policy_snapshot.yaml, so the " +
    "Implementation Approach tab will show no policy for this column");
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

mkdirSync(passDir, { recursive: true });
writeFileSync(join(passDir, "telemetry.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(passDir, "manifest.json"), JSON.stringify(v1Manifest, null, 2));
if (instancesReport) {
  writeFileSync(join(passDir, "instances.json"), JSON.stringify(instancesReport, null, 2));
}
// The policy file is already YAML — copy it verbatim rather than round-trip
// it through a serializer, so the snapshot is byte-true to what ran.
if (policyFile) {
  writeFileSync(join(passDir, "policy_snapshot.yaml"), readFileSync(policyFile, "utf8"));
} else {
  writeFileSync(join(passDir, "policy_snapshot.yaml"),
    `# policy file not found at export time\nname: ${policyName}\n`);
}
if (writeBrief) writeFileSync(briefPath, briefMd);
writeFileSync(registryPath, JSON.stringify({ studies }, null, 2));

console.log(`\nwrote ${plan.length} file(s); registry now lists ${studies.length} study(ies).`);
console.log(`open: /studies/${STUDY_ID}/overview`);
