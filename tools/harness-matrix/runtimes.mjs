/**
 * runtimes.mjs — thin per-runtime adapters for the harness matrix.
 *
 * The whole point of this file being SMALL: the scaffold (run-harness.mjs)
 * owns the loop, the phases, the gates, the retries and the logging — an
 * adapter only answers "invoke this CLI headless on this prompt, in this
 * workdir, and report what it cost". Any procedural difference between
 * runtimes beyond the invocation itself would become an alternative
 * explanation of the study's result (DESIGN §3), so nothing else lives here.
 * A future runtime (Codex CLI, the SDK-based Antigravity harness, …) is one
 * new entry in RUNTIMES.
 *
 * Adapter contract (DESIGN §6):
 *   runPhase({ binding, thinking, prompt, workdir, outDir, logPrefix,
 *              timeoutMin, budgetUsd })
 *     → { exitCode, wallSeconds, timedOut,
 *         costUsd|null, numTurns|null, resolvedModel|null, logFile }
 *
 * File-output rule (preflight #70): nothing load-bearing is parsed from
 * stdout — phase results are the contract files the runtime writes to
 * outDir. What IS read back here is claude-code's stream-json result event
 * (cost/turn accounting), which is telemetry, not phase output. The live
 * terminal narration (makePhaseNarrator) also parses the stream, but it is
 * print-only by contract — it can inform the watcher, never the run.
 *
 * 2026-07-23: the `antigravity` runtime (agy CLI) was removed and the
 * delegated cc×Gemini worker was moved from the parked `agy` CLI onto the
 * Antigravity SDK (google-antigravity) — see the block at the end of RUNTIMES
 * and renderWorkerSkill.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
// Shared with the post-run audit so the real-time PreToolUse block and the
// post-hoc intent audit agree by construction: the same heredoc stripper feeds
// the delegation counter here and the tree-write detector in both places.
import { stripHeredocs, GUARD_DENIAL_MARK, GUARD_TREE_WRITE_MARK } from "./audit.mjs";
// The shared terminal voice (2026-07-25 demo-grade logging): whole-line ANSI
// painters + number formatters, so the narrator's lines match the kinds'
// banners visually. Presentation-only — see logfmt.mjs's contract.
import { paint, fmtInt, ACTOR, gutter, cachePct, say } from "./logfmt.mjs";

// This file's own directory — anchors the default worker venv + worker script
// paths for the delegated cc×Gemini cell (see renderWorkerSkill).
const HERE = dirname(fileURLToPath(import.meta.url));
// The Gemini worker (SDK) that replaced the parked `agy` CLI worker. The venv
// that runs it is built per sdk-probe/README.md (Python >= 3.10 +
// google-antigravity); GEMINI_WORKER_PYTHON overrides the path so a machine
// that keeps the venv elsewhere needs no code edit.
const WORKER_SCRIPT = join(HERE, "gemini_worker.py");
const workerPython = () =>
  process.env.GEMINI_WORKER_PYTHON || join(HERE, "sdk-probe", "sdkprobe", "bin", "python");
// Homebrew's libexpat is not on the default loader path on this Mac; the SDK
// venv's pyexpat needs it (sdk-probe/README.md). Threaded into every worker
// invocation and the import preflight so neither trips over it.
const WORKER_DYLD = process.env.GEMINI_WORKER_DYLD || "/opt/homebrew/opt/expat/lib";
// The audit module, reused live by the PreToolUse tree-write hook so the
// real-time block and the post-run intent audit share one predicate.
const AUDIT_MJS = join(HERE, "audit.mjs");

/**
 * The DELEGATED binding form (cc×gemini cell, Google email ask 3b):
 * a claude-code binding may be `{ driver, worker, worker_thinking,
 * worker_region }` instead of a model string. Both `worker_*` keys are OMITTED
 * rather than nulled when the policy does not declare them (v1 policies never
 * carry `worker_region` at all), so an absent key means "the policy did not
 * say" and the worker applies its own default.
 * `driver` is the Anthropic model in Claude Code's seat
 * (not removable — `claude` has no non-Anthropic --model, so this cell is
 * inherently two-model and is REPORTED as such); `worker` is the Gemini SDK
 * model id (e.g. `gemini-3.5-flash-lite`) the driver must delegate substantive work
 * to, reached through the Antigravity SDK (google-antigravity) — NOT the `agy`
 * CLI, which this team parked 2026-07-21. The SDK serves Gemini on its
 * verified-working path (probe_vertex.py) and returns real UsageMetadata, which
 * the prose-only CLI never did. Mechanics: a session Skill provisioned in a
 * per-run CLAUDE_CONFIG_DIR (never in the workdir — the workdir is the diff
 * anchor and gates fail on undeclared files) tells the driver to shell out to
 * gemini_worker.py once per task; a delegation counter parsed from the driver's
 * trajectory keeps a run where the driver quietly did the work itself from ever
 * passing as a Gemini result.
 */
export const isDelegated = (binding) =>
  typeof binding === "object" && binding !== null;

/**
 * KIND VOCABULARY for the delegated Skill preamble (2026-07-25).
 *
 * The Skill's *rules* are structural and kind-agnostic — delegate first, never
 * author, the scaffold fails a zero-delegation attempt. Its *examples* were
 * not: they named repro/localize/patch and wrote a `repro.json` contract, which
 * is SWE-bench Pro's vocabulary and is simply false on an SDLC cell (whose
 * stages are requirements → design → plan-packets → execute → verify and whose
 * contract files are design.md / packets.json / execute.json). A driver told it
 * is in the "patch phase" of a task that has no patch phase is being lied to in
 * its own mandate, which is the last place a prompt should be wrong.
 *
 * Why a parameter and not an edit: this preamble is part of the SWE-bench Pro
 * prompts' BYTES, and the kinds split (f256cb0) is guaranteed byte-identical
 * for Pro. So Pro passes its own literals back verbatim — PRO_VOCAB below is a
 * transcription of what the function used to hard-code, and the byte-identity
 * of the rendered Pro skill is asserted in guard.test.mjs rather than trusted.
 *
 * The DEFAULT is deliberately the neutral wording, not Pro's. A future kind
 * that forgets to pass a vocab then reads as generic-but-true instead of
 * silently inheriting SWE-bench vocabulary on a task that has no bug to fix —
 * wrong-domain text is far harder to notice than vague text.
 */
const NEUTRAL_VOCAB = {
  substantiveSteps: "EVERY substantive step — every analysis, every decision, and\n  every line of code",
  everyPhaseAside: "",
  phaseList: "phase attempt",
  readOnlyBullet: [],
  contractFile: "<phase>.json",
  contractBody: '{"<field>": "<value>"}',
  ownWork: "the analysis,\n  the decisions, or the authoring",
};

const PRO_VOCAB = {
  substantiveSteps: "EVERY substantive step — the reproduction, the localization analysis, and\n  the fix",
  everyPhaseAside: " (yes, including read-only LOCALIZE)",
  phaseList: "phase attempt (repro, localize, or patch)",
  readOnlyBullet: [
    "- LOCALIZE is delegated too, and it is READ-ONLY: hand the worker the",
    "  ANALYSIS task (find which NON-TEST source files hold the bug + which",
    "  surrounding test_command exercises it) and tell it to ONLY read and",
    "  report — it must NOT edit any repository file in this phase, or the",
    "  read-only gate fails. Then YOU write localize.json from its findings.",
  ],
  contractFile: "repro.json",
  contractBody: '{"command": "<inner repro command>", "files": ["<path containing harness_repro>"]}',
  ownWork: "the analysis,\n  the reproduction, or the fix",
};

