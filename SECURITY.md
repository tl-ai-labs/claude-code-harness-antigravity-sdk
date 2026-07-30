# Security

## Reporting a vulnerability

If you find a security-relevant issue in this repository, please do not open a public issue. Email the maintainers directly at `ai-labs-publish-bot@tilicho.in` with:

- A description of the issue.
- Steps to reproduce.
- The version (commit SHA) you observed it in.
- Any suggested mitigations, if you have them.

We will acknowledge the report within 3 business days and coordinate a fix and disclosure timeline with you.

## Scope

Security-relevant issues include, but are not limited to:

- API keys, tokens, or other secrets accidentally committed to the repo.
- Vulnerabilities in the harness runner (`tools/harness-matrix/`), the SDK worker (`gemini_worker.py`), or the pre-execution guard hook.
- A bypass of the driver-worker split — anything that lets the Claude Code driver write repo files despite the tool removal, the pre-execution hook, and the post-run audit. This split is the enforcement invariant the harness exists to demonstrate.
- Vulnerabilities in the setup wizard (`tools/setup.mjs`) or the SWE-bench Pro fetcher (`tools/swe/fetch-instances-pro.mjs`).
- Any code path that could exfiltrate user data or credentials.

Out of scope:

- General questions about how to use the harness — please open a regular issue.
- Missing features that are not security issues.

## Handling of user credentials

Nothing in this repository transmits, uploads, or persists your API keys or Google Cloud credentials anywhere except your own local environment. The setup wizard reads credentials from your shell environment and from Google Application Default Credentials (`gcloud auth application-default login`); it does not write them to disk. Individual harness runs use the credentials via the Claude Code CLI and the local Antigravity SDK worker — the credentials never leave your machine except in the form of authenticated API calls to Anthropic and Google Cloud (Vertex AI).

If you observe behavior that contradicts the above, treat it as a security issue and report accordingly.
