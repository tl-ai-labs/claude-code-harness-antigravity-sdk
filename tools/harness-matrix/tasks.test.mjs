/**
 * Integrity tests for the SDLC task corpus (examples/*).
 *
 * A task directory is pure DATA — `task.json` plus the brief it pins by hash —
 * and the harness validates it inside `kinds/sdlc.mjs#run`, which is the right
 * place for a run to fail but the wrong place to FIND OUT. Every check below is
 * one the engine already makes at launch; running them offline means a corpus
 * mistake surfaces in `pnpm test` in milliseconds instead of after Docker has
 * come up, the scaffold has been provisioned, and the first model call has
 * already been billed.
 *
 * The corpus is walked rather than enumerated, so a task added later is covered
 * the moment its directory exists — no test edit, and no way to add a task that
 * is quietly untested. Directories under examples/ that lack task.json (e.g.
 * examples/swe-bench-pro/, which is fetched via --instance-dir rather than
 * --task-dir) are skipped by the walk.
 *
 * Everything here is filesystem-only: no container, no network, no spend.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./kinds/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TASKS_DIR = join(ROOT, "examples");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Every SDLC task directory under examples/, by id (= directory name). A
 * task is identified by the presence of task.json; other example directories
 * (SWE-bench Pro, which is --instance-dir-shaped) are skipped. */
const taskIds = readdirSync(TASKS_DIR)
  .filter((name) => {
    const dir = join(TASKS_DIR, name);
    return statSync(dir).isDirectory() && existsSync(join(dir, "task.json"));
  })
  .sort();

test("the corpus is not empty", () => {
  // Guards the walk itself: a glob that silently matched nothing would make
  // every test below vacuously pass.
  assert.ok(taskIds.length > 0, `no task directories under ${TASKS_DIR}`);
});

for (const id of taskIds) {
  const taskDir = join(TASKS_DIR, id);
  const taskPath = join(taskDir, "task.json");

  test(`${id}: task.json is present, parses, and carries every required field`, () => {
    assert.ok(existsSync(taskPath), `${taskPath} missing`);
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    for (const k of ["task_id", "template_id", "scaffold_id", "brief"]) {
      assert.equal(typeof task[k], "string", `"${k}" must be a string`);
      assert.ok(task[k].length > 0, `"${k}" must be non-empty`);
    }
    // The engine resolves a task by DIRECTORY but reports it, names its run
    // directory, and stamps its manifest by `task_id`. If those two ever drift,
    // a run's exported evidence points at a task nobody can find on disk.
    assert.equal(task.task_id, id, `task_id must match its directory name`);
  });

  test(`${id}: the brief exists and still matches its sha256 pin`, () => {
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    const briefPath = join(taskDir, task.brief);
    assert.ok(existsSync(briefPath), `brief file ${task.brief} missing`);
    const brief = readFileSync(briefPath, "utf8");
    assert.ok(brief.trim().length > 0, "brief is empty");
    // The brief is the run's entire problem statement. Pinning it by hash is
    // what stops an edited brief from masquerading as the same task across
    // runs — which would make two cells look comparable when they were asked
    // different questions. Updating the brief is fine; updating it WITHOUT
    // repinning is the failure this catches.
    assert.ok(task.brief_sha256, "brief_sha256 pin missing — the brief would be unverifiable");
    assert.equal(sha256(brief), task.brief_sha256, "brief.md changed since task.json pinned it");
  });

  test(`${id}: template resolves, is an sdlc template, and agrees about the scaffold`, () => {
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    const templatePath = join(ROOT, "templates", task.template_id, "template.yaml");
    assert.ok(existsSync(templatePath), `template ${task.template_id} not found at ${templatePath}`);
    const template = parseYaml(readFileSync(templatePath, "utf8"));
    assert.equal(template.kind, "sdlc", "task kind runs sdlc templates only");
    // Two files independently name the scaffold; the run is only coherent if
    // they name the SAME one.
    assert.equal(template.scaffold, task.scaffold_id, "template scaffold != task.json scaffold_id");
    assert.ok(Array.isArray(template.stages) && template.stages.length > 0, "template has no stages");
    for (const s of template.stages) {
      assert.ok(s?.id && s?.executor, `every stage needs id + executor (got ${JSON.stringify(s)})`);
      assert.ok(
        ["llm-task", "verify", "judge", "report"].includes(s.executor),
        `stage '${s.id}': executor '${s.executor}' is not implemented by the SDLC kind`,
      );
    }
    // The kind refuses to run without an execute stage, because the delivery
    // has nowhere to happen otherwise.
    assert.ok(
      template.stages.some((s) => s.executor === "llm-task" && s.config?.packet === "planned"),
      "no llm-task stage with config.packet 'planned' — the kind needs an execute stage",
    );
  });

  test(`${id}: the scaffold it names is on disk with the files the kind reads`, () => {
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    const scaffoldDir = join(ROOT, "scaffolds", task.scaffold_id);
    assert.ok(existsSync(scaffoldDir), `scaffold ${task.scaffold_id} missing`);
    // Exactly the set kinds/sdlc.mjs reads before the first model call. A
    // missing one is an infra failure that would otherwise be discovered after
    // the container is already up.
    for (const f of ["scaffold.json", "scaffold.manifest.json", "CONVENTIONS.md", "prisma/schema.prisma"]) {
      assert.ok(existsSync(join(scaffoldDir, f)), `scaffold ${task.scaffold_id} is missing ${f}`);
    }
    const scaffold = JSON.parse(readFileSync(join(scaffoldDir, "scaffold.json"), "utf8"));
    assert.equal(scaffold.scaffold_id, task.scaffold_id, "scaffold.json disagrees with its own directory name");
  });
}
