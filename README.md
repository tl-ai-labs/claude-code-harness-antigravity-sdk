# Claude Code Harness — Antigravity SDK Connector

**Requires:** Node ≥ 22, pnpm ≥ 11, [Claude Code CLI](https://docs.claude.com/en/docs/claude-code), Python ≥ 3.10, Docker, a Google Cloud project with Vertex AI enabled, and either an Anthropic API key or a Claude Code subscription.

## Overview

A delegated agent harness. **Claude Code is the driver — an Anthropic
Opus running the pipeline, orchestrating, deciding, verifying. Gemini
is the worker — a Google model reached through the Antigravity SDK on
Vertex AI, doing the actual engineering.** The driver's file-writing
tools are removed at process launch, a pre-execution hook blocks any
shell command that would edit a file, and a post-run audit re-checks
the whole transcript — all three share one predicate, so they cannot
disagree.

Ships with two workloads: an SDLC brief (`examples/kudos-wall/`) and a
verified bug-fix pipeline (`examples/swe-bench-pro/`, using Scale AI's
SWE-bench Pro corpus and official evaluator). Five policies cover the
model choices — Opus-only, a Gemini Flash worker on every stage, the
tiered `opus48-plus-lite` that keeps judgment on the driver and sends
production work to Gemini, and two cross-generation columns kept from
earlier study runs. Which Gemini model is a policy field, not a
property of the harness.

Runs use your own Anthropic credentials and your own Google Cloud
project. Telemetry, generated code, and reports are written under the
repo; nothing is uploaded.

## The Gemini Enterprise tokenomics story

The harness is a working demonstration of what "Gemini as tokenomics
partner" looks like in practice. Keep your Claude Code or OpenAI
subscription for the parts of an SDLC pipeline that need the strongest
brain; route the volume work to Gemini through the Antigravity SDK.
`opus48-plus-lite` is that story in a single file, and it splits on
exactly the line the sentence above draws: Opus 4.8 holds the judgment
stages by itself (requirements, design, plan-packets, review, judge)
while Gemini 3.5 Flash-Lite does the production work (execute, and the
repair rounds that inherit its binding). One driver, two tiers.

`gemini35-plus-25-flash-high` tells the same story with a different cut
— every stage delegates, and it is the *worker* that changes between
tiers. Use it when you want the driver held constant by construction.
See [docs/policies.md](docs/policies.md).

## Quickstart

```bash
git clone https://github.com/tl-ai-labs/claude-code-harness-antigravity-sdk.git
cd claude-code-harness-antigravity-sdk
node tools/setup.mjs
```

The setup wizard has three modes and picks the smallest one that fits
what you want to do:

- **`--offline`** — Node + pnpm, run the offline test suite, exit.
  No credentials needed.
- **`--sdlc`** — offline + Claude Code CLI + Anthropic auth + the
  Antigravity SDK worker venv + Google Cloud ADC + Docker. Enough
  to run a delegated SDLC workload end-to-end.
- **`--swe-pro`** — SDLC + Scale AI's evaluator clone at the pinned
  SHA + ~30 GB free disk check.

Without a flag, the wizard asks. Each mode maps 1:1 to a section in
[docs/setup.md](docs/setup.md), so a deliberate reader can follow the
docs by hand instead.

Then, to run:

```bash
# Prove the plumbing without spending — no credentials required
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \
  --dry-run

# The cheapest live SDLC run — ~$3–4, 20–30 min
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml

# The tokenomics pass — Opus + tiered Gemini worker
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml
```

Output lands under
`tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/` —
manifest, model diff, grade verdict, evidence bundle. See
[docs/understanding-output.md](docs/understanding-output.md).

The run's own closing scoreboard reports the worker's **token counts**
but withholds its **dollar figure**, on purpose: a harness should not
invent a price mid-run, before the rate pin has been checked against the
published Vertex rate. `tools/report.mjs` is the downstream that prices
it — per model and per region, through the one pricing package, naming
the rate-table version it used so the number can be re-derived or
disputed. It also says, in words, which of the two dollar figures is a
real invoice and which is modelled. Free, offline, read-only:

```bash
node tools/report.mjs tools/harness-matrix/runs/<taskId>/<cell>/<stamp>
```

## Running against your own brief

The harness is not coupled to the kudos-wall example. Copy the example
directory to `examples/<your-task-id>/`, replace `brief.md` with your
own free-text brief (the layout the `sdlc-mini` template expects is in
[docs/brief-template.md](docs/brief-template.md)), re-pin the
`brief_sha256` in `task.json`, and point `--task-dir` at the new
directory. The offline test suite picks up new workloads automatically.

Full workflow in [docs/running.md#bringing-your-own-sdlc-workload](docs/running.md#bringing-your-own-sdlc-workload).

## The five shipped policies

| Policy | What it uses | What it demonstrates |
|---|---|---|
| `all-opus` | Claude Opus 4.8 for every stage; no delegation | The **anchor** — baseline for cost and quality comparisons. **Runs no Antigravity SDK code at all**: use it for the baseline, not to check that the connector works. |
| `all-gemini-flash-high` | Opus 4.8 driver, Gemini 3.5 Flash-Lite worker on every stage | The **delegated cell** — cheapest way to prove the cable works end-to-end |
| `opus48-plus-lite` | Opus 4.8 alone on judgment stages; Opus 4.8 → Flash-Lite on production stages | The **tokenomics pass** — one driver, two tiers, split across the driver/worker line |
| `all-gemini-25-flash-high` | Opus 4.6 driver *(as run)*, Gemini 2.5 Flash worker on every stage | **Historical column** — the generation comparison against `all-gemini-flash-high` as it was pinned in July 2026 |
| `gemini35-plus-25-flash-high` | Opus 4.6 driver *(as run)*, 3.5 Flash on judgment stages, 2.5 Flash on volume stages | **Historical column** — the same tiering cut with the *worker* as the variable and the driver held constant |

The top three share one driver — Opus 4.8 at `--effort high` — so the
only thing that separates them is how much work is delegated. The bottom
two are kept because a shipped exemplar pass records a real run of each,
and they stay on the Opus 4.6 driver those passes actually ran on. Each
file's header lists exactly what it ran with and why it is not a current
pin.

Cost depends on workload size, model output length, and current vendor
pricing. Each run's manifest shows what it spent, derived from the
Antigravity SDK's own token receipts (worker) and the CLI's usage log
(driver). Live SDLC runs on `all-gemini-flash-high` × kudos-wall have
landed at $3–4 per pass historically — but those passes ran on
`gemini-3.5-flash`, and the policy now pins `gemini-3.5-flash-lite` at
roughly a fifth the input rate, so treat that figure as a ceiling
rather than an estimate. See [docs/policies.md](docs/policies.md).

## Enforcement — the driver cannot write

Three independent layers agree on the same predicate:

1. **Tool removal.** The `claude` process is launched with
   `--disallowedTools Edit Write NotebookEdit MultiEdit`, so the
   file-writing tools are absent from the tool list.
2. **PreToolUse guard hook.** Any `Bash` command that would write into
   the working tree is denied before it executes.
3. **Post-run audit.** The recorded trajectory is re-checked using the
   **same function** the live guard uses. They cannot disagree.

The predicate lives in `tools/harness-matrix/audit.mjs`. `guard.test.mjs`
and `audit.test.mjs` both exercise it — a change to what counts as
"writing into the tree" changes both simultaneously, or a test fails.

This enforces **provenance** (every delivered byte was authored by the
Gemini worker process). It does **not** enforce **attribution** (that
Gemini did the engineering thinking) — the driver-to-worker channel is
free text, and free text can carry a finished function. See
[docs/methodology.md](docs/methodology.md) for the distinction and how
to cite the results honestly.

## Reference exemplars

Each workload directory carries one committed exemplar pass so you can
read the driver-to-worker channel without running the harness:

- **[examples/kudos-wall/passes/reference/](examples/kudos-wall/passes/reference/)** — 12 hand-offs and their SDK usage receipts from a real
  `gemini35-plus-25-flash-high` run (the tokenomics pass, on kudos-wall).
- **[examples/swe-bench-pro/passes/navidrome/](examples/swe-bench-pro/passes/navidrome/)** — 5 hand-offs and their SDK usage receipts from one real
  SWE-bench Pro attempt (navidrome instance,
  `all-gemini-flash-high` policy).

Both were recorded in July 2026, and their receipts name the worker
that ran at the time — `gemini-3.5-flash` and `gemini-2.5-flash`.
`all-gemini-flash-high` has since been re-pinned to
`gemini-3.5-flash-lite`, so the model id in these files will not match
the model id in the policy file of the same name. That is the receipts
being right, not stale: a usage receipt records what the run actually
called, and re-writing one to agree with a later policy edit would
destroy the only evidence of what was really billed. The policy headers
carry the same note from the other direction.

Each `worker-task-*.md` is the exact text the driver sent the worker.
Each `worker-usage-*.json` is the Antigravity SDK's own token receipt
for that delegation (model, SDK version, Vertex project/location,
token counts). These are the artifacts a customer engineer can hand a
customer as proof-of-mechanism without running the harness.

These receipts are unedited, which is the point of shipping them — so
the kudos-wall ones name the Google Cloud project that actually paid
for that run, which is ours. It is a record of who was billed, not a
setting: your own runs record your own project, and nothing in the
harness reads a project from these files. The older navidrome receipts
predate the project/region fields and simply omit them; the exporter
reports that as unrecorded rather than filling in a guess.

## Documentation

- [docs/setup.md](docs/setup.md) — the three setup profiles (offline, SDLC live, SWE-bench Pro) end-to-end, plus a troubleshooting table
- [docs/running.md](docs/running.md) — invocations, flags, exit codes, bringing your own workload
- [docs/architecture.md](docs/architecture.md) — how the harness is built: the engine/kind/runtime/policy split, the life of one run, where the SDK cable is soldered, and a code walkthrough of both legs
- [docs/policies.md](docs/policies.md) — the five shipped policies (three current, two historical columns), the tokenomics framing, the v2 policy schema
- [docs/methodology.md](docs/methodology.md) — the two claims (provenance vs attribution), the three enforcement layers, the delegation content lint
- [docs/understanding-output.md](docs/understanding-output.md) — reading a run: manifest, evidence bundle, SDK receipts, lint verdict
- [docs/brief-template.md](docs/brief-template.md) — the section layout the SDLC kind expects in a brief
- [docs/swe-bench-pro.md](docs/swe-bench-pro.md) — the Scale evaluator setup, the pinned SHA, the disk budget
- [docs/antigravity-sdk.md](docs/antigravity-sdk.md) — what the Antigravity SDK does and does not do, including the defect that blocks a Claude worker and the prompt floor that shapes the cost model
- [examples/kudos-wall/](examples/kudos-wall/) — the SDLC reference workload
- [examples/uptime-ping/](examples/uptime-ping/) — a small SDLC smoke workload
- [examples/swe-bench-pro/](examples/swe-bench-pro/) — the SWE-bench Pro workload

Two more sit next to the code they describe, for when you are about to change
a file rather than run one:

- [tools/harness-matrix/README.md](tools/harness-matrix/README.md) — the
  runner's file-by-file map, what each test defends, and the honesty rules
  baked into the numbers
- [tools/harness-matrix/sdk-probe/README.md](tools/harness-matrix/sdk-probe/README.md)
  — how to re-run the Antigravity SDK probes that produce every claim in
  [docs/antigravity-sdk.md](docs/antigravity-sdk.md): which script answers
  which question, what each costs, and the setup each needs

## For Google engineers, customer engineers, and everyone downstream

This repository is meant to be forked and modified. Google engineers
can rework it for internal studies, then hand it to customer
engineers. Customer engineers can rework it for a specific customer's
brief, then hand it to the customer. The harness is deliberately
small — one CLI, one worker script, five policies, two workloads — so
each fork is a readable delta from the previous one.

If you make a change that would benefit the upstream, see
[CONTRIBUTING.md](CONTRIBUTING.md). If you find a security-relevant
issue, see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Fork, modify, and use as you wish.

---

<p align="center">
  <a href="https://tilicho.in">
    <img src="https://tilicho.in/favicon.ico" alt="Tilicho" width="48" />
  </a>
  <br />
  Built and maintained by <a href="https://tilicho.in">Tilicho</a>.
</p>
