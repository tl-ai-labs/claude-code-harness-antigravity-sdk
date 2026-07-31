/**
 * scaffold-manifest.test — the committed integrity manifests must agree with
 * the scaffolds they describe, checked offline on every `pnpm test`.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION. The SDLC VERIFY stage hashes each
 * chassis file in the workdir against `scaffold.manifest.json`. When the
 * manifest is stale the run fails at its LAST stage, after every token has been
 * spent, with a message that reads `pnpm-workspace.yaml: content changed` — an
 * accusation against the model. That is what happened on 2026-07-31: a commit
 * that edited one COMMENT in `scaffolds/service-web/pnpm-workspace.yaml` left
 * the hand-maintained manifest behind, and the next paid SDLC run failed VERIFY
 * on a chassis no model had touched. Diagnosing it cost a live run and an
 * afternoon, and the same edit would have failed identically for every model,
 * which is precisely why no amount of reading the transcript pointed at the
 * cause.
 *
 * The first assertion below turns that into a red test in milliseconds, at $0,
 * on the commit that causes it — and its failure message carries the one-line
 * `--write` remedy, so the fix is shorter than the diagnosis ever was.
 *
 * The remaining tests guard the DERIVATION, because a generator that quietly
 * stops covering a file is worse than a hand-typed manifest: it reports current
 * while checking nothing. They pin the three behaviours the integrity gate
 * depends on — slot files excluded, partial files listed but exempt, chassis
 * files hashed — against a synthetic scaffold rather than the real one, so they
 * keep testing the rule after the real scaffold's contents change.
 *
 * @see scaffold-manifest.mjs — the generator, and the full "why" write-up
 * @see kinds/sdlc.mjs        — the VERIFY gate these manifests feed
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/** This file's own directory — run-harness.mjs's cwd for the wiring test at the
 * bottom, which drives the real CLI rather than importing an internal. */
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
import {
  buildManifest, checkManifest, writeManifest, serialise,
  slotToRegExp, listScaffoldFiles, allScaffoldDirs,
} from "./scaffold-manifest.mjs";

// ---------------------------------------------------------------------------
// The assertion this file exists for.
// ---------------------------------------------------------------------------

test("every committed scaffold manifest matches its scaffold", () => {
  const dirs = allScaffoldDirs();
  // A guard on the guard: if the scaffold walk ever returns nothing — a moved
  // directory, a renamed descriptor — the loop below passes vacuously and a
  // stale manifest ships behind a green suite.
  assert.ok(dirs.length > 0, "no scaffolds found — the manifest check is not seeing them");

  for (const dir of dirs) {
    const { ok, drift } = checkManifest(dir);
    assert.ok(ok,
      `${basename(dir)}: scaffold.manifest.json is stale, so EVERY SDLC run will ` +
      `fail VERIFY and blame the model:\n  ${drift.join("\n  ")}\n\n` +
      `Fix: node tools/harness-matrix/scaffold-manifest.mjs --write`);
  }
});

// ---------------------------------------------------------------------------
// The derivation. Synthetic scaffolds, so these keep asserting the RULE after
// the real scaffold's file list changes.
// ---------------------------------------------------------------------------

