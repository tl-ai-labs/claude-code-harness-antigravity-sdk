/**
 * scaffold-manifest — derive a scaffold's integrity manifest from the scaffold
 * itself, and prove offline that the committed manifest still matches.
 *
 * WHAT THE MANIFEST IS FOR. An SDLC run copies `scaffolds/<id>/` into a
 * workdir and lets the models build inside it. Only the SLOTS are theirs:
 * `src/modules/**`, `test/modules/**`, and the models section of
 * `prisma/schema.prisma`. Everything else is the chassis — the build config,
 * the platform wiring, the conventions, the lockfile — and a model that edits
 * the chassis has not solved the task, it has moved the goalposts. The VERIFY
 * stage catches that by hashing every chassis file in the workdir against
 * `scaffold.manifest.json` (see `kinds/sdlc.mjs`, the `integrityViolations`
 * loop). A mismatch fails the stage outright and is deliberately NOT repairable
 * — a repair round would just be the model editing the chassis again.
 *
 * WHY THIS FILE EXISTS (2026-07-31). That gate compares whole-file sha256s, so
 * it cannot distinguish "a model rewrote the build config" from "a human edited
 * a COMMENT in the scaffold and forgot to re-stamp the manifest". Both read as
 * `content changed`. The manifest was hand-maintained, and on 2026-07-31 a
 * commit that touched nothing but a comment in `pnpm-workspace.yaml` —
 * rewording "study-console workspace" to "repository workspace that contains
 * it" — desynchronised it. Every SDLC run after that commit failed VERIFY on
 * `pnpm-workspace.yaml: content changed`, for every model equally, on a chassis
 * no model had touched. The cost of finding that out was a live paid run and an
 * afternoon, because the failure surfaces only at the last stage of a run that
 * has already spent its money, and it accuses the model.
 *
 * A hand-typed hash of a file that lives beside it is a fact stored twice. The
 * fix is not to be more careful; it is to stop storing it twice. This module
 * DERIVES the manifest from the scaffold — file list and hashes both — so the
 * only way to desynchronise them is to skip the regeneration, which
 * `scaffold-manifest.test.mjs` turns into a red test in milliseconds at $0
 * instead of a false accusation at the end of a paid run.
 *
 * WHAT IS DERIVED, AND FROM WHERE. `scaffold.json` already declares the slots.
 * This reads them and sorts every file in the scaffold into one of three
 * buckets, so the manifest never restates a decision `scaffold.json` has
 * already made:
 *
 *   - slot glob with no `#` fragment (`src/modules/**`)  → the file is the
 *     model's outright. Omitted from the manifest entirely — hashing it would
 *     fail every successful run.
 *   - slot with a `#` fragment (`prisma/schema.prisma#models`) → the file is
 *     SHARED: chassis prologue, model-owned section. Listed in `files` (so the
 *     inventory is complete and its pristine bytes are recorded) AND in
 *     `partial_files`, which is what makes the integrity loop skip it. It is
 *     policed instead by the append-only prefix rule in `kinds/sdlc.mjs`.
 *   - everything else → chassis. Hashed, and enforced byte-for-byte.
 *
 * `scaffold.manifest.json` excludes itself for the obvious reason: a file
 * cannot contain its own hash.
 *
 * HOW TO RUN IT. `--check` (the default) exits 1 and names the drift; `--write`
 * re-stamps the file. See the CLI block at the bottom.
 *
 * @see kinds/sdlc.mjs                — the VERIFY-stage gate this feeds
 * @see scaffolds/service-web/CONVENTIONS.md — the same rule, stated to the model
 * @see scrub-paths.mjs               — the --check/--write CLI shape followed here
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCAFFOLDS_ROOT = join(HERE, "..", "..", "scaffolds");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Never part of a scaffold's shipped surface: installed dependencies, build
// output, and the OS's own directory litter.
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".turbo"]);
const SKIP_FILES = new Set([".DS_Store"]);

/**
 * Minimal glob → RegExp for the two shapes slots actually use: `**` (any depth,
 * including none) and `*` (one path segment). Deliberately not a general glob
 * engine — a slot expression that needs more than this is a signal the slot
 * layout has changed and should be read by a human, not silently half-matched.
 */
export function slotToRegExp(glob) {
  // `**` is substituted first, via a placeholder, so the `*` rule below cannot
  // chew through the second star of a `**` and turn it into two single-segment
  // matches.
  // Written as the ESCAPE, never as a raw NUL byte in the source: a literal
  // U+0000 makes grep classify this file as binary and skip it, which is
  // exactly the wrong property for a file whose job is being auditable.
  const DOUBLE = "\u0000";
  const escaped = glob
    .replace(/\*\*/g, DOUBLE)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .split(DOUBLE).join(".*");
  return new RegExp(`^${escaped}$`);
}

