#!/usr/bin/env node
/**
 * bundle-run.mjs — turn ONE harness-matrix run directory into a shareable
 * evidence bundle: a hash-sealed folder a partner can re-verify without
 * trusting anything we say about it.
 *
 * Why this exists. The SDLC orchestrator's own publish path has had
 * tools/swe/build-evidence-bundle.mjs since SWE-06, so a SWE-bench number
 * produced there could always be handed over with its own proof. The harness
 * path had nothing, which meant the delegated cc×SDK verdicts — the ones the
 * dashboard now publishes — rested on "we ran it, here are the numbers". This
 * closes that gap with the same contract: verbatim harness output, the exact
 * patch we submitted, the full trajectory, a re-run recipe, and a sha256 of
 * every file in the bundle.
 *
 * ALLOWLIST, NOT DENYLIST — the single most important decision in this file.
 * A harness run directory is ~880 MB and is NOT safe to copy wholesale:
 *
 *   workdir/            a full repo checkout incl. .git — the bulk of the size
 *   out/claude-config/  a complete Claude Code home directory: .claude.json,
 *                       sessions/, session-env/. This is credential-adjacent
 *                       state that must never leave the machine.
 *   out/_gemini_worker_save/  the SDK's trajectory sqlite DBs — opaque blobs
 *                       of unreviewed content, and 1.6 MB of it.
 *
 * So nothing is copied unless it is named below. A denylist would have shipped
 * whatever the next runtime decides to drop into out/. On top of that, every
 * file that lands in the bundle is scanned for credential shapes and the build
 * ABORTS on a hit rather than writing a bundle someone might send onward.
 *
 * The sealed grading row (grade/sample.jsonl) is deliberately withheld and
 * hashed instead, for the same reason the SDLC orchestrator's own evidence
 * bundles withhold their eval input: a re-verifier should rebuild the grading contract from the public
 * dataset, not accept our copy of the thing we were graded against.
 *
 * Usage:
 *   node tools/harness-matrix/bundle-run.mjs --run-dir <runDir>
 *   node tools/harness-matrix/bundle-run.mjs --all      # every graded run
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The attribution claim and the hand-off lint, imported rather than restated.
// The bundle and the dashboard are two publishers of the same two sentences,
// and a second hand-written copy is how they stop agreeing (2026-07-29, C6).
import { lintRecordedHandoffs, delegationIntegrityNotes } from "./audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RUNS = join(HERE, "runs");

// Pinned in packages/swe-bench/src/pro-harness.ts and used by grade.mjs.
// Repeated here so the bundle is self-contained for a reader who never sees
// this repo — a re-run recipe that says "the commit we use" is not a recipe.
const HARNESS_REPO = "https://github.com/scaleapi/SWE-bench_Pro-os";
const HARNESS_COMMIT = "ca10a60a5fcae51e6948ffe1485d4153d421e6c5";
const DOCKERHUB_USER = "jefzda";
const DATASET = "ScaleAI/SWE-bench_Pro";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};

/** Files copied verbatim from the run root. Missing ones are skipped, not fatal —
 *  a NO_PATCH run has no model.diff and still deserves a bundle. */
const ROOT_FILES = [
  "manifest.json",
  "grade-verdict.json",
  "audit.json",
  "predictions.jsonl",
  "model.diff",
  "raw.diff",
];

/** (sourceDir, bundleDir, filter) — everything else is left behind. */
const TREES = [
  // The grader's own output, verbatim. sample.jsonl is excluded by the filter
  // because it carries the sealed test lists; it gets hashed instead.
  { from: "grade", to: "grade", keep: (rel) => rel !== "sample.jsonl" },
  // The full driver trajectory + gate logs — what actually happened, turn by turn.
  { from: join("out", "phases"), to: "trajectory", keep: () => true },
];

/** Individual out/ files worth shipping: phase I/O, gate baselines, and the
 *  delegation ledger (which worker call cost what). Anything not matched here
 *  — notably claude-config/ and _gemini_worker_save/ — stays on the machine.
 *
 *  Keyed by run kind because the two kinds drop entirely different phase
 *  artefacts into out/: swe-bench-pro writes localize/repro/baseline (it is
 *  fixing an existing repo), sdlc writes requirements/design/packets/review/
 *  judge (it is building a tree from a brief). `common` is what every kind
 *  produces — the container launcher and the delegation ledger, which is the
 *  whole point of the bundle for the delegated cells. Still an allowlist: a
 *  kind whose artefacts are not named here ships nothing but the common set,
 *  which is the safe direction to fail in. */