/** A throwaway scaffold on disk: a descriptor plus the files given. */
function fixture(slots, files) {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-manifest-test-"));
  writeFileSync(join(dir, "scaffold.json"), JSON.stringify(
    { scaffold_id: "fixture", version: "9.9.9", slots }, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

test("a slot subtree is the model's — never hashed", () => {
  const dir = fixture(["src/modules/**"], {
    "src/modules/index.ts": "export {};",
    "src/modules/kudos/kudos.service.ts": "class S {}",
    "src/main.ts": "bootstrap();",
  });
  try {
    const m = buildManifest(dir);
    assert.deepEqual(Object.keys(m.files), ["scaffold.json", "src/main.ts"],
      "hashing a slot file would fail every successful run — the model is supposed to write there");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a `#section` slot is listed AND exempted, not excluded", () => {
  const dir = fixture(["prisma/schema.prisma#models"], {
    "prisma/schema.prisma": "datasource db {}\n",
  });
  try {
    const m = buildManifest(dir);
    // Listed: the inventory of what ships stays complete, and its pristine
    // bytes are on record. Exempt: the integrity loop skips `partial_files`,
    // because the model legitimately appends to this one.
    assert.ok("prisma/schema.prisma" in m.files, "a shared file must still be inventoried");
    assert.deepEqual(m.partial_files, ["prisma/schema.prisma"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a chassis file is hashed, and any byte change is drift", () => {
  const dir = fixture([], { "tsconfig.json": "{}\n" });
  try {
    writeManifest(dir);
    assert.equal(checkManifest(dir).ok, true, "freshly written manifest must be current");

    // The exact 2026-07-31 failure, in miniature: a COMMENT changes and nothing
    // else. The gate hashes whole bytes, so this must register as drift.
    writeFileSync(join(dir, "tsconfig.json"), "{} // reworded comment\n");
    const { ok, drift } = checkManifest(dir);
    assert.equal(ok, false, "a comment-only edit still moves the hash the VERIFY gate compares");
    assert.match(drift.join("\n"), /tsconfig\.json: hash is stale/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file added to the scaffold cannot slip past the manifest unhashed", () => {
  const dir = fixture([], { "tsconfig.json": "{}\n" });
  try {
    writeManifest(dir);
    mkdirSync(join(dir, "src/platform"), { recursive: true });
    writeFileSync(join(dir, "src/platform/config.ts"), "export const c = 1;");
    const { ok, drift } = checkManifest(dir);
    assert.equal(ok, false, "an unlisted chassis file is an unpoliced chassis file");
    assert.match(drift.join("\n"), /src\/platform\/config\.ts: in the scaffold, absent from the manifest/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file deleted from the scaffold is dropped from the manifest", () => {
  const dir = fixture([], { "tsconfig.json": "{}\n", "gone.txt": "x" });
  try {
    writeManifest(dir);
    rmSync(join(dir, "gone.txt"));
    const { ok, drift } = checkManifest(dir);
    // Left in place, VERIFY would report `gone.txt: missing` on every run —
    // the same false accusation as a stale hash, from the opposite direction.
    assert.equal(ok, false);
    assert.match(drift.join("\n"), /gone\.txt: in the manifest, not in the scaffold/);
    writeManifest(dir);
    assert.equal("gone.txt" in buildManifest(dir).files, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the manifest never contains its own hash", () => {
  const dir = fixture([], { "tsconfig.json": "{}\n" });
  try {
    writeManifest(dir);
    assert.equal("scaffold.manifest.json" in buildManifest(dir).files, false,
      "a file cannot hash itself — it would be stale the instant it is written");
    // And writing twice is a fixed point, which is what makes `--check` in CI
    // meaningful rather than perpetually red.
    const once = readFileSync(join(dir, "scaffold.manifest.json"), "utf8");
    writeManifest(dir);
    assert.equal(readFileSync(join(dir, "scaffold.manifest.json"), "utf8"), once);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--write emits exactly the bytes --check compares against", () => {
  const dir = fixture([], { "tsconfig.json": "{}\n" });
  try {
    writeManifest(dir);
    assert.equal(readFileSync(join(dir, "scaffold.manifest.json"), "utf8"),
      serialise(buildManifest(dir)),
      "if the serialisation drifted, --check would report drift that --write cannot fix");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("slot globs match by path segment, and `**` spans depth", () => {
  assert.equal(slotToRegExp("src/modules/**").test("src/modules/a/b/c.ts"), true);
  assert.equal(slotToRegExp("src/modules/**").test("src/modules/index.ts"), true);
  assert.equal(slotToRegExp("src/modules/**").test("src/platform/config.ts"), false);
  // A single `*` must not cross a `/`, or `src/*` would swallow the whole tree
  // and leave the chassis unchecked.
  assert.equal(slotToRegExp("src/*").test("src/main.ts"), true);
  assert.equal(slotToRegExp("src/*").test("src/platform/config.ts"), false);
  // Dots are literal: `a.ts` must not match `axts`.
  assert.equal(slotToRegExp("src/a.ts").test("src/axts"), false);
});

test("installed dependencies and build output are not part of a scaffold", () => {
  const dir = fixture([], {
    "tsconfig.json": "{}\n",
    "node_modules/left-pad/index.js": "module.exports = 1;",
    "dist/main.js": "1",
  });
  try {
    assert.deepEqual(listScaffoldFiles(dir), ["scaffold.json", "tsconfig.json"],
      "hashing node_modules would make the manifest machine-specific and the gate meaningless");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// The gate that spends nothing: run-harness must refuse to start on drift.
// ---------------------------------------------------------------------------

/**
 * Everything above proves the CHECK is correct. This proves it is WIRED — that
 * a paid invocation consults it before spending, not after.
 *
 * The distinction is the whole point of the 2026-07-31 incident. The check
 * already existed in `pnpm test` on the day the run died; what did not exist
 * was anything forcing `pnpm test` to have been run since the last commit. A
 * correct check nobody is obliged to run is a convention, and conventions are
 * what the stale manifest slipped through in the first place.
 *
 * Asserted through the real CLI rather than by importing an internal, because
 * the property under test is a property of the ENTRY POINT: exit 2, before the
 * kind module loads, before credentials, before Docker, before a token. It
 * drifts the real scaffold on disk, so it must restore it in `finally` — a
 * crash here that left the manifest dirty would break every later test in the
 * suite and look like a much stranger bug than it is.
 */
test("run-harness refuses to start when a scaffold manifest is stale", () => {
  const dirs = allScaffoldDirs();
  assert.ok(dirs.length > 0, "no scaffolds found — this test would pass vacuously");
  const scaffoldDir = dirs[0];
  const manifestPath = join(scaffoldDir, "scaffold.manifest.json");
  const original = readFileSync(manifestPath, "utf8");

  // Corrupt exactly one hash — the minimal, realistic drift. A reworded comment
  // in a chassis file produces precisely this shape.
  const doctored = JSON.parse(original);
  const victim = Object.keys(doctored.files)[0];
  doctored.files[victim] = "0".repeat(64);

  try {
    writeFileSync(manifestPath, serialise(doctored));

    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [
        "run-harness.mjs", "--kind", "sdlc", "--task-dir", "../../examples/uptime-ping",
        "--runtime", "claude-code", "--policy", "policies/all-gemini-flash-high.yaml",
        "--dry-run",
      ], { cwd: HARNESS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      status = err.status;
      stderr = String(err.stderr ?? "");
    }

    assert.equal(status, 2,
      "stale manifest must exit 2 (preflight, nothing spent), not 1 (infrastructure) " +
      "and certainly not 0");
    assert.match(stderr, new RegExp(victim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the error has to name the file whose hash moved — the 2026-07-31 diagnosis " +
      "was long precisely because the failure named a symptom, not a cause");
    assert.match(stderr, /scaffold-manifest\.mjs --write/,
      "the remedy belongs in the message; a reader should not have to find this test");

    // --dry-run is included on purpose: the preview is the cheap rehearsal, so a
    // preview that would not have caught this is not a preflight at all.
  } finally {
    writeFileSync(manifestPath, original);
  }
});