/** Every file in `dir`, as paths relative to it, POSIX-separated and sorted. */
export function listScaffoldFiles(dir) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
      const child = join(abs, entry);
      if (statSync(child).isDirectory()) walk(child);
      else out.push(relative(dir, child).split(/[\\/]/).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Build the manifest a scaffold directory implies. Pure with respect to the
 * repo: reads the scaffold, returns an object, writes nothing.
 */
export function buildManifest(scaffoldDir) {
  const descriptorPath = join(scaffoldDir, "scaffold.json");
  if (!existsSync(descriptorPath)) {
    throw new Error(`${scaffoldDir}: no scaffold.json — not a scaffold directory`);
  }
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const slots = descriptor.slots ?? [];

  // A slot may name a whole subtree (`src/modules/**`) or a section inside one
  // file (`prisma/schema.prisma#models`). Split them here; they get opposite
  // treatment below.
  const ownedGlobs = [];
  const partialFiles = new Set();
  for (const slot of slots) {
    const hash = slot.indexOf("#");
    if (hash === -1) ownedGlobs.push(slotToRegExp(slot));
    else partialFiles.add(slot.slice(0, hash));
  }

  const files = {};
  for (const rel of listScaffoldFiles(scaffoldDir)) {
    if (rel === "scaffold.manifest.json") continue;          // cannot hash itself
    if (!partialFiles.has(rel) && ownedGlobs.some((re) => re.test(rel))) continue;
    files[rel] = sha256(readFileSync(join(scaffoldDir, rel)));
  }

  // Only slots that actually resolve to a file are recorded, so a slot removed
  // from `scaffold.json` cannot leave a phantom exemption behind that quietly
  // stops the integrity loop checking a real chassis file.
  const partial = [...partialFiles].filter((f) => f in files).sort();

  return {
    scaffold_id: descriptor.scaffold_id,
    version: descriptor.version,
    slots,
    files,
    partial_files: partial,
  };
}

/** The exact bytes `--write` emits, so `--check` compares like for like. */
export const serialise = (manifest) => JSON.stringify(manifest, null, 2) + "\n";

/**
 * Compare the committed manifest against the one the scaffold implies.
 * Returns `{ ok, drift }` where each drift entry is human-readable and names
 * the remedy's units — a file and what changed about it.
 */
export function checkManifest(scaffoldDir) {
  const expected = buildManifest(scaffoldDir);
  const path = join(scaffoldDir, "scaffold.manifest.json");
  if (!existsSync(path)) return { ok: false, expected, drift: ["scaffold.manifest.json: missing"] };

  const actual = JSON.parse(readFileSync(path, "utf8"));
  const drift = [];

  for (const key of ["scaffold_id", "version"]) {
    if (actual[key] !== expected[key]) {
      drift.push(`${key}: manifest says ${JSON.stringify(actual[key])}, scaffold.json says ${JSON.stringify(expected[key])}`);
    }
  }
  const sameList = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!sameList(actual.slots, expected.slots)) drift.push(`slots: no longer match scaffold.json`);
  if (!sameList(actual.partial_files, expected.partial_files)) drift.push(`partial_files: no longer match scaffold.json's slots`);

  const actualFiles = actual.files ?? {};
  for (const [file, hash] of Object.entries(expected.files)) {
    if (!(file in actualFiles)) drift.push(`${file}: in the scaffold, absent from the manifest (unchecked at VERIFY)`);
    else if (actualFiles[file] !== hash) drift.push(`${file}: hash is stale — manifest ${actualFiles[file].slice(0, 12)}…, actual ${hash.slice(0, 12)}…`);
  }
  for (const file of Object.keys(actualFiles)) {
    if (!(file in expected.files)) drift.push(`${file}: in the manifest, not in the scaffold (VERIFY would fail on "missing")`);
  }

  return { ok: drift.length === 0, expected, drift };
}

/** Re-stamp the manifest. Returns the drift it repaired, for the CLI to print. */
export function writeManifest(scaffoldDir) {
  const { ok, expected, drift } = checkManifest(scaffoldDir);
  if (!ok) writeFileSync(join(scaffoldDir, "scaffold.manifest.json"), serialise(expected));
  return { changed: !ok, drift };
}

/** Every scaffold in the repo, so callers never hand-maintain a second list. */
export const allScaffoldDirs = () =>
  readdirSync(SCAFFOLDS_ROOT)
    .map((name) => join(SCAFFOLDS_ROOT, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, "scaffold.json")))
    .sort();

function usage(msg) {
  console.error(
    `${msg}\n\n` +
    `usage: node tools/harness-matrix/scaffold-manifest.mjs [--check | --write] [--scaffold <id>]\n\n` +
    `  --check          (default) exit 1 if any committed manifest is stale\n` +
    `  --write          re-derive and re-stamp the manifest(s)\n` +
    `  --scaffold <id>  just one scaffold; default is every scaffold in scaffolds/\n`);
  process.exit(2);
}

function cliMain(argv) {
  const write = argv.includes("--write");
  if (write && argv.includes("--check")) usage("--check and --write are mutually exclusive");

  const at = argv.indexOf("--scaffold");
  if (at !== -1 && !argv[at + 1]) usage("--scaffold needs a scaffold id");
  const dirs = at === -1 ? allScaffoldDirs() : [join(SCAFFOLDS_ROOT, argv[at + 1])];
  if (!dirs.length) usage(`no scaffolds found under ${SCAFFOLDS_ROOT}`);

  let stale = 0;
  for (const dir of dirs) {
    const id = relative(SCAFFOLDS_ROOT, dir);
    if (write) {
      const { changed, drift } = writeManifest(dir);
      if (!changed) console.log(`scaffold-manifest: ${id} was already current.`);
      else console.log(`scaffold-manifest: ${id} re-stamped —\n  ${drift.join("\n  ")}`);
      continue;
    }
    const { ok, drift } = checkManifest(dir);
    if (ok) console.log(`scaffold-manifest: ${id} is current.`);
    else {
      stale++;
      // This message is read by whoever broke it, at the moment they broke it,
      // so it carries the whole remedy rather than a diagnosis to look up.
      console.error(
        `scaffold-manifest: ${id} is STALE. The SDLC VERIFY stage hashes these\n` +
        `files and will fail every run — blaming the model — until they agree:\n  ` +
        drift.join("\n  ") +
        `\n\nFix: node tools/harness-matrix/scaffold-manifest.mjs --write --scaffold ${id}`);
    }
  }
  if (stale) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain(process.argv.slice(2));
}
