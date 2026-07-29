/**
 * Integrity guards, enforced in code rather than convention:
 *   1. No sealed field (gold patch, eval test lists, hints) can enter
 *      anything bound for a prompt — `assertAgentSafe` throws on contact.
 *   2. Instances load ONLY from `instance.json`; a directory containing a
 *      sealed payload inside the study's frozen inputs is itself an error.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEALED_FIELDS, type SweInstance } from "./types.js";

/**
 * Throw if `value` (searched deeply) carries any sealed key. `label` names
 * the offending input in the error so the failure is diagnosable.
 */
export function assertAgentSafe(value: unknown, label: string): void {
  const seen = new Set<object>();
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if ((SEALED_FIELDS as readonly string[]).includes(k)) {
        throw new Error(
          `integrity violation: sealed field '${k}' present in ${label} at ${path || "<root>"} — sealed data must never reach agent-facing inputs`
        );
      }
      walk(child, path ? `${path}.${k}` : k);
    }
  };
  walk(value, "");
}

const REQUIRED: Array<keyof SweInstance> = ["repo", "instance_id", "base_commit", "problem_statement"];

/** Validate + return one agent-safe instance object. */
export function validateInstance(raw: unknown, label: string): SweInstance {
  assertAgentSafe(raw, label);
  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED) {
    if (typeof obj[field] !== "string" || (obj[field] as string).length === 0) {
      throw new Error(`${label}: missing/empty required field '${field}'`);
    }
  }
  return obj as unknown as SweInstance;
}

/**
 * Load the frozen instance corpus of a study: `{dir}/{instance_id}/instance.json`.
 * Refuses a corpus that carries `sealed.json` files — sealed payloads live in
 * the shared swe-corpus for gold/harness work, never inside a study's inputs.
 */
export function loadInstances(instancesDir: string): SweInstance[] {
  if (!existsSync(instancesDir)) {
    throw new Error(`no frozen instances at ${instancesDir} — create the study with run-swe`);
  }
  const instances: SweInstance[] = [];
  for (const entry of readdirSync(instancesDir).sort()) {
    const dir = join(instancesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, "sealed.json"))) {
      throw new Error(
        `integrity violation: ${entry}/sealed.json found inside the study's frozen inputs — sealed data must never enter a study directory`
      );
    }
    const instPath = join(dir, "instance.json");
    if (!existsSync(instPath)) continue;
    const inst = validateInstance(JSON.parse(readFileSync(instPath, "utf8")), `${entry}/instance.json`);
    if (inst.instance_id !== entry) {
      throw new Error(`${entry}/instance.json: instance_id '${inst.instance_id}' does not match its directory`);
    }
    instances.push(inst);
  }
  if (instances.length === 0) throw new Error(`no instance.json files under ${instancesDir}`);
  return instances;
}
