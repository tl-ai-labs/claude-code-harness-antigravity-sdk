// Unit + end-to-end tests for the delegated cell's delegation guard
// (renderTreeWriteHook in runtimes.mjs + bashInspectsRepo in audit.mjs).
// $0 and offline: no model, no docker, no network — run with
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test guard.test.mjs
//
// The end-to-end block renders the REAL generated script into a temp dir and
// drives it exactly the way Claude Code does — JSON on stdin, decision on
// stdout — because the guard is the structural line of defence for the
// delegated cell and must be proven at the process boundary, not by proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bashInspectsRepo, searchTargetsRepo } from "./audit.mjs";
import { renderTreeWriteHook, makePhaseNarrator, renderWorkerSkill, DELEGATION_VOCAB,
  workerTimeoutMin, isDelegated } from "./runtimes.mjs";
// Loads a real policy file end-to-end for the region chain test at the bottom of
// this file — the only assertion here that starts from shipped YAML rather than
// from a hand-built binding.
import { loadPolicy } from "./kinds/lib.mjs";
import { createHash } from "node:crypto";

const CTX = { workdir: "/fake/run/workdir", outDir: "/fake/run/out" };

// ---- isDelegated: which cells get the guard at all --------------------------

// Everything below — the hook, the Skill, the nested clock, the audit's
// delegated-cell families — is switched on by this one predicate reading a
// policy binding. Get it wrong in the false direction and a delegated cell
// runs with no guard and no worker; get it wrong in the true direction and a
// solo cell is denied its own edit tools and can never produce a patch.
test("a binding OBJECT means delegated; a plain model string does not", () => {
  assert.equal(isDelegated({ driver: "claude-opus-4-6", worker: "gemini-3.5-flash" }), true);
  assert.equal(isDelegated("claude-opus-4-6"), false);
});

test("null is not delegated — the typeof trap", () => {
  // `typeof null === "object"` is the one-character bug that would turn every
  // unbound cell into a delegated one, guard and all.
  assert.equal(isDelegated(null), false);
  assert.equal(isDelegated(undefined), false);
});

// ---- bashInspectsRepo: the delegate-first classifier ------------------------

test("delegation command is never inspection", () => {
  assert.equal(bashInspectsRepo(
    `DYLD_LIBRARY_PATH=x "/venv/bin/python" "/tools/gemini_worker.py" --task-file "${CTX.outDir}/worker-task-1.md" --workdir "${CTX.workdir}"`,
    CTX), null);
});

test("run-in-env.sh counts as repo execution", () => {
  assert.match(bashInspectsRepo(`${CTX.outDir}/run-in-env.sh "go test ./..."`, CTX),
    /run-in-env/);
});

test("absolute workdir reference counts", () => {
  assert.match(bashInspectsRepo(`find ${CTX.workdir}/utils -name '*.go'`, CTX),
    /working tree/);
});

test("bare relative inspection counts (cwd is the workdir)", () => {
  assert.ok(bashInspectsRepo("go test ./utils/cache/... -v", CTX));
  assert.ok(bashInspectsRepo("cat main.go", CTX));
  assert.ok(bashInspectsRepo("ls", CTX));
  assert.ok(bashInspectsRepo("git log --oneline | head", CTX));
});

test("out-dir plumbing is exempt", () => {
  assert.equal(bashInspectsRepo(`cat ${CTX.outDir}/repro.json`, CTX), null);
  assert.equal(bashInspectsRepo(`ls "${CTX.outDir}"`, CTX), null);
});

test("harmless commands pass", () => {
  assert.equal(bashInspectsRepo("echo done", CTX), null);
  assert.equal(bashInspectsRepo(`mkdir -p ${CTX.outDir}/x`, CTX), null);
});

test("heredoc bodies are data: a task file MENTIONING tools is not inspection", () => {
  const cmd = [
    `cat > "${CTX.outDir}/worker-task-repro-a1-1.md" <<'TASK'`,
    "Run go test ./utils/cache and fix simple_cache.go;",
    "do not call gemini_worker.py yourself.",
    "TASK",
  ].join("\n");
  assert.equal(bashInspectsRepo(cmd, CTX), null);
});

