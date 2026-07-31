/**
 * END-OF-RUN REPORT — "what did that run actually cost, and what does it prove?"
 *
 * Usage:
 *   node tools/report.mjs <path-to-run-directory> [--markdown]
 *
 * A run already prints a closing scoreboard as it finishes, and replay-log.mjs
 * can re-render that scoreboard offline. This tool is the third thing, and it
 * exists because the scoreboard deliberately stops short in two places:
 *
 *  1. THE WORKER'S DOLLAR FIGURE. The live footer prints the worker's token
 *     counts and then says, in as many words, that the dollar figure is
 *     "intentionally omitted until the rate pin is verified against the
 *     published Vertex rate for this model" (logfmt.costRows). That is the
 *     right call mid-run — a harness should not invent a price while it is
 *     still running — and the manifest's own `cost_basis` names the successor:
 *     worker spend is "priced downstream via getVertexRates(model, ...)".
 *     THIS FILE IS THAT DOWNSTREAM. It prices the sidecars through the one
 *     pricing package, per model and per region, and states the rate table
 *     version it used so the number can be re-derived or disputed.
 *
 *  2. THE READING. A scoreboard reports; it does not interpret. A reader who
 *     has never seen this harness needs to be told which of the two dollar
 *     figures is a real invoice, that one run is n=1, and what to run next.
 *
 * WHY IT NEVER PARSES THE LOG. Same rule as replay-log.mjs: every number here
 * comes from `manifest.json`, `audit.json` and the worker's own usage sidecars
 * — the files the run wrote as it went. Nothing is scraped from printed text,
 * so a change to the log's wording cannot change a figure in this report.
 *
 * Contract: read-only and offline. It opens a run directory and prints. It
 * writes nothing, calls no model, and touches no network — so it is free, and
 * safe to run against a run that is still being written.
 *
 * Exit codes follow the harness convention: 0 report produced, 2 usage error
 * (no run directory given, or the path is not a run directory).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { PRICING_VERSION } from "../packages/pricing/dist/index.js";
import { priceSidecars } from "./harness-matrix/price-sidecar.mjs";
import { isDelegated } from "./harness-matrix/runtimes.mjs";
import {
  paint, rule, table, kvBlock, heavyBox, attemptTotals, cachePct,
  claudeEditsRow, fmtDur, fmtUsd, fmtInt, fitLine, sayErr,
} from "./harness-matrix/logfmt.mjs";

/** A value the manifest does not carry. Stated as absent, never guessed. */
const ABSENT = "(not recorded)";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// collect — every fact this report can state, read from the run's own files
// ---------------------------------------------------------------------------

/**
 * Read a run directory into a plain facts object.
 *
 * Split from rendering so the unit tests can assert on the FIGURES without
 * matching printed prose, and so both output modes are provably rendering the
 * same numbers rather than each computing its own.
 */