// The SDLC kind's own stage vocabulary (template sdlc-mini: requirements →
// design → plan-packets → execute → verify). The three planning stages leave
// the repo untouched, so the read-only bullet has a real referent here too —
// it just names a different set of stages than Pro's single LOCALIZE.
const SDLC_VOCAB = {
  substantiveSteps: "EVERY substantive step — the requirements, the design, the packet plan,\n  and the implementation",
  everyPhaseAside: " (yes, including the read-only planning stages)",
  phaseList: "stage attempt (requirements, design, plan-packets, execute, or a verify repair)",
  readOnlyBullet: [
    "- The PLANNING stages (requirements, design, plan-packets) are delegated",
    "  too, and they are READ-ONLY: hand the worker the analysis or authoring",
    "  task and tell it to ONLY read the repo and report — it must NOT change a",
    "  repository file in these stages, or the read-only gate fails. Then YOU",
    "  write that stage's contract file from what it returns.",
  ],
  contractFile: "packets.json",
  contractBody: '{"packets": [{"id": "<kebab-id>", "title": "<title>", "goal": "<goal>", "files_hint": ["<slot path>"]}]}',
  ownWork: "the analysis,\n  the design, or the implementation",
};

export const DELEGATION_VOCAB = { neutral: NEUTRAL_VOCAB, swepro: PRO_VOCAB, sdlc: SDLC_VOCAB };

/**
 * Share of the phase clock a single worker delegation may consume.
 *
 * WHY this constant exists (DESIGN §11, recorded defect 3 — fixed 2026-07-25).
 * The Skill used to render `--timeout <phase_timeout_min>`, i.e. it authorised
 * ONE gemini_worker.py call to eat the entire phase attempt. That is the same
 * nesting error as defect 1 (cmd == phase), one level deeper: whatever clock a
 * nested step is given, the step that owns it needs the remainder to react. A
 * driver whose worker consumed the whole phase has no time left to verify the
 * result, re-delegate after a bad answer, or write the contract file the gate
 * requires — so the attempt fails for lack of runway rather than for lack of
 * capability, and the manifest cannot tell those two apart.
 *
 * 60/40 rather than 50/50 because the work is genuinely lopsided: the worker
 * does the analysis and the authoring, the driver only composes, verifies and
 * writes contracts. The floor of 3 min keeps the split sane if someone sets a
 * very small phase timeout in a future policy.
 */
const WORKER_CLOCK_SHARE = 0.6;

/**
 * Worker's slice of one phase attempt, in minutes.
 *
 * The `Math.min(…, phase - 1)` clamp is the invariant, not a rounding nicety:
 * a nested budget that can equal or exceed its parent is exactly the bug this
 * function exists to fix, and a future policy with a small phase_timeout_min
 * must not be able to reintroduce it through the rounding. (At the degenerate
 * phase_timeout_min of 1 the clamp floors at 1 and the two are equal — a
 * one-minute phase has no room to split, and no real policy sets one.)
 */
export function workerTimeoutMin(phaseTimeoutMin) {
  const share = Math.round(phaseTimeoutMin * WORKER_CLOCK_SHARE);
  return Math.max(1, Math.min(share, phaseTimeoutMin - 1));
}

/**
 * Render the gemini-worker SKILL.md for the delegated cell. Written fresh per
 * run because workdir/outDir/timeout are per-run values the skill must quote
 * exactly. The skill tells the driver to shell out to gemini_worker.py (the SDK
 * worker) once per delegated task and read the reply on stdout — the same
 * one-call-per-task shape the parked `agy -p` cable had, minus the CLI.
 */
export function renderWorkerSkill({ worker, workerThinking, workerRegion, workdir, outDir, timeoutMin, slot, vocab }) {
  const v = vocab ?? NEUTRAL_VOCAB;
  const py = workerPython();
  // `timeoutMin` is the PHASE budget; the worker gets a strict fraction of it
  // so the driver keeps runway to verify and re-delegate (defect 3, above).
  const timeoutSec = workerTimeoutMin(timeoutMin) * 60;
  // Every worker file is namespaced to THIS phase-attempt (slot, e.g.
  // `repro-a2`). Each phase runs as a fresh, stateless `claude -p`, so the
  // driver always restarts its "fresh integer N" at 1 — without the slot the
  // next phase's worker-usage-1.json overwrites this phase's, and a failed
  // 0-delegation attempt's readWorkerUsage would pick up the previous phase's
  // leftover sidecar (both bugs seen in the 2026-07-23 navidrome run). The slot
  // makes filenames unique per attempt: nothing is overwritten and the manifest
  // reads back only this attempt's own sidecars.
  return [
    "---",
    "name: gemini-worker",
    "description: >-",
    "  MANDATORY in this session: you are the DRIVER, not the engineer. You have",
    "  NO file-editing tools (Edit, Write, NotebookEdit, MultiEdit are disabled).",
    `  ${v.substantiveSteps} — MUST be done by the Gemini worker through this skill, in EVERY`,
    `  phase${v.everyPhaseAside}. You orchestrate only: compose`,
    "  the task, run the delegation command, read back the worker's result, and",
    "  write the phase contract files with Bash. Never do the engineering",
    "  yourself; the scaffold fails ANY phase attempt that makes zero delegations.",
    "---",
    "",
    "# Delegate work to the Gemini worker (Antigravity SDK)",
    "",
    "For each delegated task, pick a fresh integer N (1, 2, 3, …) so nothing is",
    "overwritten, then run via Bash:",
    "",
    "```sh",
    `cat > "${outDir}/worker-task-${slot}-N.md" <<'TASK'`,
    "<your task description: the goal, the relevant file paths, and the exact",
    " contract the worker must satisfy>",
    "TASK",
    "",
    `DYLD_LIBRARY_PATH="${WORKER_DYLD}" "${py}" "${WORKER_SCRIPT}" \\`,
    `  --task-file "${outDir}/worker-task-${slot}-N.md" \\`,
    `  --model "${worker}" --thinking ${workerThinking || "NONE"} \\`,
    // THE POLICY'S REGION, PASSED EXPLICITLY (2026-07-31). Until now the worker
    // took its Vertex location from GOOGLE_CLOUD_LOCATION alone, so a policy
    // declaring `region: global` steered nothing: the call went wherever the
    // ambient env pointed (default asia-south1) and the usage sidecar recorded
    // that same ambient value, leaving no artifact that could disagree with the
    // policy. This line is the last link in the chain policy file →
    // resolveHarnessStages (binding.worker_region) → runPhase → here → argv.
    //
    // EMITTED ONLY WHEN THE BINDING CARRIES ONE, deliberately. v1 policies
    // resolve through resolveLegacyHarnessStages, whose bindings are the raw
    // YAML objects and have no region key at all; those runs are replayed for
    // comparison against published numbers, so they must keep resolving the
    // region exactly the way they did when they ran — from the env. Omitting
    // the flag is what preserves that, since the worker's default is the env.
    ...(workerRegion ? [`  --region "${workerRegion}" \\`] : []),
    `  --workdir "${workdir}" --out-dir "${outDir}" \\`,
    `  --usage-file "${outDir}/worker-usage-${slot}-N.json" \\`,
    `  --timeout ${timeoutSec}`,
    "```",
    "",
    "Rules:",
    "- You have NO file-editing tools (Edit/Write/NotebookEdit/MultiEdit are",
    "  disabled), and you must NOT edit repository files through Bash either",
    "  (no `cat >`, `sed -i`, `patch`, or `git apply` against the working tree).",
    "  Every repository change goes through the worker. This is enforced: ANY",
    `  ${v.phaseList} with zero delegations is failed`,
    "  by the scaffold.",
    "- Compose the task description yourself: state the goal, the relevant",
    "  file paths, and the exact contract the worker must satisfy.",
    "- Hand the worker the PROBLEM, not the SOLUTION. Describe the goal and the",
    "  contract; do NOT pre-solve it — never dictate the exact lines to change or",
    "  paste in a diff. The worker must do the analysis and the authoring itself;",
    "  if you hand it a finished answer to type in, the cell stops being a Gemini",
    "  result. Point it at the relevant files and let it reason.",
    ...v.readOnlyBullet,
    "- DELEGATE FIRST: until your FIRST worker delegation in this phase-attempt,",
    "  the repository is locked to you — a live guard denies workdir Reads,",
    "  Grep/Glob searches, and repo-inspecting Bash (find/grep/cat/ls/go test/",
    "  run-in-env.sh/…). Do not",
    "  explore the repo to \"prepare\" the task: compose the first worker task",
    "  from the phase prompt and the contract files alone, and let the worker do",
    "  its own exploration — that is its job, not yours.",
    "- The worker edits files in the working directory directly and prints its",
    "  reply on stdout. AFTER your first delegation the repository unlocks:",
    "  verify the worker's output (git status/diff; run tests via run-in-env.sh;",
    `  read the files it names). Verifying results is fine — doing ${v.ownWork} yourself is not.`,
    "- If the worker's output is wrong, re-delegate with the next N — do not",
    "  correct its work by hand. A re-delegation may carry ONLY evidence: what",
    "  you observed going wrong, the verbatim build or test output, and which",
    "  clause of the contract is still unmet. It must NEVER carry the remedy —",
    "  no diff or patch, no finished file or function body, no \"change line X",
    "  to Y\", and no command whose purpose is to make the change for the worker",
    "  (`sed -i`, `patch`, `git apply`, a scripted rewrite). Running tests and",
    "  reading output is verification and stays allowed; handing over the answer",
    "  is authoring, and it makes the result yours under the worker's name.",
    "  If you already know what the change should be, say what is failing and",
    "  let the worker arrive at it.",
    "- A command the guard denied to YOU may not be handed to the worker to run",
    "  on your behalf. The delegation channel carries tasks, not a shell — a",
    "  denial states who does the work, it is not an obstacle to route around.",
    "- YOU write the phase contract files into the out dir, and because you have",
    "  no Write tool you do it with Bash heredoc, e.g.:",
    "",
    "  ```sh",
    `  cat > "${outDir}/${v.contractFile}" <<'JSON'`,
    `  ${v.contractBody}`,
    "  JSON",
    "  ```",
    "  The worker never writes the contract files.",
    "",
  ].join("\n");
}

