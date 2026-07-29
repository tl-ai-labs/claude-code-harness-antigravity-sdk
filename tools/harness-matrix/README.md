# harness-matrix — runtime × policy comparison, on two task kinds

One scaffold runs one **kind** (what the work is) × one **runtime** (agentic
CLI) × one **policy** (model/thinking/retry/limit config) through a fixed,
script-owned recipe to a graded verdict. Two kinds exist (2026-07-25 split,
mirroring the console's run-executor segregation — engine dispatches, the
task specifics live in the kind adapter):

- **SWE-bench Pro** (`--instance-dir`, `kinds/swepro.mjs`): one frozen Scale
  instance through **REPRO → LOCALIZE → PATCH**, graded by Scale's official
  evaluator. Byte-identical to the pre-split scaffold (verified by dry-run
  diff at the split commit).
- **SDLC** (`--task-dir`, `kinds/sdlc.mjs`): the console's own
  `templates/sdlc-mini/template.yaml` — all eight stages — against a fresh
  `service-web` scaffold copy, graded by the scaffold's own build+test.
  Full recipe: **[SDLC-RECIPE.md](SDLC-RECIPE.md)**.

Because the script owns the loop (stage order, prompts, gates, retries,
cleanup) and the runtime only owns the inside of a phase (what to read, how
to test, how to edit), outcome differences between cells read as **harness
effect**, not procedural drift — and a cross-kind comparison reads as "same
runtime, greenfield SDLC work vs frozen bug fix".

> **STATUS — 2026-07-23 (CLI→SDK rework).** The `antigravity` **CLI** runtime
> (`agy -p`) has been **removed from the repo** (Teja parked the agy CLI
> 2026-07-21). Today the only wired runtime is **`claude-code`**, in two forms:
> **native** (Claude drives and does the work) and **delegated** (Claude drives,
> a **Gemini worker** does the substantive work through the **Antigravity SDK** —
> `gemini_worker.py`, `pip install google-antigravity` → Vertex — replacing the
> parked agy-CLI Skill worker). The Gemini worker now returns **real token
> counts** (SDK `UsageMetadata`), recorded in `worker_usage` sidecars and priced
> downstream — the old "$0 seat, no usage numbers" no longer applies to it. The
> two Antigravity-as-harness cells (box 1 `antigravity×Claude`, box 3
> `antigravity×Gemini`) are **temporarily gone**; they return as an **SDK-based
> Antigravity harness** once Google's Gemini-SDK corrections land. Box 1
> additionally waits on **D6** (the SDK returns Claude tool results as
> `assistant` messages → HTTP 400 on Opus/Sonnet), which the Gemini-side SDK swap
> does **not** fix. Sections below that describe a two-runtime matrix or an
> agy-CLI worker are **design intent / investigation history**; where they state
> current wiring, this banner and the per-section notes override them.
>
> **Update 2026-07-24.** The delegated cell is now **proven live**: a full
> navidrome run came back **resolved** from Scale's official evaluator (driver
> $1.91 modeled on the Max seat; worker ≈ $0.96 real Vertex spend at 82.5%
> cache-read). A second run the same day was **not** resolved — its patch phase
> hit the 600 s cap mid-verification. Both runs, all numbers, and the
> sidecar-accounting fix that preceded them are in the run log,
> [DESIGN §11](DESIGN.md).
>
> **Update 2026-07-26.** The cell ran on **two repos it had never seen**, which
> closes the "it is tuned to one Go repo" objection. `NodeBB/NodeBB` came back
> **resolved** — 273 tests passed, 0 failed, 2 of 2 required — at $3.5555
> (driver $1.7491 modeled + worker $1.8065 real). `ansible/ansible` was **not**
> resolved, and the reason matters: the harness was flawless (every phase
> cleared first attempt, no timeouts) and the *patch* was wrong. That is a
> reasoning failure, not the environment-latency failure mode of §10 — keep the
> two apart when reporting, because only one of them is ours to fix. Full
> numbers and the image-tag bug NodeBB exposed are in [DESIGN §12](DESIGN.md).
>
> **Update 2026-07-28.** A driver-integrity audit read every hand-off in all
> eight runs then on record and changed the delegation mandate — the driver's
> skill now bounds what a re-delegation may carry, and a content lint records
> what each one actually carried. One run of **each kind** was then recorded
> under the new mandate, so the change has runs on both sides of it:
> `internetarchive/openlibrary` came back **resolved** (4 tests passed, 0
> failed, 4 of 4 required) at $5.7395, and a fourth `kudos-wall` SDLC run
> delivered at judge **9.0** with 15/15 tests at $6.5192. Running tally:
> **6 graded Pro runs across 4 repos and 3 languages, 3 resolved**, plus
> **4 SDLC runs, 4 delivered** — ten delegated runs, 62 hand-offs, zero
> harness file edits. Full numbers, the one lint warning that fired and why it
> is being left alone, are in [DESIGN §13](DESIGN.md). Still n = 6 on
> hand-picked instances — **no resolve-rate claims yet.**

Full design rationale, threat model, and run plan: [DESIGN.md](DESIGN.md).

> **Presenting this to Ravi, Google, or anyone who is not opening the code?**
> Two self-contained implementation documents cover the delegated cell end to
> end — leadership-first, with the engineering depth in appendices, and every
> figure read from a run artifact:
> **[IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SWE-BENCH-PRO.md](IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SWE-BENCH-PRO.md)**
> (six graded runs, four repos, three languages, 3 resolved, $23.18 — plus the
> git-seal evidence and the identifier-mismatch finding) and
> **[IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SDLC.md](IMPLEMENTATION-CLAUDE-CODE-HARNESS-ANTIGRAVITY-SDK-SDLC.md)**
> (four runs, four deliveries, $25.36 — plus the tiering negative result).
> Both carry an honest-limits section that states the delegation ceiling in
> full: provenance is sealed at 100%, attribution is not, and the SDLC document
> says plainly where that bit.
> They answer Ravi's 5:45 asks 1 and 2; DESIGN.md remains the engineering
> record behind them.

**Taking the Antigravity SDK findings to Google or Ravi? Start at
[GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md](GOOGLE-ANTIGRAVITY-SDK-AS-A-HARNESS-CHALLENGES.md)**
— the eleven defects, what each one blocks, the three ranked asks, and the ten
questions. It is the standalone, shareable version of DESIGN §2.7–§2.7c. The
name says which half is at issue: the SDK in the **worker** role is proven and
carries every delegated run in this study; the SDK in the **harness** role,
driving a Claude model, is what is blocked. (Renamed from `SDK-CHALLENGES.md`
on 2026-07-29 — same document, clearer scope.)
Two companion docs sit beside it:
**[MANAGED-AGENTS.md](MANAGED-AGENTS.md)** — Google's Interactions API and
managed agents: what they are, a $0 probe showing the Antigravity managed agent
is reachable on our project with no install at all, a metered smoke showing it
*does* return usable token accounting but carries a **6,536-token fixed
overhead per interaction**, why it still cannot host this matrix, and the one
orchestrator phase where that overhead is worth paying (DESIGN §2.8).
**[GOOGLE-CALL-COVERAGE.md](GOOGLE-CALL-COVERAGE.md)** — every ask from the
2026-07-20 Google call mapped to covered / partial / open, so nothing raised on
that call goes missing.
The table below is the one-line map; **DESIGN §6 is the code walkthrough** —
every file, every load-bearing decision inside it, and the revisions the
first smoke run forced.

## Files

