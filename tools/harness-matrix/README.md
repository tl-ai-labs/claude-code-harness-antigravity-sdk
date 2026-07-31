# harness-matrix — the runner

This directory is the harness itself. If you have read the top-level
[README](../../README.md) and want to know what each file does before
changing one, this is the map.

One run is one **kind** × one **runtime** × one **policy** against one input:

- **Kind** — what the work is. Two ship: **SWE-bench Pro** (`--instance-dir`,
  `kinds/swepro.mjs`) puts one frozen Scale instance through
  REPRO → LOCALIZE → PATCH and grades it with Scale's official evaluator;
  **SDLC** (`--task-dir`, `kinds/sdlc.mjs`) walks the eight stages of
  `templates/sdlc-mini/template.yaml` against a fresh copy of the
  `scaffolds/service-web` NestJS + Prisma scaffold, and grades it with the
  scaffold's own build and test.
- **Runtime** — who drives. One ships: `claude-code`.
- **Policy** — which models, thinking levels, retries and caps. Four ship,
  in `policies/`. See [docs/policies.md](../../docs/policies.md).

The script owns the loop — stage order, prompts, gates, retries, cleanup —
and the runtime only owns the inside of a phase: what to read, how to test,
how to hand work to the worker. That split is why an outcome difference
between two cells reads as a difference between the cells rather than as
procedural drift between two differently-run experiments.

**New here?** Start with the user-facing docs, not this file:
[setup](../../docs/setup.md) · [running](../../docs/running.md) ·
[policies](../../docs/policies.md) · [methodology](../../docs/methodology.md) ·
[understanding output](../../docs/understanding-output.md).

## Files