/**
 * Render the PreToolUse(Bash|Read|Grep|Glob) DELEGATION GUARD for a
 * DELEGATED cell. Two structural rules, enforced in real time:
 *
 * 1. TREE-WRITE BAN (always on). The driver already has every file-editing
 *    tool disabled (--disallowedTools), which leaves one residual write
 *    channel: Bash (`cat > file`, `sed -i`, `tee`, `patch`, …). The
 *    zero-delegation gate and the post-run audit catch a driver that worked
 *    alone, but only AFTER the fact — a driver that delegates once
 *    (satisfying the honesty meter) could still smuggle its own tree edits
 *    through Bash in the same phase. Any Bash command that writes into the
 *    working tree is denied; writes under the out dir (contract +
 *    worker-task files) and /tmp are allowed.
 *
 * 2. DELEGATE-FIRST LOCK (until the attempt's first delegation). The write
 *    ban cannot stop the driver doing the ANALYSIS itself in read-space —
 *    the 2026-07-24 navidrome LOCALIZE trajectory showed Opus reading the
 *    cache sources and running the test suite twice with zero delegations,
 *    then only needing the worker as a rubber stamp. So until the first
 *    real gemini_worker.py invocation of this phase-attempt, workdir Reads,
 *    repo-inspecting Bash (bashInspectsRepo) AND repo-targeting Grep/Glob
 *    searches (searchTargetsRepo — cwd is the workdir, so a path-less search
 *    hits the repo by default) are denied too. The delegation command itself
 *    is always allowed and touches a per-attempt SENTINEL file — after that,
 *    reads, searches and test-runs unlock so the driver can verify the
 *    worker's output.
 *
 * Both rules reuse the audit's own classifiers (bashEditsTree /
 * bashInspectsRepo / searchTargetsRepo, imported by the generated script
 * from audit.mjs), so the live blocks and the audit's driver-direct-edit /
 * driver-predelegation-inspection flags agree by construction. Emits the
 * documented PreToolUse deny decision on stdout (exit 0); fails open on
 * unparseable input. Exported so the generated guard can be unit-tested
 * end to end (it is the structural line of defence for the delegated cell).
 */
export function renderTreeWriteHook({ workdir, outDir, slot }) {
  // Sentinel lives under out/phases and is namespaced by slot (phase-attempt),
  // so every attempt starts locked regardless of what earlier attempts did.
  const sentinel = join(outDir, "phases", `${slot}.first-delegation`);
  return [
    "// Auto-generated per phase-attempt by runtimes.mjs — do not edit.",
    "// PreToolUse(Bash|Read|Grep|Glob) delegation guard for the delegated cell:",
    "//   rule 1 (always): deny Bash that writes into the working tree;",
    "//   rule 2 (until this attempt's first gemini_worker.py call): deny",
    "//   workdir Reads, repo-inspecting Bash and repo-targeting Grep/Glob",
    "//   searches — delegate first, verify after.",
    `import { writeFileSync, existsSync, mkdirSync } from "node:fs";`,
    `import { dirname } from "node:path";`,
    `import { bashEditsTree, bashInspectsRepo, searchTargetsRepo, stripHeredocs } from ${JSON.stringify(AUDIT_MJS)};`,
    "",
    `const WORKDIR = ${JSON.stringify(workdir)};`,
    `const OUT_DIR = ${JSON.stringify(outDir)};`,
    `const SENTINEL = ${JSON.stringify(sentinel)};`,
    "",
    "const deny = (reason) => {",
    "  process.stdout.write(JSON.stringify({",
    "    hookSpecificOutput: {",
    "      hookEventName: \"PreToolUse\",",
    "      permissionDecision: \"deny\",",
    "      permissionDecisionReason: reason,",
    "    },",
    "  }));",
    "  process.exit(0);",
    "};",
    "",
    "const DELEGATE_FIRST =",
    // GUARD_DENIAL_MARK is spliced in rather than typed out, here and in the
    // tree-write denial below, because the post-run audit identifies a guard
    // refusal by finding this exact phrase in an error tool_result — an
    // ordinary failing command is indistinguishable from a blocked one
    // otherwise. One definition, interpolated into both messages, is what
    // stops the words the guard SAYS and the words the audit LOOKS FOR from
    // drifting apart. The rendered text is byte-identical to spelling it out.
    `  "DELEGATE FIRST: you are ${GUARD_DENIAL_MARK}, and until your " +`,
    "  \"first Gemini worker delegation of this phase-attempt the repository is \" +",
    "  \"locked to you — the worker does the analysis, not you. Compose the worker \" +",
    "  \"task from the phase prompt and the contract files (the worker explores \" +",
    "  \"the repository itself), run gemini_worker.py via the gemini-worker skill, \" +",
    "  \"and repository access unlocks for verifying its output. Blocked here: \";",
    "",
    "let raw = \"\";",
    "process.stdin.setEncoding(\"utf8\");",
    "for await (const chunk of process.stdin) raw += chunk;",
    "",
    "let input;",
    "try { input = JSON.parse(raw); } catch { process.exit(0); } // unparseable → don't block",
    "",
    "if (input?.tool_name === \"Read\") {",
    "  const p = input?.tool_input?.file_path;",
    "  if (typeof p === \"string\" && p.startsWith(WORKDIR) && !existsSync(SENTINEL)) {",
    "    deny(DELEGATE_FIRST + \"Read of \" + p);",
    "  }",
    "  process.exit(0); // out-dir/contract/scratch reads are always fine",
    "}",
    "",
    "if (input?.tool_name === \"Grep\" || input?.tool_name === \"Glob\") {",
    "  // cwd is the workdir, so a search with no path hits the repo by default.",
    "  if (!existsSync(SENTINEL)) {",
    "    const searchHit = searchTargetsRepo(input?.tool_input?.path, { workdir: WORKDIR, outDir: OUT_DIR });",
    "    if (searchHit) deny(DELEGATE_FIRST + input.tool_name + \": \" + searchHit + \".\");",
    "  }",
    "  process.exit(0); // post-delegation searches are verification",
    "}",
    "",
    "if (input?.tool_name !== \"Bash\") process.exit(0);",
    "const command = input?.tool_input?.command;",
    "if (typeof command !== \"string\") process.exit(0);",
    "",
    "// The delegation itself: always allowed, and it unlocks the repository for",
    "// this attempt. Checked on the heredoc-stripped text so a task file that",
    "// merely MENTIONS gemini_worker.py does not count as a delegation.",
    "if (/gemini_worker\\.py/.test(stripHeredocs(command))) {",
    "  // mkdir first: a failed sentinel write would leave the repo locked for",
    "  // the whole attempt, so the unlock must be as close to infallible as the",
    "  // filesystem allows (the catch keeps the guard from ever crashing the call).",
    "  try { mkdirSync(dirname(SENTINEL), { recursive: true }); writeFileSync(SENTINEL, \"\"); } catch { }",
    "  process.exit(0);",
    "}",
    "",
    "if (!existsSync(SENTINEL)) {",
    "  const ihit = bashInspectsRepo(command, { workdir: WORKDIR, outDir: OUT_DIR });",
    "  if (ihit) deny(DELEGATE_FIRST + ihit + \".\");",
    "}",
    "",
    "const whit = bashEditsTree(command, { workdir: WORKDIR, outDir: OUT_DIR });",
    "if (whit) {",
    "  deny(",
    // Both marks are spliced in. The second is what the audit uses to tell a
    // MUTATION denial from a delegate-first READ denial — handing a refused
    // read to the worker is compliance, handing it a refused mutation is not.
    `    ${JSON.stringify(`You are ${GUARD_DENIAL_MARK} and ${GUARD_TREE_WRITE_MARK}. `)} +`,
    "    \"Every repository change MUST go through the Gemini \" +",
    "    \"worker (gemini_worker.py) via the gemini-worker skill. This Bash command \" +",
    "    \"writes into the tree (\" + whit + \"). Writing contract/worker-task files \" +",
    "    \"under the out dir is allowed; editing the workdir is not — delegate this \" +",
    "    \"change to the worker instead.\");",
    "}",
    "process.exit(0);",
    "",
  ].join("\n");
}

