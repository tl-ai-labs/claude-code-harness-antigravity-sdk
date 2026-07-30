# Next steps — Sriram

> **Internal maintainer notes. Delete this file before pushing to the Google-facing repo.**

## What this is

You are looking at the `google-deliverable` branch, produced in a working
session with Ravi on 2026-07-30. The branch reshapes this repo into a
customer-engineer-facing deliverable modeled on
[`ai-study-workforce-ops`](https://github.com/tl-ai-labs/ai-sdlc-orchestrator-claude-code-harness):
customer collateral (LICENSE / NOTICE / SECURITY / CONTRIBUTING / CoC /
CHANGELOG / CLAUDE.md), workloads under `examples/`, seven focused docs
under `docs/`, a rewritten 168-line README, and a three-mode setup
wizard at `tools/setup.mjs`.

Six commits on the branch, log at bottom of this file. All 290 offline
tests pass. `--dry-run` against `examples/kudos-wall` on every shipped
policy resolves cleanly.

**Ravi asked that you take one final pass before this goes to Google.**
Three concrete items are below, plus a self-runnable verification
checklist. Nothing in this branch is blocking on you — the deliverable
is functional as-is — but the three items would bring the wizard into
closer alignment with the reference repo and reduce first-run friction.

---

## Change 1 — Wizard: fail-fast per critical prereq

### Genesis

Ravi compared this repo's `tools/setup.mjs` to the reference repo's
`tools/setup.mjs` on 2026-07-30 and asked me to match the reference's
failure model. Current wizard runs every check then summarizes at the
end; the reference wizard exits immediately on the first critical
failure (Node version wrong, Claude CLI missing, MCP server build
failed).

Reasoning to preserve: for the smaller prereq surface of the reference
repo, fail-fast is clearer. For the larger surface here, run-all-then-
summarize was chosen so a user sees every missing prereq at once —
Ravi accepts this trade differently now.

### What to change

In [tools/setup.mjs](tools/setup.mjs), the `runChecks()` loop should
short-circuit on failure of any check marked *critical*. Suggested
partition:

- **Critical (fail-fast, exit 1 immediately)** — `checkNode`,
  `checkPnpm`, `checkOfflineTests`, `checkClaudeCli` (in SDLC/SWE-Pro
  modes), `checkPython` (in SDLC/SWE-Pro modes).
- **Non-critical (run-all-then-summarize)** — `checkAnthropicAuth`,
  `checkGoogleProject`, `checkGoogleLocation`, `checkDocker`,
  `checkVertexAdc`. See change 3 below for why these stay in the
  summary batch rather than being fail-fast.

Concretely, add an `{ ok, label, detail?, fix?, critical?: boolean }`
shape to each check's return and gate the loop's continuation on
`if (!r.ok && r.critical) { console.log("Fix the above and re-run."); process.exit(1); }`.

### Reference implementation

Read [ai-study-workforce-ops/tools/setup.mjs](https://github.com/tl-ai-labs/ai-sdlc-orchestrator-claude-code-harness/blob/main/tools/setup.mjs)
lines 52–76 for the pattern. Lines 52–60 fail-fast on Node; lines
62–76 fail-fast on Claude CLI with an y/N escape hatch.

---

## Change 2 — Wizard: active install (no y/N prompt) for what the harness needs to function

### Genesis

Ravi compared the reference wizard's `step(4)` and `step(5)` (which
actively `npm install` + `npm run build` the MCP server and copy the
slash command + subagents into `./.claude/` without asking) to mine
(which asks y/N before creating the worker venv or cloning the Scale
evaluator). Reference wizard just does the work; mine hedges.

Reasoning to preserve: reference's actions are within-repo (small
dependencies, deterministic files); mine reach outside the repo
(171 MB pip install, git clone of a third-party repo, second Python
venv). Opt-in was cautious. Ravi wants the reference's ergonomics —
if the user ran `--sdlc`, they've asked for the SDLC profile, and the
worker venv IS the SDLC profile.

### What to change

In [tools/setup.mjs](tools/setup.mjs):

- **`offerCreateWorkerVenv()`** — remove the y/N prompt. On `--sdlc`
  or `--swe-pro`, always create the venv and install
  `google-antigravity` if missing. Print a one-line progress message
  ("Creating worker venv…") so the user knows what's happening. Keep
  the headless-mode skip (a no-TTY invocation is a diagnostic and
  should not silently install 171 MB).
- **`offerCloneSweEvaluator()`** — same treatment on `--swe-pro`:
  clone at pinned SHA without asking, print progress. Keep the
  headless skip.
- **`offerCreateSweGradingVenv()`** — same.

The `--offline` profile stays check-only (no active install beyond
`pnpm install`, which the reference wizard also does without asking
via `pnpm install --silent`).

Also worth doing while you're in there: promote `pnpm install` from
inside `checkOfflineTests()` up to a separate step so its progress is
visible independently. Reference wizard does this at step 4.

### Reference implementation