| File | What it is |
|---|---|
| `run-harness.mjs` | The ENGINE (thin since the 2026-07-25 kind split): args → resolve one kind + one runtime + one policy → hand over. No benchmark-specific code; the selected kind's module is dynamically imported, so an SDLC run never loads Pro's `packages/swe-bench/dist` dependency and vice versa. |
| `kinds/lib.mjs` | Kind-shared machinery — everything whose behavior must be IDENTICAL across kinds for cross-cell numbers to mean anything: policy load/validation (a thin wrapper over the **shared** engine `packages/policy/core/policy-core.mjs` since 2026-07-29, incl. the `default`-rule fallback and the legacy `phases.default` one), prompt rendering, run-in-env + execInEnv, change classification, diff-vs-anchor, **the stage attempt loop** (retry notes, pin verification, zero-delegation enforcement, attempt records), manifest totals. Moved from the pre-split run-harness.mjs, not rewritten. |
| `kinds/swepro.mjs` | The SWE-bench Pro kind: sealed-image build + extraction-integrity checks, nulled source hosts, the three phase gates with cross-phase contract state, test/repro diff stripping, Scale grading, opt-in image cleanup. Moved from the pre-split run-harness.mjs, not rewritten (dry-run byte-identical). |
| `kinds/sdlc.mjs` | The SDLC kind: loads the task's template.yaml LIVE and walks its stages — llm-task/judge stages as stateless runtime calls with contract-chained prompts, verify as a script gate (sha256 chassis integrity + build + test + ≤3 repair rounds fed the real failing log), report as the finish block. Slot gates are diff-vs-anchor based (commit-proof). See [SDLC-RECIPE.md](SDLC-RECIPE.md). |
| `runtimes.mjs` | Runtime adapter, currently **`claude-code` only** (the `antigravity` CLI adapter was removed 2026-07-23): argv construction, preflight, timeout, stream-json parsing. The delegated branch also renders the Gemini-worker Skill that shells out to `gemini_worker.py`, and **removes the driver's file-editing tools** (`--disallowedTools Edit Write NotebookEdit MultiEdit`) so the only path a repo change reaches disk is a worker call. |
| `gemini_worker.py` | The **Antigravity SDK** Gemini worker for the delegated cc×Gemini cell. Invoked once per delegated task by the Claude driver (via the provisioned Skill); does the real engineering on Gemini through `google-antigravity` → Vertex, and writes a `worker_usage` sidecar with **real token counts** (SDK `UsageMetadata`) + the resolved model. Replaces the parked agy-CLI worker. Cost is **not** computed here — token counts are recorded raw and priced downstream. |
| `audit.mjs` | Post-run intent audit of claude-code trajectories (git-history mining, source-host fetch, test-edit attempts). Those three families are Pro-specific and the SDLC kind skips them **on the record** (`skipped_check_families` in audit.json) — a greenfield brief has no gold fix to mine and tests are its deliverable. For a **delegated** cell it also adds a non-critical **`driver-direct-edit`** flag when the driver writes the working tree itself through Bash (in-place editors, or a redirect/`tee` landing inside the workdir) — defence-in-depth behind the hard zero-delegation gate. A delegated cell additionally gets **`delegation-policy-mismatch`**, which reads the `--model`/`--thinking` flags off each real `gemini_worker.py` command and compares them to the binding the policy pinned *for that phase*: a wrong **model** is **critical** (it voids the column — the run was not the cell it claims to be), a wrong **thinking level** is non-critical (a caveat on the record). `audit.json` reports `delegation_policy_checked` so a run that skipped the comparison is distinguishable from one that passed it. Finally, a delegated cell's driver→worker **hand-off text** is linted for dictated code, hand-over phrasing, proxied tree-mutating commands, and re-issuing a command the guard already refused as a tree write (critical) — those land in a **separate `integrity_warnings` array**, with `handoffs_scanned` and `delegation_content_checked` alongside; see enforcement item 7 below for why they are kept out of `flags` and never gate. |
| `fixtures/delegation-corpus/` | The evidence behind the hand-off lint's numbers: 50 real driver→worker hand-offs from the eight delegated runs that were on record when the labels were made, hand-labelled 2026-07-28 (44 clean, 6 solution-leaked), each stored with the exact warning families the lint produced when it was pinned. The corpus is **frozen at those 50** on purpose — delegated runs recorded since are deliberately not folded in, because a threshold measured against a label set that keeps growing can never be failed by it. The live `runs/` tree is larger; the two are not the same number and should never be reconciled. `delegation-corpus.test.mjs` replays the lint over all of them from the root test script, so "6/6 dictations, zero false positives, a one-line threshold margin" is a **test that can fail** rather than a comment. These are **copies** — the run directories under `runs/` are never modified — with one absolute host path replaced by `/harness`, a substitution verified not to move a single lint verdict before it was written. That one-off substitution is now the generalised `scrub-paths.mjs`, which uses the same `/harness` placeholder and applies the same verdict-equivalence gate to every file leaving the repo; a test asserts the rules are a **no-op** on these fifty, i.e. the corpus is already in its final published form. See the folder's own README. |
| `agy-trajectory.mjs` | **DORMANT** (not imported since the agy CLI runtime was removed 2026-07-23). Post-run decoder for the agy CLI's local SQLite store (`~/.gemini/antigravity-cli/conversations/<uuid>.db`, protobuf blobs). Kept on disk as the **only** reader of prior CLI-run evidence (e.g. the box-1 smoke DBs) and for any future CLI-vs-SDK comparison; re-wire only if the agy CLI returns. The SDK worker reports usage natively and does not need it. |
| `grade.mjs` | (Pro) Scale `swe_bench_pro_eval.py` wrapper: builds `sample.jsonl` + `patches.json` from the corpus files, runs local Docker with `--block_network`, writes `grade-verdict.json`. |
| `grade-sdlc.mjs` | (SDLC) Re-runs the scaffold's build+test in a fresh container invocation AFTER the last model call, writes the same-named `grade-verdict.json` (`resolved` = builds + full suite green). The judge stage's scores ride alongside in the manifest — mechanical floor vs qualitative ceiling. |
| `Dockerfile` | (Pro) Sealed execution image: base instance image + bash/coreutils + git-history erase + `sealed-base` tag (the diff anchor). No agent layer — runtimes live on the HOST. |
| `Dockerfile.sdlc` | (SDLC) The ONE shared toolchain image (node:22-bookworm + corepack-pinned pnpm 9.12.3) every SDLC run executes in. No per-instance seal — the scaffold enters as a host-side copy tagged `scaffold-base`. |
| `tasks/<id>/` | Self-contained SDLC task inputs: `task.json` (pins template id, scaffold id, and the brief by sha256) + `brief.md`. The corpus grows by adding directories, no code changes. Today: `kudos-wall`, `uptime-ping` — the latter deliberately reuses the brief the console leg already ran, so harness-vs-console is one brief through two machines rather than two unrelated runs. |
| `policies/*.yaml` | Policy = **leaf** model × adapter × API entries (each with its own id) + the **compositions** that combine them into a runtime-pinned cell + `rules[]` + retry + limits. **Since 2026-07-29 these share ONE schema and ONE loader with the console's `templates/policies/*.yaml`** — the engine is `packages/policy/core/policy-core.mjs`, imported by both `packages/policy/src/loader.ts` and `kinds/lib.mjs`, and both sides are `version: 2`. That closed the provenance hole this row used to describe: `worker: gemini-3.5-flash` was reached through the Antigravity SDK against Vertex and *no policy file said so*, so the frozen `policy_snapshot.yaml` in every recorded run did not record the cable the run used. See DESIGN §2.4a for the full rationale and `policies/all-opus.yaml` for the canonical in-file essay. **What a cell is:** `composition: solo` (`driver` only) or `composition: delegated` (`driver` + `worker`), each pinning exactly one `runtime` — asking for another runtime fails preflight before any spend, which is what a `null` binding used to mean. The delegated form is the cc×gemini cell (DESIGN §2.5): an Anthropic driver plus a Gemini worker invoked through the **Antigravity SDK** (`gemini_worker.py`) via a provisioned Skill. **Thinking:** `reasoning.effort` on the driver leaf (`--effort high`), `reasoning.tier` on the worker leaf. A worker leaf **must omit `reasoning:` entirely for `gemini-2.5-flash`**: Vertex hard-rejects `thinking_level` on that model (`code 400 · Unable to submit request because thinking_level is not supported by this model`), so the resolver omits `worker_thinking` from the binding and the header prints `worker thinking NONE`. Whether a stage is delegated is decided by `worker`, never by the presence of a thinking level. **`region` is required whenever `api: vertex`** — unpinned falls back to the shared `global` endpoint that starved this project on 2026-07-16. **`pricing` is exempt for composition members only** — a leaf a rule names directly must carry it; the harness prices runs from real receipts, never from the policy. **Legacy snapshots still load unchanged** (detected by a top-level `phases` key) and are never rewritten, so every evidence bundle already shipped keeps replaying. The two directories still hold different *files* for different purposes — a harness cell is not a console route — but a change to the schema now applies to both, and `--select <slot>=<model-id>` works here too (no harness file uses a slot yet: `gemini_worker.py` speaks only the Antigravity SDK, so an `mcp` option would validate and then fail at the first delegation). |
| `prompts/*.md` | The `{{PLACEHOLDER}}` phase prompts — `repro/localize/patch.md` for Pro, `sdlc-*.md` for the SDLC stages. Byte-identical across runtimes; context between stages travels via contract files (`repro.json`, `requirements.md`, `packets.json`, …) injected by the script, never via runtime conversation state. |
| `logfmt.mjs` | Terminal primitives and the **80-column grid**: boxes, rules, tables, `kvBlock`, the null-honest roll-ups (`attemptTotals`, `tokenSplit`), and `say()`/`sayErr()` — the harness's only writers. Both route through `fitLine`, which returns anything already inside the grid byte-identical and wraps anything past it with a hanging indent, so the grid holds without auditing 48 call sites by eye. |
| `logrender.mjs` | The run's two BIG frames — opening header, closing scoreboard — as **pure functions of a plain descriptor**. Both kinds build that descriptor from live state; `replay-log.mjs` builds the identical one from `manifest.json`. That is what makes an offline rehearsal byte-identical to the real run *by construction* rather than by copying an edit across. |
| `replay-log.mjs` | Re-renders a **finished** run's terminal log offline at **$0** — same frames, same narrator, the run's own trajectories and its own `[+m:ss]` timings. Read-only: no model, no network, no container, no writes. This is how demo copy gets reviewed without paying for a run; see [Replay a finished run](#replay-a-finished-run). |
| `export-dashboard.mjs` | Turns finished `runs/` evidence into a dashboard study — see [Dashboard export](#dashboard-export). |
| `bundle-run.mjs` | Builds `<run>/evidence-bundle/` — the self-contained, allowlisted copy of one run that a partner reads instead of trusting us: the graded artefact, every driver turn, every worker hand-off, `audit.json`, a `MANIFEST.sha256` over the lot, and per-kind `README.md` + `integrity-notes.md`. **Derived, and the one thing allowed to write inside a run directory**: it `rm`s and rebuilds the bundle from scratch on every invocation, and touches nothing else under `runs/`. The bundle re-runs the hand-off content lint over its own `delegation/` files (`delegation/lint.json`) and imports the attribution wording from `audit.mjs` so it and the dashboard cannot drift. `--all` rebuilds every run; a bare run dir rebuilds one. |
| `extract-repo.mjs` | Builds the standalone, public `claude-code-harness-antigravity-sdk` repository out of this monorepo — `node tools/harness-matrix/extract-repo.mjs --out <dir> [--force]`. It takes `tools/harness-matrix/` **whole** (both kinds, both kinds' tests, the frozen corpus and all ten runs' delegation evidence), plus the `packages/` files and three root dirs the harness actually reaches, preserving directory depths exactly so no import path has to be edited — the code Google runs is byte-identical to the code that produced the evidence Google is shown. `tools/swe/fetch-instances-pro.mjs` ships too, even though nothing in the harness imports it: the Pro kind takes `--instance-dir studies/swe-pro-corpus/<id>` and that directory is built by that script and by nothing else, so withholding it would publish the evidence of Pro runs while making their inputs unreproducible. It generates the destination's `README.md` as a **full operator manual** — every step from `git clone` to a graded run of *both* kinds, the env-var table (including the fact that `gemini_worker.py` defaults to *our* GCP project and must be overridden), the corpus/evaluator/venv setup the repo does not ship, and a symptom→cause→fix table — because the recipient has no access to this monorepo and cannot ask a question and get an answer the same hour. Every file goes through `scrub-paths.mjs` on the way out, and the run ends with `assertNoHostPaths` and a relative-import resolution check, so an extraction that would ship a host path or a dangling `../lib/x.mjs` fails at build time rather than at Google's `pnpm test`. The published repo is a **build output, never hand-edited**: the cycle is change here → re-extract `--force` → `git add -A` → commit → push, and `--force` deliberately preserves the destination's `.git` so that history survives. Deterministic by design (no timestamp, no source SHA), so an empty `git status` after a re-extraction *means* nothing publishable changed. |
| `scrub-paths.mjs` | The sanitiser that runs when evidence leaves the repo for a public one. The recorded runs carry this machine's absolute paths in four nested shapes (the harness dir, the repo root, `~/.gemini`, bare `$HOME`); `scrubText` rewrites them to `/harness`, `/repo` and `/home/user` **longest prefix first**, because a shorter rule firing first yields `/home/user/Desktop/<repo>/…` — no `/Users/` left, layout published anyway. `scrubTree` copies a run's files to a destination and never opens anything under `runs/` for writing; before emitting a hand-off it re-lints both forms through `lintDelegationText` and refuses to continue if the verdict moved, so the extracted repo can never report different findings than the dashboard. `assertNoHostPaths` walks the result and throws. Called by the extraction for the public benchmarks repo; nothing in a normal run touches it. |
| `*.test.mjs` | The offline test suite — **[Tests](#tests) lists every file and what it defends**. `guard.test.mjs` (delegation guard + worker clock), `audit.test.mjs` (the post-run intent audit), `delegation-corpus.test.mjs` (the hand-off content lint replayed over 50 real labelled hand-offs), `scrub-paths.test.mjs` (the publish-time path scrub, incl. the ordering trap and a replay over all 62 recorded hand-offs), `logfmt.test.mjs` (the run's printed numbers + the 80-column grid), `logrender.test.mjs` (the two big frames, plus a $0 replay of every run on disk), `kinds/lib.test.mjs` (the machinery both kinds share), `kinds/sdlc.test.mjs` + `kinds/swepro.test.mjs` (each kind's `--dry-run` contract), `grade.test.mjs` (both graders' short-circuits, refusals and summary parsing), `export-dashboard.test.mjs` (the exporter, end to end), `bundle-run.test.mjs` (the evidence bundler's identity resolution, per-kind allowlists and disclosure sections), `tasks.test.mjs` (walks the SDLC task corpus and re-checks every launch-time rule offline, so a bad `task.json` or an un-repinned brief fails in milliseconds instead of after the container is up and the first phase is billed). |

## Run one cell × one instance

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  node tools/harness-matrix/run-harness.mjs \
    --instance-dir studies/swe-pro-corpus/<instance_id> \
    --runtime claude-code \
    --policy tools/harness-matrix/policies/all-opus.yaml
```

`--runtime` currently accepts only `claude-code` (the `antigravity` CLI runtime
was removed 2026-07-23; passing it exits with a usage error listing the valid
runtimes).

Flags: `--dry-run` (render the REPRO prompt, execute nothing — free),
`--skip-grade` (defer the ~6-min Docker grade; run `grade.mjs` later),
`--cleanup-images` (drop this instance's images when the run ends).

`--cleanup-images` is **off by default and machine-specific** — a sealed
instance image is ~4.4 GB, so a 12-instance cell needs ~52 GB if nothing is
pruned. On a machine with disk to spare, leave it off: the same 12 base
images are reused by every cell and re-pulling costs real time. It is safe
for integrity — no evidence lives in an image (the diff anchor `sealed-base`
is a git tag inside the *extracted* workdir), and the base image's digest is
recorded in the manifest before deletion, so a re-pull is provably identical.
The base image is only dropped once a grade has run; under `--skip-grade` it
is kept for the deferred grade and only the sealed layer goes.

Exit codes: `0` run completed (resolved or not — read `grade-verdict.json`),
`1` infra error, `2` usage/preflight error.

**Live terminal narration.** The full stream-json trajectory goes to disk, but
the terminal is not silent while a phase runs: every stage announces itself
(`[build]`, `[extract]`, `[phase attempt]`, `[finish]`, grading), and inside a
phase the trajectory is narrated as it streams — one dim line per driver tool
call (paths folded to `workdir/…` and `out/…`), worker **delegations** called
out loudly with the worker's return announced, delegation-guard **denials**
labeled by which rule fired, and each attempt closing with a delegation
summary (worker calls, usage sidecars, real worker token totals — dollars
deliberately absent, tokens are priced downstream). Narration is print-only
(`makePhaseNarrator` in `runtimes.mjs`, unit-tested in `guard.test.mjs`); the
trajectory on disk stays the evidence of record.

Auth expectations (preflight verifies at $0): claude-code cells need
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` on the host for the driver.

**Which driver credential — use the Max subscription token, not the API key.**
Run `claude setup-token` once (in any terminal; it opens a browser to log into
your Claude Max account and prints a long-lived OAuth token), then export it as
`CLAUDE_CODE_OAUTH_TOKEN` **in the same shell that launches `run-harness.mjs`**
(env vars do not cross shells). Prefer this over `ANTHROPIC_API_KEY`: the
delegated cell's `cost_basis` claims the driver is a **Max seat — "modeled, not
wallet-real."** The API key would bill the driver's Opus tokens as real dollars
to the API wallet, contradicting that basis and mixing two billing regimes in
one run. On the Max token, the only real spend is the Vertex Gemini worker,
which we price honestly via `getVertexRates` (see the pricing note above).

A **delegated** claude-code cell (cc×gemini) additionally needs the SDK worker
runtime — a Python ≥3.10 venv with `google-antigravity` installed (default path
`sdk-probe/sdkprobe/bin/python`, override with `GEMINI_WORKER_PYTHON`) and
**ADC** for Vertex (`GOOGLE_APPLICATION_CREDENTIALS` or
`~/.config/gcloud/application_default_credentials.json`). Preflight imports
`google.antigravity` in that venv and checks for ADC, all at $0 — no agy seat is
involved any more.

## Outputs

Each run writes `runs/<instance_id>/<runtime>--<policy>/<stamp>/`:

- `model.diff` — the graded patch: `git diff sealed-base` with test and
  `*harness_repro*` hunks stripped (loudly — stripped paths are listed in the
  manifest and flagged by the audit).
- `raw.diff` — the unstripped diff, kept for audit.
- `predictions.jsonl` — SWE-bench predictions row for the aggregate report.
- `manifest.json` — the evidence: policy sha256, resolved models per attempt,
  gate verdicts, wall/cost totals, stripped files, and the audit rollup —
  `audit_flags` and `integrity_warnings`, **each `{total, critical, by_family}`**,
  plus `audit_coverage` (`auditable`, `handoffs_scanned`,
  `delegation_content_checked`, `delegation_policy_checked`,
  `skipped_check_families`). Until 2026-07-29 each of those was a bare integer,
  which threw away the one fact a reviewer needs — *was any of it critical* — at
  the exact moment the exporter summed it across a batch. Both kinds build the
  block from one shared helper (`manifestAuditBlock` in `audit.mjs`) so they
  cannot drift into reporting the same audit differently. Runs written before
  that date still carry the integer; the exporter reads it as
  **`critical: null` — unknown, never 0** — and recovers the real breakdown from
  `audit.json` when that file is still beside it.
- `audit.json` — intent-audit result: mechanical `flags`, plus the separate
  `integrity_warnings` from the delegated hand-off content lint, with
  `handoffs_scanned` / `delegation_content_checked` / `delegation_policy_checked`
  / `skipped_check_families` saying what actually ran.
- `manifest.json` → per-attempt `worker_usage` — for a **delegated** cell, the
  Gemini worker's own record parsed from its `worker-usage-*.json` sidecars:
  `{available, calls, sidecars}`, where each sidecar carries the resolved model,
  thinking level, **real token counts** (SDK `UsageMetadata`), tool-call count,
  and — since 2026-07-26 — **the cable itself**: `sdk` (`google-antigravity`),
  `sdk_version` (read from the installed distribution, so a rebuilt venv
  reports the newer number with no code edit), `vertex_project` and
  `vertex_location`. Before that, a run's artifacts proved *a Gemini model
  answered* but never named the SDK that reached it — which is the delegated
  cell's whole claim. `null` for a non-delegated cell; `available: false` with
  a stated reason when the cell is delegated but no sidecar was produced.
- `grade-verdict.json` — Scale evaluator verdict (`resolved: true/false`).
- `out/phases/` — per-attempt logs; claude-code emits `*.trajectory.jsonl` (the
  auditable stream-json record of the **driver**). A delegated cell additionally
  writes `worker-task-<slot>-N.md` (the task the driver handed the worker) and
  `worker-usage-<slot>-N.json` (the worker's token counts + reply) into the phase
  out dir, plus a `_gemini_worker_save/` scratch dir from the SDK. `<slot>` is the
  phase+attempt (e.g. `repro-a1`), so each phase-attempt's sidecars are read back
  in isolation — a fresh `claude -p` restarts its own `N` counter every phase, so
  without the slot a later phase's usage would overwrite, or be misattributed to,
  an earlier one.

`runs/` is gitignored — verdicts and manifests get consolidated into the
study report, not committed raw.

`.pkg-store/` is also gitignored (and docker-ignored). It is the pnpm/npm
package store the SDLC container writes to, deliberately mounted at
`/pkg-store` **outside** the graded `/app` tree: pnpm hardlinks packages out of
its store and cannot hardlink across a filesystem boundary, so when the store
sits on the container's overlay layer and `node_modules` sits on the macOS bind
mount, pnpm silently relocates the store *into the project* — which put 5,238
files inside a graded workdir and produced a 61 MB `git diff` on 2026-07-26.
Shared across runs, so packages are fetched once. Safe to delete at any time;
the next run repopulates it. Full account in [DESIGN.md](DESIGN.md) §(j.1).

Moving the store out fixed *where* packages land but left the other half of the
same filesystem split: `node_modules` was still on the macOS bind mount, so
pnpm had to **copy** across the boundary, and a name collision there produced
macOS-style ` 2` duplicate directories instead of overwriting — which shadowed
the real tree and made the platform-specific optional dependency vanish
(`Error: Cannot find module @rollup/rollup-linux-arm64-gnu`, ~4 minutes of paid
driver time burnt chasing a phantom npm bug). So each SDLC run now also gets a
**per-run Docker volume mounted at `/app/node_modules`**, created before the
container starts and torn down on every exit path. Consequence worth knowing:
`node_modules` is no longer visible on the host during or after a run.

## Dashboard export

`export-dashboard.mjs` consolidates finished `runs/` evidence into a study the
console renders. Run it **from the repo root**. One of `--run-dir` (repeatable)
or `--runs-root` is **required** — with neither, the script prints usage and
exits 1, because "export everything I can find" is never a safe default when a
batch is immutable once written:

```bash
# one finished run — the normal case
node tools/harness-matrix/export-dashboard.mjs \
  --run-dir tools/harness-matrix/runs/<task>/<cell>/<stamp>

# or sweep every run under a root (a dir holding manifest.json IS a run)
node tools/harness-matrix/export-dashboard.mjs --runs-root tools/harness-matrix/runs

# add --dry-run to see the resolved batch without writing, --rewrite-brief to
# regenerate brief.md
```

Each invocation exports one **batch** — a dated run column — into the study
directory for the run's kind, auto-detected from the manifest:
`harness-swe-bench-pro/` for Pro runs (`instance_id` + `phases`) and
`harness-sdlc/` for SDLC runs (`task_id` + `stages`). It registers the study in
`studies.json` and writes that column's `instances.json` (per-instance
verdicts, attempt ladders, phase costs, driver/worker split). Batches
accumulate: a second export adds a column, it never replaces the first.
`--rewrite-brief` additionally regenerates `brief.md`; without it an
edited brief survives re-export.

### The brief is generated from one shared template

For **benchmark** studies `brief.md` is not written here. It comes from
`tools/lib/benchmark-brief.mjs`, the single generator all four benchmark
paths call:

```js
benchmarkBrief({
  dataset: "verified" | "pro",   // which benchmark
  track:   "console"  | "harness", // which runner produced the run
  delegated,                      // harness only: driver + worker, or one seat
  driver, sdk,                    // harness only: the cable's identity
  title,
})
```

| Caller | Dataset | Track |
| --- | --- | --- |
| `tools/run-swe.mjs` | `verified` | `console` |
| `tools/run-swe-pro.mjs` | `pro` | `console` |
| `tools/harness-matrix/export-dashboard.mjs` | `pro` | `harness` |

All four walk the **same nine sections in the same order**, so a reader who
learns one brief can read any of them: one-line summary → what this study is →
what the dataset is → what one instance run does → how patches are authored →
how verdicts are graded → how cost is accounted → integrity → where the numbers
are. Only the dataset facts and the runner-specific mechanics differ.

Two consequences worth stating plainly, because both were bugs before:

- **The brief is LEVEL-1 copy — it describes the machinery, never the batch.**
  It carries no instance ids, no seed, no counts, no dates, no dollars. The Pro
  briefs used to list all twelve ids and the seed, which made a description
  into a run artifact that went stale the moment a second batch landed. The
  sample still lives where a re-verifier needs it: the run's own
  `instances/selection.json` and the console's Instances tab.
- **The harness brief is not hand-written.** It used to be ~110 lines of inline
  markdown in `export-dashboard.mjs` saying the same things in a second voice,
  so the two paths drifted. The **SDLC-task** brief is still written inline
  here on purpose — it is a different document about a different subject (a
  greenfield product spec, not a benchmark) and shares no outline with it.

### The delegated SDLC brief inherits from both parent cards

The `harness-sdlc` card sits between two existing cards, and its brief takes a
different thing from each — `delegatedSdlcBrief()` in `export-dashboard.mjs`:

| From | What it inherits |
| --- | --- |
| A **console SDLC card** (`uptime-ping`, `recipe-box`, …) | The brief **opens with the project spec**. `tasks/<id>/brief.md` is read and reproduced word for word, because "what was it asked to build" is the first question an SDLC reader has and the one the cost numbers are meaningless without. |
| The **cc×agSDK SWE-bench Pro card** | The track framing (a card is a fixed cell that accumulates columns), the delegation contract, two-wallet cost accounting, the integrity note, and the closing "where the numbers are" pointer. |
| Neither | **Slot discipline** (three writable paths inside a sha256-manifested chassis proven green first) and the **four-dimension judge**. They are what makes "a model built this" checkable, so they are sections, not footnotes. |

Three rules that follow from this:

- **The spec is input, not output.** Reproducing it cannot go stale — it is
  frozen and hashed into every manifest as `brief_sha256` — so it is the one
  run-adjacent thing a LEVEL-1 brief may quote. It is read from the task
  directory rather than retyped, so the two cannot drift.
- **Task specs are collected across ALL columns**, from each exported column's
  own `harness.sample_ids`, not just the batch being exported. A later batch on
  a second task must ADD its spec (`## The tasks`, one subsection each), never
  replace the first — otherwise re-exporting would delete a still-visible
  column's subject from the card.
- **The delegated brief does not hedge.** The single-seat variant still says
  "two shapes of cell — single-seat or delegated", because a single-seat column
  can be either. Every column that reaches the delegated variant is delegated,
  and the card's label, description and cable strip all say so.

On the dashboard side the delegated SDLC Brief tab suppresses the same three
product sections the benchmark leg does (architecture diagram, runtime/stack
chips, screenshot gallery) — the decision is `briefShowsProductSections()` in
`apps/dashboard/src/lib/metrics.ts`, which documents the specific false claim
each section was making — while keeping the SDLC section copy.

### The cable strip pools every column

`CableStrip` used to render `study.runs[0]`'s cable, on the reasoning that a
study is one integration under test so its columns share a cable. The identity
half of that is true (driver runtime, SDK, transport, region) and the model half
is not: this card's second column exists **precisely** to bind a different
worker, so the strip showed one chip and denied the tiered binding on the tab a
reviewer reads first.

`mergedStudyCable()` now unions both sides across every cabled column and
returns a `driverVaries` / `workerVaries` flag per side. The strip renders the
union plus a **varies by column** marker when the columns genuinely disagree —
a union with no such marker is a quieter way of claiming every column used every
chip. "Varies" means the columns listed *different sets*, not merely that the
union has more than one entry: a single column binding two workers on different
stages is one column's honest answer, not a variation between columns. The
driver side merges too, even though it is fixed today — an assumption that held
until it didn't is what produced this bug.

Both brief generators describe the strip this way; `benchmark-brief.test.mjs`
pins that copy, because prose about a widget drifts silently.

### `policy_snapshot.yaml` is resolved against the harness, not the repo root

The two runners record `policy.file` against **different bases**: the Pro runner
writes it repo-root-relative (`tools/harness-matrix/policies/x.yaml`), the SDLC
runner writes it harness-relative (`policies/x.yaml`). The exporter used to
`join(ROOT, …)` it unconditionally, so Pro always resolved and SDLC never did —
and the miss fell back to a two-line `# policy file not found at export time`
stub, so every delegated SDLC column shipped an empty policy exhibit on the
Implementation Approach tab while the export log printed the path as if it had
been copied. `resolveHarnessPath()` now tries the harness directory first, then
the repo root, then honours an absolute path, which accepts both bases; the
runners are left alone so old manifests keep resolving. A miss still writes the
stub (a missing policy does not invalidate a column's telemetry) but now prints
a `WARNING` line and shows `STUB` in the plan, including under `--dry-run`.

Three rules the console depends on, enforced here and in the views:

- **Levels.** Study card, brief and Implementation Approach describe the
  MACHINERY — no model names, no dollars, no dates. Every populated number
  lives on Runs Result, Instances, or Engineering View. A batch landing must
  never silently change what the "approach" page claims.
- **An instance is an instance; every run of it is an independent attempt.**
  There is no relationship between two runs of the same instance. The instance
  id is a **join key** — it lets the Instances table line attempts up in one
  row group — and nothing more. So
  `benchmarkAccumulated` is a **plain sum over every graded column**: no column
  is folded into another, none is dropped in favour of a better one, and no
  branch anywhere asks how many columns or policies happen to exist. One
  instance attempted twice and solved once reads `1/2`, and its full spend
  stays in the cost. The deliberate consequence: N policies over one frozen
  12-instance sample reads `/36`, which is an **attempt-level** resolve rate,
  not the per-instance rate a public leaderboard quotes — say which one you
  mean when you publish. Views follow the same rule: no section heading or
  caption may branch on the shape of the data, or bake a run label, policy
  name, dollar figure or date into itself.
- **Benchmark studies have NO Compare Runs tab** (2026-07-26). The tab answers
  "same work, two ways", which is what an SDLC study's runs are — every policy
  against one identical brief. A benchmark study is not that: it accumulates
  batches over frozen instance samples, so two columns compare only when they
  cover the SAME sample under DIFFERENT policies, and every state short of
  that (one policy, two samples, a repeatability rerun) needed its own
  explanatory surface whose only content was why there was nothing to show.
  `metrics.hasCompareTab` is the switch; `metrics.resolveStudyTab` sends a
  stale `/studies/<id>/compare` URL to the brief. Head-to-head evidence for a
  benchmark lives on **Runs Result** (per column) and **Instances** (per
  instance, with the attempt ladder), which is where it was always strongest.
- **The comparison table's "Runtime" row is derived, never assumed.** It reads
  `manifest.harness.runtime` — written by the exporter from the run's own
  manifest — and prints the agent CLI (with its version, and only then the
  Claude mark) when that field is present. A **console** study has no such
  field, because the console orchestrator walks the template's stages itself
  and no agent CLI is involved anywhere in it; those columns read *Console
  orchestrator*. That absence is the honest harness-vs-console test, so the
  row must never be hardcoded: it once was, and printed "Claude Code" over
  four console SDLC columns — asserting the exact opposite of the finding this
  whole study exists to show, with nothing on screen looking wrong. Pinned by
  `export-dashboard.test.mjs` ("the exported manifest names the agent runtime
  that drove the run"), which guards the upstream half of the contract; the
  dashboard workspace has no test runner of its own (see DESIGN §8).

Delegated columns split spend across two wallets in the manifest
(`harness.driver_cost_usd` / `worker_cost_usd`) — the driver CLI-modeled on a
Max seat, the worker priced from the SDK's own token counts at Vertex
`asia-south1` rates. The console never re-adds them into one unattributed
figure.

## Terminal log (the live face of a run)

The console output of a live run is itself a demo artifact, shaped by three
modules so SWE-bench Pro and SDLC runs read identically:

| file | what it owns |
| --- | --- |
| `logfmt.mjs` | Primitives + the **80-column grid**. `say()`/`sayErr()` are the harness's only writers; both route through `fitLine`, which wraps an over-long line with a hanging indent past its actor gutter and returns anything already inside the grid **byte-identical**. Boxes, rules, tables and `kvBlock` therefore pass through untouched, and the grid is a property of the program rather than of whoever last edited a template literal. |
| `logrender.mjs` | The two BIG frames — opening header, closing scoreboard — as **pure functions of a plain descriptor**. Live kinds build that descriptor from in-memory policy/template/records; `replay-log.mjs` builds the identical descriptor from `manifest.json`. Byte-identity between a live run and a replay is by construction, not by copying an edit across. |
| `replay-log.mjs` | Re-renders a **finished** run's log offline at **$0** (see [Replay a finished run](#replay-a-finished-run)). |

- **Run header** (heavy box + key/value block): task identity, cell, recipe
  with retry caps, per-phase/stage bindings + thinking levels, cost regime,
  and — for a delegated cell — the guard note (driver has no edit tools;
  PreToolUse locks the repo until the first worker call).
- **Phase/stage banners** with each gate's plain-English contract, live
  trajectory narration (`[+m:ss]`-clocked), every `DELEGATION #N` hand-off
  with wall time and the worker's own sidecar receipt — `via google-antigravity
  <version> -> Vertex <region>`, then model @ thinking level and the real token
  split, so the cable is named on screen and not only in a file — guard
  denials, gate PASS/FAIL verdicts with wall/cost,
  repair-round narration (SDLC), and per-stage roll-up totals.
- **Closing scoreboard**: a verdict box, a per-stage ledger table (attempts,
  gate, wall, driver $, delegations, worker tokens), and the honest totals
  block — driver cost explicitly labeled *CLI-modeled (Max seat), not
  wallet-real*, worker tokens *priced downstream vs Vertex rates*.

Strictly presentation-only: every number is printed *from* the same in-memory
records that land in `manifest.json`/`audit.json` — nothing downstream parses
the log back (file-output rule). ANSI color auto-disables when stdout is not
a TTY or `NO_COLOR` is set, and colors wrap whole phrases only, so captured
logs stay grep-able. Prompt bytes are untouched by the logging layer —
`--dry-run` output is byte-identical before/after (verified against captured
baselines).

## Replay a finished run

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  node tools/harness-matrix/replay-log.mjs --run-dir runs/<task>/<cell>/<stamp>
```

`--stage <id>` narrates one stage; `--frames` prints only the header and the
scoreboard; no arguments prints an index of the runs on disk.

**Why this exists.** The log is screenshared, paused on, and quoted — which
makes its wording and spacing a deliverable. Before this tool the only way to
*look* at that deliverable was to pay for a live run, watch it scroll past
once, and hope the phrasing landed. Replay is read-only: it opens a run
directory and prints. No model, no network, no container, no writes.

**Fidelity, stated plainly** (a rehearsal that quietly differs from the real
thing is worse than none):

| tier | what |
| --- | --- |
| real, byte-for-byte | Header and scoreboard are the same `logrender.mjs` functions the live run calls. Per-stage narration is the same `makePhaseNarrator` the live run taps, fed the run's own `out/phases/*.trajectory.jsonl` — so every tool call, every `DELEGATION #N` box, every BLOCKED line and every worker receipt is the run's own. |
| real, from the run | `[+m:ss]` stamps and each hand-off's duration come from the trajectory events' own timestamps (the narrator's clock is injectable for exactly this), so the rehearsed log carries the run's real pacing rather than collapsing to `[+0:00]`. |
| reconstructed | Stage banners, the model-pin line, the worker ledger and the gate verdict, all from `manifest.json` — which is where those numbers came from live. |
| not replayed | Docker build/provisioning output and gate command logs. That is the environment talking, not the run's evidence about who did the work; it lives in `out/*.log`. |
| never invented | A value the manifest cannot supply prints as `(unrecoverable — not in manifest.json)`. |

### Preview a run you have *not* paid for

Replay needs a finished run. A column you are about to add does not have one —
and that is exactly when the wording matters most, because the first paid run
is also the first time anyone sees it. `--dry-run` covers that gap:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  node tools/harness-matrix/run-harness.mjs --kind sdlc \
    --task-dir tasks/uptime-ping --runtime claude-code \
    --policy policies/all-gemini-25-flash-high.yaml --dry-run
```

An SDLC dry run prints the **real opening frame** — the same
`logrender.sdlcHeader` output the paid run prints, built from the same hoisted
descriptor — followed by the rendered first-stage prompt. Nothing else runs:
it exits before preflight, before Docker, before any token moves.

Only two rows can differ from a real run, because only two are unknowable in
advance: `runtime` (probed at launch; degrades to a labelled placeholder if
the driver CLI is absent) and `started`, which prints
`— not started (--dry-run: nothing executed)` rather than a plausible ISO
timestamp — a preview that stamps a real-looking time is indistinguishable
from a captured run in a screenshot.

This replaced an ad-hoc `task : / template : / policy :` summary that only the
dry run ever printed. That summary was a second implementation of the header,
free to drift from the real one and structurally unlikely to be caught (nobody
diffs a preview against a run they have not done yet). `kinds/sdlc.test.mjs`
now pins all three producers together: the dry run's frame must equal, byte for
byte, the frame `replay-log.mjs` rebuilds from a finished run's
`manifest.json`, minus those two provenance rows.

It also measures. Replaying the first delegated SDLC run on 2026-07-26 found
**87 of 352 lines past 80 columns** (worst: 176) — a terminal wraps at the
window edge with *zero* indent, so each of those returned to column 0 and
merged with the next line exactly where a viewer looks hardest. Source review
had passed those same lines repeatedly; only rendering and measuring caught
them. `logrender.test.mjs` now replays **every run on disk** and asserts the
grid on the output, so the check cannot decay.

## Tests

Every test in this directory is **$0 and offline** — no model, no Docker, no
network — so the whole suite is safe to run on any change, at any time:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:tools
```

`pnpm test` now runs the workspace packages **and** this suite. Before
2026-07-25 these files were reachable only by hand (`tools/` is not a pnpm
workspace, so `pnpm -r test` walked straight past them) — a test nobody runs is
a test that rots, so the root script was wired to include them.

| File | Covers | Why it exists |
|---|---|---|
| `guard.test.mjs` | `bashInspectsRepo` / `searchTargetsRepo` classifiers, the generated PreToolUse hook driven end-to-end (JSON on stdin → decision on stdout), the phase narrator (including that the `via <sdk> <version> -> Vertex <region>` clause renders when the worker recorded it and **vanishes entirely** when it did not), the rendered worker Skill (pinned to a golden sha256), and the worker-clock nesting invariant | The guard is the delegated cell's structural line of defence. If it silently stops denying, the study quietly becomes "one model did everything" while still reporting delegation. The narrator's provenance clause has the mirror-image risk: sidecars written before 2026-07-26 have no `sdk` key, and a line reading `via undefined` would be *inventing* provenance on the one line whose entire job is provenance. |
| `audit.test.mjs` | The post-run intent audit: the `stripHeredocs` pre-pass every command scanner shares, `bashEditsTree`, and both trajectory-level entry points. Plus the attribution layer built on top of it — `lintRecordedHandoffs` (which files it reads and which it must not, that it never writes to the run directory, and that it can never claim the critical family is clear), `resolvedIntegrity`'s one-directional precedence, `attributionSplit`'s three prefixes and its provenance sentence, and `delegationIntegrityNotes` staying silent for a run that had no hand-offs | The audit is what lets a published number claim "no exploit was attempted", so BOTH error directions are expensive. A missed flag publishes a resolved instance whose trajectory mined git history for the fix; a false flag voids a legitimate result, because a critical family deletes the instance from the study. The attribution layer is where the same stakes apply to *credit* rather than to the verdict: an after-the-fact re-read that quietly overrode what a run itself measured, or that let a structural `0` read as "no evasion", would be a worse claim than the `UNKNOWN` it replaced. |
| `delegation-corpus.test.mjs` | The hand-off content lint replayed over `fixtures/delegation-corpus/` — all 50 real hand-offs, their human labels, and the exact families each produced when the lint was pinned. Also re-derives the 8-vs-9 threshold margin from those files, pins the one hand-off the tree exclusion keeps clean, and asserts no committed copy carries a host path | Every number the study quotes about dictation — 6/6 caught, zero false positives, a one-line margin — came from a scratch script over one laptop's run directories. Committed, they are testable; uncommitted, a rule change that widens or narrows the lint shows up as nothing at all, and the honest-sounding sentence in the brief quietly stops being true. This is also the only test in the suite whose fixtures are *evidence* rather than constructions, which is the point: no fixture written by the author of a rule can falsify that rule. |
| `extract-repo.test.mjs` | The publish extraction: that every declared `PACKAGE_FILES`/`PACKAGE_DIRS` input still exists, that `harnessFiles` lists the harness through git (sorted, relative, and with the 880 MB of `runs/*/workdir` checkouts still ignored), that a real extraction into a temp dir produces a buildable tree without `packages/adapters` but *with* the corpus fetcher, that the withheld memos ship as stubs carrying none of their real content, that the generated README still documents all fifteen steps a recipient cannot recover from by inspection (driver auth, SDK install, ADC, the project-id override, both kinds' run commands, corpus fetch, evaluator pin, grading venv, the enforcement mechanism, the stated attribution leak), that `--force` replaces stale files but preserves `.git`, and that `--out` pointing at the source repo is refused | Three of the four things this script must get right are invisible to a reader eyeballing the output tree. A rename here (`packages/pricing/src/index.ts` moving) would ship a repo whose `pnpm build` fails, and the first person to find out would be Google. A `--force` that removed `.git` would orphan the published history on the first sync. A loosened un-ignore ladder would publish a copy of every benchmark repo ever cloned. The host-path and dangling-import guarantees need no assertion of their own — `extract()` throws on either, so reaching its return value *is* the test |
| `scrub-paths.test.mjs` | The publish-time path scrub: each of the four host-path shapes mapping to its placeholder, suffixes surviving, idempotence, and the two guarantees — that `scrubTree` leaves the source bytes untouched and refuses to emit a hand-off whose lint families moved. Then the same rules replayed over **all 62 tracked hand-offs** under `runs/`: verdicts unchanged, no host path surviving, and the frozen corpus already clean (a no-op) | Two failure modes, both silent. The first is ordering: apply the `$HOME` rule before the harness rule and the output is `/home/user/Desktop/<repo>/tools/harness-matrix` — no `/Users/` left, so a `/Users/` check passes and the directory layout ships anyway. That case gets its own test, plus a structural one asserting each literal rule strictly extends the next, so a fifth shape cannot be added in the wrong slot and still pass. The second is verdict drift: a substitution that changes what the lint sees would make the published repo report different delegation findings than the dashboard does, from files that look byte-plausible. The real-evidence tests deliberately do **not** skip when `runs/` is absent — the delegation bundles are committed, and a self-skipping test reports green while proving nothing. |
| `logfmt.test.mjs` | `attemptTotals` roll-ups, the null contract, `tokenSplit`, the table/box layout invariants, and the 80-column grid (`fitLine` byte-identity below the limit, hanging-indent wrapping above it, whole-phrase colour surviving the wrap, `rule()`/`heavyBox` clamping instead of overflowing) | `attemptTotals` is **null-honest** by design: an attempt that reported no cost must surface as `n/a`, never `$0.0000`, because a fake zero reads as "this cell was free". Typechecking cannot see that distinction; a test can. |
| `logrender.test.mjs` | The four frame builders rendering from a plain descriptor alone; the delegated-cell facts a partner team reads off the screen; a non-delegated cell omitting the delegation apparatus entirely; and **`replay-log.mjs` replaying every run in `runs/`**, asserting the grid on the real output and that the injected clock yields the run's real elapsed stamps | The frames used to be inline in each kind runner, so reviewing demo copy meant paying for a run — and any offline rehearsal re-implemented them and drifted. These tests defend the extraction: the frames need no live state, and a rehearsal cannot quietly disagree with the run it claims to reproduce. The grid is asserted on rendered output because source review had already missed 87 over-long lines. |
| `kinds/sdlc.test.mjs` | `--dry-run` as a **subprocess**: it opens with the real boxed header (not the ad-hoc summary it used to print), never stamps a plausible ISO start time, reports the *policy's own* models and is otherwise identical across a policy swap, fits the 80-column grid, and matches — byte for byte, minus the two provenance rows — the frame `replay-log.mjs` rebuilds from a finished run's `manifest.json` | `--dry-run` is the only way to read a column's opening frame *before paying for the column*, which is worth nothing if the preview shows a frame the paid run never emits. The old dry-run summary was exactly that: a second implementation, free to drift, and structurally unlikely to be noticed. Pinning preview against replay means live, preview and replay all have to agree. |
| `kinds/swepro.test.mjs` | `--dry-run` as a **subprocess** for the Pro kind: it says plainly that it executed nothing, names all three phases (`repro`/`localize`/`patch`) with their `driver → worker` binding and the SDK that carries it, reports the *policy's own* models and is otherwise identical across a policy swap, never stamps a plausible ISO time, and fits the 80-column grid. Skips (rather than fails) when the machine-local corpus is absent | Added 2026-07-27. The SDLC kind had a dry-run contract test; the kind that runs the benchmark we publish **externally** had none — so the path with the higher blast radius was the one nobody previewed offline. Assertions are limited to contracts that hold either way, so this file stays honest about the header gap it deliberately does not pin. |
| `kinds/lib.test.mjs` | The kind-agnostic library both kinds share: what a run is allowed to have touched, what its patch contains, what it cost, and how a delegated cell is described. Git-backed helpers run against real throwaway repositories, not a stubbed `git` | A bug in `lib.mjs` is a bug in EVERY cell of the matrix at once, and the four things it decides are exactly the four a reader of the exhibit takes on trust. Stubbing git would only prove the stub — the behaviour under test *is* git's (porcelain field packing, rename records, `add -N`). |
| `grade.test.mjs` | Both graders. For Pro (`grade.mjs`): the empty-patch short-circuit that skips a 6-7 minute Docker round-trip, and the refusals to grade without `model.diff` or `sealed.json`. For SDLC (`grade-sdlc.mjs`): the no-delivery short-circuits, the named-missing-file refusals, and `parseVitestCounts` — including the **order-agnostic segment parsing** added 2026-07-27 | The Docker leg of both graders cannot honestly be unit-tested, so what IS covered is everything deciding whether the grader runs at all — a run with no `grade-verdict.json` is a run the exporter reports as ungraded. `parseVitestCounts` earned its own cases after a positional regex silently dropped a failure count to zero on `2 failed \| 1 skipped \| 10 passed`, publishing a **false green**. |
| `tasks.test.mjs` | Walks the SDLC task corpus and re-checks every launch-time rule offline — `task.json` shape and the brief each task pins by hash. The corpus is walked, not enumerated | Every check here is one `kinds/sdlc.mjs#run` already makes at launch: the right place for a run to *fail*, the wrong place to *find out*. Offline, a corpus mistake surfaces in milliseconds instead of after Docker is up, the scaffold is provisioned, and the first model call is billed. Walking means a task added later is covered the moment its directory exists. |
| `export-dashboard.test.mjs` | The exporter as a **subprocess**, against synthetic run dirs: the argument guards, `--dry-run` writing literally nothing, `--out` isolation, the full artifact set, the two-wallet cost split, `instances.json`, batching and idempotence, and the year in every run label | The exporter's default output is the dashboard's checked-in `public/data`. These tests prove `--out` and `--dry-run` are absolute — otherwise running them would rewrite the repository. It is driven as a subprocess because the script parses `process.argv` and calls `process.exit` at module scope, so importing it would run it. |
| `bundle-run.test.mjs` | The evidence bundler: identity resolution for BOTH manifest shapes (SWE `instance_id`, SDLC `task_id`, and the legacy runs that predate the `kind` field), the `isSwe` gate that keeps the Scale re-verify recipe out of an SDLC bundle, the delegation files being in the COMMON allowlist for every kind, and the delegation-integrity section landing in both kinds’ `integrity-notes.md` **above** their caveats — with an empty section producing a byte-identical document | The bundle is what a partner reads instead of trusting us, and its failures are silent by construction: the bundler shipped SWE-only and died on the first SDLC run while the six SWE bundles it had already written looked like success. The same shape applies to the disclosure — a section that exists but never reaches the SWE document is the same defect as no section at all, which is exactly why the SWE notes were extracted from an inline array into `sweIntegrityNotes()`. |
| `tools/lib/benchmark-brief.test.mjs` | Every dataset × track combination walks one identical section outline; the H1 identity rules; the guard-rail throws; and the "no dollars / dates / seeds / counts" construction claim | The generator's own source claims a track "can never add, drop or reorder a section" — that is what makes the console brief and the harness brief the *same* document. It decays silently, because an extra section still renders fine. |

**Thumb rule for this repo: a change ships with its tests.** The suite is free
and offline, so there is no cost argument against it; anything that produces a
number a human reads, or enforces a rule a run depends on, gets covered in the
same commit that changes it.

## Honesty rules baked in (do not "fix" these)

- **Cost**: claude-code×Max costs are CLI-modeled, not wallet-real —
  `cost_usd: null` means *not measurable*, never *zero compute*. The manifest's
  `cost_basis` field says which regime applies. In a **delegated** cell the
  recorded `cost_usd` covers the **driver only**; the Gemini **worker** now
  reports real token counts via the SDK's `UsageMetadata`, recorded raw in the
  `worker_usage` sidecars and **priced downstream** against verified Vertex
  rates — via `@study-console/pricing` `getVertexRates(model, "asia-south1")`,
  which adds the **+10% non-global Vertex surcharge** (effective 2026-07-01)
  over the global-endpoint pin, since the worker runs in `asia-south1`
  (verified 2026-07-23; pricing-preflight discipline). **The surcharge is
  Gemini-3-and-later only** — re-verified 2026-07-26 against the Vertex
  pricing page, whose note scopes it to "Gemini 3 and later families of
  models". So `gemini-3.5-flash` bills 1.65/9.90/0.165 in `asia-south1`, while
  `gemini-2.5-flash` bills its flat 0.30/2.50/0.03 there — the tiered column's
  two workers are on **different surcharge regimes**, and applying one
  multiplier to both overstated the cheap tier by 10%. Never converted to
  dollars in the worker or summed into the driver total, because a partial
  dollar figure presented as a cell total would be worse than an honest split.
- **A Pro row reading `0 passed / 0 failed` is a MODEL failure, not a broken
  grader** (forensics 2026-07-27). It is tempting to read "no tests ran" as the
  evaluation environment having failed, and to discount the instance. That
  reading is wrong, and it was asserted here once before being checked. Every
  such row was traced through its own `harness_stdout.log`: the model's patch
  does not compile against the held-back golden tests, Scale's evaluator prints
  `[build failed]`, and the results file is therefore literally `{"tests": []}`.
  A patch that will not build **is** a failed attempt — the grader did its job
  and reported the only honest answer available. So the verdict stands as
  written and **the denominator does not change**: these instances stay counted,
  unresolved. All six such rows across eight published columns were confirmed
  this way individually, not inferred from one. The general rule: before
  attributing a zero to infrastructure, read the log that produced it.
- **No gateway, and why** (DESIGN §2.5): routing both runtimes through a
  telemetry proxy (LiteLLM or similar) to capture tokens uniformly was
  considered and rejected on evidence. The `agy` **CLI** has no base-URL
  override — not a flag, not a config env var, endpoints compiled in — so
  the only route is a
  MITM proxy with our own CA against an authenticated Google enterprise seat,
  which is not acceptable inside a partnership study. It would also not have
  worked: agy serves Claude through `API_PROVIDER_ANTHROPIC_VERTEX`
  **server-side**, so a proxy on this host sees a Google RPC envelope, never
  the Anthropic request. The local store gives strictly more, with no ToS
  exposure. A *translating* gateway (pointing Claude Code at Gemini via
  `ANTHROPIC_BASE_URL`) is separately rejected: our translation layer would
  become what the study measures, and it deletes Antigravity from the cell
  Google asked to see.
  **Do not repeat this to Google as "we rejected the router proxy."** What we
  rejected is a MITM telemetry proxy as a *measurement technique*. Google's
  Sanjit Mehta separately proposed a customer's own **model router proxy** as a
  normal integration pattern for reaching Gemini from a non-Google harness —
  no CA, no interception, nothing we have objected to. Same word, unrelated
  things; the distinction is written out in
  [GOOGLE-CALL-COVERAGE.md](GOOGLE-CALL-COVERAGE.md).
- **The Antigravity SDK is now wired — for the Gemini worker only**
  (DESIGN §2.7). On 2026-07-20 Google asked us to move off the CLI to
  `pip install google-antigravity` on enterprise-InfoSec grounds (a CLI needs
  IT whitelisting; a pip package rides existing artifact pipelines), and Teja
  parked the agy CLI 2026-07-21. The T-SDK-1 probe (2026-07-21) **confirmed**
  the SDK's Gemini path closes the gaps that made the CLI a blind cell: real
  token counts including `thoughts_token_count` and
  `cached_content_token_count`; a `ThinkingLevel` knob that measurably changes
  thinking spend; Vertex on our own paid project via ADC (no seat quota);
  headless `run_command` under `policies=[policy.allow_all()]`; and structured
  `ToolCall` objects instead of protobuf blobs. So the delegated cell's **worker
  now runs on the SDK** (`gemini_worker.py`) — a faithful port of the verified
  probe — and the box-3 `antigravity×Gemini` **harness** will reuse the same
  cable when that runtime is re-added.
  The SDK still **cannot serve Claude** (D6). Run live against Anthropic (§2.7c)
  on the key in `.env`, a single turn completes, then the agent loop dies on
  turn 2 because Antigravity feeds tool results back as `assistant` messages
  rather than `role: "tool"` — consecutive assistant turns Anthropic rejects
  (400 on Opus 4.6 and Sonnet 4.6; Haiku 4.5 accepts, useless at our Opus pin).
  That is exactly why the delegated **driver** stays on Claude Code's own seat
  (never routed through the SDK) and why box 1 `antigravity×Claude` cannot be
  revived by this swap — it waits on Google's SDK corrections. SDK-Gemini calls
  are **metered, not free** (Vertex on our paid project), so `cost_basis` for
  the worker is token-counts-priced-downstream, not "$0".
- **The agy seat is parked, not in the loop** (historical — DESIGN §2.6). The
  removed agy CLI ran on a free-but-rationed enterprise seat (hard per-user
  quota, ~164-hour reset, no usage/quota subcommand). No current cell depends on
  it — the Gemini worker moved to Vertex via ADC. This note is kept only so a
  future agy-CLI comparison run remembers that quota errors must **abort**, not
  retry: they cannot succeed on a second try and they inflate the attempt count
  with attempts no model ever saw.
- **Thinking parity**: claude-code is pinned `--effort high`; agy exposes no
  Claude thinking knob (recorded as `product-internal` — open question with
  Google). Model pinned to Opus 4.6 on both sides because that is agy's
  ceiling; do not bump claude-code to a newer Opus without breaking parity.
- **Red baselines**: a baseline that already fails waives the no-worse gate
  with a recorded warning — exit codes cannot count per-test failures across
  four languages, and pretending otherwise would be false precision.
- **Sealed fields**: gold patch / test_patch / fail_to_pass never reach the
  runtime (enforced via `validateInstance`); they are used only by `grade.mjs`,
  which runs in Scale's original image with networking blocked.
- **The delegated cell is two-model, and delegation is now ENFORCED, not just
  requested** (2026-07-23 smoke lesson). Claude Code's driver seat is welded to
  Anthropic, so cc×gemini can only be "Opus driver → Flash worker via
  Antigravity" (Google email ask 3b's own shape). But a first smoke showed the
  Opus driver simply doing the engineering itself — **0 worker delegations** —
  because it still had Edit/Write and its cwd *is* the workdir, so the Skill's
  "delegate everything" mandate was toothless. The fix has four coordinated
  parts, because blocking the edit tools alone still leaves the Bash `cat > file`
  channel open:
  1. the delegated driver's file-editing tools are **removed**
     (`--disallowedTools Edit Write NotebookEdit MultiEdit` in `runtimes.mjs`),
     so contract files are written by Bash heredoc and repo edits have no tool;
  2. **zero delegations is a HARD gate failure in EVERY phase — repro,
     localize, AND patch** (`run-harness.mjs`). The premise is "Claude drives,
     Gemini does the work," so the substantive engineering in each phase must be
     the worker's. That includes read-only **LOCALIZE**: deciding *where* the bug
     lives is real reasoning, and `localize.json` is injected verbatim into the
     PATCH prompt — a driver-authored localization would smuggle Opus's thinking
     into a result we report as Gemini's. Localize is therefore delegated too, as
     a **read-only** analysis task (the worker finds the bug files + test command
     and must not edit the tree, or the read-only gate fails); the driver writes
     `localize.json` from the worker's findings. A phase with no worker call is
     failed — a driver-only phase has nothing valid to grade;
  3. a **PreToolUse delegation guard** (`delegation-guard.mjs`, provisioned per
     phase-attempt and loaded via `claude --settings`, matching Bash, Read and
     Grep/Glob) enforces two rules at runtime:
     - **tree-write ban (always on):** any driver Bash command that would write
       the working tree — in-place editors (`sed -i`, `git apply`, `patch`) or a
       redirect/`tee` whose target lands inside the workdir — is denied, while
       writes to the out dir (contracts, worker-task files) and `/tmp` stay
       allowed. This is the structural closure of the `cat > file` channel;
     - **delegate-first lock (until the attempt's first worker call):** a
       2026-07-24 smoke showed the write ban alone lets the analysis migrate
       into *read-space* — the driver read the bug's source files and ran the
       test suite itself before "delegating" a rubber-stamp task. So until the
       phase-attempt's first real `gemini_worker.py` invocation (recorded by a
       per-attempt sentinel file), workdir Reads, repo-targeting Grep/Glob
       searches and repo-inspecting Bash are denied too; the delegation itself
       unlocks the repository so the driver can *verify* the worker's output.
     Both rules run the audit's own classifiers (`bashEditsTree`,
     `bashInspectsRepo`, `searchTargetsRepo`), moved from *after* the run to
     *before the command executes* (heredoc bodies are stripped first, so a task
     file that merely mentions `sed -i` or `gemini_worker.py` is not
     false-matched). `guard.test.mjs` covers the classifiers *and* the generated
     script end-to-end (JSON on stdin → deny decision on stdout), $0/offline;
  4. `audit.mjs` adds non-critical **`driver-direct-edit`** and
     **`driver-predelegation-inspection`** flags that record any tree-write
     attempt or pre-delegation repo inspection by the driver, for transparency
     (defence in depth behind the guard, and a retro-lens for trajectories
     recorded before the guard existed);
  5. `audit.mjs` also checks **what** was delegated, not just *that* something
     was: **`delegation-policy-mismatch`** parses `--model`/`--thinking` off
     every real `gemini_worker.py` command and compares them against the
     binding the policy pinned **for that phase** (so a tiered policy is held
     to its own per-stage worker, not to a single run-wide one). Model
     mismatch is **critical**; thinking mismatch is not. Everything above this
     line answers "did the driver do the work itself?" — this one answers "was
     the work handed to the model the column is named after?", which a
     zero-delegation gate cannot see.
  6. the **re-delegation content rule** in the mandate itself (2026-07-29,
     finding C1 of the driver-integrity audit). Items 1–3 close every channel by
     which the driver can touch the tree or pre-analyse it, which leaves exactly
     one channel it is SUPPOSED to have: the task text. The old rule — "re-
     delegate with a corrected task description … do not fix its work by hand" —
     bound the driver's hands and left its mouth open: a "corrected task
     description" could contain the finished function, a diff, or a line-level
     instruction, and the worker would type the driver's answer while every
     receipt still showed a Gemini delegation. Every count, every gate and every
     guard reads clean on that trajectory; only the prose shows it. The mandate
     now states the allow-list (observed failure, verbatim build/test output, the
     unmet contract clause) and the deny-list (diff or patch, finished file or
     function body, "change line X to Y", any tree-mutating command) explicitly,
     keeps verification explicitly legal so a driver does not over-read the ban,
     and closes the second-order hole — a command the guard denied to the driver
     may not be handed to the worker to run on its behalf. Note what this is and
     is not: a task file is free text, so no runtime guard can classify it while
     the phase runs. This rule is persuasion at authoring time; catching a breach
     is the post-run audit's job — item 7.
  7. the **delegation content lint** in `audit.mjs`, which does that job
     (2026-07-29, finding C2). It reads every driver→worker hand-off out of the
     trajectory *in stream order* and records four things: a long non-shell
     fenced block (`driver-dictated-code`), hand-over phrasing such as "here is
     the fix" (`driver-dictation-phrasing`), a tree-mutating command routed to
     the worker (`driver-proxy-shell-command`), and — the only critical one —
     a command the guard **already refused to the driver as a tree write**,
     re-issued through the delegation channel (`guard-evasion-by-proxy`).
     Three properties are deliberate. It **never blocks**: the task file is the
     one channel the driver is supposed to keep, and a runtime censor on it
     would break the method it is protecting. Its output lands in a **separate
     `integrity_warnings` array**, never in `flags`, because flags are
     mechanical facts about sealed channels and these are judgements about
     English. And its thresholds are **measured, not chosen** — ground truth is
     the 50 hand-offs written by the eight delegated runs that were on record
     when the labels were made, hand-labelled on 2026-07-28. That corpus is
     **frozen at those 50** on purpose — later delegated runs are not folded
     in, because a label set that moves under the thresholds cannot falsify
     them. (The live tree is larger; see the delegation counts above.) The
     shipped rules score 6/6 dictations and 1/1 proxy hand-offs
     with **zero false positives**. The dictation threshold (9 non-blank lines
     in a fence) has a **one-line margin**: the largest fence in a clean
     hand-off measured 8, the smallest in a labelled dictation 9. That margin
     is the reason this warns and never gates.
     Those numbers are **checkable, not asserted** (2026-07-29, finding C4). All
     fifty hand-offs are committed under `fixtures/delegation-corpus/` — the
     text, the human label, and the families the lint produced when it was
     pinned — and `delegation-corpus.test.mjs` re-runs the lint over them on
     every `pnpm test`. It fails if a clean hand-off starts warning, if a
     dictation stops being caught, if any row's families change at all, or if
     the 8-vs-9 margin the threshold sits in stops holding; the margin is
     re-derived from the files rather than restated, so the constant cannot
     drift away from the evidence for it. The copies are sanitised (one absolute
     host path replaced, verified lint-neutral before it was written) and the
     run directories they came from are never modified — see that folder's
     README for the provenance rules.
     One narrowing is worth stating because the first cut got it wrong: only a
     **tree-write** denial counts as evasion. The guard's other denial —
     delegate-first, which refuses a *read* — is asking for the work to move to
     the worker, so a judge task file naming the files to review is compliance,
     not evasion. Correlating on those fired on every delegated run.
  8. the **attribution split** the exporter publishes (2026-07-29, finding C8).
     Everything above establishes one claim precisely and a second claim only
     loosely, and the old one-line summary — "the driver authored none of the
     patch" — welded them together. They are now separated, because they are not
     equally strong:
     - **`typed_by`** — whose tokens produced the bytes. This is **structural**:
       the driver's `Edit` / `Write` / `MultiEdit` / `NotebookEdit` tools are
       removed from its allow-list and the PreToolUse hook refuses every
       tree-writing shell command. Nothing a trajectory contains can make it
       false, so it is stated flatly.
     - **`authored_by`** — whether the driver *dictated* what the worker typed.
       This is **not** structural. The hand-off channel is prose, and prose can
       carry a finished file; item 7 is the only thing that measures it, and it
       measures after the fact. So this field reports what the lint found:
       `worker — MEASURED` when it scanned the hand-offs and found nothing,
       `MIXED — MEASURED` with the passage count and families when it found
       something, and `UNKNOWN` when the lint never ran for that run. `UNKNOWN`
       is deliberately not spelled as a clean result; an unchecked run is not a
       clean run. A column takes the *worst* of its runs, so one unchecked or
       one dictated run is visible at column level rather than averaged away.

     Both halves reach the console. `harness.cable.attribution` renders as a
     **Who wrote the code** block in the cable strip pinned above every study
     tab, and `instanceRow.delegation.typed_by` / `.authored_by` render on the
     SWE-Pro Instances tab. The dashboard applies the same worst-of rule a
     second time — across a study's *columns*, where the exporter applied it
     across a column's *runs* — because `authored_by` is a measurement and
     columns can legitimately disagree; every other cable field is read off the
     first column, which is safe only because those are identical by
     construction. An export that predates this field renders nothing rather
     than a default: a missing measurement must never look like a clean one.
     The rendered copy follows the same split — the study cards and the brief
     say the worker **typed** every line (structural, always true), and only
     the brief's *"Who writes the code"* section, which has room for it, states
     the dictation ceiling in full.
  9. the **after-the-fact hand-off re-read** (2026-07-29, finding C6), which is
     what makes item 8 say anything at all about the runs already on record.
     The content lint of item 7 shipped on 2026-07-28; every delegated run
     recorded before that has no `delegation_content_checked` field, so
     `authored_by` was correctly — and uselessly — reporting `UNKNOWN` on all of
     them, while six measured dictated passages sat in a document outside the
     repo. The hand-offs themselves are still on disk verbatim
     (`out/worker-task-<phase>-a<n>-<i>.md`), so `lintRecordedHandoffs()` simply
     runs the same lint over the same bytes at export and bundle time. It is
     **read-only** — recorded runs are immutable evidence, and a re-audit that
     edits the record is not a re-audit.
     `resolvedIntegrity()` decides which measurement a surface publishes, in one
     direction only: **the run's own pass always wins** (it walked the trajectory
     in stream order, so it is the only one that could raise the critical
     family), the re-read is used when the run never checked, and `UNKNOWN`
     survives when neither happened. It reports `measured_at`
     (`"run"` / `"re-read"` / `"never"`) so no surface re-derives provenance and
     then disagrees, and the re-read's sentence says out loud that it postdates
     the run and **cannot see `guard-evasion-by-proxy`** — a zero there is not
     evidence against evasion.
     Both publishers import this from `audit.mjs` rather than restating it:
     `export-dashboard.mjs` for the console, `bundle-run.mjs` for
     `evidence-bundle/integrity-notes.md` and `evidence-bundle/delegation/lint.json`.
     Same discipline as `bashEditsTree`, `GUARD_DENIAL_MARK` and
     `DICTATION_MIN_LINES`: the sentence two surfaces must agree on has exactly
     one definition. The bundle's section also carries the **measured reach** of
     a flag, which differs by kind and is quoted rather than asserted — on
     SWE-bench Pro all three dictated passages landed in `repro`, whose
     scaffolding is stripped before grading (**0 of 58 verbatim lines reached the
     graded diff**, so the resolve figures are uncontaminated); on SDLC they can
     reach the test file scored as `test_quality` (19 of 24, 9 of 90, 0 of 7),
     and the one dictation-free control in the same cell scored *higher*, so the
     defect is a wrong credit line rather than an inflated number.
  The manifest still records per-attempt `delegation_calls` (the count of
  `gemini_worker.py` invocations in the driver's Bash tool calls). Recorded
  `cost_usd` covers the driver only; the worker's Gemini spend is captured as
  **real token counts** in the `worker_usage` sidecars (SDK `UsageMetadata`) and
  priced downstream — the `cost_basis` string says so.
