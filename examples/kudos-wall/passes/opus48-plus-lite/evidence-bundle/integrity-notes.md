# Integrity notes — kudos-wall (SDLC)

Cell: claude-code--opus48-plus-lite · run 2026-07-31T09-54-42 · verdict PASS
Grader: scaffold build+test re-run via run-in-env.sh (sdlc-env:node22-pnpm9.12.3)

Everything this run was given, pinned by hash:
- brief    sha256 26c62f79f5261eeb51566da9e9a371f72baff52af48eb7d49636fe0bc853f33a
- template sdlc-mini v0.8.0 sha256 7627f4df57abe882c6799e8805f0c69469ff2d63aa35f2e8b23526691cb7a7c7
- scaffold service-web v0.2.0
- policy   opus48-plus-lite sha256 ccbe886160ba4f8bb30353081411c81de671e4462863be5e75cfcc011c60077d
- runtime  claude-code 2.1.215 (Claude Code)

Enforced in code (tools/harness-matrix/kinds/sdlc.mjs):
- The brief is hashed before the run starts and the run aborts on a mismatch,
  so an edited brief cannot masquerade as the same task.
- Every stage writes into out/ and is gated before the next one starts; the
  gate text and the stage's own log are in trajectory/ verbatim.
- The verify and grade gates run the scaffold's real build and test commands
  inside the pinned container via phase-io/run-in-env.sh — not a summary of
  them, and not the agent's own claim about them.
- The review and judge stages run against the VERIFIED tree and may not
  modify it; a stage that touches the tree fails its gate.

Nothing is withheld from the prompt for this kind — there is no sealed
contract, no gold patch and no hidden test list. The whole task is the brief,
and the brief is reproduced in the run's own phase-io/requirements.md.

Not packaged:
- workdir/, out/claude-config/, out/_gemini_worker_save/ — the built tree and
  the two runtime home directories. They hold machine-local and
  credential-adjacent state. The evidence they would have carried (the diff,
  the trajectory, the token counts) is here in full.

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

How far a flag here reaches — measured, not asserted (SDLC):
- Unlike the SWE-bench Pro leg, dictation here CAN reach what is scored: the
  `execute` stage authors the test file the judge scores as test_quality, and
  nothing strips it before grading. Verbatim lines carried into the delivered
  tree, across the three dictated passages in the SDLC track: 19 of 24 (79%),
  9 of 90 (10%), 0 of 7.
- It did not inflate the score. The one dictation-free control run in the same
  cell scored HIGHER on test_quality (8.5) than the run carrying the 79%
  dictated test file (8.0). The defect is a wrong credit line, not a wrong
  number: the ledger reads as worker engineering where the driver authored.
- Read judge.json's test_quality with that in mind, next to the mechanical
  build and test exit codes, which no hand-off can reach.

Known caveats (disclosed, not hidden):
- judge.json is a MODEL's score out of 10, not a measurement. Read it beside
  review.md and the build/test logs, which are mechanical:
  build exit 0 · tests 14/14 passed, 0 failed
  · judge overall 9/10 (requirements 9.5,
  code 8.5, tests 8).
- The tests were written by the same run that wrote the code. A green suite
  proves internal consistency, not that the brief was satisfied — that is
  what requirements_fidelity is trying (imperfectly) to capture. Who inside
  the run wrote them is a separate question, answered above under
  "Delegation integrity".
- Model calls go to vendor APIs during authoring, as in any live run.
- This is ONE task under ONE cell. It is an attempt, not a rate.
- Logs and scripts carry the absolute paths of the machine that ran them.
  Nothing here was rewritten to tidy that up: "verbatim" is the stronger
  property, and a bundle whose files have been edited for appearance is a
  bundle you cannot hash against the originals.