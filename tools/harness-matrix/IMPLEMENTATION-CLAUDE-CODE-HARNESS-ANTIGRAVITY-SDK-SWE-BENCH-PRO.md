# Claude Code harness × Antigravity SDK — fixing real bugs in real repositories

**Implementation approach and results for the SWE-bench Pro workload.**

Prepared for Ravi and the Google team · 2026-07-27 · every number read from a
run artifact, not recalled.

Companion document:
[`IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SDLC.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SDLC.md)
— the same integration applied to building a service from a business brief.

---

## In one page

**What we were asked.** Google's ask, verbatim: *"Claude Code as Harness and
when it calls Gemini it should call Gemini + Antigravity together either using
Skills or CLI."*

**What we built.** A working system in which Claude Code acts purely as the
**harness** — the thing that runs the process and never does the work — and
Gemini, reached through the Antigravity SDK on Vertex, does **all** the
engineering. Claude Code reads the bug report, plans the
attack, delegates, checks every result and decides whether to accept it. It
cannot write a line of code: its file-editing tools are switched off. Every
change to the repository comes from Gemini.

**What it did.** We pointed it at SWE-bench Pro — Scale AI's hardest public
software-engineering benchmark, built from real issues in large open-source
projects. Each run gets one frozen repository and one bug report, and must
produce a patch. The patch is then graded by **Scale's own official evaluator**,
not by us, against a hidden test suite the system never sees.

**Results — six graded runs, five instances, four repositories, three languages
it had never seen before.**

| Run | Repository | Language | Verdict | Total cost | Wall clock |
|---|---|---|---|---:|---:|
| `2407-0932` | navidrome | Go | **Resolved** | $2.87 | 38m 33s |
| `2407-1117` | navidrome | Go | Not resolved | $2.45 | 33m 21s |
| `2607-1459` | ansible | Python | Not resolved | $3.60 | 15m 11s |
| `2607-1603` | NodeBB | JavaScript | **Resolved** | $3.56 | 14m 46s |
| `2607-2145` | navidrome | Go | Not resolved | $4.97 | 36m 00s |
| `2807-2224` † | openlibrary | Python | **Resolved** | $5.74 | 22m 11s |
| | | | **3 resolved** | **$23.18** | |

† The 28 Jul run is the **verification run**, executed after the delegation
audit described in §9 closed and its fixes landed. It is listed with the others
because the grading path is identical, but it is the only run whose driver skill
already carried the tightened delegation clause. Read the earlier five as the
evidence base and this one as the check that the fix did not break the method.

Every run was paid and real. Nothing here is a simulation or a fixture.

**The three findings that matter.**

1. **The integration is general, not tuned.** The cell resolved a JavaScript
   repository with a service-heavy test suite on its first ever attempt at
   JavaScript, and cleared every phase first-time on three of the five runs.
2. **The environment held under attack.** On one run the model went looking for
   the answer in the repository's git history — a known, published exploit for
   this benchmark. Our sealed image had already erased that history. We have the
   command it ran and the empty result it got back (§3).
3. **One of our three failures is not a model failure at all.** Gemini produced a
   correct fix that was scored wrong because it named a private constant
   `lastfmAPIKey` where the hidden test expected `lastFMAPIKey` (§6). That
   distinction is invisible in a leaderboard number and it changes how these
   scores should be read.

---

## 1. Why this benchmark

SWE-bench Pro is the hard version of the standard agentic coding benchmark.
Scale AI built it from real issues in large, live open-source projects, and it
was designed specifically to resist the two things that inflate scores on easier
suites: memorised solutions, and trivially small fixes.

We chose it for three reasons.

**It is externally graded.** We do not decide whether we passed. Scale's
`swe_bench_pro_eval.py` runs the project's own hidden test suite against our
patch, in a container with the network switched off, and returns a boolean. There
is no room for us to mark our own homework.

**It is the industry's shared yardstick.** A result here is directly comparable
with published numbers from other labs, which is exactly what a partnership
conversation needs.

**It is unforgiving in a useful way.** A patch that looks right, reads right and
passes the reproduction the model wrote itself can still be scored wrong. That
gap — between plausible and correct — is the whole point, and §6 is about what
we learned in it.

The companion SDLC document covers the other half of the picture: benchmarks
measure bug-fixing, customers buy delivery. Read together, the two documents
show the same integration handling both.

---

## 2. How it works, in plain terms

Think of it as a **senior engineer directing a contractor**.

The senior engineer is Claude Code. They read the bug report, decide the plan of
attack, write the work order, check what comes back and either accept it or send
it back with specifics. They never touch the keyboard.

The contractor is Gemini, reached through the Antigravity SDK. They do all the
actual work: reading the codebase, writing the reproduction test, finding the
faulty code, writing the fix.

The separation is **enforced, not requested**. The harness physically
cannot edit a file — the tools are removed from its session. We did not tell it
to delegate and hope. We took away the alternative (§4).

```
   Bug report ──►  Claude Code (harness)  ──►  Antigravity SDK  ──►  Gemini
                   • plans the attack                • the cable          • on Vertex,
                   • writes the work orders                                 asia-south1
                   • checks every result                                  • reads the repo
                   • decides accept / redo                                • writes the test
                   • CANNOT write code                                    • writes the fix
                          │
                          ▼
                   Sealed container ──► patch ──► Scale's official evaluator
                   (git history erased,           (hidden tests, network off)
                    source hosts blocked)                    │
                                                             ▼
                                                    resolved / not resolved
```

### Three phases, three gates

A run is three stages, in a fixed order, each of which must satisfy a
machine-checked condition before the next one starts.

| Phase | What must be produced | The gate — what must be true to proceed |
|---|---|---|
| **1. Reproduce** | A new test that fails *because of* the bug | The test exists, it actually **fails** on the unfixed code, and the phase created nothing else |
| **2. Localise** | The list of non-test source files that hold the bug | Every named file exists, **none of them is a test file**, and the repository is byte-identical — this phase is read-only |
| **3. Patch** | The fix | Three checks: a real source change exists; the reproduction now **passes**; and the project's own surrounding suite is **no worse than it was before** |

Three properties of this design are worth pausing on, because they are what make
the result defensible rather than merely good.

**The reproduction must fail first.** A test that passes before the fix proves
nothing. Requiring the failure first is what makes the later pass meaningful.

**Localisation may not name a test file.** Otherwise the cheapest "fix" is to
edit the test until it agrees with the bug. The gate rejects it outright.

**Test edits are stripped before grading.** Whatever the model touched, the patch
we submit is computed from source files only. Its own reproduction test and any
test-directory changes are removed from the diff before Scale ever sees it. The
system cannot pass by rewriting the exam.

When a gate fails, its reason is fed back to the next attempt **verbatim** — not
"try again", but the exact sentence describing what was wrong. On run `2407-0932`
that loop is what produced the resolved verdict: the first reproduction attempt
hit a time limit, the retry cleared it, and the run went on to resolve.

---

## 3. The sealed environment — and the attack it stopped

This is the part of the Pro workload that has no equivalent on the SDLC side,
and it is the part we would put in front of a sceptic first.

**The problem.** The benchmark's stock container images ship the repository with
its *full* git history — including commits made *after* the bug, and in many
cases the official fix itself. An agent that runs `git log` can simply read the
answer. This is a published defect in the benchmark
(`scaleapi/SWE-bench_Pro-os` issue #93); on one instance we inspected, the image
carried 164 future commits plus a live GitHub remote.

**What we do about it.** Before any model runs, we rebuild the image and erase
the history entirely: the working tree is re-initialised as a fresh repository
with exactly one commit and no remotes, no reflog, no other tags. The original
commit identifier is kept in that commit's subject line for audit — it is public
metadata, embedded in the instance name — but the history it once pointed into is
gone. In the same step, the major source-code hosts are blocked inside the
container, so the fix cannot be fetched over the network either.

**And then a model went looking.** On run `2607-2145`, the localisation phase
issued three history-mining commands. Our post-run audit flags them as critical,
by design — we want to know. Here is what it ran, and what came back:

| Command the model ran | What it got back |
|---|---|
| `git log --all --oneline -10` | one line: `sealed-base db11b6b8…` |
| `git log --all --format="%H %s" \| head -5` | the same single line |
| `git show --stat b3980532…` *(the actual fix commit)* | `commit not available` |

The model asked for the answer, by exact commit identifier, and the environment
had nothing to give it. That is the seal working, evidenced rather than asserted.

We report this rather than omitting it for a simple reason: a study that only
publishes its clean runs is not evidence of anything. The flags are in the run
record, they are marked critical, and they resolve in our favour.

---

## 4. How we know Gemini did the engineering

The single most important claim in this document is that Gemini did the work. If
that claim is soft, nothing else here means anything. So it is enforced in five
independent layers.

| Layer | What it does | When it acts |
|---|---|---|
| 1. Tools removed | The harness's file-editing tools are switched off entirely | Structurally — the ability does not exist |
| 2. Shell write ban | Any shell command that writes into the repository is blocked in real time | Per command, live |
| 3. Delegate-first lock | Until the first delegation of each phase, the harness cannot even *read* the repository | Live, until it delegates |
| 4. Zero-delegation gate | A phase the harness completed alone **fails**, and is retried | End of each phase attempt |
| 5. Post-run audit | Every action the harness took is re-examined afterwards | After the run |

**Result across all six runs: zero harness edits.** The audit records
`editCount: 0` every time. Across the six runs there were **30 delegations** to
Gemini.

Layer 3 is not theoretical. On run `2607-2145` the harness tried four times
to open the repository before delegating, and the live guard denied all four; the
audit records the attempts. It then delegated, and the phase proceeded.

### Why five layers and not one — we learned each of them the hard way

**The first attempt had a written instruction and all tools available.** The
instruction said, in capital letters, always delegate. The harness read it,
then edited the file itself. Zero delegations. A well-written mandate lost to an
available tool.

So we removed the tools. **The second attempt showed the subtler failure.** With
no way to write code, the harness could still do all the *thinking* — it
read the source files, ran the test suite twice, worked out where the bug was,
and only then delegated, using Gemini as a typist. The delegation counter said
"1". The intellectual work was entirely the harness's.

That is why layer 3 exists: until it delegates, the harness cannot read the
repository at all. It has to hand over the problem, not a pre-solved answer.

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
really unaided while still showing a non-zero delegation count. That is
the single shape the counter cannot see.

Fixed by making the timeouts nest properly, so Gemini's own limit always fires
first and always leaves a diagnosable trace. We found this by reading logs, not
by it failing loudly.

---

## 5. Results in detail

Six graded runs. Costs split by who spent them.

| Run | Instance | Phase attempts | Delegations | Harness | Gemini | **Total** | Verdict |
|---|---|---:|---:|---:|---:|---:|---|
| `2407-0932` | navidrome (Go) | 4 | 5 | $1.9072 | $0.9602 | **$2.8674** | **Resolved** |
| `2407-1117` | navidrome (Go) | 3 | 7 | $1.6817 | $0.7647 | **$2.4464** | Not resolved |
| `2607-1459` | ansible (Python) | 3 | 4 | $1.6789 | $1.9239 | **$3.6028** | Not resolved |
| `2607-1603` | NodeBB (JavaScript) | 3 | 4 | $1.7491 | $1.8065 | **$3.5556** | **Resolved** |
| `2607-2145` | navidrome (Go) | 3 | 5 | $2.4173 | $2.5514 | **$4.9687** | Not resolved |
| `2807-2224` † | openlibrary (Python) | 4 | 5 | $2.1273 | $3.6122 | **$5.7395** | **Resolved** |
| | **totals** | **20** | **30** | **$11.5615** | **$11.6188** | **$23.1803** | **3 / 6** |

Three of the first five runs cleared **every phase on the first attempt** — no
gate failures, no timeouts, no retries. † is the verification run described in
*In one page*: same grading path, but the only one whose driver skill already
carried the tightened delegation clause.

What the graders reported on the three resolved runs and the clearest failure:

| Run | What Scale's evaluator saw |
|---|---|
| `2607-1603` NodeBB | **273 distinct tests passed, 0 failed**, both required tests passed |
| `2407-0932` navidrome | Required test passed |
| `2807-2224` openlibrary | 4 tests passed, 0 failed, all 4 required tests passed |
| `2607-1459` ansible | 3 of 7 required tests passed — the patch was genuinely wrong (§6) |

### Two costs, kept separate on purpose

Harness spend runs on a Claude Code Max seat, which is a subscription. The
dollar figure is what the same work *would* cost through the metered API,
computed from real token counts — it is a modelled figure, not a bill.

Gemini spend is **real money** on Vertex, computed from the token counts the
Antigravity SDK reports, at verified regional rates.

We never re-add these into one number without saying which is which. A blended
figure would hide exactly the thing this study exists to measure.

---

## 6. What the three failures actually tell you

Three runs did not resolve. They failed for three completely different reasons,
and pooling them into "3 losses" would throw away the most useful information we
have. Only one of the three is a model reasoning failure.

### Failure 1 — a genuinely wrong fix (`2607-1459`, ansible)

The task turns on which package manager a host resolves to. Gemini made the
existence of one binary the decisive test and evaluated it first; the hidden
suite defines the answer by what a different path resolves to. Inverted
precedence. 3 of 7 required tests passed.

This is the honest kind of loss: our scaffold was flawless — every phase cleared
first attempt, no timeouts, no retries — and the reasoning was wrong. **This is
the failure class a better model fixes.**

### Failure 2 — the environment ran out of clock (`2407-1117`, navidrome)

The patch phase hit a ten-minute cap mid-verification and was killed. The work
was in progress; the cap ended it.

This is our scaffold's failure, not a model failure, and it is ours to fix. The cap
was a deliberately tight setting from our earliest live runs; later runs use a
45-minute phase limit and did not hit it. We keep this run in the tally anyway —
excluding your own infrastructure failures is how resolve rates get flattered.

### Failure 3 — a correct fix, scored wrong (`2607-2145`, navidrome)

This one is the most interesting result in the document.

The bug: a constructor should fall back to a built-in shared API key when none is
configured. Gemini found it, fixed it correctly, and introduced the constant the
fix requires:

```go
lastfmAPIKey = "9b94a5515ea66b2da3ec03c12300327e"
```

The hidden test file — which the system is never allowed to see — refers to that
same constant as `lastFMAPIKey`. Capital F, capital M.

The Go compiler does not care that the two are the same idea. The test file
failed to compile, so **zero tests ran**, so the instance scored not resolved:

```
core/agents/lastfm_test.go:16:49: undefined: lastFMAPIKey
FAIL  github.com/navidrome/navidrome/core/agents [build failed]
```

The bug report never names this identifier — the constant does not exist in the
codebase before the fix, so there is nothing to match. The grader is
simultaneously testing "did you fix the bug" and "did you guess our private
variable name", and reports a single boolean for both.

We are not claiming the run should be scored resolved; the rules are the rules,
and we report it as not resolved everywhere. We are claiming something narrower
and more useful:

> On this benchmark family, a "not resolved" verdict does not always mean the
> model was wrong. Some fraction of every published score is identifier-naming
> luck on symbols the problem statement never mentions. Anyone reading a
> leaderboard — ours or anyone else's — should know that.

This is also a concrete contribution back to the benchmark, in the same category
as the git-history leak in §3: both are cases where reading the artifacts
carefully told us more than the score did.

---

## 7. The commercial finding

Across the six runs the split is:

| | Share of total spend | What it produced |
|---|---:|---|
| **Harness** (Claude Opus 4.6) | **49.9%** | Plans, work orders, gate decisions. **No code.** |
| **Worker** (Gemini 3.5 Flash) | 50.1% | Every reproduction test and every fix |

The equivalent split on the SDLC workload is **66.0% / 34.0%** — the harness
there is a substantially larger share of the bill. Same architecture, same
models, same cable; very different economics.

> The harness/worker cost split is a property of the **workload**, not of the
> architecture — and it is measurable per workload *before* you commit to a
> routing policy.

The reason is visible in the design: the bug-fixing recipe pushes far more of the
work down to the worker. Reading a large repository, running its suite,
understanding a failure — all of that happens on Gemini's side of the cable, and
Gemini is the cheap model. The SDLC recipe asks the harness to hold more
judgement itself, and it charges accordingly.

That is directly actionable for cost-optimised routing, and it is the kind of
number you can only produce if you refuse to collapse the two wallets into one.

### The caching caveat we insist on

Look at the most expensive run, `2607-2145`:

| | Harness | Worker |
|---|---:|---:|
| Turns / delegations | 76 turns | 5 delegations |
| Input tokens read | 2,074,499 | 5,605,240 |
| — of which cache reads | 1,989,762 (**95.9%**) | 4,920,269 (**87.8%**) |
| Output tokens written | 23,028 | 61,548 |
| **Cost** | **$2.4173** | **$2.5514** |

Both sides are reading millions of tokens and both are overwhelmingly cache
reads. Pricing raw input totals at the full rate would overstate this run's cost
several-fold. Our records keep fresh and cached input separate on both sides, and
the live terminal prints the fresh figure every time with a note that it is the
one to price.

One more observation worth flagging to Google: the worker's cache-read ratio
landed at **83.5% on two unrelated repositories on the same day**, and 82.5% two
days earlier on a third. The delegation cable's economics look like a property of
the *cable*, not of the workload.

---

## 8. What we need from Google

First, the context these asks sit in, because it is easy to misread them.

Google described **two shapes**, and they are not the same experiment:

| | Who runs the process | Who does the engineering | Status |
|---|---|---|---|
| **Shape A** — *this document* | Claude Code, as the harness | Gemini, through the Antigravity SDK | **Built, run, graded** |
| **Shape B** | The **Antigravity SDK itself**, as the harness | whichever model it is pointed at | **Blocked** — see items 2 and 3 |

Shape A is what we have evidence for. Shape B is the one that turns this from a
demonstration into a comparison: run the *same* procedure under a different
harness and the difference in outcome is attributable to the harness, because
nothing else moved. We built the recipe deliberately so that swap is a
one-line change. What we cannot do is make the swap while the SDK cannot drive
a full agent loop on the models we need.

So the three asks below are not a wish list. Items 2 and 3 are the specific
things standing between us and Shape B; item 1 is what makes either shape
scientifically interesting.

### What we found in the SDK, in brief

We moved off the `agy` CLI onto the Antigravity SDK at Google's request, and
probed it end to end with live paid runs against both Gemini and Claude. Two
things came out of that.

**The SDK is better than the CLI at everything we measure.** It returns real
token counts, it has a working thinking control, and it runs on our own paid
Vertex project. The CLI reported no usage data at all, which is why every run we
did before the SDK recorded a null cost. That upgrade is what makes §7 of this
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

**1. Model entitlement — Gemini 3.5 Pro.** Returns 404 for our project in every
region we probed: `asia-south1`, `global`, `us-central1`. The comparison this
benchmark is best suited to answer — does a stronger worker convert the reasoning
failures in §6 into resolves? — is not runnable today. Of everything on this
list, this is the one that unblocks the most science.

**2. Thinking-level support on Gemini 2.5 Flash, or clearer signalling.** Vertex
hard-rejects the parameter:

> `request failed (code 400): Unable to submit request because thinking_level is
> not supported by this model`

We learned this by burning a paid run. Worse than the rejection was what followed:
the harness silently dropped the parameter and retried, so the stage ran at a
different thinking level than every record said it did. An unannounced change to
the experiment that every check passed. We have since built detection for this
class of drift, but a clear up-front capability signal would be better than a
runtime 400.

**3. Anthropic models through the SDK — the Shape B unblock.** The SDK has
Anthropic support compiled in but not exposed, and the path that would reach it
returns tool results in a shape Anthropic's API rejects. Two consequences follow.
Today's: the harness seat has to use Claude Code's own authentication rather than
the SDK, so this cell is inherently two-model rather than configurable.
Tomorrow's, and the bigger one: **Shape B cannot be built.** An Antigravity-SDK
harness that can only reach Gemini is not a comparison — it changes the harness
and the worker at the same time, and no honest conclusion survives that.
Entitling our project to Anthropic models on Vertex is the cleanest unblock, and
it is the single item that converts this study from one configuration into a
matrix.

**What works well, and is worth saying:** the Gemini-on-Vertex path through the
SDK is solid, and it returns **real usage metadata** — token counts and the
resolved model, per call. That is precisely what makes §7 possible. The CLI we
used before this reported nothing, which is why every earlier run recorded a null
cost. The SDK turned our biggest blind spot into a line item.

---

## 9. Honest limits

We would rather state these than have them found.

- **Five runs on four hand-picked instances is not a resolve rate.** It
  demonstrates that the system works across languages and repositories. It does
  not support "we score X%", and nothing here should be quoted that way. One
  instance was attempted twice and resolved once; we report that as 1/2, not as a
  50% rate.
- **No cross-system comparison yet.** These numbers describe one configuration.
  Comparing harnesses or workers requires the full matrix, which has not run.
- **The two 24 July runs used a tighter configuration** — a ten-minute phase cap
  and a small per-phase budget, from our first live runs — and one of them lost
  its patch phase to that cap. Later runs use 45 minutes. We keep both in the
  tally rather than re-running the loser under kinder settings.
- **Infrastructure failures currently consume a retry.** An environment stall is
  not yet distinguished from a model failure, so attempt counts can be slightly
  inflated. Bounded: it can only make a result look *worse*, never better.
- **The harness runs on the host with normal network access.** Its browsing
  tools are disabled and its actions are audited, but that is mitigation plus
  detection, not a sealed boundary. The *repository* container is sealed; the
  harness process is not.
- **The "no worse than baseline" gate uses exit codes.** On a project whose suite
  was already failing before we touched it, that gate records a warning instead of
  failing the phase. Per-language failure-set comparison is a known refinement.
- **Two claims, and only one of them is sealed.** *Provenance* — "the Gemini
  worker process authored every delivered byte" — is mechanical and holds at
  100%: the harness's file-editing tools are off, and every delegation carries an
  SDK receipt naming the model, the Vertex project and region, and the token
  counts. *Attribution* — "Gemini did the engineering thinking" — is weaker. The
  harness cannot write code, but it can read the repository before it composes a
  hand-off, and a hand-off is free text, so a diagnosis the harness reached itself
  can reach the worker inside the task. A delegation audit on 2026-07-28 read all
  eight runs recorded to that date, hand-off by hand-off, and found three
  SWE-bench Pro hand-offs that carried more than they should have.
- **Those three did not touch these numbers, and we can show why.** All three
  are `repro` hand-offs — the stage that builds a failing reproduction — and
  reproduction scaffolding is stripped from the submission before grading. Scale's
  evaluator scores the patch against its own hidden test sets. Line-by-line
  overlap of each leaked hand-off against its own run's graded diff is **0 of 16,
  0 of 20, and 0 of 22**: not one dictated line reached a graded artifact. **The
  SWE-bench Pro results above are not contaminated.** (The SDLC workload is a
  different story and its own document says so plainly — there the `execute` stage
  authors the file the judge scores.)
- **What changed as a result, before the 28 Jul run.** The driver's skill now
  states explicitly what a hand-off may and may not carry — the problem, the
  contract, the failing behaviour; never a diff, a finished file, or "change line
  X to Y". A **delegation content lint** now reads every hand-off out of the
  trajectory in stream order and records dictated code, hand-over phrasing,
  tree-mutating commands routed to the worker, and a command the guard had already
  refused to the driver. It **warns and never blocks** — a task file is free text,
  so nothing can classify it while the phase runs, and a runtime censor on it
  would break the one channel the method depends on. Its thresholds are measured
  rather than chosen: fifty real hand-offs are committed under
  `fixtures/delegation-corpus/` with human labels, and the root test suite replays
  the rules over all of them, so "6/6 dictations caught, zero false positives" is
  a test that can fail rather than a claim in a document.

---

## 10. Where this goes next

- **A stronger worker.** §6 says our clearest loss was a reasoning failure. Item 1
  in §8 is what lets us test whether a better worker converts it. These are the
  same sentence from two directions.
- **The full matrix.** The recipe is deliberately runtime-agnostic — the procedure
  is held byte-identical so that swapping the harness measures the
  *harness*, not the procedure. That is the comparison this was built for, and
  it is gated on the SDK items above.
- **More instances.** Five instances across four repositories demonstrate
  generality. A published resolve rate needs a corpus, and the machinery to run
  one already exists.
- **Feeding the naming finding back.** §6 is worth raising with Scale; it affects
  every score on the benchmark, not just ours.

---

## Appendix A — for engineers: the reading path

Everything below the fold. Skip unless you are opening the code.

| Step | File | What it owns |
|---|---|---|
| 1 | [`run-harness.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/run-harness.mjs) | Entry point. ~100 lines, no workload-specific logic — the input directory selects the recipe. |
| 2 | [`kinds/swepro.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/kinds/swepro.mjs) | The Pro recipe: sealed image build, workdir extraction, the three phases and all three gates. |
| 3 | [`kinds/lib.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/kinds/lib.mjs) | Shared machinery — policy loading, container command path, `computeDiff` (the graded diff and its strip rules), and `runStageAttempts`, which holds the retry loop and the zero-delegation gate. |
| 4 | [`runtimes.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/runtimes.mjs) | The Claude Code adapter: `renderWorkerSkill` (the delegation mandate), `renderTreeWriteHook` (the live guard), `workerTimeoutMin` (the clock split), and the CLI invocation itself. |
| 5 | [`gemini_worker.py`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/gemini_worker.py) | The SDK call — `LocalAgentConfig` → `ModelTarget` → `VertexEndpoint` → `Agent` → `resolve()` → usage sidecar. |
| 6 | [`Dockerfile`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/Dockerfile) | The seal: history erased to one commit, `sealed-base` tag as the diff anchor. |
| 7 | [`audit.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/audit.mjs) | Trajectory audit. Shares its classifiers with the live guard, so blocks and flags agree by construction. |
| 8 | [`grade.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/grade.mjs) | Hands the patch to Scale's `swe_bench_pro_eval.py` — `--block_network`, `--docker_platform linux/amd64`, `--num_workers 1`. The verdict is theirs, not ours. |
| 9 | [`export-dashboard.mjs`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/export-dashboard.mjs) | Run directory → dashboard data, including downstream Vertex pricing. |

[`DESIGN.md`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/DESIGN.md) is the full design record — §6 is the file-by-file code
walkthrough, §10–§12 are the run logs these results come from.

### Exact configuration

| | |
|---|---|
| Harness | Claude Code 2.1.215, model `claude-opus-4-6`, Max seat (OAuth) |
| Worker | `gemini-3.5-flash`, thinking `HIGH` |
| Cable | `google-antigravity` 0.1.7 → Vertex, project `ai-studies-console`, region `asia-south1`, ADC |
| Policy | `all-gemini-flash-high.yaml`, checksum recorded in every run manifest |
| Retry | flat, max 3 attempts per phase |
| Grader | Scale `swe_bench_pro_eval.py`, network blocked, one worker |
| Pricing | verified Vertex rates, pricing version `2026-07-26.1` |

### Reproducing it

```bash
# $0 — renders the full plan, policy resolution and every prompt.
# No model call, no image build.
node tools/harness-matrix/run-harness.mjs \
  --instance-dir <instance dir> \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \
  --dry-run
```

```bash
# $0 — re-render a finished run's exact terminal output from its record.
node tools/harness-matrix/replay-log.mjs --run-dir <run dir>
```

```bash
# Offline test suite — no API key, no network, no Docker.
node --test tools/harness-matrix/*.test.mjs tools/harness-matrix/kinds/*.test.mjs
```

Preflight is free and runs before any spend: harness authentication, CLI
presence, the worker environment's ability to import the SDK, Vertex credentials,
and the base image's existence. A missing prerequisite fails at $0 rather than
mid-run.

### What one run leaves behind

```
runs/<instance>/claude-code--<policy>/<timestamp>/
├── manifest.json          the record: policy + checksum, per-phase attempts,
│                          gates, costs, token ledgers, delegation counts
├── model.diff             the graded patch (test paths stripped)
├── raw.diff               the unstripped diff, for inspection
├── grade-verdict.json     Scale's boolean and the grader it came from
├── grade/out/…            the evaluator's own output, per test
├── audit.json             flags by family, harness edit count
└── out/
    ├── run-in-env.sh                the container command path
    ├── repro.json, localize.json, patch.json   the phase contracts
    ├── worker-task-<phase>-N.md     what the harness asked for
    ├── worker-usage-<phase>-N.json  what the SDK reported back
    └── phases/<phase>-a<N>.trajectory.jsonl    every harness event
```

`bundle-run.mjs` packages a run for external sharing. It is an allowlist, not a
copy — it excludes the checked-out repository, the agent's home directory and
session state — and it runs a credential scan that **deletes the bundle and
writes nothing** on any hit. It publishes a checksum manifest over every included
file so a recipient can verify nothing was edited for appearance.

It is kind-aware. A SWE-bench Pro bundle carries the agent-safe `instance.json`,
withholds the sealed grading row and publishes its sha256 instead, and hands the
reader a recipe to rebuild that row from the public dataset and re-grade our
patch with Scale's evaluator at the pinned commit. The SDLC kind gets a
different recipe entirely — see the SDLC implementation doc.

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
| Costs, tokens, turns, delegations, phase attempts | `runs/instance_*/…/manifest.json` |
| Resolved / not resolved | `runs/instance_*/…/grade-verdict.json` (Scale's evaluator) |
| Per-test pass and fail counts | `runs/instance_*/…/grade/out/*/harness_output.json` |
| Zero harness edits | `runs/instance_*/…/audit.json` → `editCount: 0` |
| The three git-history commands and their empty results | `2607-2145` LOCALIZE trajectory, flagged critical in `audit.json` |
| The `lastfmAPIKey` / `lastFMAPIKey` mismatch | `2607-2145` `model.diff` and the grader's `harness_stdout.log` |
| The git seal | [`Dockerfile`](https://github.com/tl-ai-labs/ai-studies-console/blob/main/tools/harness-matrix/Dockerfile), lines 43–65 |
| Claude Code 2.1.215, SDK `google-antigravity` 0.1.7 | run manifests and worker usage sidecars |
| Vertex 400 on `thinking_level` | quoted verbatim in `policies/all-gemini-25-flash-high.yaml` |
| Pricing basis | verified Vertex rates, pricing version `2026-07-26.1` |