/**
 * Count worker delegations in a claude-code trajectory: Bash tool_use events
 * whose command invokes gemini_worker.py. This is the cell's honesty meter —
 * recorded per attempt in the manifest; an attempt with zero delegations means
 * the driver did the work itself and must be read as cc×driver, not cc×worker
 * (flagged loudly by the scaffold).
 */
function countDelegations(logFile) {
  if (!existsSync(logFile)) return 0;
  let calls = 0;
  for (const line of readFileSync(logFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      const blocks = ev?.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        // Strip heredoc bodies first: the same Bash command that invokes the
        // worker ALSO writes the worker-task file via `cat > … <<'TASK'`, and a
        // task body can legitimately quote "gemini_worker.py" as an example.
        // Only an invocation on an actual command line is a delegation.
        if (b?.type === "tool_use" && b.name === "Bash" &&
            typeof b.input?.command === "string" &&
            stripHeredocs(b.input.command).includes("gemini_worker.py")) {
          calls++;
        }
      }
    } catch { /* partial line — tolerated, same policy as the cost parse */ }
  }
  return calls;
}

/**
 * Read back the per-delegation usage sidecars gemini_worker.py wrote (real
 * token counts + resolved model — the SDK's payoff over the prose-only CLI).
 * Returns { available, calls, sidecars } or null when the cell isn't
 * delegated. cost_usd is intentionally NOT computed here: token counts are
 * priced downstream against verified Vertex rates, never a rate hardcoded in
 * the harness (pricing-preflight discipline). It cross-checks the delegation
 * counter — a non-zero count with no sidecar means the worker was launched but
 * produced no session (a killed sub-process).
 */
function readWorkerUsage(outDir, slot) {
  // Read back ONLY this phase-attempt's own files. Every worker file is
  // namespaced `worker-{task,usage}-<slot>-N.{md,json}` (renderWorkerSkill), so
  // scoping the read to <slot> is what prevents a 0-delegation attempt from
  // inheriting the previous phase's leftover sidecar (the carryover bug) and
  // keeps each attempt's token counts its own.
  const taskRe = new RegExp(`^worker-task-${slot}-.*\\.md$`);
  const usageRe = new RegExp(`^worker-usage-${slot}-.*\\.json$`);
  // Task-file char counts: a transparency signal that the driver handed the
  // worker a PROBLEM, not a pre-written SOLUTION. A worker task far larger than
  // the diff it produced is a hint the driver over-specified (or pasted the
  // fix); recorded so a reviewer sees it in the manifest without opening files.
  let taskFiles = [];
  try {
    taskFiles = readdirSync(outDir)
      .filter((f) => taskRe.test(f)).sort()
      .map((f) => {
        try { return { file: f, chars: readFileSync(join(outDir, f), "utf8").length }; }
        catch { return { file: f, chars: null }; }
      });
  } catch { /* out dir unreadable — leave task list empty */ }

  let files;
  try {
    files = readdirSync(outDir).filter((f) => usageRe.test(f));
  } catch { return { available: false, calls: 0, sidecars: [], task_files: taskFiles }; }
  if (!files.length) return { available: false, calls: 0, sidecars: [], task_files: taskFiles };
  const sidecars = [];
  for (const f of files) {
    try { sidecars.push(JSON.parse(readFileSync(join(outDir, f), "utf8"))); }
    catch { /* a half-written sidecar from a killed worker — skip it */ }
  }
  return { available: true, calls: sidecars.length, sidecars, task_files: taskFiles };
}

/**
 * One narrated line for an ordinary (non-delegation) driver tool call.
 *
 * Two shapes were actively unhelpful on screen before 2026-07-26 and are
 * special-cased here, because both appear many times in every run:
 *
 *   heredoc writes — the driver emits contract files as
 *   `cat > "out/requirements.md" <<'EOF' ## Functional requirements **FR-1: …`
 *   which truncates mid-sentence at 96 chars and shows a viewer a fragment
 *   of a document instead of the fact that a document was produced. The
 *   filename is the information; the body is already on disk.
 *
 *   Skill — printed as a bare `. Skill` with an empty argument, i.e. a line
 *   that says nothing at all. In the delegated cell it is always the
 *   delegation skill loading, which is worth naming because it is the step
 *   immediately before every hand-off.
 */
export function describeToolUse(b, shortArg, delegated) {
  if (b.name === "Bash" && typeof b.input?.command === "string") {
    const wrote = b.input.command.match(/^\s*cat\s*>\s*"?([^"\s]+)"?\s*<</);
    // Route the filename through shortArg like every other argument, rather
    // than printing it raw: the driver writes contract files by ABSOLUTE path,
    // so the raw form was ~100 chars of identical run-dir prefix and ran to 176
    // columns on screen. shortArg folds it to `out/requirements.md`, which is
    // both the whole information content of the line and inside the grid.
    if (wrote) return `wrote ${shortArg({ file_path: wrote[1] })}`;
  }
  if (b.name === "Skill") {
    return delegated ? "loading delegation skill" : "Skill";
  }
  return `${b.name}  ${shortArg(b.input)}`;
}

