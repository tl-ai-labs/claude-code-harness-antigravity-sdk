# Task: Reproduce the SimpleCache expired-items bug

## Repository
Go codebase at /app (mounted working directory).

## Bug
The `SimpleCache` implementation does not actively evict expired items from the cache. When items expire, operations like `Keys()` and `Values()` still return them. Expired entries should be transparently discarded so that only valid, non-expired data is returned.

## What you must do

1. **Find the SimpleCache implementation.** Search the codebase for files containing "SimpleCache", "simpleCache", or related cache types. Look in directories like `utils/`, `cache/`, `server/`, or wherever the cache package lives. Read the implementation to understand:
   - How the cache stores items
   - How expiration is tracked
   - What `Keys()` and `Values()` do (do they filter expired items or not?)
   - How `Get()`, `Add()`/`Set()` work

2. **Create a reproduction test file.** The file must:
   - Be named with `harness_repro` in the filename (e.g., `harness_repro_test.go`)
   - Be placed in the same package directory as the SimpleCache implementation
   - Contain one or more test functions that demonstrate the bug

3. **Test design.** The test(s) should:
   - Create a SimpleCache with a very short expiration time (e.g., 1-10 milliseconds)
   - Add one or more items to the cache
   - Wait long enough for the items to expire (e.g., `time.Sleep`)
   - Call `Keys()` and assert it returns an empty slice (0 keys, since everything expired)
   - Call `Values()` and assert it returns an empty slice (0 values, since everything expired)
   - The test must FAIL on the current unfixed code (because Keys/Values return stale expired entries)
   - The test must PASS once the bug is fixed (expired items evicted before returning)

4. **Do NOT modify any existing file.** Only create new files.

5. **Report back:**
   - The exact repo-relative path of the test file you created
   - The package import path for `go test` (e.g., `./utils/cache/`)
   - The test function name(s)

## Contract
- Create exactly one new test file with `harness_repro` in the name
- Do not modify any existing files
- The test must be discoverable by `go test`