const OUT_FILE_PATTERNS = {
  common: [
    /^run-in-env\.sh$/,
    /^worker-task-.+\.md$/,
    /^worker-usage-.+\.json$/,
  ],
  "swe-bench-pro": [
    /^localize\.json$/,
    /^repro\.json$/,
    /^baseline\.json$/,
    /^baseline\.log$/,
    /^repro-baseline\.log$/,
  ],
  sdlc: [
    /^requirements\.md$/,
    /^design\.md$/,
    /^packets\.json$/,
    /^execute\.json$/,
    /^review\.md$/,
    /^judge\.json$/,
    /^install\.log$/,
    /^chassis-(?:build|test)\.log$/,
    /^grade-(?:build|test)\.log$/,
  ],
};

/**
 * Resolve a run's identity and packaging rules from its own manifest.
 *
 * Why this is a function and not two inline `??`s (Sriram, 2026-07-28). The
 * bundler shipped SWE-bench-only: it read `manifest.instance_id`, and every
 * downstream use — the corpus instance.json lookup, the bundle title, the
 * re-verify recipe — assumed that value existed. SDLC runs carry no
 * instance_id (they are greenfield: no upstream repo, no upstream fix, no
 * corpus row); their manifest carries `kind: "sdlc"` and `task_id` instead. So
 * `--all` crashed with ERR_INVALID_ARG_TYPE the moment it reached a kudos-wall
 * run — `join(..., undefined, "instance.json")` — and the three SDLC runs that
 * hold 25 worker delegations never got bundled at all.
 *
 * Identity is taken from the manifest first and the verdict only as a fallback,
 * because the manifest is the run's own record of what it ran; the verdict is
 * the grader's record of what it graded. Kind defaults to swe-bench-pro
 * because runs made before the `kind` field existed are all SWE runs.
 */
export function runProfile(manifest, verdict = {}) {
  const kind = manifest.kind ?? "swe-bench-pro";
  const id = manifest.instance_id ?? verdict.instance_id ?? manifest.task_id ?? null;
  if (!id) {
    throw new Error(
      `manifest carries no instance_id and no task_id — cannot name this bundle (kind: ${kind})`
    );
  }
  return {
    kind,
    id,
    // Only swe-bench-pro has a corpus row and a public dataset to re-verify
    // against. Everything gated on this flag would be a false claim on an
    // SDLC bundle, not merely a missing one.
    isSwe: kind === "swe-bench-pro",
    outFilePatterns: [...OUT_FILE_PATTERNS.common, ...(OUT_FILE_PATTERNS[kind] ?? [])],
  };
}