/**
 * Classify a delegate-first denial by the MECHANISM the driver reached for,
 * using the recorded tool call rather than the guard's prose.
 *
 * Why this matters enough to carry a Map (2026-07-26): the lock seals three
 * independent routes into the repo —
 *   shell inspection   Bash — `find workdir/src`, `ls workdir/`
 *   tool inspection    Read / Grep / Glob aimed at the working tree
 *   direct write       Edit / Write (in practice unreachable: the edit tools
 *                      are stripped from the session before it starts)
 * Printing all of them as one generic "blocked" line reduces the strongest
 * evidence a delegated run produces — that the driver tried several distinct
 * ways in and every one was sealed — down to a number. Google's ask is
 * specifically about whether Claude Code really hands work to Gemini; this
 * is where the log answers it.
 */
export function denialMechanism(toolName) {
  if (toolName === "Bash") return "shell inspection";
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") return "tool inspection";
  if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") return "direct write";
  return "repo access";
}

/**
 * Live terminal narration for a claude-code phase attempt. Returns an
 * onLine(line) tap for spawnWithTimeout that parses the CLI's stream-json
 * events AS THEY STREAM and prints a compact progress line for each — the
 * trajectory itself goes to disk, which otherwise leaves the terminal silent
 * for the many minutes a phase runs. What it narrates, and why:
 *   - session init (resolved model, guard-armed note for the delegated cell)
 *   - one dim line per driver tool call (tool + truncated main argument)
 *   - worker DELEGATIONS called out loudly, with the worker's return
 *     announced by tool_use_id correlation — the delegate-first flow (worker
 *     call BEFORE any repo read) becomes visible live, not post-hoc. Each
 *     return line carries the hand-off's wall time plus the worker's REAL
 *     receipts (resolved model, thinking level, token split) read
 *     best-effort from the usage sidecar named in the delegation command's
 *     own --usage-file flag
 *   - delegation-guard DENIALS (an is_error tool_result carrying the guard's
 *     own deny text), labeled by which rule fired
 *   - the final result event (turns + driver-side cost)
 * Delegation detection is the SAME heredoc-stripped predicate as
 * countDelegations, so the live count and the manifest count agree by
 * construction. Narration-only by contract: it prints and nothing else, and
 * the spawn tap swallows any error it throws. Exported for the $0 replay
 * test in guard.test.mjs (proven against a real trajectory, not synthetic
 * shapes only).
 */
// Widest tool argument a narrated line can carry and still land inside the
// 80-column grid: 80 − gutter("[C→G] ", 6) − stamp("[+12:34]", 8) − the 4-space
// separator − a tool name and its two spaces (~10 worst case) ≈ 52.
const ARG_W = 52;

