# Harness Matrix — runtime × policy on the frozen SWE-bench Pro 12

Design doc for the harness study: the same frozen SWE-bench Pro instances
(seed 20260716), run through **agentic runtime CLIs** (Claude Code,
Antigravity) under **policy files** (which brain, which thinking level,
which retry ladder), with **one script-owned recipe** so every run is
procedurally identical and the numbers read directly as "which runtime,
driving which brain, resolves bugs best — at what cost".

Lives at `tools/harness-matrix/` on branch `feat/harness-matrix`, cut from
`feat/swe-bench-pro` — because this study *stems from* the Pro work: it
reuses the frozen corpus (`studies/swe-pro-corpus`), the Pro sealed-field
guards in `packages/swe-bench`, Scale's evaluator harness clone, and the
dashboard's per-instance evidence layer (Instances tab).

---

## 0. Read this first

> **CURRENT STATE — 2026-07-23 (CLI→SDK rework).** This document describes a
> **two-runtime** matrix (`claude-code` + `antigravity`) with an agy-CLI-based
> Gemini worker. That is now partly **history**. Teja parked the agy CLI
> (2026-07-21), so: (1) the `antigravity` **CLI** runtime has been **removed
> from the code** — the only wired runtime today is `claude-code`; (2) the
> delegated cc×Gemini cell's **worker moved from the agy CLI to the Antigravity
> SDK** (`gemini_worker.py`, `google-antigravity` → Vertex), which returns real
> token counts. The two Antigravity-as-harness cells (box 1 `antigravity×Claude`,
> box 3 `antigravity×Gemini`) return as an **SDK-based Antigravity harness** once
> Google's Gemini-SDK corrections land; box 1 additionally waits on **D6**
> (§2.7c). Where a section below states a two-runtime *current wiring* or an
> agy-CLI worker, read it as design intent / investigation history — this banner,
> the summary-table rows §0, the runtime list §2, and the §2.5 head hold the
> current shape. The living decision record is
> `llm-eval-lab/meeting/harness-arm-decision-2026-07-23.md`.
>
> **Update 2026-07-24:** the SDK-worker delegated cell is now proven live
> end-to-end — navidrome **resolved** by cc×Gemini-Flash-HIGH, official
> Scale verdict; a same-day repeat did not resolve (patch phase hit the
> equal-timeouts defect). Both runs, their numbers, and the sidecar
> accounting fix that preceded them are in the run log, §11.
>
> **Update 2026-07-25 — the KIND split.** The scaffold now runs TWO task
> kinds: everything Pro-specific moved verbatim from `run-harness.mjs` into
> `kinds/swepro.mjs` (dry-run byte-identical before/after), the shared
> machinery into `kinds/lib.mjs`, and a second kind landed —
> `kinds/sdlc.mjs`, the console's own `sdlc-mini` template (all eight
> stages) as a harness leg, selected by `--task-dir` and graded by the
> scaffold's build+test. §3's "one scaffold, thin adapters" architecture is
> unchanged in spirit — the kind is simply the second adapter axis next to
> the runtime. The SDLC recipe, its gates, and its honesty rules live in
> **[SDLC-RECIPE.md](SDLC-RECIPE.md)** (kept out of this document to leave
> the Pro threat model and run log undisturbed).

**If you know `ai-studies-console` and the SDLC studies, here is the one
thing that is different.** Our SDLC studies vary the *model* and hold the
runner fixed — the question is which brain writes better code. This study
inverts that: it varies the **harness** (the agentic CLI that plans,
reads, edits, and decides when it is done) and holds the brain fixed. The
question is *"does the tool wrapped around the model change the
outcome — and by how much?"*. SWE-bench Pro is the fixture that makes the
question answerable, not the subject of the study. That inversion is why
so much of this document is about procedure control: if two harnesses walk
different procedures, any difference in outcome attributes to nothing.

**Here for the Antigravity SDK findings?** If you are taking them to Google or
to Ravi, read **[GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md](GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md)** instead — it is the
standalone, shareable version: eleven defects, what each blocks, three ranked
asks, ten questions. It also carries three findings (D9–D11) and the Vertex
Model Garden lead that post-date the sections below. Otherwise, for the
investigation as it happened, go straight to **§2.7c** — the
live result and the eight defects for Google. §2.7, §2.7a and §2.7b are
earlier stages of the same investigation, kept because two of their
conclusions were later overturned by evidence; read them for how we got
there, not for the current status. §2.7c is what holds.

**Here for managed agents / the Interactions API?** Read
**[MANAGED-AGENTS.md](MANAGED-AGENTS.md)** — what they are, the $0 probe
proving the Antigravity managed agent is reachable on our project, and why it
still cannot host this matrix. **§2.8** is the short version in situ. For
whether we are covering everything Google asked for on the 2026-07-20 call, the
ledger is **[GOOGLE-CALL-COVERAGE.md](GOOGLE-CALL-COVERAGE.md)**.

**Suggested reading order:**

1. **§1** — the lineage. What was tried before this and why it was dropped.
2. **§2.2** — the starting policies. This is the shortest path to "what
   are we actually running".
3. **§0's ledger below** — the decisions, so you can skip to whichever
   one you want to challenge.
4. **§3** and **§4** — the architecture and the three-phase recipe spine.
5. **§2.7–§2.7c** — the Antigravity SDK: Google's ask, what the SDK
   measures better than the CLI, and why the Claude cell still stays on
   the CLI. Read in order; each subsection supersedes part of the one
   before it. Then **§2.8** — the managed-agent route, probed, and why it
   is a fourth Gemini-only surface rather than a way out.
6. **§6** only when you need the code. It is written so that a reader who
   lost the code could rebuild it, which makes it long by design.

**There are two branches, and only one is alive:**

| Branch | Directory | Status |
|---|---|---|
| `feat/harness-matrix` | `tools/harness-matrix/` | **Current.** This document, this design. |
| `feat/claude-code-rig` | `tools/claude-code-rig/` | **Superseded but kept.** The Setup 1 rig, with its own `SETUP1_DESIGN.md`. Read only if you want the evidence behind §1.1's decision to discard it. It is not merged into this branch and no code from it is reused. |

**The decision ledger.** Every load-bearing choice made so far, with
where the reasoning lives. Verdicts are dated because several were
reversed by evidence, and a reversal is worth more than a clean story:

| Decision | Verdict | Why, in one line | Where |
|---|---|---|---|
| Agent installed **inside** the sealed container (Setup 1 rig) | **Discarded** 2026-07-20 | Measured once: timed out at 45.3 min, unresolved, and an in-image agent can never generalize across runtimes | §1.1 |
| Agent on the **host**, container executes repo commands only | **Adopted** | One sealed image serves every runtime; no credential-bearing layer inside the artifact | §3 |
| Free-roam agentic run | **Discarded** | Nothing can check "did you reproduce before patching?"; G4 showed 5 of 8 misses never tested before submit | §1.1, §4 |
| **Script-owned** three-phase recipe (REPRO → LOCALIZE → PATCH) with gates | **Adopted** | The only way runtime-vs-runtime is a fair comparison is if the procedure is identical and owned by neither runtime | §4 |
| `ANTHROPIC_BASE_URL` → translating gateway (LiteLLM-style) | **Rejected** | Our translation layer would become what the study measures | §2.5 |
| Passthrough **telemetry** gateway to capture tokens uniformly | **Rejected on evidence** 2026-07-21 | CLI has no base-URL override; the only route left was MITM against a Google enterprise seat; and it would not have worked anyway | §2.5 |
| Interactions API / managed agents | **Rejected for the matrix, adopted as a lead elsewhere** — verified 2026-07-21 | Confirmed by probe, not inference: it is reachable on our project with plain ADC and no install, but the agent is Gemini-Flash-only and `environment` has no local option, so it cannot host our sealed workdir. Valuable for the orchestrator repo instead | §2.8, [MANAGED-AGENTS.md](MANAGED-AGENTS.md) |
| Reading agy's own local trajectory store | **Adopted, shipped** 2026-07-21 | The "agy is a blind cell" premise was simply false — it persists everything locally | §6.2a |
| `agy` **CLI** as the Antigravity runtime | **Removed 2026-07-23** | Worked and produced the first smoke, but Teja parked the CLI 2026-07-21 (Google asked for the SDK on InfoSec grounds); the `antigravity` runtime is out of the code, to return as an SDK harness | §0 banner, §2.7 |
| Antigravity **SDK** as the Gemini worker/harness | **Adopted for Gemini 2026-07-23; Claude blocked** | Probe passed on measurement (real token counts, working thinking knob, Vertex on our project, headless autonomy), so the delegated cell's **Gemini worker now runs on the SDK** (`gemini_worker.py`) and the box-3 harness will reuse the same cable. The **Claude** side stays blocked — run live, the SDK completes one turn then breaks, returning tool results as `assistant` messages instead of `role:"tool"` (D6); auth is *not* the blocker (a localhost header proxy closed that), conversation shape is. §2.7c holds; §2.7–§2.7a are earlier superseded stages | §2.7c (current), §2.7–§2.7b (how we got there) |

**The two things most likely to trip you up:** costs recorded as `null`
mean *not measurable*, never *zero compute* (§2.6); and the delegated
cell is two-model by construction and is never reported as a clean Gemini
result (§2.5).

---

## 1. Lineage — what was tried before, and why this design is different

| | What it is | Loop owner | Result |
|---|---|---|---|
| **Setup 0 (G4)** | Our Node pipeline (`packages/swe-bench`, opus-plus-flash), model calls from outside the container | Script | **4/12, $3.18 total, $0.795/resolved** |
| **Setup 1 rig** | Claude Code CLI installed INSIDE the sealed instance container, one free-roam agentic run per instance | Runtime | Rehearsal on vuls: **unresolved** |
| **Harness matrix** (this doc) | Recipe spine drives any runtime CLI on the host through identical phases | Script | to be measured |

Naming, decoded once because both schemes recur through this doc:
**"Setup N"** numbers the execution *designs* in the order they were
tried — Setup 0 ran no agent anywhere (a script pipeline calling models
from outside the container), Setup 1 put an agent inside the container,
and this matrix is the third design, named for what it is rather than
numbered. **"G4"** is a run *generation* of Setup 0: attempts at the
frozen 12 carried generation numbers, and G3 is the attempt that died
mid-run to an openlibrary clone flake plus an element-web OOM on the
8 GB host — the incident behind the Docker VM resource caps cited later
as "the G3 OOM rule". G4 is its clean relaunch (seed 20260716); the
numbers in the table above are G4's.

### 1.1 The Setup 1 rig — tried, measured, discarded

The rig lives on branch `feat/claude-code-rig` (design record:
`tools/claude-code-rig/SETUP1_DESIGN.md` on that branch). **It is not
carried into this branch** — the design was discarded after its first
measured run. What it showed (Phase B rehearsal, 2026-07-20, on
`future-architect__vuls…`, an instance the G4 pipeline resolves for $0.335):

```
exit 124 (timeout) | 45.3 min | turns ? | cost $? | model claude-opus-4-8
grade-verdict.json → resolved: false        (wallet-modeled ~$1.51)
```

The limitations, each of which shapes this design:

1. **No mid-flight structure or visibility.** One 40-turn free-roam under a
   45-min clock; when the timeout killed it, the CLI's final result event
   never flushed, so turns and cost read `?`. Nothing could check "did you
   reproduce the bug before patching?" → here, the script owns the phase
   boundaries and gates.
2. **Free-roam lost where the recipe won, on the same instance.** Repeats
   the G4 lesson (5 of 8 misses were single-attempt, never tested before
   submit) → here, test-before-submit is a *gate*, not a suggestion.
3. **In-container agents don't generalize across runtimes.** Installing
   agents into the sweap images was painful for Claude Code, and on this
   Mac `agy` is a Homebrew cask requiring macOS ≥ 12, so it cannot be
   installed into a Linux image at all. *(Correction, 2026-07-21: the cask
   is only the macOS distribution channel — Antigravity does publish a
   Linux installer with a headless one-time-code auth flow. So this is a
   packaging obstacle, not an impossibility. The decision stands on its
   own merits: an in-image agent must be installed and separately
   authenticated per instance image, adds a credential-bearing layer to a
   sealed artifact, and would have to be redone for every new runtime.)*
   → here, runtimes run on the host; the container is for executing repo
   commands, not for hosting agents.
4. **Two free-roaming loops don't compare.** Runtime-vs-runtime is only
   valid if the procedure is identical → here, one scaffold, thin adapters.
5. **Cost bounded but not shaped** ($2 cap, no per-step budget) → here,
   per-phase budgets and timeouts.

What carries over from the rig is *knowledge*, not code: the git-history
seal recipe, the image-tag formula, musl/Rosetta gotchas, the
`--add-host` null list, the "run as shipped, don't straw-man the CLI"
principle. The tooling here is written fresh in this directory.

### 1.2 What this branch inherits from `feat/swe-bench-pro` (real reuse)

- `studies/swe-pro-corpus/` — the frozen 12 (`instance.json` +
  `sealed.json` per instance) and Scale's evaluator clone under
  `.harness/SWE-bench_Pro-os/` (pinned `ca10a60a`), plus `.venv-swe-pro`.
- `packages/swe-bench/dist/integrity.js` — `validateInstance` with the
  Pro sealed fields (this branch has the lowercase-Pro SEALED_FIELDS;
  main does not — one more reason to stem from here).