export function collectRun(runDir) {
  const dir = resolve(runDir);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no manifest.json in ${dir} — not a harness-matrix run directory`);
  }
  const manifest = readJson(manifestPath);

  // Kind detection matches replay-log.mjs exactly: the explicit field when the
  // run recorded one, else the presence of an instance id. Two tools disagreeing
  // about which kind a directory is would be a silent misread of every field
  // below, so the rule is copied verbatim rather than re-invented.
  const kind = manifest.kind ?? (manifest.instance_id ? "swepro" : "sdlc");
  const isPro = kind === "swepro";
  const records = (isPro ? manifest.phases : manifest.stages) ?? [];
  const stageKey = isPro ? "phase" : "stage";

  // audit.json is written at the end of a run; a killed run may not have one.
  const auditPath = join(dir, "audit.json");
  const audit = existsSync(auditPath)
    ? readJson(auditPath)
    : { editCount: 0, flags: [], missing: true };

  const attempts = records.flatMap((r) => r.attempts ?? []);
  const totals = attemptTotals(attempts);
  const delegated = records.some((r) => r.binding != null && isDelegated(r.binding));

  // Every worker receipt in the run, in stage order. These are the ONLY source
  // of worker cost: the driver never reports what the worker spent, because the
  // two run on different accounts entirely.
  const sidecars = attempts.flatMap((a) => a.worker_usage?.sidecars ?? []);
  const worker = priceSidecars(sidecars);

  const lockFlags = (audit.flags ?? [])
    .filter((f) => f.family === "driver-predelegation-inspection").length;

  return {
    dir,
    kind,
    isPro,
    stageKey,
    manifest,
    audit,
    records,
    totals,
    delegated,
    worker,
    lockFlags,
    otherFlags: (audit.flags ?? []).length - lockFlags,
    // The subject of the run: a task id for SDLC, an instance id for Pro.
    subject: isPro ? (manifest.instance_id ?? ABSENT) : (manifest.task_id ?? ABSENT),
    cell: `${manifest.runtime?.name ?? ABSENT} × ${manifest.policy?.name ?? ABSENT}`,
    driverUsd: manifest.totals?.cost_usd ?? null,
    failedAt: manifest.failed_at ?? null,
    artifacts: findArtifacts(dir),
  };
}

/**
 * The evidence on disk, as it is on disk.
 *
 * Presence is CHECKED, never assumed: a report that lists `model.diff` for a run
 * that failed before producing one sends a reader looking for a file that does
 * not exist, which is exactly the kind of small false claim that costs a
 * reviewer their trust in the large ones.
 */
export function findArtifacts(dir) {
  const outDir = join(dir, "out");
  const phasesDir = join(outDir, "phases");

  const named = [
    ["manifest.json", "every stage, attempt, binding and total this report reads"],
    ["audit.json", "who wrote the code — actor attribution and flags"],
    ["model.diff", "the change the run delivered, vs its base"],
    ["raw.diff", "the same diff before test/noise stripping"],
    ["out/requirements.md", "numbered, testable requirements the run derived"],
    ["out/design.md", "the shape it chose, and why"],
    ["out/packets.json", "the work packets it cut the design into"],
    ["out/review.md", "the review pass over the delivered change"],
    ["out/judge.json", "the judge's scored rubric"],
    ["out/instance.json", "the SWE-bench Pro instance this run was given"],
  ].filter(([rel]) => existsSync(join(dir, rel)));

  const countIn = (d, re) => {
    try { return readdirSync(d).filter((f) => re.test(f)).length; }
    catch { return 0; }
  };
  // Worker sidecars have moved between out/ and out/phases/ across versions of
  // the harness; count both so the pointer is right either way.
  const sidecarCount =
    countIn(outDir, /^worker-usage-.*\.json$/) + countIn(phasesDir, /^worker-usage-.*\.json$/);

  return {
    named,
    trajectories: countIn(phasesDir, /\.trajectory\.jsonl$/),
    sidecars: sidecarCount,
    workerTasks:
      countIn(outDir, /^worker-task-.*\.md$/) + countIn(phasesDir, /^worker-task-.*\.md$/),
    sizeBytes: dirSize(dir),
  };
}

/** Total bytes under a directory; best-effort, 0 if anything is unreadable. */
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += statSync(p).size; } catch { /* vanished mid-walk */ } }
    }
  };
  walk(dir);
  return total;
}

// ---------------------------------------------------------------------------
// the reading — derived statements, each one a function of the facts above
// ---------------------------------------------------------------------------

/** Bytes → "12.3 MB". Reports are read by humans, not by a byte counter. */
const fmtBytes = (b) => {
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB"];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${units[i]}`;
};

/**
 * The per-stage work ledger: what ran, whether its gate passed, and what each
 * stage cost on both sides of the cable.
 */
export function workRows(f) {
  return f.records.map((r) => {
    const t = attemptTotals(r.attempts ?? []);
    const att = (r.attempts ?? []).length;
    const del = r.binding != null && isDelegated(r.binding);
    return [
      r[f.stageKey] ?? ABSENT,
      r.executor ?? ABSENT,
      att ? String(att) : "—",
      r.executor === "report" ? "—" : (r.passed ? "PASS" : "FAIL"),
      t.wall ? fmtDur(t.wall) : "—",
      t.usd != null ? fmtUsd(t.usd) : "—",
      del ? String(t.delegations) : "—",
      del ? fmtInt(t.tokens.total) : "—",
    ];
  });
}

// The first column is named for the kind: a Pro run has phases, an SDLC run has
// stages, and calling either by the other's noun misreports the structure of the
// thing being reported on.
const WORK_HEADERS = [
  (f) => (f.isPro ? "phase" : "stage"),
  () => "executor", () => "att", () => "gate", () => "wall",
  () => "driver $", () => "dlg", () => "worker tok",
];