| File | What it is |
|---|---|
| `run-harness.mjs` | The engine. Args → resolve one kind + one runtime + one policy → hand over. No benchmark-specific code: the selected kind's module is imported dynamically, so an SDLC run never loads the Pro kind's `packages/swe-bench` dependency and vice versa. |
| `kinds/lib.mjs` | Everything whose behaviour must be **identical across kinds** for cross-cell numbers to mean anything: policy load and validation (a thin wrapper over the shared engine in `packages/policy/core/policy-core.mjs`), prompt rendering, `run-in-env`/`execInEnv`, change classification, diff-vs-anchor, the stage attempt loop (retry notes, pin verification, zero-delegation enforcement, attempt records), and manifest totals. |
| `kinds/swepro.mjs` | The SWE-bench Pro kind: sealed-image build and extraction-integrity checks, nulled source hosts, the three phase gates with cross-phase contract state, test/repro diff stripping, Scale grading, opt-in image cleanup. |
| `kinds/sdlc.mjs` | The SDLC kind: loads the task's `template.yaml` live and walks its stages — llm-task and judge stages as stateless runtime calls with contract-chained prompts, `verify` as a script gate (sha256 chassis integrity + build + test + up to 3 repair rounds fed the real failing log), `report` as the finish block. Slot gates are diff-vs-anchor based. |
| `runtimes.mjs` | The `claude-code` runtime adapter: argv construction, preflight, timeout, stream-json parsing. The delegated branch renders the Gemini-worker Skill that shells out to `gemini_worker.py`, and **removes the driver's file-editing tools** (`--disallowedTools Edit Write NotebookEdit MultiEdit`) so the only path by which a repo change reaches disk is a worker call. |
| `gemini_worker.py` | The Antigravity SDK Gemini worker. Invoked once per delegated task by the driver through the provisioned Skill; does the engineering on Gemini through `google-antigravity` → Vertex AI, and writes a `worker-usage-*.json` sidecar with the SDK's own token counts (`UsageMetadata`), the resolved model, the SDK version, and the Vertex project and region. Cost is **not** computed here — tokens are recorded raw and priced downstream. |
| `audit.mjs` | The post-run audit, and the home of the predicate the live guard shares. Trajectory families (git-history mining, source-host fetch, test-edit attempts, driver-direct-edit, delegation-policy mismatch) plus `lintDelegationText`, the driver→worker hand-off content lint. The three Pro-specific families are skipped **on the record** for SDLC runs (`skipped_check_families` in `audit.json`) — a greenfield brief has no gold fix to mine, and its tests are the deliverable. |
| `fixtures/delegation-corpus/` | 50 real driver→worker hand-offs, hand-labelled (44 clean, 6 solution-leaked), each stored with the exact warning families the lint produced when its threshold was pinned. Frozen at those 50 on purpose: a threshold measured against a label set that keeps growing can never be failed by it. See the folder's own README. |
| `grade.mjs` | (Pro) Wrapper around Scale's `swe_bench_pro_eval.py`: builds `sample.jsonl` and `patches.json` from the corpus files, runs local Docker with `--block_network`, writes `grade-verdict.json`. |
| `grade-sdlc.mjs` | (SDLC) Re-runs the scaffold's build and test in a fresh container invocation **after** the last model call and writes the same-named `grade-verdict.json` (`resolved` = builds + full suite green). The judge stage's scores ride alongside in the manifest: mechanical floor, qualitative ceiling. |
| `Dockerfile` | (Pro) The sealed execution image: base instance image + bash/coreutils + git-history erase + a `sealed-base` tag, which is the diff anchor. No agent layer — the runtime lives on the host. |
| `Dockerfile.sdlc` | (SDLC) One shared toolchain image (`node:22-bookworm`, corepack-pinned pnpm) that every SDLC run executes in. No per-instance seal: the scaffold enters as a host-side copy tagged `scaffold-base`. |
| `policies/*.yaml` | The four shipped cells. Schema and rationale in [docs/policies.md](../../docs/policies.md); `policies/all-opus.yaml` carries the canonical in-file explanation of the v2 schema. |
| `prompts/*.md` | The `{{PLACEHOLDER}}` phase prompts — `repro/localize/patch.md` for Pro, `sdlc-*.md` for the SDLC stages. Context between stages travels via contract files (`repro.json`, `requirements.md`, `packets.json`, …) injected by the script, never via runtime conversation state. |
| `logfmt.mjs` | Terminal primitives and the 80-column grid: boxes, rules, tables, `kvBlock`, the null-honest roll-ups (`attemptTotals`, `tokenSplit`), and `say()`/`sayErr()` — the harness's only writers. Both route through `fitLine`, which returns anything already inside the grid byte-identical and wraps anything past it with a hanging indent. |
| `logrender.mjs` | The run's two big frames — opening header, closing scoreboard — as **pure functions of a plain descriptor**. Both kinds build that descriptor from live state; `replay-log.mjs` builds an identical one from `manifest.json`. |
| `replay-log.mjs` | Re-renders a finished run's terminal log offline at **$0**. Read-only: no model, no network, no container, no writes. See [Replay a finished run](#replay-a-finished-run). |
| `export-dashboard.mjs` | Turns finished `runs/` evidence into a stable JSON contract for a dashboard viewer (the viewer itself is a separate application, not included here). Contract documented at the top of the file; usage in [docs/understanding-output.md](../../docs/understanding-output.md). |
| `bundle-run.mjs` | Builds `<run>/evidence-bundle/` — the self-contained, allowlisted copy of one run that someone reads instead of trusting the operator: the graded artefact, every driver turn, every worker hand-off, `audit.json`, a `MANIFEST.sha256` over the lot, and a generated `README.md` + `integrity-notes.md`. Derived, and the one thing allowed to write inside a run directory: it removes and rebuilds the bundle on every invocation and touches nothing else. It credential-scans every file it writes and refuses to write the bundle at all on a hit. |
| `scrub-paths.mjs` | The sanitiser that runs when evidence leaves the machine. Recorded runs carry absolute host paths in four nested shapes; `scrubText` rewrites them to `/harness`, `/repo` and `/home/user` **longest prefix first**, because a shorter rule firing first yields `/home/user/Desktop/<repo>/…` — no `/Users/` left, layout published anyway. `scrubTree` never opens anything under `runs/` for writing, and re-lints each hand-off before and after to refuse any substitution that would move a verdict. `assertNoHostPaths` walks the result and throws. |
| `sdk-probe/` | The Antigravity SDK capability probes — the reproducible evidence behind this repo's SDK claims, including the one blocking defect on the Claude-as-worker path. See [sdk-probe/README.md](sdk-probe/README.md). |
| `*.test.mjs` | The offline suite. [Tests](#tests) lists every file and what it defends. |

## Run one cell

```bash
node tools/harness-matrix/run-harness.mjs \
  --instance-dir studies/swe-pro-corpus/<instance_id> \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

The complete flag list, the exit-code vocabulary, and the SDLC form of this
command are in [docs/running.md](../../docs/running.md). `--runtime` accepts
only `claude-code`; anything else fails preflight before a token moves.

`--cleanup-images` is **off by default and machine-specific.** A sealed Pro
instance image is around 4.4 GB, so a twelve-instance sweep needs roughly
52 GB if nothing is pruned. On a machine with disk to spare, leave it off:
the same base images are reused by every cell and re-pulling costs real time.
It is safe for integrity either way — no evidence lives in an image (the diff
anchor `sealed-base` is a git tag inside the extracted workdir) and the base
image's digest is recorded in the manifest before deletion, so a re-pull is
provably identical. Under `--skip-grade` the base image is kept for the
deferred grade and only the sealed layer goes.

**Live narration.** The full stream-json trajectory goes to disk, but the
terminal is not silent while a phase runs. Every stage announces itself, and
inside a phase the trajectory is narrated as it streams: one dim line per
driver tool call (paths folded to `workdir/…` and `out/…`), worker
delegations called out with the worker's return announced, guard denials
labelled by which rule fired, and each attempt closing with a delegation
summary — worker calls, usage sidecars, real worker token totals. Narration
is print-only (`makePhaseNarrator` in `runtimes.mjs`, unit-tested in
`guard.test.mjs`); the trajectory on disk stays the evidence of record, and
nothing downstream ever parses the log back.

## Outputs

Each run writes `runs/<taskId>/<runtime>--<policy>/<stamp>/`. The full layout
and what each file is for are in
[docs/understanding-output.md](../../docs/understanding-output.md). Two
details that matter when reading the code rather than the output:

- **`manifest.json`'s audit rollup** carries `audit_flags` and
  `integrity_warnings` as `{total, critical, by_family}` — not bare integers.
  A bare count throws away the one fact a reviewer needs (*was any of it
  critical*) at the exact moment the exporter sums it across a batch. Both
  kinds build the block from one shared helper (`manifestAuditBlock` in
  `audit.mjs`) so they cannot drift into reporting the same audit
  differently. Runs recorded before that change still carry an integer; the
  exporter reads it as **`critical: null` — unknown, never 0** — and recovers
  the real breakdown from `audit.json` when that file is still beside it.
- **`worker_usage` sidecars name the cable, not just the model.** Each
  carries `sdk` (`google-antigravity`), `sdk_version` read from the installed
  distribution, `vertex_project` and `vertex_location`, alongside the token
  counts. Before that, a run's artifacts proved *a Gemini model answered* but
  never named the SDK that reached it — which is the delegated cell's whole
  claim.

`runs/` is gitignored: it is machine-local evidence. `.pkg-store/` is
gitignored and docker-ignored too — it is the package store the SDLC
container writes to, deliberately mounted at `/pkg-store` **outside** the
graded `/app` tree. pnpm hardlinks packages out of its store and cannot
hardlink across a filesystem boundary, so with the store on the container's
overlay layer and `node_modules` on a host bind mount, pnpm silently
relocates the store *into the project* — which once put 5,238 files inside a
graded workdir and produced a 61 MB diff. It is shared across runs, safe to
delete at any time, and repopulated by the next run.

Moving the store fixed *where* packages land but left the other half of the
same filesystem split: `node_modules` was still on the bind mount, so pnpm
had to copy across the boundary, and a name collision there produced ` 2`
duplicate directories instead of overwriting — which shadowed the real tree
and made a platform-specific optional dependency vanish. So each SDLC run
also gets a **per-run Docker volume mounted at `/app/node_modules`**, created
before the container starts and torn down on every exit path. Consequence
worth knowing: `node_modules` is not visible on the host during or after a
run.

## Replay a finished run

```bash
node tools/harness-matrix/replay-log.mjs --run-dir tools/harness-matrix/runs/<task>/<cell>/<stamp>
```

`--stage <id>` narrates one stage; `--frames` prints only the header and the
scoreboard; no arguments prints an index of the runs on disk.

**Why it exists.** The log is screenshared, paused on, and quoted, which
makes its wording and spacing a deliverable. Without this, the only way to
*look* at that deliverable is to pay for a live run and watch it scroll past
once.

**Fidelity, stated plainly** — a rehearsal that quietly differs from the real
thing is worse than none:

| Tier | What |
|---|---|
| Real, byte-for-byte | Header and scoreboard are the same `logrender.mjs` functions the live run calls. Per-stage narration is the same `makePhaseNarrator`, fed the run's own `out/phases/*.trajectory.jsonl` — so every tool call, every delegation box, every blocked line and every worker receipt is the run's own. |
| Real, from the run | `[+m:ss]` stamps and each hand-off's duration come from the trajectory events' own timestamps (the narrator's clock is injectable for exactly this), so a replay carries the run's real pacing rather than collapsing to `[+0:00]`. |
| Reconstructed | Stage banners, the model-pin line, the worker ledger and the gate verdict, all from `manifest.json` — which is where those numbers came from live. |
| Not replayed | Docker build output and gate command logs. That is the environment talking, not the run's evidence about who did the work; it lives in `out/*.log`. |
| Never invented | A value the manifest cannot supply prints as `(unrecoverable — not in manifest.json)`. |

### Preview a run you have not paid for

Replay needs a finished run. A cell you are about to add does not have one —
and that is exactly when the wording matters most, because the first paid run
is also the first time anyone sees it. `--dry-run` covers that gap:

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/uptime-ping \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-25-flash-high.yaml \
  --dry-run
```

An SDLC dry run prints the **real opening frame** — the same
`logrender.sdlcHeader` output the paid run prints, from the same descriptor —
followed by the rendered first-stage prompt. Nothing else runs: it exits
before preflight, before Docker, before any token moves.

Only two rows can differ from a real run, because only two are unknowable in
advance: `runtime` (probed at launch; degrades to a labelled placeholder if
the driver CLI is absent) and `started`, which prints
`— not started (--dry-run: nothing executed)` rather than a plausible ISO
timestamp. A preview that stamps a real-looking time is indistinguishable
from a captured run in a screenshot.

`kinds/sdlc.test.mjs` pins all three producers together: the dry run's frame
must equal, byte for byte, the frame `replay-log.mjs` rebuilds from a
finished run's `manifest.json`, minus those two provenance rows. Live,
preview and replay therefore all have to agree.

## Tests

Every test reachable from the root script is **$0 and offline** — no model,
no Docker, no network — so the whole suite is safe to run on any change:

```bash
pnpm test
```

Some suites assert against a recorded run or the SWE-bench Pro corpus,
neither of which ships in a clone; those skip themselves and say so.
**Zero failures is the bar, not zero skips.**

| File | Covers | Why it exists |
|---|---|---|
| `guard.test.mjs` | The `bashInspectsRepo` / `searchTargetsRepo` classifiers, the generated PreToolUse hook driven end to end (JSON on stdin → decision on stdout), the phase narrator, the rendered worker Skill pinned to a golden sha256, and the worker-clock nesting invariant | The guard is the delegated cell's structural line of defence. If it silently stops denying, the study quietly becomes "one model did everything" while still reporting delegation. The narrator's provenance clause has the mirror-image risk: sidecars recorded before the SDK fields existed have no `sdk` key, and a line reading `via undefined` would be *inventing* provenance on the one line whose entire job is provenance. |
| `audit.test.mjs` | The post-run audit: the `stripHeredocs` pre-pass every command scanner shares, `bashEditsTree`, and both trajectory-level entry points. Plus the attribution layer — `lintRecordedHandoffs`, `resolvedIntegrity`'s one-directional precedence, `attributionSplit`, and `delegationIntegrityNotes` staying silent for a run that had no hand-offs | The audit is what lets a published number claim no exploit was attempted, so **both** error directions are expensive. A missed flag publishes a resolved instance whose trajectory mined git history for the fix; a false flag voids a legitimate result, because a critical family deletes the instance from the study. |
| `delegation-corpus.test.mjs` | The hand-off content lint replayed over all 50 labelled hand-offs in `fixtures/delegation-corpus/`, the exact families each produced, the 8-vs-9 threshold margin re-derived from those files, and that no committed copy carries a host path | Every number this repo quotes about dictation — 6/6 caught, zero false positives, a one-line margin — is only meaningful if it is a test that can fail. This is also the only suite whose fixtures are *evidence* rather than constructions, which is the point: no fixture written by the author of a rule can falsify that rule. |
| `scrub-paths.test.mjs` | Each host-path shape mapping to its placeholder, suffixes surviving, idempotence, that `scrubTree` leaves source bytes untouched and refuses to emit a hand-off whose lint families moved — then the same rules replayed over every tracked hand-off under `runs/` | Two failure modes, both silent. Ordering: apply the `$HOME` rule first and the output has no `/Users/` left but ships the directory layout anyway, so a naive check passes. Verdict drift: a substitution that changes what the lint sees would publish different delegation findings from files that look byte-plausible. |
| `logfmt.test.mjs` | `attemptTotals` roll-ups and the null contract, `tokenSplit`, the table and box layout invariants, and the 80-column grid | `attemptTotals` is **null-honest** by design: an attempt that reported no cost must surface as `n/a`, never `$0.0000`, because a fake zero reads as "this cell was free". Typechecking cannot see that distinction; a test can. |
| `logrender.test.mjs` | The frame builders rendering from a plain descriptor alone, the delegated-cell facts a reader takes off the screen, a non-delegated cell omitting the delegation apparatus entirely, and `replay-log.mjs` replaying every run present on the machine | The frames used to be inline in each kind runner, so reviewing the run's own wording meant paying for a run, and any offline rehearsal re-implemented them and drifted. The grid is asserted on rendered output because source review had already missed 87 over-long lines. |
| `kinds/sdlc.test.mjs` | `--dry-run` as a subprocess: the real boxed header, no plausible ISO start time, the policy's own models, the 80-column grid, and byte-equality with the replayed frame | `--dry-run` is the only way to read a cell's opening frame before paying for the cell, which is worth nothing if the preview shows a frame the paid run never emits. |
| `kinds/swepro.test.mjs` | `--dry-run` as a subprocess for the Pro kind: that it executed nothing, names all three phases with their driver → worker binding and the SDK that carries it, reports the policy's own models, and fits the grid. Skips when the machine-local corpus is absent | The kind that runs the benchmark published externally is the path with the higher blast radius, so it gets the same offline contract the SDLC kind has. |
| `kinds/lib.test.mjs` | The library both kinds share: what a run is allowed to have touched, what its patch contains, what it cost, how a delegated cell is described. Git-backed helpers run against real throwaway repositories, not a stubbed `git` | A bug in `lib.mjs` is a bug in every cell at once, and those four things are exactly what a reader takes on trust. Stubbing git would only prove the stub — the behaviour under test *is* git's. |
| `grade.test.mjs` | Both graders: the empty-patch short-circuit, the refusals to grade without `model.diff` or `sealed.json`, the SDLC no-delivery short-circuits, and `parseVitestCounts` including order-agnostic segment parsing | The Docker leg cannot honestly be unit-tested, so what is covered is everything deciding whether the grader runs at all. `parseVitestCounts` earned its own cases after a positional regex silently dropped a failure count to zero on `2 failed \| 1 skipped \| 10 passed`, publishing a false green. |
| `tasks.test.mjs` | Walks the SDLC workload corpus under `examples/` and re-checks every launch-time rule offline: `task.json` shape, and the brief each task pins by hash | Every check here is one the SDLC kind already makes at launch — the right place for a run to *fail*, the wrong place to *find out*. Walking rather than enumerating means a workload added later is covered the moment its directory exists. |
| `run-harness.test.mjs` | The engine's argument contract: mutually exclusive selectors, the missing-descriptor check, and the exit codes each failure uses | A mistyped path used to surface as a raw `ENOENT` from inside a kind module and exit `1` — "infrastructure error" — for what is plainly a usage mistake. |
| `export-dashboard.test.mjs` | The exporter as a subprocess against synthetic run dirs: argument guards, `--dry-run` writing literally nothing, `--out` isolation, the artifact set, the two-wallet cost split, batching and idempotence | These prove `--out` and `--dry-run` are absolute. It is driven as a subprocess because the script parses `process.argv` and calls `process.exit` at module scope, so importing it would run it. |
| `bundle-run.test.mjs` | The bundler: identity resolution for both manifest shapes, the gate that keeps the Scale re-verify recipe out of an SDLC bundle, the delegation files being in the common allowlist for every kind, and the delegation-integrity section landing in both kinds' `integrity-notes.md` | The bundle is what someone reads instead of trusting the operator, and its failures are silent by construction: the bundler once shipped Pro-only and died on the first SDLC run while the Pro bundles it had already written looked like success. |
| `worker-env.test.mjs` | The Python worker's configuration contract — including that the `GOOGLE_CLOUD_PROJECT` check sits above the SDK import, so it fires without the worker venv built | The project variable has no default on purpose. A check that needed the venv to run would fire too late to be the fail-fast it exists to be. |
| `setup.test.mjs` | The wizard's fail-fast ordering, its auth contract, and the install boundary — that every path it creates resolves inside the clone | A boundary nobody can check is a boundary that erodes. See `../setup.mjs`. |
| `docs-links.test.mjs` | Every relative Markdown link in every tracked `.md` file resolves to a file that exists | A dead link in a repo someone else has to set up from scratch costs them the one thing they cannot recover on their own: knowing where the answer was supposed to be. |
| `../lib/benchmark-brief.test.mjs` | Every dataset × track combination walking one identical section outline, the H1 identity rules, and the guard-rail throws | The generator's own source claims a track can never add, drop or reorder a section. That decays silently, because an extra section still renders fine. |

**A change ships with its tests.** The suite is free and offline, so there is
no cost argument against it: anything that produces a number a human reads,
or enforces a rule a run depends on, gets covered in the same commit that
changes it.

## Honesty rules baked in — do not "fix" these

- **A null cost is not a zero cost.** When the driver runs on a Claude Code
  subscription seat, its cost is CLI-modeled, not wallet-real, and
  `cost_usd: null` means *not measurable* — never *no compute happened*. The
  manifest's `cost_basis` field says which regime applies. In a delegated
  cell the recorded `cost_usd` covers the **driver only**; the worker's real
  token counts are recorded raw in the sidecars and priced downstream. They
  are never converted to dollars in the worker or summed into the driver
  total, because one number presented as a cell total when it covers half the
  cell is worse than an honest split.
- **The Vertex non-global surcharge is model-family-scoped.** A non-global
  Vertex region carries a +10% surcharge, and it applies to the Gemini 3 and
  later families only. So `gemini-3.5-flash` and `gemini-2.5-flash` in the
  same region are on **different surcharge regimes**, and applying one
  multiplier to both overstates the cheaper tier by 10%. The tiered policy
  uses both, which is exactly where this would go wrong unnoticed.
- **A Pro row reading `0 passed / 0 failed` is a model failure, not a broken
  grader.** It is tempting to read "no tests ran" as the evaluation
  environment having failed, and to discount the instance. Every such row
  traced through its own `harness_stdout.log` tells the same story: the
  patch does not compile against the held-back tests, Scale's evaluator
  prints `[build failed]`, and the results file is literally `{"tests": []}`.
  A patch that will not build **is** a failed attempt. The verdict stands and
  the denominator does not change. Before attributing a zero to
  infrastructure, read the log that produced it.
- **No telemetry gateway.** Routing the runtime through a proxy to capture
  tokens uniformly was considered and rejected: it would mean a
  man-in-the-middle proxy with a private CA against an authenticated vendor
  seat. The SDK reports its own usage natively, which is the honest source
  anyway — the receipt comes from the vendor's own client, not from something
  sitting in the middle of the connection.
