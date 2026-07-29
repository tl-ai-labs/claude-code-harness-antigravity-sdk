# Fix: Expired items not actively evicted from SimpleCache

## Goal
Edit `utils/cache/simple_cache.go` to fix the `Keys()` method so it does not return expired keys.

## Context
The file wraps `github.com/jellydator/ttlcache/v3`. The `Keys()` method at line 86-88 currently just delegates to `c.data.Keys()`, which returns ALL keys including expired ones. The ttlcache library has a `DeleteExpired()` method that removes expired items from the cache.

## What to do
Edit `utils/cache/simple_cache.go` and modify the `Keys()` method to call `c.data.DeleteExpired()` before calling `c.data.Keys()`. This ensures expired items are actively evicted and not returned.

## Verification
After editing, run BOTH of these commands and confirm they pass:

1. `/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run TestHarnessRepro -v"`

2. `/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run 'Test[^H]' -v"`

## Constraints
- Only edit `utils/cache/simple_cache.go`
- Do NOT edit any test files
- Do NOT run git commit
