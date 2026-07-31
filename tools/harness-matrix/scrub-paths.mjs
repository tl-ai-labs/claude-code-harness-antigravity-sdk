/**
 * scrub-paths — turn host-specific absolute paths into stable placeholders on
 * the way OUT of the repo, and prove afterwards that none survived.
 *
 * WHY THIS EXISTS (2026-07-29, task #110). The delegated runs recorded under
 * `runs/` are the evidence half of the study: `worker-task-*.md` is the verbatim
 * text the driver sent, `worker-usage-*.json` is Gemini's own token receipt.
 * They are what makes a published claim checkable rather than merely asserted,
 * so they ship with the extracted self-runnable repo (the deliverable owner,
 * 2026-07-28 17:08:
 * "We need to share the specific self-runnable source code ... with Google").
 *
 * Those files were written by processes running on a laptop, so they carry that
 * laptop's absolute paths — 287 occurrences across the tracked evidence, in four
 * distinct shapes. Publishing them is not a security problem; a home directory
 * name is not a credential. It is an IRREVERSIBILITY problem: once the bytes are
 * in a public git history they stay in every clone and every fork, and taking
 * them back later means rewriting the history of a repo other people have
 * already cloned. Ten minutes before the push, an afternoon after it.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DO. It never writes inside `runs/`. Recorded
 * runs are immutable evidence; a sanitiser that edits the record destroys the
 * thing it is preparing to publish. `scrubTree` reads from the run directory and
 * writes to a separate destination, and there is no code path here that opens a
 * source file for writing.
 *
 * RELATIONSHIP TO THE FROZEN CORPUS. The 50 hand-offs under
 * `fixtures/delegation-corpus/handoffs/` were sanitised once, by hand, when the
 * corpus was built — see that directory's README. They already read `/harness`
 * and are frozen; nothing here touches them. This module generalises the same
 * substitution so every FUTURE extraction gets it automatically, and adds the
 * three shapes the corpus never needed (the corpus is hand-offs only, and only
 * the usage receipts mention the SDK's own state directory).
 *
 * HOW TO RUN IT. Importable as a module (that is how the extractor uses it) and
 * runnable as a command — see the CLI block at the bottom of this file for the
 * two modes and their exit codes.
 *
 * @see fixtures/delegation-corpus/README.md — the original one-off substitution
 * @see audit.mjs                            — lintDelegationText, used below
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { lintDelegationText } from "./audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file's own location: <root>/tools/harness-matrix. */
export const REPO_ROOT = resolve(HERE, "..", "..");

/**
 * Placeholders. `/harness` is not a free choice — the 50 frozen corpus files
 * already use it, and a second convention for the same directory would mean the
 * published evidence and the published test fixtures disagree about what the
 * harness directory is called. `/repo` and `/home/user` are new, and `/app` was
 * deliberately NOT reused for either: `/app` is the container's real WORKDIR
 * (Dockerfile:67), and a placeholder that collides with a genuine in-container
 * path would make a reader unable to tell a substitution from a real location.
 */
export const HARNESS_PLACEHOLDER = "/harness";
export const REPO_PLACEHOLDER = "/repo";
export const HOME_PLACEHOLDER = "/home/user";

/** Escape a literal string for use inside a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build the ordered substitution rules.
 *
 * ORDER IS THE WHOLE TRICK, and getting it wrong fails silently rather than
 * loudly. The four shapes present in the evidence are nested prefixes of one
 * another:
 *
 *   /home/user/Desktop/<repo>/tools/harness-matrix   266 hits
 *   /home/user/Desktop/<repo>                          4 hits
 *   /home/user/.gemini/antigravity/brain/<hash>                   14 hits
 *   /home/user                                                     3 hits
 *
 * Apply the shortest first and it eats the others: `/home/user` matches inside
 * the harness path too, yielding `/home/user/Desktop/<repo>/...`,
 * which still publishes the directory layout this module exists to remove — and
 * publishes it in a form that passes a naive `/Users/` check. So: longest
 * literal first, generic regex last.
 *
 * The `.gemini` shape needs no rule of its own. It is `<home>` plus a suffix,
 * so the home rule rewrites it to `/home/user/.gemini/antigravity/brain/<hash>`
 * and the hash — an Antigravity session id, not a secret — is preserved, which
 * is correct: it is part of the receipt.
 *
 * @param {{repoRoot?: string, home?: string}} [opts]
 * @returns {Array<{re: RegExp, to: string, why: string}>}
 */
export function buildScrubRules(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const home = opts.home ?? homedir();
  const harnessDir = join(repoRoot, "tools", "harness-matrix");

  return [
    { re: new RegExp(escapeRe(harnessDir), "g"), to: HARNESS_PLACEHOLDER,
      why: "the harness directory — matches the frozen corpus convention" },
    { re: new RegExp(escapeRe(repoRoot), "g"), to: REPO_PLACEHOLDER,
      why: "the repo root, for the handful of paths that stop above tools/" },
    { re: new RegExp(escapeRe(home), "g"), to: HOME_PLACEHOLDER,
      why: "this machine's home directory, incl. the SDK's ~/.gemini state dir" },
    // Safety net, deliberately last and deliberately generic: any OTHER macOS
    // home directory. A run recorded on a colleague's machine, or a path
    // belonging to a different user on this one, would slip past the three
    // literal rules above. The character class stops at the delimiters that
    // actually terminate a path inside JSON, Markdown prose and shell lines, so
    // the suffix after the username survives and only the /home/user head is
    // replaced.
    { re: /\/Users\/[^/\s"'`:,;)\]}]+/g, to: HOME_PLACEHOLDER,
      why: "any other macOS home directory" },
  ];
}

/**
 * Apply the rules to a string. Pure — no I/O, no state, safe to call on any
 * text including one that contains no host paths at all.
 *
 * @param {string} text
 * @param {Array<{re: RegExp, to: string}>} [rules]
 * @returns {string}
 */
export function scrubText(text, rules = buildScrubRules()) {
  let out = String(text);
  for (const { re, to } of rules) {
    // Fresh lastIndex each time: the rule objects are reusable across files and
    // a /g RegExp carries state between .replace() calls in some engines' edge
    // cases. Cheap insurance against a bug that would only show on file N.
    re.lastIndex = 0;
    out = out.replace(re, to);
  }
  return out;
}

/**
 * Find host-path leftovers in a string. This is the DETECTOR, kept separate
 * from the substituter on purpose: the assertion must be able to fail even if
 * the substitution logic is wrong, so it does not reuse the same rules.
 *
 * Two independent signals:
 *  - a literal `/Users/` FOLLOWED BY A SEGMENT, and
 *  - the repo's own directory name in a filesystem-path position, which catches
 *    a path that was partially rewritten (e.g. `/home/user/Desktop/<repo>`) and
 *    would otherwise pass a `/Users/`-only check.
 *
 * Both signals are deliberately narrowed to *filesystem* shapes, because the
 * assertion now runs over source and prose as well as evidence, and the same
 * substrings occur there for reasons that are not leaks:
 *
 *  - `/Users/` with nothing after it is prose *about* the check (`no committed
 *    file has regained a "/Users/" path`), or the check itself in test code.
 *    A real leak always has a username after the slash — hence `+`, not `*`.
 *  - The repo's directory name is also its GitHub repo name and its GCP project
 *    id, both of which are published on purpose:
 *    `https://github.com/tl-ai-labs/<repo>/blob/...` and
 *    `aiplatform.googleapis.com/v1beta1/projects/<repo>`. Three narrowings
 *    separate a URL from a path, and none of them weakens the real check:
 *      · at least one ancestor segment is required, so a bare `/<repo>` — which
 *        as a filesystem path would mean a repo checked out at the volume root,
 *        a shape that has never occurred — does not fire. This is what lets
 *        `delegation-corpus.test.mjs` contain the regex that asserts the
 *        absence of the very shape it is testing for.
 *      · no ancestor segment may contain a dot: `github.com` and
 *        `googleapis.com` are hostnames, and no directory in any of the four
 *        real host-path shapes has a dot in it.
 *      · the match may not be preceded by a word character, which is what a URL
 *        path always is (`...googleapis.com` + `/v1beta1/projects/<repo>`) and
 *        an absolute filesystem path never is — it follows whitespace, a quote,
 *        a backtick or the start of a line.
 *
 * @param {string} text
 * @param {{repoDirName?: string}} [opts]
 * @returns {string[]} the offending substrings, de-duplicated, in first-seen order
 */
export function hostPathHits(text, opts = {}) {
  const repoDirName = opts.repoDirName ?? REPO_ROOT.split("/").filter(Boolean).pop();
  const hits = [];
  const seen = new Set();
  const add = (s) => { if (!seen.has(s)) { seen.add(s); hits.push(s); } };

  for (const m of String(text).matchAll(/\/Users\/[^\s"'`:,;)\]}]+/g)) add(m[0]);
  if (repoDirName) {
    const re = new RegExp(
      `(^|[^A-Za-z0-9._-])(/(?:[A-Za-z0-9_-]+/)+${escapeRe(repoDirName)})\\b`, "gm");
    for (const m of String(text).matchAll(re)) {
      // `/repo` and `/harness` are the placeholders; a match that IS the
      // placeholder is not a leftover. Only flag ones still carrying a prefix.
      if (m[2] !== REPO_PLACEHOLDER && m[2] !== HARNESS_PLACEHOLDER) add(m[2]);
    }
  }
  return hits;
}

/**
 * Directories the walk never descends into.
 *
 * `.git` — the extraction writes into a live clone of the published repo (the
 * sync loop is regenerate-in-place, then commit), so `.git` is present and is
 * NOT content this tool produced. Its objects are zlib-compressed, so a utf8
 * read of them cannot find a path anyway; scanning them would only add tens of
 * thousands of files to every assertion for a guaranteed-empty result. Anything
 * already committed is history, which a sanitiser cannot retract.
 * `node_modules` — third-party source, installed after extraction, and its
 * vendored fixtures routinely contain other people's absolute paths.
 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Recursively list every file under a directory, as absolute paths. */
function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out.sort();
}

/**
 * Walk a directory and throw if ANY file still contains a host path.
 *
 * WHY AN ASSERTION AND NOT A REVIEW. A human reading the diff catches this once,
 * on the day they were told to look. Every subsequent delegated run writes ~12
 * more evidence files carrying the same paths, and the next extraction happens
 * after this conversation is forgotten. The assertion is the part that still
 * works then.
 *
 * @param {string} root  directory to check (the EXTRACTED copy, never runs/)
 * @param {{repoDirName?: string}} [opts]
 * @throws {Error} naming every offending file and the first hit in each
 */
export function assertNoHostPaths(root, opts = {}) {
  const offenders = [];
  for (const file of walkFiles(root)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable or binary: nothing to leak in a form this catches
    }
    const hits = hostPathHits(text, opts);
    if (hits.length) offenders.push({ file: relative(root, file), hits });
  }
  if (offenders.length) {
    const detail = offenders
      .map((o) => `  ${o.file}: ${o.hits.slice(0, 3).join(", ")}` +
        (o.hits.length > 3 ? ` (+${o.hits.length - 3} more)` : ""))
      .join("\n");
    throw new Error(
      `host paths survived the scrub in ${offenders.length} file(s):\n${detail}\n` +
      `Publishing these would put a machine-specific directory layout into a ` +
      `public git history permanently. Fix buildScrubRules() — do NOT edit the ` +
      `files under runs/, which are immutable evidence.`);
  }
}

/**
 * Compare the lint verdict on a hand-off before and after scrubbing.
 *
 * WHY THIS MATTERS. The dashboard already publishes delegation findings computed
 * from the ORIGINAL text. If a substitution changed what `lintDelegationText`
 * sees, the extracted repo would report different findings than the dashboard
 * does, from files that look byte-plausible — and nobody would notice, because
 * both numbers would be internally consistent. The corpus builder gave this
 * guarantee once by hand ("the builder linted both forms of all fifty files and
 * required identical family sets before writing anything"); this enforces it on
 * every extraction.
 *
 * The lint's `workdir`/`outDir` are scrubbed too, because `bashEditsTree`
 * resolves a command's target RELATIVE to the workdir. Comparing scrubbed text
 * against an unscrubbed workdir would compare two different worlds and report a
 * difference that is an artefact of the check, not of the substitution.
 *
 * @returns {{equal: boolean, before: string[], after: string[]}}
 */
export function lintUnchangedByScrub(text, { rules = buildScrubRules(), workdir, outDir } = {}) {
  const families = (t, o) =>
    [...new Set(lintDelegationText(t, o).map((w) => `${w.family}${w.critical ? "!" : ""}`))].sort();

  const before = families(text, { workdir, outDir });
  const after = families(scrubText(text, rules), {
    workdir: workdir ? scrubText(workdir, rules) : workdir,
    outDir: outDir ? scrubText(outDir, rules) : outDir,
  });
  return { equal: before.join("|") === after.join("|"), before, after };
}

/** Files whose lint verdict must be preserved: the driver→worker hand-offs. */
const HANDOFF_RE = /^worker-task-.+\.md$/;

/**
 * Copy a tree, scrubbing every text file on the way, and verify as it goes.
 *
 * Reads from `srcDir`, writes to `destDir`. Never opens anything under `srcDir`
 * for writing — see the file docblock.
 *
 * `opts.files` overrides the directory walk with an explicit list of
 * srcDir-relative paths. The extractor passes git's own file list, so the
 * repository's `.gitignore` — including the deliberate un-ignore ladder that
 * admits `evidence-bundle/delegation/*` and nothing else under `runs/` — stays
 * the single definition of what is publishable. Walking instead would copy the
 * 880 MB of checkouts that ladder exists to exclude, and would need a second,
 * drifting copy of the same rules to avoid it.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @param {{rules?: Array, repoDirName?: string, workdir?: string, files?: string[]}} [opts]
 * @returns {{files: number, changed: number, replacements: number, checked: number}}
 * @throws {Error} if scrubbing would change a hand-off's lint verdict
 */
export function scrubTree(srcDir, destDir, opts = {}) {
  const rules = opts.rules ?? buildScrubRules();
  const stats = { files: 0, changed: 0, replacements: 0, checked: 0 };
  const sources = opts.files
    ? opts.files.map((f) => join(srcDir, f))
    : walkFiles(srcDir);

  for (const src of sources) {
    const rel = relative(srcDir, src);
    const dest = join(destDir, rel);
    const original = readFileSync(src, "utf8");
    const scrubbed = scrubText(original, rules);

    // A hand-off's findings are published; a receipt's are not. Only the
    // hand-offs go through the equivalence gate, and a failure stops the whole
    // extraction rather than emitting a file whose findings have moved.
    if (HANDOFF_RE.test(rel.split("/").pop())) {
      stats.checked += 1;
      const v = lintUnchangedByScrub(original, {
        rules, workdir: opts.workdir, outDir: dirname(src),
      });
      if (!v.equal) {
        throw new Error(
          `scrubbing changed the lint verdict for ${rel}\n` +
          `  before: ${v.before.join(", ") || "(clean)"}\n` +
          `  after:  ${v.after.join(", ") || "(clean)"}\n` +
          `The published findings would no longer match the dashboard's. ` +
          `Fix the rule that moved it before extracting.`);
      }
    }

    if (scrubbed !== original) {
      stats.changed += 1;
      // Count occurrences by re-running the detector on the original: the
      // number is for the extraction log, so a human can see at a glance that
      // the sweep did something and roughly how much.
      stats.replacements += hostPathHits(original, opts).length;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, scrubbed);
    stats.files += 1;
  }
  return stats;
}

// ---- CLI -------------------------------------------------------------------

/**
 * WHY THIS FILE HAS A COMMAND-LINE ENTRY POINT.
 *
 * Every function above was written for one caller — the extractor that produced
 * the published repo — and that caller ran once, from a scratch script that no
 * longer exists. What survived into the repository was a library nobody could
 * invoke: the module that decides whether a machine's directory layout reaches a
 * public git history was reachable only by writing a second script to import it.
 * The next person to prepare an extraction would either rewrite that script
 * (a second, drifting copy of the ordering rules this module exists to own) or
 * skip the step entirely, which is the failure mode with no error message.
 *
 * Two modes, because the module has two jobs and they are used at different
 * moments:
 *
 *   --src/--dest  produce a scrubbed copy of a tree, then assert over the copy.
 *                 The assertion is not optional and there is no flag to skip it:
 *                 the docblock's promise is "substitute AND prove", and a scrub
 *                 whose proof is opt-in is a scrub that silently regresses.
 *   --check       assert over a tree somebody else produced. This is the mode a
 *                 pre-push hook or a release checklist runs, and it is the one
 *                 that still works when the extractor changes shape.
 *
 * Exit codes follow run-harness.mjs so the two compose in one shell chain:
 * 0 clean, 1 the tool did its job and found something (leak, or a substitution
 * that moved a lint verdict), 2 the invocation was wrong and nothing ran.
 */
function cliMain(argv) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const usage = (msg) => {
    console.error(msg);
    console.error(
      "usage: scrub-paths.mjs --src <dir> --dest <dir> [--files-from <file|->]\n" +
      "                       [--repo-root <dir>] [--home <dir>] [--repo-dir-name <name>]\n" +
      "                       [--workdir <dir>]\n" +
      "       scrub-paths.mjs --check <dir> [--repo-dir-name <name>]\n\n" +
      "  --src/--dest      copy a tree, rewriting host paths to /harness, /repo\n" +
      "                    and /home/user, then assert none survived in the copy.\n" +
      "  --files-from      newline-separated src-relative paths instead of a walk;\n" +
      "                    `-` reads stdin, so `git ls-files | ... --files-from -`\n" +
      "                    makes .gitignore the definition of what is publishable.\n" +
      "  --check           assert only; writes nothing.\n\n" +
      "exit: 0 clean · 1 a host path survived, or a scrub moved a lint verdict · 2 usage");
    process.exit(2);
  };

  const src = flag("src");
  const dest = flag("dest");
  const check = flag("check");

  // Mutually exclusive on purpose: --check writes nothing and --src writes a
  // tree, so a command carrying both is ambiguous about whether anything was
  // produced. Refusing beats guessing when the guess is "did we publish?".
  if (check && (src || dest)) usage("--check cannot be combined with --src/--dest");
  if (!check && !(src && dest)) usage("required: --check <dir>, or both --src <dir> and --dest <dir>");

  const repoDirName = flag("repo-dir-name");
  // Only pass the key through when it was given: hostPathHits defaults it to
  // this repo's own directory name, and an explicit `undefined` would read as
  // "no name to check" and quietly disable half the detector.
  const detectOpts = repoDirName ? { repoDirName } : {};

  if (check) {
    // assertNoHostPaths throws with the offending files named; that message IS
    // the report, so it is printed rather than re-wrapped.
    try {
      assertNoHostPaths(resolve(check), detectOpts);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    console.log(`scrub-paths: ${check} is clean — no host paths.`);
    return;
  }

  const filesFrom = flag("files-from");
  const files = filesFrom
    // fd 0 for `-`: the list arrives on a pipe from `git ls-files`, and reading
    // it synchronously keeps this whole entry point free of async plumbing.
    ? readFileSync(filesFrom === "-" ? 0 : filesFrom, "utf8")
        .split("\n").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const rules = buildScrubRules({ repoRoot: flag("repo-root"), home: flag("home") });
  const srcAbs = resolve(src);
  const destAbs = resolve(dest);

  // The one thing that would make this tool destructive rather than protective:
  // writing the scrubbed copy back over its own source. Everything downstream
  // assumes the source is immutable evidence, so the check is here, before the
  // first write, not inside scrubTree where a library caller could pass past it.
  if (destAbs === srcAbs || destAbs.startsWith(srcAbs + "/")) {
    usage(`--dest must be outside --src (recorded runs are immutable evidence)`);
  }

  let stats;
  try {
    stats = scrubTree(srcAbs, destAbs, { rules, workdir: flag("workdir"), files, ...detectOpts });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  try {
    assertNoHostPaths(destAbs, detectOpts);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log(
    `scrub-paths: ${stats.files} file(s) copied to ${dest}, ${stats.changed} rewritten ` +
    `(${stats.replacements} host paths), ${stats.checked} hand-off(s) re-linted, ` +
    `0 survived the sweep.`);
}

// Run only when executed directly. `import.meta.url` compared against argv[1]
// is the ESM equivalent of `if __name__ == "__main__"` — importing this module
// (which every test and the extractor do) must not execute the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain(process.argv.slice(2));
}