- The dashboard's Instances tab (`apps/dashboard/src/views/
  StudyInstances.tsx`) and its `instances.json` schema — the base for the
  Compare Runs view (§8).

### 1.3 What Google asked (the 2026-07-16 email) — and which cell answers it

This study is a direct response to the Google technical-ask email (Pranav
Mehrotra, relaying Lex & Sanjit; also walked through on the Ravi call
2026-07-16 and the AI Connect meeting 2026-07-20). The asks that touch
this study, in the email's own words:

> "Run the orchestration combinations using —
> a) **Antigravity as a Harness and Claude as one of the models within
> Antigravity**,
> b) **Claude Code as Harness and when it calls Gemini it should call
> Gemini + Antigravity together either using Skills or CLI commands**"

plus the riders: run on pre-existing benchmarks (SWE-bench Pro is ours),
document model + thinking level → task-type fitness (ask 4), and share
the multi-harness code "(Claude Code ↔ Antigravity) or (Antigravity ↔
Gemini and Claude Models)" (ask 5).

How the matrix cells map:

| Cell | What it is | Google-ask role |
|---|---|---|
| antigravity × all-opus | Claude inside Google's harness | **Ask 3a, verbatim** — the deliverable cross |
| claude-code × all-opus | Same Opus at home | The control that makes 3a's number readable (Ravi: "how does it fare with just using Opus on Claude Code… it might speak about the harness itself") |
| antigravity × all-gemini-flash-high | Gemini at home | Baseline for the other direction + ask-4 model-fitness rows |
| claude-code × all-gemini-flash-high | Gemini called from Claude Code **through Antigravity** (delegated, §2.5) | **Ask 3b, verbatim** — "using Skills or CLI" is literally how the cell is wired |

One composition note, stated so nobody over-claims: the email's phrase
"the orchestration combinations" refers back to ask 2 (Opus/Pro planning
+ Flash execution with escalation). The full ask is therefore mixed
policies *inside* these harnesses. Our single-model policies are the
controlled first rung — per-phase model entries (§2.4) mean an
`opus-plus-flash` harness policy mirroring G4's recipe is one YAML file
away once the single-model baselines exist.

Comparison discipline that follows from the mapping: only single-variable
pairs are read as findings (same model across harnesses, or same harness
across models). The two crosses are never set against each other — both
model AND harness would differ, so the gap would attribute to nothing.

---

## 2. The run = runtime × policy

A **run** is: one runtime, one policy file, over the frozen instance set —
**all 12, seed 20260716, the same set for every run being compared.**

The instance count is not a dial to turn when a run feels slow. The
comparison is *paired*: the same instances are put to every cell, and the
signal is the set of instances where two cells **disagree** — one resolves,
the other does not. G4 resolved 4/12 on this corpus, so at that base rate a
pair of cells might disagree on three or four instances out of twelve; at
n=5 the expected number of disagreements is about one, and a single
instance flipping is indistinguishable from chance.

Stated plainly so it is not oversold in the other direction: **12 is not a
statistical-significance claim either.** Three or four discordant pairs
will not clear a significance bar, and the report must not pretend
otherwise. The study's output is descriptive — resolved counts, cost where
measurable, wall time, per-phase retry heat maps, and the failure modes
visible in the trajectories. 12 is held because it is the frozen set G4
already ran (making the numbers directly comparable to a shipped result)
and because below roughly ten the description stops being readable even
directionally.

- **Runtime** — which agentic CLI drives the phases:
  - `claude-code` — Claude Code CLI, headless `claude -p` (**the only wired
    runtime as of 2026-07-23**; in the delegated form it also drives a Gemini
    worker through the Antigravity SDK — §2.5)
  - ~~`antigravity` — Antigravity CLI, headless `agy -p`~~ — **removed
    2026-07-23** (agy CLI parked). Returns as an SDK-based Antigravity harness
    once Google's Gemini-SDK corrections land; `--runtime antigravity` currently
    exits with a usage error.
- **Policy** — a YAML file (`version` / `name` / `models` / `rules` /
  `retry` / `limits`) that pins which model handles each stage, through
  which adapter and API, at what thinking level, and what the retry ladder
  is. **Since 2026-07-29 the harness and the console share ONE schema and one
  loader** (`packages/policy/core/policy-core.mjs`); the harness's four files
  are `version: 2`, the same version the console's 19 template policies use.
  See §2.4a for the unification, what it closed, and how legacy snapshots
  still load.
  - A `models[]` entry is either a **leaf** — one model × adapter × API
    combination, with its own id — or a **composition** (`solo` /
    `delegated`) that names leaves as its `driver`/`worker` and pins the
    `runtime` it may run on. A composition is the harness's "cell": asking
    for a runtime no composition declares fails preflight, before any spend,
    exactly as an absent binding did under the old schema.
  - `rules[]` maps stage → model id, `when`-first with a `default`
    fallback. It is the console's matcher, unchanged.

### 2.1 Models actually available (verified)

Written in the unified schema (§2.4a). Each row is a **leaf** `models[]` entry
— one model × adapter × API, with its own id — and the cells that combine two
of them are the compositions in the third column.

| Model | leaf entry (`adapter` / `api` / `model_name` / `region`) | how a cell reaches it |
|---|---|---|
| Opus 4.6 | `opus-anthropic` — `builtin-anthropic` / `anthropic` / `claude-opus-4-6`, `reasoning.effort: high` | `solo` composition (`all-opus`), or the `driver` of every delegated cell |
| Sonnet 4.6 | *(no leaf authored — same shape, `model_name: claude-sonnet-4-6`)* | would be a second `solo` composition |
| Gemini 3.5 Flash | `flash-35-agsdk-vertex` — `antigravity-sdk` / `vertex` / `gemini-3.5-flash` / `asia-south1`, `reasoning.tier: high` | `worker` of a `delegated` composition (§2.5) |
| Gemini 2.5 Flash | `flash-25-agsdk-vertex` — `antigravity-sdk` / `vertex` / `gemini-2.5-flash` / `asia-south1`, **no `reasoning:` block**, see below | `worker` of a `delegated` composition |
| Gemini 3.1 / 3.5 Pro | *(no leaf — 3.5 Pro is not entitled to this project in any region tried, see `all-gemini-25-flash-high.yaml`)* | — |

`region` is **required** whenever `api: vertex`, and the loader rejects the
file without it: an unpinned region falls back to the shared `global`
endpoint, which starved this project for 3+ hours on 2026-07-16 and killed
two Pro runs at ~$1.78 each mid-patch.

The **`antigravity` runtime** was removed 2026-07-23 (agy CLI parked) and its
inert bindings were dropped from all four policy files in the 2026-07-29
migration rather than converted — nothing could reach them, since
`run-harness.mjs` validates `--runtime` against the `RUNTIMES` registry and
exits before a policy file is opened. Recorded for history: agy's Claude
shipped only as `Claude Opus 4.6 (Thinking)` with no level knob, stamped
`product-internal` in every manifest of that era; what that level actually is
was asked on the Google thread and is still unanswered.

**`thinking_level` is a 3.5-only knob.** Vertex hard-rejects it on
`gemini-2.5-flash` — verbatim, through the SDK: `AntigravityConnectionError:
Agent execution terminated due to error. ("request failed (code 400): Unable to
submit request because thinking_level is not supported by this model..")`. So
the 2.5 policies omit the key entirely and the worker runs at the model's own
default, which the harness renders as `worker thinking NONE` and the sidecar
records as `thinking=NONE`. The consequence for study design is stated rather
than buried: a 3.5-vs-2.5 column pair is **not** a single-variable A/B. Two
things differ — the worker generation, and a thinking level the platform does
not permit us to hold constant. The tier split itself (which stage gets which
worker) *is* exact and is what the comparison rests on.
| GPT-OSS 120B | — | `GPT-OSS 120B (Medium)` |

Two facts that decide the pins:

- **Antigravity's Claude ceiling is Opus 4.6**, and it ships ONLY as
  `(Thinking)` — there is no thinking-level knob on agy's Claude models.
  So for a fair runtime-vs-runtime comparison, Claude Code pins
  `claude-opus-4-6` too (NOT the CLI default — the rig rehearsal drifted
  to opus-4-8, which would have poisoned the comparison).
- **Thinking parity is pinned wherever a knob exists** (verified
  2026-07-21): Claude Code 2.1.215 has `--effort <level>` — pinned to
  `high` explicitly (the Opus 4.6 API default, but pinning beats trusting
  a default that could drift). Agy's Gemini levels are in the model name —
  pinned `High`. The ONE thing that cannot be matched: agy's Claude models
  ship only as `(Thinking)` with no level knob and no disclosure of the
  internal setting. Both sides' settings go into every manifest, and the
  report states the agy-Claude level as product-internal — a recorded
  asymmetry, not a hidden one. *(Scope, 2026-07-21: this is a statement
  about the **CLI**. The Antigravity SDK does expose a five-step
  `ThinkingLevel` — but documented for Gemini models only, and the SDK
  reaches no Claude model at all, so the Claude-side asymmetry stands
  either way. §2.7.)* *(Explanation found, 2026-07-21: the reason there is
  no Claude thinking knob is that thinking is not a parameter on this
  engine — it is a separate model identity. `MODEL_CLAUDE_4_OPUS` and
  `MODEL_CLAUDE_4_OPUS_THINKING` are distinct enum values, as are the
  Sonnet and Haiku pairs. There is no knob to expose; you select a
  different model. §2.7a.)* Verified there is no hidden knob in the CLI — every
  avenue was tried (2026-07-21): no thinking/effort flag in `agy --help`
  or any subcommand; `settings.json` holds only trusted workspaces; no
  IDE-side config dir exists; the binary's own strings show thinking
  level is an internal `ReasoningEffort` enum welded to each model
  variant (`gemini-3.1-pro-low-thinking`-style ids) with exactly one
  compiled-in Claude variant; and live probes with fabricated
  `"Claude Opus 4.6 (High)"` / `"Claude Opus 4.6"` strings are rejected
  (server returns the valid-model list). **Open question for the Google
  thread** (this study is one of their asks): what level does agy pin
  internally for Claude models? If they answer, the manifests get
  annotated retroactively and the asymmetry closes.

### 2.2 Starting policies (the answer to "what do we start with")

**`all-opus` — the anchor policy, run first on both runtimes.**
Strongest available brain on both sides, same model both sides, thinking
on both sides (agy's Opus is Thinking-only; Claude Code's Opus is
adaptive). SWE-bench Pro is hard (frontier models 40–50%s on Scale's
board) — starting with the best brain separates "runtime can't drive" from
"brain can't solve". It also anchors directly against G4's Opus-heavy
baseline.

**`all-gemini-flash-high` — the second policy.** Gemini 3.5 Flash at
**High** thinking. High, not Low/Medium, because: (a) Pro is hard and G4
already showed Flash needing Opus rescues at low effort; (b) on the agy
seat the marginal *dollar* cost of High is $0 — but "free" is not
"unbounded": the seat is metered by an invisible quota (§2.6), and it is
**unknown** whether a higher thinking level draws more of it, because the
unit of consumption is undocumented and cannot be queried; (c) "Flash at its best thinking" is the honest version of
the Google-facing question "how far does Flash get in a harness". Flash
over 3.1 Pro as the second policy because Flash is the G4-comparable
model and the Vertex gateway serves 3.5 Flash (so a future
claude-code×gemini run compares like-for-like). `all-gemini-pro-high` is
a later policy file, zero code change.

The initial run grid (order of execution in §9):

| run | runtime | policy | seat/wallet |
|---|---|---|---|
| 1 | antigravity | all-opus | $0 seat — **quota-limited, §2.6** |
| 2 | antigravity | all-gemini-flash-high | $0 seat — **quota-limited, §2.6** |
| 3 | claude-code | all-opus | Max modeled (gated on go); the only cell with no agy dependency |
| 4 | claude-code | all-gemini-flash-high (delegated, §2.5) | driver Max-modeled + worker on the **quota-limited** $0 seat (**gated on go**, after runs 1–3 + its own smoke) |

"$0 seat" throughout this document means *no dollars are charged*. It never
means unmetered: three of these four runs draw on one rationed seat whose
remaining balance cannot be queried (§2.6).

### 2.3 Retries: in the policy, flat first

Retry policy is part of the policy file, because "does the policy have
retry escalation" is itself a study variable. The taxonomy:

1. **flat** — same model, same thinking; gate-failure reason fed back.
2. **thinking-ladder** — same model, thinking escalates per retry
   (native on agy: the level is in the model name).
3. **model-ladder** — escalate within a family (flash → pro).
4. **cross-model** — diversity, not capacity (Gemini fails → Claude).

**This study runs flat, max 3 attempts per phase** (1 initial + 2
retries). Ladders are follow-up policy files, and this study's per-phase
retry heat map is the data that says *where* a ladder would pay. Encoding:

```yaml
retry:
  type: flat            # flat | thinking-ladder | model-ladder | cross-model
  max_attempts: 3       # per phase, counting the first attempt
  # ladder: [flash-low, flash-med, flash-high]   # for ladder types later
```

**What a retry is for, and what must never consume one.** The retry budget
exists for exactly one situation: the runtime produced work and the work
failed a *gate*. Feeding that gate's reason back and letting the model try
again is the study's stated mechanism, and each such attempt is real
evidence about the runtime.

An **infrastructure failure is categorically different** and must abort the
phase and the run instead: quota exhaustion (§2.6), auth/token expiry, or a
missing binary. These cannot be fixed by trying again — the outcome is
identical by construction — and retrying them does active harm twice over.
It burns the budget that a genuine gate failure would have needed, and it
writes phantom attempts into the manifest, so `attempts: 4` reads as four
model attempts when only two involved a model at all. The first smoke did
exactly this (§2.6). Attempt counts are a headline number of this study —
the per-phase retry heat map that decides which ladder gets tried next
(§9) — so an inflated count is not a cosmetic bug but a corrupted result.

### 2.4 Example policy file (`policies/all-opus.yaml`)

```yaml
# all-opus — anchor policy: strongest brain the runtime can drive, pinned to
# Antigravity's Claude ceiling (Opus 4.6). Claude Code must NOT float to its
# newer default. (The file itself carries the full migration essay, §2.4a.)
version: 2
name: all-opus
models:
  # The CELL — a composition. Its id is what the resolver returns as `modelId`
  # and what every manifest, audit record and export stamps.
  - id: opus
    composition: solo         # solo | delegated
    runtime: claude-code      # the gate: another runtime fails preflight
    driver: opus-anthropic
  # The model × adapter × API combination it names.
  - id: opus-anthropic
    adapter: builtin-anthropic  # the `claude` CLI talks to Anthropic itself
    api: anthropic
    model_name: claude-opus-4-6 # the pin — must not float (§2.1)
    reasoning:
      effort: high              # passed as --effort high, stamped in manifest
    # No `pricing:` — reachable only as a composition member (§2.4a).
    # No `region:` — the anthropic api has no region axis.
rules:
  - when: { phase: [repro, localize, patch] }
    use: opus
    reason: SWE-bench Pro phases — anchor cell, one model throughout
  - default: opus
    reason: unrecognised stage — anchor cell routes everything to the same model
retry:
  type: flat
  max_attempts: 3
limits:
  phase_timeout_min: 45   # per runtime invocation (one phase attempt)
  cmd_timeout_min: 15     # per run-in-env.sh container command (gates + agent)
  phase_budget_usd: 8.00  # claude-code cells only; agy has no budget knob
```

Per-stage rules mean mixed policies (e.g. `opus-localize` + `flash-patch`,
mirroring G4's split) are also just policy files. So is a **tiered** policy —
`gemini35-plus-25-flash-high.yaml` routes `execute` to a cost-efficient cell
and every other stage to a premium one, using nothing but extra `rules[]`
entries over two compositions that share one driver leaf.

### 2.4a One schema, one loader (2026-07-29)

Until this date the repo had two policy layers doing the same job in different
words. The console's (`templates/policies/*.yaml`, 19 files) said WHICH model
**and how it is reached** — `adapter` + `api`. The harness's (these four files)
said only WHICH model; the adapter and the API were hardcoded in
`runtimes.mjs`. So `worker: gemini-3.5-flash` was reached through the
Antigravity SDK against Vertex AI, and **no policy file said so** — meaning the
frozen `policy_snapshot.yaml` inside every recorded run did not record the
cable the run actually used. That is the same provenance hole
`packages/policy/src/types.ts` documents for the console, left open on the one
surface where the Antigravity SDK actually runs.

Ravi's 2026-07-28 instruction closed it: *"integrate the SDLC policy &
Antigravity SDK into ONE policy and rollout code"*, *"applicable to all the
policies"*, with `opus-plus-flash.yaml` as the reference that *"shouldn't lose
its structural strength (in terms of rules and models abstraction), rather
should be extended to support model + adapter combinations (each having its own
id)"*.

**What changed, mechanically:**

| legacy harness shape | unified shape |
|---|---|
| `models[].bindings{runtime → …}` | a **composition** entry naming other `models[]` entries as `driver`/`worker`, with its own `runtime` pin |
| `models[].thinking{runtime → …}` | `reasoning.effort` on the driver leaf, `reasoning.tier` on the worker leaf |
| `phases{stage → id}` | `rules[]` — the console's matcher, `when`-first with a `default` |

The engine is `packages/policy/core/policy-core.mjs`, imported by BOTH
`packages/policy/src/loader.ts` (console) and `kinds/lib.mjs` (harness). The
harness's resolved shape is unchanged — `{raw, resolved: {stage: {modelId,
binding, thinking}}, maxAttempts, limits}` — with one **added** field, `cable`,
carrying `{declared, driver: {model_name, adapter, api, region}, worker: {…}}`.

**Three properties worth naming.**

1. **The composition id is the old model id, deliberately** — `opus`,
   `flash-high`, `flash-25-high`, `flash-35-high`. That string is what the
   resolver returns as `modelId` and what every recorded manifest already
   carries; renaming it would re-base recorded runs against a name they never
   used. Only the new leaf entries got new names.
2. **Pricing is exempt for composition members, and only for them.** A leaf a
   rule names *directly* is a routing target and must carry `pricing`; a leaf
   reachable only as a `driver`/`worker` may omit it. That exists for this
   exact case — `claude-opus-4-6` has no row in `@study-console/pricing`, and
   the harness prices a run from the driver's real cost receipts and the
   worker's real `UsageMetadata` sidecars, never from the policy. Writing an
   invented price to satisfy a validator is the failure the pricing-preflight
   rule exists to prevent, so the schema permits the omission instead of
   inviting the lie. Present-but-malformed pricing is still rejected.
3. **Legacy snapshots still load, and are never rewritten.** Every
   `policy_snapshot.yaml` already frozen inside a recorded run — including the
   ones inside evidence bundles already handed to Google — is the legacy shape.
   The loader detects it by a top-level `phases` key and resolves it through a
   verbatim port of the pre-unification logic
   (`policy-core.mjs → resolveLegacyHarnessStages`), stamping
   `cable.declared: false` with the values `runtimes.mjs` used to imply. So a
   migrated run and a replayed legacy run **agree** about the cable rather than
   disagreeing about it.

**Verified behaviour-preserving before the migration was kept:** all four
policies × both stage vocabularies were resolved through the new loader and
diffed against a pre-migration baseline. Every stage resolves to an identical
`{modelId, binding, thinking}`, with identical `maxAttempts` and `limits`. The
only difference is the intended one — `cable.declared` flips `false → true`,
with the route now read out of the file instead of guessed from a table.

**What the schema can now express but the harness does not yet honour:**
`rules[]` brings the whole console matcher, including `retry_count` — so the
console's escalation rule (`debug, retry_count: {gte: 2} → opus`) would
validate. It is deliberately NOT written into any harness file, because
`resolveHarnessStages` resolves every stage exactly once, before the run, at
`retry_count: 0`, and each retry re-uses that one resolved binding. The rule
would read as though it escalates and never would. Wiring it means resolving
per **attempt** rather than per stage — a real change to the execution loop,
tracked separately. Likewise `select:` slots are now available here, but no
harness file uses one: `gemini_worker.py` speaks the Antigravity SDK and only
the Antigravity SDK, so an `mcp` option would pass validation and then fail at
the first delegation — exactly the failure class this schema change exists to
end.

**The two timeouts are nested, and must not be equal.** `phase_timeout_min`
bounds one whole runtime invocation; `cmd_timeout_min` bounds a single
container command *inside* it. The agent typically runs several commands
per phase (build, test, re-test after an edit), so the phase budget has to
leave room for the agent to think between them and to recover when one
command misbehaves.

Setting them equal — which both shipped policies did until 2026-07-25, both
at 10 — means **one hung command consumes the entire phase**, leaving the
model zero clock to react. This is not hypothetical: in the first smoke
(§10) the model hit a hanging `--ginkgo.focus` invocation, correctly
diagnosed it, and was midway through rewriting the test when the phase
timeout killed it. The phase failed for lack of runway, not for lack of
capability, and a naive reading of that manifest would score it as a
runtime failure. The invariant is `cmd_timeout_min` materially less than
`phase_timeout_min`.

**FIXED 2026-07-25.** Both policy files moved together in one commit —
phase `10 → 45`, cmd `10 → 15`, budget `0.75 → 8.00` — restoring the
invariant at a 1:3 ratio. The ceiling rise is separate from the nesting fix
and has its own reason: 10 minutes never covered the real work (the §10
smoke's REPRO legitimately needed 1002 s, already over it), and the SDLC
kind's EXECUTE stage is strictly larger than any Pro phase because it
authors the whole delivery across several worker delegations inside ONE
runtime invocation. At 45 the timeout is a hang detector rather than a work
limit.

Two consequences worth stating plainly. First, this is a study-definition
change, so it obeys the rule above: applied to all cells at once, before
any further cell runs, never mid-matrix. Second, the two Pro harness runs
already on the dashboard (`2407-0932`, `2407-1117`) were produced under the
old limits; every run ships its own `policy_snapshot.yaml`, so the
difference is visible per run rather than silently averaged, and Pro should
be re-run under the new limits before it is compared against any new cell.

> **That guarantee held for Pro and failed for SDLC until 2026-07-26.** The two
> runners record `policy.file` against **different bases** — the Pro runner
> writes it repo-root-relative (`tools/harness-matrix/policies/x.yaml`), the
> SDLC runner writes it harness-relative (`policies/x.yaml`) — and the exporter
> resolved it with a bare `join(ROOT, …)`. So Pro columns always got the real
> file and SDLC columns always got a `# policy file not found at export time`
> stub, which the Implementation Approach tab renders as an empty policy block.
> The exporter now resolves through `resolveHarnessPath()` (harness dir → repo
> root → absolute), which accepts both bases; the runners are left as they are
> so old manifests keep working. Both SDLC columns have been re-exported and
> carry their real policy. A miss now prints a `WARNING` line instead of
> passing silently, and `export-dashboard.test.mjs` pins the file's *content*
> rather than merely its existence — the weak assertion is what let this live.

### 2.5 The delegated cell — cc×gemini through Antigravity (Google ask 3b)

> **Mechanism update — 2026-07-23.** The worker cable below was originally the
> **agy CLI invoked from a Skill** (the "Chosen" row in the table). Teja parked
> the agy CLI 2026-07-21, so the worker now runs on the **Antigravity SDK**
> (`gemini_worker.py`, `google-antigravity` → Vertex). The *architecture* is
> unchanged — an Anthropic driver delegates all substantive work to a Gemini
> worker through Antigravity, and the driver still shells out once per task and
> reads the reply on stdout — but the transport, the auth (ADC on our paid
> project, not the $0 seat) and the telemetry (real `UsageMetadata` token
> counts, not "no usage numbers") all changed. Read the CLI mechanics below as
> the origin; the SDK worker is documented in `gemini_worker.py`'s header.

