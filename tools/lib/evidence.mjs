/**
 * Shared bits for the cloud-mirror tools (push-study, publish-run, run-brief
 * --push): the .env loader and the evidence exclusion rule.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Auto-load the root .env — values already in the environment win. */
export function loadEnv(root) {
  const envFile = join(root, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value !== "" && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/**
 * Not evidence, never mirrored (decision 2026-07-10): the generated
 * codebase/ (code ships at repo level, not in the bucket), dependency
 * trees, and runtime databases (integrity-ignored).
 */
export function evidenceExclude(rel, isDir) {
  const name = rel.split("/").pop();
  return (
    (isDir && (name === "codebase" || name === "node_modules")) ||
    /\.db(-wal|-shm)?$/.test(rel)
  );
}