export function makePhaseNarrator({ delegated, workdir, outDir, now = Date.now }, print = say) {
  // Elapsed-time stamp on every narrated line ("[+3:12]"), measured from
  // narrator creation = phase spawn: the demo watcher sees the run's pacing
  // (how long the driver thought, how long each worker hand-off took)
  // without a stopwatch. Display-only, like everything else here.
  //
  // `now` is injectable (2026-07-26) for ONE reason: replay-log.mjs re-narrates
  // a finished run's trajectory offline, and with the wall clock it would stamp
  // every line [+0:00] and report every hand-off as 0s — a rehearsal that
  // silently misrepresents the run's pacing, which is exactly what the stamps
  // exist to show. Replay drives this from each event's own `timestamp`, so the
  // rehearsed log carries the run's REAL elapsed times. Live callers omit it
  // and get Date.now(); nothing else in the narrator reads a clock.
  const t0 = now();
  const clock = () => {
    const s = Math.floor((now() - t0) / 1000);
    return `[+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}]`;
  };
  const shortArg = (input) => {
    const a = input?.command ?? input?.file_path ?? input?.pattern ?? input?.description ?? "";
    let one = String(a).replace(/\s+/g, " ").trim();
    // Absolute run-dir paths are ~100 chars of the same prefix on every line —
    // fold them to workdir/… and out/… so the interesting tail survives the
    // truncation below. Order matters: outDir first (it can live under runDir
    // next to workdir, never inside it, but replacing workdir first would
    // still leave outDir intact — kept explicit for clarity).
    if (outDir) one = one.split(outDir).join("out");
    if (workdir) one = one.split(workdir).join("workdir");
    if (one.length <= ARG_W) return one;
    // Two truncations, because the information sits at opposite ends.
    //   a PATH (no spaces) — the filename is the point, and a head-truncated
    //   path reads as "…-runs-insta…", naming nothing. Keep both ends.
    //   a COMMAND — the verb and its first arguments are the point; the tail is
    //   flags and redirections. Keep the head.
    // ARG_W is derived from the grid, not guessed: an over-long token cannot be
    // wrapped (splitting a path stops it being copy-pasteable), so it has to be
    // shortened HERE or it runs off the screenshare.
    if (!one.includes(" ") && one.includes("/")) {
      return one.slice(0, 18) + "…" + one.slice(-(ARG_W - 19));
    }
    return one.slice(0, ARG_W) + "…";
  };
  let delegationCount = 0;
  let denialCount = 0;
  // tool_use id → { ord, at, usageFile }: the ordinal announces the worker's
  // return; `at` times the hand-off; `usageFile` (parsed from the delegation
  // command's own --usage-file flag) lets the return line print the worker's
  // REAL receipts — resolved model, thinking level, token split — live from
  // the sidecar gemini_worker.py just wrote, not a post-run summary.
  const delegationIds = new Map();
  // tool_use id → { name, arg } for EVERY driver tool call, kept only until
  // its tool_result arrives. Added 2026-07-26 so a guard denial can name the
  // MECHANISM the driver actually reached for rather than string-matching the
  // guard's prose. See the denial branch below for why that distinction is
  // worth a Map: the lock seals three independent routes, and collapsing them
  // into one generic "blocked" line throws away the strongest evidence the
  // delegated cell produces.
  const pendingTools = new Map();
  // Left gutter tag. Non-delegated runs have exactly one actor, so they get
  // plain indent — a column that never varies is noise (logfmt.gutter).
  const gut = (tag) => gutter(tag, delegated);
  return (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; } // partial line — narration skips it
    if (ev.type === "system" && ev.subtype === "init") {
      // Name the PRODUCT, not the internal role. "driver" is our word; a
      // Google reviewer reading a screenshared log knows "Claude Code as
      // Harness" because that is the phrasing of their own ask (3b).
      print(paint.cyan(`${gut(ACTOR.driver)}${clock()} ● Claude Code session up — ` +
        `${ev.model ?? "model unreported"}`));
      if (delegated) {
        print(paint.cyan(`${gut(ACTOR.driver)}         repo LOCKED · edit tools removed · ` +
          "must delegate to Gemini before it may even read the code"));
      }
      return;
    }
    if (ev.type === "result") {
      print(paint.cyan(`${gut(ACTOR.driver)}${clock()} ■ Claude Code done — ${ev.num_turns ?? "?"} turn(s)` +
        // "driver-side (CLI-modeled)" is accurate and reliably misread as a
        // bill. Say the thing that stops the question being asked.
        (ev.total_cost_usd != null
          ? ` · $${ev.total_cost_usd.toFixed(4)} (Max seat — modeled, not billed)` : "")));
      if (delegated) {
        print(paint.cyan(`${gut(ACTOR.driver)}         ${delegationCount} delegation(s) to Gemini` +
          (denialCount ? ` · ${denialCount} lock denial(s) — every one is the control working` : "")));
      }
      return;
    }
    const blocks = ev?.message?.content;
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b?.type === "tool_use") {
        if (b.name === "Bash" && typeof b.input?.command === "string" &&
            stripHeredocs(b.input.command).includes("gemini_worker.py")) {
          delegationCount++;
          const task = b.input.command.match(/worker-task-[^"'\s]+\.md/);
          const usage = b.input.command.match(/--usage-file\s+"([^"]+)"/);
          delegationIds.set(b.id, {
            ord: delegationCount, at: now(), usageFile: usage?.[1] ?? null,
          });
          // The hand-off is the single most important event in a delegated
          // run and used to be one grey line among a hundred. Boxed, it
          // survives a scrolling screenshare: a viewer who looks up at any
          // moment can see that work left Claude Code for Gemini, and the
          // closing half (below) carries what came back.
          print(paint.bold(paint.magenta(
            `${gut(ACTOR.handoff)}${clock()} ┌─ DELEGATION ${delegationCount} — Claude Code hands the work to Gemini`)));
          if (task) {
            print(paint.magenta(`${gut(ACTOR.handoff)}         │  task ${task[0]}`));
          }
          print(paint.magenta(`${gut(ACTOR.handoff)}         │  waiting on the worker…`));
        } else {
          // Record every tool call so its result can name the mechanism if
          // the guard denies it (see the denial branch).
          pendingTools.set(b.id, { name: b.name, arg: shortArg(b.input) });
          print(paint.dim(`${gut(ACTOR.driver)}${clock()}    ${describeToolUse(b, shortArg, delegated)}`));
        }
      } else if (b?.type === "tool_result") {
        const d = delegationIds.get(b.tool_use_id);
        const text = (Array.isArray(b.content)
          ? b.content.map((c) => c?.text ?? "").join(" ")
          : String(b.content ?? "")).replace(/\s+/g, " ");
        if (d != null) {
          const took = Math.round((now() - d.at) / 1000);
          // The worker's live receipts, straight from its usage sidecar (real
          // Vertex UsageMetadata — the SDK's payoff over the prose-only CLI).
          // Strictly best-effort: an unreadable/absent sidecar prints nothing
          // extra, never an error — narration must not depend on worker I/O.
          //
          // Rendered as the closing half of the DELEGATION box opened above,
          // one fact per line. The flat single-line form this replaces ran
          // past 160 characters and wrapped into unreadable pulp on a
          // screenshared terminal, which is where these numbers are read.
          let totalTok = null;
          if (!b.is_error && d.usageFile) {
            try {
              const sc = JSON.parse(readFileSync(d.usageFile, "utf8"));
              const u = sc.usage ?? {};
              totalTok = u.total_token_count ?? null;
              const bar = paint.magenta(`${gut(ACTOR.worker)}         │  `);
              print(bar + `${sc.model ?? "model?"} @ thinking ${sc.thinking ?? "?"}`);
              // Name the CABLE on screen, not just the model (2026-07-26).
              // The line already proved a Gemini model answered; what a viewer
              // cannot see is *what reached it*. Older sidecars have no `sdk`
              // key and simply omit this line — narration never fabricates.
              if (sc.sdk) {
                print(bar + `via ${sc.sdk}${sc.sdk_version ? ` ${sc.sdk_version}` : ""}` +
                  (sc.vertex_location ? ` → Vertex AI · ${sc.vertex_location}` : ""));
              }
              // ONE delegation is a whole agentic session, not one model call.
              // Without this line the log reads as a single autocomplete
              // round-trip and badly undersells what the SDK actually ran.
              if (sc.tool_call_count) {
                print(bar + `${sc.tool_call_count} tool call(s) inside this one delegation`);
              }
              if (u.total_token_count != null) {
                const pct = cachePct({
                  prompt: u.prompt_token_count ?? 0,
                  cached: u.cached_content_token_count ?? 0,
                });
                const cached = u.cached_content_token_count ?? 0;
                const fresh = Math.max(0, (u.prompt_token_count ?? 0) - cached);
                // Cache reads bill far below fresh input. Printing only the
                // undifferentiated input figure invites a cost estimate that
                // is several-fold too high — see logfmt.attemptTotals.
                print(bar + `input ${fmtInt(u.prompt_token_count ?? 0)}` +
                  (cached ? ` = ${fmtInt(cached)} cached (${pct}%) + ${fmtInt(fresh)} fresh` : ""));
                print(bar + `output ${fmtInt(u.candidates_token_count ?? 0)}` +
                  (u.thoughts_token_count ? ` · thinking ${fmtInt(u.thoughts_token_count)}` : ""));
              }
            } catch { /* sidecar not there yet — the attempt ledger will have it */ }
          }
          print(paint.bold(paint.magenta(`${gut(ACTOR.worker)}${clock()} └─ ` +
            (b.is_error ? "worker ERRORED — see trajectory" : "Gemini returned") + ` · ${took}s` +
            (totalTok != null ? ` · ${fmtInt(totalTok)} tokens` : ""))));
          delegationIds.delete(b.tool_use_id);
        } else if (b.is_error && text.includes("DELEGATE FIRST")) {
          denialCount++;
          // Name the MECHANISM, and hang the verdict off the call rather than
          // restating it. A bare "DENIED" reads as a failure of the run to
          // anyone who has not read our design docs — which is the entire
          // external audience. What this line actually records is the lock
          // holding.
          //
          // This used to re-echo the blocked command in yellow above the ↳.
          // The denied call has ALREADY been narrated (the dim line printed
          // when its tool_use streamed), so on screen that rendered as the
          // same command twice in a row — read as the driver retrying, i.e.
          // the exact opposite of what the lock is evidence for. The ↳ glyph
          // is what ties the verdict to the line above it; that is enough.
          const mech = denialMechanism(pendingTools.get(b.tool_use_id)?.name);
          print(paint.yellow(`${gut(ACTOR.driver)}           ↳ BLOCKED by the delegate-first lock (${mech}) ` +
            "— Claude Code must hand this to Gemini"));
        } else if (b.is_error && text.includes("writes into the tree")) {
          denialCount++;
          // The third and strictest route: an actual edit attempt. In the
          // delegated cell this is normally unreachable (the edit tools are
          // stripped before the session starts), so if it ever fires it is
          // the loudest possible signal and gets said in full. Same ↳-hangs-
          // off-the-call rule as the branch above: no re-echo of the command.
          print(paint.yellow(`${gut(ACTOR.driver)}           ↳ BLOCKED by the tree-write ban (direct write) ` +
            "— Claude Code may never edit the repo itself"));
        }
        // Every tool_result closes out its pending record: the Map is a live
        // correlation window (id → the call that is still in flight), not a
        // transcript — the trajectory file on disk is that.
        pendingTools.delete(b.tool_use_id);
      }
    }
  };
}

/**
 * Spawn a CLI with a host-side timeout, streaming stdout/stderr to files.
 * The prompt travels as a single argv element (no shell involved), so no
 * quoting can corrupt it and size limits are ARG_MAX (~256 KB on macOS) —
 * far above any rendered phase prompt. An optional `onLine` callback taps
 * every complete stdout line for live terminal narration (see the tap note
 * in the body — narration-only, errors swallowed).
 *
 * Timeout discipline: SIGTERM at the deadline, SIGKILL 30 s later if the
 * process ignores it. The rig's lesson (its 45-min kill truncated the
 * final result event) does not recur here because phases are short and the
 * per-phase timeout is a GATE outcome, not a lost run — a timed-out
 * attempt is retried per policy with the timeout as the failure reason.
 */