test("heredoc MENTIONING gemini_worker.py does not count as the delegation", () => {
  // The opener writes to the out dir (exempt plumbing) and the body is data —
  // so this must classify as null WITHOUT being treated as a real delegation
  // by the guard (covered again end-to-end below via the sentinel check).
  const cmd = [
    `cat > "${CTX.outDir}/notes.md" <<'EOF'`,
    "later: gemini_worker.py --task-file x",
    "EOF",
  ].join("\n");
  assert.equal(bashInspectsRepo(cmd, CTX), null);
});

// ---- searchTargetsRepo: the Grep/Glob delegate-first classifier -------------

test("path-less and relative searches target the repo (cwd is the workdir)", () => {
  assert.match(searchTargetsRepo(undefined, CTX), /workdir cwd/);
  assert.match(searchTargetsRepo("", CTX), /workdir cwd/);
  assert.match(searchTargetsRepo("utils/cache", CTX), /relative path/);
});

test("absolute workdir search counts; out-dir and scratch searches are exempt", () => {
  assert.match(searchTargetsRepo(`${CTX.workdir}/utils`, CTX), /working tree/);
  assert.equal(searchTargetsRepo(CTX.outDir, CTX), null);
  assert.equal(searchTargetsRepo(`${CTX.outDir}/phases`, CTX), null);
  assert.equal(searchTargetsRepo("/private/tmp/scratch", CTX), null);
});

// ---- makePhaseNarrator: the live terminal progress tap ----------------------
// The narrator is print-only, but it is the run's live face — a wrong line
// (a delegation missed, a phantom delegation from a heredoc mention) would
// mislead the person watching a paid run, so its event parsing is pinned here.

test("narrator: init, delegation round-trip, guard denial and result all narrate correctly", () => {
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  const feed = (ev) => narrate(JSON.stringify(ev));

  feed({ type: "system", subtype: "init", model: "claude-opus-4-6" });
  // One real delegation: heredoc task-file write + worker invocation in the
  // SAME Bash command (the shape the skill mandates).
  feed({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash",
    input: { command: `cat > "/out/worker-task-repro-a1-1.md" <<'TASK'\nfix it\nTASK\n"/venv/bin/python" "/tools/gemini_worker.py" --task-file "/out/worker-task-repro-a1-1.md"` } }] } });
  feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1",
    content: [{ type: "text", text: "worker done" }] }] } });
  // A denied pre-delegation Read: is_error tool_result carrying the deny text.
  feed({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read",
    input: { file_path: "/w/main.go" } }] } });
  feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true,
    content: [{ type: "text", text: "DELEGATE FIRST: the repository is locked. Blocked here: Read of /w/main.go" }] }] } });
  feed({ type: "result", num_turns: 4, total_cost_usd: 0.1234 });
  narrate("not json at all"); // partial/garbage line: skipped, never throws

  const log = out.join("\n");
  // Identity: the product is named, not the internal "driver" role — the
  // external audience for this log knows "Claude Code as Harness".
  assert.match(log, /Claude Code session up — claude-opus-4-6/);
  assert.match(log, /repo LOCKED/);
  // The hand-off is a box, not a line, so it survives a scrolling screenshare.
  assert.match(log, /┌─ DELEGATION 1 — Claude Code hands the work to Gemini/);
  assert.match(log, /worker-task-repro-a1-1\.md/);
  assert.match(log, /└─ Gemini returned/);
  // A denial names the MECHANISM and echoes the blocked call. `Read` is tool
  // inspection; a Bash probe would read "shell inspection" (see the next test).
  assert.match(log, /BLOCKED by the delegate-first lock \(tool inspection\)/);
  assert.match(log, /Read {2}\/w\/main\.go/);
  assert.match(log, /Claude Code done — 4 turn\(s\)/);
  assert.match(log, /\$0\.1234 \(Max seat — modeled, not billed\)/,
    "cost must not read as an invoice");
  assert.match(log, /1 delegation\(s\) to Gemini/);
  assert.match(log, /1 lock denial\(s\) — every one is the control working/,
    "a denial is the control succeeding and must never read as a run failure");
  // Ordering still matters: session up, then hand-off, then return.
  assert.ok(log.indexOf("session up") < log.indexOf("DELEGATION 1"));
  assert.ok(log.indexOf("DELEGATION 1") < log.indexOf("Gemini returned"));
});

