# The SDLC kind — the console's own flow as a harness-matrix leg

**What this is.** The second task KIND of the harness matrix (2026-07-25):
the console's canonical SDLC flow — `templates/sdlc-mini/template.yaml`,
the same eight fixed stages the orchestrator runs — driven end to end by
ONE agent runtime under ONE policy, against a fresh copy of the
`service-web` scaffold, graded by the scaffold's own build+test. It answers
the SDLC half of Ravi's 2026-07-24 ask ("run the harness on our SDLC leg,
not just SWE-bench Pro") with the same study design the Pro leg already
has: **procedure fixed, runtime varies** — so a cross-kind comparison reads
as "how does the same runtime behave on greenfield SDLC work vs on a frozen
bug fix", with nothing procedural in the gap.

Selected by `--task-dir` (Pro is `--instance-dir` — exactly one selector
per run, the engine has no kind conditionals past that dispatch):

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  node tools/harness-matrix/run-harness.mjs \
    --task-dir tools/harness-matrix/tasks/kudos-wall \
    --runtime claude-code \
    --policy tools/harness-matrix/policies/all-opus.yaml \
    [--dry-run] [--skip-grade]
```

`--dry-run` prints the run's **real opening header frame** — the identical
`logrender.sdlcHeader` output the paid run prints, from the same descriptor —
then the rendered first-stage prompt, and exits before preflight, Docker and
any spend. It is how a new column's wording is reviewed before it is paid for;
only `runtime` and `started` differ, and `started` says `— not started` rather
than a plausible timestamp. See the README's *Preview a run you have not paid
for*.

## How the segregation mirrors the console

`run-executor.ts` iterates a template's stages and dispatches on executor
kind; the task-type specifics live in template DATA, not engine code. The
harness now does the same twice over:

| Console concept | Harness home |
|---|---|
| template dispatch (`template_id` → stages) | `kinds/sdlc.mjs` loads `templates/<task.template_id>/template.yaml` LIVE — stage list, order, and the verify repair budget come from the yaml, never from code |
| executor kinds (`llm-task`, `verify`, `judge`, `report`) | `llm-task`/`judge` → one stateless runtime invocation each; `verify` → script gate (integrity + build + test + repair loop); `report` → the harness finish block (manifest/diff/audit/grade) |
| model routing per phase | the policy's `rules[]` — the console's own matcher, shared verbatim since the 2026-07-29 schema unification (DESIGN §2.4a). SDLC stage ids resolve through the `default` rule, so the three-slot Pro policies serve the eight-stage template without duplication; `gemini35-plus-25-flash-high.yaml` names stages explicitly to mirror `opus-plus-flash.yaml`'s premium/cost-efficient split. (A legacy `policy_snapshot.yaml` frozen inside an already-recorded run still resolves through its old `phases:` map + `phases.default` fallback — those files are never rewritten.) |
| scaffold slots + manifest | enforced as GATES: diff-vs-anchor path checks (slots), sha256 manifest check (chassis), schema prefix check (append-below-marker) |

What is deliberately DIFFERENT from the console: every model-driven stage
runs on the SAME runtime×policy cell (the study is the harness, not
cost-tier routing), and stages chain through harness-injected contract
files — not orchestrator conversation state — so context is byte-identical
across runtimes.

## The stage walk (template `sdlc-mini` v0.8.0)

| Stage | Executor | Contract (in `out/`) | Gate |
|---|---|---|---|
| requirements | llm-task | `requirements.md` | headings `## Functional requirements` + `## Acceptance criteria`; repo untouched |
| design | llm-task | `design.md` | headings `## Data model` / `## API` / `## Module plan`; repo untouched |
| plan-packets | llm-task | `packets.json` | 2–8 packets, kebab-case unique ids, title+goal, slot-only `files_hint`; repo untouched |
| execute | llm-task | `execute.json` + the code | `packets_done` = exactly the planned ids; ALL changes inside slots; ≥1 file in `src/modules/` AND `test/modules/`; schema append-only; `MODULES` array non-empty |
| verify | verify (script) | — | sha256 chassis integrity (not repairable → hard fail), then `pnpm build` + `pnpm test`; failures feed the real log tail into ≤3 repair rounds under the execute binding |
| review | llm-task | `review.md` | headings `## Findings` + `## Verdict`; read-only vs the verified tree |
| judge | judge | `judge.json` | four numeric 0–10 scores + summary; read-only |
| report | report (script) | `manifest.json`, diffs, `audit.json`, `grade-verdict.json` | — |

Chaining: requirements → design → plan-packets → execute prompts each carry
the prior stage's contract inline (`{{REQUIREMENTS}}`, `{{DESIGN}}`,
`{{PACKETS}}`); review/judge get the changed-file list. Retries reset to
`scaffold-base` (pre-verify) or `verified-tree` (post-verify, a HARNESS
commit — agent commits are banned by every prompt); verify repair rounds
iterate in place, by design.

## Environment and anchors

