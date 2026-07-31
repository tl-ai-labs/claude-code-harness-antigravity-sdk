# sdk-probe — how to re-run the Antigravity SDK probes

This harness's worker reaches Gemini through
`pip install google-antigravity`. These scripts are the evidence behind
every SDK claim this repository makes — kept in the tree so the findings
are reproducible rather than asserted, and so anyone evaluating the SDK
can re-run them instead of taking our word for it.

**The findings themselves are in
[docs/antigravity-sdk.md](../../../docs/antigravity-sdk.md)** — what the
SDK does, what it does not, and the defect that blocks a Claude worker.
This page is only how to reproduce them.

First probed on 2026-07-21 against **google-antigravity 0.1.7**, and
re-run on 2026-07-31 against **0.1.9** — the wheel that day's live
validation runs recorded in their own usage receipts. Every finding held
across both.

| Script | Costs | Answers |
|---|---|---|
| `probe_offline.py` | $0, no network | What is in the package? Anthropic reach, policy helpers, `ThinkingLevel`, `VertexEndpoint` env pickup, and what the bundled 99 MB `localharness` Go binary knows about Claude. |
| `probe_vertex.py` | ~59k Flash tokens | Does it actually run? Three escalating variants: plain text → `ThinkingLevel.HIGH` → `run_command` under `allow_all()`. Prints real `UsageMetadata`. |
| `probe_openai_shape.py` | $0, no network | Can the SDK drive a non-Google model? Points it at a local capture server and reads the request it emits. |
| `proxy_anthropic.py` | $0 to run | The fix for what that probe found: a localhost proxy that attaches the `Authorization` header the SDK never sends. Not a MITM gateway — no CA, no Google traffic, no protocol translation. |
| `test_proxy_offline.py` | $0, no network | Rehearses the real SDK through the real proxy into a mock Anthropic. Proves everything on this side of the wire without a key. |
| `test_proxy_live.py` | ~$0.50/run, real | The same path against `api.anthropic.com`. Answers what a mock cannot. |
| `probe_managed_agent.py` | $0 (`--smoke` is metered) | A different question and a different API: is Google's **managed agent** route (the Interactions API, where Google runs the agent loop in its own sandbox) reachable on your project? Stdlib only — no venv, no SDK, runs on any system `python3`. |

## Setup

The SDK needs **Python ≥ 3.10**. On a machine whose default `python3` is
older — macOS ships 3.9 — `pip index versions google-antigravity` reports
"no matching distribution", which is a misleading false negative rather than a
missing package. Check `python3 --version` before believing it.

Homebrew's Python needs one workaround: its `pyexpat` is linked against a
Homebrew `libexpat` that may not be installed, so it falls back to the older
system copy and fails to load. Install it and point the loader at it:

```sh
brew install expat
export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib

/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv sdkprobe
# that venv's ensurepip fails for the same reason — install from the host pip:
/opt/homebrew/opt/python@3.12/bin/python3.12 -m pip \
  --python ./sdkprobe/bin/python install google-antigravity

./sdkprobe/bin/python probe_offline.py
./sdkprobe/bin/python probe_vertex.py         # spends money (Vertex, YOUR project)
./sdkprobe/bin/python probe_openai_shape.py
./sdkprobe/bin/python test_proxy_offline.py   # $0, needs any ANTHROPIC_API_KEY value
./sdkprobe/bin/python test_proxy_live.py      # spends money (real Anthropic)
```

On Linux, or with a `python3` already at 3.10 or newer, the venv is the
ordinary two lines and none of the expat handling applies:

```sh
python3 -m venv sdkprobe && ./sdkprobe/bin/pip install google-antigravity
```

This is the same venv [docs/setup.md](../../../docs/setup.md) builds for the
worker, so if you have already run the setup wizard it is here already.

`probe_offline.py` takes a minute or two on its last section: it shells
out to `strings` over a 99.4 MB binary. That is the slow part, not a hang.

`probe_vertex.py` runs against **the paid Google Cloud project you name in**
`GOOGLE_CLOUD_PROJECT`, in `GOOGLE_CLOUD_LOCATION` (default `asia-south1`), via
Application Default Credentials — there is no free tier on this path. It
refuses to start with the project unset rather than guess one. It is cheap but
not free.

The probes are the one place `GOOGLE_CLOUD_LOCATION` is still the last word:
they read the environment directly and never load a policy. On a real run the
region comes from the policy's worker leaf, which the runner passes to
`gemini_worker.py` as `--region` and which outranks the environment. So export
the region you actually want to probe — probing `asia-south1` proves nothing
about a policy that pins `global`, and `gemini-3.5-flash-lite` is served on
`global` only.

`probe_managed_agent.py` needs **none** of the setup above — it is stdlib only
and deliberately so, since its whole point is that anyone can re-run it in one
command:

```sh
gcloud auth application-default login     # once, if ADC has expired
python3 probe_managed_agent.py            # $0
python3 probe_managed_agent.py --smoke    # METERED — schedules a real agent
```

Note it targets `locations/global`, not `asia-south1`: `global` is the only
location the Interactions API supports. That is a different axis from the
Gemini region pin and is not an inconsistency to "fix".

## Reproducing the proxy leg

This is the one that establishes the Claude blocker, and it is the one
with setup you would not guess. Set `ANTHROPIC_API_KEY` in your shell the
way you normally would (a secret manager, or `read -s`; do not commit it
anywhere) and:

```sh
./sdkprobe/bin/python proxy_anthropic.py --port 8787 --dump-file /tmp/exch.txt
# then point the SDK's base_url at http://127.0.0.1:8787   (no /v1 suffix)
```

`--dump-file` is the only way to see what the upstream actually returned: the
SDK swallows a reply it cannot parse and reports a generic "model output"
error, so without it you cannot tell "Anthropic refused" from "Anthropic
answered and Antigravity could not read it". The 400 on turn two that
[docs/antigravity-sdk.md](../../../docs/antigravity-sdk.md) describes is
only diagnosable from that dump — the error text alone points at the
wrong thing.

`--inject-thinking <effort>` additionally injects a thinking parameter, since
the proxy is rewriting the request anyway. This is why the earlier claim that
"the proxy route costs thinking parity" was wrong. It is **unverified** against
the live endpoint and gated behind the flag for that reason.
