# Claude Code harness × Antigravity SDK — building software end to end

**Implementation approach and results for the SDLC workload.**

Prepared for Ravi and the Google team · 2026-07-27 · every number read from a
run artifact, not recalled.

Companion document:
[`IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SWE-BENCH-PRO.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SWE-BENCH-PRO.md)
— the same integration applied to fixing bugs in real open-source repositories.

---

## In one page

**What we were asked.** Google's ask, verbatim: *"Claude Code as Harness and
when it calls Gemini it should call Gemini + Antigravity together either using
Skills or CLI."*

**What we built.** A working system in which Claude Code acts purely as the
**harness** — the thing that runs the process and never does the work — and
Gemini, reached through the Antigravity SDK on Vertex, does **all** the
engineering. Claude Code plans, delegates, verifies and decides;
it cannot write a line of code, because its file-editing tools are switched off.
Every change to the codebase comes from Gemini.

**What it did.** Given a one-paragraph business brief — *"build a small kudos
service"* — the system ran the full software lifecycle unattended: requirements,
design, implementation planning, coding, testing, senior review, and a scored
quality judgement. It delivered a working service each time.

**Results — four runs, four successes.**

| Run | Worker configuration | Outcome | Delivered tests | Quality score | Total cost |
|---|---|---|---:|---:|---:|
| 1 | Gemini 3.5 Flash throughout | **Delivered** | 10 / 10 pass | 9.0 / 10 | $5.95 |
| 2 | Tiered: 3.5 Flash + 2.5 Flash | **Delivered** | 12 / 12 pass | 8.5 / 10 | $7.98 |
| 3 | Gemini 3.5 Flash throughout | **Delivered** | 13 / 13 pass | 8.5 / 10 | $4.91 |
| 4 † | Gemini 3.5 Flash throughout | **Delivered** | 15 / 15 pass | 9.0 / 10 | $6.52 |

† Run 4 (28 Jul) is the **verification run**, executed after the delegation
audit described in §8 closed and its fixes landed. Same recipe, same models; the
only difference is that its driver skill already carried the tightened
delegation clause. Read runs 1–3 as the evidence base and run 4 as the check
that the fix did not break the method.

Every run was paid and real. Nothing here is a simulation or a fixture.

**The commercial finding.** The harness is the expensive half. Across the
four runs, Claude Code consumed **66% of total spend while writing no code at
all** — it was reading, checking and deciding. Reviewing on a premium model
costs more than authoring on a cheap one. That inverts the usual instinct about
where model budget goes, and it is measurable per workload before you commit to
a routing strategy.

**What it proves for the partnership.** The integration works, it is
instrumented well enough to defend, and the constraints we hit are Google-side
platform items we can name precisely (§7).

---

## 1. Why this workload

Benchmarks like SWE-bench measure a narrow thing very well: can a model fix a
known bug in a known repository? That is a useful signal and a poor proxy for
what customers actually buy.

Customers buy **delivery**. A brief arrives; working software is expected to come
out. That involves judgement calls with no ground truth — what the requirements
really are, how to structure the data, what to build first, whether the result
is good enough to ship.

So this leg gives the system a brief and asks for a service. There is no
reference answer to grade against. Instead the delivered code must **build and
pass its own tests**, and a separate scoring stage rates it on requirements
fidelity, code quality and test quality.

### The brief

Deliberately ordinary, and reproduced here in full — this is the *entire* input
the system was given:

> **Kudos Wall**
>
> Build a small kudos service: a user posts a kudos (who it's from, who it's
> for, and a short message), and can list all kudos, most recent first.
>
> Deliverable: a working software service the client operates themselves.
> Cost basis: per project.

Three sentences. Forty-one words. No API specification, no data model, no field
names, no validation rules, no error behaviour, no acceptance criteria, no
technology choices. That is the point: it is the shape of brief a real client
actually sends, and everything below had to be *decided*, not transcribed.

The brief is pinned by checksum, so a quietly edited brief can never masquerade
as the same task.

### What came out of it

From those three sentences the system produced a written requirements document
of its own, and then built to it. A sample of what it decided that nobody told
it — from run `2607-2119`:

- **Two endpoints**, `POST /kudos` and `GET /kudos`, with `201 Created` on write
  and `200 OK` on read.
- **A payload contract** of exactly three string fields (`from`, `to`,
  `message`) — the brief's "who it's from, who it's for, and a short message",
  turned into a schema.
- **Validation rules that appear nowhere in the brief**: non-empty after
  trimming, 100 characters for names, 500 for the message, `400 Bad Request`
  otherwise, and nothing persisted on a rejected request.
- **A tie-break rule.** "Most recent first" is ambiguous when two kudos share a
  timestamp; it resolved that by ordering on identifier descending, and wrote it
  down as a requirement.
- **The empty case.** No kudos yet returns `[]`, not an error.

It then delivered the code to match — a database model, a persistence layer, a
service, a controller, and a test file:

```
prisma/schema.prisma                   + model Kudos { id, from, to, message, createdAt }
src/modules/kudos/kudos.controller.ts    POST /kudos, GET /kudos
src/modules/kudos/kudos.service.ts       validation + persistence
src/modules/kudos/kudos.module.ts
src/modules/prisma/prisma.service.ts     database client lifecycle
src/modules/prisma/prisma.module.ts
test/modules/kudos.spec.ts             + 13 tests
```

Every one of those files was written by Gemini. The build passed, all thirteen
tests passed, and a separate scoring stage rated the delivery 9.5 on
requirements fidelity.

The interesting part is not that a model can write a small service. It is that
the *judgement calls* — what "short message" means in characters, what happens
on a tie, what an empty list returns — were made, written down as requirements
first, and then implemented consistently with what was written. That is the
part a benchmark cannot measure and a client actually pays for.

---

## 2. How it works, in plain terms

Think of it as a **senior engineer directing a contractor**.

The senior engineer is Claude Code. They read the brief, decide what needs
building, break the work into pieces, hand each piece to the contractor, check
what comes back, and either accept it or send it back with corrections. They do
not touch the keyboard.

The contractor is Gemini, reached through the Antigravity SDK. They do all the
actual work: reading the codebase, writing the code, writing the tests.

The crucial detail is that this separation is **enforced, not requested**. The
harness physically cannot edit a file — the tools are removed from its
session. We did not tell it to delegate and hope. We took away the alternative.

```
   Brief  ──►  Claude Code (harness)  ──►  Antigravity SDK  ──►  Gemini
               • plans and sequences              • the cable          • on Vertex,
               • writes the work orders                                  asia-south1
               • checks every result                                   • reads the repo
               • decides accept / redo                                 • writes the code
               • CANNOT write code                                     • writes the tests
                      │
                      ▼
               Sealed container  ──►  build + test  ──►  Verdict
               (fresh toolchain,      run after the        delivered / not,
                identical every run)  last model call      plus a quality score
```

### The seven stages

The lifecycle is not invented for this exercise — it is our production
orchestrator's own template, driven by the same stage definitions.

| Stage | What happens | Who does it | What must be true to proceed |
|---|---|---|---|
| 1. Requirements | Brief → testable requirements | Gemini | Document has the required sections; **repository untouched** |
| 2. Design | Requirements → data model, API, modules | Gemini | Document has the required sections; **repository untouched** |
| 3. Plan | Design → 2–8 implementation packets | Gemini | Valid packet list, each targeting a permitted area |
| 4. Build | Implement every packet — code and tests | Gemini | Only permitted areas changed; both code **and** tests written; database schema appended to, never rewritten |
| 5. Verify | Integrity check, then build and test | *Script — no model* | Untouched scaffold verified byte-for-byte, then build and tests pass, with a repair budget |
| 6. Review | Senior review of the verified result | Gemini | Findings and a verdict; **verified code untouched** |
| 7. Judge | Score the delivery 0–10 | Gemini | Four scores in range, with a written summary |

Two things are worth pausing on.

**Stages 1–3 change nothing.** They produce documents. The gates enforce that
the repository is byte-identical afterwards. Planning cannot quietly become
building.

**Stage 5 has no model in it.** It is a script that checks the untouched parts
of the codebase are genuinely untouched (by checksum), then runs the real build
and the real test suite. If they fail, the failure log is fed back and the
implementation stage gets a bounded number of repair rounds. Machines decide
this one, not models.

### Where the model is allowed to write

The starting codebase is a working, empty service — a "scaffold" with the
plumbing already in place (framework, database layer, test runner, build
config). The model may only write in three declared places: the feature module
directory, the corresponding test directory, and new database models appended
below a marker in the schema.

Everything else is fixed infrastructure. This matters commercially: it is how
you get a *consistent, reviewable* delivery instead of a differently-shaped
codebase every time. It is also the safety property — the model cannot rewrite
the build system to make its own tests pass.

---

## 3. How we know it actually delegated

The single most important claim in this document is that Gemini did the
engineering. If that claim is soft, nothing else here means anything. So it is
enforced in five independent layers.

| Layer | What it does | When it acts |
|---|---|---|
| 1. Tools removed | The harness's file-editing tools are switched off entirely | Structurally — the ability does not exist |
| 2. Shell write ban | Any shell command that writes into the codebase is blocked in real time | Per command, live |
| 3. Delegate-first lock | Until the first delegation of each stage, the harness cannot even *read* the codebase | Live, until it delegates |
| 4. Zero-delegation gate | A stage the harness completed alone **fails**, and is retried | End of each stage attempt |
| 5. Post-run audit | Every action the harness took is re-examined afterwards | After the run |

**Result across all four runs: zero harness edits.** The audit records
`editCount: 0` every time. Across the four runs there were **32 delegations** to
Gemini.

What that sentence does *not* claim is covered in §8: the harness cannot write,
but it can read the codebase before it writes a hand-off, and on this workload
the audit found it doing so.

### Why five layers and not one — we learned each of them the hard way

**The first attempt had a written instruction and all tools available.** The
instruction said, in capital letters, always delegate. The harness read it,
then edited the file itself. Zero delegations. A well-written mandate lost to an
available tool.

So we removed the tools. **The second attempt showed the subtler failure.** With
no way to write code, the harness could still do all the *thinking* — it
read the source files, ran the test suite twice, worked out the answer, and only
then delegated, using Gemini as a typist. The delegation counter said "1". The
intellectual work was entirely the harness's.

That is why layer 3 exists: until it delegates, the harness cannot read the
codebase at all. It has to hand over the problem, not a pre-solved answer.

The generalisable lesson, and the one worth carrying beyond this project:

> **A capability an agent still has is a capability it will eventually use,
> whatever the prompt says. If your result depends on an agent not doing
> something, remove the ability — do not ask.**

### The failure mode a counter cannot catch

Worth stating because it is the kind of thing that quietly invalidates a study.

The harness reaches Gemini by running a command, and that command had a
two-minute default timeout. Real delegations take longer. So delegations were
being killed by the transport, not by any limit we had set.

The danger is not the kill. It is that a harness whose delegations keep
dying may reasonably give up and do the job itself — producing a run that is
really unaided while still showing a non-zero delegation count. That
is the single shape the counter cannot see.

Fixed by making the timeouts nest properly, so Gemini's own limit always fires
first and always leaves a diagnosable trace. We found this by reading logs, not
by it failing loudly.

---

## 4. Results in detail

Four runs, all paid, all on real infrastructure. Costs split by who spent them.

| Run | Worker configuration | Stages | Delegations | Harness | Gemini | **Total** | Wall clock |
|---|---|---:|---:|---:|---:|---:|---:|
| `2607-0610` | 3.5 Flash, thinking HIGH | 6 | 7 | $3.6581 | $2.2929 | **$5.9510** | 24m 38s |
| `2607-0637` | Tiered 3.5 + 2.5 Flash | 7 | 12 | $6.0259 | $1.9517 | **$7.9776** | 46m 23s |
| `2607-2119` | 3.5 Flash, thinking HIGH | 6 | 6 | $3.1080 | $1.7993 | **$4.9073** | 20m 33s |
| `2807-2149` † | 3.5 Flash, thinking HIGH | 7 | 7 | $3.9361 | $2.5830 | **$6.5192** | 27m 19s |
| | **totals** | **26** | **32** | **$16.7281** | **$8.6269** | **$25.3551** | |

| Run | Delivered? | Tests written and passing | Requirements | Code quality | Test quality | Overall |
|---|---|---:|---:|---:|---:|---:|
| `2607-0610` | **Yes** | 10 / 10 | 10 | 9 | 8 | **9.0** |
| `2607-0637` | **Yes** | 12 / 12 | 9.5 | 9 | 7 | **8.5** |
| `2607-2119` | **Yes** | 13 / 13 | 9.5 | 8 | 8.5 | **8.5** |
| `2807-2149` † | **Yes** | 15 / 15 | 10 | 9 | 9 | **9.0** |

The tests in that column are the model's **own** tests, written as part of the
delivery, plus the scaffold's fixed suite — and they are re-run from scratch,
in a fresh container, **after the last model call**. A verdict read from
mid-run state is one a later stage could in principle have disturbed; re-running
afterwards removes that doubt entirely.

### Two costs, kept separate on purpose

Harness spend runs on a Claude Code Max seat, which is a subscription. The
dollar figure is what the same work *would* cost through the metered API,
computed from real token counts — it is a modelled figure, not a bill.

Gemini spend is **real money** on Vertex, computed from the token counts the
Antigravity SDK reports, at verified regional rates.

We never re-add these into one number without saying which is which. A blended
figure would hide exactly the thing this study exists to measure.

---

## 5. The commercial finding

Across the four runs the split is:

| | Share of total spend | What it produced |
|---|---:|---|
| **Harness** (Claude Opus 4.6) | **66.0%** | Plans, work orders, verification decisions. **No code.** |
| **Worker** (Gemini Flash) | 34.0% | The entire delivered service and its test suite |

Take the cheapest, best-scoring run, `2607-2119`:

| | Harness | Worker |
|---|---:|---:|
| Turns / delegations | 88 turns | 6 delegations |
| Input tokens read | 1,428,205 | 2,267,873 |
| — of which cached | 1,264,203 (**88.5%**) | — |
| Output tokens written | **33,447** | **90,457** |
| **Cost** | **$3.1080** | **$1.7993** |

The harness wrote 33,000 tokens and cost $3.11. Gemini wrote 90,000 tokens
— the whole service — and cost $1.80.

**Reviewing on a premium model costs more than authoring on a cheap one.**

This is not a universal law, and the honest version is more interesting than the
headline. On the bug-fixing workload the ratio inverts (54% harness / 46%
worker), because that recipe pushes far more work down to the worker. So:

> The harness/worker cost split is a property of the **workload**, not of
> the architecture — and it is measurable per workload *before* you commit to a
> routing policy.

That is directly actionable for cost-optimised routing, and it is the kind of
number you can only produce if you refuse to collapse the two wallets into one.

### One caveat we insist on

About **88–93%** of the harness's input is cache reads. Pricing the raw
input total at the full rate would overstate harness cost several-fold. Our
records keep fresh and cached input separate, and the live terminal prints the
fresh figure every time with a note that it is the one to price. We would rather
be tediously correct here than publish a flattering number.

---

## 6. The tiered experiment

Run `2607-0637` tested a question the tokenomics track cares about: **which
stages are worth paying the premium model for?**

Rather than invent a split, we ported the one our production orchestrator has
used since its third pass — premium tier for judgement-heavy, low-volume stages;
cost-efficient tier for high-volume mechanical ones:

| Stage | Tier | Reasoning (from the production policy) |
|---|---|---|
| Requirements | Premium | Judgement-heavy, low volume |
| Design | Premium | Foundational, decision-bearing |
| Plan | Premium | Needs full context to slice work cleanly |
| **Build** | **Cost-efficient** | Schema-driven implementation |
| Repairs | Cost-efficient | Inherits the build tier — most repairs have a clear cause |
| Review | Premium | Cross-file reasoning and judgement |
| Judge | Premium | Fail safe to premium |

**Outcome: it delivered — 12/12 tests, 8.5 overall — but it was the most
expensive run of the three, at $7.98.** Tiering the worker down saved $0.49 on
the Gemini side and cost $2.92 more on the harness side, because the
cheaper worker needed a second attempt at the build stage and the harness
had to supervise both.

That is a genuinely useful negative result: **tiering the worker without tiering
the supervision can cost more than it saves.** It is also a single run, and we
present it as a signal, not a conclusion.

---

## 7. What we need from Google

First, the context these asks sit in, because it is easy to misread them.

Google described **two shapes**, and they are not the same experiment:

| | Who runs the process | Who does the engineering | Status |
|---|---|---|---|
| **Shape A** — *this document* | Claude Code, as the harness | Gemini, through the Antigravity SDK | **Built, run, graded** |
| **Shape B** | The **Antigravity SDK itself**, as the harness | whichever model it is pointed at | **Blocked** — see items 1 and 3 |

Shape A is what we have evidence for. Shape B is the one that turns this from a
demonstration into a comparison: run the *same* procedure under a different
harness and the difference in outcome is attributable to the harness, because
nothing else moved. We built the recipe deliberately so that swap is a one-line
change. What we cannot do is make the swap while the SDK cannot drive a full
agent loop on the models we need.

### What we found in the SDK, in brief

We moved off the `agy` CLI onto the Antigravity SDK at Google's request, and
probed it end to end with live paid runs against both Gemini and Claude. Two
things came out of that.

**The SDK is better than the CLI at everything we measure.** It returns real
token counts, it has a working thinking control, and it runs on our own paid
Vertex project. The CLI reported no usage data at all, which is why every run we
did before the SDK recorded a null cost. That upgrade is what makes §5 of this
document possible.

**It cannot drive a Claude model** — which is the harness Google asked us to
build for Shape B. The reason matters more than the symptom: the Antigravity
engine shipped *inside* the SDK already has full Anthropic support compiled
into it — Claude model constants, thinking variants, bring-your-own-key routes,
and an `API_PROVIDER_ANTHROPIC_VERTEX` provider. The Python layer on top exposes
none of it.

> This is not "please add Claude support". It is a plumbing gap between Google's
> own engine and Google's own SDK, plus three genuine bugs on the
> OpenAI-compatibility path. That is a far smaller ask, and it is the one we are
> making.

Eleven defects documented in total. Four block us; seven are quality issues we
think Google would want to know about regardless.

| # | Defect | Blocks us? | Fix size |
|---|---|---|---|
| **D1** | Anthropic support exists in the engine, unreachable from Python | **Yes** | Medium — expose what exists |
| **D2** | OpenAI-compatible path cannot authenticate at all | **Yes** | Small — one parameter |
| **D6** | Tool results sent as `assistant` rather than `role: "tool"` | **Yes** | Small — protocol conformance |
| **D8** | No usage metadata on the OpenAI-compatible path | **Yes** | Medium |
| D3 | `base_url` not normalised → a doubled `/v1/v1/` path | No | Trivial |
| D4 | A config object silently drops its own constructor's arguments | No | Trivial |
| D5 | Retries unbounded — we recorded 1,903 requests in ~90 seconds | No, but a billing risk | Small |
| D7 | Trailing whitespace on assistant content → HTTP 400 | No | Trivial |
| D9 | Vertex path hardcodes a Google publisher prefix for bare model names | No | Trivial |
| D10 | Thinking control is Gemini-only by type | No | Small |
| D11 | A fully-configured model still fails, demanding an unrelated API key | No | Small |

Each of these has a written reproduction. The full write-up — with the code
paths, the exact errors, and three ranked options for fixing them — is
[`GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md),
which we are happy to send as a standalone file.

