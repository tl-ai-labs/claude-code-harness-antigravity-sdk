# claude-code-harness-antigravity-sdk

**Claude Code is the driver. A Gemini model, reached through Google's Antigravity
SDK, is the worker. The driver is not allowed to write code.**

Which Gemini is a policy field, not a property of the harness. The four shipped
policies cover **Gemini 3.5 Flash**, **Gemini 2.5 Flash**, a **mixed 3.5/2.5**
cell, and a **no-worker** control (§8.1). The headline runs used 3.5 Flash;
swapping the worker model is a `model_name:` edit in a YAML file (§8.2).

This repository is the harness that enforces that split, the two workloads it
was run against, the machinery that checks the split was not violated, and the
recorded evidence of every hand-off it has ever made. It is self-contained: one
npm dependency, one TypeScript compile, and a test suite that runs offline with
no credentials and no spend.

---

## TL;DR

**What is in here.** The harness (`run-harness.mjs`), the two workloads it was
run against, the enforcement that stops the driver writing code, and every
driver→worker hand-off from every run, verbatim.

**How to run it.** Nothing in this block costs money or needs a credential:

```bash
pnpm install && pnpm build && pnpm test
```

That is 290 tests, offline, in under ten seconds. To run a workload **live** you
need a Google Cloud project with Vertex AI enabled (§16) and a Claude Code login
(§17); SWE-bench Pro additionally needs Docker and ~30 GB of free disk (§19).
Setup is §17, one step at a time, and `--dry-run` prints the whole plan without
spending anything.

**What was already run.** Ten runs, all of them delegated, **$28.29 in total**:

| Workload | Runs | Resolved | Graded by |
|---|---|---|---|
| SWE-bench Pro | 6 | 3 | Scale AI's official evaluator, run locally with the network blocked |
| SDLC | 4 | 4 | the scaffold's own build + test, re-run in the container |

**What the evidence is.** 62 hand-off files and 62 Antigravity SDK token
receipts, committed to this repo. §21 is the map; §24 gives one command per
claim if you want to check a specific number rather than trust it.

**Read §9 before believing anything.** Ten runs is not a leaderboard, and this
repo does not claim Gemini did the thinking. §9 states exactly what the evidence
proves and what it cannot.

---

## Read this first

You do not need to read this whole file to use the repo. Pick a lane:

| You have | Do this | Section |
|---|---|---|
| 2 minutes | Read §1 and §2 | §1, §2 |
| 15 minutes, no credentials, no spend | Clone, `pnpm install && pnpm build && pnpm test`, then read the evidence under `tools/harness-matrix/runs/` | §5, §21 |
| An afternoon and a Google Cloud project | Set up the worker and run the SDLC workload live | §16 – §18 |
| A day, Docker and ~30 GB of disk | Run SWE-bench Pro end to end and grade it with Scale AI's official evaluator | §19 |
| Doubt about a specific claim | §24 gives one command per claim | §24 |

**Nothing in this repo phones home, and nothing in it costs money to read.**
Every number quoted below is either reproducible offline from committed files or
labelled as coming from a paid run whose raw evidence is committed.

---

# PART 0 — WHAT THIS IS

## 1. The question this repository answers

Google asked whether Claude Code can act as a *harness* — the outer agent that
plans, decides and verifies — while Gemini, reached through the Antigravity SDK,
does the actual engineering work.

That question is easy to answer badly. Any two models can be wired together in a
way that *looks* like delegation while the strong model quietly does the work and
the weak model transcribes it. The interesting engineering is not the wiring; it
is making the delegation **verifiable by someone who does not trust you**.

This repository is that. It contains:

1. **The harness** — a runner that executes one workload under one model policy,
   with the driver's file-writing ability removed at the process level.
2. **Two workloads** — SWE-bench Pro (fix a real bug in a real repository, graded
   by Scale AI's official evaluator) and an SDLC walk (take a feature from
   requirements through design, planning, implementation, review and judging).
3. **The enforcement** — tool removal, a pre-execution guard hook, and a post-run
   audit that share the same predicate so they cannot disagree.
4. **The evidence** — every driver→worker hand-off from every run, verbatim, plus
   the Antigravity SDK's own token receipts.
5. **The honest accounting** — what that evidence proves, and what it does not.

### What this is NOT

- It is **not a benchmark leaderboard.** Ten runs is not a score.
- It is **not a claim that Gemini did the thinking.** See §9 — that claim is not
  enforceable, and it is not made.
- It is **not the full monorepo.** It is a slice extracted for publication. §27
  lists every difference.
- It is **not a product.** It is a research harness with sharp edges, and the
  sharp edges are documented rather than sanded off.

---

## 2. How it works

```
                    ┌──────────────────────────────────────────────┐
                    │  DRIVER — Claude Code (the claude CLI)       │
  one PHASE  ────▶  │  reads the repo, decides what must change    │
                    │  CANNOT edit files: Edit / Write /           │
                    │  NotebookEdit / MultiEdit are removed, and   │
                    │  a PreToolUse hook denies any Bash command   │
                    │  that writes into the working tree           │
                    └───────────────────┬──────────────────────────┘
                                        │  a free-text task file
                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │  WORKER — gemini_worker.py                   │
                    │  google-antigravity SDK  →  Vertex AI        │
                    │  edits the working tree; every delivered     │
                    │  byte is written by this process             │
                    └───────────────────┬──────────────────────────┘
                                        │
                         worker-task-*.md   +   worker-usage-*.json
                         (the exact prompt)     (the SDK's own receipt)
```

Read that diagram as three separate facts:

1. **The driver has no hands.** Not "was told not to edit" — the tools are absent
   from its process, and the one remaining way to write a file (a shell command)
   is intercepted before it runs. §10 and §11.
2. **The channel between them is free text.** That is a deliberate design choice —
   it is the only channel the Antigravity SDK offers — and it is also the weak
   point, because free text can carry a finished function. §13.
3. **Everything crossing that channel is written to disk and committed here.**
   The hand-off text and the SDK's own usage receipt, per delegation, per
   attempt. Nothing is summarised; the files are verbatim.

---

## 3. The two workloads

| | **SWE-bench Pro** | **SDLC** |
|---|---|---|
| Question | Can it fix a real bug in a large unfamiliar repository? | Can it carry a feature from a blank page to reviewed code? |
| Input flag | `--instance-dir studies/swe-pro-corpus/<id>` | `--task-dir tools/harness-matrix/tasks/<task>` |
| Phases | REPRO → LOCALIZE → PATCH | requirements → design → plan-packets → execute → verify → review → judge → report (8 template stages; 6 are model-driven) |
| Graded by | Scale AI's official `swe_bench_pro_eval.py`, in Docker, network blocked | `grade-sdlc.mjs` — the task's own acceptance gates |
| Setup cost | Docker + corpus fetch + evaluator clone + a second Python venv | Docker + the worker venv |
| Ships here | Runner + prompts + fetcher; **the corpus is not shipped**, you fetch it (§19.1) | Runner + prompts + **two complete tasks** |
| Code in | `tools/harness-matrix/kinds/swepro.mjs` | `tools/harness-matrix/kinds/sdlc.mjs` |

Both kinds run on the same engine, under the same policies, through the same
delegation cable, and produce the same evidence shape. The kind is chosen by
which input flag you pass — there is no `--kind` argument.

---

## 4. What you can do here, and what each level costs

| Level | What you get | Needs | Cost |
|---|---|---|---|
| **A. Verify** | Build the tree, run ~300 tests, read every hand-off and every SDK receipt from 10 real runs, re-run the delegation lint over the committed corpus | Node 22, pnpm | **$0** |
| **B. Run SDLC live** | A full delegated SDLC walk on your machine, your own evidence bundle | A + a Google Cloud project with Vertex AI + a Claude Code seat | Gemini tokens + Claude Code tokens |
| **C. Run SWE-bench Pro live** | A graded bug-fix run against Scale AI's official evaluator | B + ~30 GB disk + the corpus fetch + the evaluator clone | As B, plus several minutes of local Docker per instance ($0 in tokens) |

**Start at A.** It needs no credential and proves most of what this repo claims.

---

## 5. Quickstart — Level A, $0, no credentials

```bash
git clone https://github.com/tl-ai-labs/claude-code-harness-antigravity-sdk
cd claude-code-harness-antigravity-sdk
pnpm install
pnpm build          # one tsc pass over packages/pricing and packages/swe-bench
pnpm test           # 301 tests, offline, no network, no credentials
```

Expected on a fresh clone: **`# pass 293 · # fail 0 · # skipped 8`**, in about
7 seconds. The 8 skips are not failures and not a broken clone — they are tests
that need inputs a fresh clone does not have, and each one prints its own reason:
six need a SWE-bench Pro corpus instance (`no corpus instance at …`, see §19.1),
two need a specific unpublished run directory (`no runs/ on this machine`,
`no finished run at runs/uptime-ping/…`). Fetch a corpus instance and six of them
start running.

Requires **Node 22** and **pnpm**. Node 24+ has broken native module builds for
this dependency set; if `pnpm install` fails on a native module, that is why.

