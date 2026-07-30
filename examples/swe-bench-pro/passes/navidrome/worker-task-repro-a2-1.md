# Task: Create a failing reproduction test for a SimpleCache expired-items bug

## Repository
This is the Navidrome music server, a Go repository. Your working directory is the repo root.

## Bug Description
The `SimpleCache` implementation does not evict expired items. Operations like `Keys()` and `Values()` return outdated/expired entries even after their TTL has passed. Expired items persist in memory.

## Expected Behavior
Expired entries should be cleared as part of normal cache usage. `Keys()` and `Values()` should only return valid (non-expired) entries.

## What You Must Do

1. **Find the SimpleCache implementation.** Search for files containing "SimpleCache", look for `Keys()` and `Values()` methods. It's likely in a `cache` or `utils` package.

2. **Understand the cache API.** How are items added (with TTL/expiration)? How do `Keys()` and `Values()` work? What package is it in?

3. **Create a test file** named `harness_repro_test.go` in the SAME directory/package as SimpleCache. The test must:
   - Add items to the cache with a very short TTL (e.g., 10 milliseconds)
   - Wait for the TTL to expire (e.g., `time.Sleep(50 * time.Millisecond)`)
   - Call `Keys()` and/or `Values()`
   - Assert that expired items should NOT be returned — use `t.Errorf` or `t.Fatalf` when they ARE returned (which they will be on the buggy code, causing the test to FAIL)
   - Use standard Go testing (`testing` package)

4. **Constraints:**
   - The test file name MUST contain `harness_repro`
   - Do NOT modify any existing files — only create the new test file
   - Keep sleep times very short (milliseconds) so the test completes in seconds
   - The test MUST fail on the current (buggy) code

## Contract
Report back with:
- The exact path of the test file you created (relative to repo root)
- The exact `go test` command to run it (e.g., `go test ./utils/cache/ -run TestHarnessRepro -v -count=1 -timeout 30s`)
- Confirmation that you verified the test exists and is syntactically valid
