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
  instance. Claude Opus driver × Gemini 3.5 Flash worker,
  `all-gemini-flash-high` policy. Not resolved on this attempt — the
  worker-task files show what the driver asked and the worker's usage
  receipts show what Gemini returned.

## Reproducing a similar run

```bash
node tools/swe/fetch-instances-pro.mjs \
  --ids navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a

node tools/harness-matrix/run-harness.mjs \
  --instance-dir studies/swe-pro-corpus/navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```

The full run output lands under
`tools/harness-matrix/runs/instance_<id>/claude-code--all-gemini-flash-high/<stamp>/`.
