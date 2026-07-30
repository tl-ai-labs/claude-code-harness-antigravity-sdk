# Task: Create a failing reproduction test for the SimpleCache expired-items bug

## Repository location
Go codebase. Working directory is /app.

## Context
The file `utils/cache/simple_cache.go` defines a `SimpleCache` interface and `simpleCache` struct wrapping `ttlcache/v3`. The existing tests are in `utils/cache/simple_cache_test.go` using Ginkgo/Gomega.

The bug: after items expire in the cache, `Keys()` still returns them. Expired items are not actively evicted. The `Keys()` method at line 86-88 of `simple_cache.go` just calls `c.data.Keys()` without filtering expired entries.

## What you must create

Create a NEW file at `utils/cache/harness_repro_test.go` (package `cache`). It must use Ginkgo/Gomega (matching the existing test style in the same package). It must contain a test that:

1. Creates a SimpleCache with a short default TTL (e.g., 10ms): `NewSimpleCache[string, string](Options{DefaultTTL: 10 * time.Millisecond})`
2. Adds a couple items to the cache
3. Waits for them to expire (e.g., `time.Sleep(50 * time.Millisecond)`)
4. Calls `Keys()` and asserts it returns an EMPTY slice (`Expect(keys).To(BeEmpty())`)
5. This test will FAIL on the current code because `Keys()` returns expired keys
6. Once the bug is fixed (expired items evicted), the test will PASS

The file must also have a `suite_test.go`-compatible setup — since there's already a `cache_suite_test.go` in the package (check if it exists, if so you don't need one), the Ginkgo `var _ = Describe(...)` pattern is sufficient.

## Constraints
- Do NOT modify any existing file
- Only create `utils/cache/harness_repro_test.go`
- Use the `cache` package name
- Import ginkgo/gomega matching the existing test imports

## Expected output
Tell me:
1. The exact path of the file you created
2. Confirmation you created it
