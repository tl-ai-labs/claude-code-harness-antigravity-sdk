# Architecture

How the harness is put together, and what actually happens in code during
one run. Read this before you change a file under
`tools/harness-matrix/`, or when you need to explain the design to
someone who is not going to run it.

Four things are deliberately **not** here, because they already have a
home:

| Question | Page |
|---|---|
| Which file holds what? | [../tools/harness-matrix/README.md](../tools/harness-matrix/README.md) — the file-by-file map |
| What do the results actually claim? | [methodology.md](methodology.md) |
| What does a run write to disk? | [understanding-output.md](understanding-output.md) |
| What can the Antigravity SDK do? | [antigravity-sdk.md](antigravity-sdk.md) |

## The four-way split

One run is one **kind** × one **runtime** × one **policy**, assembled by
the **engine**. Each layer knows as little as possible about the others,
and the boundaries are load-bearing rather than tidy:

| Layer | Code | Owns | Deliberately does not know |
|---|---|---|---|
| **Engine** | [run-harness.mjs](../tools/harness-matrix/run-harness.mjs) | Argument parsing, kind selection, handing over | How either benchmark works. The whole file is ~130 lines and its last act is `await kind.run(...)` — the only kind-specific things in it are which descriptor file to check for and which module to import |
| **Kind** | [kinds/swepro.mjs](../tools/harness-matrix/kinds/swepro.mjs), [kinds/sdlc.mjs](../tools/harness-matrix/kinds/sdlc.mjs) | The recipe: stage order, prompts, gates, retries, container, grading | Which model is running, or how a phase is executed |
| **Runtime** | [runtimes.mjs](../tools/harness-matrix/runtimes.mjs) | The inside of one phase: launch the agent process, enforce the delegated contract, return telemetry | The stage sequence, the gates, whether it is Pro or SDLC |
| **Policy** | [policies/*.yaml](../tools/harness-matrix/policies/) + `packages/policy/core/policy-core.mjs` | Which model on which stage, thinking level, retries, timeouts, budgets | Everything else |

Shared kind machinery — anything that must be *identical* between Pro and
SDLC or the comparison is void — lives in
[kinds/lib.mjs](../tools/harness-matrix/kinds/lib.mjs): policy loading,
the attempt loop, cost aggregation, diff computation, the banner and
footer frames.

### Why the script owns the loop

This is the single most consequential decision in the repository, and it
is the reason the numbers mean anything.

The kind script — not the agent — decides what runs, in what order, and
what counts as passing. The runtime only decides what happens *inside* a
phase: which files to read, what commands to run, how to edit. So the
procedure is held byte-identical across runtimes and policies, and a
difference in outcome reads as a model effect rather than as procedural
drift. If the agent chose its own stage sequence, an `all-opus` run and a
delegated run would not be running the same experiment.

Two consequences worth internalising before changing anything:

- **Phase calls are stateless.** Each phase is a fresh `claude -p`
  invocation. Nothing carries over in the model's head. Everything a
  later phase needs — the reproduction contract, the localization, the
  baseline exit code — is injected by the harness into the prompt as
  text. That is what makes context byte-identical across runtimes; it is
  also why "just let it remember" is not an available shortcut.
- **Every repository command runs inside the kind's container**, through
  the generated `out/run-in-env.sh`. The agent's commands and the gates'
  commands go through the same door. A gate that ran on the host would be
  measuring a different machine than the one the agent worked on.

## Life of one run

Following a single invocation end to end.

**1. Engine: parse and dispatch.**
[run-harness.mjs](../tools/harness-matrix/run-harness.mjs) reads
`--instance-dir` **or** `--task-dir` (mutually exclusive — one run is one
kind), `--runtime`, `--policy`, and the three optional flags
(`--dry-run`, `--skip-grade`, `--cleanup-images`). The input directory
*names* the kind; there is no `--kind` flag.

**2. Engine: prove the selector before spending anything.** Each kind
opens a descriptor file as its first act — `instance.json` for Pro,
`task.json` for SDLC. The engine checks for it up front so that pointing
`--instance-dir` at the wrong directory produces a sentence explaining
the difference between a corpus entry and the workload documentation,
and exits **2** (usage/preflight — nothing spent) rather than **1**
(infrastructure error) with a Node stack trace.

**3. Engine: import only the selected kind.** The import is dynamic, not
a pair of static imports at the top: the Pro kind statically depends on
`packages/swe-bench/dist`, and an SDLC-only machine must still be able to
run SDLC without that build. Then `kind.run({dir, runtimeName, runtime,
policyPath, dryRun, skipGrade, cleanupImages})` — and the engine is done.

**4. Kind: validate, then preflight at `$0`.** The kind validates its
descriptor (Pro checks the sealed fields; SDLC checks `task.json`, the
brief's pinned sha256, and `template.yaml`), loads the policy, and runs
every check that can fail *before* any money is spent: the runtime's own
preflight, `docker version`, and — for Pro, unless `--skip-grade` — the
grading venv, the Scale evaluator clone, and `sealed.json`. `--dry-run`
stops here, after printing the byte-identical opening frame a live run
would print (only `runtime` and `started` differ).

How deep the runtime preflight goes depends on the policy: a delegated
binding additionally checks the worker venv, `import google.antigravity`,
and Vertex ADC. Both kinds pick that binding with `preflightBinding()` —
the **first delegated stage**, not the first stage — so a tiered policy
whose early stages are solo still has its worker leg checked at `$0`
rather than at the first delegated stage, after spend.

**5. Kind: provision the workspace.** Pro builds the sealed instance
image and extracts the repository from it; SDLC copies the scaffold,
`git init`s it, installs dependencies, and proves the pristine tree
builds and tests green. Both end with a git tag that is the diff anchor
for the rest of the run (`sealed-base`, `scaffold-base`).

**6. Kind: the stage loop.** For each stage, the kind resolves the
policy's binding for that stage, prints a banner stating the gate
*before* the attempts run, then calls `runStageAttempts` from
[kinds/lib.mjs](../tools/harness-matrix/kinds/lib.mjs) with four
callbacks: `buildPrompt`, `gate`, `beforeRetry`, and the delegation
vocabulary. That function is the heart of the harness:

- it calls `runtime.runPhase(...)`, then the gate;
- on failure it quotes the gate's reason **verbatim** into the retry
  prompt, so the agent is told exactly what the harness objected to;
- `beforeRetry` resets the tree and deletes the stale contract file, so a
  previous attempt's output cannot satisfy this attempt's gate;
- it verifies the model the CLI actually resolved against the policy pin
  and warns loudly (non-fatally) on a mismatch;
- and on a delegated binding it applies the honesty rule: **an attempt
  with zero delegations is failed**, with a reason saying the driver
  worked alone. A phase that produces a perfect patch without ever
  calling the worker is not a worker result.

**7. Kind: finish.** Compute the diff against the anchor tag, write the
artifacts, run the post-run audit over the recorded trajectory, write the
manifest, print the footer, and grade. Exit **0** whether or not the task
was resolved — the verdict lives in `grade-verdict.json`, not in the exit
code. Exit codes are for the *harness's* health, not the agent's.

## Where the Antigravity SDK cable is soldered

Exactly one place: the delegated branch of `runPhase` in
[runtimes.mjs](../tools/harness-matrix/runtimes.mjs).

A binding in a policy is either a plain string (`claude-opus-4-8`) or an
object (`{driver, worker, worker_thinking?, worker_region?}`). The two
optional worker keys are omitted rather than nulled when the policy does
not declare them. `isDelegatedBinding` is that one-line test,
and everything downstream keys off it. On the `all-opus` policy the
binding is a string, so **no SDK code runs at all** — worth remembering
when someone reports that the anchor policy "proves the connector
works". It does not; it proves nothing about the connector.

On a delegated binding, `runPhase` does five things before launching the
driver:

1. **Renders the `gemini-worker` Skill** (`renderWorkerSkill`) into a
   per-run `CLAUDE_CONFIG_DIR`. Never into the workdir — the workdir is
   the diff anchor, and a skill file sitting in it would show up in the
   graded patch. The Skill is where the driver learns the exact command
   line to invoke the worker with, and the rules it must follow
   (hand over the problem, not the solution; re-delegate with evidence,
   never with a remedy).
2. **Namespaces every worker file to this phase-attempt** via a `slot`
   like `repro-a2`. Each phase is a fresh process, so the driver always
   restarts its "fresh integer N" at 1; without the slot, the next
   phase's `worker-usage-1.json` would overwrite this phase's, and a
   failed zero-delegation attempt would read back the previous phase's
   leftover receipt as its own.
3. **Splits the phase clock 60/40** (`workerTimeoutMin`). One worker call
   may consume 60% of the phase budget, clamped to strictly less than the
   phase itself. A driver whose worker ate the whole phase has no runway
   left to verify the result, re-delegate, or write the contract file the
   gate demands — so the attempt would fail for lack of time rather than
   lack of capability, and the manifest could not tell those two apart.
   The driver's Bash timeout is raised to the worker's slice plus two
   minutes, so the shell does not kill the delegation it just authorised.
4. **Writes the PreToolUse guard** (`renderTreeWriteHook`) and a
   `--settings` file registering it for `Bash`, `Read`, and
   `Grep`/`Glob`.
5. **Launches `claude -p`** with `Edit`, `Write`, `NotebookEdit` and
   `MultiEdit` appended to the always-off `--disallowedTools` list
   (`WebFetch`, `WebSearch`, `Task`).

The driver then does the work by shelling out, once per delegated task,
to [gemini_worker.py](../tools/harness-matrix/gemini_worker.py) — a
faithful port of the probe that ran live on Vertex. That script builds a
`LocalAgentConfig` over a `VertexEndpoint`, grants
`policies=[policy.allow_all()]`, runs the agent loop inside the workdir,
prints the reply on stdout for the driver to read, and writes a
`worker-usage-<slot>-N.json` sidecar carrying the resolved model, the
thinking level, the raw `UsageMetadata` token counts, the SDK version,
and the Vertex project and region. It deliberately computes **no dollar
figure** — token counts are recorded raw and priced downstream against
verified rates, so a stale constant in the worker can never quietly
misprice a study.

After the phase returns, `countDelegations(logFile)` reads the
trajectory for worker invocations and `readWorkerUsage(outDir,
logPrefix)` collects this attempt's sidecars. Those two numbers are what
the honesty rule in step 6 above tests, and what the manifest reports.

The registry in `runtimes.mjs` has exactly one entry, `claude-code`, and
a long comment where a second one would go explaining that the two empty
cells of the 2×2 are not the same kind of empty. See
[antigravity-sdk.md](antigravity-sdk.md#what-this-leaves-for-the-matrix).

## The delegated cell's enforcement, structurally

Three layers, one predicate. The full argument — what is and is not being
claimed — is in [methodology.md](methodology.md); what follows is only
where each layer lives and why there are three.

- **Tool removal** happens at process launch and is absolute, but leaves
  one residual write channel: Bash.
- **The PreToolUse guard** closes that channel in real time, and adds a
  second rule the tool list cannot express — a *delegate-first lock*.
  Until the attempt's first real `gemini_worker.py` call, workdir reads,
  repo-inspecting Bash, and repo-targeting `Grep`/`Glob` are all denied,
  because a driver that does the analysis itself and then uses the worker
  as a rubber stamp passes every write check. The delegation command
  itself is always allowed and touches a per-attempt sentinel file; after
  that the repository unlocks for verification.
- **The post-run audit** re-checks the recorded trajectory afterwards, in
  three families: git-history mining and source-host fetching (both
  critical) and test-edit attempts (non-critical).

All three import the *same* classifier functions —
`bashEditsTree`, `bashInspectsRepo`, `searchTargetsRepo`,
`stripHeredocs` — from
[audit.mjs](../tools/harness-matrix/audit.mjs). The generated guard
script imports them at runtime rather than reimplementing them, so the
live block and the post-run flag cannot drift apart. Likewise the guard's
denial wording is spliced in from two exported constants that the audit
greps for, because an ordinary failing command and a blocked one are
otherwise indistinguishable in a transcript.

## The SWE-bench Pro leg, in code

[kinds/swepro.mjs](../tools/harness-matrix/kinds/swepro.mjs). Three
phases, `repro → localize → patch`, against a sealed instance image.
Setup detail is in [swe-bench-pro.md](swe-bench-pro.md); this is the
control flow.

**The sealed workspace.** The kind builds an image from the Scale base
image with the source hosts nulled *inside the container*, creates a
container from it, and `docker cp`s the repository out as a plain
directory carrying a one-commit `.git` and the `sealed-base` tag. Four
integrity checks then run on the extracted tree, and any failure aborts
before a token is spent: the `sealed-base` tag resolves, `git remote` is
empty, `git rev-list --count HEAD` is exactly `1`, and `git status
--porcelain` is clean. Together they establish that the agent cannot
reach the upstream fix — not by fetching it, and not by reading it out of
the local history.

**REPRO** — the agent must author a failing reproduction. The gate reads
`repro.json` (`{command, files}`), requires every declared file to be a
plain repository-relative path whose name contains `harness_repro`, and
requires the phase to have changed *nothing else* — the declared files
are also the restore snapshot, so completeness matters as much as
cleanliness. Then it runs the command: it must exit non-zero on the
unfixed code, and must not hang (a hanging reproduction would poison the
patch gate). On success the repro files are snapshotted into the out dir.

**LOCALIZE** — read-only. The gate reads `localize.json`
(`{bug_files, test_command}`), rejects any `bug_files` entry that is a
test or repro path (the whole point is naming the non-test source the fix
must touch), rejects a `test_command` that targets the reproduction
instead of the pre-existing suite, and fails if any repository file
changed beyond the repro files. Then it records a baseline by running
that suite **with the repro files held out of the tree**, so a
package-scoped command does not accidentally include the agent's own new
failing test. A red baseline is allowed and recorded; a timeout is not,
because "scope it tightly" is cheapest to enforce here.

**PATCH** — three gates in sequence. First, a non-test source change must
exist: the diff is computed against `sealed-base` with test paths and
`harness_repro` paths stripped, and an empty remainder fails. Second, the
fail-to-pass flip: the reproduction command must now exit 0. Third, the
surrounding suite must be no worse than baseline — and because an exit
code cannot count per-test failures across four languages, a baseline
that was already red *waives* this gate with a recorded warning rather
than failing it.

**Finish.** `raw.diff` and `model.diff` are written, `predictions.jsonl`
records the run under `harness-matrix+<runtime>+<policy>`, the audit runs
over the trajectory, and Scale's official evaluator grades the model
patch. Deleting the built images is opt-in (`--cleanup-images`) and never
the default — whether disk is worth more than a rebuild is a property of
the machine, not of the study.

## The SDLC leg, and how it differs

[kinds/sdlc.mjs](../tools/harness-matrix/kinds/sdlc.mjs). Same spine,
three real differences.

**The stage list is data, not code.** Pro hardcodes three phases; SDLC
reads its stages from `templates/sdlc-mini/template.yaml` and validates
them (known executor kinds, a scaffold that matches, `repair.max_rounds`
in 0..5). The delegated stages are the `llm-task` and judge stages in
template order. Adding a stage is a template edit, not a code change.

**The chassis is not the deliverable.** The agent may only write inside
declared slots (`src/modules/`, `test/modules/`, plus the Prisma schema).
The verify stage hashes the chassis files and refuses to treat a chassis
change as repairable — if the pristine scaffold does not build and test
green before the agent starts, that is an infrastructure bug being
reported as one, not an agent result.

The hashes come from `scaffolds/<id>/scaffold.manifest.json`, and that
file is **derived, never hand-typed** — `scaffold-manifest.mjs` builds it
from the scaffold plus the slot list in `scaffold.json`. It has to be,
because the gate compares whole-file sha256s and therefore cannot tell a
model rewriting the build config from a human rewording a comment in it.
Both surface at the last stage of a paid run, as `content changed`, worded
as an accusation against the model. That is not hypothetical: on
2026-07-31 a comment-only edit to `pnpm-workspace.yaml` failed every SDLC
run for a day. **If you edit anything in a scaffold outside the slots,
re-stamp the manifest in the same commit:**

```bash
node tools/harness-matrix/scaffold-manifest.mjs --write
```

`--check` (the default) reports drift and exits 1; `scaffold-manifest.test.mjs`
runs that check on every `pnpm test`, so forgetting costs a red test in
milliseconds instead of a run.

**Repair rounds are part of the recipe.** Where Pro retries a whole
phase, SDLC's verify stage feeds the real failing build or test output
back under the execute binding for a bounded number of rounds, then
commits and tags `verified-tree` as the read-only anchor the review and
judge stages read. Those later stages cannot change what they are
judging.

## Changing things

| You want to… | Start at |
|---|---|
| Add or retune a model choice | a YAML in `policies/` — see [policies.md](policies.md) |
| Change what a stage asks for | the matching file in `tools/harness-matrix/prompts/` |
| Change what counts as passing | the `gate*` functions in the kind |
| Add or reorder SDLC stages | `templates/sdlc-mini/template.yaml` |
| Change what counts as "writing into the tree" | `audit.mjs` — and both `guard.test.mjs` and `audit.test.mjs` will move with you, or fail |
| Add a second runtime | the `RUNTIMES` registry in `runtimes.mjs`, and read the comment at the bottom of that file first |
| Run any of it | [running.md](running.md) |