### The three asks

**1. Thinking-level support on Gemini 2.5 Flash, or clearer signalling.** Vertex
hard-rejects the parameter:

> `request failed (code 400): Unable to submit request because thinking_level is
> not supported by this model`

We learned this by burning a paid run. Worse than the rejection was what
followed: the harness silently dropped the parameter and retried, so the
stage ran at a different thinking level than every record said it did. An
unannounced change to the experiment that every check passed. We have since
built detection for this class of drift, but a clear up-front capability
signal would be better than a runtime 400.

*Consequence for our results:* the tiered column differs from its sibling in
**both** model generation and thinking level, because on Vertex today those
cannot be varied independently for that model. We report the pair rather than
claiming the generation alone explains any difference.

**2. Model entitlement.** Gemini 3.5 Pro returns 404 for our project in every
region we probed — `asia-south1`, `global`, `us-central1`. The intended
cheap-versus-premium worker comparison is not runnable today.

**3. Anthropic models through the SDK — the Shape B unblock.** The SDK has
Anthropic support compiled in but not exposed, and the path that would reach it
returns tool results in a shape Anthropic's API rejects. Two consequences follow.
Today's: the harness seat has to use Claude Code's own authentication rather than
the SDK, so this cell is inherently two-model rather than configurable.
Tomorrow's, and the bigger one: **Shape B cannot be built.** An Antigravity-SDK
harness that can only reach Gemini is not a comparison — it changes the harness
and the worker at the same time, and no honest conclusion survives that.
Entitling our project to Anthropic models on Vertex is the cleanest unblock.

