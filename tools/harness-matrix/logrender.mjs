/**
 * logrender.mjs — the run log's two BIG frames (opening header, closing
 * scoreboard) as pure functions of a plain descriptor.
 *
 * Why this module exists (2026-07-26). The demo log is the deliverable: these
 * two frames are what a viewer pauses on, screenshots and quotes. They used to
 * be literal `console.log(kvBlock([...]))` arrays inlined in kinds/sdlc.mjs and
 * kinds/swepro.mjs — which meant (a) the only way to look at them was to pay
 * for a live run, and (b) any offline rehearsal necessarily re-implemented
 * them, so the rehearsal and the real thing drifted apart the moment either
 * changed. A demo rehearsal that renders DIFFERENT text from the real run is
 * worse than no rehearsal, because it is trusted.
 *
 * So the frames moved here, behind a descriptor of plain values. Two callers
 * build that descriptor from two different sources and get byte-identical
 * output by construction:
 *
 *   live      kinds/sdlc.mjs · kinds/swepro.mjs — from the in-memory policy,
 *             template and stage records, mid-run.
 *   replay    replay-log.mjs — from manifest.json + audit.json of a FINISHED
 *             run, at $0, any number of times.
 *
 * The descriptor is deliberately dumb: strings, numbers and the stage records
 * the manifest already stores verbatim (`manifest.stages` IS `stageRecords`,
 * `manifest.phases` IS `phaseRecords` — see the manifest writers in both
 * kinds). Nothing here reaches for a file, a policy object or a clock. That is
 * what makes both frames unit-testable without a run, which is the only way
 * the wording can be reviewed before it is screenshared.
 *
 * Contract inherited from logfmt.mjs: presentation-only, parse-never, no
 * secrets, whole-line color.
 */

import {
  paint, heavyBox, kvBlock, table, attemptTotals, fmtDur, fmtUsd, fmtInt,
  watchingBlock, costRows, tokenLedgerRows,
} from "./logfmt.mjs";

/** A binding is the DELEGATED form when it is an object, not a model string. */
const isDelegated = (b) => typeof b === "object" && b !== null;

/**
 * The Vertex region(s) the delegated stages will actually call, for the cost
 * regime row.
 *
 * WHY THIS IS DERIVED AND NOT A CONSTANT (2026-07-31). That row used to end
 * `worker: Vertex asia-south1`, hardcoded — true of every policy that existed
 * when it was written, and false the moment `opus48-plus-lite` pinned its
 * Flash-Lite worker to `global` (Flash-Lite 404s in asia-south1; see that
 * policy's region section). The region is not decoration in this repo: Vertex
 * charges +10% on every token class outside `global`, `getVertexRates()` prices
 * from it, and the usage sidecars record it as evidence. A header that names
 * the wrong region contradicts the run's own receipts in the one row a viewer
 * reads to learn where the money went — and this log is shipped as a demo.
 *
 * Region is per WORKER LEAF, so a tiered policy may legitimately have more than
 * one; every distinct region is named rather than the first one asserted for
 * all. A delegated stage whose binding carries no region prints as `region
 * unrecorded`, which is honest about a pre-2026-07-31 manifest replayed today,
 * rather than defaulting to a plausible guess — the exact failure this replaces.
 */
function workerRegionText(stages = []) {
  const regions = [...new Set(stages.map((s) => s.workerRegion).filter(Boolean))].sort();
  return regions.length ? regions.join(" + ") : "(region unrecorded)";
}

/**
 * Who pays for what, and what the lock enforces. Sits directly under the
 * per-stage bindings in both kinds, above the image rows. Shared so a wording
 * fix lands on both demos at once — the whole point of the kinds split was
 * that a viewer comparing SWE-bench Pro to SDLC compares the RUNS, not two
 * logging styles.
 */
function moneyAndLockRows({ delegated, stages }) {
  return [
    ["cost regime", delegated
      ? `driver: Claude Code seat (Max OAuth; CLI-modeled $) · worker: ` +
        `Vertex ${workerRegionText(stages)} (ADC; real token counts, priced downstream)`
      : "Claude Code seat (Max OAuth; CLI-modeled $, not wallet-real)"],
    ...(delegated ? [["delegation", "driver has NO edit tools · PreToolUse guard locks the repo " +
      "until the first worker call · zero-delegation attempts FAIL the gate"]] : []),
  ];
}

/** The last two rows of either header — runtime build and wall-clock start. */
const provenanceRows = ({ runtime, startedAt }) => [
  ["runtime", runtime],
  ["started", startedAt],
];

