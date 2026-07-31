/**
 * preflightBinding — the $0 gate must see the worker leg on a TIERED policy.
 *
 * WHY THIS FILE EXISTS (2026-07-31). Both kinds used to hand
 * `runtime.preflight()` the binding of their FIRST stage, which is only the
 * right binding if a policy is delegated everywhere or nowhere. `all-opus`,
 * `all-gemini-flash-high` and the two historical cells are uniform, so the
 * shortcut held for four of the five shipped policies and nothing ever caught
 * it. The fifth, `opus-4.8-plus-gemini-3.5-flash-lite`, is the tiered cell the whole tokenomics
 * story rests on: on SDLC it resolves requirements/design/plan-packets SOLO and
 * only `execute` DELEGATED. Its first stage is therefore a bare model string,
 * `isDelegated` said false, and preflight skipped the three worker checks —
 * venv present, `import google.antigravity`, Vertex ADC. A laptop with no ADC
 * passed a gate whose comment reads "all $0, before any build or spend", paid
 * for three Opus stages, then failed at `execute`; the zero-delegation gate
 * then re-ran that failure under `max_attempts: 3`.
 *
 * The bug is invisible to every existing test because it needs three things at
 * once — a real policy, a real stage list, and the two disagreeing about which
 * stage delegates first. So the regression test below uses the SHIPPED policy
 * and derives the stage ids from the SHIPPED template exactly as the kind does,
 * rather than asserting against a hand-written fixture that would keep passing
 * if either file changed underneath it.
 *
 * Offline and $0: policy resolution and YAML parsing only, no CLI, no docker,
 * no tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROOT, HARNESS_DIR, parseYaml, loadPolicy, isDelegatedBinding, preflightBinding,
} from "./lib.mjs";

const policyPath = (name) => join(HARNESS_DIR, "policies", `${name}.yaml`);

// Derived from the template, not hardcoded — the same filter kinds/sdlc.mjs
// applies. A stage renamed there must move this test with it.
const sdlcStages = () => parseYaml(
  readFileSync(join(ROOT, "templates", "sdlc-mini", "template.yaml"), "utf8"),
).stages
  .filter((s) => s.executor === "llm-task" || s.executor === "judge")
  .map((s) => s.id);

const PRO_PHASES = ["repro", "localize", "patch"];

// ---- the helper's own contract ---------------------------------------------

test("preflightBinding returns the first stage's binding when nothing is delegated", () => {
  const resolved = { a: { binding: "opus-a" }, b: { binding: "opus-b" } };
  assert.equal(preflightBinding(resolved, ["a", "b"]), "opus-a");
});

test("preflightBinding returns the first stage's binding when everything is delegated", () => {
  const d = (worker) => ({ driver: "opus", worker });
  const resolved = { a: { binding: d("w1") }, b: { binding: d("w2") } };
  assert.equal(preflightBinding(resolved, ["a", "b"]).worker, "w1");
});

test("preflightBinding skips leading SOLO stages to reach the delegated one", () => {
  const resolved = {
    a: { binding: "opus" },
    b: { binding: "opus" },
    c: { binding: { driver: "opus", worker: "flash-lite" } },
  };
  const picked = preflightBinding(resolved, ["a", "b", "c"]);
  assert.ok(isDelegatedBinding(picked), "a mixed policy must preflight its delegated cell");
  assert.equal(picked.worker, "flash-lite");
});

// ---- the regression, against the shipped files ------------------------------

test("the tiered policy's SDLC walk preflights the worker leg, not its solo first stage", () => {
  const stages = sdlcStages();
  const policy = loadPolicy(policyPath("opus-4.8-plus-gemini-3.5-flash-lite"), "claude-code", stages);

  // The precondition that makes this a real test rather than a tautology: if
  // the policy is ever re-pinned so that stage 0 delegates too, the assertion
  // below would pass for the wrong reason and prove nothing.
  assert.ok(!isDelegatedBinding(policy.resolved[stages[0]].binding),
    `precondition gone: ${stages[0]} now delegates, so this no longer exercises the mixed case`);
  assert.ok(stages.some((s) => isDelegatedBinding(policy.resolved[s].binding)),
    "precondition gone: no SDLC stage delegates under the tiered policy");

  const picked = preflightBinding(policy.resolved, stages);
  assert.ok(isDelegatedBinding(picked),
    "preflight would skip the venv/ADC checks and the run would die mid-spend");
  // The header renders `Claude Code (${driver})` off this same binding.
  assert.ok(picked.driver, "orientation paragraph would print 'Claude Code (undefined)'");
  assert.ok(picked.worker, "orientation paragraph would name no worker");
});

// The five CELLS, one file each. The tokenomics cell's two kind-specific
// siblings are deliberately absent: they name only their own workload's stages
// and throw on the other kind's, which is the property `policy-family.test.mjs`
// asserts. Listing them here would make this sweep fail for the correct reason,
// which is not a useful test.
test("every shipped cell yields a preflight binding for both kinds' stage lists", () => {
  const stages = sdlcStages();
  for (const name of [
    "all-opus", "all-gemini-flash-high", "opus-4.8-plus-gemini-3.5-flash-lite",
    "all-gemini-25-flash-high", "gemini35-plus-25-flash-high",
  ]) {
    for (const [kind, list] of [["sdlc", stages], ["swe-bench-pro", PRO_PHASES]]) {
      const policy = loadPolicy(policyPath(name), "claude-code", list);
      const picked = preflightBinding(policy.resolved, list);
      assert.ok(picked, `${name} × ${kind}: no binding to preflight — the gate would throw`);
      // A policy with any delegated stage must preflight a delegated binding;
      // one with none must not invent a worker leg to check.
      const anyDelegated = list.some((s) => isDelegatedBinding(policy.resolved[s].binding));
      assert.equal(isDelegatedBinding(picked), anyDelegated,
        `${name} × ${kind}: preflight depth disagrees with what the run actually does`);
    }
  }
});