**What works well, and is worth saying:** the Gemini-on-Vertex path is solid,
and the SDK returns **real usage metadata** — token counts and the resolved
model. That is precisely what makes this whole study measurable. The CLI we used
before reported nothing, which is why every earlier run recorded a null cost.
The SDK turned our biggest blind spot into a line item.

---

## 8. Honest limits

We would rather state these than have them found.

- **One task per run, run sequentially.** Parallel runs share one seat window
  and one Vertex quota, so parallelism doubles the burn rate, not the capacity.
  Sequential is also cleaner science on our current hardware.
- **Four runs is a demonstration, not a ranking.** These prove the system works
  and the instrumentation is trustworthy. They do not establish that any model
  is better than another, and nothing here should be read that way.
- **Two claims, and only one of them is sealed.** *Provenance* — "the Gemini
  worker process authored every delivered byte" — is mechanical and holds at
  100%: the harness's file-editing tools are off, and each delegation carries an
  SDK receipt naming the model, the Vertex project and region, and the token
  counts. *Attribution* — "Gemini did the engineering thinking" — is weaker,
  and a delegation audit on 2026-07-28 found where. The harness cannot write
  code, but it can read the repository before it composes a hand-off, and a
  hand-off is free text. In one of the four runs the `execute` hand-off carried
  a finished test file, and **19 of its 24 lines (79%) appear verbatim in the
  graded diff**. The worker still ran it and still owned the rest of the
  delivery, so the bytes are genuinely its own — but the ledger books that
  delegation as worker engineering, and for those lines that is the wrong
  credit. This bites the SDLC workload specifically, because the `execute` stage
  authors the very test file the judge scores as `test_quality`.