test("narrator: each lock mechanism is named distinctly, never collapsed to one word", () => {
  // The delegate-first lock seals three independent routes into the repo. A
  // generic "blocked" line reduces the strongest evidence a delegated run
  // produces — that the driver tried several distinct ways in and every one
  // was sealed — down to a count. Google's ask 3b is precisely about whether
  // Claude Code really hands work to Gemini; this is where the log answers it.
  const deny = (id, name, input, blocked) => {
    const out = [];
    const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
    narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use",
      id, name, input }] } }));
    narrate(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result",
      tool_use_id: id, is_error: true,
      content: [{ type: "text", text: `DELEGATE FIRST: locked. Blocked here: ${blocked}` }] }] } }));
    return out.join("\n");
  };

  assert.match(deny("a", "Bash", { command: "find workdir/src -type f" }, "references the working tree"),
    /\(shell inspection\)/);
  assert.match(deny("b", "Read", { file_path: "/w/src/modules/index.ts" }, "Read of /w/src/modules/index.ts"),
    /\(tool inspection\)/);
  assert.match(deny("c", "Grep", { pattern: "Controller" }, "Grep of /w"),
    /\(tool inspection\)/);
  // And the blocked command itself is echoed, so a viewer sees what was tried.
  assert.match(deny("d", "Bash", { command: "ls workdir/" }, "references the working tree"),
    /ls workdir\//);
});

test("narrator: the tree-write ban is reported as its own, louder mechanism", () => {
  // Normally unreachable — the edit tools are stripped before the session
  // starts — so if it ever fires it must not look like the routine read lock.
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use",
    id: "w1", name: "Write", input: { file_path: "/w/src/x.ts" } }] } }));
  narrate(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result",
    tool_use_id: "w1", is_error: true,
    content: [{ type: "text", text: "the driver writes into the tree — denied" }] }] } }));
  const log = out.join("\n");
  assert.match(log, /BLOCKED by the tree-write ban \(direct write\)/);
  assert.match(log, /may never edit the repo itself/);
});

test("narrator: an undelegated run gets no actor gutter — one actor needs no column", () => {
  const out = [];
  const narrate = makePhaseNarrator({ delegated: false }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-4-6" }));
  narrate(JSON.stringify({ type: "result", num_turns: 5, total_cost_usd: 0.3 }));
  const log = out.join("\n");
  assert.doesNotMatch(log, /\[C\]/, "an all-Opus run has one actor; the gutter would be noise");
  assert.doesNotMatch(log, /repo LOCKED/, "there is no delegation lock in an undelegated cell");
  assert.match(log, /Claude Code session up/);
});

test("narrator: contract writes print the filename, not a truncated document body", () => {
  // The driver emits contract files as a heredoc. Printed raw, the line
  // truncates mid-sentence and shows a fragment of a document instead of the
  // fact that a document was produced. The filename is the information.
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "h1",
    name: "Bash", input: { command:
      `cat > "out/requirements.md" <<'EOF'\n## Functional requirements\n**FR-1: HTTP endpoint path**\nEOF` } }] } }));
  assert.equal(out.length, 1);
  assert.match(out[0], /wrote out\/requirements\.md/);
  assert.doesNotMatch(out[0], /FR-1/, "the document body belongs on disk, not in the log");
});

test("narrator: a bare Skill call is named instead of printing an empty line", () => {
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use",
    id: "s1", name: "Skill", input: {} }] } }));
  assert.match(out[0], /loading delegation skill/);
});

