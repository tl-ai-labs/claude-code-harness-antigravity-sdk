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
SWE-bench Pro corpus and official evaluator). Four policies cover the
model choices — Opus-only, Gemini 3.5 Flash on every stage, Gemini 2.5
Flash on every stage, and the tiered `gemini35-plus-25-flash-high`
that runs the premium worker on judgment stages and the cost-efficient
worker on volume stages. Which Gemini model is a policy field, not a
property of the harness.

Runs use your own Anthropic credentials and your own Google Cloud
project. Telemetry, generated code, and reports are written under the
repo; nothing is uploaded.

## The Gemini Enterprise tokenomics story

The harness is a working demonstration of what "Gemini as tokenomics
partner" looks like in practice. Keep your Claude Code or OpenAI
subscription for the parts of an SDLC pipeline that need the strongest
brain; route the volume work to Gemini through the Antigravity SDK.
The tiered policy (`gemini35-plus-25-flash-high`) is that story in a
single file: Opus 4.6 drives, Gemini 3.5 Flash handles judgment stages
(requirements, design, plan-packets, review, judge), and Gemini 2.5
Flash handles volume stages (execute + repair rounds). See
[docs/policies.md](docs/policies.md).

## Quickstart

```bash
git clone <this-repo>
cd claude-code-harness-antigravity-sdk
node tools/setup.mjs
```

The setup wizard has three modes and picks the smallest one that fits
what you want to do:

- **`--offline`** — Node + pnpm, run the 290 offline tests, exit.
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

## Running against your own brief

The harness is not coupled to the kudos-wall example. Copy the example
directory to `examples/<your-task-id>/`, replace `brief.md` with your
own free-text brief (the layout the `sdlc-mini` template expects is in
[docs/brief-template.md](docs/brief-template.md)), re-pin the
`brief_sha256` in `task.json`, and point `--task-dir` at the new
directory. The offline test suite picks up new workloads automatically.

Full workflow in [docs/running.md#bringing-your-own-sdlc-workload](docs/running.md#bringing-your-own-sdlc-workload).

## The four shipped policies

| Policy | What it uses | What it demonstrates |
|---|---|---|
| `all-opus` | Claude Opus 4.6 for every stage; no delegation | The **anchor** — baseline for cost and quality comparisons |
| `all-gemini-flash-high` | Opus driver, Gemini 3.5 Flash worker on every stage | The **delegated cell** — cheapest way to prove the cable works end-to-end |
| `all-gemini-25-flash-high` | Opus driver, Gemini 2.5 Flash worker on every stage | The **generation comparison** — diff against `all-gemini-flash-high` |
| `gemini35-plus-25-flash-high` | Opus driver, 3.5 Flash on judgment stages, 2.5 Flash on volume stages | The **tokenomics pass** — the Gemini Enterprise story in one policy |

Cost depends on workload size, model output length, and current vendor
pricing. Each run's manifest shows what it spent, derived from the
Antigravity SDK's own token receipts (worker) and the CLI's usage log
(driver). Live SDLC runs on `all-gemini-flash-high` × kudos-wall have
landed at $3–4 per pass historically; the tiered policy roughly
doubles that. See [docs/policies.md](docs/policies.md).

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

Each `worker-task-*.md` is the exact text the driver sent the worker.
Each `worker-usage-*.json` is the Antigravity SDK's own token receipt
for that delegation (model, SDK version, Vertex project/location,
token counts). These are the artifacts a customer engineer can hand a
customer as proof-of-mechanism without running the harness.

## Documentation

- [docs/setup.md](docs/setup.md) — the three setup profiles (offline, SDLC live, SWE-bench Pro) end-to-end, plus a troubleshooting table
- [docs/running.md](docs/running.md) — invocations, flags, exit codes, bringing your own workload
- [docs/policies.md](docs/policies.md) — the four shipped policies, the tokenomics framing, the v2 policy schema
- [docs/methodology.md](docs/methodology.md) — the two claims (provenance vs attribution), the three enforcement layers, the delegation content lint
- [docs/understanding-output.md](docs/understanding-output.md) — reading a run: manifest, evidence bundle, SDK receipts, lint verdict
- [docs/brief-template.md](docs/brief-template.md) — the section layout the SDLC kind expects in a brief
- [docs/swe-bench-pro.md](docs/swe-bench-pro.md) — the Scale evaluator setup, the pinned SHA, the disk budget
- [examples/kudos-wall/](examples/kudos-wall/) — the SDLC reference workload
- [examples/uptime-ping/](examples/uptime-ping/) — a small SDLC smoke workload
- [examples/swe-bench-pro/](examples/swe-bench-pro/) — the SWE-bench Pro workload

## For Google engineers, customer engineers, and everyone downstream

This repository is meant to be forked and modified. Google engineers
can rework it for internal studies, then hand it to customer
engineers. Customer engineers can rework it for a specific customer's
brief, then hand it to the customer. The harness is deliberately
small — one CLI, one worker script, four policies, two workloads — so
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