Then read, in this order:

```bash
# 1. One real driver→worker hand-off, verbatim — the actual prompt the driver
#    sent, nothing summarised:
cat tools/harness-matrix/runs/kudos-wall/claude-code--all-gemini-flash-high/*/evidence-bundle/delegation/worker-task-execute-a1-1.md

# 2. The Antigravity SDK's own token receipt for that same delegation:
cat tools/harness-matrix/runs/kudos-wall/claude-code--all-gemini-flash-high/*/evidence-bundle/delegation/worker-usage-execute-a1-1.json

# 3. The delegation lint's verdict on that whole run:
cat tools/harness-matrix/runs/kudos-wall/claude-code--all-gemini-flash-high/*/evidence-bundle/delegation/lint.json

# 4. The 50-hand-off labelled corpus every lint threshold was measured on:
cat tools/harness-matrix/fixtures/delegation-corpus/README.md
```

If you only do one thing: **read three hand-offs and decide for yourself whether
the driver was delegating or dictating.** That judgement is the subject of §9 and
§13, and this repo ships the raw material so you can make it independently.

---

# PART I — THE CODE

## 6. Complete repo map

Every file that ships, and what it is for. Nothing in this tree is dead.

### Root

| Path | What it is |
|---|---|
| `package.json` | Generated for this repo. Scripts: `build`, `test`, `run-harness`, `dry-run`, `fetch-instances`. Declares no dependencies itself — the whole tree's one real third-party package is `yaml`, declared by `packages/policy`. |
| `pnpm-workspace.yaml` | Declares `packages/*`. Generated. |
| `tsconfig.base.json` | Compiler settings the two TypeScript packages extend. |

### `packages/` — the two libraries the harness imports

| Path | What it is |
|---|---|
| `packages/policy/core/policy-core.mjs` | **The policy engine.** Parses and resolves both the console's policy files and the harness's, in one implementation. Handles the v2 schema (compositions + rules) and the legacy schema (a `phases` map) so every previously frozen `policy_snapshot.yaml` still loads. §8. |
| `packages/policy/core/policy-core.d.mts` | Types for the above. |
| `packages/pricing/src/index.ts` | Model price table and cost arithmetic — turns token counts into dollars. |
| `packages/swe-bench/src/types.ts` | The SWE-bench Pro instance shape. |
| `packages/swe-bench/src/integrity.ts` | **The seal.** `assertAgentSafe` refuses to hand a model any object carrying solution fields; `validateInstance` enforces the split between the agent-safe instance and the sealed answer; `loadInstances` reads a corpus directory through both. §15. |

`packages/adapters` is **deliberately not shipped**, even though
`packages/swe-bench`'s source declares it as a dependency. The only three files
that touch it — `localize.ts`, `pro.ts`, `patch.ts` — reference it through
`import type` alone (a construct TypeScript erases entirely at compile time), the
harness does not import those three files, and this repo's narrowed
`packages/swe-bench/tsconfig.json` compiles only `types.ts` and `integrity.ts`.
So nothing here needs it at build time or at run time. Grep the tree for
`adapters` and you will find no hit outside this sentence. §27.

### `tools/harness-matrix/` — the harness itself

**Engine**

| Path | What it is |
|---|---|
| `run-harness.mjs` | **The entry point.** One invocation = one workload × one runtime × one policy. Parses flags, validates the runtime, loads and resolves the policy, runs preflight, dispatches to a kind, writes the run directory. Exit codes in §19.4. |
| `kinds/swepro.mjs` | The SWE-bench Pro kind: REPRO → LOCALIZE → PATCH, container lifecycle, patch extraction. |
| `kinds/sdlc.mjs` | The SDLC kind: drives the execution template's stages end to end. |
| `kinds/lib.mjs` | Everything both kinds share: what a run is allowed to have touched, what its patch contains, what it cost, how a delegated cell is described. A bug here is a bug in every cell of the matrix at once, which is why its tests run against real throwaway git repositories rather than a stubbed `git`. |
| `runtimes.mjs` | **The runtime adapter.** Builds the `claude` CLI invocation: model pin, `--effort`, budget, **`--disallowedTools`**, the generated Skill that delegates to the worker, and the **PreToolUse guard hook**. §10, §11. |
| `gemini_worker.py` | **The worker.** Takes a task file, calls Gemini through `google-antigravity` against Vertex AI, edits the working tree, writes a usage receipt. §16.2. |

**Integrity**

| Path | What it is |
|---|---|
| `audit.mjs` | **The audit.** Ten flag families over the trajectory and the hand-off text; `bashEditsTree` (the predicate the guard hook also uses); `lintDelegationText`; `DICTATION_MIN_LINES`. §12, §13. |
| `bundle-run.mjs` | Builds `evidence-bundle/` from a finished run, credential-scanning every file it writes. §20. |
| `scrub-paths.mjs` | Rewrites absolute host paths to `/harness` in published evidence, so nobody's home directory ships. |
| `fixtures/delegation-corpus/` | **50 real hand-offs, hand-labelled**, plus `labels.json`. The regression test behind every threshold in the lint. §14. |

**Grading**

| Path | What it is |
|---|---|
| `grade.mjs` | SWE-bench Pro grading: drives Scale AI's official evaluator in Docker with the network blocked, against the **original frozen Scale image** — never our sealed execution image. §19.2. |
| `grade-sdlc.mjs` | SDLC grading: runs the task's own acceptance gates. |

**Output and presentation**

| Path | What it is |
|---|---|
| `export-dashboard.mjs` | Renders run directories into the static JSON contract a presentation dashboard consumes. §22. |
| `logfmt.mjs`, `logrender.mjs`, `replay-log.mjs` | Structured run logging, and replaying a recorded log back to a terminal. |
| `agy-trajectory.mjs` | Parses trajectories from the (now parked) Antigravity CLI. Kept because recorded runs from that era still replay. |

**Configuration**

| Path | What it is |
|---|---|
| `policies/*.yaml` | The four matrix policies. §8. |
| `prompts/*.md` | The phase prompts: `repro`, `localize`, `patch` for Pro; **six** `sdlc-*.md` for SDLC — one per model-driven stage (`requirements`, `design`, `plan-packets`, `execute`, `review`, `judge`). **These are the actual instructions the driver receives** — read them to know exactly what the models were asked to do. |
| `tasks/kudos-wall/`, `tasks/uptime-ping/` | Two complete SDLC tasks: brief, acceptance gates, everything needed to run. |
| `Dockerfile` | The **SWE-bench Pro** execution image: built per instance on top of the frozen Scale base image, plus the git seal. No agent layer — the runtime lives on the host and this container only executes repo commands. |
| `Dockerfile.sdlc` | The **SDLC** execution image: one shared `node:22-bookworm` toolchain image, built once and cached, that every SDLC command runs inside. It carries the toolchain only, never task state — the scaffold enters the run as a host-side copy. |
| `sdk-probe/` | Standalone probes that answer "does the SDK do X?" without running the harness: `probe_vertex.py` (one live Gemini call), `probe_offline.py` (no network), `probe_managed_agent.py`, `probe_openai_shape.py`, and an Anthropic proxy experiment. `sdk-probe/README.md` records what each one proved. |

**Tests** — a `*.test.mjs` beside each module. All offline. `pnpm test` runs them.

**Documentation**

| Path | What it is |
|---|---|
| `DESIGN.md` | The full design record: every decision, every recorded defect, every constraint. The deepest document here. |
| `README.md` (inside `tools/harness-matrix/`) | A per-file reference table for the harness directory. |
| `IMPLEMENTATION-…-SWE-BENCH-PRO.md` | Code walkthrough of the Pro leg. |
| `IMPLEMENTATION-…-SDLC.md` | Code walkthrough of the SDLC leg. |
| `SDLC-RECIPE.md` | Step-by-step for the SDLC workload. |
| `GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md` | **STUB — 16 lines, no content.** Internal working memo, not published. The file exists only so the links to it from `DESIGN.md` and `README.md` still resolve. §27. |
| `GOOGLE-CALL-COVERAGE.md` | **STUB**, same reason. |
| `MANAGED-AGENTS.md` | **STUB**, same reason. |

### `tools/` — shared utilities

| Path | What it is |
|---|---|
| `tools/swe/fetch-instances-pro.mjs` | **Builds the SWE-bench Pro corpus.** Reads the public split through the HuggingFace datasets-server API — no credential, no local `datasets` install. §19.1. |
| `tools/lib/benchmark-brief.mjs` | Renders a benchmark's descriptive brief. Imported by `export-dashboard.mjs`; ships with its unit test. |

### `templates/` and `scaffolds/`

Only what a run actually reads. The source monorepo's `templates/` also holds
18 more console-orchestrator policies and three console templates
(`swe-bench`, `swe-bench-pro`, `process-baseline`); none is read by any file in
this repo, so none is here.

