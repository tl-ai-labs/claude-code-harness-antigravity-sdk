# Evidence bundle — instance_NodeBB__NodeBB-05f2236193f407cf8e2072757fbd6bb170bc13f0-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e

Cell: `claude-code--opus-4.8-plus-gemini-3.5-flash-lite` · run `2026-07-31T10-09-15` · **unresolved**

## What's here

| Path | What it is |
| --- | --- |
| `model.diff` | the patch we submitted — the only thing graded |
| `predictions.jsonl` | that patch in the evaluator's input format |
| `grade/` | the evaluator's own output, verbatim (`out/eval_results.json` is the verdict) |
| `grade-verdict.json` | our one-line fold of it |
| `trajectory/` | every driver turn, stderr stream and gate log |
| `delegation/` | each worker hand-off: the task it was given, the tokens it billed |
| `delegation/lint.json` | the content lint re-run over those hand-offs — which ones, if any, dictated content rather than specifying an outcome |
| `phase-io/` | phase inputs/outputs + the container launcher the gates used |
| `instance.json` | the agent-safe instance — exactly what the prompt could see |
| `manifest.json` | run identity, cell, phase ladder, cost and token totals |
| `audit.json` | post-run intent audit (git-history mining, test-edit attempts, …) |

## Re-verify yourself (no trust required)

1. Clone Scale's evaluator at the exact commit we ran:

```bash
git clone https://github.com/scaleapi/SWE-bench_Pro-os pro-harness
git -C pro-harness checkout ca10a60a5fcae51e6948ffe1485d4153d421e6c5
python3 -m venv .venv-pro && .venv-pro/bin/pip install pandas tqdm docker requests
```

2. Rebuild the grading row from the PUBLIC dataset — do not take ours. Pull the
   `instance_NodeBB__NodeBB-05f2236193f407cf8e2072757fbd6bb170bc13f0-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e` row from `ScaleAI/SWE-bench_Pro` (split: test) and write it as a single
   JSON line into `sample.jsonl`. Check it against the sha256 in
   integrity-notes.md: matching hashes mean we were graded against the
   unmodified public contract.

3. Grade our patch:

```bash
cd pro-harness && ../.venv-pro/bin/python swe_bench_pro_eval.py \
  --raw_sample_path ../sample.jsonl \
  --patch_path ../grade/patches.json \
  --output_dir ../reverify-out \
  --scripts_dir run_scripts \
  --dockerhub_username jefzda \
  --use_local_docker --docker_platform linux/amd64 \
  --num_workers 1 --block_network --redo
```

4. Compare `reverify-out/eval_results.json` with `grade/out/eval_results.json`.
   Shape is `{instance_id: bool}`.

5. Audit the run itself: trajectory/ is the unedited turn log, delegation/ is
   every worker hand-off with its token counts, and integrity-notes.md lists what
   is enforced in code and what is deliberately not claimed.

File hashes: MANIFEST.sha256