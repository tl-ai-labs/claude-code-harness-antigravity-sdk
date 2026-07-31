# Understanding a run's output

Every live invocation of `run-harness.mjs` writes into

```
tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/
```

Directory is gitignored — evidence is machine-local. What ships in the
clone instead are four exemplar passes, committed under
`examples/<workload>/passes/<pass-name>/`. Every one of them carries the
`evidence-bundle/delegation/` subset described below at its top level —
the hand-offs, the usage receipts, and `lint.json`. Two of them
(`kudos-wall/opus48-plus-lite` and `swe-bench-pro/nodebb`) additionally
ship the **full** `evidence-bundle/`, phase-io and trajectory included.
That is the part safe to publish.

## Full directory layout

```
tools/harness-matrix/runs/<task-or-instance>/claude-code--<policy>/<timestamp>/
├── manifest.json          the whole run: resolved policy, stages/phases, costs, timings, audit summary
├── model.diff             what the model changed, test files stripped (the graded patch)
├── raw.diff               the same diff BEFORE stripping — so the stripping is itself auditable
├── grade-verdict.json     resolved / not-resolved, plus the grader's identity
├── audit.json             every flag from every family
├── predictions.jsonl      Pro only — the one-line prediction record the evaluator consumes
├── grade/                 Pro only — the evaluator's own working dir and output
├── workdir/               the working tree (large; never published)
├── out/                   raw phase output, plus the container shim run-in-env.sh
└── evidence-bundle/
    ├── MANIFEST.sha256           a hash for every file in the bundle
    ├── integrity-notes.md        the generated integrity write-up, including the delegation section
    ├── phase-io/                 per-stage prompt and output
    ├── trajectory/               the driver's own turn-by-turn record
    ├── (copies of manifest.json, audit.json, model.diff, raw.diff, grade-verdict.json)
    └── delegation/
        ├── worker-task-<stage>-a<N>-<M>.md      the EXACT hand-off text
        ├── worker-usage-<stage>-a<N>-<M>.json   the SDK's own token receipt
        └── lint.json                            the delegation lint's verdict
```

`a<N>` is the attempt number (retries). `<M>` is the delegation index
within that attempt. So `worker-task-execute-a2-3.md` is the third
delegation of the second attempt at the `execute` stage.

## What each file tells you

### `manifest.json` — the run in one file

The resolved policy (name, source path, **sha256 of the file**, and the
resolved retry/limit block), the stage or phase table with per-stage
model binding and duration, the totals block (driver tokens, worker
tokens, dollar amounts), and the audit summary (flag counts by family).

The manifest is authoritative — every dollar amount in it is derived
from the token receipts (worker) or CLI usage log (driver) recorded at
the time.

### `worker-task-<stage>-a<N>-<M>.md` — a hand-off

The **exact text** the driver sent the worker. Not a summary, not a
redaction — the file. Absolute host paths have been rewritten to
`/harness` by `scrub-paths.mjs`; nothing else is filtered.

Read these to answer "what did the driver actually ask?" and to form
your own judgment about attribution (see
[methodology.md](methodology.md)).

### `worker-usage-<stage>-a<N>-<M>.json` — an SDK receipt

The Antigravity SDK's own `UsageMetadata` for that delegation:

```json
{
  "model": "gemini-3.5-flash-lite",
  "thinking": "HIGH",
  "sdk": "google-antigravity",
  "sdk_version": "0.1.9",
  "vertex_project": "…",
  "vertex_location": "global",
  "usage": {
    "prompt_token_count": 3116310,
    "cached_content_token_count": 2616871,
    "candidates_token_count": 11012,
    "thoughts_token_count": 19431,
    "total_token_count": 3146753
  },
  "tool_call_count": 35,
  "text": "…"
}
```

That is a real receipt, from
`examples/swe-bench-pro/passes/nodebb/`, with only the project id and
the worker's closing message elided. The counts inside `usage` are the
SDK's `UsageMetadata` verbatim; everything outside it is what the worker
recorded about the call it made. `cached_content_token_count` is a
subset of `prompt_token_count`, not an addition to it, and
`thoughts_token_count` is billed at the output rate — both matter when
re-deriving a dollar figure.

These are the token counts the Gemini spend was computed from. They
come from the SDK, not from us — a run's dollar total can be
re-derived from them plus the current Vertex price sheet.

`vertex_location` is the region the worker **resolved and called**, not
the ambient `GOOGLE_CLOUD_LOCATION`: a policy's worker leaf declares its
own region and the runner passes it as `--region`, which wins. That is
what makes this line evidence — a receipt that could not disagree with
the environment would prove nothing about where the tokens were billed.

The four committed exemplar passes show all three of the model pins in
play, which is the point of shipping more than one:

