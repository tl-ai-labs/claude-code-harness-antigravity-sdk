/**
 * Tests for the evidence bundler's run-identity resolution
 * (tools/harness-matrix/bundle-run.mjs → runProfile).
 *
 * WHY THIS FILE EXISTS. The bundler shipped SWE-bench-only and read
 * `manifest.instance_id` unconditionally. SDLC runs have no instance_id — a
 * greenfield build has no upstream repo, no upstream fix and no corpus row —
 * so `--all` died with ERR_INVALID_ARG_TYPE the first time it reached one, and
 * every delegated SDLC run went unbundled. The failure was silent in the worst
 * way: the six SWE bundles it had already written looked like a successful run.
 *
 * So this file pins the three things that broke, and the one that must never
 * break again:
 *   1. identity resolves for BOTH manifest shapes, and for the legacy runs
 *      that predate the `kind` field;
 *   2. the corpus/dataset re-verify path stays gated behind isSwe, because
 *      emitting it on an SDLC bundle documents a procedure the reader cannot
 *      run — a false claim, not a missing one;
 *   3. the worker delegation files are in the COMMON allowlist, so no future
 *      kind can be added that silently drops the delegation evidence — which
 *      is the whole reason these bundles are handed to a partner;
 *   4. an unnameable manifest throws instead of producing `undefined` deep in
 *      a path join.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProfile, sweIntegrityNotes, writeSdlcDocs } from "./bundle-run.mjs";

/** Trimmed to the fields runProfile actually reads — real shapes, real values. */
const SWE_MANIFEST = {
  instance_id: "instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a",
  repo: "navidrome/navidrome",
  repo_language: "Go",
};
const SDLC_MANIFEST = {
  study: "harness-matrix",
  kind: "sdlc",
  task_id: "kudos-wall",
  template: { id: "sdlc-mini", version: "0.8.0" },
};

const matches = (patterns, name) => patterns.some((re) => re.test(name));

test("swe-bench-pro run: identity from instance_id, kind defaults, corpus path enabled", () => {
  const p = runProfile(SWE_MANIFEST, { resolved: true });
  assert.equal(p.id, SWE_MANIFEST.instance_id);
  // No `kind` field on any run made before the field existed — all of them SWE.
  assert.equal(p.kind, "swe-bench-pro");
  assert.equal(p.isSwe, true);
  assert.ok(matches(p.outFilePatterns, "localize.json"));
  assert.ok(matches(p.outFilePatterns, "repro-baseline.log"));
});

test("sdlc run: identity from task_id, corpus/dataset path disabled", () => {
  const p = runProfile(SDLC_MANIFEST, { task_id: "kudos-wall", resolved: true });
  assert.equal(p.id, "kudos-wall");
  assert.equal(p.kind, "sdlc");
  // The flag that keeps the Scale re-verify recipe out of an SDLC bundle.
  assert.equal(p.isSwe, false);
  assert.ok(matches(p.outFilePatterns, "design.md"));
  assert.ok(matches(p.outFilePatterns, "judge.json"));
  assert.ok(matches(p.outFilePatterns, "grade-test.log"));
  // SWE phase artefacts must NOT be allowlisted for a kind that never writes
  // them — the allowlist is the file's central safety property.
  assert.equal(matches(p.outFilePatterns, "localize.json"), false);
});

test("delegation evidence is common to every kind", () => {
  for (const manifest of [SWE_MANIFEST, SDLC_MANIFEST]) {
    const { outFilePatterns: pats } = runProfile(manifest);
    assert.ok(matches(pats, "worker-task-execute-slot3-1.md"));
    assert.ok(matches(pats, "worker-usage-execute-slot3-1.json"));
    assert.ok(matches(pats, "run-in-env.sh"));
  }
  // An unknown future kind still ships its delegation ledger rather than
  // nothing — degrade to the common set, never to silence.
  const future = runProfile({ kind: "some-new-kind", task_id: "t1" });
  assert.equal(future.isSwe, false);
  assert.ok(matches(future.outFilePatterns, "worker-usage-plan-slot1-1.json"));
});

