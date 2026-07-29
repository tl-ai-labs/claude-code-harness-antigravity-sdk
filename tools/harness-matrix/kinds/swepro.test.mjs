/**
 * SWE-bench Pro kind — `--dry-run` contract.
 *
 * Why this file exists: kinds/sdlc.mjs has had a dry-run contract test since
 * the header-drift fix; kinds/swepro.mjs — the kind that runs the benchmark we
 * publish externally — had none at all. That asymmetry meant the paid path
 * with the higher blast radius was the one nobody previewed offline.
 *
 * Everything here is $0 and offline: --dry-run exits before preflight, docker,
 * and any token spend. It is safe to run while a real Pro run is in flight.
 *
 * KNOWN GAP, deliberately NOT asserted here (2026-07-27). The SDLC kind opens
 * its dry run with the same boxed identity frame its paid run opens with, and
 * kinds/sdlc.test.mjs pins that ("--dry-run opens with the real header frame").
 * The Pro kind still prints a SECOND, ad-hoc summary instead —
 *     instance : … / runtime  : … / policy   : …
 * — the very shape the SDLC fix deleted, while the paid Pro run opens with
 * "╔═╗ HARNESS-MATRIX RUN · KIND: SWE-BENCH PRO". A preview that does not look
 * like the run it previews is a mockup, and screenshots taken from it
 * misrepresent the product. That is a swepro.mjs fix (hoist one descriptor
 * above the dry-run branch, exactly as sdlc.mjs did), not a test change, so
 * this file asserts only contracts that hold either way. When the header is
 * hoisted, ADD the sdlc-style frame assertions here — nothing below needs
 * editing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The corpus is machine-local (fetched, never committed), so every test here
 * skips rather than fails on a fresh clone — same contract as the sdlc replay
 * test, which skips on a missing runs/ directory. */
const INSTANCE = "../../studies/swe-pro-corpus/" +
  "instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a";
const haveCorpus = existsSync(join(HARNESS_DIR, INSTANCE));
const skip = haveCorpus ? false : `no corpus instance at ${INSTANCE}`;

const dryRun = (policy) => execFileSync(process.execPath, [
  "run-harness.mjs", "--instance-dir", INSTANCE,
  "--runtime", "claude-code", "--policy", `policies/${policy}`, "--dry-run",
], { cwd: HARNESS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The run summary is everything BEFORE the rendered prompt. The prompt body is
 * verbatim upstream text (a GitHub issue), so its line lengths and wording are
 * not ours to assert — cutting here keeps these tests about our own output. */
const summaryOf = (out) => {
  const i = out.indexOf("--dry-run: rendered");
  assert.ok(i !== -1, `no '--dry-run: rendered' marker — not a dry run:\n${out.slice(0, 400)}`);
  return out.slice(0, i);
};

test("--dry-run costs nothing: it renders a prompt instead of executing", { skip }, () => {
  const out = dryRun("all-gemini-flash-high.yaml");
  assert.match(out, /--dry-run: rendered REPRO prompt below, nothing executed/,
    "the preview must say plainly that it executed nothing — this string is the " +
    "only thing separating a free preview from a paid column in a screenshot");
});

test("--dry-run names all three phases and their delegation cable", { skip }, () => {
  const summary = summaryOf(dryRun("all-gemini-flash-high.yaml"));
  // The Pro recipe is REPRO → LOCALIZE → PATCH. Every phase has to show the
  // driver AND the worker: a column that silently ran the driver as its own
  // implementer would be a different experiment from the one we publish.
  for (const phase of ["repro", "localize", "patch"]) {
    assert.match(summary, new RegExp(`${phase}\\s+→ claude-opus-4-6 → gemini-3\\.5-flash`),
      `phase ${phase} must name driver → worker`);
  }
  assert.match(summary, /delegated via Antigravity SDK/,
    "the cable is the experiment — naming only the models would hide which SDK carried the work");
});

test("--dry-run reports the policy's own models, not a hardcoded pair", { skip }, () => {
  // Same guarantee the SDLC kind makes: the preview has to change with the
  // policy file, or it is confirming a run other than the one you asked about.
  const gen35 = summaryOf(dryRun("all-gemini-flash-high.yaml"));
  const gen25 = summaryOf(dryRun("all-gemini-25-flash-high.yaml"));

  assert.match(gen35, /gemini-3\.5-flash/);
  assert.doesNotMatch(gen35, /gemini-2\.5-flash/);
  assert.match(gen25, /gemini-2\.5-flash/);
  assert.doesNotMatch(gen25, /gemini-3\.5-flash/);

  // Identical everywhere else: same instance, same recipe, same retry ladder.
  // Normalising worker and policy name leaves the instance-invariant summary,
  // so any THIRD difference between the two columns still fails here.
  const strip = (s) => s.replace(/gemini-[23]\.5-flash/g, "<worker>")
    .replace(/all-gemini(-25)?-flash-high/g, "<policy>");
  assert.equal(strip(gen25), strip(gen35));
});

test("--dry-run never prints a timestamp that could pass for a real run", { skip }, () => {
  // A preview that stamps a plausible ISO time is indistinguishable from a
  // captured run once it is a screenshot in a deck.
  assert.doesNotMatch(summaryOf(dryRun("all-gemini-flash-high.yaml")),
    /\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}/);
});

test("every dry-run summary line fits the 80-column grid", { skip }, () => {
  for (const line of summaryOf(dryRun("all-gemini-25-flash-high.yaml")).split("\n")) {
    if (line.length <= 80) continue;
    // Only a single unbreakable token (an instance id, an image tag) may exceed
    // the grid — wrapping one would stop it being copy-pasteable.
    const indent = line.length - line.trimStart().length;
    const longest = Math.max(...line.trim().split(/\s+/).map((w) => w.length));
    assert.ok(indent + longest > 80, `wrappable ${line.length}-column line: ${line}`);
  }
});
