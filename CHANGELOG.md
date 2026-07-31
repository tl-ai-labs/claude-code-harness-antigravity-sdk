# Changelog

## Unreleased — Deliverable reshape

### Breaking

- **Layout: workloads moved under `examples/`.** `tools/harness-matrix/tasks/kudos-wall/` and `tools/harness-matrix/tasks/uptime-ping/` have moved to `examples/kudos-wall/` and `examples/uptime-ping/`. Update any `--task-dir` invocations:
  - was: `--task-dir tools/harness-matrix/tasks/kudos-wall`
  - now: `--task-dir examples/kudos-wall`
- **New top-level layout.** `docs/`, `examples/`, `LICENSE`, `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CLAUDE.md` added; internal design documents (`DESIGN.md`, `MANAGED-AGENTS.md`, `GOOGLE-*.md`, `IMPLEMENTATION-*.md`, `SDLC-RECIPE.md`) removed from the working tree (still recoverable from git history).
- **README rewritten** as a customer-engineer on-ramp. The prior 80KB operator manual is split into focused docs under [docs/](docs/).
- **`GOOGLE_CLOUD_PROJECT` no longer has a default, and every Vertex entry point refuses to start without it.** It previously fell back to the Google Cloud project this harness was developed against — harmless internally, wrong in a published repo: a reader who forgot the export got a permission error naming a project they had never heard of, or, with the wrong access, quietly billed an account that was not theirs. `gemini_worker.py`, `sdk-probe/probe_vertex.py`, and `sdk-probe/probe_managed_agent.py` now exit with the fix before any token is spent, and the check sits above the SDK import so it fires without the worker venv built. `GOOGLE_CLOUD_LOCATION` is unaffected and keeps its `asia-south1` pin.

### Added

- **`tools/setup.mjs`** — three-mode setup wizard (`--offline`, `--sdlc`, `--swe-pro`) that checks prerequisites, provisions the Antigravity SDK venv, and verifies credentials at `$0`.
- **Reference exemplar runs** — one representative pass per workload committed under `examples/<workload>/passes/reference/` so the output shape is discoverable without running.
- **[docs/](docs/)** — `setup.md`, `running.md`, `methodology.md`, `understanding-output.md`, `brief-template.md`, `policies.md`, `swe-bench-pro.md`.
- **`tools/setup.test.mjs`, `tools/harness-matrix/worker-env.test.mjs`, and `tools/harness-matrix/run-harness.test.mjs`** — the wizard's fail-fast/auth contract, the Python side's configuration contract, and the CLI's argument contract. All three are offline and free. Reachable from `pnpm test` like every other suite.

### Changed

- **The dashboard export names the project and region from the run's own evidence.** Worker spend was priced at a hardcoded region and described as billing a hardcoded project. Both now come from each worker usage sidecar (`vertex_project`, `vertex_location`), so an export never asserts that someone else's project paid for your run, and a call served by the `global` endpoint is no longer charged the +10% non-global Vertex surcharge it never incurred. Region falls back to `asia-south1` only when a sidecar predates the field; an unrecorded project is reported as unrecorded, not guessed.
- **The setup wizard fails fast and installs rather than asking.** A failing toolchain check (Node, pnpm, workspace install, offline tests, Claude Code CLI, Python) now stops the run at the point of failure instead of printing a cascade of downstream failures that all really said "install Node 22"; `pnpm install` is its own labelled step; and missing Anthropic credentials are reported rather than treated as a failure, because `run-harness.mjs` preflights them at `$0` on a real launch anyway. `GOOGLE_CLOUD_PROJECT` is the one deliberate exception — nothing downstream can catch it now that there is no default.
- **The wizard reports skipped tests alongside passing ones.** Suites that need a recorded run or the SWE-bench Pro corpus skip themselves on a fresh clone; a bare pass count overstated what had actually been verified on that machine.
- **A kind selector that does not name a workload directory is now a usage error, not a stack trace.** `--instance-dir` and `--task-dir` are checked for the descriptor file their kind opens first (`instance.json`, `task.json`) before anything else happens; previously a wrong directory surfaced as a raw Node `ENOENT` trace from inside the kind module and exited `1` ("infrastructure error") for what is plainly a mistyped argument. The message now names the missing file and where workloads of that kind actually come from, and exits `2` ("nothing was spent"). This matters most for `--instance-dir`, where the intuitive guess — `examples/swe-bench-pro/`, the workload's documentation directory — is not an instance; instances are corpus entries under `studies/swe-pro-corpus/`.

### Unchanged

- **What a run does is byte-identical to the pre-reshape version.** The stage sequence, the gates, the retries, the enforcement predicate shared by tool removal + pre-execution hook + post-run audit, and the artifacts written are untouched (`kinds/`, `audit.mjs`, and the body of `runtimes.mjs`). New runs still write to `tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/`. The three files that did change, changed only in what happens before a run begins: `run-harness.mjs` gained the selector check above, `gemini_worker.py` gained the configuration preamble, and one `runtimes.mjs` preflight error stopped naming a specific Google Cloud project in its fix hint (both per the `GOOGLE_CLOUD_PROJECT` entry). The call shape, the policy grant, and the sidecar contract are as they were.
- The four shipped policies (`all-opus`, `all-gemini-flash-high`, `all-gemini-25-flash-high`, `gemini35-plus-25-flash-high`) are unchanged.
- The offline suite still passes with no credentials of any kind.
