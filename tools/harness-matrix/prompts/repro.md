You are working on a real software bug in phase REPRO of a three-phase fix
procedure (REPRO → LOCALIZE → PATCH). Your ONLY job in this phase is to
produce a failing reproduction of the bug described below. Do NOT fix the
bug in this phase.

Repository checkout (your working directory): {{WORKDIR}}
Primary language of the repository: {{LANGUAGE}}
Output directory for contract files: {{OUT_DIR}}

HOW TO RUN ANYTHING IN THE REPOSITORY — this machine does NOT have the
repository's toolchain. Every build/test/run command MUST go through the
helper script, which executes it inside the repository's own containerized
environment with your working directory mounted at /app (your edits are
visible to it):

    {{OUT_DIR}}/run-in-env.sh "<command>"

Example: {{OUT_DIR}}/run-in-env.sh "go test ./models/..."

<pr_description>
{{PROBLEM_STATEMENT}}
</pr_description>

Your task:

1. Read the code as needed to understand the described bug.
2. Create one or more test files INSIDE the repository whose file names
   contain `harness_repro` (for example: harness_repro_test.go,
   test_harness_repro.py placed where the suite's conftest applies,
   harness_repro.test.js), located so the language's standard test runner
   discovers them.
3. The test(s) must FAIL on the current, unfixed code because of this bug,
   and must be written so they PASS once the bug is properly fixed. Verify
   the failure by actually running them through run-in-env.sh.
4. Do NOT modify any existing file. Do NOT fix the bug. Do NOT run any git
   commit command.
5. When your reproduction fails as expected, write {{OUT_DIR}}/repro.json
   with exactly this shape:

   {
     "command": "<the inner command that runs your reproduction>",
     "files": ["<repository-relative path of each file you created>"]
   }

   "command" is the INNER command only — what goes inside the quotes of
   run-in-env.sh (e.g. "go test ./models/ -run TestHarnessRepro"). It must
   exit non-zero right now and zero after a correct fix.
{{ATTEMPT_NOTE}}
