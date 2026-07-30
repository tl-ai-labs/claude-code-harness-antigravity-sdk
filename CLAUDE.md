# Claude Code — repo conventions

## Commits

Follow the "Commit messages" section of [CONTRIBUTING.md](CONTRIBUTING.md). In
particular:

- **Do NOT add `Co-Authored-By:` trailers for AI assistants.** The committer
  identity on this repo is a bot on purpose; AI-attribution trailers add
  noise on a public repo. This applies to every commit, whether or not a
  Claude Code / other AI session helped author the change.
- Sentence case, present tense, no emojis.
- Wrap the body at 72 columns.
- Explain *why*, not *what*.
- One topic per commit; split unrelated changes.

## The driver-worker split is the invariant

If a change touches `tools/harness-matrix/runtimes.mjs`, `gemini_worker.py`,
the pre-execution guard hook, or the post-run audit (`audit.mjs`), verify
that all three still share the same predicate — that is the property the
harness exists to demonstrate. The offline tests under
`tools/harness-matrix/*.test.mjs` cover this; do not weaken those tests to
make an unrelated change pass.
