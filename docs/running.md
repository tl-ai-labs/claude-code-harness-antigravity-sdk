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
  model, thinking levels, retries, and cost caps. Four shipped; see
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
# Tiered — Opus for judgment, 2.5 Flash for volume (the tokenomics pass)
--policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml

# Anchor — Opus doing every stage itself, no delegation
--policy tools/harness-matrix/policies/all-opus.yaml
```

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
| `--policy <path>` | One of the four in `tools/harness-matrix/policies/` |
| `--dry-run` | Resolve the policy, print the full plan, exit `0`. No credentials, no Docker, no corpus. |
| `--skip-grade` | Run without grading |
| `--cleanup-images` | Remove Docker images afterwards (Pro only) |

`--instance-dir` and `--task-dir` are mutually exclusive; one is
required. Unknown flags are silently ignored, so check your spelling.

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
sha256sum examples/<your-task-id>/brief.md
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

## Choosing between the policies

See [policies.md](policies.md). Short version:

- **Prove the cable works, cheaply**: `all-gemini-flash-high` on
  `examples/kudos-wall`.
- **The Gemini Enterprise tokenomics story** (Opus for judgment,
  Gemini for volume): `gemini35-plus-25-flash-high` on
  `examples/kudos-wall`.
- **Baseline for comparison** (no delegation, Opus does it all):
  `all-opus` on any workload.
- **Generation comparison**: `all-gemini-25-flash-high` vs
  `all-gemini-flash-high` on the same workload.