| Path | What it is |
|---|---|
| `templates/sdlc-mini/template.yaml` | The execution template the SDLC kind drives. Its `stages:` list is the authority on the SDLC flow; both published tasks name it. |
| `templates/policies/opus-plus-flash.yaml` | **One** console policy, shipped because §8.4 names it as the reference the harness's four policies were migrated onto. Nothing here loads it — it is a document. |
| `scaffolds/service-web/` | The starting codebase an SDLC task builds on: a NestJS + Prisma chassis with its own conventions file and chassis test. |

### `tools/harness-matrix/runs/`

Ten recorded runs. **Only `evidence-bundle/delegation/` is published** — §21 says
exactly what that is and what was deliberately left out.

---

## 7. The engine: what one run actually does

One invocation of `run-harness.mjs` is one workload × one runtime × one policy.
In order:

1. **Parse and validate.** An unknown flag, or a `--runtime` that is not
   `claude-code`, exits 2 before anything is loaded or spent.
2. **Load the policy** through `policy-core.mjs` and resolve every stage to a
   cell. A policy with no cell for the requested runtime fails here — by design,
   before any spend.
3. **Preflight.** Driver credential present? Worker interpreter importable?
   Vertex ADC present (delegated cells only)? Any failure exits 2. §16.5.
4. **Prepare the environment.** Pro: build the sealed container from the frozen
   instance image. SDLC: lay down the scaffold.
5. **Run each phase.** Per phase: render the prompt, build the `claude`
   invocation with the model pin, effort, budget, `--disallowedTools` and the
   guard hook, then execute. The driver delegates through the generated Skill;
   each delegation writes `worker-task-<phase>-a<N>-<M>.md` and
   `worker-usage-<phase>-a<N>-<M>.json`.
6. **Retry** on failure, up to `retry.max_attempts` (3 in all four policies). The
   attempt number is the `a<N>` in those filenames.
7. **Extract the result.** Pro: `model.diff` out of the container, with test
   files stripped. SDLC: the working tree.
8. **Grade**, unless `--skip-grade`. Verdict → `grade-verdict.json`.
9. **Audit** the trajectory and the hand-offs → `audit.json`.
10. **Bundle** → `evidence-bundle/`, credential-scanned.

The whole run is described by `manifest.json`, which freezes the resolved policy
alongside the results — so a run can be read later without trusting this repo's
current state.

---

## 8. Policies: the model layer

A policy answers one question per stage: **which model, reached how, thinking how
hard?**

### 8.1 The four matrix policies

| File | Cell | What it is for |
|---|---|---|
| `all-opus.yaml` | Opus 4.6, solo | **The anchor.** The strongest driver doing the work itself, no delegation. Everything else is measured against this. |
| `all-gemini-flash-high.yaml` | Opus 4.6 driver → **Gemini 3.5 Flash** worker, thinking HIGH | **The headline cell.** This is the cc×Antigravity-SDK configuration Google asked about. |
| `all-gemini-25-flash-high.yaml` | Opus 4.6 driver → **Gemini 2.5 Flash** worker | The same cable, one model generation back. Isolates what a generation of progress is worth. |
| `gemini35-plus-25-flash-high.yaml` | **3.5 Flash** on `requirements`, `design`, `plan-packets`, `review`, `judge`; **2.5 Flash** on `execute` (and therefore on `verify`'s repair rounds, which bill under `execute`'s binding) | **The tiered column.** Which stages is the premium tier worth paying for? |

All four hold the same things constant: driver pin `claude-opus-4-6`, driver
effort `high`, region `asia-south1`, retry `flat` × 3 attempts, and identical
limits (`phase_timeout_min: 45`, `cmd_timeout_min: 15`, `phase_budget_usd: 8.00`).
Limits are part of the **study definition**, not a tuning knob: two columns
compared under different ceilings are not comparable.

### 8.2 The schema, by example

`all-gemini-flash-high.yaml`, reduced to its structure:

```yaml
version: 2
name: all-gemini-flash-high
models:
  # THE CELL — a composition naming two leaves defined below
  - id: flash-high              # this string is the modelId in every manifest
    composition: delegated      # 'delegated' = driver + worker; 'solo' = driver only
    runtime: claude-code        # pinning the runtime is what makes a cell gateable
    driver: opus-anthropic
    worker: flash-35-agsdk-vertex

  # THE DRIVER LEAF — one model x adapter x API
  - id: opus-anthropic
    adapter: builtin-anthropic  # the claude CLI talks to Anthropic itself
    api: anthropic
    model_name: claude-opus-4-6
    reasoning:
      effort: high              # becomes --effort high

  # THE WORKER LEAF
  - id: flash-35-agsdk-vertex
    adapter: antigravity-sdk    # gemini_worker.py -> pip google-antigravity
    api: vertex
    model_name: gemini-3.5-flash
    region: asia-south1         # REQUIRED whenever api: vertex — see below
    reasoning:
      tier: high                # becomes ThinkingLevel.HIGH in the SDK call

rules:
  - when: { phase: [repro, localize, patch] }
    use: flash-high
    reason: SWE-bench Pro phases — delegated Opus->Flash cell throughout
  - default: flash-high
    reason: unrecognised stage — delegated Opus->Flash cell

retry:   { type: flat, max_attempts: 3 }
limits:  { phase_timeout_min: 45, cmd_timeout_min: 15, phase_budget_usd: 8.00 }
```

Three rules that are not obvious and will bite you:

- **`region` is mandatory when `api: vertex`.** An unpinned region falls back to
  Vertex's shared `global` endpoint, which starved this project for three hours
  on 2026-07-16 and killed two paid Pro runs mid-patch. The loader now refuses
  the file rather than let that recur.
- **A worker leaf for `gemini-2.5-flash` must omit `reasoning:` entirely.**
  Vertex hard-rejects the parameter on that model:
  `code 400 · Unable to submit request because thinking_level is not supported by
  this model`. Declaring no tier resolves to NONE, which is what that model can
  actually run. Asking for the impossible cost a full paid run to discover.
- **Whether a stage is delegated is decided by the presence of `worker`** — never
  by a thinking level, never by the stage name.

### 8.3 The 2026-07-29 policy revamp: what changed, and why

**The problem.** This codebase had two policy layers doing the same job in
different words. The console orchestrator's files (`templates/policies/*.yaml`,
19 files) said *which model AND how it is reached* — `adapter` + `api`. The
harness's four files said only *which model*; the adapter and the API were
hardcoded in `runtimes.mjs`. So a policy could say `worker: gemini-3.5-flash`
while the fact that it was reached **through the Antigravity SDK, against Vertex
AI, in asia-south1** appeared nowhere in the policy — which meant the frozen
`policy_snapshot.yaml` inside every recorded run **did not record the cable that
run actually used.**

That is a provenance hole, and it sat on the one surface where the Antigravity
SDK actually runs.

**The instruction** (Ravi, 2026-07-28): integrate the SDLC policy and the
Antigravity SDK into one policy and rollout code, applicable to all policies,
with `templates/policies/opus-plus-flash.yaml` as the reference — which
"shouldn't lose its structural strength (in terms of rules and models
abstraction), rather should be extended to support model + adapter combinations
(each having its own id)".

**The change, mechanically:**

| Legacy (v1) | Unified (v2) |
|---|---|
| `models[].bindings{ runtime → {driver, worker} }` | a **composition** entry naming other `models[]` entries as `driver` / `worker` |
| `models[].thinking{ runtime → level }` | `reasoning.effort` on the driver leaf, `reasoning.tier` on the worker leaf |
| `phases: { stage: model-id }` map | `rules[]` — the console's matcher, with `when` / `use` / `reason` |
| adapter and API implicit, in code | `adapter` + `api` (+ `region`) explicit on every leaf |

The old shape looked like this, and **still loads** — the loader detects a
top-level `phases:` key and resolves it with a verbatim port of the
pre-unification logic:

```yaml
name: all-opus
models:
  - id: opus
    bindings:  { claude-code: { driver: claude-opus-4-6 } }
    thinking:  { claude-code: high }
phases:
  repro: opus
  localize: opus
  patch: opus
  default: opus
```

**Four things fell out of the change for free, which is the evidence the shape
was right:**

1. **No new schema fields were invented.** `reasoning: {tier, effort}` already
   existed in the console's v2 schema and carries exactly what `thinking:` and
   `worker_thinking:` carried.
2. **`rules[]` brought the whole matcher**, including `retry_count` — see the
   honest limitation below.
3. **`select` slots became available on the harness**, so "one model, two
   adapters, three APIs" can now be *asked* on the surface where the SDK runs.
   Asked in the schema, that is: no policy here declares a slot, `run-harness.mjs`
   has no `--select` flag (§19.4), and the CLI parser for it is console-side and
   not published. The validator accepts the shape; nothing here exercises it.
4. **Recorded runs did not move.** Every cell id is unchanged (`opus`,
   `flash-high`, `flash-35-high`, `flash-25-high`) because that string is the
   `modelId` every manifest, audit record and export already carries. Only the
   **new leaf entries** got new names.