/**
 * The cost reading — the single most misread number in this project.
 *
 * TWO ECONOMIES, ONE RUN, AND ONLY ONE OF THEM IS AN INVOICE. The driver is
 * Claude Code on a Max seat: its dollar figure is the CLI's own model of what
 * the same tokens WOULD have cost on the metered API, and no invoice is ever
 * issued for it — the real constraint there is the seat's rolling usage window.
 * The worker is Gemini on Vertex, metered per token against a Google Cloud
 * project, and that one is real money.
 *
 * Adding them produces a number that is not the cost of anything. So they are
 * never summed here: they are reported as two lines with their bases named.
 */
export function costLines(f) {
  const lines = [];
  lines.push([
    "Claude driver",
    `${f.driverUsd != null ? fmtUsd(f.driverUsd) : ABSENT} — modeled by the CLI against metered ` +
    "API rates. On a Max seat NO INVOICE IS ISSUED for this; the real cost is seat usage.",
  ]);

  if (!f.delegated) {
    lines.push([
      "Gemini worker",
      "none — this run had no delegated stage, so nothing was metered on Vertex.",
    ]);
    lines.push(["real spend", "$0.0000 — an undelegated run bills nothing to a cloud project."]);
    return lines;
  }

  lines.push([
    "Gemini worker",
    `${fmtUsd(f.worker.usd)} — REAL METERED SPEND on Vertex, billed to a Google Cloud ` +
    `project. Priced from ${f.worker.byModel.reduce((n, m) => n + m.calls, 0)} worker ` +
    "receipt(s) at the rates below.",
  ]);
  lines.push([
    "real spend",
    `${fmtUsd(f.worker.usd)} — the worker figure alone. The two numbers above are NOT ` +
    "summed: only one of them is an invoice.",
  ]);
  if (f.worker.unpriced.length) {
    lines.push([
      "not priced",
      `${f.worker.unpriced.join(", ")} — no entry in the pricing package, so these ` +
      "receipts contribute 0 above. The dollar figure is therefore a FLOOR, not a total.",
    ]);
  }
  return lines;
}

/** Per-model worker rate rows — mixed-tier policies bill two rates in one run. */
export function workerRows(f) {
  return f.worker.byModel.map((m) => [
    m.model,
    m.region,
    String(m.calls),
    fmtInt(m.tokens.input_fresh),
    fmtInt(m.tokens.cache_read),
    fmtInt(m.tokens.output),
    m.priced ? fmtUsd(m.usd) : "unpriced",
  ]);
}

/**
 * What this run does and does not establish.
 *
 * Every line here is a limit of the EVIDENCE, not a hedge about the harness.
 * A reader who takes one run's cost as a rate, or one run's pass as a
 * capability, will be wrong in a way this repo can predict — so it is said
 * plainly rather than left to be discovered.
 */
export function caveats(f) {
  const out = [
    "n = 1. This is one run of one task on one cell. Agent runs vary a lot between " +
    "repeats — in wall time, in token count, and in whether a gate passes at all — so " +
    "treat every figure here as one sample, not as a rate.",
    "The driver dollar figure is modeled, not billed. See the cost section.",
  ];
  if (f.delegated) {
    const pct = cachePct(f.totals.tokens);
    if (pct != null && pct > 0) {
      out.push(
        `${pct}% of the worker's input tokens were cache reads, billed well below fresh ` +
        "input. A cost model that multiplies the input TOTAL by the input rate will " +
        "overstate this run several-fold; the priced figure above uses fresh input only.");
    }
    out.push(
      `Worker cost is priced from the worker's own receipts against pricing table ` +
      `${PRICING_VERSION}. Published rates change; re-derive before quoting this figure later.`);
  }
  if (f.audit.missing) {
    out.push(
      "No audit.json in this run directory — the attribution figures are absent rather " +
      "than zero. A run killed before its finish block writes no audit.");
  }
  if (f.failedAt) {
    out.push(
      `This run FAILED at ${f.failedAt}. Its cost figures are real, but its work figures ` +
      "describe an incomplete run and should not be compared against a completed one.");
  }
  return out;
}

/**
 * What to run next — derived from THIS run, not a fixed list.
 *
 * Each is a what/why/pitfall triple, because the pitfall is the part a reader
 * cannot get from the run directory and the part that costs money to rediscover.
 */