// The `via <sdk> <version> -> Vertex <region>` clause added 2026-07-26 exists
// so a viewer of the terminal — or of a recording of it — can see WHICH CABLE
// reached Gemini, not merely that Gemini answered. Two properties matter and
// neither is obvious from reading the code: it must render when the worker
// wrote the fields, and it must vanish silently when it did not. The second is
// the load-bearing one. Every sidecar written before that date lacks the keys,
// and a narrator that printed `via undefined` over a real historical run would
// be inventing provenance on the one line whose entire purpose is provenance.
function narrateOneDelegation(sidecar) {
  const dir = mkdtempSync(join(tmpdir(), "narrator-sdk-"));
  const usageFile = join(dir, "worker-usage-repro-a1-1.json");
  writeFileSync(usageFile, JSON.stringify(sidecar));
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use",
    id: "d1", name: "Bash", input: { command:
      `"/venv/bin/python" "/tools/gemini_worker.py" --task-file "/out/worker-task-repro-a1-1.md" --usage-file "${usageFile}"` } }] } }));
  narrate(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result",
    tool_use_id: "d1", content: [{ type: "text", text: "ok" }] }] } }));
  rmSync(dir, { recursive: true, force: true });
  // The hand-off renders as a box (open line, receipts, close line), so the
  // assertion surface is the whole block rather than one indexed line.
  return out.join("\n");
}

test("narrator: the delegation block names the SDK, its version and the Vertex region", () => {
  const block = narrateOneDelegation({
    model: "gemini-3.5-flash", thinking: "HIGH",
    sdk: "google-antigravity", sdk_version: "0.1.7",
    vertex_project: "ai-studies-console", vertex_location: "asia-south1",
    usage: { total_token_count: 73037, prompt_token_count: 71280, candidates_token_count: 1128 },
  });
  assert.match(block, /via google-antigravity 0\.1\.7/, "the cable must be named, not just the model");
  assert.match(block, /→ Vertex AI · asia-south1/, "where it executed must be in the block");
  assert.match(block, /gemini-3\.5-flash @ thinking HIGH/, "the model must survive the new layout");
  assert.match(block, /73,037 tokens/, "the receipts must survive the new layout");
});

test("narrator: the delegation block reports cached input and the worker's tool calls", () => {
  // Both fields have always been written by gemini_worker.py and were both
  // discarded by the display layer until 2026-07-26. Cache reads bill far
  // below fresh input, so a viewer shown only the input total will price the
  // worker several-fold too high; and "1 delegation" without the tool-call
  // count reads as one autocomplete round-trip rather than a 24-step session.
  const block = narrateOneDelegation({
    model: "gemini-3.5-flash", thinking: "HIGH",
    sdk: "google-antigravity", sdk_version: "0.1.7", vertex_location: "asia-south1",
    tool_call_count: 24,
    usage: {
      prompt_token_count: 550298, cached_content_token_count: 479916,
      candidates_token_count: 5614, thoughts_token_count: 5854, total_token_count: 561766,
    },
  });
  assert.match(block, /24 tool call\(s\) inside this one delegation/);
  assert.match(block, /input 550,298 = 479,916 cached \(87%\) \+ 70,382 fresh/);
  assert.match(block, /output 5,614 · thinking 5,854/);
});

test("narrator: a sidecar written before SDK identity existed prints no phantom provenance", () => {
  const block = narrateOneDelegation({
    model: "gemini-3.5-flash", thinking: "HIGH",
    usage: { total_token_count: 100, prompt_token_count: 90, candidates_token_count: 10 },
  });
  assert.doesNotMatch(block, /via /, "no sdk key must mean no via-clause at all");
  assert.doesNotMatch(block, /undefined/, "never render a missing field as a value");
  assert.doesNotMatch(block, /tool call/, "no tool_call_count must mean no tool-call line");
  assert.doesNotMatch(block, /cached/, "no cache field must not imply a cache hit of zero");
  assert.match(block, /gemini-3\.5-flash/, "the pre-existing receipts must still narrate");
});

test("narrator: an SDK recorded without a resolvable version still names the SDK", () => {
  // gemini_worker.py degrades SDK_VERSION to "unknown" rather than failing the
  // call; the narrator must carry that through as a stated unknown.
  const block = narrateOneDelegation({
    model: "gemini-3.5-flash", thinking: "HIGH",
    sdk: "google-antigravity", sdk_version: "unknown", vertex_location: "asia-south1",
    usage: { total_token_count: 100 },
  });
  assert.match(block, /via google-antigravity unknown → Vertex AI · asia-south1/);
});

