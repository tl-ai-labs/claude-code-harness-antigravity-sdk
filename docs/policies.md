# Policies

A policy is a YAML file under `tools/harness-matrix/policies/` that
declares:

- The **driver** model (which Anthropic model the Claude Code CLI runs
  under) and its reasoning effort.
- The **worker** model (which Gemini model the Antigravity SDK calls),
  the adapter, the API, and the region.
- Per-stage routing rules (which stages use which cell).
- Retry policy and per-attempt cost/time caps.

Five are shipped, and they map onto the tokenomics story Gemini
Enterprise is here to tell.

## The five shipped cells — seven policy files

The first three are the **current** cells — the ones to run today. The
last two are **historical columns** retained as evidence; their in-file
headers explain why they were not deleted.

Five cells, seven files: the tokenomics cell ships as three files, one
per workload plus a combined one. [Below the table](#the-tokenomics-cell-ships-as-three-files)
explains why, and what stops them drifting apart.

| Policy | Driver | Worker(s) | What it demonstrates |
|---|---|---|---|
| `all-opus` | Claude Opus 4.8 | *(none — Opus does the work itself)* | The **anchor**. No delegation. Every stage runs on the strongest brain the runtime can drive. Baseline for cost and quality comparisons. **The only policy that touches no Antigravity SDK code** — see the note below the table. |
| `all-gemini-flash-high` | Claude Opus 4.8 | Gemini 3.5 Flash-Lite | The **delegated cell**, uniform. Every stage delegates to Flash-Lite at HIGH thinking. Cheapest way to prove the cable works end-to-end. |
| `opus-4.8-plus-gemini-3.5-flash-lite` | Claude Opus 4.8 | Gemini 3.5 Flash-Lite — production stages on SDLC, **every phase** on Pro | The **tokenomics pass**. On SDLC, judgment stages run on the driver alone and make no SDK call at all; production stages delegate. On SWE-bench Pro it delegates all three phases, so there it is the same cell as `all-gemini-flash-high`. See the note below the table. |
| `all-gemini-25-flash-high` | Claude Opus 4.6 *(as run)* | Gemini 2.5 Flash | *Historical.* The **generation comparison**. Same stages, older worker generation. Diff against `all-gemini-flash-high` **as it was pinned in July 2026**, when the two shared a driver and differed only in worker — today that policy pins Flash-Lite on an Opus 4.8 driver, so the on-disk pairing isolates neither a generation nor a tier. |
| `gemini35-plus-25-flash-high` | Claude Opus 4.6 *(as run)* | 3.5 Flash *and* 2.5 Flash, per stage | *Historical.* The **worker-axis tiering pass**. Premium worker on judgment stages, cost-efficient worker on volume stages, every stage delegated — so the driver is held constant by construction, which `opus-4.8-plus-gemini-3.5-flash-lite` does not do. |

**The three current cells share one driver, on purpose.** All three pin
Claude Opus 4.8 at `--effort high`, so the only thing separating them is
what gets delegated: nothing, everything, or the production stages. They
were re-pinned together on 2026-07-31 — before that, `opus-4.8-plus-gemini-3.5-flash-lite`
alone ran 4.8 and every delta against `all-gemini-flash-high` carried a
driver change on top of the tiering change it was meant to isolate.

### The tokenomics cell ships as three files

`opus-4.8-plus-gemini-3.5-flash-lite` exists three times over:

| File | Covers | Has `default:` |
|---|---|---|
| `opus-4.8-plus-gemini-3.5-flash-lite.yaml` | both workloads | yes |
| `opus-4.8-plus-gemini-3.5-flash-lite-sdlc.yaml` | SDLC only | **no** |
| `opus-4.8-plus-gemini-3.5-flash-lite-swe-bench-pro.yaml` | SWE-bench Pro only | **no** |

They are one cell, not three. The `models:` block is **byte-identical**
across all three — same driver pin, same worker pin, same region, same
thinking level — so what runs, what it costs and what cable it uses do
not depend on which of the three you pass to `--policy`. Only the
`rules:` block differs, and only by which stage ids it names.

The split exists because the combined file has to describe two
workloads at once, and a reader handed one recorded run should be able
to open the one file that describes it. The routing is unchanged by the
split, and asserted to be: `policy-family.test.mjs` resolves every stage
of both kinds through the combined file and through its kind-specific
sibling and requires the bindings to be equal.

**Why the kind-specific files have no `default:`, and why that is a
feature.** A `default:` rule is what the resolver falls through to when
no `when:` matches. The combined file keeps one. The two kind-specific
files name every stage of their own kind — that *is* the claim each
makes — and then deliberately leave the fall-through off, so pointing
one at the wrong workload dies at load time:

```
Policy '...-sdlc' has no rule matching {"phase":"repro",...} and no default rule.
```

That costs `$0` and happens before the first token. With a `default:`,
the same mistake would instead resolve `repro` quietly to the premium
cell and hand back a plausible-looking run with none of this policy's
tiering in it — zero delegation, full Opus cost, and no gate anywhere
that would flag it. A loud failure beats a wrong answer nobody is
looking for.

**The one hazard a family creates, and what closes it.** Three files
describing one cell can drift: someone re-pins the worker in the
combined file and the two siblings keep billing the old model, and
nothing in the runner notices because each file still loads cleanly on
its own. `policy-family.test.mjs` compares the three `models:` blocks
byte for byte and fails the suite on any difference, including a
changed comment — a comment that explains the region in one file and
not the others is exactly how the next reader ends up trusting the
wrong explanation.

**On the names.** Until 2026-07-31 this cell was `opus48-plus-lite`,
with cells `opus48` and `opus48-lite` and a worker leaf
`flash-lite-35-agsdk-vertex`. `opus48-lite` reads as "a lite tier of
Opus 4.8", which is the opposite of what it is: there is no lite tier
of Opus, and "lite" is the Gemini model. Every identifier now names its
models in full — `opus-4.8-solo`,
`opus-4.8-delegating-to-gemini-3.5-flash-lite`, `opus-4.8-anthropic`,
`gemini-3.5-flash-lite-agsdk-vertex`. The `model_name:` pins never
changed; they were always the vendors' own API strings. The rename was
applied to the recorded evidence bundles too, so the tree and the
receipts agree — each bundle's `integrity-notes.md` says so explicitly
and explains why its recorded `policy ... sha256` is the hash of the
pre-rename file.

**The two historical cells stay on Opus 4.6, also on purpose.** That is
the driver their recorded passes actually ran on, and their exemplar
receipts ship in this repo. Re-pinning a frozen column to a driver it
never ran on would make the policy describe a run that did not happen.
Each file's header lists exactly what it ran with — driver, worker,
thinking level, region, and where its evidence lives.

The current cells answer two different questions, and it is worth being
clear which is which. `all-opus` versus `all-gemini-flash-high` asks *is
the delegation cable real, and what does a whole workload cost when
Gemini does all of it*. `opus-4.8-plus-gemini-3.5-flash-lite` asks the narrower and more
practical question: *which stages actually need the premium model?*

**The two tiered policies cut on different axes, and both cuts are
legitimate.** `opus-4.8-plus-gemini-3.5-flash-lite` tiers across the driver/worker line —
its premium stages are not delegated at all. `gemini35-plus-25-flash-high`
delegates every stage and changes only the worker, so its driver is
constant by construction. The first is what a cost-conscious team would
actually deploy; the second is the cleaner experiment. Neither
supersedes the other.

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

`opus-4.8-plus-gemini-3.5-flash-lite` is that story in a single policy file, and it maps
onto the pitch line for line — the subscription keeps the judgment work,
Gemini takes the volume:

- **Judgment stages** — requirements, design, plan-packets, review,
  judge → Opus 4.8, `composition: solo`, **no delegation and no SDK
  call**.
- **Volume stages** — execute, plus verify's repair rounds → Opus 4.8
  driving a Gemini 3.5 Flash-Lite worker through the Antigravity SDK.

`gemini35-plus-25-flash-high` encodes the same split with both tiers as
*workers*, which is the older and more experimentally careful form:

- **Judgment stages** → premium worker (Gemini 3.5 Flash).
- **Volume stages** → cost-efficient worker (Gemini 2.5 Flash).

The rationale, stage by stage — the same split an SDLC orchestrator would
make, expressed here as policy rules rather than as code:

- `requirements_analysis` → premium ("Judgment-heavy, low volume")
- `architecture_design` → premium ("Foundational, decision-bearing")
- `plan_task_packets` → premium ("Needs full context to slice work")
- `senior_code_review` → premium ("Cross-file reasoning + judgment")
- `codegen / tests / docs` → cost-efficient ("Schema-driven boilerplate")
- `debug (retry ≥ 2)` → cost-efficient ("Most debugs have clear cause")
- default → premium ("Unrecognised task — fail safe to premium")

That per-stage routing is the point of either tiered cell — it says
concretely where a cheaper model earns its keep and where it doesn't.
`opus-4.8-plus-gemini-3.5-flash-lite` reproduces this same table; the difference is only
that its premium tier is the driver seat rather than a premium worker,
so on those stages nothing is delegated at all.

**All of the above describes the SDLC kind. SWE-bench Pro tiers on a
different axis, and `opus-4.8-plus-gemini-3.5-flash-lite` does not pretend otherwise.**
Pro's three phases — `repro`, `localize`, `patch` — are all judgment,
and Pro's mechanical half (running the tests in the container,
classifying the diff, the gate arithmetic) was never a model call at
all; it is harness code. So there is no Pro phase a cheap model should
own outright, and the policy routes **all three to the delegated cell**.
The tiering there happens *inside* a phase rather than between phases:
the driver frames the task, writes the phase contract, and verifies what
comes back, while the worker does the repo exploration, the analysis and
the authoring. That division is not a convention — the delegated runtime
takes every file-editing tool away from the driver, denies its Bash
writes into the tree, and locks it out of reading the repo at all until
its first delegation. Consequence worth knowing before you pick a
policy: on Pro this cell makes SDK calls on every phase, where on SDLC
it makes none on five of them.

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
sit in the policy). All seven policy files read consistently once you
know the schema.

