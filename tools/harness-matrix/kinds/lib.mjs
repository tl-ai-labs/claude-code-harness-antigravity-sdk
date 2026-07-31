/**
 * kinds/lib.mjs — machinery shared by every task KIND (kinds/swepro.mjs,
 * kinds/sdlc.mjs). A "kind" is the benchmark side of the matrix — WHAT the
 * work is — exactly as runtimes.mjs is the agent side — WHO does the work.
 * The engine (run-harness.mjs) resolves one of each and owns neither.
 *
 * What lives here is everything whose behavior must be IDENTICAL across
 * kinds for cross-cell numbers to mean anything: policy loading and
 * validation, prompt rendering, the containerized command path
 * (run-in-env.sh + execInEnv), workdir change classification, diff
 * computation, and — most important — the stage attempt loop (retry notes,
 * model-pin verification, delegated-cell enforcement, attempt records,
 * narration). A kind supplies only what genuinely differs: its stage list,
 * its provisioning, its gates, its grading.
 *
 * Provenance note (2026-07-25 split): every function here is MOVED from the
 * pre-split run-harness.mjs, not rewritten — parameterized only where a kind
 * must inject a difference (stage list, image, nulled hosts, diff anchor).
 * The SWE-bench Pro path's behavior is preserved exactly; the --dry-run
 * outputs before and after the split are diff-identical.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The shared terminal voice (2026-07-25 demo-grade logging): the attempt
// loop's banners, verdicts and per-attempt worker ledger all draw from it so
// they match the kinds' own banners. Presentation-only (logfmt.mjs contract).
import {
  paint, fmtInt, fmtUsd, fmtDur, tokenSplit, attemptTotals, say, sayErr,
} from "../logfmt.mjs";

const LIB_HERE = dirname(fileURLToPath(import.meta.url));
/** tools/harness-matrix — where prompts/, policies/, Dockerfile*, runs/ live. */
export const HARNESS_DIR = resolve(LIB_HERE, "..");
/** Repo root. */
export const ROOT = resolve(LIB_HERE, "../../..");

// The repo manages deps per-package under pnpm, so a tools/ script has no
// root node_modules to resolve from. `yaml` is resolved through
// packages/policy (which declares it) — same parser the policy loader and
// dashboard already use, zero new dependencies.
const requireFromPolicyPkg = createRequire(join(ROOT, "packages/policy/package.json"));
export const { parse: parseYaml } = requireFromPolicyPkg("yaml");

/**
 * The shared policy engine — the SAME module the orchestrator's loader runs on.
 *
 * WHY IT IS IMPORTED FROM packages/policy AND NOT COPIED HERE (2026-07-29).
 * Before unification this file had its own policy schema and its own validator,
 * and the SDLC orchestrator it was built alongside (a separate repository) had
 * another. Only the orchestrator's knew what an adapter or an API was, so the
 * surface where the Antigravity SDK actually runs was the one that could not
 * record which adapter or API a run used — a delegated binding said
 * `worker: gemini-3.5-flash` and nothing said that reached Vertex through the
 * SDK. The instruction that closed it was to integrate the SDLC policy layer
 * and the Antigravity SDK into one policy and rollout code applicable to every
 * policy. One engine is what that means.
 *
 * Reaching into packages/policy is not a NEW coupling: the `yaml` parser two
 * lines above already resolves through that package's manifest, for the same
 * reason (it is where the dependency is declared). The core is deliberately
 * plain .mjs with no build step, so the harness stays publishable as a
 * standalone source tree — importing built `dist` output would drag the
 * orchestrator's TypeScript build into the bundle handed to Google.
 */
const POLICY_CORE = join(ROOT, "packages/policy/core/policy-core.mjs");
const {
  isComposition,
  isLegacyHarnessShape,
  resolveHarnessStages,
  validatePolicy: validateUnifiedPolicy,
} = await import(pathToFileURL(POLICY_CORE).href);

export { isComposition, isLegacyHarnessShape };