- **One shared toolchain image** (`Dockerfile.sdlc`: node:22-bookworm +
  corepack-pinned pnpm 9.12.3), no per-instance seal — the task environment
  is the scaffold, provisioned host-side (copy → `git init` → commit → tag
  `scaffold-base`, the diff anchor, same role as Pro's `sealed-base`).
- Every repo command — the agent's and the gates', identically — runs
  through `out/run-in-env.sh` in that image (DESIGN §1.1 unchanged). The
  node image's entrypoint is not a shell, so run-in-env interposes `bash`
  (the `shell` parameter of `writeRunInEnv`; Scale images take `-c`
  directly).
- **No nulled hosts** (greenfield: no fix exists to leak; pnpm/Prisma
  legitimately fetch) and **no diff stripping** (tests are the deliverable).
- Provision proves the CHASSIS green (`pnpm install --frozen-lockfile` +
  build + test on the pristine scaffold) before any model call — a red
  chassis is an infra error, never an agent result. Verified $0 on
  2026-07-25: install 22 s, build 5 s, test 3 s, all exit 0.

## Run limits (raised 2026-07-25, before the leg's first run)

`phase_timeout_min: 45` · `cmd_timeout_min: 15` · `phase_budget_usd: 8.00`,
identical in both policy files. The SDLC leg is the reason the old values
(10 / 10 / 0.75) had to move: **EXECUTE is structurally larger than any Pro
phase** — it authors the whole delivery, modules and tests, across several
worker delegations inside ONE runtime invocation, where a Pro phase produces
a single contract file. A 10-minute ceiling would have killed EXECUTE
mid-delivery and recorded it as a model failure.

The same commit closed three DESIGN §11 defects that all had one shape — a
nested budget allowed to equal its parent:

| Budget | Sits inside | Was | Now |
|---|---|---|---|
| container command | phase attempt | 10 = 10 | 15 < 45 |
| worker delegation | phase attempt | phase timeout, in full | 60% of phase (27 min), clamped strictly below |
| driver's Bash tool | worker delegation | 120 s default, unset | worker slice + 2 min, so the worker's own timeout fires first |

Guarded by `guard.test.mjs` (22/22): one test on the split across a range of
phase budgets, one on the rendered Skill text. §11 defect 2 (fatal errors
consuming retries) stays open by choice — it needs infra-vs-model failure
classification, and it can only ever make a cell look worse, never better.

## Grading and honesty

- `grade-sdlc.mjs` re-runs build+test in a FRESH container invocation after
  the last model call and writes `grade-verdict.json` (same filename as
  Pro): `resolved` = the delivery builds and the full suite passes.
  Requirement-level quality is the judge stage's score
  (`manifest.judge_scores`) — mechanical floor vs qualitative ceiling, kept
  separate on purpose.
- The audit runs with the Pro-only families **skipped and recorded**
  (`skipped_check_families` in audit.json): git-history-mining /
  source-host-fetch / test-edit-attempt do not apply to a greenfield brief.
  The delegated-cell checks (driver-direct-edit,
  driver-predelegation-inspection, delegation-policy-mismatch, zero-delegation
  gate) stay fully active.
- `delegation-policy-mismatch` is the check that makes a **tiered** policy
  auditable. The zero-delegation gate proves the driver handed the work off;
  it cannot prove the work went to the model the column is named after. This
  family reads `--model`/`--thinking` off each real `gemini_worker.py` command
  and compares them to the binding pinned **for that phase**, so a policy that
  runs 3.5-flash on requirements and 2.5-flash on execute is checked against
  both, stage by stage. A wrong model is **critical** — the column is not the
  cell it claims to be, and the run is void. A wrong thinking level is
  non-critical: it lands in the record as a caveat. `audit.json` carries
  `delegation_policy_checked`, so "checked and clean" is distinguishable from
  "never checked" — the 2026-07-26 kudos-wall runs were the latter.
- Tasks are self-contained under `tasks/<id>/`: `task.json` pins template,
  scaffold, and the brief by sha256 — a silently edited brief cannot
  masquerade as the same task.

## Known limitations (stated, not hidden)

- ~~The delegated cell's Skill PREAMBLE speaks Pro vocabulary~~ — **RESOLVED
  2026-07-25.** The Skill's examples are now a per-kind vocabulary
  (`DELEGATION_VOCAB` in runtimes.mjs), threaded from the kind exactly the way
  `delegationWhat` already was. SDLC cells get their own stage names
  (requirements / design / plan-packets / execute / verify) and their own
  contract-file example, so a driver is no longer told it is in a "patch phase"
  a delivery task does not have. The byte-identity concern that parked this is
  handled rather than accepted: Pro passes its own literals back verbatim and
  the rendered Pro Skill is pinned to a golden sha256 in `guard.test.mjs`, so a
  future edit to the Pro mandate has to be deliberate. The unpassed default is
  the NEUTRAL vocabulary, not Pro's — a new kind that forgets reads as generic,
  never as SWE-bench. Guard suite 20/20.
- The guard hook itself never carried Pro vocabulary (checked, not assumed) —
  its rules are structural, so only the Skill needed the treatment.
- Review is advisory: a REQUEST CHANGES verdict is recorded, not acted on
  (no re-execute loop — matching the console's fixed flow, where senior
  review feeds the report rather than gating delivery).
- Two tasks (`kudos-wall`, `uptime-ping`); the corpus grows by adding
  `tasks/<id>/` directories, no code changes. `tasks.test.mjs` walks the
  corpus offline and re-checks every launch-time rule — brief hash pin,
  template/scaffold agreement, executor coverage — so a corpus mistake costs
  milliseconds in `pnpm test` instead of surfacing after the container is up
  and the first phase is already billed.
- `uptime-ping` carries a recorded ambiguity (`known_ambiguity` in its
  task.json): the brief asks for `GET /health`, which the chassis already
  owns at a sha256-pinned path the integrity gate makes a non-repairable
  failure to edit. The console leg met the same wall and answered it by
  adding a module instead. Both legs grade on build+test, so the run is
  gradeable either way — but a low judge score there is a property of the
  brief, not of the runtime, and must not be read as one.
- Template executor coverage is exactly the sdlc-mini set (`llm-task`,
  `verify`, `judge`, `report`); a template using other executors fails
  loudly at load.