`opus-4.8-plus-gemini-3.5-flash-lite` is the one to read for a policy that holds **both**
composition kinds at once — a `solo` entry and a `delegated` entry in
the same `models[]`, sharing one driver leaf. That is legal because the
runtime decides delegation per *stage*, not per run, so a policy may
make zero SDK calls on one stage and several on the next.

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
  `examples/kudos-wall`. Cheapest live path, and the only one that
  exercises the SDK on *every* stage. Historically ~$3–4 and 20–30
  minutes on `gemini-3.5-flash`; the Flash-Lite pin bills roughly a
  fifth of that input rate, so treat the old figure as a ceiling.
  **Do not substitute `opus-4.8-plus-gemini-3.5-flash-lite` for this on SDLC** — there its
  judgment stages make no SDK call at all, so a green run leaves the
  connector partly unproven. On **SWE-bench Pro** the caveat does not
  apply: that policy delegates all three phases, so it exercises the
  cable exactly as this one does.
- **"I want the tokenomics story":** `opus-4.8-plus-gemini-3.5-flash-lite` on
  `examples/kudos-wall`. Judgment on Opus 4.8, production on Flash-Lite.
  This is the shape a team would actually deploy.
- **"I want the tokenomics story as a clean experiment":**
  `gemini35-plus-25-flash-high` on the same workload. Every stage stays
  delegated, so the driver cannot confound the comparison.
- **"I want to A/B a generation":** `all-gemini-flash-high` vs
  `all-gemini-25-flash-high` on the same workload — but note that
  `all-gemini-flash-high` now pins Flash-Lite, so this compares 2.5
  Flash against 3.5 Flash-Lite, which is a tier change as well as a
  generation change. The clean single-generation A/B is the pair of
  July 2026 exemplar passes, not a fresh run.
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