/**
 * Per-stage binding rows, indented under the recipe/stage-walk line.
 *
 * A delegated stage has TWO thinking settings — the driver's Claude Code
 * `--effort` and the worker's Gemini thinking level — and the row used to print
 * one bare `· thinking high` next to a label that already said "(thinking
 * HIGH)". Two different numbers under one word, in the row a viewer reads to
 * learn how the cell is configured. Both are now named for what they are.
 *
 * DELEGATION IS THE DISCRIMINATOR, NOT THE THINKING VALUE (2026-07-26). This
 * row used to switch on `s.workerThinking` being truthy, which conflated two
 * unrelated facts: "is this stage delegated" and "does its worker think". The
 * moment a delegated binding legitimately omits `worker_thinking` — which the
 * gemini-2.5-flash tier now must, because Vertex hard-rejects thinking_level
 * on that model — the row silently reverted to the NON-delegated rendering
 * (`· thinking high`, no worker clause), so a delegated stage advertised
 * itself as an ordinary one and the worker's setting vanished from the header
 * a demo viewer reads to learn how the cell is wired. `s.worker` is the honest
 * discriminator (present ⟺ delegated binding), and an unset level prints as an
 * explicit `worker thinking NONE` — the same string gemini_worker.py records
 * in its usage sidecar for that call, so header and evidence agree verbatim.
 */
const stageBindingRows = (stages) =>
  stages.map((s) => [`  ${s.id}`,
    `${s.label} · ${s.worker ? "driver effort" : "thinking"} ${s.thinking ?? "n/a"}` +
    (s.worker ? ` · worker thinking ${s.workerThinking || "NONE"}` : "")]);

/**
 * The brief rows of the SDLC header — WHAT is being built, not which file
 * holds the request.
 *
 * This row used to read `brief  brief.md (sha256-pinned in the manifest)`,
 * which tells a watcher nothing: a filename and a promise about a hash. The
 * SDLC kind is the greenfield leg, so unlike a SWE-bench Pro run (whose
 * `repository navidrome/navidrome (go)` row is at least self-describing) the
 * brief IS the task — someone reading the log has no other way to learn what
 * the run was asked to produce, and every downstream number (judge scores,
 * files changed, "was the endpoint actually served") is meaningless without
 * it.
 *
 * The summary is the brief's OWN words — its H1 and its opening paragraph,
 * lifted verbatim by the caller — never a paraphrase. A generated gloss of
 * the input would be one more thing that can silently disagree with what the
 * models were actually sent.
 *
 * `known snag` surfaces task.json's `known_ambiguity` when the task records
 * one. That field exists because a task can carry a genuine internal conflict
 * (uptime-ping's requested route collides with a sha256-pinned chassis file
 * that the integrity gate forbids editing), and a viewer who meets the
 * consequence in the judge score without having met the cause reads a task
 * property as a harness defect. It is printed HERE, before the run, for the
 * same reason BLOCKED is explained before the first BLOCKED line appears.
 */
const briefRows = (d) => {
  const pinned = d.briefSha
    ? `${d.brief} · sha256 ${String(d.briefSha).slice(0, 12)}… (pinned in the manifest)`
    : `${d.brief} (sha256-pinned in the manifest)`;
  return [
    ["brief", d.briefTitle ? `${d.briefTitle} — ${d.briefLead}` : pinned],
    ...(d.briefTitle ? [["brief file", pinned]] : []),
    ...(d.knownAmbiguity ? [["known snag", d.knownAmbiguity]] : []),
  ];
};

/**
 * The orientation paragraph, printed once between the title box and the
 * configuration dump, and only for a delegated run. Identical treatment in
 * both kinds — see logfmt.watchingBlock for why it exists at all.
 */
const orientation = ({ delegated, driver, worker, stages }) => {
  if (!delegated) return null;
  // A TIERED column (premium worker on judgment stages, cost-efficient worker
  // on volume stages) has more than one worker, and naming only the first
  // stage's would state the wrong model for every stage that tiers away from
  // it — in the one paragraph a viewer reads to learn who is doing the work.
  // Collected from the stage rows, which are the same rows printed below, so
  // the sentence cannot disagree with the table under it.
  const workers = [...new Set((stages ?? [])
    .map((s) => s.binding?.worker ?? s.worker)
    .filter(Boolean))];
  const named = workers.length > 1
    ? `Gemini (${workers.join(" or ")} — per stage, see below)`
    : `Gemini (${workers[0] ?? worker})`;
  return watchingBlock({
    driver: `Claude Code (${driver})`,
    worker: named,
    cable: "the Antigravity SDK → Vertex AI",
  }) + "\n";
};

