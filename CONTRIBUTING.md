# Contributing

Thanks for your interest in improving this harness.

## What contributions we welcome

- **Bug fixes** in the runner (`tools/harness-matrix/`), the SDK worker (`gemini_worker.py`), the guard hook, or the setup wizard.
- **Documentation improvements** — typos, unclear phrasing, additional troubleshooting entries under [docs/](docs/).
- **Additional policies** under `tools/harness-matrix/policies/`. If you add one, include a short comment header describing what it demonstrates, which vendor lanes it uses, and what credentials it needs.
- **Additional SDLC workloads** under `examples/`. Match the shape of `examples/kudos-wall/` (`brief.md`, `task.json`, `README.md`).
- **Portability fixes** for Windows/WSL, non-mac Linux distributions, or other environments.

## What we would rather not merge without discussion first

- Wholesale rewrites of the harness runner, the kind modules (`kinds/sdlc.mjs`, `kinds/swepro.mjs`), or the enforcement predicate that the tool removal, the pre-execution hook, and the post-run audit share.
- New worker adapters. The Antigravity SDK path against Vertex AI is what the shipped policies use; additional adapters mean additional dependencies, additional credential surface, and additional test surface.
- Changes that add reporting or telemetry without a corresponding entry in [docs/methodology.md](docs/methodology.md).

Open an issue to discuss before writing a large PR — saves everyone time.

## How to submit

1. Fork the repo, create a feature branch off `main`.
2. Make your change. Keep the diff focused; one topic per PR.
3. Run `pnpm install && pnpm build && pnpm test` on a clean clone to verify the 290 offline tests still pass.
4. Run `node tools/harness-matrix/run-harness.mjs --task-dir examples/kudos-wall --runtime claude-code --policy tools/harness-matrix/policies/all-gemini-flash-high.yaml --dry-run` to verify the plumbing still resolves.
5. If you touched the runner or a kind module, run a full live pass locally and confirm the manifest and evidence bundle still render sensibly.
6. Open a pull request. Describe what changed and why in one or two paragraphs.

## Commit messages

Sentence case, present tense, no emojis. The body wraps at 72 characters and explains *why*, not *what* — the diff shows the what. Keep them short and readable.

Do not add `Co-Authored-By:` trailers for AI assistants. The committer identity is a bot on purpose; AI-attribution trailers add noise on a public repo. This applies to all commits, whether or not a Claude Code / other AI session helped author the change.

## Code style

The runner and its supporting scripts (`tools/harness-matrix/*.mjs`, `tools/setup.mjs`) are plain ES modules. No TypeScript there, no build step for the runner itself; keep them that way so a customer engineer can read and modify them without a compiler.

The supporting packages (`packages/pricing/`, `packages/policy/`, `packages/swe-bench/`) are TypeScript with a `pnpm -r build` step. Follow the existing conventions in each package.

The SDK worker (`tools/harness-matrix/gemini_worker.py`) and the probes (`tools/harness-matrix/sdk-probe/`) are Python. Keep them Python-3.11-compatible and dependency-light — the only pip dependency the worker needs is `google-antigravity`.
