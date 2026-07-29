# Sealed EXECUTION image for the harness matrix — base instance + git seal
# + shell utilities. No agent layer: unlike the Setup 1 rig (which installed
# Claude Code inside the container), the harness-matrix runtimes live on the
# HOST; this container only executes repo commands (repro tests, baselines)
# via run-in-env.sh with the extracted workdir mounted at /app. That is why
# the rig's node/npm/CLI/unprivileged-user layers are gone: nothing in here
# ever holds credentials or drives a model.
#
# Built per instance on top of the frozen Scale image (BASE_IMAGE build arg).
# The task environment — toolchain, deps, repo checkout — is inherited
# untouched.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# bash + GNU coreutils are needed because run-in-env.sh executes
# `timeout -k … bash -c "$CMD"` inside the container, and BusyBox's timeout/sh
# applets differ from GNU's in flag and quoting behavior. git is already
# present in every base image (the repo checkout ships with .git).
#
# The sweap images are NOT a uniform base OS — this was assumed to be Alpine
# (true for vuls, which Setup 1 was verified against) until the first
# harness-matrix smoke hit navidrome and `apk` did not exist: that image is
# Debian-family. So branch on the package manager rather than the assumption.
# Alpine ALWAYS installs, because there `timeout`/`sh` exist as BusyBox
# applets and would pass a mere presence check while still behaving wrongly;
# Debian-family already ships GNU bash+coreutils, so it installs only if
# something is genuinely absent. The trailing verification hard-fails a base
# whose OS matches neither branch — without it, a missing tool would surface
# much later as an unexplained phase failure rather than a build error.
RUN set -eu; \
    if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache bash coreutils; \
    elif command -v apt-get >/dev/null 2>&1; then \
      if ! command -v bash >/dev/null 2>&1 || ! command -v timeout >/dev/null 2>&1; then \
        apt-get update \
        && apt-get install -y --no-install-recommends bash coreutils \
        && rm -rf /var/lib/apt/lists/*; \
      fi; \
    fi; \
    command -v bash    >/dev/null 2>&1 || { echo "sealed image: bash missing and no supported package manager"    >&2; exit 1; }; \
    command -v timeout >/dev/null 2>&1 || { echo "sealed image: timeout missing and no supported package manager" >&2; exit 1; }

# --- SEAL: kill the git-history leak (scaleapi/SWE-bench_Pro-os issue #93).
# Stock images ship history BEYOND the task's base commit — for vuls, 164
# future commits (including the real fix) plus origin/* refs and a live
# github.com remote; `git log --all` would hand the agent the answer.
# Fix: erase history entirely — re-init at the current tree, one commit, no
# remotes, no reflog, no tags but ours, no packed-refs. The original base
# SHA is kept in the commit subject for audit; it is public instance
# metadata (it is embedded in the instance_id), not sealed data.
#
# The `sealed-base` tag is the diff anchor. The workdir is EXTRACTED from
# this image to the host (docker cp), so the one-commit history and the tag
# travel with it — the final patch is `git diff sealed-base`, computed by
# git against the tag, which still captures everything even if the agent
# chooses to commit its work.
RUN cd /app \
 && BASE_SHA=$(git rev-parse HEAD) \
 && rm -rf .git \
 && git init -q \
 && git config user.email "harness@tilicho.local" \
 && git config user.name "harness-matrix" \
 && git add -A \
 && git commit -qm "sealed-base ${BASE_SHA}" \
 && git tag sealed-base

WORKDIR /app
# Keep a bash entrypoint: run-in-env.sh passes `-c '<script>'`.
ENTRYPOINT ["/bin/bash"]
