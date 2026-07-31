# Understanding a run's output

Every live invocation of `run-harness.mjs` writes into

```
tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/
```

Directory is gitignored — evidence is machine-local. The committed
`examples/<workload>/passes/reference/` directories carry the same
files as the `evidence-bundle/delegation/` subset described below —
that's the part safe to publish.

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
  "model": "gemini-3.5-flash",
  "sdk_version": "0.1.7",
  "vertex": { "project": "…", "location": "asia-south1" },
  "prompt_token_count": 4213,
  "candidates_token_count": 812,
  "total_token_count": 5025
}
```

These are the token counts the Gemini spend was computed from. They
come from the SDK, not from us — a run's dollar total can be
re-derived from them plus the current Vertex price sheet.

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