test("narrator: a heredoc that merely MENTIONS the worker is a plain Bash line, not a delegation", () => {
  const out = [];
  const narrate = makePhaseNarrator({ delegated: true }, (s) => out.push(s));
  narrate(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t9",
    name: "Bash", input: { command: `cat > "/out/notes.md" <<'EOF'\nlater: gemini_worker.py --task-file x\nEOF` } }] } }));
  assert.equal(out.length, 1);
  assert.match(out[0], /wrote \/out\/notes\.md/);
  assert.doesNotMatch(out[0], /DELEGATION/);
});

// ---- end-to-end: the generated guard script at the process boundary --------

function freshGuard() {
  const root = mkdtempSync(join(tmpdir(), "guard-test-"));
  const workdir = join(root, "workdir");
  const outDir = join(root, "out");
  mkdirSync(workdir, { recursive: true });
  mkdirSync(join(outDir, "phases"), { recursive: true });
  const script = join(root, "delegation-guard.mjs");
  writeFileSync(script, renderTreeWriteHook({ workdir, outDir, slot: "repro-a1" }));
  const sentinel = join(outDir, "phases", "repro-a1.first-delegation");
  const run = (input) =>
    execFileSync(process.execPath, [script], {
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
    });
  return { root, workdir, outDir, sentinel, run };
}

const denialOf = (stdout) => {
  if (!stdout.trim()) return null;
  return JSON.parse(stdout).hookSpecificOutput?.permissionDecisionReason ?? null;
};