function spawnWithTimeout({ cmd, args, cwd, env, stdoutPath, stderrPath, timeoutMin, onLine }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    // setEncoding BEFORE pipe: the live tap below re-assembles lines from
    // chunks, and string chunks can't split a multi-byte character the way raw
    // buffers can. The file pipe is unaffected (write streams take strings).
    child.stdout.setEncoding("utf8");
    const outFd = createWriteStreamSync(stdoutPath);
    const errFd = createWriteStreamSync(stderrPath);
    child.stdout.pipe(outFd);
    child.stderr.pipe(errFd);

    // Optional live tap: invoked once per COMPLETE stdout line, alongside the
    // file pipe (a second 'data' listener does not steal from pipe). The
    // claude-code adapter uses it to narrate phase progress to the terminal
    // while the full stream-json trajectory goes to disk — without it the
    // terminal is silent for the many minutes a phase runs. Narration-only by
    // contract: a tap callback that throws is swallowed here, so terminal
    // narration can never fail or alter a run.
    if (onLine) {
      let buf = "";
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try { onLine(line); } catch { /* narration must never affect the run */ }
        }
      });
    }

    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 30_000).unref();
    }, timeoutMin * 60 * 1000);

    child.on("close", (code) => {
      clearTimeout(deadline);
      done({
        exitCode: code ?? 1,
        wallSeconds: Math.round((Date.now() - started) / 1000),
        timedOut,
      });
    });
    child.on("error", (err) => {
      // Covers ENOENT (CLI not installed) — surfaced as a normal failed
      // attempt with the error in the stderr log, so the scaffold's retry/
      // reporting path handles it instead of an unhandled rejection.
      clearTimeout(deadline);
      errFd.write(`spawn error: ${err.message}\n`);
      done({ exitCode: 127, wallSeconds: Math.round((Date.now() - started) / 1000), timedOut: false });
    });
  });
}

// fs.createWriteStream with the parent dir guaranteed — trivially small,
// but inlined so the adapters stay dependency-free.
function createWriteStreamSync(path) {
  mkdirSync(join(path, ".."), { recursive: true });
  return createWriteStream(path);
}

