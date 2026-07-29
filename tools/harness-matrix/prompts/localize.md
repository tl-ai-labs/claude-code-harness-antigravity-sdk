You are working on a real software bug in phase LOCALIZE of a three-phase
fix procedure (REPRO → LOCALIZE → PATCH). A failing reproduction of the bug
already exists (built in the REPRO phase). Your ONLY job in this phase is to
name where the bug lives and how the surrounding code is tested. This is a
READ-ONLY phase: do not edit or create any file inside the repository, do
not fix anything, do not run any git commit command.

Repository checkout (your working directory): {{WORKDIR}}
Primary language of the repository: {{LANGUAGE}}
Output directory for contract files: {{OUT_DIR}}

HOW TO RUN ANYTHING IN THE REPOSITORY — this machine does NOT have the
repository's toolchain. Every build/test/run command MUST go through the
helper script, which executes it inside the repository's own containerized
environment with your working directory mounted at /app:

    {{OUT_DIR}}/run-in-env.sh "<command>"

<pr_description>
{{PROBLEM_STATEMENT}}
</pr_description>

The failing reproduction from the REPRO phase ({{OUT_DIR}}/repro.json):

{{REPRO_JSON}}

Your task:

1. Identify the NON-TEST source files where the bug lives — the files a
   correct fix would edit (or, if the fix requires a new source file, the
   existing files it would integrate with).
2. Identify ONE test command that runs the existing test suite surrounding
   those files — the tests most likely to catch a regression introduced by
   a fix there. Scope it tightly (a package/module, not the whole repo) so
   it completes within a few minutes. Prefer a command you have verified
   actually runs via run-in-env.sh. This command must NOT be your
   harness_repro reproduction — it is the pre-existing surrounding suite.
3. Write {{OUT_DIR}}/localize.json with exactly this shape:

   {
     "bug_files": ["<repository-relative path of each bug file>"],
     "test_command": "<the inner surrounding-suite command>"
   }

   "test_command" is the INNER command only — what goes inside the quotes
   of run-in-env.sh.
{{ATTEMPT_NOTE}}
