# Policies

A policy is a YAML file under `tools/harness-matrix/policies/` that
declares:

- The **driver** model (which Anthropic model the Claude Code CLI runs
  under) and its reasoning effort.
- The **worker** model (which Gemini model the Antigravity SDK calls),
  the adapter, the API, and the region.
- Per-stage routing rules (which stages use which cell).
- Retry policy and per-attempt cost/time caps.

Four are shipped, and they map onto the tokenomics story Gemini
Enterprise is here to tell.

## The four shipped policies

| Policy | Driver | Worker(s) | What it demonstrates |
|---|---|---|---|
| `all-opus` | Claude Opus 4.6 | *(none — Opus does the work itself)* | The **anchor**. No delegation. Every stage runs on the strongest brain the runtime can drive. Baseline for cost and quality comparisons. **The only policy that touches no Antigravity SDK code** — see the note below the table. |
| `all-gemini-flash-high` | Claude Opus 4.6 | Gemini 3.5 Flash | The **delegated cell**, uniform. Every stage delegates to 3.5 Flash at HIGH thinking. Cheapest way to prove the cable works end-to-end. |
| `all-gemini-25-flash-high` | Claude Opus 4.6 | Gemini 2.5 Flash | The **generation comparison**. Same driver, same stages, older worker generation. Diff against `all-gemini-flash-high` to see whether a generation of model progress shows up in an agentic SDLC harness. |
| `gemini35-plus-25-flash-high` | Claude Opus 4.6 | 3.5 Flash *and* 2.5 Flash, per stage | The **tokenomics pass**. Premium worker on judgment stages (requirements, design, plan-packets, review, judge). Cost-efficient worker on volume stages (execute + repair rounds). |

The four cells sit on a 2×2 of two questions the tokenomics story
cares about: is the delegation cable real (all-* uniform cells vs the
anchor), and where is a cheaper worker acceptable (the tiered cell vs
the uniform premium cell).

**What the anchor does and does not prove.** `all-opus` is a
`composition: solo` cell pinned to `runtime: claude-code`: one Anthropic
model doing every stage, with no worker leg at all. It runs, and it is
the cheapest policy to get running because it needs no worker venv, no
Vertex AI, and no Google Cloud project. It is also the one policy on
which **no line of Antigravity SDK code executes**. That makes it the
right cost baseline and the wrong smoke test: a green `all-opus` run
says the Claude Code driver, the container, the stages, and the graders
all work, and says nothing whatsoever about the connector. Run
`all-gemini-flash-high` to prove the cable, then run the anchor to have
something to compare against.

## The Gemini Enterprise tokenomics framing

The pitch: keep your Claude Code or OpenAI subscription for the parts
that need the strongest brain; use Gemini for the parts that don't.

`gemini35-plus-25-flash-high` is that story in a single policy file.
Its rule table names the split verbatim:

- **Judgment stages** — requirements, design, plan-packets, review,
  judge → premium worker (Gemini 3.5 Flash).
- **Volume stages** — execute, plus verify's repair rounds → cost-
  efficient worker (Gemini 2.5 Flash).

The rationale, stage by stage — the same split an SDLC orchestrator would
make, expressed here as policy rules rather than as code:

- `requirements_analysis` → premium ("Judgment-heavy, low volume")
- `architecture_design` → premium ("Foundational, decision-bearing")
- `plan_task_packets` → premium ("Needs full context to slice work")
- `senior_code_review` → premium ("Cross-file reasoning + judgment")
- `codegen / tests / docs` → cost-efficient ("Schema-driven boilerplate")
- `debug (retry ≥ 2)` → cost-efficient ("Most debugs have clear cause")
- default → premium ("Unrecognised task — fail safe to premium")

That per-stage routing is the point of the tiered cell — it says
concretely where a cheaper worker earns its keep and where it doesn't.

## Policy schema (v2)

Every policy is a `version: 2` document with two top-level lists:

- **`models[]`** — one entry per model or composition. A composition
  entry names two other entries as `driver` and `worker`; a leaf
  entry names an adapter (`builtin-anthropic` or `antigravity-sdk`),
  an API (`anthropic` or `vertex`), and a `model_name`.
- **`rules[]`** — a list of `when:` matchers with a `use:` naming a
  composition. Fallthrough entry is `default:`.

Then `retry:` and `limits:` at the top level.

Read `all-opus.yaml` for the canonical explanation of the schema — it
carries the full rationale for the migration from v1 (where the
adapter and API were hardcoded in `runtimes.mjs`) to v2 (where they
sit in the policy). The four policies read consistently once you know
the schema.

## Wallets — what bills where

Every policy uses **two wallets**:

| Wallet | Who bills | What runs against it |
|---|---|---|
| Driver | Anthropic (via `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) | The Opus driver: orchestration, decisions, delegation packaging. |
| Worker | Google Cloud (via Vertex AI in your GCP project) | Every Gemini call from `gemini_worker.py`: requirements text, design text, plan-packet text, executed code, review text, judge verdict. |

The `--auth` distinction that exists in a plugin-shaped harness does
not apply here — this CLI harness always bills the vendor. The
subscription-vs-API-key choice on the driver side is between two
Anthropic billing modes; the worker side is always Vertex AI billing
against your GCP project.

## Choosing a policy

- **"I want to prove the cable works":** `all-gemini-flash-high` on
  `examples/kudos-wall`. Cheapest live path. ~$3–4, 20–30 minutes.
- **"I want the tokenomics story":** `gemini35-plus-25-flash-high` on
  `examples/kudos-wall`. About double the cost of the uniform cell —
  the premium stages are where the money goes.
- **"I want to A/B a generation":** `all-gemini-flash-high` vs
  `all-gemini-25-flash-high` on the same workload.
- **"I want a no-delegation baseline for comparison":** `all-opus` on
  any workload. This uses no Gemini, no worker venv, no Vertex, and no
  Antigravity SDK — so run it *after* you have proved the cable, never
  instead.

## Writing your own policy

Copy `all-gemini-flash-high.yaml`, rename it, and edit the `models[]`
entries. Keep the `version: 2` line. The runner validates the
composition at load — if a rule names a `use:` that has no matching
composition, or a composition names a `driver:` or `worker:` that has
no leaf entry, the run refuses to start.