// Ephemeral build/test artifacts that running a suite may drop into the
// repo (pytest caches, __pycache__, …). They are cleaned between phases
// and never fail a gate — but every cleanup is RECORDED in the attempt,
// never silent.
export const ARTIFACT_PATH = [
  /(^|\/)__pycache__\//, /\.pyc$/, /(^|\/)\.pytest_cache\//,
  /(^|\/)\.mypy_cache\//, /(^|\/)\.ruff_cache\//, /(^|\/)\.tox\//,
  /(^|\/)\.cache\//, /(^|\/)node_modules\//, /(^|\/)\.nyc_output\//,
  // Package-manager stores. `.pnpm-store` is the one that actually bit us
  // (2026-07-26, uptime-ping): pnpm relocated its store into the graded tree
  // and the requirements gate saw 5,238 "agent violations". writeRunInEnv now
  // keeps the store outside /app so this should never fire — it stays as
  // defence in depth, because a store appearing in the tree is unambiguously
  // toolchain ephemera and must never be readable as an agent's edit.
  /(^|\/)\.pnpm-store\//, /(^|\/)\.npm\//, /(^|\/)\.yarn\/cache\//,
];

/**
 * A claude-code binding may be DELEGATED — `{ driver, worker }` instead
 * of a model string (the cc×gemini cell, Google email ask 3b: "Claude
 * Code as Harness and when it calls Gemini it should call Gemini +
 * Antigravity together either using Skills or CLI"). The driver is the
 * Anthropic model in Claude Code's seat (not removable), the worker is
 * the Gemini SDK model it must delegate substantive work to via the
 * provisioned gemini-worker Skill (see runtimes.mjs). Everywhere a binding
 * is printed, this label spells the composition out — the cell must never
 * read as a single-model result.
 */
export const isDelegatedBinding = (b) => typeof b === "object" && b !== null;
export const bindingLabel = (b) =>
  isDelegatedBinding(b) ? `${b.driver} → ${b.worker} (delegated via Antigravity SDK)` : b;

/**
 * Pick the ONE binding a kind should hand `runtime.preflight()` and render its
 * orientation paragraph from: the first DELEGATED stage if the policy has one,
 * otherwise the first stage.
 *
 * WHY THIS EXISTS (2026-07-31). Both kinds used to pass `resolved[stages[0]]`,
 * on the unexamined assumption that a policy is delegated everywhere or nowhere
 * — true of the four uniform policies, and false of `opus48-plus-lite`, the
 * tiered cell that is the whole tokenomics story. Its SDLC stage walk resolves
 * requirements/design/plan-packets SOLO and only `execute` DELEGATED, so
 * `stages[0]` is a plain model string and:
 *
 *   - preflight took the non-delegated path and SKIPPED all three worker
 *     checks (venv exists, `import google.antigravity`, Vertex ADC present).
 *     A machine with no ADC therefore sailed past a preflight whose own
 *     comment promises "all $0, before any build or spend", paid for three
 *     Opus stages, and only then died at `execute` — and because a dead
 *     `execute` trips the zero-delegation gate, `max_attempts: 3` bought that
 *     same failure two more times. A $0 misconfiguration cost several dollars.
 *   - the header's orientation paragraph read the driver off that string as
 *     `undefined`, so the run announced "Claude Code (undefined)" over a table
 *     that named the driver correctly on every row beneath it.
 *
 * Both are the same mistake — treating stage 0 as a proxy for the run — so both
 * are fixed here rather than twice, and Pro shares the helper even though its
 * own three phases happen to delegate together today: the policy grammar has
 * allowed a per-phase mix since v2, and the next tiered Pro policy should not
 * have to rediscover this. On a uniform policy the answer is stage 0's binding,
 * exactly as before.
 */
export const preflightBinding = (resolved, stages) => {
  const delegated = stages.find((s) => isDelegatedBinding(resolved[s]?.binding));
  return resolved[delegated ?? stages[0]]?.binding;
};