test("verdict is the fallback source of identity, manifest wins when both are present", () => {
  assert.equal(runProfile({}, { instance_id: "instance_from_verdict" }).id, "instance_from_verdict");
  assert.equal(
    runProfile({ instance_id: "from_manifest" }, { instance_id: "from_verdict" }).id,
    "from_manifest"
  );
});

test("a manifest with no usable identity throws instead of naming a bundle undefined", () => {
  assert.throws(
    () => runProfile({ kind: "sdlc" }, {}),
    /no instance_id and no task_id/
  );
});

// ── the delegation-integrity section, in both kinds' integrity notes ─────────
//
// Added 2026-07-29 (finding C6). The section's TEXT is tested at its source in
// audit.test.mjs; what is pinned here is that both documents actually carry it,
// and carry it in the right place. A section that exists but never reaches the
// SWE bundle is the same defect as no section at all — and the SWE notes were
// an inline array literal until this change, which is exactly why it went
// untested.

/** The shape delegationIntegrityNotes returns, trimmed to what the docs use. */
const SECTION = [
  `Delegation integrity — who typed it, and who decided what to type:`,
  `- typed_by — Antigravity SDK worker — STRUCTURAL.`,
  `- authored_by — MIXED — MEASURED.`,
];

test("SWE integrity notes carry the delegation section, above the caveats", () => {
  const text = sweIntegrityNotes({
    instanceId: "instance_navidrome__navidrome-3bc9e75",
    cell: "claude-code--all-gemini-flash-high",
    stamp: "2026-07-26T06-10-19",
    verdict: { resolved: true },
    sampleSha: "abc123",
    integritySection: SECTION,
  }).join("\n");

  assert.ok(text.includes(SECTION[0]), "the section must be in the shipped document");
  // Order is load-bearing: the caveats section closes the document, and a
  // disclosure filed after the closing list reads as an afterthought.
  assert.ok(
    text.indexOf(SECTION[0]) < text.indexOf("Known caveats (disclosed, not hidden):"),
    "the delegation section belongs before the caveats, not after them"
  );
  // The withheld-files disclosure must survive the extraction intact.
  assert.match(text, /sha256 = abc123/);
});

test("SWE integrity notes are unchanged for a run with nothing to disclose", () => {
  // delegationIntegrityNotes returns [] for a solo run. Splicing that must add
  // nothing at all — not a heading with an empty body, not a stray blank line.
  const args = {
    instanceId: "i1", cell: "c1", stamp: "s1", verdict: { resolved: false }, sampleSha: null,
  };
  assert.deepEqual(
    sweIntegrityNotes({ ...args, integritySection: [] }),
    sweIntegrityNotes(args),
    "an empty section and no section must produce byte-identical documents"
  );
  assert.doesNotMatch(sweIntegrityNotes(args).join("\n"), /Delegation integrity/);
});

test("SDLC integrity notes carry the same section, above their own caveats", () => {
  const bundle = mkdtempSync(join(tmpdir(), "sdlc-docs-"));
  writeSdlcDocs({
    bundle,
    id: "kudos-wall",
    cell: "claude-code--all-gemini-flash-high",
    stamp: "2026-07-26T06-10-19",
    manifest: SDLC_MANIFEST,
    verdict: { resolved: true, tests: {}, judge_scores: {} },
    integritySection: SECTION,
  });

  const text = readFileSync(join(bundle, "integrity-notes.md"), "utf8");
  assert.ok(text.includes(SECTION[0]));
  assert.ok(text.indexOf(SECTION[0]) < text.indexOf("Known caveats"));
  // Both kinds must advertise the lint output in their file table, or a reader
  // gets the claim without the evidence sitting next to it.
  assert.match(readFileSync(join(bundle, "README.md"), "utf8"), /delegation\/lint\.json/);
});
