# Setup

Three profiles, three amounts of setup. Pick the one that matches what you
want to do — nothing above what you need is required.

| Profile | What it lets you do | Prereqs |
|---|---|---|
| **Offline** | Read the code, run the offline test suite, dry-run any policy without spending | Node ≥ 22, pnpm ≥ 11 |
| **SDLC live** | Run a delegated SDLC workload end-to-end against a fresh scaffold | Offline + Claude Code CLI + Anthropic auth + Python venv + Google Cloud ADC + Docker |
| **SWE-bench Pro** | Fetch Scale AI's public corpus, run a real bug fix, grade with Scale's official evaluator | SDLC live + Scale evaluator clone at a pinned SHA + ~30 GB free disk |

The setup wizard at [tools/setup.mjs](../tools/setup.mjs) automates most of
this. Reading this file lets you set the same things up by hand, and
troubleshoot when the wizard fails.

## Offline profile

```bash
git clone <this-repo>
cd claude-code-harness-antigravity-sdk
pnpm install && pnpm build && pnpm test
```

The suite takes under 10 seconds and touches no network. **Zero failures is
the bar, not zero skips** — a handful of suites assert against recorded runs
and against a SWE-bench Pro corpus checkout, neither of which ships in a
clone, so they skip themselves and say so in the summary line. That is the
designed behaviour on a fresh machine. If anything *fails*, do not proceed —
file an issue.

Dry-run the plumbing without spending:

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml \
  --dry-run
```

`--dry-run` exits before preflight — no credential, no Docker, no corpus
required. If the header frame prints and the exit code is `0`, the offline
profile is complete.

## SDLC live profile

You need **two independent credentials**. They bill separately and neither
is needed for the offline profile.

### 1. The driver — Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Set **exactly one** of:

| Variable | What it is | Bills |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | A Claude Code subscription seat's OAuth token | Your subscription's quota |
| `ANTHROPIC_API_KEY` | A metered Anthropic API key | Your API wallet, per token |

If both are set, the CLI's own precedence picks one — so set the one you
mean to pay from and unset the other.

### 2. The worker — Gemini through the Antigravity SDK on Vertex AI

**a. Build the venv** (Python **≥ 3.10**):

```bash
python3 -m venv tools/harness-matrix/sdk-probe/sdkprobe
tools/harness-matrix/sdk-probe/sdkprobe/bin/pip install google-antigravity
```

Verified against `google-antigravity 0.1.7`.

*Homebrew Python users:* if the venv cannot `import pyexpat`, run
`brew install expat`. The worker defaults `GEMINI_WORKER_DYLD` to
`/opt/homebrew/opt/expat/lib`.

**b. Authenticate to Vertex** — Application Default Credentials:

```bash
gcloud auth application-default login
```

Or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON.

**c. Point it at YOUR project.** This step is the one most likely to be
missed. The worker reads `GOOGLE_CLOUD_PROJECT` from the environment and
has **no default** — unset, it exits before spending anything and tells
you so. That is deliberate: a fallback project would either fail with a
permission error naming something you have never heard of, or, worse,
bill an account that is not yours.

```bash
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id
export GOOGLE_CLOUD_LOCATION=asia-south1
```

That project needs the **Vertex AI API enabled** and quota in the region
you pin, for the model your policy's worker leaf names —
`gemini-3.5-flash` for the three headline policies, `gemini-2.5-flash` for
the older-generation column, both for the tiered one. See
[policies.md](policies.md) for the mapping.

`asia-south1` is the region the recorded runs pinned; the global endpoint
was quota-starved on 2026-07-16 and cost this project 3 hours. Never leave
a Vertex call unregioned.

### 3. Docker

Every command a run executes — the model's builds, its tests, and the
grading gates — runs inside a container. Both kinds check for a working
daemon in preflight and exit `2` if it is absent.

| Kind | Image | Built |
|---|---|---|
| **SDLC** | `Dockerfile.sdlc` — one shared `node:22-bookworm` toolchain image | Once, then fully cached. Each run also creates a per-run `node_modules` volume. |
| **SWE-bench Pro** | Per instance, on top of Scale's frozen base image | Once per instance. Budget ~30 GB. |

Docker holds several gigabytes of RAM while running. On a machine with
8 GB or less, run one workload at a time — never concurrent runs.

### 4. Environment variables — complete table

| Variable | Default | When you need it |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Driver auth (subscription seat). This or the next, not both. |
| `ANTHROPIC_API_KEY` | — | Driver auth (metered API). |
| `GOOGLE_CLOUD_PROJECT` | — (no default, by design) | **Always set.** The worker exits with an explanation rather than guessing a project. |
| `GOOGLE_CLOUD_LOCATION` | `asia-south1` | Override only if your quota lives elsewhere. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Alternative to `gcloud auth application-default login`. |
| `GEMINI_WORKER_PYTHON` | `tools/harness-matrix/sdk-probe/sdkprobe/bin/python` | If your venv lives elsewhere. |
| `GEMINI_WORKER_DYLD` | `/opt/homebrew/opt/expat/lib` | The Homebrew `pyexpat` workaround. |
| `NO_COLOR` | — | Suppresses ANSI colour in the run log. Colour already switches itself off when stdout is not a TTY, so you only need this when capturing a log through something that reports itself as one. |

That is the complete set the code reads — grep for `process.env.` under
`tools/` and `os.environ` under `tools/harness-matrix/*.py` to confirm.
Nothing else is consulted, and the only values baked into the repository are
the ones spelled out in the Default column — a region pin and two local
paths. No credential and no account identifier has a default.

### 5. Preflight verifies all of this at $0

Before any spend, `run-harness.mjs` on a real launch verifies: the driver
credential is present · the `claude` CLI runs · the policy has a binding
for this runtime — and, for a delegated cell only · the worker
interpreter exists · it can `import google.antigravity` · Vertex ADC is
on disk. The kind then checks the Docker daemon. Any failure exits `2`
with a message naming the fix.

Preflight runs on a real launch only. `--dry-run` returns before it — so
a dry run works on a machine with no credentials at all.

## SWE-bench Pro profile

Everything above, plus Scale AI's evaluator and roughly 30 GB of free
disk. See [swe-bench-pro.md](swe-bench-pro.md) for the details — the
clone path is hard-coded and the grading venv path is hard-coded, so
read that page before you clone.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `claude-code preflight: set CLAUDE_CODE_OAUTH_TOKEN (Max) or ANTHROPIC_API_KEY` | Neither driver credential is set | Export one; check both are not simultaneously set |
| `worker preflight: cannot import google.antigravity` | Venv missing or on wrong Python | Rebuild the venv per §2.a, or set `GEMINI_WORKER_PYTHON` |
| `worker preflight: no Application Default Credentials` | ADC never ran or expired | `gcloud auth application-default login` |
| `PERMISSION_DENIED: Vertex AI API has not been used in project X` | Project id is wrong, or the API is disabled | Set `GOOGLE_CLOUD_PROJECT` to a project where you have enabled Vertex AI |
| `DEADLINE_EXCEEDED` or quota errors from Vertex | Region has no quota for the model | Pin `GOOGLE_CLOUD_LOCATION` to a region where you have quota |
| `docker: Cannot connect to the Docker daemon` | Docker Desktop not running | Start Docker |
| Homebrew Python venv fails to `import pyexpat` | Missing system expat | `brew install expat` (the default `GEMINI_WORKER_DYLD` picks it up) |