test("e2e: pre-delegation workdir Read is denied, out-dir and scratch Reads pass", () => {
  const g = freshGuard();
  try {
    const denied = denialOf(g.run({ tool_name: "Read", tool_input: { file_path: join(g.workdir, "main.go") } }));
    assert.match(denied, /DELEGATE FIRST/);
    assert.equal(denialOf(g.run({ tool_name: "Read", tool_input: { file_path: join(g.outDir, "repro.json") } })), null);
    assert.equal(denialOf(g.run({ tool_name: "Read", tool_input: { file_path: "/private/tmp/scratch/task.output" } })), null);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("e2e: pre-delegation repo inspection via Bash is denied", () => {
  const g = freshGuard();
  try {
    const denied = denialOf(g.run({ tool_name: "Bash", tool_input: { command: "go test ./utils/cache/... -v" } }));
    assert.match(denied, /DELEGATE FIRST/);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("e2e: pre-delegation Grep/Glob is denied (even path-less), out-dir search passes", () => {
  const g = freshGuard();
  try {
    assert.match(denialOf(g.run({ tool_name: "Grep", tool_input: { pattern: "SetWithTTL" } })),
      /DELEGATE FIRST/);
    assert.match(denialOf(g.run({ tool_name: "Glob", tool_input: { pattern: "**/*.go", path: g.workdir } })),
      /DELEGATE FIRST/);
    assert.equal(denialOf(g.run({ tool_name: "Grep", tool_input: { pattern: "gate", path: g.outDir } })), null);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("e2e: the delegation unlocks the repository (sentinel), then verification passes and writes stay banned", () => {
  const g = freshGuard();
  try {
    // A task file that merely mentions the worker must NOT unlock.
    g.run({ tool_name: "Bash", tool_input: { command:
      `cat > "${g.outDir}/worker-task-repro-a1-1.md" <<'TASK'\nfix it; gemini_worker.py is how I run you\nTASK` } });
    assert.equal(existsSync(g.sentinel), false, "heredoc mention must not drop the sentinel");

    // The real delegation: allowed, and drops the sentinel.
    const out = g.run({ tool_name: "Bash", tool_input: { command:
      `"/venv/bin/python" "/tools/gemini_worker.py" --task-file "${g.outDir}/worker-task-repro-a1-1.md" --workdir "${g.workdir}"` } });
    assert.equal(denialOf(out), null);
    assert.equal(existsSync(g.sentinel), true, "real delegation must drop the sentinel");

    // Post-delegation: verification unlocks…
    assert.equal(denialOf(g.run({ tool_name: "Read", tool_input: { file_path: join(g.workdir, "main.go") } })), null);
    assert.equal(denialOf(g.run({ tool_name: "Bash", tool_input: { command: "go test ./..." } })), null);
    assert.equal(denialOf(g.run({ tool_name: "Grep", tool_input: { pattern: "SetWithTTL" } })), null);
    // …but the tree-write ban never lifts.
    const wd = denialOf(g.run({ tool_name: "Bash", tool_input: { command: "sed -i '' 's/a/b/' main.go" } }));
    assert.match(wd, /writes into the tree/);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("e2e: fails open on unparseable input and ignores unguarded tools", () => {
  const g = freshGuard();
  try {
    assert.equal(denialOf(g.run("not json at all")), null);
    assert.equal(denialOf(g.run({ tool_name: "TodoWrite", tool_input: { todos: [] } })), null);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

// ---- delegated Skill vocabulary --------------------------------------------
// The Skill preamble was parameterized per kind on 2026-07-25 so an SDLC cell
// stops being told it is in a "repro/localize/patch" phase it does not have.
// Two properties have to hold forever, and neither is self-evident from
// reading the code, so both are pinned here.

// The Pro preamble is part of the SWE-bench Pro prompts' BYTES. The kinds split
// (f256cb0) guaranteed Pro byte-identity and the parameterization must not
// quietly spend it — a one-character drift in a mandate is a different
// experiment, not a tidy-up. If you INTEND to change Pro's prompt, update the
// golden in the same commit and say so in the message, so the change is a
// decision rather than an accident.
//
// RE-PINNED 2026-07-25, deliberately: 72405c58e9c13b11 → 7b11ab3c08b720e7. The
// only delta is the worker's `--timeout` line, which now renders its 60% slice
// of the phase (1620 s) instead of the whole phase (2700 s) — DESIGN §11 defect
// 3. This is a study-definition change, applied to both policies before any
// further cell runs, exactly as §2.4 requires; the two Pro harness runs already
// recorded (2407-0932, 2407-1117) predate it and carry their own policy
// snapshots.
//
// RE-PINNED 2026-07-29, deliberately: 7b11ab3c08b720e7 → ab563915b3dd1cd8. The
// delta is the re-delegation rule (finding C1 of the 2026-07-28 driver-integrity
// audit). The old text — "re-delegate with a corrected task description … do not
// fix its work by hand" — banned the driver's HANDS but left its MOUTH open: a
// "corrected task description" could legally contain the finished function, a
// diff, or a line-level instruction, and the worker would then be typing the
// driver's answer while every receipt still recorded a Gemini delegation. The
// audit found that shape live on the SDLC runs. The rule now names what a
// re-delegation MAY carry (observed failure, verbatim output, the unmet contract
// clause) and what it must NEVER carry (diff/patch, finished file or body,
// "change line X to Y", a tree-mutating command), and closes the matching
// second-order hole: a command the guard denied to the driver cannot be handed
// to the worker to run on its behalf.
//
// This is a study-definition change under DESIGN §2.4 — it lands before any
// further cell runs. The eight runs already recorded (5 SWE-Pro, 3 SDLC) predate
// it, carry their own snapshots, and stay valid as evidence of the OLD mandate;
// the two contaminated SDLC runs are annotated rather than rewritten.
//
// RE-PINNED 2026-07-29, NOT a prompt change: ab563915b3dd1cd8 → 6e928ddf750c7855.
// The rendered text is byte-identical; the hash now covers the render with the
// absolute harness directory normalised away (see normalizeSkill below), so the
// pin stops encoding this checkout's path on disk. Nothing about the mandate,
// the vocabulary or the worker contract moved.
const SKILL_ARGS = { worker: "gemini-3.5-flash", workerThinking: "HIGH",
  workdir: "/w/nav", outDir: "/o/r1", timeoutMin: 45, slot: "s-a2" };

// The rendered Skill embeds two ABSOLUTE paths — gemini_worker.py and the
// sdk-probe venv's python — both derived from runtimes.mjs's own
// `import.meta.url`. That is correct at run time (the driver shells out to
// those exact files), but it makes the raw render machine-dependent: the same
// unchanged code hashes differently in a clone at a different path. Pinning the
// raw hash pinned this checkout's location on disk, so the test passed here and
// failed in every other copy of the repo — including the extracted public one.
// Normalising the harness directory to a fixed token keeps the guard doing its
// real job (catch an UNINTENDED change to the prompt's wording) while dropping
// the accidental assertion about where the repo happens to live. Same reason the
// length assertion moves onto the normalised string.
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const normalizeSkill = (s) => s.split(HARNESS_DIR).join("<HARNESS>");

test("Pro's delegated Skill matches its pinned golden render", () => {
  const rendered = normalizeSkill(renderWorkerSkill({ ...SKILL_ARGS, vocab: DELEGATION_VOCAB.swepro }));
  assert.equal(createHash("sha256").update(rendered).digest("hex").slice(0, 16), "6e928ddf750c7855");
  assert.equal(rendered.length, 4644);
});

// C1 regression guard. The hole this closes is not a bug in the guard code — the
// guard was working — it is a hole in what the driver was TOLD. So the assertion
// has to be on the rendered mandate, and it has to hold for every vocabulary:
// a kind that forgets to pass its vocab falls back to NEUTRAL, and NEUTRAL must
// carry the rule too or the fallback quietly reopens it.
test("every kind's mandate bounds what a re-delegation may carry", () => {
  for (const [kind, vocab] of [["swepro", DELEGATION_VOCAB.swepro],
                               ["sdlc", DELEGATION_VOCAB.sdlc],
                               ["neutral fallback", undefined]]) {
    const r = renderWorkerSkill({ ...SKILL_ARGS, vocab });
    for (const clause of [
      "may carry ONLY evidence",          // the allow-list is stated, not implied
      "must NEVER carry the remedy",      // …and so is the deny-list
      "no diff or patch",
      "no finished file or function body",
      "a scripted rewrite",               // the tree-mutating-command clause
      "denied to YOU may not be handed to the worker",  // the second-order hole
    ]) assert.ok(r.includes(clause), `${kind} mandate is missing: ${clause}`);
    // Verification must stay explicitly legal, or a driver reads the ban as
    // "do not look at the worker's output" and the cell loses its only check.
    assert.ok(r.includes("Running tests and"), `${kind} mandate dropped the verification carve-out`);
  }
});

// DESIGN §11 defect 3 regression guard. The bug was a NESTED BUDGET EQUAL TO
// ITS PARENT: one worker call authorised to consume the whole phase, leaving
// the driver no clock to verify, re-delegate, or write the contract file the
// gate requires — so the attempt failed for lack of runway and the manifest
// could not distinguish that from a model that simply could not do the work.
// Asserted across the range rather than at one value, because the failure mode
// returns through rounding at small phase budgets, not at the value we happen
// to ship today.
test("the worker's clock is strictly nested inside the phase clock", () => {
  for (const phase of [2, 5, 10, 15, 30, 45, 60, 120]) {
    const w = workerTimeoutMin(phase);
    assert.ok(w < phase, `worker ${w} min is not strictly less than phase ${phase} min`);
    assert.ok(w >= 1, `worker slice ${w} is not a usable budget`);
  }
});

// The same nesting rule, asserted where it actually reaches the model: the
// rendered Skill must quote the worker's slice, never the phase budget.
test("the rendered Skill quotes the worker slice, not the phase budget", () => {
  const rendered = renderWorkerSkill({ ...SKILL_ARGS, vocab: DELEGATION_VOCAB.swepro });
  assert.ok(rendered.includes(`--timeout ${workerTimeoutMin(45) * 60}`),
    "Skill does not quote the worker's slice");
  assert.ok(!rendered.includes(`--timeout ${45 * 60}`),
    "Skill still hands the worker the entire phase clock");
});

// The bug this parameterization fixed: a non-Pro cell inheriting SWE-bench
// vocabulary. Asserted as ABSENCE, because that is the failure mode — a kind
// that forgets to pass its vocab falls back to NEUTRAL, and NEUTRAL must be
// clean too, or the fallback silently reintroduces exactly what we removed.
test("no non-Pro kind inherits SWE-bench vocabulary in its mandate", () => {
  const PRO_WORDS = ["repro", "localize", "LOCALIZE", "harness_repro", "test_command", "the bug", "the fix"];
  for (const [kind, vocab] of [["sdlc", DELEGATION_VOCAB.sdlc], ["neutral fallback", undefined]]) {
    const rendered = renderWorkerSkill({ ...SKILL_ARGS, vocab });
    const leaked = PRO_WORDS.filter((w) => rendered.includes(w));
    assert.deepEqual(leaked, [], `${kind} leaked SWE-bench Pro vocabulary: ${leaked.join(", ")}`);
  }
});

// The mandate's structural rules are the delegated cell's line of defence and
// are NOT kind-specific — every vocabulary must still carry them verbatim.
test("every kind's mandate keeps the structural delegation rules", () => {
  for (const vocab of [DELEGATION_VOCAB.swepro, DELEGATION_VOCAB.sdlc, undefined]) {
    const r = renderWorkerSkill({ ...SKILL_ARGS, vocab });
    for (const rule of ["you are the DRIVER, not the engineer", "DELEGATE FIRST",
                        "zero delegations", "Hand the worker the PROBLEM, not the SOLUTION"])
      assert.ok(r.includes(rule), `missing structural rule: ${rule}`);
  }
});

// ---- the declared region reaches the worker's argv ---------------------------
// B-REGION regression guards (2026-07-31). The defect: a policy could declare
// `region: global` and every token still bill in asia-south1, with no artifact
// disagreeing. The region was recorded on the CABLE (descriptive — it reached
// the manifest and getVertexRates) but nothing on the executable path read it,
// so the worker resolved its endpoint from GOOGLE_CLOUD_LOCATION and the sidecar
// wrote that same ambient value down as if it were the policy's.
//
// That was survivable while every policy pinned asia-south1 and the env agreed.
// It stopped being survivable on the Flash-Lite pin: gemini-3.5-flash-lite is
// served ONLY on `global`, so the first delegation of the first paid run would
// have 404'd against an asia-south1 endpoint while the policy file plainly read
// `region: global`.
//
// Asserted at BOTH ends of the chain, because each end fails differently: the
// render test catches a renderer that stops emitting the flag, and the chain
// test catches a resolver that stops putting the key on the binding — a break
// the render test cannot see, since it is handed the argument directly.
test("a binding's region is emitted as --region on the worker command", () => {
  const rendered = renderWorkerSkill({ ...SKILL_ARGS, workerRegion: "global",
    vocab: DELEGATION_VOCAB.swepro });
  assert.ok(rendered.includes('--region "global"'),
    "the declared region never reached the worker's argv");
});

// The other half of the omitted-not-nulled discipline, and the reason emission
// is conditional rather than defaulted. Legacy (v1) policies resolve through
// resolveLegacyHarnessStages, whose bindings are the raw YAML objects and carry
// no worker_region key at all; frozen policy_snapshot.yaml files inside evidence
// bundles ALREADY handed to Google are that shape. Replaying one must resolve
// the endpoint exactly as it did on the day — from the environment — so a
// binding that declares nothing must produce a command that says nothing.
// Defaulting the flag to asia-south1 here would look harmless and would silently
// rewrite what those recorded runs replay as.
test("a binding with no region emits no --region flag at all", () => {
  const rendered = renderWorkerSkill({ ...SKILL_ARGS, vocab: DELEGATION_VOCAB.swepro });
  assert.ok(!rendered.includes("--region"),
    "an undeclared region was defaulted onto the worker command");
});

// End-to-end over a REAL shipped policy file, not a hand-built binding: policy
// YAML → loadPolicy → resolved binding → renderWorkerSkill → argv. Every link
// in that chain existed before this fix except the binding key, which is exactly
// why a unit test on the renderer alone would have stayed green through the
// entire defect. Uses all-gemini-flash-high because it is the Flash-Lite cell
// whose `global` pin the defect would have broken first.
test("a shipped policy's declared region survives the whole chain to argv", () => {
  const policy = loadPolicy(join(HARNESS_DIR, "policies", "all-gemini-flash-high.yaml"),
    "claude-code", ["repro", "localize", "patch"]);
  const binding = policy.resolved.repro.binding;
  assert.equal(binding.worker_region, "global",
    "the resolver dropped the policy's declared region");
  const rendered = renderWorkerSkill({ ...SKILL_ARGS, worker: binding.worker,
    workerThinking: binding.worker_thinking, workerRegion: binding.worker_region,
    vocab: DELEGATION_VOCAB.swepro });
  assert.ok(rendered.includes('--region "global"'),
    "the policy's region did not reach the worker's argv");
});