/** Join the pieces of a frame, dropping the ones a run doesn't have. */
const frame = (parts) => parts.filter((p) => p != null && p !== "").join("\n");

// ---------------------------------------------------------------------------
// SDLC
// ---------------------------------------------------------------------------

/**
 * SDLC opening frame: title box → orientation → configuration.
 *
 * d = {
 *   taskId, templateId, templateVersion, scaffoldId, scaffoldVersion,
 *   brief, briefTitle, briefLead, briefSha, knownAmbiguity,
 *   cell, stageWalk[], retryType, maxAttempts, repairRounds,
 *   executeId, timeoutMin, budgetUsd,
 *   stages: [{ id, label, thinking }], delegated, driver, worker,
 *   envImage, runtime, startedAt,
 * }
 */
export function sdlcHeader(d) {
  return frame([
    "\n" + heavyBox([
      "HARNESS-MATRIX RUN · KIND: SDLC",
      `${d.taskId} · template ${d.templateId} v${d.templateVersion} · ` +
        `scaffold ${d.scaffoldId} v${d.scaffoldVersion}`,
    ]),
    orientation(d),
    kvBlock([
      ...briefRows(d),
      ["cell", d.cell],
      ["stage walk", d.stageWalk.join(" → ")],
      ["retry", `${d.retryType}×${d.maxAttempts} per model stage · ` +
        `verify repair ≤${d.repairRounds} round(s) under the ${String(d.executeId).toUpperCase()} binding`],
      ["caps", `${d.timeoutMin} min + $${d.budgetUsd} per attempt`],
      ...stageBindingRows(d.stages),
      ...moneyAndLockRows(d),
      ["env image", d.envImage],
      ...provenanceRows(d),
    ]),
  ]);
}

/**
 * SDLC closing frame: verdict box → per-stage ledger → honest totals →
 * the boundary block.
 *
 * d = {
 *   taskId, cell, failedAt, records[], totals{wall_seconds,attempts},
 *   audit{editCount, flags[]}, delegated, deliveryCount, judgeScores,
 *   runDir, verifyMethod,
 * }
 */
export function sdlcFooter(d) {
  const runTotals = attemptTotals(d.records.flatMap((r) => r.attempts ?? []));
  const ledgerRows = d.records.map((r) => {
    const t = attemptTotals(r.attempts ?? []);
    const att = (r.attempts ?? []).length;
    // Delegation columns only mean something for stages that ran under a
    // delegated binding — everything else shows an em-dash, not a fake 0.
    const del = r.binding != null && isDelegated(r.binding);
    return [
      r.stage, r.executor,
      att ? String(att) : "—",
      r.executor === "report" ? "—" : (r.passed ? "PASS" : "FAIL"),
      t.wall ? fmtDur(t.wall) : "—",
      t.usd != null ? fmtUsd(t.usd) : "—",
      del ? String(t.delegations) : "—",
      del ? fmtInt(t.tokens.total) : "—",
    ];
  });
  // Audit flags, split by what they actually are. In a delegated run the
  // overwhelming majority are delegate-first lock engagements — i.e. the
  // control working — and printing them as one undifferentiated "17" reads as
  // seventeen problems to anyone who has not opened audit.json.
  const lockFlags = (d.audit.flags ?? [])
    .filter((f) => f.family === "driver-predelegation-inspection").length;
  const otherFlags = (d.audit.flags ?? []).length - lockFlags;

  return frame([
    "\n" + heavyBox([
      d.failedAt
        ? `RUN FAILED at ${String(d.failedAt).toUpperCase()} — no delivery`
        : "RUN COMPLETE — delivery verified, reviewed, judged; grading next",
      `${d.taskId} · ${d.cell}`,
    ], d.failedAt ? paint.red : paint.green),
    table(
      ["stage", "executor", "att", "gate", "wall", "driver $", "dlg", "worker tok"],
      ledgerRows,
      ["l", "l", "r", "l", "r", "r", "r", "r"],
    ),
    "\n" + kvBlock([
      ["wall clock", fmtDur(d.totals.wall_seconds)],
      ["model attempts", String(d.totals.attempts)],
      // Worker identity comes from the sidecars the worker itself wrote, not
      // from the policy that requested it — the log reports what executed.
      ...costRows(runTotals, {
        delegated: d.delegated,
        workerModel: runTotals.workerModel,
        region: runTotals.region,
      }),
      // The cost rows above carry the priceable figure; this block spells the
      // full split out, because a cache-heavy run's input total is the number a
      // reader will otherwise multiply by the input rate and get badly wrong.
      ...(d.delegated ? tokenLedgerRows(runTotals.tokens, { indentLabel: "  " }) : []),
      ...(d.delegated ? [["delegations", `${runTotals.delegations} hand-off(s) to Gemini` +
        (runTotals.toolCalls ? ` · ${runTotals.toolCalls} worker tool call(s) inside them` : "")]] : []),
      ...(d.delegated ? [["Claude edits", `${d.audit.editCount ?? 0} — ` +
        (d.audit.editCount ? "NON-ZERO: the harness wrote code, investigate audit.json"
          : "the harness wrote no code, as required")]] : []),
      ...(d.delegated ? [["lock held", `${lockFlags} time(s) — every one is the delegate-first ` +
        "control refusing the harness direct repo access"]] : []),
      ["delivery", d.failedAt ? "none — run failed before delivery"
        : `${d.deliveryCount} file(s) changed vs scaffold-base · tests included (nothing stripped)`],
      ...(d.judgeScores ? [["judge scores", `overall ${d.judgeScores.overall}/10 · ` +
        `requirements ${d.judgeScores.requirements_fidelity}/10 · ` +
        `code ${d.judgeScores.code_quality}/10 · ` +
        `tests ${d.judgeScores.test_quality}/10`]] : []),
      ["audit flags", otherFlags
        ? paint.yellow(`${otherFlags} beyond the lock engagements — see audit.json`)
        : "0 beyond the lock engagements (clean)"],
      ["run dir", d.runDir],
      ["evidence", "manifest.json · audit.json · model.diff · out contracts · out/phases/*.trajectory.jsonl"],
    ]),
    sdlcNotEstablished(d),
  ]);
}

