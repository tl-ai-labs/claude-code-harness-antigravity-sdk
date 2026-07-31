# Running the harness

One run is one **kind** × one **runtime** × one **policy** against one
input.

- **Kind** — what the work is. Two shipped: SDLC (build a small service
  from a brief) and SWE-bench Pro (fix a real bug in a real repo). The
  kind is chosen by which input flag you pass (`--task-dir` → SDLC,
  `--instance-dir` → SWE-bench Pro).
- **Runtime** — who does the work. One shipped: `claude-code` (the
  Claude Code CLI as driver, with its file-writing tools removed and
  Gemini as the worker reached through the Antigravity SDK).
- **Policy** — a YAML file that names the driver model, the worker
  model, thinking levels, retries, and cost caps. Five shipped — three
  current cells and two frozen historical columns; see
  [policies.md](policies.md).

## SDLC — start here

Cheapest live path. No corpus fetch, no evaluator clone, no second venv:

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

**Eight stages** run in order, from `templates/sdlc-mini/template.yaml`:

| # | Stage | Executor | Model-driven? |
|---|---|---|---|
| 1 | `requirements` | llm-task | **yes** |
| 2 | `design` | llm-task | **yes** |
| 3 | `plan-packets` | llm-task | **yes** |
| 4 | `execute` | llm-task (planned packets) | **yes** |
| 5 | `verify` | build + tests, up to 3 repair rounds | no (repairs bill under `execute`'s binding) |
| 6 | `review` | llm-task | **yes** |
| 7 | `judge` | judge | **yes** |
| 8 | `report` | manifest, diff, audit, grade | no |

Six model-driven stages are the ones a policy routes; each writes its
hand-off (`worker-task-<stage>-a<N>-<M>.md`) and its usage receipt
(`worker-usage-<stage>-a<N>-<M>.json`).

**Typical spend** — this workload, this policy, without a Docker cache
hit on the first run: ~$3–4, 20–30 minutes.

Swap the policy to switch the tokenomics story:

```bash
# The tokenomics pass — Opus 4.8 holds the judgment stages by itself,
# Flash-Lite does execute and the repair rounds. Tiered across the
# driver/worker line.
--policy tools/harness-matrix/policies/opus-4.8-plus-gemini-3.5-flash-lite.yaml

# The same cell, scoped to one workload. Identical models: block — same
# pins, same region, same thinking level — so these cost and route
# exactly as the combined file does; they simply name only their own
# workload's stages, and carry no fall-through `default:`. Point one at
# the wrong workload and it fails at load for $0 rather than quietly
# sending every unrecognised stage to Opus. Use whichever matches the
# run; the combined file above works for both.
--policy tools/harness-matrix/policies/opus-4.8-plus-gemini-3.5-flash-lite-sdlc.yaml           # with --task-dir
--policy tools/harness-matrix/policies/opus-4.8-plus-gemini-3.5-flash-lite-swe-bench-pro.yaml  # with --instance-dir

# Historical column — the same tiering cut with the WORKER as the
# variable: every stage delegates, 3.5 Flash on judgment, 2.5 Flash on
# volume. Frozen on its Opus 4.6 driver; see policies.md.
--policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml

# Anchor — Opus doing every stage itself, no delegation.
# Runs no Antigravity SDK code: cost baseline, not a connector check.
--policy tools/harness-matrix/policies/all-opus.yaml
```

`all-opus` is a `composition: solo` cell pinned to `runtime: claude-code`
— one Anthropic model doing every stage, with no worker leg. It runs
fine, and it needs neither the worker venv nor Vertex nor a Google Cloud
project. But because it never reaches the Antigravity SDK, a successful
`all-opus` run tells you nothing about whether the connector this
repository exists to demonstrate is working on your machine. Prove the
cable with `all-gemini-flash-high` first; use the anchor for the
comparison afterwards.

## SWE-bench Pro

See [swe-bench-pro.md](swe-bench-pro.md). Three phases (REPRO →
LOCALIZE → PATCH), graded by Scale AI's official evaluator in Docker
with the network blocked.

## Flags — the complete list

`run-harness.mjs` parses exactly these seven and nothing else:

| Flag | Effect |
|---|---|
| `--instance-dir <path>` | Selects the SWE-bench Pro kind |
| `--task-dir <path>` | Selects the SDLC kind |
| `--runtime claude-code` | The only runtime. Anything else fails preflight. |
| `--policy <path>` | One of the seven files in `tools/harness-matrix/policies/` — five cells, the tokenomics one present three times (combined, `-sdlc`, `-swe-bench-pro`) |
| `--dry-run` | Resolve the policy, print the full plan, exit `0`. No credentials, no Docker, no corpus. |
| `--skip-grade` | Run without grading |
| `--cleanup-images` | Remove Docker images afterwards (Pro only) |

`--instance-dir` and `--task-dir` are mutually exclusive; one is
required. Unknown flags are silently ignored, so check your spelling.

The directory each one names must hold that kind's descriptor —
`instance.json` for `--instance-dir`, `task.json` for `--task-dir`. If
it doesn't, the run exits `2` before anything is spent and the message
names the missing file. Worth knowing for `--instance-dir` in
particular: a Pro instance is a corpus entry under
`studies/swe-pro-corpus/<instance_id>/` written by the fetch script
(see [swe-bench-pro.md](swe-bench-pro.md)) — `examples/swe-bench-pro/`
is that workload's documentation and its committed exemplar pass, not
an instance you can point the harness at.

## Exit codes

| Exit | Meaning |
|---|---|
| **0** | The run completed. **This does not mean the model succeeded** — the verdict is in `grade-verdict.json`. |
| **1** | Infrastructure error (Docker, network, container). |
| **2** | Usage or preflight error. Nothing was spent. |

## Where the output lands

Every live invocation writes into

```
tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/
```

Directory is gitignored — this is machine-local evidence, never
committed. See [understanding-output.md](understanding-output.md) for
the layout of what's inside.

## Bringing your own SDLC workload

Copy `examples/kudos-wall/` to `examples/<your-task-id>/`, replace
`brief.md` with your own free-text brief (the section layout the
`sdlc-mini` template expects is in [brief-template.md](brief-template.md)),
then edit `task.json` — update `task_id` and re-pin `brief_sha256`:

```bash
sha256sum examples/<your-task-id>/brief.md      # Linux
shasum -a 256 examples/<your-task-id>/brief.md  # macOS — ships no sha256sum
```

Then point `--task-dir` at the new directory:

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/<your-task-id> \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml
```

The offline test suite walks `examples/*` looking for `task.json` — a
new workload gets automatic coverage from `tasks.test.mjs` the moment
its directory exists.

## Reading a run back

- `manifest.json` is the whole run: resolved policy, stage/phase table,
  costs, timings, audit summary.
- `evidence-bundle/delegation/` is the driver-to-worker channel:
  every hand-off and every Antigravity SDK usage receipt, verbatim.
- `grade-verdict.json` is the pass/fail from the grader.

Full walk in [understanding-output.md](understanding-output.md).

### Replaying the terminal log at $0

A finished run's log can be re-rendered from its own `manifest.json` —
the same opening header and closing scoreboard the live run printed,
with the run's own trajectories and `[+m:ss]` timings:

```bash
node tools/harness-matrix/replay-log.mjs --run-dir tools/harness-matrix/runs/<task>/<cell>/<stamp>
```

Add `--frames` for just the header and scoreboard, or `--stage <id>`
for one stage.

Read-only: no model, no network, no container, nothing written. Both
the live frames and the replay are rendered by the same pure functions
in `logrender.mjs` from the same descriptor shape, so a replay agrees
with the run it reproduces by construction rather than by someone
remembering to copy an edit across — `logrender.test.mjs` asserts that
against every run present on the machine. Use it to review demo copy,
or to re-read a run you have already paid for, without paying again.

### Pricing a run at $0

The scoreboard prints the worker's token counts and deliberately stops
short of a dollar figure — the rate pin is verified downstream, not
mid-run. `tools/report.mjs` is that downstream:

```bash
node tools/report.mjs tools/harness-matrix/runs/<task>/<cell>/<stamp>
```

It prices each usage sidecar against the model and region that sidecar
records, names the rate-table version it used, and states which of the
two dollar figures is a real invoice and which is a list-price estimate.
`--markdown` emits the same report for pasting into a doc. Offline and
read-only, like the replay above.

### After editing a scaffold — re-stamp its manifest

The SDLC verify stage hashes every chassis file against
`scaffolds/<id>/scaffold.manifest.json`. **Change anything in a scaffold
outside the slots — including a comment — and that manifest must be
re-stamped in the same commit**, or every subsequent run fails verify with
`content changed` and appears to blame the model:

```bash
node tools/harness-matrix/scaffold-manifest.mjs --write
```

The manifest is derived from the scaffold plus the slot list in
`scaffold.json`, so this is a regeneration, not an edit. `--check` (the
default) reports drift and exits 1, and `pnpm test` runs that same check —
forgetting costs a red test, not a paid run.

**`run-harness.mjs` runs that check itself, before anything is spent.** A
stale manifest exits `2` naming the file whose hash moved and the `--write`
remedy, for both kinds and for `--dry-run` too. That is deliberate belt and
braces: the test suite only catches this if someone runs it, and on
2026-07-31 nobody had between the commit that broke the manifest and the
run that paid for it. The gate is a sha256 comparison over files already on
disk — no credentials, no network, milliseconds — so there is no reason for
it to be optional.

## Choosing between the policies

See [policies.md](policies.md). Short version:

- **Prove the cable works, cheaply**: `all-gemini-flash-high` on
  `examples/kudos-wall`. Every stage delegates, so a green run exercises
  the SDK end to end.
- **The Gemini Enterprise tokenomics story** (Opus for judgment,
  Gemini for volume): `opus-4.8-plus-gemini-3.5-flash-lite` on `examples/kudos-wall`. Its
  premium tier is the driver seat, which is the shape a team would
  actually deploy. `gemini35-plus-25-flash-high` encodes the same split
  with both tiers as *workers* — the cleaner experiment, and historical:
  it stays on the Opus 4.6 driver its recorded passes ran with.
- **Baseline for comparison** (no delegation, Opus does it all, no
  Antigravity SDK on the path): `all-opus` on any workload.
- **Generation comparison**: `all-gemini-25-flash-high` vs the **July
  2026 recorded pass** of `all-gemini-flash-high` — not a fresh run of
  it. That policy now pins Flash-Lite on an Opus 4.8 driver, so a
  same-day pairing would vary generation, tier and driver at once.