- **It did not inflate the scores.** The run with the leak scored `test_quality`
  **8**; the clean control run in the same configuration, with zero leaks,
  scored **8.5**. Dictation moved credit, not quality.
- **What changed as a result, before run 4.** The driver's skill now states
  explicitly what a hand-off may and may not carry — the problem, the contract,
  the failing behaviour; never a diff, a finished file, or "change line X to Y".
  A **delegation content lint** now reads every hand-off out of the trajectory
  in stream order and records dictated code, hand-over phrasing, tree-mutating
  commands routed to the worker, and a command the guard had already refused to
  the driver. It **warns and never blocks**: a task file is free text, so nothing
  can classify it while the stage runs, and a runtime censor on it would break
  the one channel the method depends on. Its thresholds are measured rather than
  chosen — fifty real hand-offs are committed under `fixtures/delegation-corpus/`
  with human labels, and the root test suite replays the rules over all of them,
  so "6/6 dictations caught, zero false positives" is a test that can fail rather
  than a claim in a document.
- **Infrastructure failures currently consume a retry.** An environment stall is
  not yet distinguished from a model failure, so attempt counts can be slightly
  inflated. Bounded: it can only make a result look *worse*, never better.
- **The harness runs on the host with normal network access.** Its browsing
  tools are disabled and its actions are audited, but that is mitigation plus
  detection, not a sealed boundary.