/** Credential shapes. A hit aborts the build — see the header. The patterns are
 *  deliberately broad: a false positive costs one look, a false negative ships
 *  a token. */
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /ya29\.[A-Za-z0-9._-]{20,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:OAUTH_TOKEN|ACCESS_TOKEN|API_KEY|SECRET_KEY)\s*[=:]\s*["']?[A-Za-z0-9._-]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]{24,}/,
];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Copy `from` into `to`, creating parents. */
function place(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function copyTree(fromDir, toDir, keep) {
  if (!existsSync(fromDir)) return;
  for (const abs of listFiles(fromDir)) {
    const rel = relative(fromDir, abs);
    if (!keep(rel)) continue;
    place(abs, join(toDir, rel));
  }
}

/** Every graded run dir under runs/<instance>/<cell>/<stamp>/. */
function allRunDirs() {
  if (!existsSync(RUNS)) return [];
  const out = [];
  for (const inst of readdirSync(RUNS)) {
    const instDir = join(RUNS, inst);
    if (!statSync(instDir).isDirectory()) continue;
    for (const cell of readdirSync(instDir)) {
      const cellDir = join(instDir, cell);
      if (!statSync(cellDir).isDirectory()) continue;
      for (const stamp of readdirSync(cellDir)) {
        const runDir = join(cellDir, stamp);
        if (existsSync(join(runDir, "grade-verdict.json"))) out.push(runDir);
      }
    }
  }
  return out;
}

function bundleOne(runDir) {
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const verdict = JSON.parse(readFileSync(join(runDir, "grade-verdict.json"), "utf8"));
  const { kind, id: instanceId, isSwe, outFilePatterns } = runProfile(manifest, verdict);
  const stamp = runDir.split("/").pop();
  const cell = runDir.split("/").slice(-2, -1)[0];

  const bundle = join(runDir, "evidence-bundle");
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(bundle, { recursive: true });

  for (const f of ROOT_FILES) {
    if (existsSync(join(runDir, f))) place(join(runDir, f), join(bundle, f));
  }
  for (const t of TREES) copyTree(join(runDir, t.from), join(bundle, t.to), t.keep);

  const outDir = join(runDir, "out");
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) {
      if (!outFilePatterns.some((re) => re.test(entry))) continue;
      const abs = join(outDir, entry);
      if (statSync(abs).isDirectory()) continue;
      place(abs, join(bundle, entry.startsWith("worker-") ? join("delegation", entry) : join("phase-io", entry)));
    }
  }

  // The sealed grading row: hashed, never shipped.
  const samplePath = join(runDir, "grade", "sample.jsonl");
  const sampleSha = existsSync(samplePath) ? sha256(samplePath) : null;

  // ---- delegation integrity (2026-07-29, finding C6) ---------------------
  //
  // Re-lint this run's driver→worker hand-offs and publish the result WITH the
  // bundle. Two reasons it happens here rather than being copied out of
  // audit.json:
  //
  //  1. every delegated run on record was executed before the content lint
  //     existed, so their audit.json files say nothing about dictation at all —
  //     the finding would be absent from precisely the artefact a partner reads
  //     instead of trusting us;
  //  2. a bundle should be self-checking. The hand-offs it judges are the same
  //     files it ships in delegation/, so the reader can re-run the lint over
  //     the bundle's own contents and get this number back.
  //
  // Reads only. The run directory is immutable evidence; the one thing this
  // script writes inside it is evidence-bundle/, which it owns and rebuilds
  // from scratch on every invocation (see the rmSync above).
  const audit = existsSync(join(runDir, "audit.json"))
    ? JSON.parse(readFileSync(join(runDir, "audit.json"), "utf8"))
    : null;
  const recheck = lintRecordedHandoffs(join(runDir, "out"), {
    workdir: join(runDir, "workdir"),
  });
  if (recheck.available) {
    // delegation/ already exists whenever there are hand-offs to lint (the
    // worker-task-*.md files are in the common allowlist above), but creating
    // it is cheap and makes the dependency explicit rather than incidental.
    mkdirSync(join(bundle, "delegation"), { recursive: true });
    writeFileSync(
      join(bundle, "delegation", "lint.json"),
      JSON.stringify({
        what: "delegation content lint, re-run over this bundle's own hand-off files",
        generated_by: "tools/harness-matrix/audit.mjs → lintDelegationText",
        thresholds_defended_by: "tools/harness-matrix/fixtures/delegation-corpus (50 labelled hand-offs)",
        critical_checkable: recheck.critical_checkable,
        critical_note:
          "guard-evasion-by-proxy is the only CRITICAL family and cannot be raised by this " +
          "pass: it needs the trajectory's denial ordering. A zero here is not evidence " +
          "against it — see audit.json for the run-time pass.",
        handoffs_scanned: recheck.scanned,
        passages_flagged: recheck.total,
        by_family: recheck.by_family,
        files: recheck.files,
        warnings: recheck.warnings,
      }, null, 2) + "\n"
    );
  }
  const integritySection = delegationIntegrityNotes({
    isSwe, m: manifest, audit, recheck,
  });

  // Both docs below are written per-kind. They are not decoration: the SWE
  // README hands the reader a Scale re-verify recipe against a public dataset
  // row, and none of that exists for a greenfield SDLC run. Emitting the SWE
  // text on an SDLC bundle would be a bundle that documents a verification
  // procedure its reader cannot run — worse than no README.
  if (isSwe) {
    // The agent-safe instance the driver actually saw, so a reader can audit the
    // prompt inputs without going near the corpus. SDLC has no corpus row: its
    // whole prompt input is the brief, pinned by sha256 in manifest.json.
    const corpusInstance = join(ROOT, "studies", "swe-pro-corpus", instanceId, "instance.json");
    if (existsSync(corpusInstance)) place(corpusInstance, join(bundle, "instance.json"));

    writeFileSync(
      join(bundle, "integrity-notes.md"),
      sweIntegrityNotes({ instanceId, cell, stamp, verdict, sampleSha, integritySection })
        .join("\n")
    );

    writeFileSync(
      join(bundle, "README.md"),
      [
        `# Evidence bundle — ${instanceId}`,
        ``,
        `Cell: \`${cell}\` · run \`${stamp}\` · **${verdict.resolved ? "RESOLVED" : "unresolved"}**`,
        ``,
        `## What's here`,
        ``,
        `| Path | What it is |`,
        `| --- | --- |`,
        `| \`model.diff\` | the patch we submitted — the only thing graded |`,
        `| \`predictions.jsonl\` | that patch in the evaluator's input format |`,
        `| \`grade/\` | the evaluator's own output, verbatim (\`out/eval_results.json\` is the verdict) |`,
        `| \`grade-verdict.json\` | our one-line fold of it |`,
        `| \`trajectory/\` | every driver turn, stderr stream and gate log |`,
        `| \`delegation/\` | each worker hand-off: the task it was given, the tokens it billed |`,
        `| \`delegation/lint.json\` | the content lint re-run over those hand-offs — which ones, if any, dictated content rather than specifying an outcome |`,
        `| \`phase-io/\` | phase inputs/outputs + the container launcher the gates used |`,
        `| \`instance.json\` | the agent-safe instance — exactly what the prompt could see |`,
        `| \`manifest.json\` | run identity, cell, phase ladder, cost and token totals |`,
        `| \`audit.json\` | post-run intent audit (git-history mining, test-edit attempts, …) |`,
        ``,
        `## Re-verify yourself (no trust required)`,
        ``,
        `1. Clone Scale's evaluator at the exact commit we ran:`,
        ``,
        "```bash",
        `git clone ${HARNESS_REPO} pro-harness`,
        `git -C pro-harness checkout ${HARNESS_COMMIT}`,
        `python3 -m venv .venv-pro && .venv-pro/bin/pip install pandas tqdm docker requests`,
        "```",
        ``,
        `2. Rebuild the grading row from the PUBLIC dataset — do not take ours. Pull the`,
        `   \`${instanceId}\` row from \`${DATASET}\` (split: test) and write it as a single`,
        `   JSON line into \`sample.jsonl\`. Check it against the sha256 in`,
        `   integrity-notes.md: matching hashes mean we were graded against the`,
        `   unmodified public contract.`,
        ``,
        `3. Grade our patch:`,
        ``,
        "```bash",
        `cd pro-harness && ../.venv-pro/bin/python swe_bench_pro_eval.py \\`,
        `  --raw_sample_path ../sample.jsonl \\`,
        `  --patch_path ../grade/patches.json \\`,
        `  --output_dir ../reverify-out \\`,
        `  --scripts_dir run_scripts \\`,
        `  --dockerhub_username ${DOCKERHUB_USER} \\`,
        `  --use_local_docker --docker_platform linux/amd64 \\`,
        `  --num_workers 1 --block_network --redo`,
        "```",
        ``,
        `4. Compare \`reverify-out/eval_results.json\` with \`grade/out/eval_results.json\`.`,
        `   Shape is \`{instance_id: bool}\`.`,
        ``,
        `5. Audit the run itself: trajectory/ is the unedited turn log, delegation/ is`,
        `   every worker hand-off with its token counts, and integrity-notes.md lists what`,
        `   is enforced in code and what is deliberately not claimed.`,
        ``,
        `File hashes: MANIFEST.sha256`,
      ].join("\n")
    );
  } else {
    writeSdlcDocs({ bundle, id: instanceId, cell, stamp, manifest, verdict, integritySection });
  }

  // Scan BEFORE hashing, and refuse to leave a bundle behind on a hit — a
  // half-written bundle with a token in it is worse than no bundle.
  const files = listFiles(bundle);
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // binary — not a text credential
    }
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) hits.push(`${relative(bundle, f)} (${re})`);
    }
  }
  if (hits.length) {
    rmSync(bundle, { recursive: true, force: true });
    throw new Error(
      `credential-shaped strings found — bundle discarded, nothing written:\n  ${hits.join("\n  ")}`
    );
  }

  const hashes = files
    .map((p) => `${sha256(p)}  ${relative(bundle, p)}`)
    .sort((a, b) => a.split("  ")[1].localeCompare(b.split("  ")[1]));
  writeFileSync(join(bundle, "MANIFEST.sha256"), hashes.join("\n") + "\n");

  console.log(
    `✓ ${instanceId} · ${cell} · ${stamp} → evidence-bundle/ ` +
      `(${hashes.length + 1} files, ${verdict.resolved ? "RESOLVED" : "unresolved"})`
  );
}