Reference [`tools/setup.mjs`](https://github.com/tl-ai-labs/ai-sdlc-orchestrator-claude-code-harness/blob/main/tools/setup.mjs)
lines 98–115 for the MCP server auto-install pattern.

---

## Change 3 — Wizard: auth as informational, not blocking (SDLC mode)

### Genesis

Reference wizard treats `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` as
informational (step 3, lines 82–96): reports whether each is set,
prints where to get one, does not block. Mine treats missing Anthropic
auth as a hard fail on `--sdlc`.

Reasoning to preserve: reference has a `--auth=vendor|estimated`
toggle per invocation, so missing `ANTHROPIC_API_KEY` is genuinely fine
in estimator mode. This repo has no estimator mode — the CLI always
bills. Blocking was correct given that difference. Ravi wants the
reference's informational pattern anyway, because
`run-harness.mjs`'s preflight already gates on auth at $0 before any
spend — the wizard doesn't need to duplicate that gate.

### What to change

In [tools/setup.mjs](tools/setup.mjs):

- **`checkAnthropicAuth`** — return `{ ok: true, label: "…", detail:
  "will fail preflight until set — see docs/setup.md" }` when neither
  env var is set, instead of `{ ok: false }`. Print the export command
  as a hint, not a fix. Same treatment for `checkGoogleProject` and
  `checkGoogleLocation`.
- The wizard's exit code should be 0 if all *critical* checks pass,
  even if these informational checks report missing credentials.
- Keep `checkVertexAdc`, `checkDocker`, `checkWorkerVenvExists`,
  `checkAntigravityImport` as blocking on `--sdlc` — those are things
  the wizard is *actively provisioning* (change 2), so failure after
  provisioning is a real error, not a missing user config.

### Rationale worth preserving in the code comment

The wizard is not the auth gate. `run-harness.mjs`'s preflight is the
auth gate — it runs on a real launch, at $0, and exits `2` with a named
cause. Duplicating that gate in the wizard just means a user without
credentials cannot run the wizard to *check what else they need*.

---

## Self-runnable verification checklist

Ravi's ask: "ensure this is self-runnable before sharing with Google."
Run these on a **fresh clone** on a **fresh machine**, or the closest
approximation.

### Zero-credential path

- [ ] `git clone <repo> && cd claude-code-harness-antigravity-sdk`
- [ ] `node tools/setup.mjs --offline` — all green, exits 0
- [ ] `node tools/harness-matrix/run-harness.mjs --task-dir examples/kudos-wall --runtime claude-code --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml --dry-run` — prints the header frame, exits 0
- [ ] `pnpm test` — 290 tests pass

### SDLC live path

- [ ] `node tools/setup.mjs --sdlc` (with the three changes above applied):
  auto-creates the worker venv, auto-installs `google-antigravity`,
  informationally reports Anthropic auth / GCP project / Docker if
  missing, exits 0 if critical checks pass.
- [ ] Set `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`),
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, start Docker.
- [ ] `node tools/harness-matrix/run-harness.mjs --task-dir examples/kudos-wall --runtime claude-code --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml`
  — completes, ~$3–4, 20–30 min.
- [ ] Read the resulting `manifest.json` and one `worker-task-*.md` from
  `evidence-bundle/delegation/`. Confirm the shape matches
  [docs/understanding-output.md](docs/understanding-output.md).

### SWE-bench Pro path

- [ ] `node tools/setup.mjs --swe-pro` — with change 2, auto-clones
  Scale evaluator at pinned SHA and auto-creates grading venv.
- [ ] `node tools/swe/fetch-instances-pro.mjs --ids navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a`
- [ ] `node tools/harness-matrix/run-harness.mjs --instance-dir studies/swe-pro-corpus/navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a --runtime claude-code --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml`
  — completes, ~$2, 15–40 min.

### Docs accuracy

- [ ] Every code fence in [README.md](README.md) runs on a fresh clone (or
  runs after its listed prereqs).
- [ ] Every path referenced in [docs/setup.md](docs/setup.md) exists on a
  fresh clone.
- [ ] The env-var table in [docs/setup.md](docs/setup.md) §4 matches the
  actual variables `runtimes.mjs` and `gemini_worker.py` read at
  runtime. Grep both files if unsure.
- [ ] The policy table in [docs/policies.md](docs/policies.md) matches
  the actual YAML files under `tools/harness-matrix/policies/`.

### Third-party read

- [ ] Ask one Tilicho engineer who is **not** you and **not** Ravi to
  follow README quickstart through `--offline` and `--dry-run`
  unassisted, on their own machine. If they get stuck, that's the
  failure mode Google will hit — fix before shipping.

---

## Before pushing to the Google-facing repo

- [ ] All three changes above applied (or explicitly deferred with a
  ticket you own).
- [ ] Self-runnable checklist all green.
- [ ] `git rm NEXT_STEPS.md && git commit -m "Remove maintainer notes"`
  — this file is internal.
- [ ] Merge `google-deliverable` into `main` with a fast-forward
  (`git checkout main && git merge --ff-only google-deliverable`), or
  push `google-deliverable` as a PR for a second review before merge.
- [ ] Push. If the destination is a new Google-facing repo (not this
  one), also update `homepage` in `package.json` and any GitHub URL in
  README.

---

## Reference — the six commits that produced this branch

```
2a866bc  Add tools/setup.mjs — three-mode setup wizard
d721e25  Rewrite README as a customer-engineer on-ramp
4ea6337  Split the 80KB README into seven focused docs
4f8a93b  Reshape workloads into examples/, one exemplar per workload
5cc73a5  Add customer-facing collateral: LICENSE, NOTICE, SECURITY, CONTRIBUTING, CoC, CLAUDE, CHANGELOG
77e2be0  Drop internal design and debate documents from the deliverable
```

Read the commit messages top-to-bottom for the story of the reshape.
Each was written to stand alone as a review-friendly diff.