**The problem.** Claude Code's driver seat is welded to Anthropic:
`claude` has no non-Anthropic `--model`, so "Gemini in Claude Code"
cannot mean a driver swap the way "Claude in Antigravity" does (agy's
model picker genuinely swaps the driver brain — that's why cross 1 is a
true single-model cell and this one can't be). Someone has to connect
Claude Code to Gemini, and *how* determines what the cell measures.

**Paths considered (researched 2026-07-21, all surfaces checked):**

| Cable | Verdict | Why |
|---|---|---|
| ANTHROPIC_BASE_URL → translation proxy (LiteLLM-style, or the SDLC repo's gateway/adapters) | **Rejected** | A Tilicho translation layer becomes what the cell measures — the codex-port lesson exactly. And the email itself forecloses it: Gemini must be called "**+ Antigravity together**". |
| Passthrough **telemetry** gateway (LiteLLM as a pure logging proxy in front of *both* runtimes, translating nothing, purely to capture tokens/cost uniformly) | **Rejected on evidence 2026-07-21** | A different idea from the row above and worth separating: it would have closed agy's cost and pin blindness. It fails on three checked facts. (1) **The `agy` CLI** has **no base-URL override** — nothing in `agy --help`, no configuration env var in the binary, endpoints (`cloudcode-pa.googleapis.com`) compiled in. *(Scope correction, 2026-07-21: this finding is about the CLI and only the CLI. The Antigravity **SDK** does expose `ModelEndpoint.base_url` and `http_headers` — see §2.7. The gateway stays rejected regardless, because the SDK reports usage natively and a proxy would add a hop to capture what the API already returns.)* (2) The only remaining route is a MITM proxy with our own CA against an authenticated Google enterprise seat — not acceptable inside a partnership study. (3) It would not even deliver: agy serves Claude through `API_PROVIDER_ANTHROPIC_VERTEX` **server-side**, so a proxy on this host sees a Google RPC envelope, never the Anthropic request — the thinking level we actually want is not on this wire at all. Superseded anyway by the local trajectory store (§6.2a), which gives more with no ToS exposure. |
| Antigravity SDK (`pip install google-antigravity` — Python control plane over a bundled Go harness, WebSockets) | **Not this cable, but now the requested harness** | For *this* cable it still loses: no Claude support (verified — zero `anthropic` references anywhere in the SDK's Python surface), so it cannot be the Gemini worker under an Opus driver without changing what the cell measures. But its status changed on 2026-07-20: Google **asked for the SDK by name** as the harness path, on enterprise-InfoSec grounds rather than technical ones, and it answers most of this document's open measurement gaps. That is large enough to be its own section — **§2.7**. |
| Interactions API (managed agent `antigravity-preview-05-2026`) | **Rejected for the matrix** | Runs in Google's REMOTE sandbox ($0.25–$5/interaction) — it cannot host our sealed instance containers, so procedure parity dies. Client-facing footnote only. |
| **agy CLI invoked from a Claude Code Skill** | **Chosen 2026-07-21, superseded 2026-07-23** | The email's own words ("using Skills or CLI commands") hit both halves of this wiring, and it made the first delegated build. Superseded when Teja parked the agy CLI: the same Skill-delegation shape now shells out to the **SDK worker** (`gemini_worker.py`) instead of `agy -p`. Still Google's product making every Gemini call (Vertex via ADC now), zero Tilicho code in any model's traffic. |
| **Antigravity SDK worker invoked from a Claude Code Skill** | **In force 2026-07-23** | The Skill delegates to `gemini_worker.py` (`google-antigravity` → Vertex). Same architecture as the row above; adds real token counts (`UsageMetadata`) and moves off the rationed $0 seat onto our paid project's ADC. |

**Mechanics** (`runtimes.mjs`, delegated branch of the claude-code
adapter):

- The policy declares a `composition: delegated` cell naming two leaves —
  `driver: opus-anthropic` (`builtin-anthropic`/`anthropic`/`claude-opus-4-6`,
  `reasoning.effort: high`) and `worker: flash-35-agsdk-vertex`
  (`antigravity-sdk`/`vertex`/`gemini-3.5-flash`/`asia-south1`,
  `reasoning.tier: high`). The driver is the same Opus 4.6 pin as `all-opus`
  (one pin, no float) with `--effort high` parity preserved. Since 2026-07-29
  the adapter and the API are **stated in the file** rather than implied by
  `runtimes.mjs` (§2.4a).
  The loader still hands `runtimes.mjs` the same resolved binding it always
  did — `{driver, worker, worker_thinking?}`, both values **model names**, with
  `worker_thinking` upper-cased to the SDK's `ThinkingLevel` — so nothing
  downstream changed.
  `worker_thinking` is **optional and omitted** (not nulled) when the worker
  leaf declares no `reasoning.tier`: that is the `gemini-2.5-flash` case, which
  Vertex 400s on the key (§2.1), and `audit.mjs` reads an absent key as `NONE`.
  **`worker` alone decides whether a binding is delegated** — nothing
  downstream may key off the thinking level to make that judgement, or dropping
  the key would silently reclassify a delegated stage as a solo one in the
  header, the manifest, and the audit.
- A cell may be pinned **per stage** via `rules[]`, so one policy can run
  3.5-flash on requirements/design/plan-packets/review/security_review/judge
  and 2.5-flash on execute. That is what makes the tiered column possible, and
  what forces the audit's policy check to resolve expectations *per phase*
  rather than run-wide.
- A `gemini-worker` Skill is provisioned per run in a private
  `CLAUDE_CONFIG_DIR` under `out/` — **never in the workdir**, which is
  the diff anchor (the gates fail any undeclared file; a `.claude/` dir
  in the repo would poison every phase). The skill mandates delegation
  of all substantive work and quotes the exact `gemini_worker.py …
  --model "<worker>" --workdir … --out-dir …` command with this run's
  paths and timeout.
- **The driver has no file-editing tools.** In the delegated branch
  `--disallowedTools` removes `Edit`/`Write`/`NotebookEdit`/`MultiEdit`
  on top of the always-closed `WebFetch`/`WebSearch`/`Task`, so the only
  way the repository can change is the worker. The driver writes its
  phase contract files (`repro.json`/`localize.json`) with a Bash
  heredoc (it has no Write tool); it may read/search/test the repo
  **only after** the attempt's first delegation (see the guard below).
- **A PreToolUse delegation guard closes the channels the removed tools
  leave open.** Stripping `Edit`/`Write` still leaves `cat > file`,
  `sed -i`, `git apply` reachable through Bash — and the write ban alone
  still lets the *analysis* migrate into read-space (2026-07-24 smoke:
  the driver read the bug's sources and ran the test suite itself before
  delegating a rubber-stamp task). So the delegated branch provisions
  `delegation-guard.mjs` (loaded via `claude --settings`, matching
  Bash/Read/Grep/Glob) with two rules, **denied before the call runs**:
  (1) *always*: any Bash command whose write target is the working tree,
  while allowing writes to the out dir (contracts, worker-task files)
  and `/tmp`; (2) *until the phase-attempt's first real
  `gemini_worker.py` invocation* (recorded by a per-attempt sentinel
  file): workdir Reads, repo-targeting Grep/Glob searches, and
  repo-inspecting Bash — delegate first, verify after. The guard runs
  `audit.mjs`'s own classifiers (`bashEditsTree`, `bashInspectsRepo`,
  `searchTargetsRepo`) — the same rules that *flag* post-run now
  *prevent* at runtime, so guard and audit can never disagree. Heredoc
  bodies are stripped before every check (`stripHeredocs`), so writing a
  `worker-task` file that quotes `sed -i` or `gemini_worker.py` as an
  example is not mistaken for an edit or a delegation. This is the
  runtime-`deny` that §7 contrasts with after-the-fact audit.
  `guard.test.mjs` proves the classifiers and the generated script
  end-to-end ($0, offline).
- Preflight (delegated) is $0: driver auth present + `claude` runs; the
  worker venv exists and imports `google.antigravity`; Vertex ADC is
  present. (No `agy models` probe — that was the CLI.)
- Skill discovery under a relocated `CLAUDE_CONFIG_DIR` is
  smoke-verified (2026-07-23 gated smoke: the session init event lists
  `gemini-worker` in `skills`/`slash_commands`).

**Honesty (this cell's specific traps, closed in code):**

1. *Mislabeling*: the cell is two-model by construction — reported
   always as "Opus driver → Flash worker via Antigravity", never as
   pure Gemini, never compared against a single-model cell as if only
   the harness differed (the driver's contribution is a second
   variable). The dollar `cost_basis` says "DRIVER ONLY" (CLI-modeled);
   the worker's Gemini spend is captured as **real token counts** from
   the SDK's `UsageMetadata` sidecars and priced downstream via
   `getVertexRates(model, "asia-south1")` — measurable now (the SDK's
   payoff over the prose-only CLI, which recorded `null`).
2. *Silent collapse* — **now enforced, not just warned.** The first
   gated smoke (2026-07-23) proved a prose "always delegate" mandate
   loses to an available Edit tool: Opus edited `simple_cache.go`
   itself, made **zero** delegations, and every gate still passed.
   Closed seven ways: (a) the driver's file-editing tools are removed
   (above), so it cannot edit the tree; (b) **any** phase attempt —
   REPRO, LOCALIZE, or PATCH — with **zero** worker delegations is
   **failed** by the scaffold with a reason that tells the retry to
   delegate; this also closes the residual Bash `cat >`/`sed -i` channel,
   because no worker call means no valid artifact regardless of how the
   tree changed; (c) the delegate-first lock in the runtime guard denies
   all repository reads/searches/execution until the attempt's first
   worker call — the 2026-07-24 smoke showed collapse can also happen in
   *read-space*, with the driver doing the analysis itself and the
   worker reduced to a rubber stamp that satisfies the counter; (d) the
   audit records any direct-tree write attempt or pre-delegation
   inspection as non-critical `driver-direct-edit` /
   `driver-predelegation-inspection` flags; (e) the audit reads the
   `--model`/`--thinking` flags off each real `gemini_worker.py` command and
   compares them to the phase's own binding — `delegation-policy-mismatch`,
   **critical on model**, non-critical on thinking; (f) the mandate itself
   bounds what a **re-delegation** may contain (2026-07-29, finding C1 of the
   2026-07-28 driver-integrity audit). (a)–(c) shut every channel by which the
   driver can touch or pre-read the tree, which leaves exactly the one channel
   it is supposed to have — the task text — and the old rule left it unbounded:
   "re-delegate with a corrected task description … do not fix its work by hand"
   binds the hands and not the mouth. A driver that writes the finished function
   into the task file has the worker type its answer, and the trajectory reads
   perfectly: non-zero `delegation_calls`, no tree write, no pre-delegation
   read, right model, right thinking level. Only the prose shows it, and the
   audit found that shape live on the SDLC runs. The mandate now names what a
   re-delegation may carry (observed failure, verbatim build/test output, the
   unmet contract clause) and what it must never carry (diff or patch, finished
   file or function body, "change line X to Y", any tree-mutating command),
   keeps verification explicitly legal so the ban is not over-read into "do not
   check the worker's output", and closes the second-order hole: a command the
   guard denied to the driver may not be handed to the worker to run on its
   behalf. This one is prose and cannot be otherwise — a task file is free text,
   so nothing can classify it while the phase runs; it is authoring-time
   persuasion, and a breach is the post-run audit's to catch. Under §2.4 it is a
   study-definition change: it lands before further cell runs, the eight runs
   already recorded (5 SWE-Pro, 3 SDLC) predate it and keep their own snapshots,
   and the golden render hash in `guard.test.mjs` is re-pinned in the same
   change so the edit is a decision rather than a drift. Two runs have since
   been recorded *under* the new mandate — one of each kind, on 2026-07-28,
   logged in §13 — so the clause is no longer only an argument: it is a change
   with runs on both sides of it, and the two after it are the ones this study
   points at when asked whether the fix cost anything. (g) is the catching
   half of (f) — the **delegation content lint** (2026-07-29, finding C2). It
   reads every hand-off out of the trajectory in stream order and records
   dictated code, hand-over phrasing, a tree-mutating command routed to the
   worker, and — critical — a command the guard already refused to the driver
   *as a tree write*, re-issued down the delegation channel. It writes to a
   separate `integrity_warnings` array rather than into `flags`, because flags
   are mechanical facts about sealed channels and these are judgements about
   English; `delegation_content_checked` says whether it ran, on the same
   honesty rule as (e). Its thresholds are measured against the 50 recorded
   hand-offs (6/6 dictations, 1/1 proxy, zero false positives), and the
   dictation threshold has a one-line margin — clean hand-offs max out at 8
   non-blank fence lines, the smallest known dictation is 9 — which is exactly
   why it warns and never gates.

   Those thresholds now have to keep earning their numbers (2026-07-29, finding
   C4). The measurement that produced them was a scratch script over run
   directories on one laptop, which means every figure in the paragraph above
   was a claim a reviewer had to take on trust, and — worse — a later edit that
   widened or narrowed a rule would have shown up as nothing at all. The corpus
   is therefore committed: `fixtures/delegation-corpus/` holds all fifty
   hand-offs, each with its human label and the exact families the lint produced
   when it was pinned, and `delegation-corpus.test.mjs` replays the lint over
   them from the root test script. Four things break it — a clean hand-off that
   starts warning, a dictation that stops being caught, any row whose family set
   moves, and a threshold that no longer sits in the gap the evidence leaves.
   The gap is computed from the files, not restated next to the constant, which
   is what stops the constant and its justification drifting apart. Committing
   the corpus also cost the lint one wrong claim on the spot: a comment asserted
   two clean hand-offs carried 11- and 12-line directory trees, and re-measuring
   found exactly one, at 11. The exclusion is still load-bearing — a test now
   pins which file needs it — but the count was decoration, and this track
   exists to stop exactly that.

   Read the seven together: (a)–(d) police
   *whether the driver did the work itself*, (f)+(g) police *whether it
   dictated the answer down the one channel it is allowed to keep* — (f) at
   authoring time, (g) after the fact — and (e) is the only one that polices
   *which model the delegation actually landed on*. A
   column can pass every collapse gate — driver never touched the tree, every
   phase delegated, zero critical flags — while the worker was silently a
   different model than the column's name, which would void the comparison
   without leaving a mark. `audit.json` carries `delegation_policy_checked`
   so an unchecked run cannot be mistaken for a clean one. LOCALIZE is delegated too, as a
   **read-only** analysis task: deciding *where* the bug lives is real
   reasoning, and `localize.json` is injected verbatim into the PATCH
   prompt ({{LOCALIZE_JSON}}), so a driver-authored localization would
   smuggle the driver's thinking into a result reported as the worker's.
   The worker analyses and reports; it must **not** edit the tree (the
   read-only gate enforces that), and the driver writes the contract file
   from the worker's findings. `delegation_calls` is in every attempt's
   manifest either way.

**What all of that lets the study claim — and what it does not.** The seven
enforcements above establish one thing with certainty and a second thing only
by measurement, and the exporter used to publish both as a single sentence:
*the driver authored none of the patch*. That sentence is now split in two,
because welding them together made the weaker claim borrow the stronger one's
authority (2026-07-29, finding C8).

`typed_by` is **structural**. The driver's `Edit` / `Write` / `MultiEdit` /
`NotebookEdit` tools are absent from its allow-list and the PreToolUse hook
refuses every tree-writing shell command, so every byte of every patch arrived
through the worker. No trajectory can contain a counter-example; this is a
property of the harness, not an observation about a run, and it is stated
without hedging.

`authored_by` is **not** structural, and pretending otherwise was the defect.
The hand-off file is free text — that is deliberate, it is the channel the
delegation method needs — and free text can carry a finished function. Nothing
prevents a driver from dictating; only the content lint (g) detects that it
did, and only afterwards. So the exporter reports what was actually measured:
`worker — MEASURED` when the lint read the run's hand-offs and found nothing,
`MIXED — MEASURED` with the passage count and the families when it found
something, and `UNKNOWN` when the lint never ran. `UNKNOWN` is deliberately not
worded as a pass; an unchecked run is not a clean run, and the one place this
distinction gets quietly lost is a default that renders "not measured" and
"measured clean" identically. A column inherits the **worst** verdict among its
runs rather than a majority or an average, for the same reason a single
critical flag is not diluted by a batch: an integrity claim is only as good as
its weakest member.

The consequence worth stating plainly: a `MIXED` finding is **published, not
filtered**. The run is still graded and still appears in the study, with the
flagged passages named. Removing an inconvenient run would be a worse integrity
failure than the one being reported.

**Measuring runs that predate the measurement** (2026-07-29, finding C6). The
content lint shipped on 2026-07-28, and every delegated run on record was
executed before it. Their `audit.json` files therefore carry no
`delegation_content_checked` field at all, so `authored_by` was — correctly, and
uselessly — reporting `UNKNOWN` on all eight, while six measured dictated
passages existed only in an audit document outside the repo. The right fix is
not to backfill the record: recorded runs are immutable evidence, and an audit
that edits what it audits proves nothing. It is to re-run the check over the
same bytes. The hand-offs are still on disk verbatim
(`out/worker-task-<phase>-a<n>-<i>.md`), so `lintRecordedHandoffs()` reads them
at export and bundle time and lints them again, writing nothing.

Two properties keep that from being worse than the `UNKNOWN` it replaces.
First, **precedence runs one way only** (`resolvedIntegrity`): a measurement the
run itself made always wins, because that pass walked the trajectory in stream
order and is the only one that could have raised `guard-evasion-by-proxy`; the
re-read is used only where nothing was measured; and where neither happened the
answer stays `UNKNOWN`. Second, the re-read **states its own ceiling in the
published sentence** — it postdates the run, and it structurally cannot see the
one critical family, so a `0` from it is not evidence that no evasion occurred.
`measured_at` (`"run"` / `"re-read"` / `"never"`) travels with the numbers so
no surface re-derives provenance and then contradicts another.

Both publishers — `export-dashboard.mjs` for the console and `bundle-run.mjs`
for `evidence-bundle/integrity-notes.md` — import the wording from `audit.mjs`
rather than restating it. Two hand-written copies of a sentence that has to
agree is the drift this whole track keeps finding; the same discipline already
applies to `bashEditsTree` (block and flag agree by construction),
`GUARD_DENIAL_MARK` and `DICTATION_MIN_LINES`.

### 2.6 The agy seat is free in dollars and rationed in practice

Discovered the hard way on the first end-to-end smoke (2026-07-21,
navidrome, `antigravity × all-opus`). The run cleared REPRO, then all
three LOCALIZE attempts died within roughly one minute of each other on:

```
Error: Individual quota reached. Please upgrade your subscription
to increase your limits. Resets in 163h46m22s.
```

Three facts follow, and all three change how this study must be planned.

**1. "$0 seat" was only ever a statement about dollars.** The seat carries
a hard per-user quota with a multi-day reset window (~164 h ≈ 6.8 days
from exhaustion). Everywhere this doc says agy costs nothing, read: costs
no money, consumes a scarce rationed budget. Quota — not wall clock, and
not dollars — is the binding constraint on this study.

**2. The quota is invisible.** `agy` 1.1.4 has no usage, quota, limit, or
account subcommand (full `--help` surface checked, 2026-07-21). There is
no preflight that can answer "do I have enough left for 12 instances?".
The *only* signal is a failed call. This is a genuine measurement gap and
it compounds the one already recorded in §6 (agy print mode reports no
token or cost numbers): we can neither see what a run consumed nor what
remains.

**3. Three of the four cells share this one seat.** `antigravity ×
all-opus` and `antigravity × all-gemini-flash-high` run on it directly,
and `claude-code × gemini` depends on it for its *worker* half (§2.5).
Only `claude-code × all-opus` is independent, on Claude Max. So a single
exhausted quota blocks three quarters of the matrix, including **both**
of the cells Google asked for by name (§1.3, asks 3a and 3b).

Consequences adopted:

- **Quota exhaustion is a fatal error, not a gate failure.** It must abort
  the run immediately (§2.3). The smoke recorded `"attempts": 4` when only
  two were real model attempts — the other two were instant API rejections
  burning the retry budget and inflating the evidence. Retrying a quota
  error cannot succeed by construction.
- **The rationing is reported, never smoothed over.** A cell that ran in
  two sittings across a quota reset is disclosed as such, because a
  multi-day gap mid-cell is a fact a reader needs in order to trust the
  wall-clock column.
- **It is a live question for the Google thread.** Ask 3a requires
  `agy × Opus × 12` and ask 3b requires the delegated cell; if one
  individual seat cannot fund ~36 instance-runs, that is a concrete
  blocker to raise with evidence (exact error string, reset window)
  rather than a complaint. Whether the quota is seat-wide or per-model
  pool is **not yet known** — a single cheap probe on a Gemini binding
  settles it, and until it is run, no claim either way belongs in the
  report.
- **There is now a way out for the Gemini cells, at a price.** The SDK
  (§2.7) can be pointed at Vertex on our own paid project, which replaces
  an invisible ration with a metered bill. That converts the binding
  constraint from quota back to money — a straight improvement for a study
  whose whole output is cost numbers. It does **not** rescue `agy × Opus`:
  the SDK reaches no Claude model, so ask 3a stays on the rationed seat.

### 2.7 The Antigravity SDK — Google's requested harness path (2026-07-20/21)

Everything above §2.7 was designed against the **`agy` CLI**, because
until 2026-07-20 that was the only Antigravity surface we had. On the
Tokenomics call that day, Google asked us to move to the **SDK** instead.
This section records the ask, what the SDK actually contains, and which
of this document's conclusions it changes. It is written as a *finding*,
not yet as a design: nothing in §3–§9 has been rebuilt on it.

> **Status, if you read nothing else in §2.7–§2.7c:** the SDK measures
> better than the CLI and we would move to it — but the Claude cell
> **stays on the `agy` CLI**, because run live the SDK breaks on the
> second turn of any conversation that uses a tool. §2.7c has the
> evidence and the eight defects for Google. Two claims below were
> overturned by later evidence and are marked where they appear; they are
> kept because a reversal is worth more than a clean story.

**The ask, in Google's words** (Sanjit Mehta, 2026-07-20 transcript):

> "I know you mentioned that you're trying to do interprocess
> communication using CLI. My two cents would be… one request to you is
> if you could try with anti-gravity [SDK]"

> "most of the CLI they are installed via bash command, so they might not
> be whitelisted by a lot of the large enterprise IT teams… to be very
> honest it will be very difficult to get it through, so that way
> anti-gravity SDK is [the answer]"

> "SDK forms the base of all the other three products — your standalone
> IDE, IDE extensions, and lastly your CLI. But the driving factor is the
> SDK… a Python package perhaps would be an easier gatekeeping discussion
> versus a full standalone IDE or a full standalone AGY or CLI"

**The reason is distribution, not engineering.** The CLI is not being
called worse; it is being called unshippable into a customer estate. A
`curl | bash` binary needs IT whitelisting, a pip package rides an
existing artifact pipeline. Kiran confirmed we hit the same wall
independently ("we are getting blocked at the InfoSec stage in a lot of
agents that we are building"). That distinction matters for this study:
it means the SDK switch is **not** an admission that the CLI measurements
were wrong, and CLI-era results do not need to be thrown away.

**What the package actually is** (verified 2026-07-21 by unpacking the
wheel — no live call, $0):

- `google-antigravity` **0.1.7**, Google LLC, Apache-2.0,
  `requires_python >=3.10`, source at
  `github.com/Google-Antigravity/antigravity-sdk-python`.
- Platform-specific wheels of ~31–39 MB, because each one **bundles a
  ~99 MB Go binary at `google/antigravity/bin/localharness`**. The SDK is
  a Python control plane over the same engine family the CLI drives, not
  a thin REST client. Two consequences: the agent loop is Google's in
  both surfaces (so the harness under test does not change identity), and
  the artifact is large enough to be worth flagging to enterprise binary
  scanners — the very friction the SDK exists to remove.

**What it fixes.** Each row is a gap this document already records:

| Gap recorded in this doc | SDK surface that closes it |
|---|---|
| §2.6 / §6.2 — agy reports **no usage numbers**, cost recorded `null` | `UsageMetadata`: `prompt_token_count`, `cached_content_token_count`, `candidates_token_count`, **`thoughts_token_count`**, `total_token_count` |
| §2.1 — agy exposes no Claude thinking knob, recorded `product-internal` | `ThinkingLevel` enum: `minimal / low / medium / high / extra_high` |
| §2.6 — the $0 seat's invisible quota is the binding constraint | `VertexEndpoint(project, location)` → run on **our own paid project and ADC**, metered and un-rationed |
| §2.5 — no base-URL override on the CLI | `ModelEndpoint.base_url` + `http_headers` |
| §3 — the two runtimes expose different tool inventories (a confound) | `CapabilitiesConfig(enabled_tools=…)` over a fixed `BuiltinTools` enum |
| §7 — test-editing is caught only *after* the run, by the audit | `hooks.policy.deny()` rejects a call at runtime, including `run_command` matched on its arguments |
| §2.5 — delegation wired through a bash Skill | native `subagents` + `enable_subagents` |
| §6.2a — trajectory recoverable only as protobuf blobs in SQLite | structured events, plus an `otel` extra (`utils/otel.py`) |

**What it does not do, and this is the blocker.** The SDK's Python
surface has **zero** Claude access: no `anthropic` or `claude` string
appears in any `.py` file in the package. The only endpoints are
`GeminiAPIEndpoint`, `VertexEndpoint`, and `LocalOpenAIAgentConfig`;
`DEFAULT_MODEL` is `gemini-3.5-flash`; and `ThinkingLevel`'s own
docstring scopes it to *"Gemini models that support extended thinking."*

The bundled engine plainly can do it — `bin/localharness` carries
`MODEL_PROVIDER_ANTHROPIC`, `API_PROVIDER_ANTHROPIC_VERTEX`,
`MODEL_CLAUDE_4_OPUS_THINKING` and BYOK variants. **The capability is in
the engine; the Python API does not reach it.** That is precisely the
cell Google asked for by name (§1.3, ask 3a: "Antigravity as a Harness
and Claude as one of the models within Antigravity"), so it is the first
item on the challenges list going back to them.

**Effect on the four cells** — proposed, not yet executed:

| Cell | Effect of the SDK |
|---|---|
| `antigravity × all-gemini-flash-high` | Move to SDK. Strictly better, and Vertex-on-our-project removes the quota block of §2.6 outright. |
| `claude-code × all-gemini-flash-high` (ask 3b) | Worker half moves to SDK: the bash-Skill cable becomes a Python worker that reports its own tokens, closing the "DRIVER ONLY" cost caveat in §2.5. |
| `antigravity × all-opus` (ask 3a) | **Stays on the CLI** for now. The SDK reaches Claude's *protocol* but cannot authenticate to it (§2.7a). Three routes, in preference order: (1) Google opens an Anthropic endpoint in the Python surface — asked for in T-SDK-2; (2) a localhost header-injecting proxy — built, and now **run live against Anthropic** (§2.7c): a single turn completes, but the agent loop dies on turn 2 because Antigravity ends requests with an assistant message and Anthropic rejects prefill. Working around that means rewriting the conversation, which we will not do. The compat path also returns **no** `UsageMetadata`, so it would not even buy us the measurements we moved for; (3) the CLI remains this cell's only vehicle, and the report states that one cell used a different Antigravity surface than the others. |
| `claude-code × all-opus` | Unchanged — no Antigravity surface involved. |

**Two operational traps found in the source, before anyone writes a
runner against it:**

1. `run_command` is **denied by default** (`policy.confirm_run_command`).
   A headless run needs `policies=[policy.allow_all()]` or an explicit
   allow-list, or it will block waiting on a confirmation nobody answers.
2. SDK state lives in `~/.gemini/antigravity`; the CLI uses
   `~/.gemini/antigravity-**cli**`. Separate stores — so `agy-trajectory.mjs`
   (§6.2a) does **not** see SDK runs, and CLI-era and SDK-era runs are not
   reading from the same history.

### 2.7a T-SDK-1 probe results — what is now measured, not assumed (2026-07-21)

Everything in §2.7 above was read off the source. This subsection is the
**executed** probe: SDK 0.1.7 installed into a Python 3.12 venv, run
against Vertex on `ai-studies-console` / `asia-south1` with our ADC.
Total spend: ~59k Gemini 3.5 Flash tokens across three variants.

**Confirmed working — every measurement gap in the table above is real.**

| Claim | Verdict | Evidence from the run |
|---|---|---|
| Headless autonomy is possible | **Yes** | `policies=[policy.allow_all()]` — the agent issued `run_command('cat canary.txt')` and returned the marker with no confirmation prompt |
| `UsageMetadata` populates | **Yes, fully** | `{'prompt_token_count': 35575, 'cached_content_token_count': 30183, 'candidates_token_count': 177, 'thoughts_token_count': 441, 'total_token_count': 36193}` |
| `ThinkingLevel` is a real, observable knob | **Yes** | Identical one-word prompt: **29** thought tokens with no level set, **102** with `HIGH`. Thinking text is also readable via the `.thoughts` async generator. |
| Vertex on our own paid project works | **Yes** | `VertexEndpoint(project='ai-studies-console', location='asia-south1')` authenticated on existing ADC — no agy seat involved, so **§2.6's quota block does not apply to SDK cells** |
| Trajectory is structured, not blobs | **Yes** | `.tool_calls` yields `ToolCall(name=…, args=…, id=…)` objects directly — no protobuf decoding, no WAL-sidecar trap |

**One number worth carrying into cost modelling:** a one-word reply cost
**11,554 prompt tokens**. That is Antigravity's own identity/tool
preamble, charged on every turn. Caching absorbs much of it on later
turns (30,183 of 35,575 were cached by the third variant), but any
per-phase cost estimate must budget a five-figure prompt floor per turn.

**The Claude blocker is now confirmed *and* narrowed.** The escape hatch
that looked open in §2.7 — `LocalOpenAIAgentConfig` pointed at
Anthropic's OpenAI-compatible endpoint — was tested against a local
capture server ($0, no key needed). Result:

- **The wire shape is right.** The SDK emits genuine OpenAI protocol:
  `POST /v1/chat/completions` with `{"model": "claude-opus-4-6",
  "messages": [{"role": "system", "content": "<identity>You are
  Antigravity…"}]}`. Antigravity's full harness — system prompt, tool
  definitions, agent loop — is intact over a standard protocol.
- **But it cannot authenticate.** `LocalOpenAIAgentConfig` has **no
  `api_key` parameter**; the captured request carried **no
  `Authorization` header**; and the only auth env vars the bundled binary
  knows are `GEMINI_API_KEY` and `GOOGLE_API_KEY` — no OpenAI- or
  Anthropic-style key anywhere. The path is built for keyless localhost
  servers, exactly as its docstring says ("Ollama, LM Studio").

So the honest status of ask 3a is: **Antigravity's harness can drive
Claude over a standard protocol, and the SDK has no supported way to
authenticate to it.** *(Superseded 2026-07-21 — §2.7c. Authentication
turned out not to be the real blocker: the proxy below closed it and the
key works. The run then failed one level up, on how the SDK labels tool
results. This paragraph is the narrowest the blocker looked before we ran
it for real.)* A localhost reverse proxy that injects
`Authorization` closes it — and note this is *not* the MITM gateway
rejected in §2.5: no CA, no interception of Google traffic, no protocol
translation, just a header added to a request we ourselves originate.
That proxy is now **built and rehearsed** — see §2.7b, which also
retracts the thinking-parity objection previously recorded here. One
caveat does survive and must be stated in any result: the model would be
served by Anthropic on our key, not by Google via `ANTHROPIC_VERTEX`, so
it answers "Antigravity as a harness" but not "Claude *within*
Antigravity".

**Why the CLI has no Claude thinking knob — answered.** §2.1 recorded it
as `product-internal` with no explanation. The engine's enum shows why:
thinking is not a parameter but a **separate model identity** —
`MODEL_CLAUDE_4_OPUS` and `MODEL_CLAUDE_4_OPUS_THINKING` are distinct
values, as are the Sonnet and Haiku pairs. There is nothing to expose;
you select a different model. (The enum also carries ~650
`MODEL_PLACEHOLDER_M###` slots, which is how new models ship without
leaking names — so absence of a 4.6-era Claude constant is not evidence
of absence.)

**Five defects to send to Google** — *the first five of eight; §2.7c adds
three more found only by running it live, including the one that actually
blocks ask 3a. Together they are the substance of T-SDK-2:*

1. **No Anthropic endpoint in the Python surface** — 0 of 55 `.py` files
   mention `anthropic`/`claude`, while the bundled engine carries the
   full `MODEL_CLAUDE_*` enum and `API_PROVIDER_ANTHROPIC_VERTEX`. Blocks
   Google's own ask 3a.
2. **The OpenAI-compat path cannot authenticate** — no `api_key`
   parameter, no `Authorization` header emitted, no key env var honoured.
   This makes every authenticated third-party endpoint unreachable.
3. **`base_url` is not normalised** — passing `…/v1` produces
   `POST /v1/v1/chat/completions`. Silent; only visible by packet capture.
4. **`CapabilitiesConfig` silently drops the SDK's own arguments** —
   `LocalOpenAIAgentConfig.__init__` constructs
   `CapabilitiesConfig(file_reads=…, file_writes=…, command_execution=…,
   subagents=…, mcp=…)`, but none of those five field names exist on the
   model, and pydantic's default `extra='ignore'` swallows them. The
   intended capability defaults for that path are **no-ops**. This is a
   bug in Google's code, not in ours.
5. **Retries appear unbounded** — a non-conforming endpoint drew **1,903
   requests in ~90 seconds** with no visible cap or backoff, and the
   Vertex variant logged ~38 consecutive `model output must contain
   either output text or tool calls` retries. On a metered endpoint this
   is a runaway-bill risk, and it is the same hazard as the
   quota-errors-must-abort item already open in §6.

**Two undocumented footguns for whoever writes the runner:**

- `Agent` is an **async context manager and nothing else**. There is no
  `.start()`. `Agent(cfg).chat(...)` raises *"Agent session not started"*;
  the only supported form is `async with ag.Agent(cfg) as agent:`.
- `chat()` returns a **lazy** `ChatResponse`. Nothing executes — not one
  network request — until you `await resp.resolve()` or iterate
  `.chunks`. `.text()` and `.structured_output()` are **methods**;
  `.thoughts` and `.tool_calls` are **async generators**. Reading them as
  properties returns bound-method objects and looks like an empty result,
  which is exactly how the first probe run produced a false negative.

Also corrected from §2.7: `policy.allow_all()` returns a **single**
`Policy`, not a list — `policies=[policy.allow_all()]` (wrapped) is the
correct form, matching the `LocalAgentConfig` docstring.

**Still open:** whether `UsageMetadata` is retrievable per-step rather
than per-turn; and whether the SDK can use the OAuth seat at all, or is
Vertex/API-key only. On the evidence so far the SDK is **metered-only**,
which ends the "$0 seat" era for SDK cells — a good trade for
measurability, but a budget decision, and one that changes `cost_basis`
from *not measurable* to a real number.

### 2.7b The header-injecting proxy — built and rehearsed at $0 (2026-07-21)

§2.7a narrowed the ask-3a blocker to a gap exactly one HTTP header wide.
`sdk-probe/proxy_anthropic.py` fills it: the SDK's `base_url` points at
localhost, the proxy attaches `Authorization: Bearer $ANTHROPIC_API_KEY`,
and forwards to Anthropic's OpenAI-compatible endpoint unchanged.

We hold no Anthropic key (the Max plan is OAuth and cannot authenticate
API calls, so a key is new metered spend — a budget decision, not a
technical one). Rather than let the proxy sit unverified until that
lands, `sdk-probe/test_proxy_offline.py` drives the **real SDK** through
the **real proxy** into a mock upstream. It costs nothing and needs no
key. Result, all passing:

| Check | Result |
|---|---|
| Proxy injected `Authorization` on a request that had none | PASS |
| Antigravity's own system prompt survived the hop | PASS |
| Antigravity's 18 tool definitions survived the hop | PASS |
| Model routed as `claude-opus-4-6` | PASS |
| Streamed SSE reply survived the return hop, `text() == 'PONG'` | PASS |
| Circuit breaker held — **1** upstream request, not 1,903 | PASS |

So every variable on our side of the wire is settled. Exactly one was
not: whether Anthropic's compat layer accepts Antigravity's request body
verbatim. **That is now answered live — §2.7c.**

**Retraction — the thinking-parity objection in §2.7a was wrong.** It
claimed the proxy route forfeits thinking parity because
`LocalOpenAIAgentConfig` has no thinking knob. True, but irrelevant: the
proxy is *already* rewriting the request, so it can inject the thinking
parameter as easily as the header. `--inject-thinking <effort>`
implements this. It is gated behind an explicit flag and labelled
UNVERIFIED, because whether Anthropic's compat layer honours the key or
ignores it is itself a live question. Parity is therefore *plausibly
recoverable*, not lost — and not yet proven.

### 2.7c LIVE result — one turn works, the agent loop does not (2026-07-21)

Run against `api.anthropic.com` on the `ANTHROPIC_API_KEY` already in
`ai-studies-console/.env` (the key the SWE-bench Pro work uses). Roughly
$2-3 of spend, estimated from request sizes rather than measured -- see
the usage finding below for why it cannot be measured.

**Anthropic accepts Antigravity's request body.** This was the open
question and the answer is yes: a 58.8 KB payload carrying the identity
preamble, 18 tool definitions and `tool_choice: auto` returns HTTP 200.
Every request in every run was accepted at the transport level.

**A single turn completes end to end.** With no tool use required:

    LocalOpenAIAgentConfig(model="claude-opus-4-6",
                           base_url="http://127.0.0.1:8803")
      -> proxy -> api.anthropic.com -> Opus 4.6 -> back
    text() == 'PONG'

That is cross-path 2 working. Antigravity's harness, Claude's model, a
real answer parsed by the SDK.

**The agent loop does not survive turn 2 -- and the cause is not what
the error message suggests.** Anthropic returns HTTP 400 *"This model
does not support assistant message prefill. The conversation must end
with a user message."* Dumping the request we actually sent shows why:

    4 messages
      system     '<identity>You are Antigravity...'
      user       '<USER_REQUEST>Read the file canary.txt...'
      assistant  ''                                    <- no tool_calls field
      assistant  'File Path: file:///.../canary.txt'   <- the TOOL RESULT

Antigravity ran the tool locally and fed the result back **as an
assistant message**. In the OpenAI protocol a tool result must be
`role: "tool"` carrying a `tool_call_id`; neither assistant message
carries a `tool_calls` field at all. So the compat path is not using
OpenAI's tool mechanism -- it does text-based pseudo-tool-calling and
appends every turn as `assistant`. That yields two consecutive assistant
messages ending on `assistant`. Permissive OpenAI servers accept this;
Anthropic requires strict alternation and reads a trailing assistant as
prefill.

**It is model-dependent, which does not rescue the cell.** Sending the
same malformed shape directly:

| Model | Trailing + consecutive assistant |
|---|---|
| `claude-opus-4-6` | HTTP 400 |
| `claude-sonnet-4-6` | HTTP 400 |
| `claude-haiku-4-5` | **HTTP 200**, answered normally |

The thinking-era models reject prefill; Haiku 4.5 accepts it. So this
cell *could* be made to run -- on Haiku 4.5, which is no use to a study
pinned to Opus 4.6 for parity with the CLI arm's ceiling (§2.1). Swapping
the model to dodge a protocol bug would silently change what the cell
measures.

**We are not working around it either way.** The proxy could inject a
synthetic user turn, but that means rewriting the conversation the
harness constructed -- which changes what the study measures, and the
whole claim of this scaffold is that the harness is unmodified.
Transport fixes are legitimate; conversation surgery is not. That is the
line, and this is where it falls.

**Even if it worked, the Claude path returns no usage data.**
`resp.usage_metadata` is `None` on the OpenAI-compat path -- against
Vertex the same call returns full `prompt/cached/candidates/thoughts/
total` counts (§2.7a). So the headline reason to prefer the SDK over the
CLI, real token numbers, **does not extend to the Claude cell**. This
materially weakens the case for routing that cell through the SDK even
if Google fixes the prefill issue.

**Net:** `antigravity x all-opus` stays on the CLI. Not for want of a
credential -- the credential works -- but because Antigravity's agent
loop and Anthropic's API disagree about conversation shape, and because
the compat path would not give us the measurements we moved for.

**Three more defects for Google, found live** (append to the five in
§2.7a; total now eight):

6. **Tool results are returned as `assistant` messages, not `role:
   "tool"`** -- the compat path does text-based pseudo-tool-calling and
   emits no `tool_calls` field at all, producing consecutive assistant
   turns ending on `assistant`. This is not OpenAI-conformant on the
   return leg; permissive servers hide it, strict ones do not. Anthropic
   rejects it with HTTP 400 on every thinking-era model (Opus 4.6,
   Sonnet 4.6 fail; Haiku 4.5 accepts). Any customer pointing Antigravity
   at Anthropic hits this on turn 2 of every conversation. This is the
   real blocker for Google's own ask 3a, it is on their side, and the fix
   is well-defined: emit tool results as `role: "tool"` with a
   `tool_call_id`.
7. **Assistant content carries trailing whitespace** -- HTTP 400
   "final assistant content cannot end with trailing whitespace". OpenAI
   tolerates it; Anthropic does not. Cheap fix, one `rstrip`.
8. **No `UsageMetadata` on the OpenAI-compat path** -- returns `None`
   where the Vertex path returns full counts. Cost and thinking spend are
   unmeasurable for any non-Google model.

**Two bugs of our own, recorded so no one re-finds them.** Both looked
exactly like SDK incompatibilities and were not:

- The proxy checked its circuit breaker *before* draining the request
  body. Under HTTP/1.1 keep-alive the unread body stayed in the socket
  and the next request parsed it as a request line -- surfacing as
  `Bad request version ('...tool_choice:auto}')`.
- The proxy stripped `Content-Encoding` while forwarding gzipped bytes,
  handing the SDK compressed data labelled as plaintext. It parsed binary
  as SSE, found no deltas, and reported *"model output must contain
  either output text or tool calls"* -- indistinguishable from Anthropic
  being incompatible. **A mock upstream cannot catch this, because mocks
  do not compress.** It is the strongest argument in this whole exercise
  for why the $0 rehearsal, however thorough, was not a substitute for
  one real call.

**Two facts from the $0 rehearsal (§2.7b) worth carrying:**

- The SDK sets `stream: true` on this path unconditionally. A
  non-streaming JSON reply is discarded silently and the harness reports
  *"model output must contain either output text or tool calls"* — which
  reads exactly like a broken proxy and is not one. This cost an hour;
  it is written into the test so it costs no one else.
- The request carries **18 tool definitions** plus the full identity
  preamble. That is the mechanism behind the 11,554-token prompt floor
  in §2.7a, charged every turn.

---

### 2.8 Managed agents — the fourth Antigravity surface, probed (2026-07-21)

Teja asked us to read Google's managed-agents and Interactions API
announcements and say what is usable. The full assessment is
[MANAGED-AGENTS.md](MANAGED-AGENTS.md); this is what a reader of *this*
document needs, and why the ledger row above changed.

**What it is.** Google's Interactions API replaced stateless
`generate_content` with a server-side session (`previous_interaction_id`
carries history). On top of it, **managed agents**: Google deploys and runs a
containerised agent for you. The flagship is the **Antigravity agent**,
`antigravity-preview-05-2026`, running **Gemini 3.5 Flash**.

**What we verified, at $0** ([`sdk-probe/probe_managed_agent.py`](sdk-probe/probe_managed_agent.py)).
Against `ai-studies-console`, `locations/global`, plain ADC:

- A bogus agent id returns `404 Agent ... not found`; the real
  `antigravity-preview-05-2026` gets *past* agent lookup and fails later with
  `400 Missing input`. **It resolves for our project** — no seat, no CLI, no
  entitlement request, no allowlist. This is the lowest-friction Google surface
  we have tested, and it is open today.
- Agent interactions are **async only**: without `background: true` the API
  returns `400 Agent interactions must set background to true`.
- An `environment` is **mandatory** — omitting it returns
  `400 Environment configuration is required`. Every interaction provisions a
  sandbox; there is no plain model-call mode.

**Why it still cannot host this matrix.** Two structural limits, neither of
which we can engineer around:

1. **Gemini-only.** Google's own docs state only
   `antigravity-preview-05-2026` is supported as `base_agent`, and it is
   Flash-backed. So this does not open the `antigravity × claude` cell —
   everything in [GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md](GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md) stands unchanged.
2. **No local environment.** `environment` accepts `"remote"`, an existing
   `environment_id`, or an `EnvironmentConfig` — there is no local option. The
   agent cannot see the sealed workdir on this machine. Getting the repo in
   (git or GCS source) and the patch back out is possible, but it dissolves the
   guarantee this scaffold exists to make: that the agent saw exactly our
   sealed workdir, anchored by the `sealed-base` tag, with grading run under
   `--block_network`. That is a threat-model change, not a plumbing change.

**Where it is worth using instead** — the orchestrator repo, whose thesis
depends on "TaskPacket + explicit caching + stateless workers" to move context
between models. A managed agent replaces all three with a server-side session,
and because we already capture per-request token accounting into the
`llm_requests` BigQuery table, the swap is *measurable* rather than merely
plausible. That is the tokenomics study Google actually asked for. Caveats and
the decisions it needs are in [MANAGED-AGENTS.md §5 and §7](MANAGED-AGENTS.md).

**One correction to how the earlier ledger row was phrased.** "Rejected for the
matrix" was right, but it had been reasoned from documentation. It is now
reasoned from a probe — and the probe also found the route is *open to us*,
which the original row implied it was not.

---

## 3. Architecture: one scaffold, thin adapters, host runtimes, container execution

```
tools/harness-matrix/run-harness.mjs      (ONE script, owns the loop)
   │  --instance-dir …  --runtime claude-code  --policy policies/all-opus.yaml   (antigravity removed 2026-07-23)
   │
   ├─ per instance:
   │    preflight  validateInstance (sealed-field gate) · policy binding check
   │    seal+extract  build sealed image (git-history erase, sealed-base tag)
   │                  docker create + docker cp /app → <rundir>/workdir
   │    REPRO     runtime call → gate: repro command FAILS in container   (retry per policy)
   │    LOCALIZE  runtime call → gate: files exist; baseline snapshot     (retry per policy)
   │    PATCH     runtime call → gates: diff non-empty · repro now PASSES
   │              · surrounding tests no worse than baseline              (retry per policy)
   │    finish    strip test/harness hunks → model.diff → Scale grader → verdict
   │
   └─ "runtime call" = adapter (runtimes.mjs)
      TWO adapters, THREE invocation shapes — claude-code has two forms:
      │
      ├─ claude-code adapter
      │   │
      │   ├─ (a) native — used by the claude-code × all-opus cell
      │   │      claude -p … --model <binding> --output-format stream-json
      │   │      --max-budget-usd <limit> --permission-mode bypassPermissions
      │   │      --disallowedTools WebFetch,WebSearch,Task --add-dir <out>
      │   │
      │   └─ (b) delegated (§2.5) — used by the claude-code × gemini cell
      │          the SAME claude -p invocation, --model <driver>, plus a per-run
      │          CLAUDE_CONFIG_DIR holding the gemini-worker Skill. Edit/Write/
      │          NotebookEdit/MultiEdit are ALSO removed, so the driver cannot
      │          touch the repo itself; it reaches a Gemini brain by shelling
      │          out to the SDK worker — this is the crossover:
      │              └──→ gemini_worker.py --task-file <f> --workdir <workdir>
      │                       --out-dir <out> --model "<worker>" --thinking HIGH
      │                       (google-antigravity SDK → Vertex; writes usage sidecar)
      │
      └─ antigravity adapter — REMOVED 2026-07-23 (agy CLI parked; returns
             later as an SDK harness). Historical shape: agy -p … --add-dir
             <workdir> --add-dir <out> --model "<binding>" --sandbox …
```

**Why `claude-code` appears twice and that is not a typo.** A runtime and a
cell are different things. There are two runtimes (two CLIs, two adapters)
but four cells, and the claude-code adapter serves two of them through two
different invocation shapes. The native shape swaps the driver brain with
`--model`; the delegated shape cannot, because Claude Code's driver seat is
welded to Anthropic (§2.5), so it keeps an Opus driver and sub-contracts the
actual work to a Gemini worker reached through the `google-antigravity` SDK
(`gemini_worker.py`). To make that sub-contract real rather than optional, the
delegated driver also has its file-editing tools removed (Edit/Write/
NotebookEdit/MultiEdit), so the only way a repository change reaches disk on
repro/patch is a worker call — see §2.5. That is why the delegated line ends
in the SDK worker, not in Claude's own editor: cell (b) is the one place where
two brains run inside a single phase — Opus as the harness driver, Gemini
(via the SDK) as the model doing the code. It is also why that cell is
two-model by construction and can never be read as a pure Gemini result.


The four load-bearing decisions:

**Script owns the loop; runtime owns the inside of a phase.** The prior
SDLC orchestration experiment ran runtime-owns-loop because orchestration
*was* the question. Here the question is runtime quality under a fixed
procedure — and §1.1 is the evidence free-roam loses. Inside a phase the
runtime is fully agentic (read, grep, run tests via the helper, edit);
at phase boundaries only the script judges.

**One scaffold + adapters, never per-runtime runners.** Any procedural
drift between runtimes becomes an alternative explanation of the result.
An adapter is ~40 lines: "invoke this CLI headless on this prompt, in
this workdir, report what it cost". A future runtime (Codex CLI…) is one
new adapter.

**Runtimes on the host; the container executes repo commands.** The
workdir is extracted from the *sealed* image, so the one-commit history
and `sealed-base` diff anchor travel with it. Every repo command (repro,
tests, baselines) runs inside the instance container with the workdir
mounted at `/app` — the host has none of the repos' toolchains and never
needs them. Agents get `out/run-in-env.sh "<cmd>"`, which runs a command
in the container exactly as the gates do — intra-phase test-running is
preserved, uniformly, for every runtime. Bonus vs the rig: with no agent
inside the image, the agent layer (node, npm, CLI install, unprivileged
user) disappears — the sealed image is just base + git seal + coreutils.

**The sweap base images are not one OS** (found by the first smoke,
2026-07-21). The rig worked exclusively with vuls, which is Alpine/musl,
and the Dockerfile inherited `apk add` as though that generalized; the
first harness-matrix smoke hit navidrome, which is Debian 12, and the
build died on `apk: not found` before any model ran. The shell-utils
layer now branches on the package manager: Alpine always installs bash +
GNU coreutils (there `timeout`/`sh` exist as BusyBox applets, so a
presence check would pass while the applets still behave differently
from GNU under `timeout -k … bash -c`), Debian-family installs only if
genuinely missing, and a base matching neither branch fails the build
loudly rather than surfacing later as an unexplained phase failure.
Verified on navidrome: Debian 12, GNU bash 5.2.15, GNU coreutils 9.1,
seal intact (1 commit, `sealed-base` tag only, no remotes).

**The execution environment is emulated, and that is charged to the
model's clock.** Measured 2026-07-21 on the development Mac: every sweap
instance image is `linux/amd64`, the host is `arm64`, and the Docker VM is
4 CPUs / 5.2 GB on an 8 GB machine, with `run-in-env.sh` further capping
each container at `--cpus 3 --memory 3g`. Three costs stack:

1. **Translation.** amd64 binaries run under emulation on an arm64 host.
   Compilation is the worst case for this, and every gate in §4 is a
   compile-then-run.
2. **The bind mount.** The workdir lives on macOS and is mounted into the
   Linux VM. Compilers stat and read thousands of files; Docker Desktop's
   macOS↔Linux filesystem is materially slower than a native one.
3. **Discarded incremental builds.** `run-in-env.sh` uses `docker run
   --rm`. The image does ship warm caches (251 MB `GOCACHE`, 555 MB
   `GOMODCACHE` in the navidrome image), so runs do not start from zero —
   but every *new* compilation result is destroyed when the container
   exits, so the same incremental rebuild is repeated on every command.

Why this belongs in the design and not in an ops note: these costs are
paid out of `phase_timeout_min`, which is the *model's* budget. Environment
slowness is therefore silently converted into phase failures and retries,
and shows up in the results as though the runtime were weaker. The first
smoke spent roughly two minutes on reasoning and the rest of a ten-minute
phase waiting on emulated Go builds (§10).

Two rules follow. **The execution venue is a study variable and must be
held constant across all four cells** — a phase that times out under
emulation may pass natively, so a matrix run half on this Mac and half on
native x86 would measure the hardware, not the harness. And **if the venue
changes, it changes for every cell, before any cell runs**, with the
platform stamped in each manifest.

**In-place edits kill the corrupt-diff failure mode.** Setup 0's models
emit diff text (hence Teja's hunk-header recount, hence G4's corrupt-diff
retries). Here runtimes edit files; the patch is always
`git diff sealed-base` computed by git. Hunk headers cannot be wrong by
construction. Nothing is ported from the recount code — it stays serving
Setup 0.

Phase calls are **stateless**: each is a fresh `-p` invocation whose
prompt contains the PR description plus prior phases' contract files,
injected by the script — so context is byte-identical across runtimes
regardless of their conversation features.

---

## 4. The recipe spine and its gates

```
REPRO     "write a reproduction that fails because of this bug"
          contract: repro files whose names CONTAIN harness_repro, inside
                    the repo; out/repro.json = { "command": "…", "files": […] }
          gates: files exist + carry the marker · phase changed nothing else
                 · command EXITS NON-ZERO in the container (and fast — a
                   timeout fails the gate; a hanging repro would poison PATCH)
LOCALIZE  "name the bug files and the surrounding test command"
          contract: out/localize.json = { "bug_files": […], "test_command": "…" }
          gates: every bug_file exists and is non-test · test_command is not
                 the repro · phase was read-only
          baseline: run test_command once WITH REPRO FILES HELD OUT →
                    out/baseline.json (exit code + log); a baseline timeout
                    fails the gate ("scope it tightly", enforced where
                    retrying is cheap)
PATCH     "fix the bug by editing files in place"
          gates: (1) repro files survived · git diff sealed-base minus
                     test/harness_repro paths ≠ empty
                 (2) repro command now EXITS ZERO      ← the fail-to-pass flip
                 (3) test_command (repro files held out, as at baseline)
                     exits 0 — or, if baseline was already red, no-worse
                     waiver (recorded as warning, §7)
          on failure: git reset --hard sealed-base && git clean -fd, repro
                      files restored from out/repro-files/, retry per policy
```

Two naming/measurement subtleties, both load-bearing:

- The marker is "basename CONTAINS harness_repro", not "starts with" —
  pytest only discovers `test_*.py` files, so the Python repro must be
  `test_harness_repro.py`. Go (`harness_repro_test.go`) and JS
  (`harness_repro.test.js`) carry the marker naturally. In-repo placement
  lets each language's standard runner find the repro; the marker keeps it
  strippable from the graded diff. Stripping is logged, never silent —
  same policy as the test-path stripper.
- The surrounding-suite baseline AND the patch-phase regression check run
  with the repro files temporarily HELD OUT of the tree: package-scoped
  commands (`go test ./models/`) would otherwise sweep in the
  intentionally-failing repro, turn every baseline red, and hollow out the
  no-worse gate. The repro is judged by its own dedicated gate.

Ephemeral build/test artifacts a suite drops into the repo (`__pycache__`,
`.pytest_cache`, …) are cleaned between phases and recorded per attempt —
never a gate failure, never silent. Any other undeclared change IS a gate
failure (REPRO may only create its declared files; LOCALIZE is read-only).

Failure reasons are fed into retry prompts verbatim ("attempt 2 of 3;
previous attempt failed the gate because: …").

---

## 5. Files on disk, and what a run leaves behind

This section is the **map** — where things live and what each artifact is.
What the code inside those files actually does, and why every decision in
it is what it is, is §6.

```
tools/harness-matrix/
  DESIGN.md               this doc
  README.md               the one-page map (files, flags, honesty rules)
  run-harness.mjs         the scaffold (owns the loop)
  runtimes.mjs            claude-code + antigravity adapters
  agy-trajectory.mjs      post-run harvest of agy's own SQLite record of a run
  audit.mjs               post-run intent audit of claude-code trajectories
  Dockerfile              sealed execution image: base + git seal + coreutils (no agent)
  policies/
     all-opus.yaml
     all-gemini-flash-high.yaml
  prompts/
     repro.md  localize.md  patch.md        ({{PLACEHOLDER}} templates)
  grade.mjs               Scale-evaluator wrapper (empty-patch short-circuit,
                          sample from instance+sealed, --block_network, verdict file)
  runs/  (gitignored)
     <instance>/<runtime>--<policy>/<stamp>/
        workdir/                            extracted sealed repo (runtime's cwd)
        out/
           repro.json  repro-baseline.log  repro-files/
           localize.json  baseline.json  baseline.log
           run-in-env.sh
           phases/<phase>-a<n>.{trajectory.jsonl|stdout.log,stderr.log}
           phases/<phase>-a<n>.agy-trajectory/  copies of agy's conversation
                                            databases WITH their -wal/-shm
                                            sidecars (§6.2a — a bare .db
                                            copy reads as empty)
        raw.diff  model.diff  predictions.jsonl
        audit.json                          claude-code runs only (§7)
        manifest.json                       runtime, policy, bindings, per-phase
                                            attempts/gates/wall/cost
        grade/…  grade-verdict.json
```

Usage:

```sh
# From ai-studies-console/ — a claude-code control run (all-opus).
# (The first end-to-end smoke — navidrome × all-opus, 2026-07-21 — used the
#  `antigravity` runtime, which was removed 2026-07-23; see the runtime list
#  above. claude-code is the only wired runtime now.)
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  node tools/harness-matrix/run-harness.mjs \
    --instance-dir studies/swe-pro-corpus/instance_navidrome__navidrome-… \
    --runtime claude-code --policy tools/harness-matrix/policies/all-opus.yaml

# --dry-run         resolved bindings + REPRO prompt printed, nothing executed, $0
# --skip-grade      defer the ~6-min Docker grade (run grade.mjs later)
# --cleanup-images  drop this instance's images when the run ends (see below)
# claude-code runs need CLAUDE_CODE_OAUTH_TOKEN (Max) or ANTHROPIC_API_KEY
```

**Auth & billing regime — which quota a run actually draws on.** A claude-code
cell's driver authenticates one of two ways, and they bill *different accounts*:

- `CLAUDE_CODE_OAUTH_TOKEN` — a token minted by `claude setup-token` from a
  **Claude Max subscription**. The driver then draws on **Claude Code / Max-plan
  quota, NOT the metered Claude API.** This is what we use. The token is supplied
  env-var-only at launch (never written into the repo or committed); env vars do
  not cross shells, so it must be exported in the same shell that starts
  `run-harness.mjs` (its `sk-ant-oat…` prefix marks it an OAuth/subscription
  token, distinct from an `sk-ant-api…` API key).
- `ANTHROPIC_API_KEY` — bills the **metered Claude API wallet** per token. We
  deliberately avoid it for runs: the delegated cell's `cost_basis` asserts the
  driver is a "Max seat — modeled, not wallet-real," and an API key would make
  that false and mix two billing regimes in one run.

Consequence for cost accounting: **every `cost_usd` this harness reports for a
claude-code cell is a CLI-modeled estimate at API list rates, not an API
charge** — the manifest's `cost_basis` says so. The only real wallet spend in a
delegated run is the Gemini **worker**, which bills **Google Vertex (GCP), not
the Claude API**, recorded as raw token counts priced via `getVertexRates`
(regional +10% **for Gemini 3+ only** — Vertex scopes the non-global premium to
"Gemini 3 and later families", so a 2.5 worker in `asia-south1` bills the flat
global rate; see the pricing note). The single code path that *would* touch
the Claude API is the sdk-probe proxy **live test**
(`sdk-probe/test_proxy_live.py` — a few calls to `api.anthropic.com` using the
key in `.env`), a manual SDK investigation that is **not** part of any harness
or Arm-1 run.

`--cleanup-images` is **off by default and deliberately machine-specific.**
A sealed instance image is ~4.4 GB, so a 12-instance cell needs ~52 GB if
nothing is pruned — more than the development Mac has free. On a machine
with disk to spare it should stay off, because the same 12 base images are
reused by every cell and re-pulling them costs real time. It is safe for
integrity on three grounds: no evidence lives inside an image (the diff
anchor `sealed-base` is a git tag in the *extracted* workdir, and every
artifact in §5 is written to host disk); the base image's digest is
recorded in the manifest before deletion, so a re-pull is provably the same
bits rather than probably; and the base is only dropped once a grade has
actually run — under `--skip-grade` it is kept for the deferred grade and
only the sealed layer goes. Cleanup failures warn and never fail a
completed run. The residual risk is availability, not correctness: if the
registry stops serving a recorded digest, that instance cannot be re-run.

Runs are sequential — the Docker VM is 5 GB / 4 CPU on an 8 GB machine
(the G3 OOM rule stands), and §3 explains why that VM is also emulating
every instruction it executes.

---

## 6. The code — every file, and every decision inside it

**What "the code changes" are.** The whole directory landed on
`feat/harness-matrix` as a single commit (2026-07-21) — there is no
previous version of this harness to diff against, so a reviewer reading
the diff is reading the entire design at once. **The change *is* the
harness**, written fresh in this directory, plus the two revisions the
first smoke forced (§6.9). So this section documents all of it, at the
level of *why each decision is what it is*. The bar it is written to: a
reader who lost the code should be able to rebuild an equivalent harness
from this section alone, and a reader who has the code should be able to
check every claim in it against a specific function.

Nothing here is style. Every rule below exists because a specific way of
getting a wrong number was closed off — and where the lesson came from a
prior setup or from the smoke run, it is named.

### 6.0 Division of labour — one file, one job

| File | Owns | Deliberately does NOT |
|---|---|---|
| `run-harness.mjs` | the loop: preflight → seal → extract → phase/gate/retry → diff → manifest → grade | speak to any model, or run any repo command on the host |
| `runtimes.mjs` | one headless CLI invocation per phase, and reporting what it cost | know what a phase means, what a gate is, or when to retry |
| `agy-trajectory.mjs` | recovering agy's own record of an attempt from its local store — verified model pin, step/generation counts, tool histogram — and archiving the databases as evidence | invent a cost: the store's numeric fields are unlabeled, so they are copied verbatim and never converted into tokens or dollars |
| `audit.mjs` | post-run intent scan of the trajectory | change any verdict — it only adds evidence |
| `grade.mjs` | Scale's official evaluator, on sealed data, network blocked | exist anywhere near the agent's process or image |
| `Dockerfile` | the sealed execution image (base + shell utils + git seal) | host an agent, or hold a credential |
| `policies/*.yaml` | which brain, which thinking level, how many attempts, what limits | encode procedure — procedure is the scaffold's, identically for all cells |
| `prompts/*.md` | what the model is asked, byte-identical across runtimes | carry state between phases (contract files do that) |

The split is the study's validity argument, not a tidiness preference. If
any procedural decision lived in `runtimes.mjs`, two runtimes could differ
procedurally, and every result would have a second explanation. So the
adapters are kept small enough that "the procedure was identical" is
verifiable by *reading* them: each `runPhase` is argv construction plus a
telemetry parse — a few dozen lines, no control flow of its own.

### 6.1 `run-harness.mjs` — the scaffold, in execution order

One invocation = one cell × one instance. Its structure follows the run
itself top to bottom; below, each stage with the reason it exists.

**(a) Rules encoded as constants, not scattered as conditions.** Four
constants at the top of the file are the study's operative definitions, and
every gate reads them — so "what counts as a test file" has exactly one
answer in this harness, not one per call site:

- `NULLED_HOSTS` — eight source-code hosts (`github.com`,
  `raw.githubusercontent.com`, `gitlab.com`, `bitbucket.org`, …) nulled
  *inside the execution container*. Package registries are deliberately
  **not** on the list: dependency traffic is legitimate work, fetching the
  upstream repository is fetching the answer.
- `TEST_PATH` — nine patterns defining "this is a test file", spanning the
  corpus's four languages (`_test.go`, `.test.tsx`, `test_*.py`,
  `conftest.py`, `tests/`, `spec/`, `testdata/`, …). Used twice: to strip
  test hunks from the graded diff, and to reject test files as `bug_files`.
- `HARNESS_REPRO_PATH` — the repro marker, `basename` **contains**
  `harness_repro` (§4 explains why "contains", not "starts with").
- `ARTIFACT_PATH` — ephemera a test run drops into the repo
  (`__pycache__`, `.pytest_cache`, `.tox`, …). These are cleaned and
  **recorded**, never treated as a gate violation. Without this list a
  model that merely *ran the suite* would fail a "you changed files"
  gate — the harness would be scoring its own side effects.

**(b) Zero new dependencies.** The repo manages dependencies per package
under pnpm, so a `tools/` script has no root `node_modules`. Rather than
add one, the YAML parser is resolved through the package that already
declares it:

```js
const requireFromPolicyPkg = createRequire(join(ROOT, "packages/policy/package.json"));
const { parse: parseYaml } = requireFromPolicyPkg("yaml");
```

Same parser the policy loader and dashboard already use — so a policy file
cannot parse differently here than it does elsewhere in the repo.

**(c) The flag surface, and why each flag exists.** `--instance-dir`,
`--runtime`, `--policy` are required; `--dry-run` renders bindings and the
REPRO prompt and executes nothing ($0, the way every prompt change is
reviewed); `--skip-grade` defers the ~6-minute Docker grade; and
`--cleanup-images` (§6.9) drops this instance's images when a run ends.
(A former `--agy-no-sandbox` escape hatch was removed with the `antigravity`
runtime on 2026-07-23.)

**(d) `loadPolicy` — every failure a policy can cause, before any spend.**
Since 2026-07-29 this is a thin wrapper over the shared engine
(`packages/policy/core/policy-core.mjs`, §2.4a) — the same code the console's
loader calls, so a policy file cannot validate differently on the two surfaces.

The shared validator checks `version`, `name`, non-empty `models`, unique model
ids, that every id a rule or a composition names actually exists, that each
leaf declares an `adapter` and an `api` the adapter supports, that `api: vertex`
carries an explicit `region` (§2.1), and that a routing target carries
`pricing` (composition members are exempt; malformed pricing is still rejected).
Compositions must declare a non-empty `runtime`, a `composition` of `solo` or
`delegated`, and a `driver`; `delegated` must also name a `worker`, `solo` must
not, and a composition of compositions is refused outright.

The harness layer then adds its own: `retry.type` must be `flat` (the other
three taxonomy entries in §2.3 are explicitly rejected as unimplemented rather
than silently ignored), `max_attempts` an integer 1–5, and all three `limits`
positive numbers. It resolves the per-stage cell **for this runtime** and fails
if the cell is pinned elsewhere:

```
policy <path>: model 'flash-high' is declared for runtime 'claude-code',
  not 'antigravity' — this runtime×policy cell is gated
```

That is the mechanism behind "a gated cell": a cell that must not run yet
cannot be run by accident, and it fails in milliseconds with a sentence
explaining itself — not thirty minutes in with a CLI error. Under the legacy
schema the same gate was a `null` binding; the `runtime` pin on a composition
is its unified-schema equivalent, and legacy snapshots are still gated the old
way because they are still resolved by the old code path (§2.4a).

The delegated form is **claude-code-only by construction**: Claude Code's
driver seat is welded to Anthropic and reaches Gemini only by delegating, so
"delegated" is meaningless on a runtime that swaps its driver brain natively.
The loader says exactly that rather than accepting it.

**(e) The sealed-field gate.** `validateInstance` (from this branch's
`packages/swe-bench`, Pro-aware) is applied to `instance.json` before
anything else touches it, so no gold patch, `test_patch`, or
`fail_to_pass` list can be in the object that prompts are built from.
`sealed.json` is **never read by this script at all** — only `grade.mjs`
opens it, in a different process, against a different image.

**(f) Prompt rendering fails loudly on a missing value.** After
substitution the renderer scans for a surviving `{{PLACEHOLDER}}` and
throws. A prompt that reached a model with the literal text
`{{PROBLEM_STATEMENT}}` in it would produce a garbage attempt that still
*looks* like a measurement — this makes that impossible.

**(g) Preflight is exhaustive and free.** Runtime auth and CLI health
(§6.2), Docker server reachable, and — unless `--skip-grade` — the grading
venv, Scale harness clone and `sealed.json` all verified up front.
Discovering a missing venv *after* a 30-minute agent run wastes the run,
so the check that costs nothing runs first.

**(h) Image naming is a port, not an invention.** The base tag formula
(`sweproBaseTag`, `kinds/lib.mjs`) is a direct port of
`helper_code/image_uri.py`, so the harness pulls exactly the image Scale's
grader will later use. Being a port is the whole point: the tags were
minted by Scale's upload script and we do not control them, so any rule we
"simplify" becomes a request for an image nobody published. Two of its
rules bit us on 2026-07-26 and are now pinned by tests in `lib.test.mjs`:

- **`-vnan` is stripped.** It is the placeholder for instances with no
  environment-setup commit, and the uploader drops it before tagging. The
  harness had been passing the instance id through verbatim. The bug hid
  because it only fires on the two corpus instances that carry the
  placeholder — NodeBB and element-web — while every instance run until
  then ended in a real `-v<sha>` and round-tripped unchanged.
- **element-web is renamed to `element`**, except for one instance id
  upstream hard-codes to keep the full name *and* its `-vnan`.

Both failures surface only after the run's identity frame has printed, as
`docker.io/…: not found` — which reads like a registry outage rather than
a naming bug, so it costs a debugging cycle every time it recurs. The
*sealed* tag derives from the base tag by a 16-character truncated
base64url encoding, because Docker tags cap at 128 characters and the base
tag already approaches that ceiling — the shortening is a length fix, and
collision safety comes from the tag being scoped per instance run.

**(i) Extraction, then four integrity assertions.** The workdir leaves the
sealed image via `docker create` + `docker cp /app/.`, so the one-commit
history and the `sealed-base` tag travel with it. The extraction is then
*proved*, not assumed:

1. `sealed-base` resolves — otherwise there is no diff anchor;
2. `git remote` is empty — otherwise the seal did not travel;
3. `rev-list --count HEAD` is exactly `1` — otherwise history survived and
   the model could read the future;
4. `git status --porcelain` is empty — otherwise the copy itself mutated
   the tree (macOS case-collisions and lost symlinks both do this), and
   every subsequent diff would carry that damage as if the model had done
   it.

All four exit `1` immediately. A study whose diff anchor is unreliable
produces numbers that look fine and mean nothing, so this is the one place
the script is maximally paranoid.

**(j) `run-in-env.sh` — one execution path for the agent and the gates.**
The script *generates* this helper per run, and both the model (told about
it in every prompt) and the gates call it. That identity is deliberate: if
the agent tested one way and the gate judged another, a passing agent could
fail a gate for environmental reasons alone. Inside:

```sh
exec docker run --rm --platform linux/amd64 --memory 3g --cpus 3 \
  --add-host github.com:0.0.0.0 … -e CMD="$*" -v "<workdir>:/app" -w /app \
  # SDLC kind only — see (j.1); the Pro kind emits the script without these:
  -v "<harness>/.pkg-store:/pkg-store" \
  -e npm_config_store_dir=/pkg-store/pnpm -e PNPM_HOME=/pkg-store/pnpm-home \
  -e npm_config_cache=/pkg-store/npm \
  -v "sdlc-nm-<runId>:/app/node_modules" \   # per-run volume — see (j.2)
  <sealed-image> -c 'timeout -k 15 <cmd_timeout_s> bash -c "$CMD"'
```

Three details carry weight. The command travels as an **environment
variable**, not interpolated into the shell line, which removes an entire
class of nested-quoting bugs from commands a model wrote. `timeout -k 15`
inside the container is the command brake; the `--memory`/`--cpus` caps are
the resource brake (the G3 OOM rule). And `execInEnv` adds a host-side
backstop of `cmd_timeout_min + 2` minutes, which exists for a wedged
Docker/Rosetta layer — not for a slow test suite, which the inner
`timeout` already owns.

**(j.1) Why the package store is mounted *outside* `/app`.** The SDLC kind
passes a `pkgStoreDir`; the Pro kind does not, and its script is byte-for-byte
what it always was (a regression test pins this, because changing the Pro
environment would silently invalidate every Pro run already recorded).

pnpm keeps downloaded packages in a content-addressable **store** and
*hardlinks* them into `node_modules` instead of copying. Hardlinks cannot
cross a filesystem boundary. Inside the container there are two filesystems:
`/app` is a bind mount from macOS, everything else — including `$HOME`, where
pnpm's store lives by default — is the container's overlay layer. pnpm does
not error on that split. It **silently relocates the store next to
`node_modules`**, i.e. into `/app`, which is the graded tree.

On 2026-07-26 that put **5,238 store files inside the workdir** and made
`git diff scaffold-base` **61 MB**. Two things then broke, and the second
matters more than the first:

1. `makeGit` used `execFileSync`'s default 1 MB `maxBuffer` (while
   `makeExecInEnv` already used 64 MB), so the diff threw an unhandled
   `ENOBUFS` and killed the run mid-flight — no verdict, spend forfeited.
2. Had only the buffer been raised, the run would have *survived* and the
   requirements stage's "repository untouched" gate would have charged the
   model with 5,238 illegal file writes it never made. **Infrastructure noise
   recorded as model misbehaviour is a worse outcome than a crash**, and it is
   precisely the class of artefact §11 exists to keep out of the record.

So the fix is threefold and each part is load-bearing: the store gets its own
mount at `/pkg-store` (nothing lands in the graded tree, and it is shared
across runs so packages are fetched once); `makeGit` gets the same 64 MB
buffer as its sibling (a pathological diff must fail a *gate*, not kill the
process); and `.pnpm-store`/`.npm`/`.yarn/cache` join `ARTIFACT_PATH` so that
if a store ever does appear in-tree it classifies as cleanable ephemera rather
than violations. `.pkg-store/` is git-ignored and docker-ignored — it sits
inside the SDLC image's build context, and shipping hundreds of MB of tarballs
to the daemon on every build would be pure waste.

The console leg never hit any of this: it runs on the host with no container,
therefore no bind mount and no two-filesystem split; its workdir is not a git
repo, so nothing diffs; and it has no untouched-repo gate to mis-fire.

**(j.2) Why `node_modules` gets a per-run Docker volume.** (j.1) moved the
store off the bind mount and left the other half of the same split in place:
`node_modules` was still on `/app`, i.e. still on the macOS VirtioFS mount.
With the store on a *different* filesystem, pnpm can no longer hardlink at
all — it falls back to **copying** across the boundary, and VirtioFS does not
behave like a native filesystem when a copy collides with an existing name. It
creates a macOS-style ` 2` duplicate directory beside the original instead of
overwriting it. The duplicate shadows the real package tree, and on
2026-07-26 that made a platform-specific optional dependency disappear from an
otherwise successful install:

```
Error: Cannot find module @rollup/rollup-linux-arm64-gnu
```

which is the exact signature of a well-known npm optional-dependency bug
(npm/cli#4828). It is not that bug. Chasing the published remedies burnt
roughly four minutes of *paid driver time* inside a live run before the real
cause was read out of the trajectory — the failure mode of a misleading error
is not the error, it is the confident wrong fix.

So `node_modules` gets its own **per-run named Docker volume**
(`sdlc-nm-<runId>`), created before the container starts and removed on every
exit path — success, pnpm-install failure, chassis-baseline failure, grade
failure. It lives on the container's own filesystem, so installs never cross
the boundary, and it is per-run rather than shared because two runs sharing a
dependency tree would let one run's install state decide another run's
verdict. Two consequences, both accepted deliberately: `node_modules` is **not
visible on the host** during or after a run (the graded diff never wanted it
anyway — it is `ARTIFACT_PATH` ephemera), and the volume must be torn down or
Docker accumulates one per run on an 8 GB Mac. Teardown is `rm -f` wrapped in
a swallow: if the volume is already gone, or the daemon is down, there is
nothing to reclaim and the run's verdict must not be lost to a cleanup error.

**(k) Change classification — how "the phase changed nothing else" is
enforced.** `statusEntries()` parses `git status --porcelain -z`
rename-safely (skipping the second path field of an `R`/`C` entry — the
naive parser mis-reads renames as two mystery files). `classifyChanges
(allowedPaths)` then splits every change into **violations** (fail the
gate, with exact paths quoted into the retry prompt) and **artifacts**
(cleaned, recorded per attempt, never fatal). REPRO passes its declared
repro files as the allow-list; LOCALIZE passes the repro files only, which
is how "read-only phase" is enforced rather than merely requested.

**(l) `withReproHeldOut` — the subtlety that keeps the no-worse gate
meaningful.** The surrounding-suite baseline *and* the post-patch
regression check both run with the `harness_repro` files temporarily moved
out of the tree and restored in a `finally`. Without this, a package-scoped
command like `go test ./models/` sweeps in the intentionally-failing repro,
every baseline is red, and the no-worse gate silently degrades to "always
waived" — a gate that passes everything while appearing to be enforced is
worse than no gate.

**(m) `computeDiff` — why the patch cannot be malformed.** `git add -N .`
first, so files the agent *created* become visible to `git diff` (without
it, new source files silently vanish from the graded patch — a whole
failure mode that would read as "the model didn't fix it"). Then `git diff
sealed-base`, split per file, with test-path and `harness_repro` sections
routed to `stripped` and everything else to `kept`. Stripping is
**returned to the caller** for console warnings and the manifest, never
done silently: a silent stripper would report "the agent edited no tests"
when it had.

Because the patch is computed by git over in-place edits, hunk headers
cannot be wrong by construction — Setup 0's corrupt-diff retries (and
Teja's hunk recount code) have no equivalent here, and nothing was ported.

**(n) The three gates.** Each returns `{pass, reason, warnings[],
artifacts_cleaned[]}` and its `reason` is fed **verbatim** into the next
attempt's prompt. The model is told exactly what to fix, never "try again":

- `gateRepro` — `repro.json` is well-shaped; every declared file is a plain
  repo-relative path, carries the marker, and exists; nothing else changed;
  and then **the reproduction actually fails in the container**. A timeout
  fails the gate too ("must fail fast, not hang") because a hanging repro
  would poison the PATCH gate later. On pass, the repro files are snapshotted
  to `out/repro-files/` for restore-after-failed-attempt.
- `gateLocalize` — `localize.json` is well-shaped; every `bug_file` exists
  and is **not** a test/repro file; the `test_command` is not the repro
  (checked by pattern, so the phase cannot satisfy itself with its own
  reproduction); the phase was read-only. Then the **baseline** is taken
  with the repro held out. A red baseline is allowed (see the waiver); a
  baseline *timeout* is a gate failure, because "scope it tightly" is
  cheap to enforce here and expensive to discover at PATCH.
- `gatePatch` — three gates in order: the repro files survived and a
  non-test source change exists; the repro command **now exits 0** (the
  fail-to-pass flip, which is the actual claim of the study); and the
  surrounding suite is no worse than baseline. If the baseline was already
  red, gate 3 records a **warning** and waives, because an exit code cannot
  count per-test failures across four languages and pretending otherwise
  would be false precision (§7).

**(o) The phase loop.** For each phase, up to `max_attempts`:

- **Reset discipline.** Retries reset to `sealed-base` and `git clean -fd`,
  restoring the repro snapshot for LOCALIZE/PATCH — so attempt *n* is a
  genuine fresh attempt, not attempt *n−1*'s debris re-graded. The stale
  `<phase>.json` is deleted too, so a previous attempt's contract file can
  never satisfy this attempt's gate.
- **Statelessness.** Every attempt is a fresh `-p` invocation whose prompt
  carries the PR description plus prior phases' contract files, injected by
  the script. No runtime conversation state is used anywhere. That is what
  makes context byte-identical across runtimes with very different session
  features — and it is why a runtime with a better memory system cannot win
  this study for a reason the study is not measuring.
- **Pin verification.** The resolved model from claude-code's `init` event
  is compared to the pinned binding and a mismatch is warned loudly and
  recorded. For a delegated binding the driver string is the target, since
  the worker's pin was already validated against `agy models` at preflight.
- **Timeout framing.** A timed-out call that still passed its gate is a
  pass. When the gate failed, the timeout is prefixed onto the reason so
  the retry prompt says "you ran out of clock, *then* this was wrong".
- **Delegation honesty.** `delegationCalls === 0` triggers a loud warning:
  the driver worked alone and the attempt reads as cc×driver, never as a
  worker result.
- **The attempt record** — the row that becomes the evidence:

  ```js
  attempts.push({ attempt, exit_code, timed_out, wall_seconds,
                  cost_usd, num_turns, resolved_model,
                  delegation_calls, gate });
  ```

  Per-attempt wall time is recorded here as `wall_seconds`, and the first
  smoke wrote real values for every attempt (REPRO 1002 s; LOCALIZE 73 /
  11 / 11 s). This matters beyond bookkeeping: for agy cells, wall time and
  attempt count are the *only* comparable axes that exist, because print
  mode reports no tokens and no cost.

On phase failure the loop breaks and resets the workdir, so the finish
step's diff is honestly empty rather than carrying a half-finished attempt.

**(p) The finish block — evidence, then verdict.** Diff and strip →
`model.diff` + `raw.diff`; `predictions.jsonl` in SWE-bench shape;
`audit.json`; then `manifest.json` carrying the policy **sha256** (so a
later policy edit cannot silently reinterpret an old run), the resolved
runtime version, per-phase attempts with gates, base and sealed image ids,
kept/stripped patch files, totals, and the **audit rollup**.

That rollup is a shape decision, not a field list. `audit_flags` and
`integrity_warnings` are each `{total, critical, by_family}`, sitting beside an
`audit_coverage` block, and both kinds build them from the one shared helper
`manifestAuditBlock()` — the same discipline the guard already uses for its
classifiers, applied to the counts. Until 2026-07-29 each was a bare integer,
and the failure that forces the change is downstream, not here: the exporter
sums a column, and summing integers turns "three advisory notes and one
critical finding" into "4" — the single fact a reviewer needs disappears at
exactly the moment several runs are compared. `by_family` earns its place the
same way: it says *which* check fired without the reader opening eight
`audit.json` files.

The back-compat rule is the interesting half. Runs written before that date
recorded only the integer; their critical count was never written down. The
exporter therefore reads a bare integer as **`critical: null` — unknown — and
propagates that null through the batch merge**, so one unknowable run makes the
whole column's critical count read UNKNOWN rather than zero. Coercing it to 0
would have been a one-character choice that manufactured a clean bill of health
for every historical run. Where `audit.json` still sits beside the manifest the
exporter prefers it and recovers the real breakdown, so old runs get a true
answer wherever one is recoverable and an honest blank where it is not.

The cost field is three-way *by design*, because there is no single honest
number across cells:

```js
cost_basis: runtime !== "claude-code"
  ? "$0 enterprise seat; agy print mode reports no usage numbers"
  : delegated
    ? "DRIVER ONLY, cli-reported (Max seat: modeled, not wallet-real); worker
       ran on the agy $0 seat, which reports no usage numbers"
    : "cli-reported (Max seat: modeled, not wallet-real)"
```

`cost_usd: null` therefore always means *not measurable* and never *free
compute* — and for the delegated cell the recorded number is explicitly a
**partial** one, labelled as such, because a partial total presented as a
total is worse than no total.

A grading infra failure is caught, written to `grade-error.txt`, and exits
non-zero — the run's artifacts are all already on disk, and a batch loop
needs to see the failure.

### 6.2 `runtimes.mjs` — the adapters and their contract

```
runPhase({ binding, thinking, prompt, workdir, outDir, logPrefix,
           timeoutMin, budgetUsd })
  → { exitCode, wallSeconds, timedOut,
      costUsd|null, numTurns|null, resolvedModel|null,
      delegationCalls|null, workerUsage|null, logFile }
```

`delegationCalls` is non-null only for the delegated cell (§2.5): worker
invocations counted from the driver trajectory (Bash tool calls whose command
runs `gemini_worker.py`). `null` = not a delegated cell; `0` = the driver made no
delegation this attempt. In a delegated cell a `0` **fails** the attempt in
**every** phase — REPRO, LOCALIZE, and PATCH (the retry is told to delegate) —
because the substantive engineering in each phase, including read-only
localization, must be the worker's, not the driver's. `workerUsage` is the parsed
`worker-usage-*.json` sidecars (real SDK token counts) plus the `task_files`
char-counts (transparency that the driver handed a problem, not a solution) for a
delegated cell, `null` otherwise. *(The `agySandbox` param was dropped 2026-07-23
with the antigravity runtime.)*

**Shared spawn discipline.** `spawnWithTimeout` passes the prompt as a
single argv element — no shell is involved, so no quoting can corrupt it,
and the size limit is `ARG_MAX` (~256 KB), far above any rendered phase
prompt. At the deadline it sends `SIGTERM`, then `SIGKILL` 30 s later. A
`spawn` error (`ENOENT` — CLI missing) is converted into a normal failed
attempt with exit 127 and the error in the stderr log, so an environment
problem travels through the same reporting path as everything else instead
of surfacing as an unhandled rejection.

The rig's failure mode — a 45-minute kill that truncated the final result
event, losing turns and cost — does not recur, because phases here are
short and a phase timeout is a *gate outcome* fed to a retry, not a lost
run.

**claude-code.** Flags all verified present in 2.1.215: `--effort` (the
thinking parity pin), `--max-budget-usd` (per-phase wallet brake),
`--disallowedTools WebFetch WebSearch Task` — WebFetch/WebSearch close the
source-host channel, and `Task` is closed because subagents would blur the
per-phase cost and turn accounting this study reports (the delegated branch
adds `Edit`/`Write`/`NotebookEdit`/`MultiEdit` — see below) — `--add-dir <outDir>`
because contract files live outside the workdir cwd, and `--output-format
stream-json --verbose` for the auditable trajectory. Two env vars
(`DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) keep
egress down to model traffic. Cost, turns and the resolved model are parsed
from that stream tolerantly — a partial final line from a killed run must
not throw.

**claude-code, delegated branch.** When the resolved binding is `{driver,
worker, worker_thinking?}` (the thinking key is omitted for 2.5-flash, §2.1;
`worker` alone is what marks the binding delegated) — the shape the loader
produces from a `composition: delegated` cell, and unchanged by the 2026-07-29
schema unification (§2.4a), so this branch was not touched by it — the adapter
provisions the
`gemini-worker` Skill in a private
`CLAUDE_CONFIG_DIR` under `out/` (never the workdir — it is the diff anchor) and
instructs the driver to delegate all substantive work by shelling out to
`gemini_worker.py` (`--task-file`, `--model <worker>`, `--thinking
<worker_thinking>`, `--workdir`, `--out-dir`, `--usage-file`). The worker runs on
the **Antigravity SDK** (`google-antigravity` → Vertex) and writes a
`worker-usage-*.json` sidecar with real token counts; the adapter reads those
back via `readWorkerUsage`. `countDelegations` counts the Bash tool calls whose
command includes `gemini_worker.py`.

Since 2026-07-26 the sidecar also **names the cable**: `sdk`, `sdk_version`
(read from the installed distribution via `importlib.metadata`, so a rebuilt
venv self-reports rather than drifting from a hardcoded constant),
`vertex_project`, `vertex_location`. This closed a real evidence gap. The
manifest recorded the Claude Code driver by version, and the sidecar recorded
which *model* answered — but nothing in a run's artifacts stated that the
**Antigravity SDK** was the path to it. That is precisely the claim this cell
exists to demonstrate for Google, and it was resting on the reader trusting a
file header. The terminal narrator prints the same fields inline
(`via google-antigravity 0.1.7 -> Vertex asia-south1`) so the cable is visible
in a live run and in a recording of one, not only to someone who opens the
JSON. Version lookup degrades to `"unknown"` rather than raising: evidence is
worth less than the run it describes.

Delegation is **enforced structurally**, not just requested (the 2026-07-23
smoke showed a prose mandate loses to an available Edit tool — §2.5): this branch
adds `Edit`/`Write`/`NotebookEdit`/`MultiEdit` to `--disallowedTools`, so the
driver cannot edit the repo itself; it writes its contract files with a Bash
heredoc instead. The scaffold then **fails** any REPRO/PATCH attempt that records
zero delegations — which also closes the residual Bash `cat >` channel, since no
worker call means no valid artifact — and `audit.mjs` flags any direct-tree Bash
write (`driver-direct-edit`, non-critical) for transparency.

Counting delegations proves the driver handed work off; it says nothing about
*what* was handed off. So `audit.mjs` also parses `--model` and `--thinking`
back off each real `gemini_worker.py` command (heredoc bodies stripped first,
so a task file quoting the command is not mistaken for one) and compares them
to the binding pinned **for that phase** — `delegation-policy-mismatch`,
critical on model, non-critical on thinking. Both kinds pass their per-phase
bindings in as `expectByPhase`, which is what lets a tiered policy be audited
stage by stage instead of against a single run-wide worker.

**antigravity (removed 2026-07-23).** The `agy -p` adapter was deleted when Teja
parked the agy CLI. `runtimes.mjs` keeps a doc-comment marker where it stood,
explaining the removal and the future SDK-harness revival; `agy-trajectory.mjs`
(§6.2a) is retained on disk but no longer imported. For the historical record:
the adapter ran `agy -p --add-dir <workdir> --add-dir <outDir> --model
--dangerously-skip-permissions --print-timeout <n>m [--sandbox]`; `--add-dir` was
mandatory (else agy worked silently in its scratch dir — preflight #70); print
mode emitted prose only, so cost/turns were honestly `null` and the resolved
model was harvested post-run from agy's local store (§6.2a). When the runtime
returns as an SDK harness, it will report usage natively and will not need that
harvest.

**The file-output rule.** Nothing load-bearing is parsed from stdout on
either side; phase results are the contract files the runtime writes. What
*is* read back is telemetry (cost, turns, resolved model), which is
reporting metadata, not phase output. This is the rule that keeps the two
adapters comparable despite one emitting structured JSON and the other
emitting prose.

**Delegated machinery (claude-code only).** `renderWorkerSkill` writes a
`gemini-worker` SKILL.md **per phase**, because workdir, outDir and timeout
are per-run values the skill must quote exactly. It is written into a
per-run `CLAUDE_CONFIG_DIR` under `out/` — never into the workdir, which is
the diff anchor: a `.claude/` directory in the repo would be an undeclared
file and would fail every phase gate. Auth is unaffected because it travels
by environment variable, not through the config dir. `countDelegations`
then counts `Bash` `tool_use` events whose command invokes `gemini_worker.py`
(the SDK worker; was `agy` before the 2026-07-23 swap), which is the cell's
honesty meter.

### 6.2a `agy-trajectory.mjs` — reading agy's own record of the run

> **DORMANT since 2026-07-23.** With the `antigravity` CLI runtime removed, this
> harvester is no longer imported. It is kept on disk as the only decoder of the
> agy CLI's local SQLite store — for the box-1 smoke DBs that already exist and
> any future CLI-vs-SDK comparison. The SDK worker reports usage natively, so the
> live path does not use this. The section below documents it as built.

Added 2026-07-21. This file exists because a load-bearing assumption in this
design was false, and the correction is worth stating plainly rather than
quietly folding in.

**The assumption.** agy `-p` prints prose, emits no JSON stream and reports
no usage numbers, so the adapter returned `costUsd / numTurns /
resolvedModel = null` and §7 recorded "no trajectory exists". From that
followed the study's most uncomfortable property: two of four cells could
not have their model pin verified and could not be intent-audited at all.

**Why it was false.** agy persists every conversation to
`~/.gemini/antigravity-cli/conversations/<uuid>.db` — SQLite with
`trajectory_meta`, `steps` (one row per agent step) and `gen_metadata` (one
row per model generation). Nothing about it is hidden; the payloads are
**protobuf blobs inside SQLite**, so neither `grep` over the run directory
nor a look at stdout reveals anything, and the store reads as absent. This
document even referred to "conversations in its own SQLite store" in one
section while asserting no trajectory existed in another. The contradiction
sat there unexamined because nobody opened the file.

**Why local, not a gateway.** The alternative was a passthrough telemetry
proxy in front of both runtimes. It is rejected on checked evidence, and the
full reasoning is in §2.5's cable table: `agy` has no base-URL override, the
only remaining route is MITM against an authenticated Google enterprise
seat, and agy serves Claude **server-side** via `API_PROVIDER_ANTHROPIC_VERTEX`
so a host-side proxy would see a Google RPC envelope rather than the
Anthropic request. The local store yields more, with no ToS exposure.

**What it recovers, per attempt, into `manifest.json → agy_trajectory`:**

- **The verified model pin.** The smoke's five conversations all record
  `claude-opus-4-6-thinking`. This is the first independent confirmation of
  what an agy cell actually ran — previously the pin rested on the policy
  string alone. When a phase's conversations disagree, `resolved_model` is
  `null` and `resolved_models_all` lists every id found, so a split run is
  visible rather than averaged away.
- **Step and generation counts**, and a **tool histogram**
  (`run_command`, `view_file`, `grep_search`, `write_to_file`, `list_dir`
  in the smoke). Counts are occurrences of a tool name in the step payloads —
  a lower bound on calls, named `tool_name_mentions` for exactly that reason.
- **The databases themselves**, archived to
  `out/phases/<prefix>.agy-trajectory/` before parsing, so a future decoder
  can re-derive everything without re-running the cell.

**What it refuses to claim.** `gen_metadata` holds unlabeled integers that
*behave* like counters (one climbs monotonically across a run against a
constant `160000`; another sits at a constant `64000`). We have protobuf
field numbers and no published schema. Calling those token counts would be
the precise false precision §7 exists to prevent, so `cost_usd` stays
`null` and the integers are never converted. `cost_usd: null` continues to
mean *not measurable*, never *zero compute*.

**Two implementation details that are not incidental.**

1. **The WAL sidecars are mandatory.** agy leaves these databases in WAL
   mode, so the newest rows — meaning the run just executed — live in
   `<db>-wal`. Copying only the `.db` yields a database that reads as empty
   *without erroring*, which is indistinguishable from "the agent did
   nothing". The harvester copies `.db`, `-wal` and `-shm` together and opens
   the **copy** read-write so SQLite can replay the log; the originals are
   never opened for writing, since agy may still be running.
2. **Conversations are matched by workspace URI plus a time window, not by
   agy's index file.** agy maintains `cache/last_conversations.json` mapping
   a directory to a conversation id — but only the most recent one. Each
   `agy -p` call opens a fresh conversation (we never pass `--continue`, by
   design: phases communicate through contract files, not runtime
   conversation state — §6.7), so one three-phase run produces many
   conversations per workdir. The smoke produced **five** for a single run;
   the index file would have surfaced one. Since every phase of a run shares
   the same workspace URI, the spawn-bounded time window is what separates
   one phase's conversations from the next's.

**Its second job: cross-checking the delegated cell.** For a delegated
attempt, `delegation_calls` counts how many times the *driver* invoked `agy`
(read from the driver's trajectory), while this harvest reads the *worker's*
own record. The two together catch a failure neither catches alone: a
non-zero delegation count with **no harvested worker conversation** means
delegations were attempted but no worker session ever materialised — the
exact signature of sub-processes killed by the Bash-tool timeout (P3 defect
4, §9). It also gives the worker half of that cell its only observability;
before this it was entirely a black box.

**Degradation.** `sqlite3` (the CLI — chosen over a driver package to keep
the zero-new-dependency rule of §6.1) may be absent on a future venue. The
harvester then returns `available: false` with the reason stated, and the
run proceeds. A reporting nicety must never abort a completed study run.

### 6.3 `audit.mjs` — intent, not just outcome

The scaffold already makes the known exploits **dead ends**: git history is
erased in the image, source hosts are nulled in the container, test hunks
are stripped from the graded diff. The audit covers the other half —
whether the model *tried*. Roughly 9% of SWE-bench Pro leaderboard
trajectories openly mined git history for the fix; if ours does the same,
the number we publish has to say so even when the attempt failed.

Three exploit families, two of them `critical` (git-history mining, and
fetching a source host — patterns deliberately exclude package registries,
since dependency traffic is legitimate) and one not (test-edit attempts,
already neutralised by the stripper, flagged so the report can say
"attempted, stripped"). Critical flags void an instance in the report
rather than quietly keeping its score.

Observability is **runtime-asymmetric and the audit records that** instead
of papering over it — though the asymmetry is now much narrower than this
design originally claimed. claude-code emits scannable stream-json. agy
print mode emits prose, and this document long paired that with the phrase
"conversations in its own SQLite store" while simultaneously asserting
elsewhere that no agy trajectory existed. Both could not be true. The store
was real, was never opened, and its inaccessibility was assumed rather than
tested; §6.2a now reads it. What remains genuinely asymmetric is the
*depth* of the check: `audit.mjs` runs intent regexes (git-mining,
source-host fetch, test-edit attempts) over claude-code trajectories, while
the agy side currently yields a verified model pin, step/generation counts
and a tool histogram — enough to verify the pin and see what the agent
reached for, not yet enough to run the same intent regexes. So `audit.json`
still carries an explicit gap note, but the note now describes a smaller
gap, and claude-code evidence still carries more weight. The file is also
runnable standalone and exits 1 on any critical flag, so a batch script can
gate.

### 6.4 `grade.mjs` — the verdict comes from Scale, not from us

Scale's own `swe_bench_pro_eval.py`, in local Docker, with
`--block_network` — the same grading shape as the G4 pipeline and the
Setup 1 rig, so verdicts are comparable across all three setups.

The evaluator wants a raw-sample table plus a patches JSON; both are built
**entirely offline** from `instance.json` + `sealed.json` already on disk,
so grading needs no HuggingFace fetch and no `datasets` install. The sample
is emitted as JSONL rather than CSV on purpose: both are accepted, and JSON
escaping is lossless for multi-KB diffs with embedded newlines where CSV
quoting is a bug farm.

The apparent contradiction is worth stating plainly: sealed fields are
*forbidden* near the runtime and *required* here. The grader is exactly the
component that owns gold data. The two never meet — grading pulls the
original frozen Scale image with its own entrypoint, not our sealed
execution image, in a separate process, with networking blocked.

An empty patch short-circuits to `resolved: false, reason: "empty patch"`
without invoking Docker, which keeps the no-patch case cheap and honest.

### 6.5 `Dockerfile` — the sealed execution image

Base instance image + shell utilities + git seal. **No agent layer** — the
rig's node/npm/CLI/unprivileged-user layers are gone, because the runtimes
live on the host and this container only executes repo commands. Nothing in
it ever holds a credential or drives a model.

The seal is the point: stock images ship history **beyond** the task's base
commit (on vuls: 164 future commits including the real fix, plus `origin/*`
refs and a live `github.com` remote — scaleapi/SWE-bench_Pro-os issue #93).
`git log --all` would hand over the answer. The fix erases history
entirely — `rm -rf .git`, re-init, one commit, no remotes, no reflog, no
tags but ours — and tags that commit `sealed-base`, which is the diff
anchor that later travels to the host with the extracted workdir. The
original base SHA is kept in the commit *subject* for audit; it is public
instance metadata (it is embedded in the instance id), not sealed data.

A contrast worth recording, because it explains why the seal is new here
when Setup 0 — the plain "G4" Node pipeline in the §1 lineage table —
never needed one: G4's model-facing workspaces were full-history GitHub
clones (`--filter=blob:none` partial clones in
`.repo-cache`, worktrees at `base_commit`) — history sat on disk, but
localize and patch were single API calls whose runner pasted selected
file text into the prompt. A model that executes nothing cannot run
`git log`, so the leak was inert. This harness is the first leg to put
an agent with a shell inside the repo, which is exactly what arms the
leak; the seal follows from that. The exploit lives in the pair
(history on disk + agent with hands), not in the history alone — the
mitigation follows the agent, not the data.

The shell-utils layer is the one part revised after the smoke (§6.9).

### 6.6 `policies/*.yaml` — the only file a new cell needs

A policy names **leaf** model × adapter × API entries, the **compositions**
(cells) that combine them and pin a runtime, a `rules[]` stage→cell mapping,
the retry ladder, and limits — the unified schema shared with the console since
2026-07-29 (§2.4a). Four exist:

| file | cells | what it is for |
|---|---|---|
| `all-opus` | `opus` (solo) | the anchor, §2.2 |
| `all-gemini-flash-high` | `flash-high` (delegated → 3.5 Flash @ HIGH) | the cc×agSDK column, §2.5 |
| `all-gemini-25-flash-high` | `flash-25-high` (delegated → 2.5 Flash, no tier) | the cross-generation column |
| `gemini35-plus-25-flash-high` | `flash-35-high` + `flash-25-high` | the tiered column — mirrors `opus-plus-flash.yaml`'s split |

Each carries its rationale as a header comment, so the reason a pin exists
travels with the pin. `all-opus.yaml` holds the canonical migration essay and
the canonical `limits` rationale; the other three point at it rather than
restating them.

Three structural consequences are worth naming because they are what make the
matrix cheap to extend. Per-stage `rules[]` mean a **mixed** policy
(`opus-localize` + `flash-patch`, mirroring G4's split, which is what Google's
ask 2 actually describes) is a new YAML file and zero code. A composition's
`runtime` pin is a first-class gate meaning "this cell may not run here",
enforced at load time — so an unfinished cell is *unrunnable*, not merely
undocumented. And because a leaf names its own adapter and API, adding a second
way to reach the same model (MCP instead of the SDK, AI Studio instead of
Vertex) is another leaf entry with its own id — not a code change, and not an
undeclared change to what a recorded run means.

### 6.7 `prompts/*.md` — byte-identical across runtimes

Three templates with `{{PLACEHOLDER}}` slots. Each states its phase, its
single job, its hard prohibitions, and the exact JSON contract it must
write. Each also teaches the same one thing about the environment: this
machine does not have the repository's toolchain, so every build/test
command goes through `run-in-env.sh`.

They are the same bytes for every runtime — that is the whole point.
Runtime-specific prompt tuning would be the single fastest way to turn this
study into a measurement of our prompt-writing. Context between phases
arrives *inside* the prompt as injected contract files
(`{{REPRO_JSON}}`, `{{LOCALIZE_JSON}}`, `{{BASELINE_EXIT}}`), never via a
runtime's conversation state.

### 6.8 `.gitignore` — what is evidence and what is bulk

`runs/**` is ignored: extracted workdirs are full repository checkouts, and
trajectories and diffs are large and machine-local — 880 MB against 760 KB of
the part that matters. Aggregate evidence reaches the repository through the
dashboard's `instances.json` export layer (§8).

One carve-out, added 2026-07-28: `runs/*/*/*/evidence-bundle/delegation/*` is
un-ignored, so the driver→worker hand-offs and the worker's own usage receipts
are committed — 134 files across the ten delegated runs, growing by ~12 per run.
Those are the files a reader opens to check the provenance claim for themselves,
and a claim whose evidence lives only on one laptop is an assertion. The pattern
is `runs/**` rather than `runs/` because git does not descend into an excluded
*directory* at all, so the un-ignore exceptions need the parent levels listed
explicitly above them.

### 6.8a `scrub-paths.mjs` — what is allowed to leave

Committing that evidence into *this* repo and publishing it into a *public* one
are different acts. The recorded files carry the authoring machine's absolute
paths — 287 occurrences, in four nested shapes: the harness directory, the repo
root, `~/.gemini/antigravity/brain/<session>`, and bare `$HOME`. That is not a
secret; a home directory name is not a credential. It is irreversible: once the
bytes are in a public git history they are in every clone and every fork, and
retracting them means rewriting the history of a repository other people have
already cloned.

`scrubText` rewrites the four shapes to `/harness`, `/repo` and `/home/user`,
**longest prefix first**. The ordering is the entire substance of the module and
its failure mode is silent: apply the `$HOME` rule first and it matches inside
the harness path too, producing `/home/user/Desktop/<repo>/tools/harness-matrix`
— no `/Users/` remaining, so a naive check passes, and the directory layout is
published anyway. `/harness` is not a free choice either: the fifty frozen
corpus files already use it, and a second name for the same directory would mean
the published evidence and the published fixtures disagree. `/app` was
deliberately not reused for any placeholder — it is the container's real
`WORKDIR`, and a placeholder colliding with a genuine in-container path leaves a
reader unable to tell a substitution from a location.

Two guarantees sit on top of the substitution:

- **Nothing under `runs/` is opened for writing.** `scrubTree` reads from the run
  directory and writes to a separate destination. A sanitiser that edited the
  record would destroy the thing it was preparing to publish.
- **A substitution may not move a lint verdict.** Before emitting a hand-off,
  both forms go through `lintDelegationText` and the family sets must match, with
  `workdir`/`outDir` scrubbed alongside the text so `bashEditsTree` resolves in
  one consistent world rather than two. Otherwise the extracted repo could report
  different delegation findings than the dashboard does, from files that look
  byte-plausible, and both numbers would be internally consistent enough that
  nobody would catch it. The corpus builder gave this guarantee once by hand for
  fifty files; this enforces it on every extraction.

`assertNoHostPaths` then walks the output and throws, naming every offending
file. It uses an independent detector rather than re-running the rules — an
assertion that shares logic with the thing it checks cannot fail when that logic
is what is wrong — and it flags both a surviving `/Users/` and a *partially*
rewritten path that kept the repo's directory name. The reason it is an
assertion and not a review step: every subsequent delegated run writes ~12 more
files carrying these paths, and the next extraction happens long after the day
someone was told to look.

That detector is deliberately narrow about what counts as a *partially* rewritten
path. It requires at least one ancestor segment before the repo directory name,
rejects an ancestor segment containing a dot, and refuses to match when the
candidate is preceded by a word character. Without those three narrowings it
fired on `github.com/<org>/<repo>`, on
`aiplatform.googleapis.com/v1beta1/projects/<repo>`, and on a bare `/Users/` in
prose — ten false positives on the first real extraction. The fix had to be
structural rather than an allow-list: an allow-list of known-good files rots the
moment a new document mentions the repo by name, and it rots silently in the
direction of publishing something.

### 6.8b `extract-repo.mjs` — the published repo is a build output

The extraction is a script, not a prompt-driven copy, because it is not a
one-time act: every delegated run adds ~12 evidence files, the hand-off lint
keeps moving, and the published copy has to keep agreeing with the dashboard. A
script is also the only place where the scrub is *guaranteed* to run.

It takes `tools/harness-matrix/` **whole** — both kinds, both kinds' tests, the
frozen corpus, every run's delegation evidence — plus the five `packages/` files
and three root directories the harness actually reaches at run time. Both kinds
ship together because they are not honestly separable: eleven test files
reference SDLC, both files pinning `DICTATION_MIN_LINES = 9` are SDLC hand-offs,
and the shipped SDLC implementation doc states the 19/24 attribution leak —
publishing that sentence while withholding the runs behind it is selective
publication. Directory depths are preserved exactly, so no import path is
rewritten and the code Google runs is byte-identical to the code that produced
the evidence Google is shown.

One file ships that no import audit could ever have found:
`tools/swe/fetch-instances-pro.mjs`. Nothing under `tools/harness-matrix`
imports it, but the Pro kind's `--instance-dir` names a directory that script
and only that script produces. Shipping ten runs' worth of Pro evidence while
withholding the one tool that rebuilds their inputs would make the Pro leg
unreproducible by construction. It is safe to publish on its own terms — four
`node:` imports, no monorepo dependency, and it reads the *public* split through
the HuggingFace datasets-server API, so it needs no credential.

**The generated README is an operator manual, not a summary.** The first version
was 86 lines and described what the harness is, on the assumption that a reader
who wanted to run it would go read this document. That assumption does not hold
for this audience: the recipient has no access to this monorepo, no access to
our GCP project, and no way to ask a question and get an answer the same hour.
Anything not in that README is unavailable to them. So it states every step from
`git clone` to a graded run of **both** kinds, at equal depth, including the
steps that are awkward to state — that `gemini_worker.py` falls back to *our*
project id and must be overridden, that the Homebrew venv needs an `expat`
workaround, that the Pro corpus, the pinned Scale evaluator clone and the second
grading venv are not shipped and must be built. It documents the SDLC kind's run
path *first*, because SDLC is the only live path needing no corpus and no
evaluator, and is therefore the cheapest way for a reader to prove the cable
works before investing in the Pro setup. `extract-repo.test.mjs` asserts the
fifteen steps a reader could not recover from by inspection, so a later edit
cannot quietly trim it back to a summary.

Two guards close the two ways a correct-looking extraction can be wrong.
`assertNoHostPaths` is described above. `assertImportsResolve` walks every
emitted `.mjs` and resolves each relative specifier against the output tree,
because the original dependency audit grepped only *bare* specifiers and so never
saw `../lib/benchmark-brief.mjs` climbing out of the harness directory — a miss
that surfaced as 37 failing tests in the extracted repo rather than as an error
here. Files read *by path* at run time (`templates/`, `scaffolds/`) are invisible
to any import audit and are carried explicitly.

The published repo is a **build output and is never hand-edited**: change lands
here → `extract-repo.mjs --force` → `git add -A` → commit → push, in place, in
the same clone. `--force` therefore replaces every file except `.git`, whose
deletion would orphan the published history on the first sync. The output is
deterministic — no timestamp, no source SHA — so that after a re-extraction an
empty `git status` in the public repo *means* nothing publishable changed, which
is the signal for whether a push is needed at all.

### 6.9 The two revisions the first smoke forced

Both were written during the run described in §10, and both are the kind of
change that only a real execution surfaces.

**1. `Dockerfile`: branch on the package manager instead of assuming
Alpine.** The rig was verified against vuls, which is Alpine/musl, so the
shell-utils layer inherited `apk add` as though the sweap images shared one
base OS. The first harness-matrix smoke drew navidrome, which is Debian 12,
and the build died on `apk: not found` before any model ran. The layer now
branches: Alpine **always** installs bash + GNU coreutils (there `timeout`
and `sh` exist as BusyBox applets, so a mere presence check would pass while
the applets still behave differently from GNU under `timeout -k … bash -c`);
Debian-family installs only if something is genuinely missing; and a base
matching neither branch **fails the build loudly**. That last clause is the
important one — without it a missing tool resurfaces much later as an
unexplained phase failure, which is exactly the shape of bug that quietly
corrupts a study. Verified on navidrome: Debian 12, GNU bash 5.2.15, GNU
coreutils 9.1, seal intact.

**2. `run-harness.mjs`: the opt-in `--cleanup-images` flag.** A sealed
instance image is ~4.4 GB, so a 12-instance cell needs ~52 GB if nothing is
pruned — more than the development Mac has free. The flag is **off by
default** because "delete the images" is a fact about a machine, not about
the study: where disk allows, the same 12 base images are reused by every
cell and re-pulling costs real time. Its safety argument is spelled out in
§5 and in the code comment: no evidence lives in an image, the diff anchor
is a git tag in the *extracted* workdir, and the base image digest is
recorded in the manifest before deletion so a re-pull is provably identical.
The base image is only dropped once a grade has actually run; under
`--skip-grade` only the thin sealed layer goes. Cleanup failures warn and
never fail a completed run.

**A correction that belongs in the record.** A third item was briefly
carried here as a defect — "per-attempt wall time is not reaching the
manifest". It was not a defect. The manifest field is `wall_seconds`, and
the first smoke recorded it correctly on every attempt (1002 / 73 / 11 / 11
seconds); the claim came from querying the manifest with the wrong key. It
is left visible here rather than deleted, because a design doc that silently
removes its own retracted claims is less trustworthy than one that shows
them being retracted. **Two** scaffold-level defects remain open, not three
(§9, P3).

---

## 7. Integrity and honesty

| Concern | This design |
|---|---|
| Sealed fields near prompts | `validateInstance` (Pro-aware, from this branch's `packages/swe-bench`) throws pre-run |
| Git-history leak (Pro issue #93 — on vuls: 164 future commits + live remote) | workdir extracted from the sealed image: one commit, no remotes, `sealed-base` tag |
| Source-host fetch | nulls (`--add-host github.com:0.0.0.0` …) apply inside the execution container; the runtime process is on the host with real DNS. Mitigations: claude-code runs `--disallowedTools WebFetch,WebSearch,Task` + full trajectory audit; agy runs `--sandbox`. Residual risk in agy cells is **stated in the report**, not hidden. |
| Test tampering | test-path hunks + `harness_repro*` stripped from the graded diff, loudly |
| Intent audit | claude-code: per-phase trajectories scanned (git-mining / fetch / test-edit regexes, as in the rig). agy: a trajectory **does** exist — this row previously read "no trajectory exists", which was wrong; agy persists every conversation to a local SQLite store, harvested per attempt into `agy_trajectory` (§6.2a), giving a verified model pin, step/generation counts and a tool histogram. The remaining gap is depth, not existence: the intent regexes do not yet run over the agy side, so `audit.json` still records a (smaller) gap and claude-code evidence still carries more weight. |
| Grading | Scale's own `swe_bench_pro_eval.py`, local Docker, `--block_network` — leaderboard-identical verdicts |
| Tokenomics | claude-code × Max = *modeled* cost (report as such; wallet $0). claude-code × API/gateway = wallet-real (pricing preflight gate first). agy = $0 seat, **no token counts** — comparable axes are resolved-rate, wall time, attempts; never invent token estimates. |
| Seat rationing (§2.6) | agy is $0 **and quota-limited**: a hard per-user allowance, invisible (no usage/quota command exists) and unqueryable, with a ~164 h reset. `cost_usd: null` means *not measurable* — it never means *unlimited*. A cell split across a quota reset discloses the gap. |
| Execution venue (§3) | amd64 images emulated on an arm64 host, with a slow host bind mount, means environment latency is billed to the model's phase budget. The venue is held constant across all cells and stamped in every manifest; a mixed-venue matrix would measure hardware, not harness. |
| No-worse waiver | exit codes can't count test failures across four languages; when the baseline is already red, gate 3 records a warning instead of failing. Per-language failure-set diffing is a listed refinement. |
| Delegated cell (§2.5) | two-model by construction — reported as "Opus driver → Flash worker via Antigravity", never as pure Gemini; per-attempt `delegation_calls` in the manifest; 0-delegation attempts loudly flagged; cost basis "DRIVER ONLY". |
| Service-heavy suites | some repos' tests need services the bare container lacks (NodeBB → mongo/redis); prompts steer to dependency-free repro commands, and the baseline snapshot absorbs environment-red fairly (same red pre and post patch). |

Logging is **local run dirs** (G4 pattern) — *and, since 2026-07-24, a
second, independent ledger in BigQuery.*

This paragraph used to end "No BigQuery — that is the SDLC track's payload
table, a different study." That was true when written and is now wrong in a
way worth spelling out, because the two BigQuery tables in this programme
are easy to conflate:

| | SDLC track's table | This study's table |
|---|---|---|
| What | `llm_requests`, our own schema | Vertex AI `request_response_logging`, Google's schema |
| Written by | the console's adapters, in our code | Vertex, server-side |
| Covers | console orchestrator calls | every call to the **worker model** |
| Enabled how | code change + loader | one project-level switch, **no harness changes at all** |

The switch was thrown on 2026-07-24 for `gemini-3.5-flash` on project
`ai-studies-console` in `asia-south1` at 100% sampling. Because the config
is scoped to *model + project + region* — and `gemini_worker.py` is the only
thing in this harness that calls that model in that project and region —
**every row in that table is an Antigravity SDK worker hand-off**, captured
verbatim, request and response. That is the evidence, and it needs no
column saying so.

Two things it deliberately does not give you. There is no `phase` column:
`repro` / `localize` / `patch` are legible in those rows only because the
harness's own prompt text names them, and the SDLC kind's stage names will
appear the same way. And the **driver** side is absent — Claude Code's
calls travel over its own seat and never touch Vertex, so BigQuery is the
worker ledger only. The driver half stays evidenced by the run dirs. Two
ledgers, independently produced, cross-checkable hand-off by hand-off
against the `worker_usage` sidecars: strictly better than either alone.

### 7.1 What is guarded by tests, and why those things

A harness study is a machine for producing numbers other people will quote.
The failure mode that matters is not a crash — a crash is loud — it is a
rule that quietly stops being enforced while every surface keeps rendering
perfectly. These rules are load-bearing enough to be pinned by tests:

| Rule | Test | What its silent failure would look like |
|---|---|---|
| The driver may not touch the repository before it delegates | `guard.test.mjs` — classifiers **and** the generated hook driven end-to-end (JSON on stdin → decision on stdout) | The study still reports delegations, but the driver did the engineering and the worker rubber-stamped it. This is not hypothetical: the 2026-07-24 smoke is exactly that failure, caught by hand. |
| The worker's clock is strictly nested inside the phase clock | `guard.test.mjs` — the invariant across a range of phase budgets, plus the rendered Skill text | A worker killed at the same instant as its driver, recorded as a model failure. Three of the four §11 defects were this bug at three different depths. |
| An unmeasured cost stays `n/a`, never `$0.0000` | `logfmt.test.mjs` | A cell whose CLI was killed reads as *free* in a comparison table. |
| The two wallets are computed from separate evidence and never blended | `export-dashboard.test.mjs` | Driver and worker spend become one unexplained number, and the cost-per-resolved figure stops meaning anything. |
| The terminal may not invent provenance | `guard.test.mjs` — the `via <sdk> <version> -> Vertex <region>` clause renders when the worker recorded it and **vanishes entirely** when it did not | Sidecars written before 2026-07-26 carry no `sdk` key. A line reading `via undefined` would be fabricating the cable on the one line whose entire job is to name the cable — and naming the cable *is* the delegated cell's claim. |
| Every printed line fits the 80-column grid | `logfmt.test.mjs` (the wrapper's own contract) **and** `logrender.test.mjs` (replays every run in `runs/` and measures the real output) | A terminal wraps at the window edge with *zero* indent, so an over-long line returns to column 0 and merges with the next one. On the screenshare the delegation evidence turns to pulp precisely where a viewer is looking hardest — and nothing errors. Source review passed these lines repeatedly; rendering a finished run and measuring it found 87 of 352 over the limit, the worst at 176 columns. |
| A replayed log cannot quietly disagree with the run it replays | `logrender.test.mjs` — the frames render from a descriptor alone, and the same functions serve the live run and the replay | The rehearsal used to be a second implementation of the frames, so demo copy could be signed off against wording the live run never prints. The failure is silent by definition: the rehearsal looks right. |
| A `--dry-run` preview cannot quietly disagree with the paid run it previews | `kinds/sdlc.test.mjs` — the descriptor is built once, above the dry-run branch, and the preview's frame is asserted equal to the frame replay rebuilds from a finished run's `manifest.json` | Same failure mode one step earlier: the dry run used to print its own `task : / template : / policy :` summary, which is the *only* view available for a column nobody has paid for yet. A preview that shows what the run will not show is worse than no preview — and the two rows that legitimately differ (`runtime`, `started`) are pinned too, with `started` reading `— not started` rather than a plausible timestamp that a screenshot could not distinguish from a real run. |
| A published test count may never read greener than the run was | `grade.test.mjs` — `parseVitestCounts` reads each labelled outcome segment independently, and a line with neither `failed` nor `passed` stays `null` | Found 2026-07-27. The parser was one positional regex assuming `failed` is immediately followed by `passed`. Vitest emits one segment per non-empty outcome class, so on `Tests 2 failed \| 1 skipped \| 10 passed (13)` the optional group could not match and the function returned **`failed: 0`** — a run with two real failures publishing a clean green as evidence. The mirror case, `1 skipped \| 12 passed`, matched nothing and threw away honest counts. Both are silent: the number renders perfectly either way. |
| The Pro kind's `--dry-run` is a preview of the run it claims to preview | `kinds/swepro.test.mjs` — the phases and their `driver → worker` binding, the policy's own models, no plausible ISO timestamp, the 80-column grid | Added 2026-07-27. The row above pinned this for the SDLC kind only, which left the kind that runs the benchmark we publish **externally** as the one with no offline preview contract at all — the higher blast radius guarded by less. |
| The hand-off content lint still means what its numbers say | `delegation-corpus.test.mjs` — 50 real labelled hand-offs replayed through the lint, per-row families pinned, the 8-vs-9 threshold margin re-derived from the files themselves | Added 2026-07-29 (finding C4). This is the only rule here whose failure is a *documentation* failure with teeth: the lint blocks nothing and voids nothing, so widening it costs no run and breaks no gate — it just makes the sentence "no dictated passages were found" cheaper than it reads. Uncommitted, the corpus made every published figure an assertion about files on one laptop. The mirror failure is as bad and even quieter: narrowing a rule until real dictations stop being caught produces a *cleaner* record, which is exactly what nobody would go looking for. |
| The exported manifest names the runtime that drove the run | `export-dashboard.test.mjs` | The Compare table's "Runtime" row has nothing to derive from, so a harness run is labelled *Console orchestrator* — or, in the mirror failure that actually shipped, a console run is labelled with an agent CLI it never used. Either way the study's central harness-vs-console distinction is quietly inverted on screen. |

Two further properties are tested because the tests themselves would
otherwise be dangerous to run: the exporter's default output directory is the
dashboard's **checked-in** `public/data`, so `--out` isolation and `--dry-run`
writing *literally nothing* are asserted before anything else. The exporter is
driven as a subprocess rather than imported, because it parses `process.argv`
and calls `process.exit` at module scope.

The whole suite is **$0 and offline** — no model, no Docker, no network —
which is what makes "a change ships with its tests" a rule with no cost
argument against it. `pnpm test` runs the workspace packages and this suite
together; before 2026-07-25 `tools/` was not reachable from any root script.

---

## 8. Dashboard: Compare Runs

The Pro branch already gives per-instance depth: the exporter emits
`instances.json` (totals / escalation / per-instance verdict, attempts,
tests, patch stats) and `StudyInstances.tsx` renders it (verdict chips,
sortable table, expandable `EvidencePanel`). The harness study reuses
that layer and adds the cross-run comparison:

- **Exporter**: each run exports an `instances.json`-compatible file plus
  a `harness` block — `{ runtime, policy, per-instance: { phases: [
  { phase, attempts, gate_failures[], wall_seconds, cost_usd|null } ] } }`
  — field names carried over from `manifest.json` verbatim, so any number
  on the dashboard can be traced back to the run directory it came from.
  Existing per-instance fields (verdict, attempts, tests, patch_files,
  patch_stats) keep their schema so `StudyInstances` components render
  harness runs unchanged.
- **Compare Runs tab** (new view, same file-pattern as `StudyInstances`):
  rows = the frozen instances; columns = runs, each labeled
  **runtime · policy** (`claude-code · all-opus`, `antigravity ·
  all-gemini-flash-high`); cells = verdict chips (reusing
  `VERDICT_TONE`/`VERDICT_LABEL`), with a phase-failure marker when a run
  died at a gate (`repro ✗ ×3`). Clicking a cell opens the per-instance
  depth panel — the `EvidencePanel` pattern extended with the phase/
  attempt/gate-failure trail. Footer row: resolved-rate, cost-where-known,
  wall time per run.
- Same-instance-set rule: the tab only compares runs over the same frozen
  instance ids (all 12, §2); anything else refuses to render as a
  comparison. It must also refuse to place the two crosses side by side as
  a finding (§1.3) and must surface the venue stamp (§3), so a
  mixed-venue or mixed-model pair cannot be read as a harness result.

- **Which track drove a run is derived from the manifest, never assumed.**
  The exporter carries `runtime` into the exported `harness` block, and the
  Compare table's "Runtime" row reads `manifest.harness.runtime` to decide
  what it prints. A **console** study has no such field at all: the console
  orchestrator walks the template's stages through adapters and no agent CLI
  is involved anywhere, so its columns read *Console orchestrator* while a
  harness column reads the CLI and its version. That absence is precisely
  what makes it an honest test, and it is why the row may not be hardcoded —
  it was, briefly, and printed "Claude Code" across four console SDLC
  columns, asserting the opposite of this study's whole finding without
  anything on screen looking wrong.

  The guard for it lives in `export-dashboard.test.mjs` rather than beside
  the view, because **the dashboard workspace has no test runner** — it
  builds through `vite build` (esbuild transpile, no type check) and has no
  vitest of its own. So the tested half is the upstream contract: the
  exporter must keep writing `harness.runtime.name` + `.version`. The
  downstream half — that the view keeps deriving rather than hardcoding — is
  currently held by review, and would be worth closing by giving the
  dashboard a test runner and a `typecheck` script. State it as a gap rather
  than treating the exporter test as full coverage.

Dashboard work ships as its own commits after the first two runs exist
(real data to render), reusing the copy-precision rules that govern the
studies dashboard.

---

## 9. Execution order

Three preconditions apply to every step below, all opened by the first
smoke (§10) and none of them yet closed:

- **P1 — quota.** Steps 2, 3 and 5 all draw on the one agy seat, which is
  exhausted until ~2026-07-28 (§2.6). Nothing that touches agy can run
  before then, on any machine.
- **P2 — venue.** The execution venue must be fixed before the *first*
  cell runs and held for all four (§3). Deciding it after cell 1 would
  strand that cell on a different platform and void the comparison.
- **P3 — recorded defects.** Four were recorded. **Three are fixed
  (2026-07-25); one remains open.** Each corrupts the evidence rather than
  merely slowing it, and each is policy- or scaffold-level, so all must land
  before any cell is run for the record, never mid-matrix. All three fixes
  therefore shipped in one commit, applied to both policy files together.

  The three were the same mistake at three depths — **a nested budget that
  could equal or exceed the budget it sits inside**. Read them as one bug
  with three instances, because that is how they were fixed.

  1. ~~`cmd_timeout_min` == `phase_timeout_min`~~ (§2.4) — converted
     environment latency into apparent runtime failure. **FIXED**: 15 vs 45,
     a 1:3 ratio, so a stalled container command costs a third of the attempt
     instead of all of it.
  2. **OPEN — Fatal errors consuming retries** (§2.3, §2.6) — inflates the
     attempt counts that are a headline number of this study, with attempts
     no model ever saw. Unlike the other three this is not an arithmetic fix:
     it needs the runtime to classify infra failure apart from model failure
     before `runStageAttempts` decides whether to spend an attempt. Left open
     deliberately rather than rushed alongside the timeout work. Its blast
     radius is bounded and known: it can only ever make a cell look *worse*
     than it was, never better, so a passing run is unaffected and a failing
     one is re-readable from the per-attempt logs.
  3. ~~**Delegated cell: the worker is handed the driver's entire clock.**~~
     `renderWorkerSkill` rendered the worker's `--timeout` as
     `phase_timeout_min`, so a single worker call was authorised to consume
     the whole phase — leaving the driver no runway to verify the result,
     re-delegate, or write the contract file the gate requires. The same
     nesting error as (1), one level deeper. **FIXED**, and the fix is the
     arithmetic this entry predicted: `workerTimeoutMin()` in `runtimes.mjs`
     gives the worker 60% of the phase and clamps it strictly below the
     phase, so a future policy cannot reintroduce the equality through
     rounding. Guarded by two tests in `guard.test.mjs` — one on the function
     across a range of phase budgets, one on the rendered Skill text itself.
  4. ~~**Delegated cell: the transport caps a delegation below the length of
     the work.**~~ The driver reaches the worker by running it through Claude
     Code's **Bash tool**, whose timeout is 120 s by default and 600 s
     maximum — raisable only via `BASH_DEFAULT_TIMEOUT_MS` /
     `BASH_MAX_TIMEOUT_MS`, neither of which the adapter's env block set —
     while the Skill never instructed the driver to pass an explicit timeout.
     (3) and (4) therefore contradicted each other *in code*: the Skill wrote
     a cheque for the whole phase that the transport would not cash. The
     smoke's REPRO phase legitimately needed **1002 s**, so a delegated REPRO
     would be killed and retried repeatedly. What the driver does after the
     kill — keep re-delegating, or finish the job itself — was **not known
     and must not be guessed**; the second outcome would yield a run that is
     really cc×Opus while carrying a healthy non-zero `delegation_calls`,
     which is the one failure shape that counter cannot see. **FIXED**: the
     delegated branch of `runPhase` now sets both env vars to the worker's
     slice plus a two-minute margin, so the worker's own `--timeout` always
     fires first — a self-timeout still writes its usage sidecar and prints a
     diagnosable message, where a Bash-tool kill is opaque to the driver and
     the manifest alike. The 2026-07-24 navidrome run completed 7 hand-offs
     under the old default only because each happened to land inside 120 s;
     that was luck, not design, and SDLC EXECUTE would not have repeated it.

  (A fifth item, "per-attempt wall time missing", was recorded here and then
  **retracted**: it was a query error, not a defect — see §6.9.)

1. ~~**$0 scaffold smoke**~~ — **done 2026-07-21** on navidrome (not vuls),
   `antigravity × all-opus`. Extraction, helper, REPRO gate, stripping,
   manifest, audit and grade wrapper all proved out; the run itself ended
   unresolved at LOCALIZE on quota. Full account in §10.
2. **antigravity × all-opus**, full frozen set, sequential — *blocked by
   P1.* This is Google ask 3a.
3. **antigravity × all-gemini-flash-high**, full set — *blocked by P1*,
   unless the quota turns out to be a per-model pool rather than seat-wide
   (§2.6, unresolved; one cheap probe settles it).
4. **claude-code × all-opus** — gated on explicit go (Max capacity). The
   only cell with no agy dependency, therefore the only one runnable
   during a quota outage; it is also the control that makes 3a readable
   (§1.3).
5. **claude-code × all-gemini-flash-high** (delegated, §2.5) — gated on
   explicit go; its own 1-instance smoke first (proves Skill discovery
   under the relocated config dir + real delegation counts), then the 12.
   *Blocked by P1*: its worker half is the agy seat. This is Google ask 3b.
6. Exporter + Compare Runs tab on real data.
7. Matrix report: resolved-rate / cost-where-known / wall / per-phase
   retry heat map → picks where thinking-ladder / model-ladder /
   cross-model policies (§2.3) get tried next.

Note what P1 does to the shape of this study: **quota, not wall clock and
not dollars, is the scarce resource**, and it is invisible and refills on a
multi-day cycle. Sequencing is therefore a scheduling problem against a
budget nobody can read, which is itself worth reporting to Google — the two
cells they asked for by name are the two most exposed to it.

---

## 10. Run log — smoke 1 (2026-07-21, navidrome × antigravity × all-opus)

The first end-to-end execution of the scaffold. It is recorded here in full
because five of this document's rules were written *from* it, and a reader
who does not know what happened cannot judge whether those rules are
justified.

**Instance.** `instance_navidrome__navidrome-3bc9e75b…` — Go, Debian 12
base, the cache-expiry bug (`SimpleCache` does not evict expired items, so
`Keys()`/`Values()` return stale entries). Chosen as the first smoke rather
than vuls, which is what §5 and §9 previously assumed.

**Outcome.** `phases FAILED at localize after 4 total attempt(s) — no patch
submitted.` Wall 1249 s, cost `n/a`, audit flags 0, `model.diff` empty,
verdict `unresolved (empty patch — grader not invoked)`.

**What happened, in order.**

| clock | event |
|---|---|
| — | build died: `apk: not found` — the Dockerfile assumed Alpine, navidrome is Debian 12. Fixed (§3), rebuilt. |
| 05:22 | REPRO attempt 1 starts (`Claude Opus 4.6 (Thinking)`) |
| **05:24** | **`repro.json` + `harness_repro_test.go` written — the reasoning is finished, ~2 min in** |
| 05:24–05:32 | fights the test runner; loses on the clock |
| 05:32 | `Error: timeout waiting for response` — the 10-min phase timeout |
| ~05:40 | REPRO **gate PASS** (1002 s) |
| 05:41 | LOCALIZE a1 (73 s): real analysis in stdout, no `localize.json` → gate FAIL |
| 05:42 | LOCALIZE a2 **and** a3 (11 s each): `Individual quota reached` — no model ran |

**The REPRO detour.** The model wrote its reproduction as **Ginkgo specs**.
Ginkgo specs all execute under a single Go test function, so the command it
declared — `go test ./utils/cache/ -run 'HarnessRepro'` — matched no Go
test function and reported *"no tests to run"*. It diagnosed this
correctly, tried `--ginkgo.focus`, which hung, and then began rewriting the
specs as a plain Go test. It finished that rewrite: the gate later passed.
But every one of those verification cycles is a full compile under
emulation (§3), so a phase whose thinking took two minutes spent eight more
waiting on the environment and was killed mid-recovery.

**Three rules came out of this run**, each recorded in its own section and
listed here so the provenance is traceable: the sweap base images are not
one OS (§3, fixed — §6.9); the two timeouts must not be equal (§2.4, open);
fatal errors must abort rather than consume retries (§2.3, open). The quota
discovery has its own section (§2.6). A fourth item — "per-attempt wall
time is missing" — was recorded from this run and then **retracted**: the
manifest field is `wall_seconds` and it was populated correctly throughout
(the figures in the table above are read straight from it). The retraction
is kept visible in §6.9 rather than deleted.

**How this run must NOT be read.** It is n=1, it never reached PATCH, and
it terminated on infrastructure. It is **not** evidence about Antigravity's
capability, and no resolved-rate, ranking, or harness comparison may cite
it. Its entire evidentiary value is that the scaffold works end to end and
that four specific defects exist. The one genuinely positive signal — the
model recognised a spec-framework mismatch unprompted and re-engineered
around it — is a qualitative observation from a single trajectory, and is
recorded as such, not as a measurement.

---

## 11. Run log — the delegated cell goes live (2026-07-23 → 2026-07-24)

Three runs of the delegated cell (§2.5): `claude-code` driving Opus 4.6,
Gemini 3.5 Flash **HIGH** as the SDK worker (`all-gemini-flash-high`),
all on navidrome.

**2026-07-23 — shakedown, two accounting faults.** The first delegated
run exposed two faults in worker-usage collection, both from the same
root cause: phases share one `out/` directory, and each phase is a fresh
stateless `claude -p`, so the driver's delegation counter restarts at 1
every phase. Fault one: phase N+1's `worker-usage-1.json` overwrote
phase N's — data loss. Fault two: an attempt that delegated **zero**
times "found" the previous phase's leftover sidecar and claimed it —
silently defeating the zero-delegation auto-fail and misattributing
tokens. The fix (in `runtimes.mjs`, where the reasoning is also
recorded): every worker file is namespaced to its phase-attempt slot
(`worker-usage-repro-a2-1.json`), and readback is regex-scoped to the
attempt's own slot. The lesson generalizes: never rely on a stateless
agent for unique naming — the harness owns the namespace, because only
the harness remembers. This run's artifacts were not retained; the
faults and fix live in the code comments and this log.

**2026-07-24T09-32-34 — resolved.** Scale's official evaluator verdict:
`resolved: true`. Four attempts (repro-a1 timed out; repro-a2,
localize-a1, patch-a1 clean), 2,313 s wall. Driver cost **$1.9072**
(modeled — Max seat, cost basis DRIVER ONLY, as stamped in the
manifest). Worker: 5 sidecars totalling **1,433,982 prompt tokens**
(1,182,832 of them cache-read = 82.5%), 13,946 candidate + 21,471
thought tokens; priced at asia-south1 Vertex rates via
`getVertexRates` (+10% non-global) ≈ **$0.96**. The management premium
is now a measured fact, not a guess: the driver that wrote no product
code cost ~2× the worker that wrote all of it. Audit: 6 flags, all
non-critical `driver-predelegation-inspection`; zero critical.

**2026-07-24T11-17-08 — same cell, same day, not resolved.** Repro and
localize completed cleanly; patch attempt 1 hit the 600 s phase cap
(exit 143, killed mid-verification — the worker had already edited
`simple_cache.go` and was waiting on the test run). The surviving
366-byte diff failed the evaluator. This is §10's environment-latency
failure mode recurring under emulation, and the open equal-timeouts
defect (§2.3/§2.4) doing exactly what §10 predicted it would.

**How to read these.** n=2 live runs with divergent outcomes on the
same instance. This is evidence that the delegated cell **works end to
end** — guard, Skill cable, SDK worker, slot-scoped sidecars, phase
contracts, official grading — and that outcome variance on one instance
is real. It is **not** evidence of a resolve rate, and no cross-cell
comparison may cite these two runs until the matrix actually runs.

## 12. Run log — off navidrome for the first time (2026-07-26)

Two more runs of the same cell (`claude-code` × Opus 4.6 driver, Gemini
3.5 Flash HIGH worker via the SDK, `all-gemini-flash-high`), on **two
repos the cell had never seen**. Until today every delegated result —
resolved or not — came from navidrome, which left one obvious objection
open: the cable might be tuned to one Go repo. It is not.

**2026-07-26T14-59-15 — `ansible/ansible`, not resolved.** The pipeline
itself was flawless: repro, localize and patch each cleared on their
**first** attempt (276 s / 244 s / 383 s, 911 s wall, no timeouts, no
retries), 4 hand-offs, driver **$1.6789** modeled. Worker: 2,471,056
prompt tokens (2,063,587 cache-read = 83.5%), 26,196 candidate + 65,831
thought tokens. Audit: 5 flags, all non-critical.

The patch was simply **wrong**, and wrong in an instructive way. The
task turns on which package manager a host resolves to. The worker made
`os.path.exists('/usr/bin/dnf5')` the decisive test and evaluated it
*first*; the suite defines the answer by what `/usr/bin/dnf` resolves to
under `os.path.realpath`. Inverted precedence — 3 of 7 required tests
passed. This matters for how failures get classified: §10 and the
2026-07-24T11-17-08 run failed on **environment latency** (a phase cap
firing mid-verification), which is a harness problem. This one failed on
**reasoning** with the harness working perfectly. Do not pool the two
when reporting; they have different fixes and only one of them is ours.

**2026-07-26T16-03-32 — `NodeBB/NodeBB`, RESOLVED.** Scale's official
evaluator: `resolved: true`, **273 tests passed, 0 failed, 2 of 2
required**. Again every phase cleared on its first attempt (393 s /
184 s / 262 s, 886 s wall), 4 hand-offs. Driver **$1.7491** modeled;
worker 3,286,977 prompt tokens (2,743,600 cache-read = 83.5%), 20,963
candidate + 25,220 thought tokens, priced through `getVertexRates` at
asia-south1 = **$1.8065**. Total **$3.5555**. Audit: 8 flags, all
non-critical `driver-predelegation-inspection`; zero critical.

Two things worth noting. First, this is a **JavaScript** repo with a
service-heavy suite — the exact profile flagged as a risk in §7's threat
table (NodeBB → mongo/redis) — and it resolved anyway. Second, the
cache-read ratio landed at 83.5% on both runs and 82.5% on 24 Jul,
across three unrelated repos: the delegation cable's economics are
turning out to be a property of the *cable*, not of the workload.

**The tag bug this run exposed.** NodeBB's first launch never reached a
model: `docker build` failed with the base image `not found`. The cause
was ours, in image-tag derivation, and is written up in §(h) — upstream
strips a `-vnan` placeholder before tagging and we did not. It stayed
hidden because only NodeBB and element-web carry that placeholder; every
instance run before today ended in a real `-v<sha>`. It is now
`sweproBaseTag()` in `kinds/lib.mjs`, pinned by four tests in
`lib.test.mjs` against tags verified to exist on Docker Hub. The failure
mode is worth remembering: a derivation bug on 2 of 10 instances
presents as an intermittent **registry outage**, not as a code defect.

**How to read these.** The tally is now **4 graded delegated runs across
3 repos, 2 resolved** (navidrome ✓/✗, ansible ✗, NodeBB ✓). The claim
that upgrades today is *generality* — the cell resolves on more than one
repo, in more than one language, first-attempt on every phase. The claim
that does **not** upgrade is resolve rate: n=4 on hand-picked instances
is not a rate, and §7.1's rule still binds — one instance attempted
twice and solved once reads `1/2`, and nothing here may be quoted as a
cross-cell comparison until the matrix actually runs.

*That tally is as of 2026-07-26 and is left standing as written, because a
dated log entry that gets silently updated stops being a record. §13 carries
it forward.*

---

## 13. Run log — the SDLC leg, the third navidrome, and the two runs recorded under the tightened mandate (2026-07-26 → 2026-07-28)

Three things happened after §12 that this log has to carry. The SDLC leg ran
four times and was never logged here at all, because §10–§12 follow the Pro
leg and nothing said the other kind belonged in the same list. A third
navidrome instance lost for a reason worth naming. And on 2026-07-28 the
driver-integrity audit changed the delegation mandate, which means every run
before that date sits on one side of a study-definition change — so one run
of **each** kind was recorded after it, deliberately, to put runs on the other
side too.

**The SDLC leg — four runs on `kudos-wall`.** Same cable, same worker, the
other kind: `claude-code` driver, Gemini 3.5 Flash HIGH worker through the
Antigravity SDK, against the SDLC recipe in `SDLC-RECIPE.md` rather than a
SWE-bench Pro instance.

| Run | Worker | Stages | Hand-offs | Harness | Gemini | Total | Judge | Tests |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `2607-0610` | 3.5 Flash HIGH | 6 | 7 | $3.6581 | $2.2929 | **$5.9510** | 9.0 | 10 / 10 |
| `2607-0637` | tiered 3.5 + 2.5 | 7 | 12 | $6.0259 | $1.9517 | **$7.9776** | 8.5 | 12 / 12 |
| `2607-2119` | 3.5 Flash HIGH | 6 | 6 | $3.1080 | $1.7993 | **$4.9073** | 8.5 | 13 / 13 |
| `2807-2149` | 3.5 Flash HIGH | 7 | 7 | $3.9361 | $2.5830 | **$6.5192** | 9.0 | 15 / 15 |
| | | **26** | **32** | **$16.7281** | **$8.6269** | **$25.3551** | | |

All four delivered, all four with **zero harness file edits** — `editCount` is
0 in every `audit.json` — and the judge's scores are read from a suite re-run
in a fresh container after the last model call, not from mid-run state. The
narrative belongs to
`IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SDLC.md`; what belongs
here is the fact that the delegated cell has now been exercised on a workload
with no hidden test set and no external grader, and behaved the same way.

**2026-07-26T21-45-39 — navidrome `b398`, not resolved, and not for the reason
the verdict implies.** The worker found the bug, fixed it correctly, and
introduced the constant its fix needs as `lastfmAPIKey`. The hidden test file
— which the system is never permitted to see — refers to the same idea as
`lastFMAPIKey`. Go does not forgive the difference: the test file failed to
compile, so **zero tests ran**, so the instance scores not resolved, and the
evaluator's own output carries an empty `tests` array rather than a list of
failures. Three attempts, 5 hand-offs, driver **$2.4173**, worker **$2.5514**,
total **$4.9687**; 8 flags, all non-critical.

We report it as not resolved everywhere, because the rules are the rules. The
narrow claim it supports is about the benchmark, not about us: on this family,
a "not resolved" verdict is sometimes an identifier-naming miss on a symbol
the problem statement never mentions, and any leaderboard built from that
boolean carries an unknown amount of it.

**2026-07-28 — the audit, then a run of each kind under the new mandate.** The
driver-integrity audit read all eight runs then on record hand-off by hand-off;
its findings are C1 (the mandate now bounds what a re-delegation may carry, §(f)
above) and C2 (the delegation content lint, §(g)). Both landed before these two
runs, which makes them the first recorded under the changed study definition.

| Run | Kind | Attempts | Hand-offs | Harness edits | Harness $ | Gemini $ | Total | Wall | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `2807-2149` | SDLC, kudos-wall | 7 stages | 7 | **0** | $3.9361 | $2.5830 | **$6.5192** | 27m 19s | delivered, judge **9.0**, 15/15 |
| `2807-2224` | Pro, openlibrary | 4 | 5 | **0** | $2.1273 | $3.6122 | **$5.7395** | 22m 11s | **resolved** — 4 tests passed, 0 failed, 4/4 required |

openlibrary is a fourth repository and the cell's second Python instance; it
resolved on a run whose driver skill already carried the tightened clause. The
Pro run recorded **zero** integrity warnings and 8 flags, all non-critical
`driver-predelegation-inspection`. The SDLC run recorded 24 such flags and
**one** integrity warning, which is worth its own paragraph.

**The one warning, and why it is being left alone.** The lint fired
`driver-dictated-code` on `worker-task-judge-a1-1.md`: a 9-line ```json block.
Read it and it is the judge phase's required output shape —
`{"scores": {"requirements_fidelity": <0-10>, …}, "summary": "<one paragraph…>"}`
— a template of placeholders on the one stage of the recipe that ships no code
at all. It is a true finding by the rule and not a leak in fact, and it lands
at exactly `DICTATION_MIN_LINES` (9), the far edge of the one-line margin the
corpus leaves.

This is precisely the case the *warn, never block* decision was made for: a
gate here would have failed a phase over an output schema. It is not being
"fixed" now, and that is a deliberate call rather than an oversight. An
exclusion for placeholder schemas is a change to a rule whose thresholds are
defended by a **frozen** fifty-hand-off corpus that this hand-off is not part
of, so the change would ship with no evidence behind it, days before the source
goes to Google. Recording it here makes it a known reading of a published
number instead of a surprise for whoever reads `lint.json` first.

**The tally, carried forward.** SWE-bench Pro: **6 graded delegated runs, 5
instances, 4 repositories, 3 languages, 3 resolved**, $23.1803 total. SDLC:
**4 runs, 4 delivered**, $25.3551 total. Across both kinds: **10 delegated
runs, 62 driver→worker hand-offs, and not one harness file edit** — every one
of those 62 hand-offs reproduces byte-for-byte out of its own trajectory, and
`.gitignore`'s carve-out commits all of them. What still does not upgrade is
resolve rate: §7.1's rule binds unchanged, n is small, the instances were
hand-picked, and nothing here is a cross-cell comparison until the matrix runs.
