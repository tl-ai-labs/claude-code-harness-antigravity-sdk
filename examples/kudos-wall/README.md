# kudos-wall — SDLC reference workload

A one-module vertical slice: build a Kudos posting service (POST/GET
`/kudos`, SQLite via Prisma, integration tests) into the shipped
`scaffolds/service-web` NestJS scaffold. Small enough to run cheaply
(~$3–4, 20–30 min live), representative enough that the driver-worker
split has to do real engineering work — Prisma schema, service, controller,
module registration, integration tests, and a passing build.

## Files

- [brief.md](brief.md) — the free-text brief the requirements phase reads.
- [task.json](task.json) — task-id, template-id (`sdlc-mini`), scaffold-id
  (`service-web`), and the SHA-256 of the brief so the input is pinned.
- [passes/reference/](passes/reference/) — a full committed set of
  driver→worker hand-offs and worker usage receipts from a real run of the
  `gemini35-plus-25-flash-high` policy: a `claude-opus-4-6` driver over
  **two** worker tiers, which is the point of that column. Twelve hand-offs
  and twelve receipts — `gemini-3.5-flash` on the five judgment stages
  (requirements, design, plan-packets, review, judge) and `gemini-2.5-flash`
  on the seven `execute` delegations, all at `asia-south1`. Read the
  `worker-task-*.md` files to see what the driver actually handed the
  worker; read the `worker-usage-*.json` files to see the token counts the
  Antigravity SDK reported back, and which of the two models each one billed.
- [passes/opus-4.8-plus-gemini-3.5-flash-lite/](passes/opus-4.8-plus-gemini-3.5-flash-lite/) — the same evidence
  set from a real run of the cost-tier policy (`opus-4.8-plus-gemini-3.5-flash-lite`: Claude
  Opus 4.8 driver, `gemini-3.5-flash-lite` worker, 2026-07-31). RESOLVED —
  14/14 grade tests, judge 9/10. This cell delegates sparingly by design,
  so there is exactly one hand-off; `lint.json` is the content lint re-run
  over it (zero passages flagged). Host paths are scrubbed to `/harness`
  (`scrub-paths.mjs`); everything else is verbatim from the run. The
  [evidence-bundle/](passes/opus-4.8-plus-gemini-3.5-flash-lite/evidence-bundle/) subdirectory
  is the run's **full** scrubbed evidence bundle — per-phase trajectories,
  gate logs, phase I/O, diffs, grade verdict, the recorded `audit.json`,
  and a regenerated `MANIFEST.sha256`. Read its `AUDIT-NOTE.md` first: the
  recorded audit predates a same-day audit fix, and the note carries the
  corrected numbers plus how to re-derive them from the bundle alone at $0.

## Reproducing the reference pass

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/kudos-wall \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/gemini35-plus-25-flash-high.yaml
```

The full run output (the workdir, the grade verdict, the trajectory,
`manifest.json`, `telemetry.jsonl`) lands under
`tools/harness-matrix/runs/kudos-wall/claude-code--gemini35-plus-25-flash-high/<stamp>/`.
That directory is gitignored. What is under version control is the two
committed passes above: `passes/reference/` carries the
`evidence-bundle/delegation/` subset only, and `passes/opus-4.8-plus-gemini-3.5-flash-lite/`
carries that subset **plus** the full `evidence-bundle/` described above.
Nothing a run writes ever lands in `passes/` — the committed passes were
copied there deliberately, through `scrub-paths.mjs`.

## Bringing your own SDLC workload

Copy this directory to `examples/<your-task-id>/`, replace `brief.md`
with your own free-text brief (the section layout the `sdlc-mini`
template expects is in [docs/brief-template.md](../../docs/brief-template.md)),
and update `task.json` with your task id and the new brief's SHA-256.
Then point `--task-dir` at the new directory.
