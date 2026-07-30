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
  driver→worker hand-offs and worker usage receipts from a real run:
  Claude Opus driver × Gemini 3.5 Flash worker, `gemini35-plus-25-flash-high`
  policy. Read the `worker-task-*.md` files to see what the driver actually
  handed the worker; read the `worker-usage-*.json` files to see the token
  counts the Antigravity SDK reported back.

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
That directory is gitignored — only the `evidence-bundle/delegation/`
subset from the committed reference pass is under version control.

## Bringing your own SDLC workload

Copy this directory to `examples/<your-task-id>/`, replace `brief.md`
with your own free-text brief (the section layout the `sdlc-mini`
template expects is in [docs/brief-template.md](../../docs/brief-template.md)),
and update `task.json` with your task id and the new brief's SHA-256.
Then point `--task-dir` at the new directory.