export function nextSteps(f) {
  const steps = [];
  const policyDir = "tools/harness-matrix/policies";

  if (f.failedAt) {
    steps.push({
      what: `Re-run the same cell and see whether it fails at ${f.failedAt} again.`,
      why: "One failure does not distinguish a broken cell from an unlucky sample; two " +
        "failures at the same stage do.",
      pitfall: "Change nothing between the two runs. A re-run with a tweaked prompt " +
        "answers a different question than the one you asked.",
    });
  }
  if (f.delegated) {
    steps.push({
      what: `Run the same task on the undelegated baseline (${policyDir}/all-opus.yaml).`,
      why: "The delegated cell's cost only means something against the cost of not " +
        "delegating. That baseline runs no SDK code at all, which is the point of it.",
      pitfall: "The baseline's dollar figure is driver-side and modeled, so it is NOT " +
        "comparable to the worker's metered figure. Compare seat usage to seat usage, " +
        "and tokens to tokens.",
    });
    steps.push({
      what: "Run the mixed-tier policy " +
        `(${policyDir}/gemini35-plus-25-flash-high.yaml) on the same task.`,
      why: "It puts the cheap tier on the stages that do not need the expensive one, " +
        "which is where most of the achievable saving in this harness lives.",
      pitfall: "Its two models bill at different rates and only the newer one carries the " +
        "non-global Vertex surcharge. Price per model — a blended rate is wrong for " +
        "that run no matter which rate you pick.",
    });
  } else {
    steps.push({
      what: `Run the same task delegated (${policyDir}/all-gemini-flash-high.yaml).`,
      why: "This run exercised no delegation, so it says nothing yet about the cable " +
        "this repo exists to measure. The delegated run is the comparison.",
      pitfall: "It needs Vertex credentials and it spends real money, unlike this one. " +
        "Run the wizard's sdlc profile first so the preflight catches a missing " +
        "credential at $0 instead of mid-run.",
    });
  }
  steps.push({
    what: "Repeat the winning cell two or three more times before quoting a number.",
    why: "Everything above is n=1. A median over three runs is the cheapest honest " +
      "statistic this harness can produce.",
    pitfall: "Run them sequentially. Concurrent runs share the Docker VM and the seat's " +
      "usage window, and contend for both in ways that distort exactly the wall-clock " +
      "and retry figures you are trying to measure.",
  });
  return steps;
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

/** Markdown table from the same headers/rows the text renderer is given. */
function mdTable(headers, rows, aligns = []) {
  const sep = headers.map((_, i) => (aligns[i] === "r" ? "---:" : ":---"));
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(sep), ...rows.map((r) => line(r.map(String)))].join("\n");
}

const WORK_ALIGNS = ["l", "l", "r", "l", "r", "r", "r", "r"];
const WORKER_HEADERS = ["model", "region", "calls", "fresh in", "cache read", "output", "cost"];
const WORKER_ALIGNS = ["l", "l", "r", "r", "r", "r", "r"];

/**
 * The report, as text or as Markdown.
 *
 * Both modes render the SAME facts object — the numbers cannot diverge between
 * a terminal read and a pasted write-up, which is the whole reason the collect
 * step is separate.
 */