- **One tiered run is one data point.** The finding in §6 is a signal worth
  following up, not a conclusion to route production traffic on.

---

## 9. Where this goes next

- **Escalation on the worker side.** Today every retry of a stage reuses the same
  worker model. Our production orchestrator already escalates to a premium tier
  after two failed cheap attempts — porting that rule is the natural next
  experiment, and §6 suggests it is the one that matters.
- **More briefs.** One brief demonstrates the pipeline; a set of briefs across
  different domains is what turns it into evidence.
- **A second harness.** The recipe is deliberately runtime-agnostic — the
  procedure is held byte-identical so that swapping the harness measures the
  harness, not the procedure. That is the comparison this was built for.

---

## Appendix A — for engineers: the reading path

Everything below the fold. Skip unless you are opening the code.

| Step | File | What it owns |
|---|---|---|
| 1 | [`run-harness.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/run-harness.mjs) | Entry point. ~100 lines, no workload-specific logic — the input directory selects the recipe. |
| 2 | [`kinds/sdlc.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/kinds/sdlc.mjs) | The SDLC recipe: loads the production template live, walks its stages, owns every gate. |
| 3 | [`kinds/lib.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/kinds/lib.mjs) | Shared machinery — policy loading, container command path, git diff mechanics, and `runStageAttempts`, which holds the retry loop and the zero-delegation gate. |
| 4 | [`runtimes.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/runtimes.mjs) | The Claude Code adapter: `renderWorkerSkill` (the delegation mandate), `renderTreeWriteHook` (the live guard), `workerTimeoutMin` (the clock split), and the CLI invocation itself. |
| 5 | [`gemini_worker.py`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/gemini_worker.py) | The SDK call — `LocalAgentConfig` → `ModelTarget` → `VertexEndpoint` → `Agent` → `resolve()` → usage sidecar. |
| 6 | [`audit.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/audit.mjs) | Trajectory audit. Shares its classifiers with the live guard, so blocks and flags agree by construction. |
| 7 | [`grade-sdlc.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/grade-sdlc.mjs) | The grader — re-runs build and tests in a fresh container after the last model call. |
| 8 | [`export-dashboard.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/export-dashboard.mjs) | Run directory → dashboard data, including downstream Vertex pricing. |

[`DESIGN.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/DESIGN.md) is the full design record; [`SDLC-RECIPE.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/SDLC-RECIPE.md)
is the operator's runbook.

### Reproducing it

```bash
# $0 — renders the full plan, policy resolution and every prompt.
# No model call, no image build.
node tools/harness-matrix/run-harness.mjs \
  --task-dir tools/harness-matrix/tasks/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \
  --dry-run

# $0 — re-render a finished run's exact terminal output from its record.
node tools/harness-matrix/replay-log.mjs --run-dir <run dir>

# Offline test suite — no API key, no network, no Docker.
node --test tools/harness-matrix/*.test.mjs tools/harness-matrix/kinds/*.test.mjs
```

Preflight is free and runs before any spend: harness authentication, CLI
presence, the worker environment's ability to import the SDK, and Vertex
credentials. A missing prerequisite fails at $0 rather than mid-run.

### What one run leaves behind

```
runs/kudos-wall/claude-code--<policy>/<timestamp>/
├── manifest.json          the record: policy + checksum, per-stage attempts,
│                          gates, costs, token ledgers, delegation counts
├── policy_snapshot.yaml   the exact policy bytes this run used
├── grade-verdict.json     the verdict, from a step that ran after the last
│                          model call
├── model.diff             the delivered code
├── audit.json             flags by family, harness edit count
└── out/
    ├── run-in-env.sh                 the container command path
    ├── requirements.md, design.md, packets.json, review.md, judge.json
    ├── worker-task-<stage>-N.md      what the harness asked for
    ├── worker-usage-<stage>-N.json   what the SDK reported back
    └── phases/<stage>-a<N>.trajectory.jsonl   every harness event
```

`bundle-run.mjs` packages a run for external sharing. It is an allowlist, not a
copy — it excludes the ~880 MB checked-out repository, the agent's home
directory and session state — and it runs a credential scan that **deletes the
bundle and writes nothing** on any hit. It publishes a checksum manifest over
every included file so a recipient can verify nothing was edited for appearance.

It is kind-aware: an SDLC bundle ships the requirements / design / packets /
review / judge artefacts and a re-verify recipe that re-runs the scaffold's own
build and tests in the pinned container, rather than the SWE-bench recipe of
rebuilding a public dataset row and re-grading a patch. Its integrity notes
state plainly that `judge.json` is a model's score and only the build and test
exit codes are mechanical.

The `delegation/` subfolder of every built bundle is the one part of `runs/`
committed to the repository (see `tools/harness-matrix/.gitignore`): 134 files,
760 KB across the ten delegated runs on record as of 2026-07-29 — 62 hand-offs
from six SWE-bench Pro runs and four SDLC runs. It is the only durable proof the
driver × SDK-worker cable ran — each pair is the exact prompt the driver wrote
and the usage sidecar the SDK returned, carrying the model, the SDK version,
the Vertex project and location, and the token counts.

When those files are extracted into a public repository they pass through
`scrub-paths.mjs`, which rewrites the authoring machine's absolute paths to
`/harness`, `/repo` and `/home/user` — the only difference between a published
hand-off and the one the driver actually sent. The substitution is gated: each
hand-off is linted before and after and the extraction aborts if the warning
families move, so a published finding can never disagree with the one this
repository reports. The recorded files themselves are never rewritten; the scrub
reads them and writes elsewhere.

---

## Appendix B — provenance

Every figure in this document was read from a run artifact.

| Claim | Source |
|---|---|
| Costs, tokens, turns, delegations | `runs/kudos-wall/*/manifest.json` and the exported study data |
| Delivered / tests / quality scores | `runs/kudos-wall/*/grade-verdict.json` |
| Zero harness edits | `runs/kudos-wall/*/audit.json` → `editCount: 0` |
| Claude Code 2.1.215, SDK `google-antigravity` 0.1.7 | run manifests |
| Vertex 400 on `thinking_level` | quoted verbatim in `policies/all-gemini-25-flash-high.yaml` |
| Pricing basis | verified Vertex rates, pricing version `2026-07-26.1` |
