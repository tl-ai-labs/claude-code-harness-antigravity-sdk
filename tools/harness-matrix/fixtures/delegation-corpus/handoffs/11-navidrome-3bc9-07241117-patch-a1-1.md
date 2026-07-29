# Fix: Expired items not actively evicted from SimpleCache

## Goal
Fix the `SimpleCache` implementation in `utils/cache/simple_cache.go` so that expired items are actively evicted during normal cache operations. Currently, methods like `Keys()` and `Values()` return expired entries, which is incorrect.

## Bug Summary
The `SimpleCache` does not filter out expired items when returning keys or values. Expired items persist and are returned by `Keys()` and `Values()`, causing stale data to be visible to callers.

## Steps

1. **Read** `utils/cache/simple_cache.go` to understand the full cache implementation — pay attention to how `Get()` handles expiration (it likely already checks and evicts expired items on access).

2. **Read** `utils/cache/harness_repro_test.go` to understand what the reproduction test expects.

3. **Fix** `utils/cache/simple_cache.go`: modify the `Keys()` and `Values()` methods (and any other methods that iterate over all items without checking expiration) to:
   - Check whether each item has expired before including it in the result
   - Evict (delete) expired items from the underlying map when encountered
   - Use the same expiration-checking pattern already used in `Get()` or similar methods

4. **Do NOT** edit any test files or `harness_repro_test.go`.

5. **Verify** your fix by running these two commands:
   - Reproduction test (must PASS): `/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run TestHarnessRepro -v"`
   - Existing tests (must still PASS): `/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run 'Test[^H]' -v"`

## Constraints
- Only edit source files in `utils/cache/simple_cache.go` (or other non-test source files if truly needed)
- Do NOT edit any test file, any file under a test directory, or any harness_repro* file
- Do NOT run any git commit command
- Fix the actual root cause — do not special-case the reproduction test
