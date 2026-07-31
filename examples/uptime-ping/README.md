# uptime-ping — SDLC smoke workload

A minimal SDLC brief used to smoke-test the runner and the policy
resolution end-to-end without spending on Gemini's substantive
engineering time. Faster and cheaper than [kudos-wall](../kudos-wall/) — if
this one runs cleanly and the manifest looks sane, the more expensive
policies against the more substantive kudos-wall workload are worth
attempting.

## Files

- [brief.md](brief.md) — a short uptime-check-service brief.
- [task.json](task.json) — task-id, template-id, scaffold-id, brief hash.

No committed reference pass — the workload exists to be run locally as a
warm-up, not as a scoring workload. Nor will one appear here: a run never
writes into `examples/`. Its output goes to
`tools/harness-matrix/runs/uptime-ping/<runtime>--<policy>/<stamp>/`,
which is gitignored. The `passes/` directories in the other two workloads
are curated copies, put there deliberately.

## Running it

```bash
node tools/harness-matrix/run-harness.mjs \
  --task-dir examples/uptime-ping \
  --runtime claude-code \
  --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml
```
