# Goal

Create a failing reproduction test for a bug in the Navidrome codebase where expired items are NOT actively evicted from the SimpleCache.

# Bug Description

The `SimpleCache` implementation does not evict expired items, allowing them to persist in memory even after expiration. Operations like `Keys()` and `Values()` return outdated/expired entries. Components like `playTracker` depend on the cache for accurate real-time data. Expired entries should be cleared as part of normal cache usage — any operation that interacts with stored elements should transparently discard outdated items.

# Steps

1. Find and read the `SimpleCache` implementation. Search for files containing `SimpleCache`, `Keys()`, `Values()` methods. Look in directories like `utils/cache/`, `cache/`, or similar.
2. Read any existing test files for the SimpleCache to understand test patterns and imports.
3. Create a NEW test file named `harness_repro_test.go` in the SAME directory and package as the SimpleCache source file.
4. The test must:
   - Create a SimpleCache with a very short TTL (e.g., 1 millisecond)
   - Add one or more items to the cache
   - Wait for them to expire (e.g., `time.Sleep(10 * time.Millisecond)`)
   - Call `Keys()` and assert the result is empty (len == 0)
   - Call `Values()` and assert the result is empty (len == 0)
   - The test function name must start with `TestHarnessRepro`
   - The test should FAIL on the CURRENT (unfixed) code because expired items are still returned
   - The test should PASS once the bug is properly fixed (i.e., once Keys()/Values() filter out expired items)
5. Do NOT modify any existing files. Only create the new test file.

# Contract

- The new file must be named `harness_repro_test.go` and placed in the same Go package as SimpleCache.
- The test function name must contain `HarnessRepro`.
- Do NOT modify any existing source files.
- After creating the file, report the full path of the file you created and the Go package path for running the test.