| Pass | Model(s) | `vertex_location` | `sdk_version` |
|---|---|---|---|
| `kudos-wall/reference` | `gemini-3.5-flash` ×5, `gemini-2.5-flash` ×7 | `asia-south1` | `0.1.7` |
| `kudos-wall/opus48-plus-lite` | `gemini-3.5-flash-lite` | `global` | `0.1.9` |
| `swe-bench-pro/navidrome` | `gemini-3.5-flash` ×5 | *(absent)* | *(absent)* |
| `swe-bench-pro/nodebb` | `gemini-3.5-flash-lite` | `global` | `0.1.9` |

The navidrome receipts predate the provenance fields and carry neither,
which is exactly why the pricing path has to decide what an absent field
means: it falls back to `asia-south1` for the region — the value those
runs did use — and to *unrecorded* for the project, because guessing a
project would put a billing claim in a dashboard. See the export note at
the end of this page. `gemini-3.5-flash-lite` is at `global` in both
rows that name it because Vertex serves that model on the global
endpoint only.

### `lint.json` — the delegation content lint's verdict

Per-file and aggregate. A `critical_note` field states which family
the pass structurally cannot raise. See
[methodology.md](methodology.md) for what the lint sees and does not.

### `grade-verdict.json` — the pass/fail

For SWE-bench Pro, the output of Scale AI's official evaluator run
locally with the network blocked. For SDLC, the output of the
scaffold's own `pnpm build && pnpm test` in the container.

Exit `0` from `run-harness.mjs` does not imply this file says
resolved. Check both.

### `audit.json` — every flag from every family

Trajectory families (git-history-mining, source-host-fetch,
delegation-policy-mismatch, driver-direct-edit, and the rest) plus the
delegation content lint's per-file output. A `critical: true` flag
voids the instance in the report.

### `evidence-bundle/` — the publishable subset

Not written by the run — built afterwards, by a separate command:

```bash
node tools/harness-matrix/bundle-run.mjs --run-dir <runDir>   # or --all
```

The bundler credential-scans every file it writes and refuses to write
the bundle at all on a hit. This is the subset safe to share
externally. If it is going outside the machine, sanitise it first —
recorded evidence carries this laptop's absolute paths:

```bash
node tools/harness-matrix/scrub-paths.mjs --src <bundle> --dest <out>
node tools/harness-matrix/scrub-paths.mjs --check <out>
```

## Not in the run directory

- **`policy_snapshot.yaml`** — the resolved policy is inside
  `manifest.json`, under `policy` (with its sha256). `policy_snapshot.yaml`
  is written by `export-dashboard.mjs` into a dashboard output tree,
  not by the run.
- **`brief.md`** — the brief file the run consumed is at its committed
  path under `examples/<workload>/brief.md`. Its sha256 is pinned in
  the run's `manifest.json` under `harness.brief_sha256`, so the brief
  the run saw is unambiguous.

## Re-reading the terminal log

The run's own log — opening header, per-stage narration, closing
scoreboard — is reproducible from `manifest.json` at `$0` with
`replay-log.mjs`. See
[running.md → Replaying the terminal log](running.md#replaying-the-terminal-log-at-0).

## Pricing the run

The scoreboard prints the worker's token counts and stops short of a
dollar figure, because the rate pin is verified downstream rather than
mid-run. `tools/report.mjs` is that downstream — it prices the worker's
usage sidecars per model and per region through the pricing package,
states the rate-table version it used, and adds the reading a scoreboard
cannot: which of the two dollar figures is a real invoice, that one run
is n = 1, and what to run next.

```bash
node tools/report.mjs tools/harness-matrix/runs/<task>/<cell>/<stamp>
```

Add `--markdown` to paste it into a doc. Like `replay-log.mjs` it takes
every number from `manifest.json`, `audit.json` and the usage sidecars —
never from the printed log — so re-wording the log cannot move a figure
here. Read-only, offline, and safe to run against a run still in flight.

## Exporting for a dashboard

`tools/harness-matrix/export-dashboard.mjs` reads a run's
`manifest.json` and emits a stable JSON contract for a dashboard
viewer:

```bash
node tools/harness-matrix/export-dashboard.mjs \
  --runs-root tools/harness-matrix/runs \
  --out ./dashboard-data
```

The viewer is a separate application not included here. The contract
is documented at the top of `export-dashboard.mjs`.

Worker spend in the export is priced from the SDK's own token counts
against the Vertex region each usage sidecar records — a non-global
endpoint carries a +10% surcharge, so pricing every run at one pinned
region would overcharge a `global` run by exactly that. The paying
Google Cloud project is read from the same sidecars, which is why an
export never names a project that did not pay for the run. Receipts
that predate those fields report the region as the `asia-south1`
default and the project as unrecorded, rather than guessing either.