/**
 * The boundary block for the SDLC kind.
 *
 * The single most dangerous line a harness can print is a confident verdict
 * that outruns its own gates. On 2026-07-26 the uptime-ping delegated run
 * reported a clean delivery for an endpoint that never served the required
 * response: the module registered a controller on a route the immutable
 * chassis already owned, so the shipped handler was shadowed and unreachable.
 * Build passed (legal TypeScript), unit tests passed (they instantiate the
 * controller class directly and never route an HTTP request), chassis
 * integrity passed (nothing was EDITED — it was shadowed), review approved and
 * the judge scored requirements fidelity 10/10.
 *
 * Every one of those gates did exactly its job. None of them can see a route
 * collision, because a build-and-test verify stage never starts the
 * application. Stating that boundary costs nothing and is the difference
 * between a credible study and one that gets audited by the reader. When a
 * verify method that exercises the running service exists, this block narrows
 * to whatever remains unchecked under it.
 */
export function sdlcNotEstablished(d) {
  if (d.failedAt || d.verifyMethod !== "build-and-test") return null;
  // One row per idea, wrapped by kvBlock — the hand-broken continuation rows
  // this replaces double-wrapped once kvBlock learned to wrap for itself.
  return "\n" + paint.bold("  NOT ESTABLISHED BY THIS RUN") + "\n" + kvBlock([
    ["runtime behaviour", "the verify stage builds the project and runs its unit tests; " +
      "it does not start the service or issue a request, so whether the delivered " +
      "endpoint actually serves the required response is UNVERIFIED here"],
    ["what is proven", "the code compiles, its own tests pass, and the immutable " +
      "chassis files are byte-identical"],
  ]);
}

// ---------------------------------------------------------------------------
// SWE-bench Pro
// ---------------------------------------------------------------------------

/**
 * SWE-bench Pro opening frame. Same three-part shape as the SDLC header so the
 * two demos read identically; the middle block names the instance instead of
 * the template, and the recipe line replaces the stage walk.
 *
 * d = {
 *   instanceId, repo, repoLanguage, cell, retryType, maxAttempts,
 *   timeoutMin, budgetUsd, stages: [{ id, label, thinking }],
 *   delegated, driver, worker, baseImage, sealedImage, runtime, startedAt,
 * }
 */
export function sweproHeader(d) {
  return frame([
    "\n" + heavyBox([
      "HARNESS-MATRIX RUN · KIND: SWE-BENCH PRO",
      `${d.instanceId}`,
    ]),
    orientation(d),
    kvBlock([
      ["repository", `${d.repo} (${d.repoLanguage ?? "unknown"})`],
      ["cell", d.cell],
      ["recipe", `REPRO → LOCALIZE → PATCH · retry ${d.retryType}×${d.maxAttempts} · ` +
        `caps ${d.timeoutMin} min + $${d.budgetUsd} per attempt`],
      ...stageBindingRows(d.stages),
      ...moneyAndLockRows(d),
      ["base image", d.baseImage],
      ["sealed image", d.sealedImage],
      ...provenanceRows(d),
    ]),
  ]);
}

/**
 * SWE-bench Pro closing frame.
 *
 * d = {
 *   instanceId, cell, failedAt, records[], totals{wall_seconds,attempts},
 *   audit{editCount, flags[]}, delegated, keptCount, strippedCount, runDir,
 * }
 */
export function sweproFooter(d) {
  const runTotals = attemptTotals(d.records.flatMap((p) => p.attempts ?? []));
  const ledgerRows = d.records.map((p) => {
    const t = attemptTotals(p.attempts ?? []);
    const del = isDelegated(p.binding);
    return [
      p.phase, String(t.attempts), p.passed ? "PASS" : "FAIL", fmtDur(t.wall),
      t.usd != null ? fmtUsd(t.usd) : "n/a",
      t.turns != null ? String(t.turns) : "n/a",
      del ? String(t.delegations) : "—",
      del ? fmtInt(t.tokens.total) : "—",
    ];
  });
  const lockFlags = (d.audit.flags ?? [])
    .filter((f) => f.family === "driver-predelegation-inspection").length;
  const otherFlags = (d.audit.flags ?? []).length - lockFlags;

  return frame([
    "\n" + heavyBox([
      d.failedAt
        ? `RUN FAILED at ${String(d.failedAt).toUpperCase()} — no patch submitted for grading`
        : "RUN COMPLETE — patch computed, handing over to Scale's evaluator",
      `${d.instanceId} · ${d.cell}`,
    ], d.failedAt ? paint.red : paint.green),
    table(
      ["phase", "att", "gate", "wall", "driver $", "turns", "dlg", "worker tok"],
      ledgerRows,
      ["l", "r", "l", "r", "r", "r", "r", "r"],
    ),
    "",
    kvBlock([
      ["wall clock", fmtDur(d.totals.wall_seconds)],
      ["model attempts", String(d.totals.attempts)],
      ...costRows(runTotals, {
        delegated: d.delegated,
        workerModel: runTotals.workerModel,
        region: runTotals.region,
      }),
      ...(d.delegated ? tokenLedgerRows(runTotals.tokens, { indentLabel: "  " }) : []),
      ...(d.delegated ? [["delegations", `${runTotals.delegations} hand-off(s) to Gemini` +
        (runTotals.toolCalls ? ` · ${runTotals.toolCalls} worker tool call(s) inside them` : "")]] : []),
      ...(d.delegated ? [["Claude edits", `${d.audit.editCount ?? 0} — ` +
        (d.audit.editCount ? "NON-ZERO: the harness wrote code, investigate audit.json"
          : "the harness wrote no code, as required")]] : []),
      ...(d.delegated ? [["lock held", `${lockFlags} time(s) — every one is the delegate-first ` +
        "control refusing the harness direct repo access"]] : []),
      ["patch", d.failedAt ? "none" : `${d.keptCount} file(s) kept` +
        (d.strippedCount ? ` · ${d.strippedCount} test/repro file(s) stripped (recorded)` : "")],
      ["audit flags", otherFlags
        ? paint.yellow(`${otherFlags} beyond the lock engagements — see audit.json`)
        : "0 beyond the lock engagements (clean)"],
      ["run dir", d.runDir],
      ["evidence", "manifest.json · audit.json · model.diff · predictions.jsonl · out/phases/*.trajectory.jsonl"],
    ]),
    sweproNotEstablished(d),
  ]);
}

/**
 * The boundary block for the Pro kind. This kind computes a patch; it does not
 * decide whether that patch is correct — Scale's own evaluator does, later,
 * against held-out tests this harness never sees. A reader who takes
 * "RUN COMPLETE" for "instance resolved" has drawn a conclusion the run cannot
 * support: the same class of error that made the SDLC kind report a clean
 * delivery for an endpoint that never served a request (see sdlcNotEstablished).
 */
export function sweproNotEstablished(d) {
  if (d.failedAt) return null;
  return "\n" + paint.bold("  NOT ESTABLISHED BY THIS RUN") + "\n" + kvBlock([
    ["resolution", "this harness produced a patch and stopped. Whether it resolves the " +
      "instance is decided by the SWE-bench Pro evaluator against held-out tests, " +
      "which are not present in this container and were never run here"],
    ["what is proven", "the phase gates passed and the patch applies to the instance tree"],
  ]);
}
