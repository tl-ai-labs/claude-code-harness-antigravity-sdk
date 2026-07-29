/**
 * kinds/sdlc.mjs — the SDLC task kind: the console's own SDLC flow
 * (templates/<template_id>/template.yaml, normally sdlc-mini) driven end to
 * end by ONE agent runtime against a fresh copy of the platform scaffold,
 * graded by the scaffold's own build+test. Selected by --task-dir.
 *
 * This is the console's segregation logic transplanted into the harness:
 * exactly as run-executor.ts iterates a template's stages and dispatches on
 * executor kind, this kind loads template.yaml LIVE and walks its stages —
 * the stage list, order, and verify-repair budget live in the template
 * data, not in this code. What differs from the console is WHO fills a
 * stage: there, each stage fans out through the orchestrator's model
 * router; here, every model-driven stage is one stateless invocation of
 * the SAME agent runtime under the SAME policy (the harness-matrix study
 * design: procedure fixed, runtime varies).
 *
 * Differences from kinds/swepro.mjs, each with a reason:
 *   - No sealed per-instance image: the task environment is the scaffold,
 *     provisioned as a plain host-side copy + git init + `scaffold-base`
 *     tag (the diff anchor — same role as Pro's `sealed-base`). One shared
 *     toolchain image (Dockerfile.sdlc) serves every SDLC run.
 *   - No nulled hosts: greenfield brief — no fix exists anywhere to leak,
 *     and pnpm legitimately reaches the npm registry (Prisma engines too).
 *   - No diff stripping: tests are part of the DELIVERABLE here, not a
 *     grade-tampering channel — the graded diff keeps everything.
 *   - Gates are slot gates: the scaffold declares where a model may write
 *     (src/modules/**, test/modules/**, schema models below the marker);
 *     enforcement is diff-vs-anchor based, so it also catches changes an
 *     agent tried to hide behind a git commit.
 *   - verify is a SCRIPT stage (the template's `verify` executor): chassis
 *     integrity (sha256 manifest) + build + tests, with the template's
 *     repair budget — failures feed the real log back through the execute
 *     prompt's repair block, one runtime call per round.
 *   - Audit runs with the Pro-only families skipped (no gold fix to mine
 *     or fetch; test edits are legitimate) — the delegated-cell checks
 *     stay fully active.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { basename, join, normalize, resolve } from "node:path";
import { auditRun, manifestAuditBlock } from "../audit.mjs";
import { gradeSdlcRun } from "../grade-sdlc.mjs";
import { DELEGATION_VOCAB } from "../runtimes.mjs";
import {
  HARNESS_DIR, ROOT, parseYaml, bindingLabel, isDelegatedBinding, loadPolicy,
  makePromptRenderer, writeRunInEnv, makeExecInEnv, makeGit, classifyChanges,
  cleanArtifacts, saneRepoPath, computeDiff, runStageAttempts, costTotals, makeRunDir,
} from "./lib.mjs";
// The shared terminal voice (2026-07-25 demo-grade logging): run header,
// stage banners and the final scoreboard render through logfmt so an SDLC
// run reads line-for-line like a Pro run. Presentation-only — every number
// printed comes from the same records that land in manifest.json.
import {
  paint, rule, kvBlock, attemptTotals, tokenSplit, fmtDur, fmtUsd, say, sayErr,
} from "../logfmt.mjs";
// The run's two BIG frames (opening header, closing scoreboard) live in
// logrender.mjs as pure functions of a plain descriptor, so replay-log.mjs can
// re-render THIS EXACT TEXT from a finished run's manifest.json at $0 — a demo
// rehearsal that renders different text from the real run is worse than none.
import { sdlcHeader, sdlcFooter } from "../logrender.mjs";

// One toolchain image shared by every SDLC run — pnpm version in the tag so
// a Dockerfile bump can never silently reuse a stale image.
const SDLC_IMAGE = "sdlc-env:node22-pnpm9.12.3";

// Pro-only audit families, skipped here (see header). The delegated-cell
// families (driver-direct-edit, driver-predelegation-inspection) are NOT in
// this list and stay active — who does the work is kind-independent.
const SKIP_AUDIT_FAMILIES = ["git-history-mining", "source-host-fetch", "test-edit-attempt"];

// The scaffold's write slots. prisma/schema.prisma is allowed as a CHANGED
// path here and constrained to append-below-marker by schemaPrefixError —
// path-level and content-level enforcement split on purpose.
const SLOT_RE = [/^src\/modules\//, /^test\/modules\//];
const isSlotPath = (p) => SLOT_RE.some((re) => re.test(p)) || p === "prisma/schema.prisma";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Per-stage banner copy for the demo-grade terminal log: what each stage is
// FOR and what its gate checks, stated before the stage runs. Display-only —
// the enforcement of record is the gate code below and prompts/sdlc-*.md.
// Keyed by the template's stage ids (sdlc-mini v0.8.0); an unknown id falls
// back to its executor name, and the execute stage is additionally resolved
// via executeId (its id is template data, not a hardcoded name).
const STAGE_META = {
  requirements: {
    title: "brief → testable requirements",
    gate: "requirements.md with the required sections · repository untouched",
  },
  design: {
    title: "requirements → data model, API and module design",
    gate: "design.md with the required sections · repository untouched",
  },
  "plan-packets": {
    title: "design → 2-8 implementation packets",
    gate: "packets.json: kebab-case ids, slot-path file hints only · repository untouched",
  },
  execute: {
    title: "implement every packet — all code and tests",
    gate: "slot paths only · src/modules AND test/modules touched · schema append-only below the marker · modules registered",
  },
  verify: { title: "chassis integrity + build + tests", gate: null }, // gate text printed live in the branch
  review: {
    title: "senior review of the verified tree",
    gate: "review.md with Findings + Verdict · verified tree untouched",
  },
  judge: {
    title: "score the delivery 0-10",
    gate: "judge.json: four scores in range + summary · verified tree untouched",
  },
  report: { title: "manifest + diff + audit + grade", gate: null },
};

export const sdlc = {
  id: "sdlc",
  // Resolved per-template in run() — the engine never needs it before then.
  agentStages: null,

  async run({ dir: taskDir, runtimeName, runtime, policyPath, dryRun, skipGrade }) {
    // ---- task + template + scaffold load (all validated before any spend) --
    const taskPath = join(resolve(taskDir), "task.json");
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    const tFail = (m) => { throw new Error(`task ${taskPath}: ${m}`); };
    for (const k of ["task_id", "template_id", "scaffold_id", "brief"]) {
      if (typeof task[k] !== "string" || !task[k]) tFail(`"${k}" must be a non-empty string`);
    }
    const briefPath = join(resolve(taskDir), task.brief);
    if (!existsSync(briefPath)) tFail(`brief file ${task.brief} missing`);
    const brief = readFileSync(briefPath, "utf8");
    // The brief is the run's entire problem statement — pin it by hash so a
    // silently edited brief can never masquerade as the same task.
    if (task.brief_sha256 && sha256(brief) !== task.brief_sha256) {
      tFail(`brief sha256 mismatch — brief.md changed since task.json pinned it (update the pin deliberately)`);
    }

    // The brief's own H1 and opening paragraph, for the header row that used to
    // print a filename and nothing else. Lifted VERBATIM rather than
    // summarised: this is the greenfield kind, so the brief IS the task, and a
    // generated gloss would be one more artefact that can quietly disagree with
    // what the models were actually sent. Whitespace is collapsed only so the
    // 80-column wrapper can lay it out; no word is changed, added or dropped.
    // Both parts degrade to null (row falls back to the filename) if a brief
    // ever lacks the shape, because a header must never be the thing that
    // fails a run.
    const briefTitle = /^#\s+(.+?)\s*$/m.exec(brief)?.[1] ?? null;
    const briefLead = brief
      .replace(/^#\s+.+$/m, "")           // drop the H1 we already took
      .split(/\n\s*\n/)                    // first blank-line-delimited block
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith("#")) // skip straight to real prose
      ?.replace(/\s+/g, " ") ?? null;

    const templatePath = join(ROOT, "templates", task.template_id, "template.yaml");
    const template = parseYaml(readFileSync(templatePath, "utf8"));
    const tplFail = (m) => { throw new Error(`template ${templatePath}: ${m}`); };
    if (template?.kind !== "sdlc") tplFail(`kind '${template?.kind}' — this task kind runs sdlc templates only`);
    if (template.scaffold !== task.scaffold_id) {
      tplFail(`scaffold '${template.scaffold}' != task.json scaffold_id '${task.scaffold_id}'`);
    }
    if (!Array.isArray(template.stages) || template.stages.length === 0) tplFail("stages missing");
    for (const s of template.stages) {
      if (!s?.id || !s?.executor) tplFail(`every stage needs id + executor (got ${JSON.stringify(s)})`);
      if (!["llm-task", "verify", "judge", "report"].includes(s.executor)) {
        tplFail(`stage '${s.id}': executor '${s.executor}' not implemented by the harness SDLC kind`);
      }
    }
    const verifyStage = template.stages.find((s) => s.executor === "verify");
    const repairRounds = verifyStage?.config?.repair?.max_rounds ?? 3;
    if (!Number.isInteger(repairRounds) || repairRounds < 0 || repairRounds > 5) {
      tplFail("verify.config.repair.max_rounds must be an integer 0..5");
    }

    const scaffoldDir = join(ROOT, "scaffolds", task.scaffold_id);
    const scaffold = JSON.parse(readFileSync(join(scaffoldDir, "scaffold.json"), "utf8"));
    const scaffoldManifest = JSON.parse(readFileSync(join(scaffoldDir, "scaffold.manifest.json"), "utf8"));
    const conventions = readFileSync(join(scaffoldDir, "CONVENTIONS.md"), "utf8");
    const chassisSchema = readFileSync(join(scaffoldDir, "prisma/schema.prisma"), "utf8");

    // Model-driven stages = the template's llm-task + judge ids, in template
    // order. verify is script-owned (its repair rounds bill under execute's
    // binding); report is the harness's own finish block.
    const agentStages = template.stages
      .filter((s) => s.executor === "llm-task" || s.executor === "judge")
      .map((s) => s.id);
    const executeId = template.stages.find((s) => s.executor === "llm-task" && s.config?.packet === "planned")?.id;
    if (!executeId) tplFail("no llm-task stage with config.packet 'planned' — the kind needs an execute stage");

    const policy = loadPolicy(policyPath, runtimeName, agentStages);
    const renderPrompt = makePromptRenderer(agentStages.map((id) => `sdlc-${id}`));

    /** Append-only rule for the schema slot: the chassis text (which ends at
     * the MODEL SLOT marker) must survive byte-identically as a PREFIX. */
    const schemaPrefixError = (workdirSchemaText) =>
      workdirSchemaText.startsWith(chassisSchema) ? null
        : "prisma/schema.prisma no longer starts with the chassis content — models may only be " +
          "APPENDED below the MODEL SLOT marker; everything above it must stay byte-identical";

    // Run identity header (demo-grade logging): the boxed block a watcher —
    // or a reviewer reading a captured log — needs to know EXACTLY what this
    // run is before a single paid token moves: task, template, scaffold, the
    // full stage walk, every model stage's binding, whose seat pays for what,
    // and what the delegation guard enforces. Same visual grammar as the
    // SWE-bench Pro kind's header.
    // Rendered by logrender.sdlcHeader from a plain descriptor, NOT inline:
    // replay-log.mjs rebuilds the same descriptor from a finished run's
    // manifest.json and re-renders this frame at $0, which is how the demo's
    // wording gets reviewed before it is screenshared. The descriptor is
    // deliberately all strings/numbers — nothing here hands the renderer a
    // policy or template object it could reach further into.
    //
    // Hoisted ABOVE the dry-run block on purpose. Everything the frame needs
    // (task, template, scaffold, resolved policy) is already known here, and
    // all of it is free — no preflight, no docker, no tokens. Building it in
    // one place means `--dry-run` opens with the BYTE-IDENTICAL frame the paid
    // run opens with, so a column's log can be reviewed before it is paid for;
    // the previous dry run printed its own ad-hoc `task : …` summary, i.e. a
    // second implementation of the header that the live run never emitted and
    // that therefore drifted from it silently. Only the two provenance values
    // (runtime build, wall-clock start) differ, because only those two are
    // genuinely unknown until the run actually starts.
    const delegatedRun = agentStages.some((s) => isDelegatedBinding(policy.resolved[s].binding));
    const headDelegate = delegatedRun ? policy.resolved[agentStages[0]].binding : null;
    const headerFrame = ({ runtimeVersion, startedAt }) => sdlcHeader({
      taskId: task.task_id,
      templateId: template.template_id, templateVersion: template.version,
      scaffoldId: scaffold.scaffold_id, scaffoldVersion: scaffold.version,
      brief: task.brief, briefTitle, briefLead, briefSha: task.brief_sha256,
      // Surfaced BEFORE the run for the same reason the BLOCKED lines are
      // explained before the first one appears: a viewer who meets the
      // consequence without the cause reads a recorded task property as a
      // harness defect.
      knownAmbiguity: task.known_ambiguity,
      cell: `${runtimeName} × ${policy.raw.name}`,
      stageWalk: template.stages.map((s) => s.id),
      retryType: policy.raw.retry.type, maxAttempts: policy.maxAttempts,
      repairRounds, executeId,
      timeoutMin: policy.limits.phase_timeout_min,
      budgetUsd: policy.limits.phase_budget_usd,
      stages: agentStages.map((s) => ({
        id: s,
        label: bindingLabel(policy.resolved[s].binding),
        thinking: policy.resolved[s].thinking,
        // The worker Gemini thinking level, named separately from the driver
        // effort above — a delegated stage has two, and one bare "thinking"
        // label for both is the ambiguity this row exists to remove.
        workerThinking: policy.resolved[s].binding?.worker_thinking,
        // Named per stage so a TIERED policy's orientation paragraph can list
        // every worker actually in play instead of asserting the first one.
        worker: policy.resolved[s].binding?.worker,
      })),
      delegated: delegatedRun,
      driver: headDelegate?.driver, worker: headDelegate?.worker,
      envImage: SDLC_IMAGE,
      runtime: `${runtimeName} ${runtimeVersion}`,
      startedAt,
    });

    // ---- dry run -----------------------------------------------------------
    if (dryRun) {
      // The runtime probe shells out to the CLI. It costs nothing, but a dry
      // run is the one mode that must survive on a machine where the driver
      // is not installed at all (reviewing a column's wording on a laptop),
      // so a failed probe degrades to a labelled placeholder instead of
      // aborting the preview.
      let probedVersion;
      try {
        probedVersion = runtime.version();
      } catch {
        probedVersion = "(not probed — driver CLI unavailable)";
      }
      say(headerFrame({
        runtimeVersion: probedVersion,
        // Never a plausible-looking timestamp: a preview that prints a real
        // ISO stamp is indistinguishable from a captured run in a screenshot.
        startedAt: "— not started (--dry-run: nothing executed)",
      }));
      say(`\n--dry-run: rendered ${agentStages[0].toUpperCase()} prompt below, nothing executed\n`);
      say(renderPrompt(`sdlc-${agentStages[0]}`, {
        WORKDIR: "<run-dir>/workdir",
        OUT_DIR: "<run-dir>/out",
        BRIEF: brief,
        ATTEMPT_NOTE: "",
      }));
      process.exit(0);
    }

    // ---- preflight (all $0, before any build or spend) ---------------------
    try {
      runtime.preflight({ binding: policy.resolved[agentStages[0]].binding });
      execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    } catch (err) {
      sayErr(`preflight failed: ${err.message ?? err}`);
      process.exit(2);
    }

    // Captured once and reused: the same string goes into the header frame the
    // watcher sees AND into manifest.runtime.version, so a replayed log can
    // never disagree with the live one about which driver build produced it.
    const runtimeVersion = runtime.version();
    say(headerFrame({ runtimeVersion, startedAt: new Date().toISOString() }));

    // ---- toolchain image (shared, cached — a rebuild is a no-op) -----------
    say("\n[build] SDLC toolchain image (docker build; fully cached after the first run)…");
    execFileSync("docker", [
      "build", "-f", join(HARNESS_DIR, "Dockerfile.sdlc"), "-t", SDLC_IMAGE, HARNESS_DIR,
    ], { stdio: "inherit" });

    // ---- run dir + workdir provisioning ------------------------------------
    const { runDir, workdir, outDir } = makeRunDir(task.task_id, runtimeName, policy.raw.name);

    // Per-run Docker volume shadowing /app/node_modules, so package installs
    // land on the Linux VM's filesystem instead of the macOS-backed bind mount
    // (see writeRunInEnv for the ` 2`-duplicate corruption this prevents and
    // the run that found it). Per-run rather than shared: a stale node_modules
    // leaking from one run into the next would be exactly the kind of hidden
    // cross-run state DESIGN §2.4 keeps out of a study.
    const nodeModulesVolume =
      `sdlc-nm-${basename(runDir)}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
    execFileSync("docker", ["volume", "create", nodeModulesVolume], { stdio: "ignore" });
    // Teardown is explicit and idempotent: the volume holds a full
    // node_modules (hundreds of MB) and this Mac has 8 GB of disk headroom to
    // spare, so it must not survive the run. Called on every exit path BELOW
    // its creation — never swallowed silently into a bare process.exit.
    const dropNodeModulesVolume = () => {
      try { execFileSync("docker", ["volume", "rm", "-f", nodeModulesVolume], { stdio: "ignore" }); }
      catch { /* already gone, or docker is down — nothing to reclaim either way */ }
    };

    say(`[provision] copying pristine scaffold → ${workdir}`);
    cpSync(scaffoldDir, workdir, { recursive: true });
    const git = makeGit(workdir);
    git("init", "-q");
    git("config", "user.email", "harness@tilicho.local");
    git("config", "user.name", "harness-matrix");
    git("add", "-A");
    git("commit", "-qm", `scaffold-base ${task.scaffold_id}@${scaffold.version}`);
    git("tag", "scaffold-base");

    const runInEnv = writeRunInEnv({
      outDir, workdir, image: SDLC_IMAGE,
      cmdTimeoutS: Math.floor(policy.limits.cmd_timeout_min * 60),
      // No nulled hosts, no platform pin (see header); the node image's
      // entrypoint is not a shell, so interpose bash explicitly.
      shell: "bash",
      // Keep pnpm's store out of the graded tree — see writeRunInEnv for the
      // 2026-07-26 incident this closes. Shared across every SDLC run (it is
      // content-addressed, so sharing is safe and saves a download per run);
      // gitignored, and safe to delete whenever disk is tight.
      pkgStoreDir: join(HARNESS_DIR, ".pkg-store"),
      // Keep node_modules off the macOS bind mount — the other half of the
      // same lesson as pkgStoreDir above, found the hard way on 2026-07-26.
      nodeModulesVolume,
    });
    const execInEnv = makeExecInEnv({ runInEnv, cmdTimeoutMin: policy.limits.cmd_timeout_min });

    // Install once, then prove the CHASSIS is green before any model runs: a
    // red pristine scaffold is an infra bug, and without this baseline it
    // would surface later as a phantom agent failure.
    say("[provision] pnpm install --frozen-lockfile (in-container; Prisma engines download here)…");
    const inst = execInEnv("pnpm install --frozen-lockfile", join(outDir, "install.log"));
    if (inst.exitCode !== 0) {
      sayErr(`provision failed: pnpm install exited ${inst.exitCode} (see ${join(outDir, "install.log")})`);
      dropNodeModulesVolume();
      process.exit(1);
    }
    say("[provision] chassis baseline: pnpm build + pnpm test on the pristine scaffold…");
    for (const [cmd, log] of [["pnpm build", "chassis-build.log"], ["pnpm test", "chassis-test.log"]]) {
      const t0 = Date.now();
      const r = execInEnv(cmd, join(outDir, log));
      if (r.exitCode !== 0) {
        sayErr(`provision failed: pristine scaffold '${cmd}' exited ${r.exitCode} — ` +
          `chassis bug, not an agent result (see ${join(outDir, log)})`);
        dropNodeModulesVolume();
        process.exit(1);
      }
      say(paint.dim(`  ✔ ${cmd} green in ${fmtDur((Date.now() - t0) / 1000)} (pristine scaffold)`));
    }
    say(paint.green("  chassis baseline GREEN — every red result from here on is the agent's, not the scaffold's"));

    // ---- tree-inspection helpers -------------------------------------------
    /** Clean recorded ephemera (build caches etc. — node_modules/dist are
     * gitignored and invisible to git anyway), return what was cleaned. */
    function cleanEphemera() {
      const cls = classifyChanges(git, () => true);
      cleanArtifacts(workdir, cls.artifacts);
      return cls.artifacts;
    }
    /** All changed paths vs an anchor — diff-based, so a `git commit` by the
     * agent (banned by every prompt) hides nothing from the gates. */
    const changedPaths = (anchor) => computeDiff(git, anchor).kept.map((k) => normalize(k.path));

    function resetWorkdirTo(tag) {
      git("reset", "--hard", tag);
      git("clean", "-fdq"); // ignored files (node_modules, dist) survive — no -x
    }

    // ---- contract state (chained into later prompts) -----------------------
    let requirementsMd = null;
    let designMd = null;
    let packets = null;        // parsed packets.json
    let changedFilesList = ""; // post-verify, for review/judge prompts
    let verifiedTreeTagged = false;

    function readContract(name, parse) {
      const p = join(outDir, name);
      if (!existsSync(p)) return { err: `${name} was not written to the output directory` };
      const text = readFileSync(p, "utf8");
      if (!parse) return text.trim() ? { value: text } : { err: `${name} is empty` };
      try { return { value: parse(text) }; } catch (e) { return { err: `${name}: ${e.message}` }; }
    }

    /** Shared gate half for the read-only llm stages: contract present +
     * required headings + repository untouched (diff vs anchor is empty). */
    function gateDocStage(name, headings, anchor = "scaffold-base") {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };
      const c = readContract(name);
      if (c.err) { g.reason = c.err; return g; }
      for (const h of headings) {
        if (!c.value.includes(h)) {
          g.reason = `${name} is missing the required section heading "${h}" (the prompt lists the exact sections)`;
          return g;
        }
      }
      g.artifacts_cleaned = cleanEphemera();
      const changed = changedPaths(anchor);
      if (changed.length) {
        g.reason = `this stage is read-only for the repository, but files changed (undo/avoid all ` +
          `repository edits; only ${name} in the output directory is expected):\n${changed.join("\n")}`;
        return g;
      }
      g.pass = true;
      g.content = c.value;
      return g;
    }

    // ---- per-stage gates ---------------------------------------------------
    function gateRequirements() {
      const g = gateDocStage("requirements.md", ["## Functional requirements", "## Acceptance criteria"]);
      if (g.pass) requirementsMd = g.content;
      delete g.content;
      return g;
    }

    function gateDesign() {
      const g = gateDocStage("design.md", ["## Data model", "## API", "## Module plan"]);
      if (g.pass) designMd = g.content;
      delete g.content;
      return g;
    }

    function gatePlanPackets() {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };
      const c = readContract("packets.json", (t) => JSON.parse(t));
      if (c.err) { g.reason = c.err; return g; }
      const v = c.value;
      if (!Array.isArray(v) || v.length < 2 || v.length > 8) {
        g.reason = `packets.json must be an array of 2–8 packets (got ${Array.isArray(v) ? v.length : typeof v})`;
        return g;
      }
      const ids = new Set();
      for (const p of v) {
        if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(p?.id ?? "")) {
          g.reason = `packets.json: packet id '${p?.id}' must be kebab-case (lowercase letters, digits, hyphens)`;
          return g;
        }
        if (ids.has(p.id)) { g.reason = `packets.json: duplicate packet id '${p.id}'`; return g; }
        ids.add(p.id);
        for (const k of ["title", "goal"]) {
          if (typeof p[k] !== "string" || !p[k].trim()) {
            g.reason = `packets.json: packet '${p.id}' needs a non-empty string "${k}"`;
            return g;
          }
        }
        for (const f of p.files_hint ?? []) {
          if (!saneRepoPath(f) || !isSlotPath(normalize(f))) {
            g.reason = `packets.json: packet '${p.id}' files_hint '${f}' is not a slot path ` +
              "(src/modules/**, test/modules/**, prisma/schema.prisma)";
            return g;
          }
        }
      }
      g.artifacts_cleaned = cleanEphemera();
      const changed = changedPaths("scaffold-base");
      if (changed.length) {
        g.reason = `this stage is read-only for the repository, but files changed:\n${changed.join("\n")}`;
        return g;
      }
      packets = v;
      g.pass = true;
      return g;
    }

    function gateExecute() {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };
      const c = readContract("execute.json", (t) => JSON.parse(t));
      if (c.err) { g.reason = c.err; return g; }
      const done = c.value?.packets_done;
      if (!Array.isArray(done)) { g.reason = `execute.json: "packets_done" must be an array of packet ids`; return g; }
      const want = new Set(packets.map((p) => p.id));
      const missing = [...want].filter((id) => !done.includes(id));
      const unknown = done.filter((id) => !want.has(id));
      if (missing.length || unknown.length) {
        g.reason = "execute.json packets_done must list exactly the planned packet ids" +
          (missing.length ? ` — missing: ${missing.join(", ")}` : "") +
          (unknown.length ? ` — unknown: ${unknown.join(", ")}` : "");
        return g;
      }

      g.artifacts_cleaned = cleanEphemera();
      const changed = changedPaths("scaffold-base");
      const offSlot = changed.filter((p) => !isSlotPath(p));
      if (offSlot.length) {
        g.reason = "the EXECUTE stage changed files outside the scaffold's slots (only src/modules/**, " +
          `test/modules/**, prisma/schema.prisma may change — everything else is the chassis):\n${offSlot.join("\n")}`;
        return g;
      }
      if (!changed.some((p) => /^src\/modules\//.test(p))) {
        g.reason = "no file under src/modules/ was created or changed — the implementation must live there";
        return g;
      }
      if (!changed.some((p) => /^test\/modules\//.test(p))) {
        g.reason = "no file under test/modules/ was created or changed — the conventions require tests " +
          "covering the implemented behavior";
        return g;
      }
      if (changed.includes("prisma/schema.prisma")) {
        const schemaErr = schemaPrefixError(readFileSync(join(workdir, "prisma/schema.prisma"), "utf8"));
        if (schemaErr) { g.reason = schemaErr; return g; }
      }
      const indexText = readFileSync(join(workdir, "src/modules/index.ts"), "utf8");
      if (/MODULES\s*:\s*any\[\]\s*=\s*\[\s*\]/.test(indexText)) {
        g.reason = "src/modules/index.ts still exports an EMPTY MODULES array — register the module(s) " +
          "you created, or the chassis mounts nothing";
        return g;
      }
      g.pass = true;
      return g;
    }

    /** review/judge run after the harness commits the verified tree, so
     * read-only means "diff vs verified-tree is empty". */
    const gateReview = () => gateDocStage("review.md", ["## Findings", "## Verdict"], "verified-tree");

    function gateJudge() {
      const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: [] };
      const c = readContract("judge.json", (t) => JSON.parse(t));
      if (c.err) { g.reason = c.err; return g; }
      const v = c.value;
      for (const k of ["requirements_fidelity", "code_quality", "test_quality", "overall"]) {
        const s = v?.scores?.[k];
        if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 10) {
          g.reason = `judge.json: scores.${k} must be a number 0–10 (got ${JSON.stringify(s)})`;
          return g;
        }
      }
      if (typeof v.summary !== "string" || !v.summary.trim()) {
        g.reason = `judge.json: "summary" must be a non-empty string`;
        return g;
      }
      g.artifacts_cleaned = cleanEphemera();
      const changed = changedPaths("verified-tree");
      if (changed.length) {
        g.reason = `this stage is read-only for the repository, but files changed:\n${changed.join("\n")}`;
        return g;
      }
      g.pass = true;
      return g;
    }

    // ---- the stage walk (template-ordered) ---------------------------------
    const startedAt = new Date().toISOString();
    const stageRecords = [];
    let failedAt = null;

    for (const stage of template.stages) {
      if (failedAt) break;

      // Stage banner (demo-grade logging): the template's own walk, numbered
      // stage-by-stage, each announcing its purpose — and for gated stages
      // its gate contract — BEFORE any output, so the verdicts that follow
      // are judged against a rule the watcher has already read.
      const meta = STAGE_META[stage.id] ?? (stage.id === executeId ? STAGE_META.execute : null);
      say("\n" + rule(`STAGE ${template.stages.indexOf(stage) + 1}/${template.stages.length} · ` +
        `${stage.id.toUpperCase()} — ${meta?.title ?? `${stage.executor} stage`}`));

      // ---- script stages ---------------------------------------------------
      if (stage.executor === "report") {
        // The finish block below IS the report executor: manifest + diff +
        // audit + grade. Recorded so the manifest's stage list mirrors the
        // template's stage list one-to-one.
        say(kvBlock([
          ["executor", "report (script-owned — no model call)"],
          ["note", "emitted by the harness finish block below: diff → audit → manifest → grade"],
        ]));
        stageRecords.push({ stage: stage.id, executor: "report", note: "emitted by the harness finish block" });
        continue;
      }

      if (stage.executor === "verify") {
        say(kvBlock([
          ["executor", `verify (script-owned — no model call unless repairs are needed) · method ${stage.config?.method ?? "build-and-test"}`],
          ["gate", `chassis sha256 manifest intact → ${scaffold.commands.build} → ${scaffold.commands.test} · ` +
            `≤${repairRounds} repair round(s) under the ${executeId.toUpperCase()} binding`],
        ]));
        const rec = {
          stage: stage.id, executor: "verify", method: stage.config?.method ?? "build-and-test",
          integrity: null, initial: null, passed: false, attempts: [],
        };

        // 1. Chassis integrity — content-level (sha256 manifest), on top of
        // the execute gate's path-level slot check: also catches a chassis
        // edit smuggled past git (e.g. by re-tagging the anchor). NOT
        // repairable: the model cannot restore chassis bytes it never saw,
        // so a violation fails the stage without burning repair rounds.
        const partial = new Set(scaffoldManifest.partial_files ?? []);
        const integrityViolations = [];
        for (const [file, hash] of Object.entries(scaffoldManifest.files)) {
          if (partial.has(file)) continue;
          const p = join(workdir, file);
          if (!existsSync(p)) integrityViolations.push(`${file}: missing`);
          else if (sha256(readFileSync(p)) !== hash) integrityViolations.push(`${file}: content changed`);
        }
        const schemaErr = schemaPrefixError(readFileSync(join(workdir, "prisma/schema.prisma"), "utf8"));
        if (schemaErr) integrityViolations.push(schemaErr);
        rec.integrity = { files_checked: Object.keys(scaffoldManifest.files).length, violations: integrityViolations };
        if (integrityViolations.length) {
          sayErr(paint.red(`  ✘ chassis integrity FAIL (not repairable — the model never saw the ` +
            `original chassis bytes):\n  ${integrityViolations.join("\n  ")}`));
          stageRecords.push(rec);
          failedAt = stage.id;
          break;
        }
        say(paint.green(`  ✔ chassis integrity: ${rec.integrity.files_checked} file(s) ` +
          "sha256-verified · schema append-only rule intact"));

        // 2. Build + tests, round 0 (no model involved).
        let lastFailLog = null;
        const buildAndTest = (label) => {
          for (const [step, cmd] of [["build", scaffold.commands.build], ["test", scaffold.commands.test]]) {
            const logPath = join(outDir, "phases", `${stage.id}-${label}.${step}.log`);
            const t0 = Date.now();
            const r = execInEnv(cmd, logPath);
            // Per-step timing on the terminal (demo-grade logging) — the log
            // files carry the full output, the terminal carries the verdict
            // and how long it took. Display-only.
            const took = fmtDur((Date.now() - t0) / 1000);
            if (r.exitCode !== 0) {
              say(paint.red(`  ✘ ${cmd} ${r.timedOut ? "TIMED OUT" : `exited ${r.exitCode}`} ` +
                `after ${took} (${label})`));
              const tail = readFileSync(logPath, "utf8").slice(-4000);
              lastFailLog = { step, cmd, exitCode: r.exitCode, timedOut: r.timedOut, tail };
              return {
                pass: false,
                reason: `'${cmd}' ${r.timedOut ? `timed out after ${policy.limits.cmd_timeout_min} min`
                  : `exited ${r.exitCode}`} — output tail:\n${tail.slice(-1500)}`,
                [`${step}_exit`]: r.exitCode,
              };
            }
            say(paint.green(`  ✔ ${cmd} green in ${took} (${label})`));
          }
          return { pass: true, reason: null };
        };

        const r0 = buildAndTest("r0");
        rec.initial = { pass: r0.pass, reason: r0.pass ? null : r0.reason.slice(0, 400) };
        if (r0.pass) {
          say(paint.green("  ✔ gate PASS — build + tests green on the first pass (0 repair rounds used)"));
          rec.passed = true;
        } else if (repairRounds === 0) {
          say(paint.red("  ✘ gate FAIL — build/tests failed and the template allows 0 repair rounds"));
        } else {
          // 3. Repair rounds: the template's debug loop. Each round is one
          // runtime call under the EXECUTE stage's binding (the codegen
          // seat — same model that wrote the code repairs it), fed the real
          // failing log. No reset between rounds: repair iterates in place.
          say(paint.yellow(`  ⟳ build/tests FAILED — entering the repair loop (≤${repairRounds} ` +
            `round(s)): each round feeds the real failing log to the ${executeId.toUpperCase()} binding, in place`));
          const cfg = policy.resolved[executeId];
          let round = 0;
          const { passed, attempts } = await runStageAttempts({
            stage: stage.id, cfg, policy, runtime, runtimeName, outDir, workdir,
            maxAttempts: repairRounds,
            buildPrompt: (attemptNote) => {
              round += 1;
              const f = lastFailLog;
              return renderPrompt(`sdlc-${executeId}`, {
                WORKDIR: workdir, OUT_DIR: outDir,
                CONVENTIONS: conventions, DESIGN: designMd,
                PACKETS: JSON.stringify(packets, null, 2),
                REPAIR_CONTEXT: [
                  "",
                  `REPAIR ROUND ${round} of ${repairRounds}: the implementation above is DONE but the`,
                  `VERIFY stage failed — '${f.cmd}' ${f.timedOut ? "timed out" : `exited ${f.exitCode}`} ` +
                    `(${f.step} step). The failing output (tail):`,
                  "", "```", f.tail, "```", "",
                  "Your job THIS round is to repair the EXISTING implementation in place so build and",
                  "tests both pass — do not start over, do not weaken tests to make them pass, and",
                  "stay inside the slots.",
                  "",
                ].join("\n"),
                ATTEMPT_NOTE: attemptNote,
              });
            },
            gate: (label) => {
              const g = { pass: false, reason: null, warnings: [], artifacts_cleaned: cleanEphemera() };
              const offSlot = changedPaths("scaffold-base").filter((p) => !isSlotPath(p));
              if (offSlot.length) {
                g.reason = `the repair changed files outside the scaffold's slots:\n${offSlot.join("\n")}`;
                return g;
              }
              const bt = buildAndTest(label);
              g.pass = bt.pass;
              g.reason = bt.reason;
              return g;
            },
            beforeRetry: () => {},
            delegationWhat: "repairing the implementation",
            delegationVocab: DELEGATION_VOCAB.sdlc,
          });
          rec.model_id = cfg.modelId;
          rec.binding = cfg.binding;
          rec.attempts = attempts;
          rec.passed = passed;
        }

        stageRecords.push(rec);
        if (!rec.passed) { failedAt = stage.id; break; }

        // The verified tree becomes the read-only anchor for review/judge —
        // a HARNESS commit (agent commits are banned), so a retried review
        // can be reset without wiping the implementation.
        git("add", "-A");
        git("commit", "-qm", "verified-tree (harness snapshot after verify)");
        git("tag", "verified-tree");
        verifiedTreeTagged = true;
        changedFilesList = changedPaths("scaffold-base").join("\n");
        say(paint.dim("  verified tree committed + tagged 'verified-tree' — " +
          "the read-only anchor REVIEW and JUDGE are gated against"));
        continue;
      }

      // ---- model-driven stages (llm-task + judge) --------------------------
      const cfg = policy.resolved[stage.id];
      say(kvBlock([
        ["binding", bindingLabel(cfg.binding)],
        ["thinking", String(cfg.thinking ?? "n/a")],
        ...(meta?.gate ? [["gate", meta.gate]] : []),
      ]));
      const { passed, attempts } = await runStageAttempts({
        stage: stage.id, cfg, policy, runtime, runtimeName, outDir, workdir,
        buildPrompt: (attemptNote) => {
          const ctx = { WORKDIR: workdir, OUT_DIR: outDir, ATTEMPT_NOTE: attemptNote };
          if (stage.id === "requirements") Object.assign(ctx, { BRIEF: brief });
          if (stage.id === "design") Object.assign(ctx, { CONVENTIONS: conventions, REQUIREMENTS: requirementsMd });
          if (stage.id === "plan-packets") Object.assign(ctx, {
            CONVENTIONS: conventions, REQUIREMENTS: requirementsMd, DESIGN: designMd,
          });
          if (stage.id === executeId) Object.assign(ctx, {
            CONVENTIONS: conventions, DESIGN: designMd,
            PACKETS: JSON.stringify(packets, null, 2), REPAIR_CONTEXT: "",
          });
          if (stage.id === "review") Object.assign(ctx, {
            CONVENTIONS: conventions, DESIGN: designMd, CHANGED_FILES: changedFilesList,
          });
          if (stage.id === "judge") Object.assign(ctx, {
            BRIEF: brief, REQUIREMENTS: requirementsMd, CHANGED_FILES: changedFilesList,
          });
          return renderPrompt(`sdlc-${stage.id}`, ctx);
        },
        gate: () =>
          stage.id === "requirements" ? gateRequirements()
          : stage.id === "design" ? gateDesign()
          : stage.id === "plan-packets" ? gatePlanPackets()
          : stage.id === executeId ? gateExecute()
          : stage.id === "review" ? gateReview()
          : gateJudge(),
        // Retry semantics: pre-verify stages restart from the pristine
        // scaffold; post-verify (review/judge) restart from the verified
        // tree. Stale contract files must not satisfy this attempt's gate.
        beforeRetry: () => {
          resetWorkdirTo(verifiedTreeTagged ? "verified-tree" : "scaffold-base");
          const contractFile = { "plan-packets": "packets.json", review: "review.md", judge: "judge.json" }[stage.id]
            ?? (stage.id === executeId ? "execute.json" : `${stage.id}.md`);
          rmSync(join(outDir, contractFile), { force: true });
        },
        delegationWhat:
          stage.id === "requirements" ? "authoring the requirements analysis"
          : stage.id === "design" ? "authoring the design"
          : stage.id === "plan-packets" ? "planning the task packets"
          : stage.id === executeId ? "implementing the packets (all code and tests)"
          : stage.id === "review" ? "the senior review analysis"
          : "the scoring analysis",
        // The delegated Skill's examples now speak this template's stage names
        // and contract files instead of SWE-bench Pro's repro/localize/patch —
        // a driver was previously told it was in a "patch phase" of a task that
        // has no patch phase (Sriram, 2026-07-25).
        delegationVocab: DELEGATION_VOCAB.sdlc,
      });

      stageRecords.push({
        stage: stage.id, executor: stage.executor,
        model_id: cfg.modelId, binding: cfg.binding, thinking: cfg.thinking, passed, attempts,
      });
      // Stage roll-up line: the attempt loop printed per-attempt verdicts;
      // this one line is the stage's own row of the final ledger, early.
      {
        const st = attemptTotals(attempts);
        say(paint.dim(`  stage totals: ${st.attempts} attempt(s) · wall ${fmtDur(st.wall)}` +
          (st.usd != null ? ` · driver ${fmtUsd(st.usd)}` : "") +
          (isDelegatedBinding(cfg.binding)
            ? ` · ${st.delegations} delegation(s) · ${tokenSplit(st.tokens)} worker tokens` : "")));
      }
      if (!passed) failedAt = stage.id;
    }

    // ---- finish (the report executor): diff → audit → manifest → grade -----
    say("\n[finish] computing the delivery diff, trajectory audit and manifest…");
    // No stripping (stripFn default): tests are part of the deliverable.
    const finalDiff = computeDiff(git, "scaffold-base");
    writeFileSync(join(runDir, "raw.diff"), finalDiff.raw);
    writeFileSync(join(runDir, "model.diff"), finalDiff.kept.map((k) => k.section).join(""));

    // delegatedRun was computed once, up at the run header — reused here for
    // the audit's delegation checks and the manifest's cost totals.
    // expectByPhase: the binding each stage was RESOLVED to, keyed by stage id,
    // handed to the audit so every delegation can be checked against the policy
    // that ordered it (2026-07-26 — see audit.mjs delegationMismatches). Built
    // from `stages`, the same array the manifest is written from, so the audit
    // and the manifest can never disagree about what was supposed to run.
    const audit = auditRun(outDir, runtimeName, {
      delegated: delegatedRun, workdir, outDir,
      skipChecks: SKIP_AUDIT_FAMILIES,
      expectByPhase: Object.fromEntries(
        stageRecords.filter((s) => s.binding?.worker).map((s) => [s.stage, s.binding])),
    });
    writeFileSync(join(runDir, "audit.json"), JSON.stringify(audit, null, 2));

    const judgeContract = existsSync(join(outDir, "judge.json"))
      ? JSON.parse(readFileSync(join(outDir, "judge.json"), "utf8")) : null;

    const manifest = {
      study: "harness-matrix",
      kind: "sdlc",
      task_id: task.task_id,
      template: {
        id: template.template_id, version: template.version,
        file: templatePath, sha256: sha256(readFileSync(templatePath)),
      },
      scaffold: { id: scaffold.scaffold_id, version: scaffold.version },
      brief_sha256: sha256(brief),
      runtime: { name: runtimeName, version: runtimeVersion },
      policy: {
        name: policy.raw.name,
        file: policyPath,
        sha256: sha256(readFileSync(policyPath)),
        retry: policy.raw.retry,
        limits: policy.limits,
      },
      env_image: SDLC_IMAGE,
      prompt_fields: ["brief", "conventions", "chained stage contracts"],
      stages: stageRecords,
      failed_at: failedAt,
      delivery: { files_changed: finalDiff.kept.map((k) => k.path) },
      judge_scores: judgeContract?.scores ?? null,
      totals: costTotals(stageRecords, startedAt, delegatedRun),
      // `audit_flags` + `integrity_warnings` + `audit_coverage`, each as
      // { total, critical, by_family }. Was a bare integer, which lost the one
      // fact a reviewer needs — whether any of them is critical — the moment
      // the exporter summed it across a batch. Built by the shared helper so
      // the two kinds cannot drift into reporting the same audit differently.
      ...manifestAuditBlock(audit),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // ---- terminal scoreboard: the run's closing frame ----------------------
    // One verdict box + a per-stage ledger + the honest cost/evidence block +
    // the boundary block, all rendered by logrender.sdlcFooter FROM the manifest
    // records just written (parse-never rule): a reviewer pausing the demo on
    // this frame sees the whole run at once. Same descriptor shape replay-log.mjs
    // reconstructs from manifest.json, so the rehearsed frame and the live frame
    // are the same code path, not two copies of the same wording.
    say(sdlcFooter({
      taskId: task.task_id,
      cell: `${runtimeName} × ${policy.raw.name}`,
      failedAt,
      records: stageRecords,
      totals: manifest.totals,
      audit: { editCount: audit.editCount, flags: audit.flags },
      delegated: delegatedRun,
      deliveryCount: finalDiff.kept.length,
      judgeScores: judgeContract?.scores ?? null,
      runDir,
      verifyMethod: stageRecords.find((r) => r.executor === "verify")?.method ?? null,
    }));

    if (skipGrade) {
      say("(--skip-grade: grade later with grade-sdlc.mjs --run-dir …)");
    } else {
      try {
        gradeSdlcRun({ runDir });
      } catch (err) {
        writeFileSync(join(runDir, "grade-error.txt"), String(err.stack ?? err));
        sayErr(`grading failed (run artifacts preserved): ${err.message ?? err}`);
        dropNodeModulesVolume();
        process.exit(1);
      }
    }
    // No image cleanup path: the one shared toolchain image serves every
    // SDLC run and costs ~500 MB total — nothing per-run to reclaim. The
    // node_modules volume IS per-run and IS large, so it goes here — after
    // grading, which re-runs build + test in the container and needs it.
    dropNodeModulesVolume();
    process.exit(0);
  },
};