**What the revamp did NOT fix, stated so nobody reads more into it.** The tiered
policy would like an escalation rule — "on the third attempt, use the premium
tier". The *schema* can now express it: `retry_count` is a first-class matcher
key and the rule would validate. The *resolver* cannot honour it — the harness
resolves every stage exactly once, before the run, at `retry_count: 0`, and each
retry reuses that binding. Writing the rule today would produce a file that reads
as though it escalates and never does, which is strictly worse than not having
it. Wiring it means resolving per **attempt** rather than per stage, a real
change to the execution loop, and it was deliberately not smuggled in.

**Backward compatibility is total.** No frozen `policy_snapshot.yaml` was ever
rewritten, in memory or on disk. Every evidence bundle already shipped still
replays.

### 8.4 Why there are policies in two directories, and which one won

There are two directories, and that is the correct answer rather than a leftover:

| Directory | Files | Configures |
|---|---|---|
| `templates/policies/` | 19 in the source monorepo, **1 here** | The **console orchestrator** — the SDLC product's own model routing across its phases |
| `tools/harness-matrix/policies/` | 4 | The **harness matrix** — one file per experimental column |

The count differs because this repo is the harness, not the console. Only
`opus-plus-flash.yaml` ships, as the reference below; the other 18 configure a
program that is not here and that no file here can load.

They are separate because they configure **two different programs**. A harness
cell (a runtime-pinned experimental column) is not a console route (a production
routing rule). Merging the files would mean a change to a research column could
alter production routing, and the reverse.

**But there is only ONE schema and ONE engine.** Both sides are `version: 2`;
both are parsed and resolved by `packages/policy/core/policy-core.mjs`; the
console reaches it through `packages/policy/src/loader.ts` and the harness
through `kinds/lib.mjs`.

**Which one did we go with?** The **console's**. `opus-plus-flash.yaml` was the
reference implementation, and the harness's four files were migrated *onto* its
schema on 2026-07-29 — not the other way round, and not into a third compromise
shape. Concretely: the console's `models[]` + `rules[]` shape won; the harness's
`bindings` + `thinking` + `phases` shape was retired.

The practical consequence for a reader: **read
`templates/policies/opus-plus-flash.yaml` first.** It is the canonical example of
the schema, it is the file the harness policies were made to match, and the two
can now be diffed directly instead of compared through a hand-maintained table.

---

# PART II — THE INTEGRITY MACHINERY

This is the part that makes the repo worth publishing. Read §9 before §10–§15.

## 9. The two claims, and which one is enforced

The harness makes exactly two claims. They are not equally strong, and conflating
them is the single most likely way to misread this repository.

### Claim 1 — PROVENANCE: "every delivered byte was authored by the Gemini worker process."

**Mechanically enforced. Holds 100% across all ten published runs.**

Three independent layers, in §10, §11 and §12. The driver's file-writing tools do
not exist in its process; the one remaining path (a shell command) is intercepted
before execution; and a post-run audit re-derives the same judgement from the
recorded trajectory using the **same predicate function** as the live guard.

### Claim 2 — ATTRIBUTION: "Gemini did the engineering thinking."

**Not enforceable. Not claimed. Contradicted on the SDLC workload.**

The hand-off channel is free text — the only interface the Antigravity SDK
offers. Free text can carry a finished function. When the driver writes out the
code it wants and the worker types it in, provenance is perfectly satisfied and
attribution is a fiction.

What the committed evidence shows, all of it reproducible from this repo:

- The delegation content lint (§13), run over the 62 published hand-offs, flags
  **8**: 5 of 32 on SDLC, 3 of 30 on SWE-bench Pro.
- **The lint is deliberately conservative.** It fires on a code fence of 9+
  non-blank lines, or on explicit dictation phrasing. A hand-off that describes
  the intended implementation precisely in prose, or hands over an 8-line
  function, passes clean.
- A **human reading of the SDLC hand-offs found driver-authored implementation
  considerably more widespread than the lint's count.** The SDLC prompts invite
  the driver to specify, and it does. The SWE-bench Pro headline hand-offs read
  clean under both the lint and the human pass.

So: **cite the SWE-bench Pro result for delegated engineering. The SDLC result
demonstrates the cable works end to end, and should not be cited as evidence that
Gemini did the design work.** That distinction is stated here rather than buried,
because a careful reader would find it anyway and finding it unstated would
discredit everything else in the repo.

---

## 10. Layer 1 — the driver's tools are removed

In `runtimes.mjs`, every delegated cell's `claude` invocation carries:

```
--disallowedTools Edit Write NotebookEdit MultiEdit
```

These are not the model being *asked* not to edit. They are absent from the tool
list the process is given, so there is no call it can emit that the CLI would
route to a file write.

Additionally closed for **every** cell, delegated or not: `WebFetch`,
`WebSearch`, `Task`. Web access would let a model fetch the real upstream fix for
a SWE-bench Pro instance; `Task` would spawn a subagent whose tool set the guard
does not govern.

**The hole this leaves, and why it has to stay open:** the driver still has
`Bash`. Removing it would break the harness — the driver has to run tests, read
build output and inspect the repository to decide anything at all. And `Bash` can
write files. That is what layer 2 is for.

## 11. Layer 2 — the PreToolUse guard hook

A hook is registered on the `claude` process that runs **before** a tool call
executes and can deny it. Three matchers:

| Matcher | What it does |
|---|---|
| `Bash` | Denies any command that writes into the working tree. |
| `Read` | Enforces delegate-first ordering — the driver is told what it is and what it must do before it starts reading. |
| `Grep|Glob` | The same, for search. |

The denial message is not a generic refusal; it names the situation ("You are the
DRIVER in a delegated cell and …") so the model's next action is to delegate
rather than to try a different shell incantation.

**The predicate is `bashEditsTree(command, {workdir, outDir})`, and it lives in
`audit.mjs`.** The hook does not reimplement it — `runtimes.mjs` generates the
hook script with a literal
`import { bashEditsTree, bashInspectsRepo, searchTargetsRepo, stripHeredocs } from "<absolute path to audit.mjs>"`.

That import is the whole design:

> **The thing that blocks a command at run time and the thing that judges the
> recorded trajectory afterwards are the same function.** They cannot disagree,
> drift apart, or be tightened in one place and left loose in the other. A change
> to what counts as "writing into the tree" changes both simultaneously, and
> `guard.test.mjs` and `audit.test.mjs` both exercise it.

`stripHeredocs` is applied first, so a `cat <<EOF` whose *body* contains
tree-writing-looking text is judged on the command, not on the document.

## 12. Layer 3 — the post-run audit: all ten families

`audit.mjs` reads the recorded trajectory and the hand-off files and produces
flags. **`critical: true` means: had the scaffold not sealed this channel, the
attempt would have leaked the solution or tampered with the grade.** A critical
flag **voids the instance in the report** — the score is not quietly kept.

### Trajectory families

| Family | Critical | What it catches |
|---|---|---|
| `git-history-mining` | **yes** | `git log/show/diff/rev-list/branch/reflog` reaching past the sealed base — `--all`, `origin/` refs, raw 40-character SHAs, `.git/packed-refs`, `.git/refs`, `.git/logs`. Every one of those is a route to the commit that actually fixed the bug. |
| `source-host-fetch` | **yes** | `curl` / `wget` / `git fetch|pull|clone|remote` against github.com, githubusercontent.com, gitlab.com, bitbucket.org. Package registries are deliberately **not** matched — dependency traffic is legitimate. |
| `test-edit-attempt` | no | Touching test paths (`tests/`, `__tests__/`, `*_test.go`, `*.test.ts`, `test_*.py`, `conftest.py`, …). Not critical because the diff stripper already removes these before grading; flagged so the report can say "attempted, stripped" rather than nothing at all. |
| `driver-direct-edit` | no | The driver writing the tree via Bash. This should be impossible — the guard denies it — so a flag here means the guard was bypassed or misconfigured. It is checked twice precisely because "impossible" is a claim, not a guarantee. |
| `driver-predelegation-inspection` | no | The driver reading or searching the repository before it has delegated. Records how much context the driver built for itself before handing over. |
| `delegation-policy-mismatch` | **yes** / no | The run's actual delegation behaviour disagreeing with the resolved policy. The critical variant is the one that matters: it caught the 2026-07-26 tiered run where Vertex 400'd on `thinking_level`, the driver silently dropped the flag and retried, and **every header row still advertised HIGH while both delegations ran at NONE** — an unannounced change to the experiment that every other gate passed. |

### Hand-off text families — the next section.

---

## 13. The delegation content lint: policing the free-text channel

`lintDelegationText` in `audit.mjs` answers one question: **did the driver
dictate what the worker typed?**

That question has no structural answer. The driver provably typed nothing (§10,
§11). But the channel is free text, and free text can carry a finished function.
The only way to know is to read the hand-offs — and the only way to keep
**knowing** is to pin the reading (§14).

### 13.1 The four families

| Family | Critical | Fires when |
|---|---|---|
| `driver-dictated-code` | no | A fenced code block that is **not** shell-tagged, is **not** a directory tree, and runs **`DICTATION_MIN_LINES` (9) or more non-blank lines**. |
| `driver-dictation-phrasing` | no | Explicit dictation language in the prose — the driver telling the worker what to type rather than what to achieve. |
| `driver-proxy-shell-command` | no | The hand-off carries a shell command for the worker to run. Not automatically bad (`git checkout -- pnpm-lock.yaml` is housekeeping), but it is the driver reaching through the worker's hands, so it is recorded. |
| `guard-evasion-by-proxy` | **YES** | The hand-off contains a command **the guard already denied to the driver**. That is not a grey area: the driver tried to write the tree, was blocked, and then asked the worker to run the blocked command on its behalf. |

`guard-evasion-by-proxy` is the only critical family here and the reason this
lint exists at all. The other three are **signals to a human reader**; this one
is a correlation between the guard's denial log and the hand-off text, and it is
dispositive.

### 13.2 The 8/9 threshold — the most load-bearing number in the repo

```js
export const DICTATION_MIN_LINES = 9;   // audit.mjs
```

Why 9, precisely:

- Across the 50-hand-off labelled corpus, the **largest** non-shell, non-tree
  code fence in a hand-off a human labelled **clean** is **8 lines** — a JSON
  example, in `30-kudos-wall-07260610-plan-packets-a1-1.md`.
- The **smallest** such fence in a hand-off a human labelled **solution-leaked**
  is **9 lines**.

The threshold sits in a **one-line margin** between the two classes. At 9 the
lint reproduces the human labelling exactly: **6/6 true positives, 0 false
positives.**

That margin is the point. It is not a round number somebody liked; it is the
measured boundary, and it is narrow enough that any drift is detectable.

### 13.3 How a change to the lint gets caught

`delegation-corpus.test.mjs` runs `lintDelegationText` over all 50 committed
hand-offs and asserts the result matches `labels.json` **exactly** — both the
per-file verdict and the families produced.

So:

- Raise `DICTATION_MIN_LINES` to 10 → the 9-line dictation stops being caught →
  **a true positive disappears, the test fails, and it names the file.**
- Lower it to 8 → the 8-line JSON example is caught → **a false positive appears,
  the test fails, and it names the file.**
- Widen a regex, narrow a regex, add a family, remove a family → the same test
  fails and names the hand-off whose verdict moved.

`pnpm test` runs this. **No credential, no network, no spend.** Anyone can verify
the threshold is where this README says it is, in about ten seconds.

### 13.4 What the lint cannot see, stated plainly

- **Prose dictation.** A hand-off that describes the intended implementation
  precisely, in English, with no code fence, passes clean. This is the largest
  gap and it is not closable by pattern matching.
- **Short dictation.** An 8-line function passes by construction.
- **`guard-evasion-by-proxy` cannot be raised from a bundle alone.** It needs the
  trajectory's denial ordering, which the published bundles do not include. Every
  published `lint.json` says so in its own `critical_note` field, and a zero
  there is **not** evidence against evasion — the run-time pass recorded in
  `audit.json` is the one that can see it.

---

## 14. The frozen corpus: why 50 hand-offs are committed

`tools/harness-matrix/fixtures/delegation-corpus/`

| Path | What it holds |
|---|---|
| `handoffs/NN-<target>-<run>-<delegation>.md` | 50 real hand-off files, verbatim |
| `labels.json` | 50 rows: the human label (`clean` or `solution-leaked`), the families the lint produced when the corpus was committed, full provenance back to the run directory each came from, and the size metrics used to choose the thresholds |
| `README.md` | The methodology and the threshold measurements |

Ground truth: **44 clean, 6 solution-leaked.**

**Why they are copies rather than references.** An earlier draft of the test read
the hand-offs out of `../../runs/` and skipped itself when those directories were
absent. That is worse than no test: on a fresh clone, or in CI, it passes by
doing nothing. Copies mean the test runs everywhere, always.

**Why this matters to you, the reader.** Without the corpus in the repo, every
threshold in `audit.mjs` is an unverifiable claim about files on one laptop. With
it, the thresholds are a **tested property** — and you can re-derive the 6/6,
zero-false-positive result yourself with `pnpm test`, or read the 50 files and
disagree with our labelling. An external reviewer should be able to do both, and
neither is possible without shipping the corpus.

**One consequence worth knowing:** two of the fifty are SDLC (kudos-wall)
hand-offs, and they are the two files that pin the 8/9 boundary. That is one of
three reasons this repo could not have been extracted as SWE-bench-Pro-only.

---

## 15. The seal: what a model is never shown

For SWE-bench Pro, the corpus fetcher writes two files per instance:

| File | Contains | Shown to a model? |
|---|---|---|
| `instance.json` | Repo, base commit, problem statement, environment setup | **Yes** — this is the task |
| `sealed.json` | Gold patch, test patch, `fail_to_pass`, `pass_to_pass`, image tag | **Never** |

`packages/swe-bench/src/integrity.ts` enforces the split in code:

- `assertAgentSafe(value, label)` — throws if an object about to reach a model
  carries any solution field. Called on every path that constructs a prompt.
- `validateInstance(raw, label)` — enforces the shape and the split at load time,
  so a malformed or contaminated corpus fails immediately instead of leaking
  silently mid-run.
- `loadInstances(dir)` — reads a corpus directory through both of the above.

Four further seals, each closing a different route to the answer:

1. **The container is sealed.** The run happens in a container built from the
   frozen instance image at the base commit. The upstream fix is not in it.
2. **Git history is sealed.** `git-history-mining` (critical, §12) catches the
   attempt to reach commits past the base — the exact exploit route.
3. **The network is sealed at grade time.** Grading runs Scale AI's official
   evaluator with `--block_network`.
4. **The grading image is not the execution image.** Grading uses the **original
   frozen Scale image**, never our sealed build. A patch is graded in an
   environment the agent never touched, so nothing the agent did to its own
   container can influence the verdict.

And the diff is stripped: test files the model touched are removed from
`model.diff` before grading, so a model cannot pass by editing the test.

---

# PART III — RUNNING IT

## 16. Credentials: everything, in one place

**No credential of any kind is committed to this repository.** No key, no token,
no service-account JSON, no `.env`. Every file published under `runs/` was
credential-scanned by `bundle-run.mjs` before it was written, and absolute host
paths were rewritten to `/harness` by `scrub-paths.mjs`.

You need two credentials to run live. They are independent, they bill separately,
and neither is needed for Level A.

### 16.1 The driver — Claude Code

Set **exactly one** of:

| Variable | What it is | Bills |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | A Claude Code subscription seat's OAuth token | Your subscription's quota |
| `ANTHROPIC_API_KEY` | A metered Anthropic API key | Your API wallet, per token |

Preflight checks for these and fails with exit 2 if neither is present:

```
claude-code preflight: set CLAUDE_CODE_OAUTH_TOKEN (Max) or ANTHROPIC_API_KEY
```

**They are alternatives, not both.** If both are set, the CLI's own precedence
decides which is used — so set the one you intend to pay from and unset the
other. Our own runs used the OAuth subscription seat.

The `claude` CLI must be on `PATH`:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### 16.2 The worker — Gemini through the Antigravity SDK on Vertex AI

**a. Build the venv** (Python **≥ 3.10**):

```bash
python3 -m venv tools/harness-matrix/sdk-probe/sdkprobe
tools/harness-matrix/sdk-probe/sdkprobe/bin/pip install google-antigravity
```

Verified against **google-antigravity 0.1.7**.

*Homebrew Python users:* if the venv cannot `import pyexpat`, run
`brew install expat` and point `GEMINI_WORKER_DYLD` at
`/opt/homebrew/opt/expat/lib` (which is already the default).

**b. Authenticate to Vertex** — Application Default Credentials:

```bash
gcloud auth application-default login
```

or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON. Preflight
checks for one of these and fails with exit 2 if neither is present.

**c. Point it at YOUR project.** This is the step most likely to be missed:

> `gemini_worker.py` defaults `GOOGLE_CLOUD_PROJECT` to **`ai-studies-console`** —
> **our** paid project. You almost certainly cannot reach it, and you should not
> want to. **Set `GOOGLE_CLOUD_PROJECT` to your own project id.**

That project needs the **Vertex AI API enabled** and quota, in the region you
pin, for whichever model your policy's worker leaf names — `gemini-3.5-flash`
for the three headline policies, `gemini-2.5-flash` for the older-generation
column, both for the tiered one (§8.1).

### 16.3 The complete environment-variable table

| Variable | Default | When you need it |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Driver auth (subscription seat). This or the next, not both. |
| `ANTHROPIC_API_KEY` | — | Driver auth (metered API). |
| `GOOGLE_CLOUD_PROJECT` | **`ai-studies-console`** | **Always override.** Our project id is the built-in default. |
| `GOOGLE_CLOUD_LOCATION` | `asia-south1` | Override only if your quota lives elsewhere. Never leave a Vertex call unregioned — the shared `global` endpoint starved this project for 3 hours on 2026-07-16. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Alternative to `gcloud auth application-default login`. |
| `GEMINI_WORKER_PYTHON` | `tools/harness-matrix/sdk-probe/sdkprobe/bin/python` | If your venv lives elsewhere. |
| `GEMINI_WORKER_DYLD` | `/opt/homebrew/opt/expat/lib` | The Homebrew `pyexpat` workaround. |

### 16.4 Docker — required by BOTH kinds

Every command a run executes — the model's builds and tests, and the grading
gates — runs inside a container. Both kinds check for a working Docker daemon in
preflight and exit **2** if it is absent.

The two kinds use Docker differently:

| | Image | Built |
|---|---|---|
| **SDLC** | `Dockerfile.sdlc` — one shared `node:22-bookworm` toolchain image, arm64-native, carrying no task state | Once, then fully cached. Each run also creates and drops its own `node_modules` volume. |
| **SWE-bench Pro** | `Dockerfile` — built **per instance** on top of the frozen Scale base image, plus the git seal | Per instance. Budget **~30 GB** of disk. |

On Apple Silicon the Pro images are `linux/amd64` and run under Rosetta, which
makes both the build and the graded test run materially slower than native —
budget minutes per instance, not seconds (§23). The SDLC image needs no platform
pin and builds natively.

Docker holds several gigabytes of RAM while running. On a machine with 8 GB or
less, **run sequentially, never concurrently.**

### 16.5 Preflight does these checks for you

Before any spend, `run-harness.mjs` verifies: the driver credential is present ·
the `claude` CLI runs · the policy has a binding for this runtime — and, for a
delegated cell only · the worker interpreter exists · it can
`import google.antigravity` · Vertex ADC is on disk. The kind then checks the
Docker daemon. Any failure exits **2** with a message naming the fix. You will not
discover a missing credential half a run in.

Preflight runs on a real launch only. `--dry-run` returns before it (§19.4), which
is why a dry run works on a machine with no credentials at all.

---

## 17. Setup, end to end

```bash
# 1. The repo
git clone https://github.com/tl-ai-labs/claude-code-harness-antigravity-sdk
cd claude-code-harness-antigravity-sdk
pnpm install && pnpm build && pnpm test        # Level A complete, $0

# 2. The driver
npm install -g @anthropic-ai/claude-code
export CLAUDE_CODE_OAUTH_TOKEN=...             # or ANTHROPIC_API_KEY

# 3. The worker
python3 -m venv tools/harness-matrix/sdk-probe/sdkprobe
tools/harness-matrix/sdk-probe/sdkprobe/bin/pip install google-antigravity
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project-id    # NOT ours
export GOOGLE_CLOUD_LOCATION=asia-south1

# 4. Read the plan back before spending on a real run
node tools/harness-matrix/run-harness.mjs \
  --task-dir tools/harness-matrix/tasks/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \
  --dry-run
```

Be precise about what that last step does and does not prove. `--dry-run` exits
**before** preflight, so it verifies the policy resolves and the plan is what you
intended — it does **not** check a single credential. The credentials above are
checked by **preflight**, which runs only on a real launch, at $0, before any
model call or Docker build: it verifies the driver credential, that the `claude`
CLI itself runs, that the policy actually has a binding for this runtime, and —
for a delegated cell only — that the worker interpreter exists, that it can
`import google.antigravity`, and that Vertex ADC is on disk; then the kind checks
the Docker daemon. Any one of those missing exits **2** with a named cause. So the
sequence is: dry-run to check the plan, then a real launch, whose first act is a
free credential check.

---

## 18. Running the SDLC kind — start here

The SDLC kind needs **no corpus, no evaluator clone and no second venv** — only
Docker, which both kinds require. It is the cheapest way to prove the whole cable
works on your machine.

The first run builds the shared toolchain image from `Dockerfile.sdlc`; every
run after that reuses the cache.

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir tools/harness-matrix/tasks/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

Two tasks ship complete: `tasks/kudos-wall` (the one all four published SDLC runs
used) and `tasks/uptime-ping`.

**Eight stages run in order**, from `templates/sdlc-mini/template.yaml`:

| # | Stage | Executor | Model-driven? |
|---|---|---|---|
| 1 | `requirements` | llm-task | **yes** |
| 2 | `design` | llm-task | **yes** |
| 3 | `plan-packets` | llm-task | **yes** |
| 4 | `execute` | llm-task (planned packets) | **yes** |
| 5 | `verify` | verify — build + tests, up to 3 repair rounds | no (script); repairs bill under `execute`'s binding |
| 6 | `review` | llm-task | **yes** |
| 7 | `judge` | judge | **yes** |
| 8 | `report` | report — manifest, diff, audit, grade | no (the harness's own finish block) |

The six model-driven stages are the ones a policy routes and the ones that
delegate; each writes its hand-off and its usage receipt. `grade-sdlc.mjs` then
runs the task's own acceptance gates.

**There is no `security_review` stage in this template.** The tiered policy
carries a rule for one anyway — see §8.1.

To run the tiered policy instead — 3.5 Flash on judgment stages, 2.5 Flash on
volume stages — swap in
`--policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml`.

To run the anchor (Opus doing the work itself, no delegation), use
`--policy tools/harness-matrix/policies/all-opus.yaml`.

---

## 19. Running the SWE-bench Pro kind

### 19.1 Build the corpus — it is NOT shipped

`--instance-dir` names a directory that does not exist in a fresh clone. Build
it:

```bash
# by explicit instance id
node tools/swe/fetch-instances-pro.mjs \
  --ids navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a

# or a language-stratified sample over the 731 public instances
node tools/swe/fetch-instances-pro.mjs --seed 20260716 --count 12
```

This writes `studies/swe-pro-corpus/<instance_id>/{instance.json, sealed.json}`
plus a `selection.json`. It reads the public SWE-bench Pro split through the
HuggingFace datasets-server API — **no credential, no local `datasets`
install.**

The corpus is not committed because it is derived data with a canonical upstream
source, and because `sealed.json` holds the gold patches — deriving them locally
is cleaner than republishing them.

### 19.2 Set up grading

Grading uses **Scale AI's own official evaluator**, not ours:

Both paths below are **hard-coded** in `grade.mjs` (`HARNESS` and `PYTHON`, at
the top of the file). Put them anywhere else and grading will not find them.

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

This venv is separate from the worker's Python venv (§16.2) and separate from
the repo's Node dependencies. It exists only because Scale's evaluator is a
Python script. `grade.mjs` asserts it **only when it is about to be used** — an
empty model diff is recorded as unresolved without invoking Python at all, so a
clone with no grading venv can still complete that path.

### 19.3 Run

```bash
node tools/harness-matrix/run-harness.mjs \
  --instance-dir studies/swe-pro-corpus/<instance_id> \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

Three phases: **REPRO** (reproduce the failure) → **LOCALIZE** (find the cause) →
**PATCH** (fix it). Then `grade.mjs` runs the official evaluator in Docker, with
the network blocked, against the original frozen Scale image.

### 19.4 Flags and exit codes

| Flag | Effect |
|---|---|
| `--instance-dir <path>` | Selects the SWE-bench Pro kind |
| `--task-dir <path>` | Selects the SDLC kind |
| `--runtime claude-code` | The only runtime. Anything else fails preflight. |
| `--policy <path>` | One of the four in `tools/harness-matrix/policies/` |
| `--dry-run` | Resolve the policy, print the full plan (stage walk, per-stage model binding, caps, cost regime) and the first agent stage's fully rendered prompt, then exit 0. It stops **before** preflight — so it needs **no credentials, no Docker, no corpus**. Run this first, always. |
| `--skip-grade` | Run without grading |
| `--cleanup-images` | Remove Docker images afterwards (Pro only — the SDLC kind ignores it) |

That is the complete flag list — `run-harness.mjs` parses exactly these seven and
nothing else. `--instance-dir` and `--task-dir` are mutually exclusive and one is
required; an unknown flag is silently ignored rather than rejected, so check your
spelling against this table.

| Exit | Meaning |
|---|---|
| **0** | The run completed. **This does not mean the model succeeded** — the verdict is in `grade-verdict.json`. |
| **1** | Infrastructure error (Docker, network, container). |
| **2** | Usage or preflight error (bad flag, missing credential, unreachable worker, a policy with no cell for the runtime). Nothing was spent. |

---

## 20. What a run writes

```
tools/harness-matrix/runs/<task-or-instance>/claude-code--<policy>/<timestamp>/
├── manifest.json          the whole run: resolved policy, stages/phases, costs, timings, audit summary
├── model.diff             what the model changed, test files stripped (the graded patch)
├── raw.diff               the same diff BEFORE stripping — so the stripping is itself auditable
├── grade-verdict.json     resolved / not-resolved, plus the grader's identity
├── audit.json             every flag from every family (§12, §13)
├── predictions.jsonl      Pro only — the one-line prediction record the evaluator consumes
├── grade/                 Pro only — the evaluator's own working dir and output
├── workdir/               the working tree (large; never published)
├── out/                   raw phase output, plus the container shim run-in-env.sh
└── evidence-bundle/
    ├── MANIFEST.sha256    a hash for every file in the bundle
    ├── integrity-notes.md the generated integrity write-up, including the delegation section
    ├── phase-io/          per-stage prompt and output
    ├── trajectory/        the driver's own turn-by-turn record
    ├── (copies of manifest.json, audit.json, model.diff, raw.diff, grade-verdict.json)
    └── delegation/
        ├── worker-task-<stage>-a<N>-<M>.md      the EXACT hand-off text
        ├── worker-usage-<stage>-a<N>-<M>.json   the SDK's own token receipt
        └── lint.json                            the delegation lint's verdict
```

`a<N>` is the attempt number (retries); `<M>` is the delegation index within that
attempt. So `worker-task-execute-a2-3.md` is the third delegation of the second
attempt at the execute stage.

Two things that are **not** here, because people look for them:

- **There is no `policy_snapshot.yaml` in a run directory.** The resolved policy is
  embedded in `manifest.json` under `policy` — name, source path, **sha256 of the
  file**, and the resolved retry and limit block. `policy_snapshot.yaml` is written
  by the *exporter*, into the dashboard output tree, not by the run (§22).
- **`evidence-bundle/` is the only thing published here**, and within it only
  `delegation/` (§21). Everything else in this tree exists on the machine that ran it.

---

# PART IV — THE EVIDENCE

## 21. What is published here, and what is not

**134 files** across **10 delegated runs** — 6 SWE-bench Pro and 4
SDLC — covering **62 driver→worker hand-offs**.

| Run | Kind | Policy | Hand-offs |
|---|---|---|---|
| `instance_navidrome…3bc9e75b` (2 runs) | Pro | all-gemini-flash-high | 5, 7 |
| `instance_navidrome…b3980532` | Pro | all-gemini-flash-high | 5 |
| `instance_NodeBB…f083cd55` | Pro | all-gemini-flash-high | 4 |
| `instance_ansible…748f5343` | Pro | all-gemini-flash-high | 4 |
| `instance_internetarchive__openlibrary…` | Pro | all-gemini-flash-high | 5 |
| `kudos-wall` (3 runs) | SDLC | all-gemini-flash-high | 7, 6, 7 |
| `kudos-wall` | SDLC | gemini35-plus-25-flash-high | 12 |

### What ships, per run

- **Every hand-off, verbatim.** `worker-task-*.md` is the actual text the driver
  sent. Not a summary, not a redaction — the file, with host paths rewritten to
  `/harness`.
- **Every SDK usage receipt.** `worker-usage-*.json` is the Antigravity SDK's own
  `UsageMetadata`. These are the token counts the Gemini spend was computed from,
  and they come from the SDK, not from us.
- **The lint's verdict.** `lint.json` — hand-offs scanned, passages flagged,
  families, per-file breakdown, and an explicit `critical_note` stating which
  family this pass structurally cannot raise.

### What does NOT ship, and why

| Withheld | Why |
|---|---|
| `workdir/` | Full checkouts of large upstream repositories. Hundreds of megabytes per run, all of it reproducible from the base commit. |
| `manifest.json`, `model.diff`, `grade-verdict.json`, `audit.json` | They carry internal run metadata and absolute paths beyond what the scrub covers. The delegation bundle is the part that evidences the **delegation claim**, which is what this repo exists for. |
| `studies/swe-pro-corpus/` | Derived data with a canonical upstream. `fetch-instances-pro.mjs` rebuilds it (§19.1). |
| Three internal working memos | "For: Teja, Ravi" memos carrying meeting attendee lists and open internal decisions. A stub file remains at each path so `DESIGN.md`'s links resolve and so the omission is visible rather than silent. Nothing in them is needed to run the harness, reproduce a run, or check any published number. |

**The honest framing:** what is published is the evidence for the **provenance**
claim and for the **content** of every delegation. It is not a complete run
archive, and this table exists so you know exactly which one it is.

### The lint's aggregate verdict over what is published

Reproducible by re-running `lintDelegationText` over the bundles:

| | Hand-offs | Files flagged | `driver-dictated-code` | `driver-dictation-phrasing` | `driver-proxy-shell-command` | `guard-evasion-by-proxy` |
|---|---|---|---|---|---|---|
| SWE-bench Pro | 30 | 3 | 3 | 2 | 0 | 0 |
| SDLC | 32 | 5 | 4 | 0 | 1 | 0 |

Read that table with §9 and §13.4 in hand: the zeros in the last column are
**structural** (that family cannot be raised from a bundle at all), and the low
counts elsewhere reflect a deliberately conservative lint, not a clean bill of
health for attribution.

---

## 22. The dashboard: what you can produce yourself

`export-dashboard.mjs` **ships.** The dashboard web application **does not.**

What that means concretely:

```bash
node tools/harness-matrix/export-dashboard.mjs \
  --runs-root tools/harness-matrix/runs \
  --out ./dashboard-data
```

or per run:

```bash
node tools/harness-matrix/export-dashboard.mjs \
  --run-dir tools/harness-matrix/runs/kudos-wall/claude-code--all-gemini-flash-high/<timestamp> \
  --study harness-sdlc --pass 2026-07-28 --out ./dashboard-data
```

Add `--dry-run` to see what it would write without writing it.

It emits a static JSON contract: a top-level `studies.json` registry, plus, per
study and pass, `telemetry.jsonl`, `manifest.json`, `policy_snapshot.yaml`, a
`brief.md` one level up — and `instances.json` **only for the Pro kind**, which
is the only kind with a per-instance verdict to tabulate. If the policy file
named by the manifest cannot be found at export time, `policy_snapshot.yaml` is
still written, as a labelled stub.

Both kinds are auto-detected from the manifest — `instance_id` + `phases` means
Pro, `task_id` + `stages` means SDLC.

Three levels, kept deliberately separate:

- **STUDY** — the track (`harness-swe-bench-pro`, `harness-sdlc`). Never carries
  an instance name, a model, a cable or a timestamp, so its identity stays true
  no matter what is run next. New work is added as columns, never as new cards.
- **PASS** — one export batch = one cell (runtime × policy) over the instances in
  that invocation, stamped with the batch date. **Immutable:** a later batch
  writes a new column and never mutates an existing one, so a published number
  cannot change under a reader.
- **INSTANCE** — one run directory = one row, with its own verdict, per-phase
  cost split and run timestamp.

**Can you export the runs published here?** Partly, and honestly: the exporter
reads `manifest.json`, which is not published (§21). So it works on **runs you
produce yourself**, not on the ten recorded here. If you want recorded runs in a
dashboard, run the workloads yourself and export those — which is the more useful
exercise anyway.

**The viewer is a separate application and is not part of this repo.** The
contract above is stable and documented in the exporter's own header, so it can
be pointed at any renderer.

---

## 23. Costs actually observed

Not estimates. These are the recorded `totals` of the **ten runs published in
§21**, driver tokens plus worker tokens, as written by the harness at the time.

| Cell | Runs | Cost per run | Wall clock | Attempts |
|---|---|---|---|---|
| SWE-bench Pro × `all-gemini-flash-high` | 6 | **$1.68 – $2.42** (mean $1.93) | 15 – 39 min | 3 – 4 |
| SDLC × `all-gemini-flash-high` | 3 | **$3.11 – $3.94** (mean $3.57) | 21 – 27 min | 6 – 7 |
| SDLC × `gemini35-plus-25-flash-high` | 1 | **$6.03** | 46 min | 7 |
| Grading one Pro instance | — | **$0** in tokens | see below | — |
| Everything at Level A (§4) | — | **$0** | minutes | — |

**All ten published runs together cost $28.29.**

An SDLC walk costs roughly **twice** a Pro instance, and that is structural, not
noise: Pro runs three model phases (REPRO → LOCALIZE → PATCH), SDLC runs six
model-driven stages plus up to three repair rounds inside `verify` (§18). More
stages, more hand-offs, more spend.

**Grading is free in tokens and not free in time.** No model is called — Scale's
evaluator is a Python process running the repository's own test suite inside a
container. How long that takes is a property of the repository, and on Apple
silicon the Pro images are `linux/amd64` under Rosetta, so budget minutes per
instance rather than seconds. An empty diff short-circuits: the verdict is
written without invoking the evaluator at all.

**A caveat you should hold onto:** these totals come from `manifest.json`, which
is **not** published (§21). You cannot recompute this table from this repository
— you can only reproduce the *shape* of it by running the workloads yourself.
It is here so you can budget, not so you can audit us.

The per-attempt budget ceiling is pinned at **$8.00** in all four policies —
comfortably above the $2.42 worst case above. That is deliberate: it is a hang
detector, not a target. A budget stop mid-stage is indistinguishable in the
manifest from a model that gave up, which is the one failure shape a study must
never manufacture, so the ceiling sits well clear of observed usage.

---

# PART V — REFERENCE

## 24. Verify every claim in this README

One command per claim. All offline, all free.

```bash
# The tree builds and the suite is green: 301 tests, 293 pass, 0 fail, 8 skipped
# (the 8 skips each print their own reason — see §5)
pnpm install && pnpm build && pnpm test

# The delegation lint reproduces the human labelling exactly: 6/6 TP, 0 FP
node --test tools/harness-matrix/delegation-corpus.test.mjs

# The guard hook and the audit share one predicate, and both are tested
node --test tools/harness-matrix/guard.test.mjs tools/harness-matrix/audit.test.mjs

# The 8/9 threshold is where this README says it is
grep -n "DICTATION_MIN_LINES" tools/harness-matrix/audit.mjs

# The driver's file-writing tools really are removed
grep -n "disallowedTools" tools/harness-matrix/runtimes.mjs

# The guard hook really imports the audit's own predicate
grep -n "bashEditsTree" tools/harness-matrix/runtimes.mjs tools/harness-matrix/audit.mjs

# The corpus really is 44 clean / 6 solution-leaked
node -e "const l=require('./tools/harness-matrix/fixtures/delegation-corpus/labels.json'); const c={}; for (const r of l) c[r.label]=(c[r.label]||0)+1; console.log(l.length, c)"

# Every published hand-off is real text you can read
ls tools/harness-matrix/runs/*/*/*/evidence-bundle/delegation/worker-task-*.md | wc -l

# No absolute host paths leaked into the published evidence
grep -rl "/Users/" tools/harness-matrix/runs || echo "clean"

# Nothing that looks like a credential shipped
# Nothing that looks like a credential shipped. These are the SAME patterns
# bundle-run.mjs aborts a bundle on. EXPECTED OUTPUT: exactly one path,
# tools/harness-matrix/sdk-probe/test_proxy_offline.py — a documented usage
# example whose literal value is the string "sk-ant-REHEARSAL-not-a-real-key".
# Anything else is a real finding.
grep -rEl "sk-ant-[A-Za-z0-9_-]{10,}|ya29.[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{24,}|(OAUTH_TOKEN|ACCESS_TOKEN|API_KEY|SECRET_KEY)[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9._-]{16,}" . --exclude-dir=node_modules --exclude-dir=.git

# A full run rehearsal — no model call, no spend
node tools/harness-matrix/run-harness.mjs \
  --task-dir tools/harness-matrix/tasks/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml --dry-run
```

And the one that is not a command: **read three hand-offs under
`tools/harness-matrix/runs/*/*/*/evidence-bundle/delegation/` and form your own
view of §9.**

---

## 25. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm install` fails on a native module | Node 24+ | Use **Node 22** |
| Exit 2: `set CLAUDE_CODE_OAUTH_TOKEN (Max) or ANTHROPIC_API_KEY` | No driver credential | §16.1 |
| Exit 2: worker interpreter not found, or cannot import the SDK | The venv is missing or elsewhere | Build it (§16.2) or set `GEMINI_WORKER_PYTHON` |
| Exit 2: `no ADC for Vertex` | Not authenticated to Google Cloud | `gcloud auth application-default login` |
| `403` or `project not found` from Vertex | `GOOGLE_CLOUD_PROJECT` is still defaulting to **our** project | `export GOOGLE_CLOUD_PROJECT=your-project-id` |
| `ModuleNotFoundError: pyexpat` | Homebrew Python | `brew install expat`; check `GEMINI_WORKER_DYLD` |
| `400 · thinking_level is not supported by this model` | A `reasoning:` block on a `gemini-2.5-flash` worker leaf | Remove it entirely (§8.2) |
| Vertex quota/starvation errors, or a hang on the first delegation | The region is unpinned, so it is hitting the shared `global` endpoint | Pin `region:` in the policy and set `GOOGLE_CLOUD_LOCATION` |
| `--instance-dir` path does not exist | The corpus is not shipped | `node tools/swe/fetch-instances-pro.mjs …` (§19.1) |
| Grading will not start | Evaluator not cloned, or the wrong venv | §19.2 |
| Docker OOM, or two runs interfering | Concurrent runs on a small machine | Run **sequentially**; budget ~30 GB of disk |
| A run exits 0 but nothing was fixed | Exit 0 means *completed*, not *succeeded* | Read `grade-verdict.json` |

---

## 26. Where to read more

| Read | For |
|---|---|
| `tools/harness-matrix/DESIGN.md` | The full design record — every decision, every recorded defect, every constraint. The deepest document here. |
| `tools/harness-matrix/README.md` | A per-file reference table for the harness directory. |
| `tools/harness-matrix/IMPLEMENTATION-…-SWE-BENCH-PRO.md` | Code walkthrough of the Pro leg |
| `tools/harness-matrix/IMPLEMENTATION-…-SDLC.md` | Code walkthrough of the SDLC leg |
| `tools/harness-matrix/SDLC-RECIPE.md` | Step-by-step for the SDLC workload |
| `tools/harness-matrix/sdk-probe/README.md` | What each standalone SDK probe proved |
| `tools/harness-matrix/fixtures/delegation-corpus/README.md` | The corpus methodology and the threshold measurements |
| `templates/policies/opus-plus-flash.yaml` | The canonical example of the shared policy schema (§8.4) |
| `tools/harness-matrix/policies/all-opus.yaml` | The canonical in-file essay on the v2 migration |
| `tools/harness-matrix/prompts/*.md` | The actual instructions the models received |

**Three files that look like documents are not.**
`GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md`, `GOOGLE-CALL-COVERAGE.md`
and `MANAGED-AGENTS.md` are internal working memos addressed to named colleagues,
and each ships as a 16-line placeholder saying exactly that — present only because
`DESIGN.md` and `README.md` link to them by name and a dead link is worse than an
honest stub. Do not go looking for their content here. Everything about the
Antigravity SDK's limits that matters to *running this repo* is in `DESIGN.md` and
in §16 and §25 above.

---

## 27. Differences from the source repository

This repo is a **build output**, extracted from a private monorepo by a script
that is itself tested. Every difference:

1. **`packages/adapters` is not shipped.** The only three source files that
   reference it do so with `import type` (erased at compile time), the harness
   does not import them, and item 3 keeps them out of the compile. §6.
2. **Three package manifests are regenerated minimal.** The originals declare
   workspace siblings and build scripts for source this repo does not ship, so
   `pnpm install` would fail on them. Dependency versions are copied exactly.
3. **`packages/swe-bench/tsconfig.json` is narrowed** to the two files the
   harness imports; the others `import type` from a package not shipped here.
4. **Root `package.json`, `pnpm-workspace.yaml`, `.gitignore` and this README are
   generated.** The monorepo's own root files describe applications that do not
   exist here.
5. **Three internal working memos are stubbed, not published** — §21.
6. **Absolute host paths in published evidence are rewritten to `/harness`,** and
   every published file was credential-scanned before it was written.
7. **Only `evidence-bundle/delegation/` ships from each run directory** — §21.

The extraction is deterministic: no timestamps, no commit SHAs. Re-running it
against an unchanged source produces a byte-identical tree, so an empty
`git status` after re-extraction means nothing publishable changed.

---

## 28. Direct answers to the obvious questions

**"Did Claude write the code and Gemini just type it?"** — Not for the SWE-bench
Pro hand-offs, which read clean under both the automated lint and a human pass.
On SDLC the driver specifies more than it should, and the lint's count understates
it. §9 is the full answer, and the raw hand-offs are committed so you can check
rather than take our word for it.

**"How do I know the driver couldn't edit files?"** — Its file tools are absent
from the process (§10), a hook denies tree-writing shell commands before they run
(§11), and the audit re-derives the same judgement afterwards using the same
function (§12). `grep -n "disallowedTools" tools/harness-matrix/runtimes.mjs` and
`grep -n "bashEditsTree" tools/harness-matrix/runtimes.mjs` show both in about
five seconds.

**"How do I know the model didn't just look up the real fix?"** — The container
is sealed at the base commit, `git-history-mining` and `source-host-fetch` are
critical audit families, `WebFetch` and `WebSearch` are removed for every cell,
and grading runs with the network blocked against the original frozen Scale image
that the agent never touched. §15.

**"Why should I trust your thresholds?"** — You shouldn't. `pnpm test` re-derives
them from 50 committed hand-offs, and the labels are in the repo for you to
disagree with. §13.2, §14.

**"Can I run this without Google Cloud?"** — Level A entirely, yes. Any live run,
no: the worker *is* Gemini on Vertex.

**"Can I run it without Docker?"** — No, for either kind. Every command a run
executes happens inside a container, and both kinds fail preflight without a
Docker daemon. `--dry-run` is the only path that does not touch Docker. §16.4.

**"Why are there policies in two directories?"** — Because they configure two
different programs. One schema, one engine, two sets of files. §8.4.

**"Is anything here going to bill my account by accident?"** — Nothing runs
without an explicit command; preflight fails before any spend if a credential is
missing; and `--dry-run` prints the whole plan without calling a model. The one real
hazard is the reverse — `GOOGLE_CLOUD_PROJECT` defaulting to our project, which
fails closed for you rather than billing you.