export const RUNTIMES = {
  /**
   * Claude Code CLI, headless `claude -p`, runtime process on the HOST
   * (the container only executes repo commands via run-in-env.sh).
   * All flags verified present in 2.1.215:
   *   --effort            thinking parity pin (policy `thinking.claude-code`)
   *   --max-budget-usd    per-phase wallet brake (policy `limits.phase_budget_usd`)
   *   --disallowedTools   WebFetch/WebSearch closed (source-host channel);
   *                       Task closed (subagents would blur the per-phase
   *                       cost/turn accounting the study reports). A DELEGATED
   *                       cell ALSO closes Edit/Write/NotebookEdit/MultiEdit so
   *                       the driver has NO way to edit the repo itself — every
   *                       source change must come from the Gemini worker (see
   *                       the delegated-cell note below and runPhase).
   *   --add-dir <outDir>  contract files live OUTSIDE the workdir cwd
   */
  "claude-code": {
    name: "claude-code",

    version() {
      return execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
    },

    /**
     * Cheap $0 checks that fail BEFORE any docker build or model spend:
     * auth present, CLI runs. (There is no claude equivalent of a model-list
     * probe to validate the driver string offline — a bad driver surfaces on
     * the first phase call, bounded by the phase budget.)
     * A DELEGATED binding additionally needs the Gemini worker: the SDK venv
     * must exist and import, and Vertex ADC must be present. All three checks
     * stay $0 — no model is called.
     */
    preflight({ binding }) {
      if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
        throw new Error("claude-code preflight: set CLAUDE_CODE_OAUTH_TOKEN (Max) or ANTHROPIC_API_KEY");
      }
      this.version(); // throws if the CLI is missing/broken
      if (!binding) throw new Error("claude-code preflight: policy has no claude-code binding");
      if (isDelegated(binding)) {
        const py = workerPython();
        if (!existsSync(py)) {
          throw new Error("claude-code preflight (delegated cell): Gemini worker venv not found at " +
            `${py} — build it per tools/harness-matrix/sdk-probe/README.md ` +
            "(python >=3.10 venv + `pip install google-antigravity`), or set GEMINI_WORKER_PYTHON");
        }
        try {
          execFileSync(py, ["-c", "import google.antigravity"], {
            env: { ...process.env, DYLD_LIBRARY_PATH: WORKER_DYLD },
            stdio: "pipe",
          });
        } catch (err) {
          throw new Error("claude-code preflight (delegated cell): the worker venv cannot import " +
            `google.antigravity — ${String(err.stderr || err.message).slice(0, 300)}`);
        }
        const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          join(homedir(), ".config", "gcloud", "application_default_credentials.json");
        if (!existsSync(adc)) {
          throw new Error("claude-code preflight (delegated cell): no ADC for Vertex — " +
            "run `gcloud auth application-default login`, then set GOOGLE_CLOUD_PROJECT " +
            "to your own Google Cloud project");
        }
      }
    },

    async runPhase({ binding, thinking, prompt, workdir, outDir, logPrefix, timeoutMin, budgetUsd, delegationVocab }) {
      const logFile = join(outDir, "phases", `${logPrefix}.trajectory.jsonl`);
      const delegated = isDelegated(binding);
      const driverModel = delegated ? binding.driver : binding;

      const env = {
        ...process.env,
        // Keep the CLI's egress down to model traffic only.
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      };
      let hookSettingsPath = null;
      if (delegated) {
        // DESIGN §11 recorded defect 4 — FIXED 2026-07-25. The driver reaches
        // the worker by running gemini_worker.py through Claude Code's Bash
        // tool, whose timeout is 120 s by default and 600 s maximum unless
        // BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS are set — and this env
        // block never set them. So the Skill wrote a cheque (`--timeout` for
        // the worker's slice of the phase) that the transport would not cash:
        // any delegation longer than two minutes was killed by the tool, not
        // by the timeout the harness thought it had configured. The 2026-07-21
        // smoke's REPRO legitimately needed 1002 s, and the SDLC EXECUTE stage
        // is larger still, so this was guaranteed to bite the moment a real
        // delegation ran long. Worse, the failure is silent in the one place
        // it matters: a driver whose delegations keep getting killed may just
        // finish the job itself, producing a run that is really cc×Opus while
        // still carrying a non-zero delegation_calls — the single failure
        // shape that counter cannot see.
        //
        // Both vars are set to the worker's slice PLUS a 2-minute margin, so
        // the worker's own --timeout is always the one that fires first. That
        // ordering matters: a worker self-timeout still writes its usage
        // sidecar and prints a diagnosable message, whereas a Bash-tool kill
        // is opaque to the driver and to the manifest alike.
        const bashCeilingMs = (workerTimeoutMin(timeoutMin) + 2) * 60_000;
        env.BASH_DEFAULT_TIMEOUT_MS = String(bashCeilingMs);
        env.BASH_MAX_TIMEOUT_MS = String(bashCeilingMs);

        // The gemini-worker Skill is provisioned in a PER-RUN config dir and
        // surfaced via CLAUDE_CONFIG_DIR — never written into the workdir: the
        // workdir is the diff anchor, and the gates fail any undeclared file (a
        // .claude/ dir would poison every phase gate). Auth is unaffected
        // because it travels via env var, not the config dir. Skill discovery
        // under a relocated config dir is a smoke-verified assumption (first
        // gated cc×gemini smoke).
        const configDir = join(outDir, "claude-config");
        mkdirSync(join(configDir, "skills", "gemini-worker"), { recursive: true });
        writeFileSync(
          join(configDir, "skills", "gemini-worker", "SKILL.md"),
          renderWorkerSkill({
            worker: binding.worker,
            workerThinking: binding.worker_thinking,
            // Undefined on legacy (v1) bindings and on non-Vertex workers; the
            // Skill omits the --region flag in that case and the worker keeps
            // its env default. See the note at the flag in renderWorkerSkill.
            workerRegion: binding.worker_region,
            workdir, outDir, timeoutMin,
            slot: logPrefix,          // namespaces this attempt's worker files
            // Kind-specific examples in the mandate. Absent → NEUTRAL_VOCAB,
            // which is true of any kind rather than true of SWE-bench Pro only.
            vocab: delegationVocab,
          }));
        env.CLAUDE_CONFIG_DIR = configDir;

        // PreToolUse(Bash|Read|Grep|Glob) delegation guard — loaded via
        // --settings so it applies regardless of config-dir settings
        // semantics. Two real-time rules: (1) always deny driver Bash that
        // writes into the working tree (the residual channel after the edit
        // tools are removed); (2) until this attempt's first gemini_worker.py
        // call — recorded by a slot-namespaced sentinel — also deny workdir
        // Reads, repo-inspecting Bash AND repo-targeting Grep/Glob searches
        // (cwd is the workdir, so a path-less search hits the repo), so the
        // analysis happens in the worker, not the driver (delegate first,
        // verify after). Shares bashEditsTree / bashInspectsRepo /
        // searchTargetsRepo with the audit, so block and flag agree.
        const hooksDir = join(configDir, "hooks");
        mkdirSync(hooksDir, { recursive: true });
        const hookScript = join(hooksDir, "delegation-guard.mjs");
        writeFileSync(hookScript, renderTreeWriteHook({ workdir, outDir, slot: logPrefix }));
        hookSettingsPath = join(configDir, "hook-settings.json");
        const guardHook = [{ type: "command", command: `node ${JSON.stringify(hookScript)}` }];
        writeFileSync(hookSettingsPath, JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: guardHook },
              { matcher: "Read", hooks: guardHook },
              { matcher: "Grep|Glob", hooks: guardHook },
            ],
          },
        }, null, 2));
      }

      // Tool policy. Always closed: WebFetch/WebSearch (the source-host egress
      // channel) and Task (subagents blur the per-phase cost/turn accounting).
      // A DELEGATED cell additionally closes EVERY file-editing tool the driver
      // has — Edit/Write/NotebookEdit/MultiEdit — so the ONLY way the repo can
      // change is the Gemini worker (gemini_worker.py, launched via Bash). This
      // makes delegation STRUCTURAL, not advisory: the first gated smoke
      // (2026-07-23) proved the prose "always delegate" mandate loses to an
      // available Edit tool — Opus simply edited simple_cache.go itself, 0
      // delegations. With no edit tool the driver must delegate to touch the
      // tree; its repository READS are additionally locked until the attempt's
      // first delegation (the guard's delegate-first rule — the 2026-07-24
      // smoke showed the analysis migrating into read-space instead), after
      // which it reads/tests to verify, and it writes its phase contract files
      // (repro.json/localize.json) with Bash heredoc, per the gemini-worker
      // Skill. (The residual Bash edit channel — `cat > file`
      // in the workdir cwd — is closed THREE ways: in real time by the
      // PreToolUse hook above, which denies any tree-writing Bash command; and
      // downstream by the scaffold's 0-delegation gate plus the audit's
      // direct-tree-write flag. The hook is the primary, structural line.)
      const disallowed = ["WebFetch", "WebSearch", "Task"];
      if (delegated) disallowed.push("Edit", "Write", "NotebookEdit", "MultiEdit");

      const args = [
        "-p", prompt,
        "--model", driverModel,
        // stream-json + --verbose: one event per line; the init event
        // records the RESOLVED model (pin verification), the final result
        // event carries the CLI's own cost/turn accounting.
        "--output-format", "stream-json", "--verbose",
        "--permission-mode", "bypassPermissions",
        "--disallowedTools", ...disallowed,
        "--add-dir", outDir,
        "--max-budget-usd", String(budgetUsd),
      ];
      if (thinking) args.push("--effort", thinking);
      // Load the delegated cell's PreToolUse tree-write guard. --settings is
      // the reliable channel (independent of CLAUDE_CONFIG_DIR settings.json
      // discovery); the config dir still carries the gemini-worker Skill.
      if (hookSettingsPath) args.push("--settings", hookSettingsPath);

      // Live terminal narration of the trajectory as it streams (see
      // makePhaseNarrator) — without it the terminal is silent between the
      // scaffold's "[phase attempt]" banner and the gate line.
      const narrate = makePhaseNarrator({ delegated, workdir, outDir });

      const r = await spawnWithTimeout({
        cmd: "claude", args, cwd: workdir,
        env,
        stdoutPath: logFile,
        stderrPath: join(outDir, "phases", `${logPrefix}.stderr.log`),
        timeoutMin,
        onLine: narrate,
      });

      // Telemetry parse — tolerant of partial lines from a killed run. This is
      // the DRIVER's accounting (Opus in the delegated cell); the worker's real
      // token counts come from readWorkerUsage below.
      // driverUsage: Claude Code's `result` event carries a REAL token ledger
      // (input / cache_creation / cache_read / output) alongside the modeled
      // dollar figure. We were reading only the dollars, which made the driver
      // look like a cost with no tokens behind it — the exact thing that makes
      // a delegated run's numbers hard to defend ("why does the orchestrator
      // cost more than the model that wrote the code?"). Capturing it verbatim
      // costs nothing and turns that question into an answerable one.
      let costUsd = null, numTurns = null, resolvedModel = null, driverUsage = null;
      if (existsSync(logFile)) {
        for (const line of readFileSync(logFile, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "system" && ev.subtype === "init") resolvedModel = ev.model ?? null;
            if (ev.type === "result") {
              costUsd = ev.total_cost_usd ?? null;
              numTurns = ev.num_turns ?? null;
              // Stored verbatim, not reshaped: this is Anthropic's field
              // naming and any downstream consumer should see it unaltered.
              driverUsage = ev.usage ?? null;
            }
          } catch { /* partial line — tolerated */ }
        }
      }
      // Delegation count (delegated cells only): the honesty meter that keeps a
      // driver-did-it-itself run from passing as a worker result.
      const delegationCalls = delegated ? countDelegations(logFile) : null;
      // Worker-side evidence for the delegated cell: the real UsageMetadata
      // sidecars gemini_worker.py wrote (token counts + resolved model), scoped
      // to THIS phase-attempt's slot so a 0-delegation attempt can't inherit the
      // previous phase's leftover sidecar. Null for the non-delegated cc×Claude
      // cell.
      const workerUsage = delegated ? readWorkerUsage(outDir, logPrefix) : null;
      return { ...r, costUsd, numTurns, resolvedModel, driverUsage, delegationCalls, workerUsage, logFile };
    },
  },

  /**
   * There is deliberately no `antigravity` runtime here — no entry that puts
   * the Antigravity harness in the DRIVER seat. Two different reasons, and
   * they should not be confused (docs/antigravity-sdk.md has the detail):
   *
   *   Antigravity × Claude   BLOCKED upstream. The SDK's OpenAI-compatible
   *                          path sends no Authorization header at all, and
   *                          even with one supplied it labels tool results
   *                          `assistant` instead of `role:"tool"`, so the
   *                          agent loop dies on turn 2 against Anthropic.
   *
   *   Antigravity × Gemini   NOT blocked — just not written. This exact pair
   *                          already runs on every delegated cell, one rung
   *                          down, as the WORKER (see the block above).
   *                          Promoting it to a driver means an adapter that
   *                          owns the stage sequence and writes its contract
   *                          files outside the workdir, which the SDK's
   *                          `workspaces=[…]` does not do for free.
   *
   * An earlier `antigravity` runtime drove the `agy` CLI headlessly and was
   * removed 2026-07-23 when that CLI was parked; git history holds it.
   */
};
