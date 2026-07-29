# PATCH: Fix lastFMConstructor defaults in core/agents/lastfm.go

## Bug Description

The `lastFMConstructor` function in `core/agents/lastfm.go` does not set sensible defaults when configuration values are missing:
- If the API key is not configured, the agent is created without a working key instead of falling back to a built-in shared key.
- If no language is configured, the agent does not default to a safe value like "en".

## Your Task

1. Read `core/agents/lastfm.go` to understand the current `lastFMConstructor` implementation and how configuration values (API key, language) are read.
2. Read `core/agents/harness_repro_test.go` to understand what the reproduction test expects.
3. Search the codebase for any existing default/shared API key constant (look for consts like `lastfmAPIKey`, `apiKey`, or similar in lastfm-related files — check `core/lastfm/` directory as well).
4. Fix the `lastFMConstructor` function so that:
   - When the API key IS configured (non-empty), it uses the configured value.
   - When the API key is NOT configured (empty/missing), it falls back to the built-in shared/default key.
   - When the language IS configured (non-empty), it uses the configured value.
   - When the language is NOT configured (empty/missing), it falls back to "en".
5. Only edit `core/agents/lastfm.go` (or other non-test source files if truly necessary). Do NOT edit any test files or any file matching `harness_repro*`.

## Contract

- The reproduction test must pass: `go test ./core/agents/ -run TestHarnessRepro -v`
- The surrounding test suite must still pass: `go test ./core/agents/ -run TestAgents -v -count=1`