export function renderReport(f, { markdown = false } = {}) {
  const workHeaders = WORK_HEADERS.map((h) => h(f));
  const out = [];

  if (markdown) {
    const h = (n, s) => out.push(`\n${"#".repeat(n)} ${s}\n`);
    const kv = (rows) => out.push(rows.map(([k, v]) => `- **${k}** — ${v}`).join("\n"));

    out.push(`# Run report — ${f.subject}`);
    out.push(`\n${f.failedAt
      ? `**RUN FAILED at ${String(f.failedAt).toUpperCase()}** — no delivery.`
      : "**RUN COMPLETE.**"} Cell \`${f.cell}\`.`);

    h(2, "The run");
    kv(identityRows(f));

    h(2, "Work");
    out.push(mdTable(workHeaders, workRows(f), WORK_ALIGNS));

    h(2, "Cost");
    kv(costLines(f));
    if (f.delegated && f.worker.byModel.length) {
      out.push("\n" + mdTable(WORKER_HEADERS, workerRows(f), WORKER_ALIGNS));
      out.push(`\nRates: pricing table \`${PRICING_VERSION}\`.`);
    }

    h(2, "How these numbers were produced");
    out.push(methodology(f).map((s) => `- ${s}`).join("\n"));

    h(2, "What this run establishes");
    out.push(caveats(f).map((s) => `- ${s}`).join("\n"));

    h(2, "Suggested next runs");
    for (const s of nextSteps(f)) {
      out.push(`- **${s.what}**\n  - *Why:* ${s.why}\n  - *Pitfall:* ${s.pitfall}`);
    }

    h(2, "Artifacts");
    out.push(artifactLines(f).map((s) => `- ${s}`).join("\n"));
    return out.join("\n") + "\n";
  }

  out.push("\n" + heavyBox([
    f.failedAt
      ? `RUN REPORT — FAILED at ${String(f.failedAt).toUpperCase()}, no delivery`
      : "RUN REPORT — run complete",
    `${f.subject} · ${f.cell}`,
  ], f.failedAt ? paint.red : paint.green));

  out.push("\n" + rule("THE RUN"));
  out.push(kvBlock(identityRows(f)));

  out.push("\n" + rule("WORK"));
  out.push(table(workHeaders, workRows(f), WORK_ALIGNS));

  out.push("\n" + rule("COST"));
  out.push(kvBlock(costLines(f)));
  if (f.delegated && f.worker.byModel.length) {
    out.push("");
    out.push(table(WORKER_HEADERS, workerRows(f), WORKER_ALIGNS));
    out.push(paint.dim(`  rates: pricing table ${PRICING_VERSION}`));
  }

  out.push("\n" + rule("HOW THESE NUMBERS WERE PRODUCED"));
  out.push(bullets(methodology(f)));

  out.push("\n" + rule("WHAT THIS RUN ESTABLISHES"));
  out.push(bullets(caveats(f)));

  out.push("\n" + rule("SUGGESTED NEXT RUNS"));
  for (const s of nextSteps(f)) {
    out.push(kvBlock([["what", s.what], ["why", s.why], ["pitfall", s.pitfall]]));
    out.push("");
  }

  out.push(rule("ARTIFACTS"));
  out.push(bullets(artifactLines(f)));
  out.push("");

  return out.map((l) => l.split("\n").map((x) => fitLine(x)).join("\n")).join("\n") + "\n";
}

/** Wrapped "• " bullets on the shared grid, via kvBlock's wrapping. */
function bullets(items) {
  return items.map((s) => kvBlock([["•", s]])).join("\n");
}

function identityRows(f) {
  const m = f.manifest;
  const rows = [
    [f.isPro ? "instance" : "task", f.subject],
    ["cell", f.cell],
    ["runtime", `${m.runtime?.name ?? ABSENT} ${m.runtime?.version ?? ""}`.trim()],
    ["composition", f.delegated
      ? "DELEGATED — a Claude Code driver handing implementation work to Gemini " +
        "through the Antigravity SDK"
      : "SOLO — one model did everything; no SDK code ran on this path"],
    ["started", m.started_at ?? ABSENT],
    ["wall clock", m.totals?.wall_seconds != null ? fmtDur(m.totals.wall_seconds) : ABSENT],
    ["model attempts", m.totals?.attempts != null ? String(m.totals.attempts) : ABSENT],
  ];
  if (f.isPro) {
    if (m.repo) rows.push(["repo", `${m.repo}${m.repo_language ? ` (${m.repo_language})` : ""}`]);
    if (m.sealed_image) rows.push(["container", m.sealed_image]);
    if (m.patch) {
      rows.push(["patch", `${m.patch.files_kept?.length ?? 0} file(s) kept · ` +
        `${m.patch.files_stripped?.length ?? 0} stripped before grading`]);
    }
  } else {
    if (m.env_image) rows.push(["container", m.env_image]);
    rows.push(["delivery", f.failedAt
      ? "none — run failed before delivery"
      : `${m.delivery?.files_changed?.length ?? 0} file(s) changed vs scaffold-base`]);
    if (m.judge_scores) {
      rows.push(["judge scores", `overall ${m.judge_scores.overall}/10 · ` +
        `requirements ${m.judge_scores.requirements_fidelity}/10 · ` +
        `code ${m.judge_scores.code_quality}/10 · tests ${m.judge_scores.test_quality}/10`]);
    }
  }
  if (f.delegated) {
    rows.push(["delegations", `${f.totals.delegations} hand-off(s) to Gemini` +
      (f.totals.toolCalls ? ` · ${f.totals.toolCalls} worker tool call(s) inside them` : "")]);
    // Same row, same rule, one implementation: claudeEditsRow judges edits by
    // DESTINATION (workdir/ vs the run's own out/ contract dir). The inline
    // wording this replaces keyed off raw editCount and accused any solo
    // stage's own contract writes of being "the driver wrote code itself" —
    // the exact P4a false alarm fixed in logfmt.mjs on 2026-07-31. The full
    // audit.json is on hand here, so pre-split runs (no treeEditCount) and
    // unauditable runtimes (auditable: false) get their honest wording too.
    const [ek, ev] = claudeEditsRow(f.audit);
    rows.push([ek === "Claude edits" ? "driver edits" : ek, ev]);
    rows.push(["lock held", `${f.lockFlags} time(s) — the delegate-first control refusing ` +
      "the driver direct repo access"]);
  }
  rows.push(["audit flags", f.audit.missing
    ? "no audit.json in this run directory"
    : (f.otherFlags
      ? `${f.otherFlags} beyond the lock engagements — see audit.json`
      : "0 beyond the lock engagements (clean)")]);
  rows.push(["run dir", f.dir]);
  return rows;
}

