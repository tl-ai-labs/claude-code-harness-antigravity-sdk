# Evidence bundle — kudos-wall (SDLC)

Cell: `claude-code--opus-4.8-plus-gemini-3.5-flash-lite` · run `2026-07-31T09-54-42` · **PASS**

A greenfield build: one brief in, one working tree out, graded by re-running
the scaffold's own build and tests in the pinned container.

## What's here

| Path | What it is |
| --- | --- |
| `model.diff` | the delivered tree, as a diff against the untouched scaffold |
| `raw.diff` | the same diff before artefact stripping |
| `grade-verdict.json` | build exit, test counts, judge scores — the one-line fold |
| `trajectory/` | every driver turn, stderr stream and stage gate log |
| `delegation/` | each worker hand-off: the task it was given, the tokens it billed |
| `delegation/lint.json` | the content lint re-run over those hand-offs — which ones, if any, dictated content rather than specifying an outcome |
| `phase-io/` | requirements, design, packets, execute, review, judge + the build/test logs and the container launcher |
| `manifest.json` | run identity, brief/template/policy hashes, cost and token totals |
| `audit.json` | post-run intent audit |

## Re-verify yourself

1. Start from the scaffold this run started from: `scaffolds/service-web`
   at v0.2.0 (template `sdlc-mini` v0.8.0,
   sha256 `7627f4df57abe882c6799e8805f0c69469ff2d63aa35f2e8b23526691cb7a7c7`).

2. Apply `model.diff` to it.

3. Re-run the same build and tests the grader ran, in the same image:

```bash
# phase-io/run-in-env.sh is the exact launcher this run used
./run-in-env.sh "pnpm install --frozen-lockfile && pnpm build && pnpm test"
```

4. Compare against `grade-verdict.json`:
   build exit `0`, tests
   `14/14` passed with `0` failed.
   Those numbers are mechanical. The judge scores next to them are not —
   see integrity-notes.md.

5. Audit the run itself: trajectory/ is the unedited turn log, delegation/ is
   every worker hand-off with its token counts, and integrity-notes.md lists
   what is enforced in code and what is deliberately not claimed.

File hashes: MANIFEST.sha256