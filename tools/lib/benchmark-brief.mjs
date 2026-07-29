/**
 * benchmark-brief — the ONE brief template every benchmark study renders from.
 *
 * WHY THIS FILE EXISTS (Sriram, 2026-07-25)
 * -----------------------------------------
 * The brief is a LEVEL-1 surface: study card, brief, and Implementation
 * Approach describe the MACHINERY and nothing else. No model names, no
 * dollars, no dates, no counts, no instance ids. Every populated number lives
 * on Runs Result, Instances, or Engineering View.
 *
 * The console generators broke that rule badly. `run-swe-pro.mjs` wrote a
 * brief titled "SWE-bench Pro × 12 instance(s)" that then listed the seed, the
 * count, and all twelve instance ids inline — so the study's DESCRIPTION was
 * actually a run artifact. Re-run with a different sample and every word of it
 * goes stale, and a reader scrolling the first tab meets a wall of commit
 * hashes instead of an explanation. The harness exporter meanwhile carried its
 * own hand-written brief that DID follow the rule — so the same benchmark was
 * described twice, in two voices, maintained in two files.
 *
 * One template now, every combination: {Verified, Pro} × {console, harness} ×
 * {delegated, single-seat}. Everything it takes as input is FIXED IDENTITY —
 * which dataset, which cable, which cell shape — never anything a run
 * produces. There is no parameter through which a count, a date or a dollar
 * could reach the page. The sample a batch covered is recorded where it
 * belongs: `instances/selection.json` on disk, the Instances tab on screen.
 *
 * NOT covered here: the harness SDLC-task track. That is a different document
 * about a different subject (no dataset, no instances, no held-out tests), so
 * it keeps its own template in export-dashboard.mjs rather than being bent to
 * fit this one.
 */

/** Dataset identity — what the benchmark IS. Nothing here depends on a run. */
const DATASETS = {
  verified: {
    label: "SWE-bench Verified",
    what: [
      "SWE-bench Verified is the human-validated subset of SWE-bench: real GitHub issues from",
      "actively maintained Python repositories, each frozen at a base commit with a held-out",
      "test suite, filtered by human annotators so that every instance is genuinely solvable",
      "from the issue text alone.",
    ],
  },
  pro: {
    label: "SWE-bench Pro",
    what: [
      "SWE-bench Pro is Scale AI's harder successor to the original SWE-bench: real GitHub issues",
      "from actively maintained repositories, each frozen at a base commit with a held-out test",
      "suite. Unlike SWE-bench Verified (Python-only), Pro spans multiple languages.",
    ],
  },
};

/**
 * Track identity — which machine runs the benchmark.
 *
 * Each track is a set of small builders rather than a blob of text so the two
 * paths cannot drift apart section by section: they walk the SAME outline in
 * benchmarkBrief() below, and a track can only fill in its own paragraphs.
 */
