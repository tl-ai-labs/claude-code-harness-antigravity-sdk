# swe-bench-pro — verified bug-fix reference workload

SWE-bench Pro is Scale AI's evaluation set of real bugs in real
repositories, each with a sealed Docker image, a hidden test set, and an
official evaluator. Under this harness, Claude Code (driver) delegates
REPRO → LOCALIZE → PATCH to Gemini through the Antigravity SDK; the
patch is graded by Scale's official evaluator run locally with the
network blocked.

Unlike [kudos-wall](../kudos-wall/), the workload is not stored in a
plain `--task-dir`. Each instance is a Scale-published corpus entry
fetched by `tools/swe/fetch-instances-pro.mjs` into
`studies/swe-pro-corpus/<instance-id>/`. See
[docs/swe-bench-pro.md](../../docs/swe-bench-pro.md) for the full
setup — the Scale evaluator, the pinned SHA, the ~30 GB disk budget,
and the single-container-at-a-time rule.

## Files

- [passes/navidrome/](passes/navidrome/) — a full committed set of
  driver→worker hand-offs and worker usage receipts from one real run
  against navidrome's `navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a`
  instance. A `claude-opus-4-6` driver × `gemini-3.5-flash` worker under
  the `all-gemini-flash-high` policy **as that policy stood in July 2026**
  — it has since been re-pinned to `gemini-3.5-flash-lite` at `global`,
  so the command below reproduces the *cell*, not this exact model pair.
  Not resolved on this attempt — the worker-task files show what the
  driver asked and the worker's usage receipts show what Gemini returned.
  Those receipts predate the `vertex_location` / `sdk_version` fields and
  carry neither; they are the one committed pass with no recorded
  provenance, which is why the pricing path has an explicit rule for it
  ([understanding-output.md](../../docs/understanding-output.md)).
- [passes/nodebb/](passes/nodebb/) — the same evidence set from one real
  run of the cost-tier policy (`opus-4.8-plus-gemini-3.5-flash-lite`: Claude Opus 4.8 driver,
  `gemini-3.5-flash-lite` worker, 2026-07-31) against the NodeBB
  `05f2236193f407cf8e2072757fbd6bb170bc13f0` instance. Not resolved on
  this attempt — all three phase gates passed and the patch applies, but
  it failed the held-out evaluator. One hand-off (the patch delegation);
  `lint.json` is the content lint re-run over it (zero passages flagged).
  Host paths are scrubbed to `/harness` (`scrub-paths.mjs`); everything
  else is verbatim from the run. The
  [evidence-bundle/](passes/nodebb/evidence-bundle/) subdirectory is the
  run's **full** scrubbed evidence bundle — trajectories, gate logs, phase
  I/O, both diffs, the grade tree, the recorded `audit.json`, and a
  regenerated `MANIFEST.sha256`. Read its `AUDIT-NOTE.md` first: the
  recorded audit predates a same-day audit fix and carries 28 flags the
  fixed tool retracts; the note explains which, why, and how to re-derive
  the corrected numbers from the bundle alone at $0.

## Reproducing a similar run

This fetches the navidrome instance and runs the same **cell** the pass
above ran. It will not run the same **models**: `all-gemini-flash-high`
now pins `gemini-3.5-flash-lite` at `global`, where the recorded pass ran
`gemini-3.5-flash` at `asia-south1`. Expect a different worker, a
different meter, and a different bill — the policy file says so at its
worker leaf.

```bash
# The `instance_` prefix is part of the dataset's instance_id and the fetcher
# matches it exactly — the bare `repo__repo-<sha>` form exits 1.
node tools/swe/fetch-instances-pro.mjs \
  --ids instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a

node tools/harness-matrix/run-harness.mjs \
  --instance-dir studies/swe-pro-corpus/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

The full run output lands under
`tools/harness-matrix/runs/instance_<id>/claude-code--all-gemini-flash-high/<stamp>/`.
