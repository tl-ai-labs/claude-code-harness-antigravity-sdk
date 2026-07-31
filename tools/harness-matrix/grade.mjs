#!/usr/bin/env node
/**
 * grade.mjs — score one harness-matrix run with Scale's OFFICIAL SWE-bench
 * Pro evaluator (the same script that grades leaderboard submissions),
 * running locally in Docker. Same grading shape as the two earlier
 * SWE-bench Pro setups this work grew out of — a batch pipeline and a
 * containerised single-agent rig, both in the orchestrator repository and
 * neither part of this hand-off — so verdicts are comparable across all
 * three. That comparability is the reason the evaluator is Scale's own and
 * is invoked unmodified: a verdict is only portable between setups if none
 * of them scored themselves.
 *
 * Why this shape: the evaluator wants (a) a "raw sample" table carrying the
 * instance's sealed grading data (gold patch, test_patch, fail_to_pass /
 * pass_to_pass, test-runner commands) and (b) a patches JSON of
 * {instance_id, patch, prefix}. Both are built here, entirely offline, from
 * the corpus files already on disk — instance.json + sealed.json — so
 * grading needs no HuggingFace fetch and no `datasets` install.
 *
 * Sealing note, because it looks contradictory at first glance: sealed
 * fields are FORBIDDEN anywhere near the runtime (run-harness.mjs enforces
 * that with validateInstance/assertAgentSafe) but REQUIRED here — the
 * grader is exactly the component that owns gold data. The two never share
 * a container: grading pulls the ORIGINAL frozen Scale image (with its own
 * entrypoint), not our sealed execution image, and runs with
 * --block_network besides.
 *
 * The sample file is emitted as JSONL, not CSV, on purpose: the evaluator
 * accepts both, and JSON string escaping is lossless for multi-KB diffs and
 * embedded newlines where CSV quoting is a bug farm.
 *
 * Importable (gradeRun, used by run-harness.mjs) and runnable standalone:
 *   node tools/harness-matrix/grade.mjs \
 *     --run-dir tools/harness-matrix/runs/<instance>/<runtime>--<policy>/<stamp> \
 *     --instance-dir studies/swe-pro-corpus/<instance_id>
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const HARNESS = join(ROOT, "studies/swe-pro-corpus/.harness/SWE-bench_Pro-os");
const PYTHON = join(ROOT, ".venv-swe-pro/bin/python");

export function gradeRun({ runDir, instanceDir }) {
  if (!existsSync(join(runDir, "model.diff"))) {
    throw new Error(`grade: no model.diff in ${runDir}`);
  }
  if (!existsSync(join(instanceDir, "sealed.json"))) {
    throw new Error(`grade: no sealed.json in ${instanceDir}`);
  }
  const instance = JSON.parse(readFileSync(join(instanceDir, "instance.json"), "utf8"));
  const sealed = JSON.parse(readFileSync(join(instanceDir, "sealed.json"), "utf8"));
  const patch = readFileSync(join(runDir, "model.diff"), "utf8");

  if (!patch.trim()) {
    // An empty diff can't resolve anything; recording the verdict without a
    // ~6-minute Docker round-trip keeps NO_PATCH cheap and honest.
    const verdict = {
      instance_id: instance.instance_id, resolved: false, reason: "empty patch",
    };
    writeFileSync(join(runDir, "grade-verdict.json"), JSON.stringify(verdict, null, 2));
    console.log(`${instance.instance_id}: unresolved (empty patch — grader not invoked)`);
    return verdict;
  }

  // Checked HERE, not with the other preconditions above, and deliberately so.
  // The empty-patch branch never touches python — it writes the verdict itself.
  // Asserting the venv before that branch made a fresh clone fail a test that
  // exists precisely to prove no external process is needed, and would have sent
  // anyone cloning the published repo hunting for a dependency the code path they
  // were exercising does not use. A prerequisite belongs immediately before the
  // work that needs it.
  if (!existsSync(PYTHON)) {
    throw new Error(`grade: grading python missing at ${PYTHON} — rebuild .venv-swe-pro (pandas, tqdm, docker, requests)`);
  }

  // One row = instance metadata + sealed grading fields. _WARNING is the
  // sealed file's human banner, not a dataset column — dropped.
  const { _WARNING, ...sealedCols } = sealed;
  const row = { ...instance, ...sealedCols };

  const gradeDir = join(runDir, "grade");
  mkdirSync(join(gradeDir, "out"), { recursive: true });
  writeFileSync(join(gradeDir, "sample.jsonl"), JSON.stringify(row) + "\n");
  // prefix names the evaluator's output files ({prefix}_output.json).
  writeFileSync(join(gradeDir, "patches.json"), JSON.stringify([
    { instance_id: instance.instance_id, patch, prefix: "harness" },
  ]));

  // cwd must be the harness clone: the script does
  // `from helper_code.image_uri import ...` relative to its own tree.
  console.log(`grading ${instance.instance_id} with Scale evaluator (one Docker eval, ~6-7 min under Rosetta)...`);
  execFileSync(PYTHON, [
    join(HARNESS, "swe_bench_pro_eval.py"),
    "--raw_sample_path", join(gradeDir, "sample.jsonl"),
    "--patch_path", join(gradeDir, "patches.json"),
    "--output_dir", join(gradeDir, "out"),
    "--dockerhub_username", "jefzda",
    "--scripts_dir", join(HARNESS, "run_scripts"),
    "--use_local_docker",
    "--docker_platform", "linux/amd64",
    "--num_workers", "1",
    "--block_network",
    "--redo",
  ], { cwd: HARNESS, stdio: "inherit" });

  // eval_results.json: {instance_id: bool}. Fold into a verdict file next
  // to the run's manifest so one directory tells the whole story.
  const results = JSON.parse(readFileSync(join(gradeDir, "out", "eval_results.json"), "utf8"));
  const resolved = results[instance.instance_id] === true;
  const verdict = {
    instance_id: instance.instance_id,
    resolved,
    grader: "scale swe_bench_pro_eval.py (local docker, network blocked)",
    raw: results,
  };
  writeFileSync(join(runDir, "grade-verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(`\n=== VERDICT: ${instance.instance_id} → ${resolved ? "RESOLVED" : "unresolved"} ===`);
  return verdict;
}

// Standalone CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const runDir = resolve(flag("run-dir") ?? "");
  const instanceDir = resolve(flag("instance-dir") ?? "");
  if (!runDir || !instanceDir) {
    console.error("usage: grade.mjs --run-dir <dir with model.diff> --instance-dir <corpus instance dir>");
    process.exit(2);
  }
  gradeRun({ runDir, instanceDir });
}
