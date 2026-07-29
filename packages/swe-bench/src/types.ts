/**
 * SWE-bench domain types. This package owns fetch/ingest/localize/patch/
 * package logic (SWE-01 code-placement decision): it is a separable boundary
 * so a future Option A open-source carve-out ships this package alone —
 * the orchestrator's prompts and gating never leave the repo.
 */

/** The agent-safe instance record (fetch-instances `instance.json`). */
export interface SweInstance {
  repo: string;
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  version?: string;
  environment_setup_commit?: string;
  difficulty?: string;
  created_at?: string;
}

/**
 * Fields that exist ONLY in `sealed.json` and must never reach a model
 * (integrity rule #1 of the SWE-bench plan). `assertAgentSafe` rejects any
 * object carrying one of these keys; the planted-hint test proves it.
 *
 * Covers BOTH tracks: Verified (princeton-nlp) seals FAIL_TO_PASS/PASS_TO_PASS
 * in uppercase; Pro (ScaleAI) uses lowercase names plus eval-only fields of its
 * own (test file selection, image tag, repo-reset command). One shared list —
 * a sealed key from either dataset is poison in every prompt-bound object.
 */
export const SEALED_FIELDS = [
  // Both datasets: the gold answers themselves.
  "patch",
  "test_patch",
  "hints_text", // Verified-only field, harmless to seal on both tracks
  // Verified (princeton-nlp) — eval-test lists, uppercase.
  "FAIL_TO_PASS",
  "PASS_TO_PASS",
  // Pro (ScaleAI) — same lists lowercase, plus Pro's eval-only run config.
  "fail_to_pass",
  "pass_to_pass",
  "selected_test_files_to_run", // which test files the eval executes
  "before_repo_set_cmd", // repo-reset command the eval runs before tests
  "dockerhub_tag", // per-instance eval image tag
] as const;

/** One row of the harness input file (pass@1: exactly one per instance). */
export interface PredictionRow {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

/** Parsed verdicts of an official-harness report.json. */
export interface HarnessVerdicts {
  resolved_ids: string[];
  unresolved_ids: string[];
  error_ids: string[];
  completed_ids: string[];
}