/** Where each figure came from — so a reader can check any of them. */
function methodology(f) {
  const lines = [
    "Every figure above is read from the files the run wrote as it went — " +
    "manifest.json, audit.json, and the worker's own usage sidecars. Nothing is " +
    "parsed out of printed log text, so re-wording a log line cannot move a number here.",
    "Wall clock and attempt counts are the manifest's own totals, recorded by the " +
    "harness at the moment each stage finished.",
    "The driver dollar figure is Claude Code's own per-session report, summed over " +
    `attempts. The run records its basis verbatim: ${f.manifest.totals?.cost_basis ?? ABSENT}`,
  ];
  if (f.delegated) {
    lines.push(
      "Worker tokens are the counts Vertex returned to the worker process, written to a " +
      "sidecar per hand-off. `prompt_token_count` INCLUDES cache reads, so fresh input is " +
      "prompt minus cached; thinking tokens bill at the output rate and are counted there.");
    lines.push(
      "Worker dollars are those token counts multiplied by this repo's single pricing " +
      `package (table ${PRICING_VERSION}), per model and in the region each sidecar says ` +
      "it ran in — the non-global Vertex surcharge is a property of the endpoint that " +
      "served the call, not of the policy that requested it.");
  }
  lines.push(
    "To see the run itself rather than this summary, replay it offline at $0: " +
    `node tools/harness-matrix/replay-log.mjs --run-dir ${f.dir}`);
  return lines;
}

function artifactLines(f) {
  const lines = f.artifacts.named.map(([rel, what]) => `${rel} — ${what}`);
  if (f.artifacts.trajectories) {
    lines.push(`out/phases/*.trajectory.jsonl — ${f.artifacts.trajectories} file(s): ` +
      "every tool call the driver made, in order");
  }
  if (f.artifacts.sidecars) {
    lines.push(`worker-usage-*.json — ${f.artifacts.sidecars} receipt(s): the token counts ` +
      "the cost section above is computed from");
  }
  if (f.artifacts.workerTasks) {
    lines.push(`worker-task-*.md — ${f.artifacts.workerTasks} file(s): exactly what the ` +
      "driver asked the worker to do, which is where to check it handed over a PROBLEM " +
      "and not a pre-written SOLUTION");
  }
  lines.push(`total evidence on disk: ${fmtBytes(f.artifacts.sizeBytes)}`);
  return lines;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const argv = process.argv.slice(2);
  const markdown = argv.includes("--markdown");
  const positional = argv.filter((a) => !a.startsWith("--"));

  if (positional.length !== 1) {
    sayErr("Usage: node tools/report.mjs <path-to-run-directory> [--markdown]");
    sayErr("");
    sayErr("  Prints what a finished run did, what it really cost, and what to run next.");
    sayErr("  Read-only, offline, $0 — safe to run on any run directory, any time.");
    sayErr("");
    sayErr("  Run directories live under tools/harness-matrix/runs/<task>/<cell>/<stamp>/.");
    sayErr("  `node tools/harness-matrix/replay-log.mjs` with no arguments lists them.");
    process.exit(2);
  }

  try {
    const facts = collectRun(positional[0]);
    process.stdout.write(renderReport(facts, { markdown }));
  } catch (err) {
    sayErr(`report failed: ${err.message}`);
    process.exit(2);
  }
}
