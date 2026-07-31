# Hand-over note: read this before reading audit.json

This bundle is a published copy of recorded evidence. Three things about it
are true only of the copy, and one thing about `audit.json` needs framing.

## 1. The recorded audit.json predates a same-day audit fix

This run executed on 2026-07-31, hours **before** the audit tool learned to
split driver edits by phase composition (solo vs delegated) and destination
(working tree vs the run's own `out/` directory). The recorded `audit.json`
is kept verbatim — recorded evidence is never rewritten — so it carries the
old shape: a single `editCount` with no `treeEditCount`/`soloEditCount`
split.

Re-derived at $0 with the fixed tool (`auditRun` in
`tools/harness-matrix/audit.mjs`, re-read over this bundle's own
`trajectory/` files with the manifest's per-phase composition — no model
calls):

- 5 driver edits total, **0 into the working tree during delegated phases**
  (the integrity claim holds), 5 during solo phases — all of them the solo
  phases' own contract files under `out/`, never shipped code.
- 1 true flag: a pre-delegation inspection in the execute phase.

Anyone can reproduce those numbers from this bundle alone; nothing needs
our machine or a paid call.

## 2. Host paths are scrubbed

Every absolute path from the recording machine is rewritten to `/harness`
(the repo root) by `tools/harness-matrix/scrub-paths.mjs`, whose `--check`
mode re-asserted the result. The scrubber also re-linted the driver→worker
hand-off before and after rewriting and verified the lint verdict did not
change.

## 3. MANIFEST.sha256 covers the published copy

Because scrubbing rewrites file contents, the original manifest's hashes
would not match this copy. `MANIFEST.sha256` here is regenerated over the
scrubbed files (this note included), so it verifies exactly what you
received. The unscrubbed original bundle and the immutable run directory
remain on the recording machine as the primary record.