/**
 * The integrity notes for a SWE-bench Pro run, as lines.
 *
 * EXTRACTED FROM bundleOne (2026-07-29, finding C6). It was an inline array
 * literal, which meant the only way to check what a shipped bundle actually
 * says was to build one — so the delegation-integrity section it now splices in
 * had no test that it lands in the SWE text at all, only in the SDLC text
 * (which had a function already). Pure and exported, it is testable without a
 * run directory, and bundle-run.test.mjs pins both the splice point and the
 * fact that the SDLC paragraph never appears here.
 *
 * `integritySection` is delegationIntegrityNotes()'s output — empty for a solo
 * run, in which case nothing is spliced and the document is unchanged.
 */
export function sweIntegrityNotes({
  instanceId, cell, stamp, verdict, sampleSha, integritySection = [],
}) {
  return [
    `# Integrity notes — ${instanceId}`,
    ``,
    `Cell: ${cell} · run ${stamp} · verdict ${verdict.resolved ? "RESOLVED" : "unresolved"}`,
    `Grader: ${verdict.grader ?? "scale swe_bench_pro_eval.py"}`,
    ``,
    `Enforced in code (tools/harness-matrix/run-harness.mjs, grade.mjs):`,
    `- The runtime never sees the grading contract. The gold patch, test patch,`,
    `  fail_to_pass, pass_to_pass and the test-file list live in sealed.json in the`,
    `  corpus; validateInstance/assertAgentSafe refuse to start a run that can reach`,
    `  them. Only instance.json (shipped here) goes into the prompt.`,
    `- Grading and running never share a container. The grader pulls Scale's ORIGINAL`,
    `  frozen image with its own entrypoint, not our sealed execution image, and runs`,
    `  with --block_network.`,
    `- The instance repo is fetched once and pinned; the execution container blocks`,
    `  github.com and friends at the host level (see phase-io/run-in-env.sh), so no`,
    `  phase can pull the upstream fix at run time.`,
    `- Every driver turn is in trajectory/ verbatim, including the stderr streams and`,
    `  each gate's own log. Nothing was replayed or re-recorded for this bundle.`,
    ``,
    `Withheld on purpose:`,
    `- grade/sample.jsonl — the sealed grading row we fed the evaluator. You should`,
    `  rebuild it from the public dataset rather than trust our copy of the contract`,
    `  we were graded against. Rebuild, then compare:`,
    `  sha256 = ${sampleSha ?? "(no sealed row — this run was not graded)"}`,
    `- workdir/, out/claude-config/, out/_gemini_worker_save/ — the repo checkout and`,
    `  the two runtime home directories. They hold machine-local and`,
    `  credential-adjacent state and are never packaged. The evidence they would have`,
    `  carried (the patch, the trajectory, the token counts) is here in full.`,
    ``,
    ...(integritySection.length ? [...integritySection, ``] : []),
    `Known caveats (disclosed, not hidden):`,
    `- Model calls go to vendor APIs during patch authoring, as in any live run —`,
    `  network isolation is enforced for the REPO, not for the model. No claim is made`,
    `  that this instance predates any model's training cutoff.`,
    `- Scale's images are x86_64; on an arm64 host they run under emulation. That`,
    `  changes wall-clock, not verdicts.`,
    `- This is ONE instance under ONE cell. It is an attempt, not a rate — do not read`,
    `  a resolve rate off a single bundle.`,
    `- Logs and scripts carry the absolute paths of the machine that ran them. Nothing`,
    `  here was rewritten to tidy that up: "verbatim" is the stronger property, and a`,
    `  bundle whose files have been edited for appearance is a bundle you cannot hash`,
    `  against the originals.`,
  ];
}

