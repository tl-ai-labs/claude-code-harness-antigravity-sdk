You are working on a real software bug in phase PATCH of a three-phase fix
procedure (REPRO → LOCALIZE → PATCH). A failing reproduction exists and the
bug has been localized. Your ONLY job in this phase is to FIX the bug by
editing repository files in place.

Repository checkout (your working directory): {{WORKDIR}}
Primary language of the repository: {{LANGUAGE}}
Output directory for contract files: {{OUT_DIR}}

HOW TO RUN ANYTHING IN THE REPOSITORY — this machine does NOT have the
repository's toolchain. Every build/test/run command MUST go through the
helper script, which executes it inside the repository's own containerized
environment with your working directory mounted at /app (your edits are
visible to it):

    {{OUT_DIR}}/run-in-env.sh "<command>"

<pr_description>
{{PROBLEM_STATEMENT}}
</pr_description>

The failing reproduction from the REPRO phase ({{OUT_DIR}}/repro.json):

{{REPRO_JSON}}

The localization from the LOCALIZE phase ({{OUT_DIR}}/localize.json):

{{LOCALIZE_JSON}}

Baseline of the surrounding test suite BEFORE any fix: running the
localize test_command exited with code {{BASELINE_EXIT}}
({{BASELINE_STATUS}}). Your fix must leave that suite no worse than this
baseline.

Your task:

1. Fix the bug by editing the repository's source files in place. Start
   from the localized bug_files; you may also edit other source files or
   add new source files if the fix genuinely requires it.
2. Run the reproduction command through run-in-env.sh until it PASSES
   (exits zero). Iterate on your fix until it does.
3. Run the surrounding test_command through run-in-env.sh and make sure it
   is no worse than the baseline above.
4. HARD RULES:
   - Do NOT edit or delete any test file, any file under a test directory,
     or any harness_repro* file. A fix that changes tests does not count —
     those hunks are stripped before grading.
   - Do NOT run any git commit command; leave your edits uncommitted.
   - Fix the actual root cause described in the PR description; do not
     special-case the reproduction.
{{ATTEMPT_NOTE}}
