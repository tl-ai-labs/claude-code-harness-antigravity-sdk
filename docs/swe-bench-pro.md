# SWE-bench Pro

Scale AI's evaluation set of real bugs in real repositories. Each
instance is a sealed Docker image, a hidden test set, and an official
evaluator. Under this harness, Claude Code (driver) delegates
REPRO → LOCALIZE → PATCH to Gemini through the Antigravity SDK; the
patch is graded by Scale's official evaluator run locally with the
network blocked.

## Prereqs

Everything in [setup.md](setup.md)'s **SDLC live** profile, plus:

- **Scale's evaluator, cloned at the pinned SHA** (see below).
- **A dedicated Python venv** for the evaluator.
- **~30 GB of free disk** — every instance builds its own image on
  top of Scale's frozen base image.
- **Docker with several GB of RAM available.** Run one instance at a
  time on a machine with 8 GB or less.

## Build the corpus (not shipped)

`--instance-dir` names a directory that does not exist in a fresh
clone. Build it:

```bash
# by explicit instance id — note the `instance_` prefix, which is part of the
# dataset's own instance_id and is matched exactly; without it the fetcher
# exits 1 with "unknown instance ids"
node tools/swe/fetch-instances-pro.mjs \
  --ids instance_NodeBB__NodeBB-05f2236193f407cf8e2072757fbd6bb170bc13f0-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e

# or a language-stratified sample over the 731 public instances
node tools/swe/fetch-instances-pro.mjs --seed 20260716 --count 12
```

This writes
`studies/swe-pro-corpus/<instance_id>/{instance.json, sealed.json}`
plus a `selection.json`. It reads the public SWE-bench Pro split
through the HuggingFace datasets-server API — **no credential, no
local `datasets` install.**

The corpus is not committed because it is derived data with a
canonical upstream source, and because `sealed.json` holds the gold
patches — deriving them locally is cleaner than republishing them.

## Set up grading

Grading uses **Scale AI's own official evaluator**, not ours. Both
paths below are **hard-coded** in `tools/harness-matrix/grade.mjs`
(`HARNESS` and `PYTHON` at the top of the file). Put them anywhere
else and grading will not find them.

```bash
# from the repo root — the clone MUST land at this exact path
mkdir -p studies/swe-pro-corpus/.harness
git clone https://github.com/scaleapi/SWE-bench_Pro-os \
  studies/swe-pro-corpus/.harness/SWE-bench_Pro-os
git -C studies/swe-pro-corpus/.harness/SWE-bench_Pro-os checkout ca10a60a

# and the grading venv MUST be <repo root>/.venv-swe-pro
python3 -m venv .venv-swe-pro
.venv-swe-pro/bin/pip install pandas tqdm docker requests
```

The pin is `ca10a60a` (full SHA `ca10a60a5fcae51e6948ffe1485d4153d421e6c5`,
2026-05-18). It is pinned because a moving evaluator makes two runs
incomparable.

This venv is separate from the worker's Python venv (see
[setup.md](setup.md)) and separate from the repo's Node
dependencies. It exists only because Scale's evaluator is a Python
script. `grade.mjs` asserts it only when it is about to be used — an
empty model diff is recorded as unresolved without invoking Python at
all, so a clone with no grading venv can still complete that path.

## Run

```bash
node tools/harness-matrix/run-harness.mjs \
  --instance-dir studies/swe-pro-corpus/<instance_id> \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

Three phases:

1. **REPRO** — reproduce the failure inside the sealed container.
2. **LOCALIZE** — find the cause.
3. **PATCH** — fix it.

Then `grade.mjs` runs Scale's evaluator in Docker with the network
blocked, against the **original frozen Scale image** (not our sealed
build). A patch is graded in an environment the agent never touched,
so nothing the agent did to its own container can influence the
verdict. The graded diff has test files stripped (test-touching
counts as a flag, not a pass).

## Costs actually observed

One cell, six recorded runs. That is the whole of the cost evidence
this repository has for the Pro workload, and it is stated as a range
rather than a headline figure because six runs of one cell is not a
benchmark result:

| Cell | Runs | Cost per run | Wall clock | Attempts |
|---|---|---|---|---|
| SWE-bench Pro × `all-gemini-flash-high` | 6 | **$1.68 – $2.42** (mean $1.93) | 15 – 39 min | 3 – 4 |

Those six ran when `all-gemini-flash-high` still pinned
`gemini-3.5-flash` at `asia-south1`. The policy now pins
`gemini-3.5-flash-lite` at `global`, so re-running the cell today
prices differently in both directions — a cheaper model, and no +10%
non-global surcharge. Treat the range as a record of what was
observed, not as a forecast of what you will pay.

Grading is free in tokens (Scale's evaluator does not call a model)
but not free in time — on Apple silicon the Pro images are
`linux/amd64` under Rosetta, so budget minutes per instance rather
than seconds. An empty diff short-circuits the grader: the verdict is
recorded as unresolved without invoking Python at all.

## Reference exemplars

Two committed passes, one per model pin, both real:

- **`examples/swe-bench-pro/passes/navidrome/`** — the older pin,
  `gemini-3.5-flash` at `asia-south1`, five hand-offs across
  `repro` → `localize` → `patch` (two repro attempts). **Not resolved**
  on that attempt. Its receipts predate the `vertex_location` /
  `sdk_version` fields, so they carry neither.
- **`examples/swe-bench-pro/passes/nodebb/`** — the current pin,
  `gemini-3.5-flash-lite` at `global` on SDK `0.1.9`, one `patch`
  hand-off, and the only Pro pass that ships a **full**
  `evidence-bundle/` — phase-io, trajectory, and the grader's own
  output tree under `grade/`. Also **not resolved**, and
  `grade-verdict.json` says so in Scale's own words.

Between them they show what changed and what did not. See
[understanding-output.md](understanding-output.md) for what to read.

## Why the paths are hard-coded

`grade.mjs`'s `HARNESS` and `PYTHON` constants are compile-time paths
because the grader is invoked from inside a `run-harness.mjs` process
that has already committed to a run stamp and a working directory —
resolving the grader dynamically at grade time would let a misaligned
environment silently grade against the wrong evaluator version and
mint a resolved verdict from a wrong-tree run. Pinning both paths in
one file surfaces the mismatch as a clear filesystem error at grade
time, not a silent divergence.

If you want to move either the clone or the venv, edit those two
constants in `tools/harness-matrix/grade.mjs`.
