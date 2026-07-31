# Integrity notes — instance_NodeBB__NodeBB-05f2236193f407cf8e2072757fbd6bb170bc13f0-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e

Cell: claude-code--opus48-plus-lite · run 2026-07-31T10-09-15 · verdict unresolved
Grader: scale swe_bench_pro_eval.py (local docker, network blocked)

Enforced in code (tools/harness-matrix/run-harness.mjs, grade.mjs):
- The runtime never sees the grading contract. The gold patch, test patch,
  fail_to_pass, pass_to_pass and the test-file list live in sealed.json in the
  corpus; validateInstance/assertAgentSafe refuse to start a run that can reach
  them. Only instance.json (shipped here) goes into the prompt.
- Grading and running never share a container. The grader pulls Scale's ORIGINAL
  frozen image with its own entrypoint, not our sealed execution image, and runs
  with --block_network.
- The instance repo is fetched once and pinned; the execution container blocks
  github.com and friends at the host level (see phase-io/run-in-env.sh), so no
  phase can pull the upstream fix at run time.
- Every driver turn is in trajectory/ verbatim, including the stderr streams and
  each gate's own log. Nothing was replayed or re-recorded for this bundle.

Withheld on purpose:
- grade/sample.jsonl — the sealed grading row we fed the evaluator. You should
  rebuild it from the public dataset rather than trust our copy of the contract
  we were graded against. Rebuild, then compare:
  sha256 = 016c80b764f1e77a33d34909d9446525fcb147c58ccf33d0f134b91583a0de84
- workdir/, out/claude-config/, out/_gemini_worker_save/ — the repo checkout and
  the two runtime home directories. They hold machine-local and
  credential-adjacent state and are never packaged. The evidence they would have
  carried (the patch, the trajectory, the token counts) is here in full.

Delegation integrity — who typed it, and who decided what to type:
- typed_by — Antigravity SDK worker — STRUCTURAL. The driver's Edit / Write / MultiEdit / NotebookEdit tools are removed and a pre-tool hook blocks every tree-writing shell command, so every byte of the patch came back through the worker. attempts[] and final_model report the worker for this reason.
- authored_by — worker — MEASURED. The delegation content lint read all 1 driver→worker hand-off(s) for this run and found no dictated file, patch or proxy command: the driver specified the outcome, the worker decided the code.

Hand-off lint for this run, re-read from the files in delegation/ at bundle time (the run's own audit already ran it too):
- 1 hand-off(s) scanned · 0 passage(s) flagged
- The per-hand-off result is in delegation/lint.json, and every hand-off it
  judged is in delegation/ beside it. Re-run it yourself:
  node tools/harness-matrix/audit.mjs is the trajectory pass; the hand-off pass
  is lintDelegationText() in the same file, whose thresholds are defended by a
  50-hand-off labelled corpus committed at fixtures/delegation-corpus/.
- guard-evasion-by-proxy — the one CRITICAL family — cannot be raised by this
  pass: it needs the trajectory's denial ordering, which reading the hand-off
  files alone cannot establish. A zero here is not evidence against it.

How far a flag here reaches — measured, not asserted (SWE-bench Pro):
- The graded artefact is model.diff, scored by Scale's evaluator against
  fail_to_pass / pass_to_pass sets this run never saw. Across the three dictated
  passages found in the whole SWE-Pro track, ALL of them landed in the `repro`
  phase, whose reproduction scaffolding is stripped before grading. Verbatim
  lines carried into the graded diff: 0 of 16, 0 of 20, 0 of 22 — zero of 58.
- So a flag on a SWE-Pro run is an ATTRIBUTION defect, not a scoring one: it
  says the credit line is wrong, not that the verdict is. The resolve figures
  are not contaminated by dictation.

Known caveats (disclosed, not hidden):
- Model calls go to vendor APIs during patch authoring, as in any live run —
  network isolation is enforced for the REPO, not for the model. No claim is made
  that this instance predates any model's training cutoff.
- Scale's images are x86_64; on an arm64 host they run under emulation. That
  changes wall-clock, not verdicts.
- This is ONE instance under ONE cell. It is an attempt, not a rate — do not read
  a resolve rate off a single bundle.
- Logs and scripts carry the absolute paths of the machine that ran them. Nothing
  here was rewritten to tidy that up: "verbatim" is the stronger property, and a
  bundle whose files have been edited for appearance is a bundle you cannot hash
  against the originals.