# Hand-over note: read this before reading audit.json

This bundle is a published copy of recorded evidence. Three things about it
are true only of the copy, and one thing about `audit.json` needs framing —
for this run it matters more than usual.

## 1. The recorded audit.json contains 28 flags the fixed tool retracts

This run executed on 2026-07-31, hours **before** an audit fix, and it is
the run that exposed the bug. The audit's delegated-cell checks were gated
on the RUN-level delegation flag, so this policy's two **solo** phases
(localize and repro — contracted to the driver on `opus-4.8-plus-gemini-3.5-flash-lite`) were
judged as if they had been delegated. The recorded `audit.json` therefore
carries **28 false `driver-predelegation-inspection` flags** (the driver
inspecting the repo it was contracted to inspect) and one false
`test-edit-attempt` (the repro phase writing the repro test that IS its
deliverable — `computeDiff` strips test/repro paths from the graded diff,
which is the enforcement). Recorded evidence is never rewritten, so the
file stays as the tool wrote it at run time.

Re-derived at $0 with the fixed tool (`auditRun` in
`tools/harness-matrix/audit.mjs`, re-read over this bundle's own
`trajectory/` files with the manifest's per-phase composition — no model
calls):

- False flags: **28 → 0**.
- 3 driver edits total, **0 into the working tree during delegated phases**
  (the integrity claim holds), 3 during solo phases — two `out/` contract
  files plus the repro test named above.
- 1 true flag survives: after delegation 1 died on a missing
  `GOOGLE_CLOUD_PROJECT` in the launch environment, the driver's improvised
  recovery probe ran at thinking NONE against the policy's HIGH pin. The
  delegation that produced the shipped work records thinking HIGH in its
  usage sidecar.

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
