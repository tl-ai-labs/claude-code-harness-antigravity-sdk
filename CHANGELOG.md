# Changelog

## Unreleased — Deliverable reshape

### Breaking

- **Layout: workloads moved under `examples/`.** `tools/harness-matrix/tasks/kudos-wall/` and `tools/harness-matrix/tasks/uptime-ping/` have moved to `examples/kudos-wall/` and `examples/uptime-ping/`. Update any `--task-dir` invocations:
  - was: `--task-dir tools/harness-matrix/tasks/kudos-wall`
  - now: `--task-dir examples/kudos-wall`
- **New top-level layout.** `docs/`, `examples/`, `LICENSE`, `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CLAUDE.md` added; internal design documents (`DESIGN.md`, `MANAGED-AGENTS.md`, `GOOGLE-*.md`, `IMPLEMENTATION-*.md`, `SDLC-RECIPE.md`) removed from the working tree (still recoverable from git history).
- **README rewritten** as a customer-engineer on-ramp. The prior 80KB operator manual is split into focused docs under [docs/](docs/).

### Added

- **`tools/setup.mjs`** — three-mode setup wizard (`--offline`, `--sdlc`, `--swe-pro`) that checks prerequisites, provisions the Antigravity SDK venv, and verifies credentials at `$0`.
- **Reference exemplar runs** — one representative pass per workload committed under `examples/<workload>/passes/reference/` so the output shape is discoverable without running.
- **[docs/](docs/)** — `setup.md`, `running.md`, `methodology.md`, `understanding-output.md`, `brief-template.md`, `policies.md`, `swe-bench-pro.md`.

### Unchanged

- The harness engine (`tools/harness-matrix/run-harness.mjs`, `runtimes.mjs`, `kinds/`, `gemini_worker.py`, the enforcement predicate shared by tool removal + pre-execution hook + post-run audit) is byte-identical to the pre-reshape version. New runs still write to `tools/harness-matrix/runs/<taskId>/<runtime>--<policy>/<stamp>/`.
- The four shipped policies (`all-opus`, `all-gemini-flash-high`, `all-gemini-25-flash-high`, `gemini35-plus-25-flash-high`) are unchanged.
- The 290 offline tests pass without credentials.
