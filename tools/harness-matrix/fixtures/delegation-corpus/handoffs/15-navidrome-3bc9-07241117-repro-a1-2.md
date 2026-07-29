# Goal

Create a failing reproduction test for a bug in the Navidrome codebase where expired items are NOT actively evicted from the SimpleCache.

# Bug Description

The `SimpleCache` implementation does not evict expired items, allowing them to persist in memory even after expiration. Operations like `Keys()` and `Values()` return outdated/expired entries. Expired entries should be cleared as part of normal cache usage.

# Steps

1. Read `utils/cache/simple_cache.go` to understand the SimpleCache implementation, especially Keys() and Values().
2. Read `utils/cache/simple_cache_test.go` to understand test patterns.
3. Create a NEW file at `utils/cache/harness_repro_test.go` in the `cache` package. The test must:
   - Import "testing", "time", and any other needed packages
   - Create a SimpleCache with a very short TTL (e.g., 1*time.Millisecond)
   - Add items to the cache using whatever Add/Set/Put method exists
   - Sleep long enough for the items to expire (e.g., time.Sleep(50*time.Millisecond))
   - Call Keys() and assert the returned slice has length 0
   - Call Values() and assert the returned slice has length 0
   - Use t.Errorf to report failures
   - Name the test function TestHarnessRepro
4. Do NOT modify any existing files.

YOU MUST actually write the file to disk. Use your file creation capabilities to create utils/cache/harness_repro_test.go. This is the most important part of the task.

# Contract

- File created: utils/cache/harness_repro_test.go
- Test function: TestHarnessRepro
- No existing files modified