// ---- policy load + validation ----------------------------------------------
// Every check fails BEFORE any docker build or model spend, with a message
// naming exactly what is wrong — a policy typo must never surface mid-run as a
// mystery CLI error. The checks themselves now live in the shared core, so the
// harness and the orchestrator reject the same file for the same reason.
//
// `agentStages` is the KIND's list of model-driven stages (Pro:
// repro/localize/patch; SDLC: the template's llm-task + judge stage ids). The
// policy's `rules[]` map each to a model id; a stage no rule matches falls to
// the policy's `default` rule — that is how a three-slot Pro policy serves the
// eight-stage SDLC kind without duplicating the model list per stage.
//
// TWO FILE SHAPES ARRIVE HERE, and both must keep working:
//
//   UNIFIED (version 2)  — what tools/harness-matrix/policies/*.yaml now are.
//                          Says which model AND how it is reached (adapter,
//                          API, region), so the frozen snapshot records the
//                          cable as well as the model.
//   LEGACY  (version 1)  — `phases{}` + `models[].bindings{}`. Every finished
//                          run froze one of these as policy_snapshot.yaml, and
//                          those files ship inside evidence bundles ALREADY
//                          handed to Google. Replaying one must produce the
//                          bindings it produced on the day it ran, so the core
//                          keeps a verbatim copy of the old resolver for them.
//
// The shape is detected by the presence of a top-level `phases` key. Nothing
// about a legacy file is rewritten in memory — translating one would mean
// inventing the adapter and API it never declared, and an invented value in a
// resolved binding is indistinguishable downstream from a recorded fact.
export function loadPolicy(path, forRuntime, agentStages) {
  const raw = parseYaml(readFileSync(path, "utf8"));
  const fail = (m) => { throw new Error(`policy ${path}: ${m}`); };

  // A unified policy is validated in full (adapter×api legality, doorway
  // requirements, composition members) before any stage is resolved. A legacy
  // one skips this: its own structural checks live inside the compatibility
  // resolver, exactly where they were before, and running the unified
  // validator over it would reject every frozen snapshot in the archive.
  if (!isLegacyHarnessShape(raw)) {
    try {
      validateUnifiedPolicy(raw);
    } catch (e) {
      // Re-thrown through fail() so the message keeps the file path, which is
      // most of a policy error's diagnostic value when four files look alike.
      fail(e.message.replace(/^Policy(?: model| rule \d+| select '[^']*')?: ?/, ""));
    }
  }

  return resolveHarnessStages(raw, { runtime: forRuntime, stages: agentStages, fail });
}

// ---- prompt templates -------------------------------------------------------
/**
 * Load the named prompt templates from tools/harness-matrix/prompts/ and
 * return a renderer. Prompts are byte-identical across runtimes; unfilled
 * placeholders are a hard error, never a silently-empty prompt.
 */
export function makePromptRenderer(names) {
  const templates = Object.fromEntries(
    names.map((n) => [n, readFileSync(join(HARNESS_DIR, "prompts", `${n}.md`), "utf8")])
  );
  return function renderPrompt(name, ctx) {
    let text = templates[name];
    for (const [key, value] of Object.entries(ctx)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
    const leftover = text.match(/{{[A-Z_]+}}/);
    if (leftover) throw new Error(`prompt ${name}: unfilled placeholder ${leftover[0]}`);
    return text;
  };
}

// ---- run-in-env.sh ----------------------------------------------------------
/**
 * ONE helper used by both the agent (told so in every prompt) and the
 * kind's gates — intra-phase test-running and gate-judging are the same
 * execution path by construction. The command travels via env var (CMD) to
 * dodge nested-quoting bugs; `timeout` inside the container is the command
 * brake, the docker caps (3g/3cpu on the 5 GB VM) are the resource brake.
 *
 * Kind-injected differences, each with a reason:
 *  - nulledHosts: Pro nulls source-code hosts (the gold-fix leak channel);
 *    SDLC nulls nothing (greenfield brief — no fix exists anywhere to leak,
 *    and pnpm legitimately reaches the npm registry and github tarballs).
 *  - platform: Scale's instance images are linux/amd64-only (Rosetta on
 *    this Mac); the SDLC env image is built natively — no platform pin.
 *  - shell: Scale images use a shell ENTRYPOINT, so the image takes `-c`
 *    directly; the node base image's entrypoint is not a shell, so SDLC
 *    interposes an explicit `bash`.
 */
export function writeRunInEnv({
  outDir, workdir, image, cmdTimeoutS, nulledHosts = [], platform = null, shell = null,
  pkgStoreDir = null, nodeModulesVolume = null,
}) {
  const runInEnv = join(outDir, "run-in-env.sh");
  // `pkgStoreDir` moves the package manager's content-addressable store OUT of
  // the mounted repository. It is not a nicety — without it the SDLC kind is
  // unrunnable, and it fails in the most misleading way available.
  //
  // pnpm wants its store on the same filesystem as node_modules so it can
  // hardlink; when it is not, pnpm relocates the store into the PROJECT. Here
  // /app is a bind mount and the container's $HOME is the image's overlay
  // layer — two filesystems — so the store landed at /app/.pnpm-store. On the
  // 2026-07-26 uptime-ping run that put 5,238 store files inside the graded
  // tree, which then (a) made `git diff scaffold-base` 61 MB and killed the
  // harness on an unhandled ENOBUFS, and (b) would, once the buffer was
  // raised, have failed the requirements stage's "repository untouched" gate
  // with 5,238 violations — recording a toolchain artifact as the agent
  // editing thousands of files it was forbidden to touch. That is the exact
  // infra-read-as-model-failure DESIGN §11 forbids.
  //
  // The store is mounted at a fixed in-container path and shared across runs,
  // so it also removes a per-run package download — one less network fetch
  // whose stall would otherwise be timed as agent latency.
  if (pkgStoreDir) mkdirSync(pkgStoreDir, { recursive: true });
  writeFileSync(runInEnv, [
    "#!/bin/sh",
    "# run-in-env.sh — execute one command inside this instance's sealed",
    "# execution container, with the working repository mounted at /app.",
    "# Generated by the harness; used by BOTH the scaffold's gates and",
    "# the agent, so agent test runs and gate judgments are identical.",
    `[ $# -ge 1 ] || { echo 'usage: run-in-env.sh "<command>"' >&2; exit 2; }`,
    "exec docker run --rm" + (platform ? ` --platform ${platform}` : "") + " \\",
    "  --memory 3g --cpus 3 \\",
    ...nulledHosts.map((h) => `  --add-host ${h}:0.0.0.0 \\`),
    `  -e CMD="$*" \\`,
    // Both spellings on purpose: pnpm reads npm_config_store_dir, and
    // PNPM_HOME keeps any corepack/pnpm metadata out of the tree too.
    ...(pkgStoreDir ? [
      `  -v "${pkgStoreDir}:/pkg-store" \\`,
      `  -e npm_config_store_dir=/pkg-store/pnpm \\`,
      `  -e PNPM_HOME=/pkg-store/pnpm-home \\`,
      `  -e npm_config_cache=/pkg-store/npm \\`,
    ] : []),
    `  -v "${workdir}:/app" \\`,
    // `nodeModulesVolume` keeps node_modules OFF the macOS-backed bind mount,
    // on the Linux VM's own filesystem, by shadowing /app/node_modules with a
    // Docker volume.
    //
    // WHY (2026-07-26, the kudos-wall tiered run). pkgStoreDir above already
    // moved the pnpm STORE out of the tree, but node_modules itself still lived
    // on the bind mount — and the store is now on a DIFFERENT filesystem from
    // it, so pnpm cannot hardlink and must copy every package across the
    // VirtioFS boundary instead. On a name collision that path does not
    // overwrite: it creates a macOS-style ` 2` duplicate directory. When the
    // agent ran `pnpm install --no-frozen-lockfile` mid-execute, .pnpm filled
    // with `rollup@4.62.2 2`-shaped directories, the real package tree was
    // shadowed, and the platform-specific optional dependency vanished:
    //
    //   Error: Cannot find module @rollup/rollup-linux-arm64-gnu
    //
    // which is a famously misleading error — it reads as the well-known npm
    // optional-dependency bug (npm/cli#4828, which the message itself cites),
    // so the driver chased THAT: hand-installing the binding, `pnpm install
    // --force`, `rm -rf /app/node_modules`, and finally hunting `* 2`
    // directories by find. Roughly four minutes of paid driver time spent on
    // an artifact of where node_modules was mounted, billed and logged as if
    // it were the model failing to build the project. DESIGN §11 forbids
    // exactly that misattribution.
    //
    // Consequences, deliberately accepted: node_modules is no longer visible
    // from the host (it is gitignored, excluded from the graded diff and from
    // the chassis sha256 manifest, so nothing on the host reads it), and the
    // volume must be removed at the end of the run or it leaks disk on a Mac
    // that has little to spare — kinds/sdlc.mjs owns that teardown.
    ...(nodeModulesVolume ? [`  -v "${nodeModulesVolume}:/app/node_modules" \\`] : []),
    "  -w /app \\",
    `  ${image} \\`,
    ...(shell ? [`  ${shell} \\`] : []),
    `  -c 'timeout -k 15 ${cmdTimeoutS} bash -c "$CMD"'`,
    "",
  ].join("\n"));
  chmodSync(runInEnv, 0o755);
  return runInEnv;
}

/** Build a "run a repo command through run-in-env.sh, log output, report exit" fn. */
export function makeExecInEnv({ runInEnv, cmdTimeoutMin }) {
  return function execInEnv(cmd, logPath) {
    const r = spawnSync(runInEnv, [cmd], {
      encoding: "utf8",
      // Host backstop over the in-container `timeout`: covers a wedged
      // docker/Rosetta, not a slow test suite.
      timeout: (cmdTimeoutMin * 60 + 120) * 1000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(logPath, (r.stdout ?? "") + (r.stderr ?? ""));
    const timedOut = r.error?.code === "ETIMEDOUT" || r.status === 124;
    return { exitCode: r.status ?? (timedOut ? 124 : 1), timedOut };
  };
}

// ---- workdir git helpers ----------------------------------------------------
/** git helper bound to a workdir (host git; diff/reset/status need no container).
 *
 * maxBuffer is set to 64 MB — matching makeExecInEnv — because Node's
 * execFileSync default is 1 MB and a diff is DATA whose size the harness does
 * not control. The 2026-07-26 uptime-ping run produced a 61 MB diff and died
 * on an unhandled `spawnSync git ENOBUFS` mid-stage, losing the whole run and
 * the $0.54 already spent on it. The store leak that made the diff enormous is
 * fixed at its source in writeRunInEnv, but the principle stands on its own: a
 * pathological diff must fail a GATE, with the paths named in the reason, not
 * kill the process. A crash here is unrecoverable and unattributable; a failed
 * gate is a result.
 */
export function makeGit(workdir) {
  return (...a) => execFileSync("git", ["-C", workdir, ...a], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Parse `git status --porcelain -z` into typed entries (rename-safe). */
export function statusEntries(git) {
  const out = git("status", "--porcelain", "-z");
  const fields = out.split("\0").filter((f) => f.length > 0);
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i].slice(0, 2);
    const path = fields[i].slice(3);
    entries.push({ code, path });
    if (code[0] === "R" || code[0] === "C") i++; // skip the rename/copy source field
  }
  return entries;
}

/**
 * Classify current workdir changes against what a phase is ALLOWED to do.
 * `allowed` may be a Set/array of exact repo-relative paths OR a predicate
 * (path) => bool (SDLC's execute gate allows path FAMILIES — the scaffold's
 * declared slots — not a pre-known file list, so a predicate is the honest
 * shape). Returns { violations, artifacts } — artifacts are cleanable
 * ephemera, violations fail the gate with the exact paths in the reason.
 */
export function classifyChanges(git, allowed) {
  const isAllowed = typeof allowed === "function"
    ? allowed
    : (() => { const s = new Set([...allowed].map((p) => normalize(p))); return (p) => s.has(p); })();
  const violations = [], artifacts = [];
  for (const e of statusEntries(git)) {
    const p = normalize(e.path);
    if (ARTIFACT_PATH.some((re) => re.test(p))) artifacts.push(p);
    else if (!isAllowed(p)) violations.push(`${e.code.trim() || "??"} ${p}`);
  }
  return { violations, artifacts };
}

/** Remove artifact paths (recorded by the caller — never silent). */
export function cleanArtifacts(workdir, paths) {
  for (const p of paths) rmSync(join(workdir, p), { recursive: true, force: true });
}

/** Validate a contract-file path: relative, inside the repo, no escapes. */
export function saneRepoPath(p) {
  return typeof p === "string" && p.length > 0 && !isAbsolute(p) &&
    !normalize(p).startsWith("..");
}

// ---- diff -------------------------------------------------------------------
/**
 * Compute the graded diff against the kind's anchor tag: `git add -N .`
 * (files the agent CREATED become visible — without it new files silently
 * vanish from the patch), then `git diff <anchor>`, then split per-file and
 * apply the kind's strip predicate (Pro strips test/repro hunks; SDLC
 * strips nothing — tests are the deliverable there). Stripping is returned
 * to the caller for loud logging + the manifest — silent truncation would
 * read as "agent edited no tests".
 */
export function computeDiff(git, anchor, stripFn = () => false) {
  git("add", "-N", ".");
  const raw = git("diff", anchor);
  const kept = [], stripped = [];
  for (const section of raw.split(/^(?=diff --git )/m).filter(Boolean)) {
    const m = section.match(/^diff --git a\/.+? b\/(.+)$/m);
    const path = m ? m[1] : "<unparsed>";
    (stripFn(path) ? stripped : kept).push({ path, section });
  }
  return { raw, kept, stripped };
}

// ---- the stage attempt loop -------------------------------------------------
/**
 * Run ONE stage of a kind's recipe through the runtime with the policy's
 * flat retry, returning { passed, attempts, lastReason }. This loop is the
 * heart of the harness and is deliberately kind-agnostic: retry notes fed
 * verbatim to the model, model-pin verification, the delegated-cell
 * zero-delegation enforcement, per-attempt records and narration are all
 * IDENTICAL for every kind — that identity is what makes cross-kind numbers
 * comparable. The kind injects only:
 *   buildPrompt(attemptNote)  — the rendered prompt for this attempt
 *   gate(logPrefix)           — the stage's pass/fail judgment
 *   beforeRetry(attempt)      — cleanup before attempts 2+ (reset semantics)
 *   delegationWhat            — what the worker must own here, for the
 *                               zero-delegation failure message
 *   maxAttempts (optional)    — override for script-driven single-shot
 *                               calls (SDLC's verify-repair rounds); the
 *                               policy's retry cap is the default
 */
export async function runStageAttempts({
  stage, cfg, policy, runtime, runtimeName, outDir, workdir,
  buildPrompt, gate, beforeRetry, delegationWhat, delegationVocab, maxAttempts = null,
}) {
  const cap = maxAttempts ?? policy.maxAttempts;
  const attempts = [];
  let passed = false;
  let lastReason = null;

  for (let attempt = 1; attempt <= cap && !passed; attempt++) {
    if (attempt > 1) beforeRetry(attempt);

    const attemptNote = attempt === 1 ? "" :
      `\nNOTE: this is attempt ${attempt} of ${cap} for this phase. ` +
      `The previous attempt failed the phase gate because:\n${lastReason}\nAddress that failure specifically.`;

    const prompt = buildPrompt(attemptNote);
    const logPrefix = `${stage}-a${attempt}`;
    say("\n" + paint.bold(`▶ [${stage}] attempt ${attempt}/${cap}`) +
      paint.dim(` · ${bindingLabel(cfg.binding)} · runtime ${runtimeName}`));
    if (attempt > 1) {
      // The retry is fed the previous gate's reason VERBATIM — say so on the
      // terminal too, so a watcher knows this attempt is a corrective one.
      say(paint.yellow(`  retry: previous attempt's gate failure is quoted in this prompt`));
    }
    const res = await runtime.runPhase({
      binding: cfg.binding,
      thinking: cfg.thinking === "product-internal" ? null : cfg.thinking,
      prompt, workdir, outDir, logPrefix,
      timeoutMin: policy.limits.phase_timeout_min,
      budgetUsd: policy.limits.phase_budget_usd,
      // Sibling of delegationWhat: that one words the GATE FAILURE, this one
      // words the delegated Skill's own examples. Both are kind knowledge and
      // both belong to the kind, not to the runtime (2026-07-25).
      delegationVocab,
    });

    // Pin verification: loud, recorded, non-fatal — the manifest is the
    // evidence either way. For a delegated binding the init event reports the
    // DRIVER (the worker's model is recorded separately in its usage sidecar),
    // so the driver string is the pin target. Normalising to lowercase
    // hyphenated tokens keeps the check meaningful across model-id spellings
    // without firing false mismatches.
    const normalizeModelId = (s) =>
      String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const pinTarget = isDelegatedBinding(cfg.binding) ? cfg.binding.driver : cfg.binding;
    if (res.resolvedModel) {
      const got = normalizeModelId(res.resolvedModel);
      const want = normalizeModelId(pinTarget);
      if (got !== want && !got.includes(want) && !want.includes(got)) {
        sayErr(paint.yellow(
          `WARNING: resolved model '${res.resolvedModel}' != pinned binding '${pinTarget}'`));
      } else {
        // The positive case is worth a line too (demo-grade logging): the pin
        // check passing silently used to be indistinguishable from the pin
        // check not running at all.
        say(paint.dim(
          `  model pin verified: session resolved '${res.resolvedModel}' matches policy pin '${pinTarget}'`));
      }
    }

    const g = gate(logPrefix);

    // A timed-out runtime call that still passed its gate is a pass; when
    // the gate failed, the timeout is part of the story fed to the retry.
    if (!g.pass && res.timedOut) {
      g.reason = `the runtime call hit the ${policy.limits.phase_timeout_min}-minute phase timeout; ` +
        `then: ${g.reason}`;
    }

    // Delegated-cell enforcement (the cell's honesty meter, made binding).
    // The whole premise of a delegated cell is "Claude drives, Gemini does the
    // work". So the substantive engineering in EVERY stage must be the worker's,
    // not the driver's — the driver has no file-editing tools; its only job is
    // to conduct (compose the task, run gemini_worker.py, read back the result,
    // write the contract). A stage attempt with ZERO delegations therefore
    // means the driver worked alone — it FAILS the gate (even if the gate
    // otherwise passed), with a reason the retry can act on. `delegationCalls`
    // is null for a non-delegated cell (=== 0 is false), so this only bites
    // the delegated cell; the count lands in the manifest either way.
    if (res.delegationCalls === 0) {
      const priorReason = g.pass ? null : g.reason;
      g.pass = false;
      g.reason = `this is a DELEGATED cell and you are the driver, not the engineer: ${delegationWhat} MUST ` +
        "be done by the Gemini worker via the gemini-worker skill, not by you. This attempt made ZERO " +
        "worker delegations — hand the worker the task (run gemini_worker.py through Bash), read back " +
        "its result, and try again" + (priorReason ? ` (the phase gate also reported: ${priorReason})` : "");
    }

    attempts.push({
      attempt,
      exit_code: res.exitCode,
      timed_out: res.timedOut,
      wall_seconds: res.wallSeconds,
      cost_usd: res.costUsd,
      num_turns: res.numTurns,
      resolved_model: res.resolvedModel,
      // The driver's own token ledger, verbatim from Claude Code's result
      // event (Anthropic field names, not reshaped). Pairs with cost_usd so
      // the driver's spend can be explained rather than just asserted: these
      // are orchestration and verification tokens — reading the worker's
      // replies, diffs and test output — not code authoring, which the driver
      // has no tools to do. null on a runtime that reports no usage.
      driver_usage: res.driverUsage ?? null,
      // null = not a delegated cell; a number = worker invocations found
      // in the trajectory (0 is the flagged driver-worked-alone case).
      delegation_calls: res.delegationCalls ?? null,
      // Worker-side evidence for the delegated cell: the per-delegation usage
      // sidecars gemini_worker.py wrote (real token counts + resolved model —
      // the SDK's payoff over the prose-only CLI). null = not a delegated cell;
      // `available: false` = delegated but no sidecar recovered (e.g. a killed
      // worker). Token counts only — dollar cost is priced downstream.
      worker_usage: res.workerUsage ?? null,
      gate: g,
    });
    // Delegated-cell visibility: the honesty numbers printed per attempt so a
    // watcher never has to open the manifest mid-run — the delegation count
    // from the trajectory plus the worker's sidecar count and real token
    // split (prompt/output/thinking, straight from Vertex UsageMetadata).
    // Dollars are deliberately absent for the worker: token counts are
    // priced downstream against verified Vertex rates (see totals.cost_basis).
    if (res.delegationCalls != null) {
      const wu = res.workerUsage;
      // Rolled up through the shared helper so this per-attempt line and the
      // run's closing ledger cannot drift apart — and so both pick up the
      // cached-input and worker-tool-call fields together (logfmt 2026-07-26).
      const t = attemptTotals([{ worker_usage: wu }]);
      const tokens = t.tokens;
      say(paint.cyan(`  worker ledger: ${res.delegationCalls} delegation(s) · ` +
        `${wu?.calls ?? 0} usage sidecar(s)` +
        (t.toolCalls ? ` · ${t.toolCalls} worker tool call(s)` : "") +
        (tokens.total ? ` · ${tokenSplit(tokens)}` : "")));
      // The priceable figure, said once per attempt. Printing only the input
      // total invites a cost estimate several-fold too high on a cache-heavy
      // run — 86% of input was cache reads on the first delegated SDLC run.
      if (tokens.cached) {
        say(paint.dim(`                 of the input, ${fmtInt(tokens.fresh)} token(s) were fresh — ` +
          "that is the figure to price at the Vertex input rate"));
      }
    }
    // Gate warnings and artifact cleanups have always been RECORDED in the
    // attempt; from the demo-logging pass on they are also PRINTED — a
    // recorded-but-invisible warning (e.g. the no-worse waiver) forced the
    // watcher into the manifest mid-run.
    for (const w of g.warnings ?? []) say(paint.yellow(`  ⚠ ${w}`));
    if (g.artifacts_cleaned?.length) {
      say(paint.dim(`  cleaned ${g.artifacts_cleaned.length} ephemeral build artifact(s): ` +
        g.artifacts_cleaned.slice(0, 5).join(", ") +
        (g.artifacts_cleaned.length > 5 ? ", …" : "")));
    }
    say(g.pass
      ? paint.green(`  ✔ gate PASS · wall ${fmtDur(res.wallSeconds)}` +
          (res.costUsd != null ? ` · driver ${fmtUsd(res.costUsd)}` : "") +
          (res.numTurns != null ? ` · ${fmtInt(res.numTurns)} driver turn(s)` : ""))
      : paint.red(`  ✘ gate FAIL — ${g.reason}`));

    passed = g.pass;
    lastReason = g.reason;
  }

  return { passed, attempts, lastReason };
}

// ---- manifest totals --------------------------------------------------------
/**
 * The totals block, shared so cost_basis language is identical across kinds.
 * Cost honesty (DESIGN §7): claude-code×Max is CLI-modeled, not wallet.
 * A DELEGATED cell has two regimes at once: the recorded cost_usd covers
 * the DRIVER only (CLI-reported); the worker's Gemini spend is captured as
 * real token COUNTS in its usage sidecars, but NOT converted to dollars
 * here — that pricing happens downstream via @harness/pricing
 * getVertexRates(model, "asia-south1"), which applies the +10% non-global
 * Vertex surcharge over the global pin (verified 2026-07-23; pricing-
 * preflight discipline). A partial dollar total would be worse than an
 * honest split.
 */
export function costTotals(stageRecords, startedAt, delegatedRun) {
  const knownCosts = stageRecords.flatMap((p) => (p.attempts ?? []).map((a) => a.cost_usd)).filter((c) => c != null);
  return {
    attempts: stageRecords.reduce((n, p) => n + (p.attempts ?? []).length, 0),
    wall_seconds: Math.round((Date.now() - Date.parse(startedAt)) / 1000),
    cost_usd: knownCosts.length ? Number(knownCosts.reduce((a, b) => a + b, 0).toFixed(4)) : null,
    cost_basis: delegatedRun
      ? "DRIVER ONLY, cli-reported (Max seat: modeled, not wallet-real); worker Gemini spend " +
        "recorded as token counts in worker_usage sidecars, priced downstream via " +
        "getVertexRates(model,'asia-south1') = base +10% (non-global Vertex)"
      : "cli-reported (Max seat: modeled, not wallet-real)",
  };
}

/** Timestamped run directory for a cell × task, shared naming across kinds. */
export function makeRunDir(taskId, runtimeName, policyName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(HARNESS_DIR, "runs", taskId, `${runtimeName}--${policyName}`, stamp);
  const workdir = join(runDir, "workdir");
  const outDir = join(runDir, "out");
  mkdirSync(workdir, { recursive: true });
  mkdirSync(join(outDir, "phases"), { recursive: true });
  return { stamp, runDir, workdir, outDir };
}

/**
 * Docker Hub tag for a SWE-bench Pro instance's frozen base image.
 *
 * This is a PORT, not a design — the tags were minted by Scale's upload script
 * and we do not control them, so the only correct implementation is whatever
 * `helper_code/image_uri.py::get_dockerhub_image_uri` does. Two of its rules
 * were missing here and cost a run (2026-07-26):
 *
 *  1. `-vnan` IS STRIPPED. It is the placeholder these instances carry when
 *     there is no environment-setup commit, and the uploader drops it before
 *     tagging. Our version passed the instance id through verbatim, which is
 *     why the bug hid for so long: it only fires on the instances that end in
 *     `-vnan` (NodeBB, element-web), and every instance we had run until now
 *     — navidrome ×3, ansible, vuls, teleport, openlibrary — ends in a real
 *     `-v<sha>` and so round-tripped unchanged. A 2-of-10 blast radius that
 *     surfaces as `docker.io/...: not found` AFTER the run frame has printed,
 *     i.e. looking like a network fault rather than a naming bug.
 *  2. element-web is renamed to `element` — except for ONE pinned instance id
 *     that kept the full name. That carve-out is upstream's, reproduced here
 *     verbatim; it is not something to "clean up".
 *
 * Kept as a pure function of (instanceId, repo) so it is unit-testable against
 * the real published tags without docker, a network, or a paid run.
 */
export function sweproBaseTag(instanceId, repo) {
  const [repoBase, repoNameRaw] = repo.toLowerCase().split("/");
  let repoName = repoNameRaw;
  let hsh = instanceId.replace(/^instance_/, "");

  if (instanceId === "instance_element-hq__element-web-ec0f940ef0e8e3b61078f145f34dc40d1938e6c5-vnan") {
    repoName = "element-web"; // upstream keeps the full name for this one id
  } else if (repoBase === "element-hq" && repoNameRaw === "element-web") {
    repoName = "element";
    if (hsh.endsWith("-vnan")) hsh = hsh.slice(0, -5);
  } else if (hsh.endsWith("-vnan")) {
    hsh = hsh.slice(0, -5);
  }

  // Docker tags cap at 128 chars and upstream truncates rather than hashing,
  // so we must truncate identically or we would ask for a tag nobody minted.
  return `${repoBase}.${repoName}-${hsh}`.slice(0, 128);
}

// Re-exported so kinds import node:fs bits from one place only where it
// keeps their own import blocks small; not a public API.
export { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync };
