/**
 * docs-links.test.mjs — every relative link in every Markdown file resolves.
 *
 * WHY THIS FILE EXISTS. This repository is handed to people who have never
 * seen it, on machines nobody here has touched, and the documentation is the
 * only thing standing between them and a wall. A dead relative link costs
 * such a reader the one thing they cannot recover on their own: knowing where
 * the answer was *supposed* to be. They cannot tell "this file was renamed"
 * from "this file was never written" from "I cloned it wrong".
 *
 * And this is a failure mode that arrives by omission rather than by edit.
 * The reshape that produced this deliverable moved workloads to `examples/`
 * and removed a shelf of internal design documents from the working tree —
 * neither of which touches the files that *link* to them. Nothing in a build,
 * a typecheck, or the rest of the suite reads prose, so fourteen links across
 * two files pointed at nothing for as long as it took a human to notice.
 * A rule nobody can check is a rule that erodes; this is the check.
 *
 * WHAT IS IN SCOPE. Relative inline links (`[text](path)`) and relative
 * reference definitions (`[label]: path`) in every tracked Markdown file.
 * Absolute URLs, `mailto:`, and same-page `#anchor` links are out of scope —
 * verifying those means network access, and this suite is offline and free by
 * contract like every other suite here. A `path#anchor` is checked as far as
 * the file: the file must exist, the anchor is not resolved.
 *
 * WHAT IS DELIBERATELY NOT ENFORCED. Link *text*. A link whose target exists
 * but whose description is stale is a prose problem, and a test that guessed
 * at prose quality would produce exactly the kind of false failure that
 * teaches people to skip the suite.
 *
 * Offline and free: reads files, resolves paths, touches no network.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Directories that never contain authored documentation: build output,
 * dependency trees, virtualenvs, and recorded run evidence. `runs/` matters
 * most — a bundle's generated README links into a tree that is intentionally
 * not the repository, and re-checking machine-local evidence here would fail
 * on one developer's disk and pass on another's.
 */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "coverage",
  "runs", "studies", ".pkg-store", "sdkprobe", ".venv-swe-pro", "venv",
]);

/**
 * Prefer git, which is the honest answer to "what does this repository ship"
 * — it excludes anything gitignored without our having to re-implement the
 * ignore rules.
 *
 * Two invocations, not one, and the second is the one that earns its keep.
 * `git ls-files` alone lists only *tracked* files, so a documentation page
 * written five minutes ago and not yet committed is invisible to this suite:
 * you would add it, run the tests, watch them pass, and commit the broken
 * link anyway. `--others --exclude-standard` adds the untracked-but-not-
 * ignored files, which is exactly the new page, and still leaves `runs/`,
 * `node_modules/` and the venvs out.
 *
 * Fall back to a filesystem walk so the suite still runs from a source
 * tarball or an export with no `.git` directory, where a hard failure would
 * be a test failing for a reason that has nothing to do with the links.
 */
function markdownFiles() {
  try {
    const git = (args) => execFileSync("git", args, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).split("\n").map((s) => s.trim()).filter(Boolean);
    const found = [
      ...git(["ls-files", "*.md", "**/*.md"]),
      ...git(["ls-files", "--others", "--exclude-standard", "*.md", "**/*.md"]),
    ];
    if (found.length) return [...new Set(found)];
  } catch {
    // not a git checkout, or git is absent — walk instead
  }
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) found.push(relative(ROOT, full));
    }
  };
  walk(ROOT);
  return found;
}

/**
 * Pull link targets out of one Markdown source.
 *
 * Fenced code blocks are stripped first. A fence routinely contains something
 * that reads like a link to a regex — a shell comment, a URL in an example, a
 * snippet of Markdown being *shown* rather than used — and none of those are
 * navigation a reader can click.
 */
function linkTargets(src) {
  const prose = src.replace(/```[\s\S]*?```/g, "").replace(/^ {4}.*$/gm, "");
  const targets = [];
  for (const m of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) targets.push(m[1]);
  for (const m of prose.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)) targets.push(m[1]);
  return targets;
}

/** Anything we cannot check offline, or that does not name a file at all. */
const isExternal = (t) => /^(https?:|mailto:|tel:|ftp:|#|<)/i.test(t);

test("every relative Markdown link points at a file that exists", () => {
  const files = markdownFiles();

  // A silent zero here would be a green suite that checked nothing — the
  // exact failure this file exists to prevent, one level up.
  assert.ok(files.length > 0, "found no Markdown files to check");

  const broken = [];
  for (const file of files) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;   // tracked-but-deleted, mid-rename
    for (const target of linkTargets(readFileSync(abs, "utf8"))) {
      if (isExternal(target)) continue;
      const path = decodeURI(target.split("#")[0]);
      if (!path) continue;            // pure "#anchor", already excluded
      if (!existsSync(resolve(dirname(abs), path))) {
        broken.push(`${file} -> ${target}`);
      }
    }
  }

  assert.deepEqual(
    broken, [],
    `broken relative links:\n  ${broken.join("\n  ")}`,
  );
});

test("no Markdown file links into a machine-local evidence directory", () => {
  // `runs/` is gitignored: it is one developer's recorded runs, present on
  // their disk and absent on a fresh clone. A documentation link into it
  // resolves for the author and 404s for every reader — the one class of
  // broken link the test above structurally cannot catch, because on the
  // authoring machine the file really is there.
  const offenders = [];
  for (const file of markdownFiles()) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    if (file.includes("/runs/")) continue;      // a bundle's own generated README
    for (const target of linkTargets(readFileSync(abs, "utf8"))) {
      if (isExternal(target)) continue;
      if (/(^|\/)runs\//.test(target)) offenders.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `links into gitignored runs/ evidence:\n  ${offenders.join("\n  ")}`,
  );
});