const TRACKS = {
  console: {
    summary: (d) => [
      `Frozen ${d.label} instances, patched under the orchestrator's routing policies and graded`,
      "by the benchmark's own Docker test harness.",
    ],
    whatThisIs: () => [
      "This card is a **track**, not a single experiment. Every run column is the same",
      "orchestrator driving the same phases; what varies from column to column is the",
      "**routing policy** it ran under, the batch of instances that column covered, and the",
      "date. Batches are added over time, so the sample is a property of a column and never of",
      "the study.",
    ],
    phases: () => [
      "1. **Localize** — find the files that must change.",
      "2. **Patch** — author the fix as a unified diff.",
      "3. **Package** — assemble exactly one prediction per instance (pass@1).",
      "4. **Score** — hand the predictions to the benchmark's own grader.",
    ],
    retries: () => [
      "Retries are **policy-driven**: a phase that fails its gate is retried, and a policy may",
      "promote that retry to a more capable tier. Whether a column's policy escalates, and what",
      "the escalation cost, is reported per column on Runs Result — never assumed here.",
    ],
    authoring: () => [
      "The orchestrator runs the phases; a routing policy decides which model executes each one,",
      "keyed on phase, task type and retry count. The policy is the only thing that changes",
      "between columns, which is what makes two columns over the same sample comparable at all.",
      "Each column's exact policy snapshot — models, tiers and at-time prices — ships with the",
      "run and is linked from Runs Result.",
    ],
    cost: () => [
      "Every model call, token count and cost is recorded in the run's own telemetry, priced at",
      "the at-time rates in that run's policy snapshot through the console's single pricing",
      "package. No rate is ever typed into the exporter, and token counts carry a source label",
      "(billed by the API versus estimated locally) so an estimate is never read as a receipt.",
    ],
    integrity: () => [
      "The benchmark's sealed data — reference patch, held-out test lists, hints — is deep-scanned",
      "out of every agent-facing input before dispatch; finding a sealed field in an input is a",
      "hard error, not a warning. A corpus carrying sealed payloads is refused outright at load",
      "time. Exactly one prediction per instance is submitted (pass@1), enforced at packaging.",
    ],
  },

  harness: {
    // `o` carries the cable's fixed identity: { driver, sdk, delegated }.
    summary: (d, o) => (o.delegated ? [
      `Frozen ${d.label} instances, solved by a ${o.driver} driver that cannot`,
      "edit files — every line of every patch is authored by a worker model reached through",
      `Google's ${o.sdk} — and graded by the benchmark's own Docker test harness.`,
    ] : [
      `Frozen ${d.label} instances, solved end-to-end by a ${o.driver} CLI agent`,
      "under the harness-matrix runner and graded by the benchmark's own Docker test harness.",
    ]),
    whatThisIs: (o) => (o.delegated ? [
      // Fixed-cell ruling (Sriram, 2026-07-25): for the delegated track the
      // driver runtime and the SDK are the study's identity — only the batch,
      // the worker binding behind the SDK, and the date vary per column.
      "This card is a **track**, not a single experiment, and its cell is **fixed**: every run",
      `column is the same cable — a **${o.driver}** driver wired to the **${o.sdk}**.`,
      "What varies from column to column is the batch of instances it covered, the worker model",
      "the SDK carried on that day, and the date. Batches are added over time, so the sample is",
      "a property of a column and never of the study.",
    ] : [
      "This card is a **track**, not a single experiment. Every run column is one *cell* — one CLI",
      "runtime paired with one routing policy — evaluated on the batch of instances that column",
      "covered. Batches are added over time, so the sample is a property of a column and never of",
      "the study.",
    ]),
    phases: () => [
      "1. **Repro** — reproduce the reported failure inside the instance's own Docker image, and",
      "   prove it fails.",
      "2. **Localize** — find the files that must change.",
      "3. **Patch** — author the fix, then re-run the reproduction.",
    ],
    retries: () => [
      "Retries are **flat**: a phase that fails its gate is retried on the same binding. There is",
      "no escalation ladder — no phase is quietly promoted to a more expensive model, so a",
      "column's cost cannot be explained away by \"it escalated\".",
    ],
    authoring: (o) => (o.delegated ? [
      `The driver — the ${o.driver} CLI — *drives* but cannot write: its file-edit tools are`,
      "disallowed and a pre-tool hook blocks every tree-writing shell command, so it is",
      "structurally incapable of authoring a line of the patch. Every edit is authored by a",
      `worker model reached through the ${o.sdk}: the driver composes each task, the SDK carries`,
      "the hand-off, and the driver reads back the reply, diff and test output, then accepts or",
      "re-delegates.",
      "",
      "The driver runtime and the SDK are this study's fixed identity. **Which worker model** sits",
      "behind the SDK is a per-column choice — each column states its own binding in its label,",
      // NOT "the newest runs used" (Sriram, 2026-07-26). The strip never read
      // the newest run — it read the FIRST, which silently asserted one
      // column's worker for a whole card. It now pools every column and marks
      // a side that varies, so this sentence describes that instead.
      "and the strip above these tabs shows the cable itself — driver, worker, SDK version and",
      "region — pooled across every column, with a side marked *varies by column* when the",
      "columns bound different models there.",
    ] : [
      "The CLI agent is **single-seat**: it reads, reasons, edits and tests with its own tools.",
      "One model, one wallet. Which model that is, is a per-column fact — each column states its",
      "own binding in its label.",
    ]),
    cost: () => [
      "Two wallets, never blended into one unexplained total:",
      "",
      "- **Driver** — reported by the CLI itself. On a Max seat this is **modeled, not wallet-real**: the",
      "  seat is a flat subscription, so the figure is what those tokens would have cost on the metered",
      "  API. Every surface that shows it says so.",
      "- **Worker** — computed from the SDK's own token counts at the worker's Vertex region rates,",
      "  including the non-global surcharge, through the console's single pricing package. No rate is",
      "  ever typed into the exporter.",
      "",
      "A runtime that reports no token counts exports zeros with `driver_tokens_reported: false`, so a 0",
      "never reads as \"free\".",
    ],
    integrity: () => [
      "The benchmark's sealed data — reference patches, held-out test lists, hints — never enters a",
      "prompt or the study directory. Telemetry timestamps are reconstructed from per-attempt durations",
      "(the harness records how long each attempt took, not when it started), so ordering and durations",
      "are exact while absolute offsets are approximate; nothing downstream reads them as billing facts.",
    ],
  },
};

/**
 * Build the brief markdown.
 *
 * @param {object} o
 * @param {"verified"|"pro"} o.dataset  which benchmark — identity, not data
 * @param {"console"|"harness"} o.track which machine runs it — identity, not data
 * @param {boolean} [o.delegated]       harness only: driver+worker cable vs single-seat
 * @param {string}  [o.driver]          harness only: pretty driver runtime name
 * @param {string}  [o.sdk]             harness only: worker SDK label
 * @param {string}  [o.title]           H1 override; defaults to the track's own name
 * @returns {string} markdown, free of ids/counts/seeds/dates/dollars by construction
 */
export function benchmarkBrief({ dataset, track, delegated = false, driver, sdk, title }) {
  const d = DATASETS[dataset];
  const t = TRACKS[track];
  if (!d) throw new Error(`benchmarkBrief: unknown dataset '${dataset}' (expected verified|pro)`);
  if (!t) throw new Error(`benchmarkBrief: unknown track '${track}' (expected console|harness)`);
  if (track === "harness" && !driver) {
    throw new Error("benchmarkBrief: harness track needs { driver } — the CLI runtime is the card's identity");
  }
  if (track === "harness" && delegated && !sdk) {
    throw new Error("benchmarkBrief: a delegated harness cable needs { sdk } — it is half the cable's identity");
  }
  const o = { delegated, driver, sdk };

  const heading = title ?? (track === "harness" && delegated ? `${driver} × ${sdk} · ${d.label}` : d.label);

  // ONE outline, walked identically by both tracks. A track fills paragraphs;
  // it can never add, drop or reorder a section — that is what makes the two
  // paths the same document rather than two documents that resemble each other.
  return [
    `# Project Brief — ${heading}`,
    ``,
    // The one-line summary doubles as the Study Overview hero sub (StudyBriefV2
    // prefers it over the registry description), so it must tell the SAME story
    // as the card that was clicked to get here.
    `## One-line summary`,
    ...t.summary(d, o),
    ``,
    `## What this study is`,
    ``,
    ...t.whatThisIs(o),
    ``,
    `Which instances a column ran, what each one cost and how each one was graded is on the`,
    `**Instances** tab; a column's totals are on **Runs Result**.`,
    ``,
    `## What ${d.label} is`,
    ``,
    ...d.what,
    ``,
    `An instance is one issue. The agent gets the repository at the base commit plus the issue`,
    `description, and must produce a patch. It never sees the held-out tests or the reference`,
    `solution.`,
    ``,
    `Every run of an instance is an independent attempt. Two runs of the same instance share`,
    `nothing but the id, which exists so attempts can be lined up against each other — never so`,
    `one can stand in for another.`,
    ``,
    `## What one instance run does`,
    ``,
    `Each phase is a fresh agent session whose input is the previous phase's written output:`,
    ``,
    ...t.phases(o),
    ``,
    ...t.retries(o),
    ``,
    `## How patches are authored`,
    ``,
    ...t.authoring(o),
    ``,
    `## How verdicts are graded`,
    ``,
    `Grading is done by the benchmark's own Docker harness — no LLM judge anywhere. An instance`,
    `counts as **resolved** only when its fail-to-pass tests pass **and** the pass-to-pass suite`,
    `stays green. Verdicts are recorded verbatim; a partial fix counts as unresolved, and a`,
    `required test that never ran is reported as missing rather than as failed.`,
    ``,
    `## How cost is accounted`,
    ``,
    ...t.cost(o),
    ``,
    `## Integrity`,
    ``,
    ...t.integrity(o),
    ``,
    `## Where the numbers are`,
    ``,
    `Nothing on this tab is a result. Per-instance verdicts, attempt ladders, failing test names`,
    `and per-instance spend are on **Instances**; per-column totals, cost and resolve rate are on`,
    `**Runs Result**; the raw call-by-call audit is on **Engineering View**. Which instances a`,
    `batch covered, and the rule that selected them, are recorded in that run's own`,
    `\`selection.json\`.`,
    ``,
  ].join("\n");
}
