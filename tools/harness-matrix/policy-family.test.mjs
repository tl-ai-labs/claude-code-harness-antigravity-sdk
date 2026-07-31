/**
 * The Opus 4.8 + Gemini 3.5 Flash-Lite policy FAMILY — three files, one cable.
 *
 * WHY THIS FILE EXISTS (2026-07-31). The tokenomics cell used to be a single
 * policy, `opus48-plus-lite.yaml`, carrying rules for both workloads at once.
 * It was split into three so that a reader handed the Google deliverable can
 * open the one file that describes the run they are looking at:
 *
 *   opus-4.8-plus-gemini-3.5-flash-lite.yaml                 both kinds, has a `default:`
 *   opus-4.8-plus-gemini-3.5-flash-lite-sdlc.yaml            SDLC only, no `default:`
 *   opus-4.8-plus-gemini-3.5-flash-lite-swe-bench-pro.yaml   Pro only,  no `default:`
 *
 * A split like that creates exactly one new failure mode, and it is a silent
 * one: someone edits the model pin, the region, or the thinking level in ONE
 * file and the other two keep billing the old cable. Nothing in the runner
 * would notice — each file loads fine on its own, and the drift only surfaces
 * as two runs that were supposed to be the same cell disagreeing on cost. So
 * the first test below compares the three `models:` blocks BYTE FOR BYTE, and
 * the sibling files were generated from the combined one specifically so that
 * comparison can be exact rather than approximate.
 *
 * The second thing the split creates is the `default:` asymmetry, which is
 * deliberate and is therefore also asserted rather than left as a comment: the
 * kind-specific files name every stage of their own kind and omit the fall-
 * through, so pointing one at the wrong workload throws at LOAD time for $0
 * instead of quietly resolving the unknown stage to the premium cell and
 * handing back a plausible-looking run with none of this policy's tiering in
 * it. A loud failure beats a wrong answer that no gate is looking for.
 *
 * Everything here is offline and $0 — it reads the shipped files and the
 * shipped template, and makes no model call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, HARNESS_DIR, parseYaml, loadPolicy } from "./kinds/lib.mjs";

const policyPath = (name) => join(HARNESS_DIR, "policies", `${name}.yaml`);

const COMBINED = "opus-4.8-plus-gemini-3.5-flash-lite";
const SDLC_ONLY = `${COMBINED}-sdlc`;
const PRO_ONLY = `${COMBINED}-swe-bench-pro`;
const FAMILY = [COMBINED, SDLC_ONLY, PRO_ONLY];

// Derived from the template, never hardcoded — the same filter kinds/sdlc.mjs
// applies when it builds its stage list. A stage renamed there moves this test
// with it, which is the point: the SDLC-only file claims to name every SDLC
// stage, and that claim has to be checked against the real list.
const sdlcStages = () => parseYaml(
  readFileSync(join(ROOT, "templates", "sdlc-mini", "template.yaml"), "utf8"),
).stages
  .filter((s) => s.executor === "llm-task" || s.executor === "judge")
  .map((s) => s.id);

const PRO_PHASES = ["repro", "localize", "patch"];

// The `models:` block as raw text: everything from the `models:` key up to the
// `rules:` key. Compared as bytes, so a reordered entry, a changed comment or a
// different amount of whitespace all count as drift — deliberately strict,
// because "the comment explaining the region changed in one file only" is
// exactly the state that makes the next reader trust the wrong explanation.
function modelsBlockText(name) {
  const src = readFileSync(policyPath(name), "utf8");
  const start = src.indexOf("\nmodels:\n");
  const end = src.indexOf("\nrules:\n");
  assert.ok(start >= 0 && end > start, `${name}: could not locate the models block`);
  return src.slice(start, end);
}

// ---- the drift guard, which is why the family is safe to have ---------------

test("all three family files carry a byte-identical models block", () => {
  const [base, ...rest] = FAMILY.map(modelsBlockText);
  for (let i = 0; i < rest.length; i++) {
    assert.equal(rest[i], base,
      `${FAMILY[i + 1]} has drifted from ${COMBINED} — the two files now describe different cables ` +
      "while claiming to be the same cell. Re-sync the models block; do not edit one file alone.");
  }
});

test("every family file exposes the same cells and leaves after parsing", () => {
  const shape = (name) => parseYaml(readFileSync(policyPath(name), "utf8")).models;
  const base = shape(COMBINED);
  for (const name of [SDLC_ONLY, PRO_ONLY]) assert.deepEqual(shape(name), base, `${name}: models drift`);
  // The rename is the reason this family exists, so assert it actually landed:
  // no parsed identifier may still carry an ambiguous pre-2026-07-31 name. The
  // file HEADERS still mention them, on purpose — that is the breadcrumb for
  // anyone searching for the old name — which is why this reads the parsed ids
  // rather than the file text.
  const ids = base.map((m) => m.id).join(" ");
  for (const stale of ["opus48", "flash-lite-35"]) {
    assert.ok(!ids.includes(stale), `a pre-rename identifier survived in models[]: ${stale} (${ids})`);
  }
});

// ---- each file resolves its own kind ----------------------------------------

test("the SDLC file resolves every SDLC stage, and the Pro file every Pro phase", () => {
  const sdlc = loadPolicy(policyPath(SDLC_ONLY), "claude-code", sdlcStages());
  for (const s of sdlcStages()) {
    assert.ok(sdlc.resolved[s]?.binding, `${SDLC_ONLY}: no binding for SDLC stage '${s}'`);
  }
  const pro = loadPolicy(policyPath(PRO_ONLY), "claude-code", PRO_PHASES);
  for (const p of PRO_PHASES) {
    assert.ok(pro.resolved[p]?.binding, `${PRO_ONLY}: no binding for Pro phase '${p}'`);
  }
});

// ---- and refuses the other kind, loudly, before any spend -------------------

test("each kind-specific file throws at load time on the other kind's stages", () => {
  assert.throws(
    () => loadPolicy(policyPath(SDLC_ONLY), "claude-code", PRO_PHASES),
    /no default rule/,
    `${SDLC_ONLY} accepted Pro phases — without a throw here, a Pro run under this file would ` +
    "resolve every phase to the premium cell and report zero delegation as if that were the design",
  );
  assert.throws(
    () => loadPolicy(policyPath(PRO_ONLY), "claude-code", sdlcStages()),
    /no default rule/,
    `${PRO_ONLY} accepted SDLC stages — same failure, other direction`,
  );
});

test("only the combined file carries a default rule", () => {
  const hasDefault = (name) =>
    parseYaml(readFileSync(policyPath(name), "utf8")).rules.some((r) => "default" in r);
  assert.equal(hasDefault(COMBINED), true, `${COMBINED} lost its fall-through`);
  assert.equal(hasDefault(SDLC_ONLY), false,
    `${SDLC_ONLY} grew a default — the load-time failure above becomes a silent wrong route`);
  assert.equal(hasDefault(PRO_ONLY), false, `${PRO_ONLY} grew a default — same`);
});

// ---- the split changed no routing -------------------------------------------

test("splitting the policy did not move a single stage to a different cell", () => {
  const combinedSdlc = loadPolicy(policyPath(COMBINED), "claude-code", sdlcStages());
  const sdlc = loadPolicy(policyPath(SDLC_ONLY), "claude-code", sdlcStages());
  for (const s of sdlcStages()) {
    assert.deepEqual(sdlc.resolved[s].binding, combinedSdlc.resolved[s].binding,
      `SDLC stage '${s}' resolves differently in ${SDLC_ONLY} than in ${COMBINED}`);
  }
  const combinedPro = loadPolicy(policyPath(COMBINED), "claude-code", PRO_PHASES);
  const pro = loadPolicy(policyPath(PRO_ONLY), "claude-code", PRO_PHASES);
  for (const p of PRO_PHASES) {
    assert.deepEqual(pro.resolved[p].binding, combinedPro.resolved[p].binding,
      `Pro phase '${p}' resolves differently in ${PRO_ONLY} than in ${COMBINED}`);
  }
});

test("the tiering itself is intact: judgment solo, production delegated", () => {
  const sdlc = loadPolicy(policyPath(SDLC_ONLY), "claude-code", sdlcStages());
  const solo = ["requirements", "design", "plan-packets", "review", "judge"];
  for (const s of solo) {
    assert.equal(typeof sdlc.resolved[s].binding, "string",
      `${s} is delegating — a cheap reviewer approving cheap code is not a review`);
  }
  assert.equal(typeof sdlc.resolved.execute.binding, "object",
    "execute stopped delegating — the policy no longer demonstrates any tiering");

  const pro = loadPolicy(policyPath(PRO_ONLY), "claude-code", PRO_PHASES);
  for (const p of ["repro", "localize"]) {
    assert.equal(typeof pro.resolved[p].binding, "string",
      `${p} is delegating — on a delegated cell the driver cannot read the repository`);
  }
  assert.equal(typeof pro.resolved.patch.binding, "object", "patch stopped delegating");
});