/**
 * README + integrity notes for an SDLC (greenfield) run.
 *
 * Deliberately NOT a copy of the SWE text with the words swapped. The two
 * kinds are verifiable in different ways and are honest about different
 * things:
 *
 *   swe-bench-pro  a fix to an existing repo, graded by Scale's evaluator
 *                  against a sealed contract we are not allowed to see. The
 *                  reader's job is to rebuild that contract from the public
 *                  dataset and re-grade our patch.
 *   sdlc           a tree built from a brief, graded by re-running the
 *                  scaffold's own build and tests in the pinned container.
 *                  There is no sealed contract and nothing withheld from the
 *                  prompt — so the honest disclosure is the opposite one: the
 *                  judge scores are a MODEL's opinion, and only the build/test
 *                  exit codes are mechanical.
 */
export function writeSdlcDocs({
  bundle, id, cell, stamp, manifest, verdict, integritySection = [],
}) {
  const tests = verdict.tests ?? {};
  const scores = verdict.judge_scores ?? {};
  const tpl = manifest.template ?? {};
  const scaffold = manifest.scaffold ?? {};

  writeFileSync(
    join(bundle, "integrity-notes.md"),
    [
      `# Integrity notes — ${id} (SDLC)`,
      ``,
      `Cell: ${cell} · run ${stamp} · verdict ${verdict.resolved ? "PASS" : "fail"}`,
      `Grader: ${verdict.grader ?? "scaffold build+test re-run"}`,
      ``,
      `Everything this run was given, pinned by hash:`,
      `- brief    sha256 ${manifest.brief_sha256 ?? "(unpinned)"}`,
      `- template ${tpl.id ?? "?"} v${tpl.version ?? "?"} sha256 ${tpl.sha256 ?? "(unpinned)"}`,
      `- scaffold ${scaffold.id ?? "?"} v${scaffold.version ?? "?"}`,
      `- policy   ${manifest.policy?.name ?? "?"} sha256 ${manifest.policy?.sha256 ?? "(unpinned)"}`,
      `- runtime  ${manifest.runtime?.name ?? "?"} ${manifest.runtime?.version ?? ""}`.trim(),
      ``,
      `Enforced in code (tools/harness-matrix/kinds/sdlc.mjs):`,
      `- The brief is hashed before the run starts and the run aborts on a mismatch,`,
      `  so an edited brief cannot masquerade as the same task.`,
      `- Every stage writes into out/ and is gated before the next one starts; the`,
      `  gate text and the stage's own log are in trajectory/ verbatim.`,
      `- The verify and grade gates run the scaffold's real build and test commands`,
      `  inside the pinned container via phase-io/run-in-env.sh — not a summary of`,
      `  them, and not the agent's own claim about them.`,
      `- The review and judge stages run against the VERIFIED tree and may not`,
      `  modify it; a stage that touches the tree fails its gate.`,
      ``,
      `Nothing is withheld from the prompt for this kind — there is no sealed`,
      `contract, no gold patch and no hidden test list. The whole task is the brief,`,
      `and the brief is reproduced in the run's own phase-io/requirements.md.`,
      ``,
      `Not packaged:`,
      `- workdir/, out/claude-config/, out/_gemini_worker_save/ — the built tree and`,
      `  the two runtime home directories. They hold machine-local and`,
      `  credential-adjacent state. The evidence they would have carried (the diff,`,
      `  the trajectory, the token counts) is here in full.`,
      ``,
      ...(integritySection.length ? [...integritySection, ``] : []),
      `Known caveats (disclosed, not hidden):`,
      `- judge.json is a MODEL's score out of 10, not a measurement. Read it beside`,
      `  review.md and the build/test logs, which are mechanical:`,
      `  build exit ${verdict.build?.exit_code ?? "?"} · tests ${tests.passed ?? "?"}/${tests.total ?? "?"} passed, ${tests.failed ?? "?"} failed`,
      `  · judge overall ${scores.overall ?? "n/a"}/10 (requirements ${scores.requirements_fidelity ?? "n/a"},`,
      `  code ${scores.code_quality ?? "n/a"}, tests ${scores.test_quality ?? "n/a"}).`,
      `- The tests were written by the same run that wrote the code. A green suite`,
      `  proves internal consistency, not that the brief was satisfied — that is`,
      `  what requirements_fidelity is trying (imperfectly) to capture. Who inside`,
      `  the run wrote them is a separate question, answered above under`,
      `  "Delegation integrity".`,
      `- Model calls go to vendor APIs during authoring, as in any live run.`,
      `- This is ONE task under ONE cell. It is an attempt, not a rate.`,
      `- Logs and scripts carry the absolute paths of the machine that ran them.`,
      `  Nothing here was rewritten to tidy that up: "verbatim" is the stronger`,
      `  property, and a bundle whose files have been edited for appearance is a`,
      `  bundle you cannot hash against the originals.`,
    ].join("\n")
  );

  writeFileSync(
    join(bundle, "README.md"),
    [
      `# Evidence bundle — ${id} (SDLC)`,
      ``,
      `Cell: \`${cell}\` · run \`${stamp}\` · **${verdict.resolved ? "PASS" : "fail"}**`,
      ``,
      `A greenfield build: one brief in, one working tree out, graded by re-running`,
      `the scaffold's own build and tests in the pinned container.`,
      ``,
      `## What's here`,
      ``,
      `| Path | What it is |`,
      `| --- | --- |`,
      `| \`model.diff\` | the delivered tree, as a diff against the untouched scaffold |`,
      `| \`raw.diff\` | the same diff before artefact stripping |`,
      `| \`grade-verdict.json\` | build exit, test counts, judge scores — the one-line fold |`,
      `| \`trajectory/\` | every driver turn, stderr stream and stage gate log |`,
      `| \`delegation/\` | each worker hand-off: the task it was given, the tokens it billed |`,
      `| \`delegation/lint.json\` | the content lint re-run over those hand-offs — which ones, if any, dictated content rather than specifying an outcome |`,
      `| \`phase-io/\` | requirements, design, packets, execute, review, judge + the build/test logs and the container launcher |`,
      `| \`manifest.json\` | run identity, brief/template/policy hashes, cost and token totals |`,
      `| \`audit.json\` | post-run intent audit |`,
      ``,
      `## Re-verify yourself`,
      ``,
      `1. Start from the scaffold this run started from: \`scaffolds/${scaffold.id ?? "<scaffold>"}\``,
      `   at v${scaffold.version ?? "?"} (template \`${tpl.id ?? "?"}\` v${tpl.version ?? "?"},`,
      `   sha256 \`${tpl.sha256 ?? "(unpinned)"}\`).`,
      ``,
      `2. Apply \`model.diff\` to it.`,
      ``,
      `3. Re-run the same build and tests the grader ran, in the same image:`,
      ``,
      "```bash",
      `# phase-io/run-in-env.sh is the exact launcher this run used`,
      `./run-in-env.sh "pnpm install --frozen-lockfile && pnpm build && pnpm test"`,
      "```",
      ``,
      `4. Compare against \`grade-verdict.json\`:`,
      `   build exit \`${verdict.build?.exit_code ?? "?"}\`, tests`,
      `   \`${tests.passed ?? "?"}/${tests.total ?? "?"}\` passed with \`${tests.failed ?? "?"}\` failed.`,
      `   Those numbers are mechanical. The judge scores next to them are not —`,
      `   see integrity-notes.md.`,
      ``,
      `5. Audit the run itself: trajectory/ is the unedited turn log, delegation/ is`,
      `   every worker hand-off with its token counts, and integrity-notes.md lists`,
      `   what is enforced in code and what is deliberately not claimed.`,
      ``,
      `File hashes: MANIFEST.sha256`,
    ].join("\n")
  );
}

// CLI entry only when this file IS the process entry point. Guarded so the
// unit tests can import runProfile without the module exiting the test runner
// on its usage check.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const targets = args.includes("--all")
    ? allRunDirs()
    : [resolve(opt("run-dir") ?? "")].filter((d) => d && existsSync(d));

  if (targets.length === 0) {
    console.error("usage: bundle-run.mjs --run-dir <runDir> | --all");
    process.exit(1);
  }
  for (const t of targets) bundleOne(t);
}
