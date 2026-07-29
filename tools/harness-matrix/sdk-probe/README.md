# sdk-probe — T-SDK-1, the Antigravity SDK capability probe

Google asked us on 2026-07-20 to move the harness off the `agy` CLI and onto
`pip install google-antigravity`. These scripts are the evidence behind
every SDK claim in [DESIGN.md §2.7a–§2.7c](../DESIGN.md) — kept in the repo so the
findings are reproducible rather than asserted, and so the challenges list we
send back to Google is backed by something anyone can re-run.

Probed against **google-antigravity 0.1.7** on 2026-07-21.

| Script | Costs | Answers |
|---|---|---|
| `probe_offline.py` | $0, no network | What is in the package? Anthropic reach, policy helpers, `ThinkingLevel`, `VertexEndpoint` env pickup, and what the bundled 99 MB `localharness` Go binary knows about Claude. |
| `probe_vertex.py` | ~59k Flash tokens | Does it actually run? Three escalating variants: plain text → `ThinkingLevel.HIGH` → `run_command` under `allow_all()`. Prints real `UsageMetadata`. |
| `probe_openai_shape.py` | $0, no network | Can the SDK drive a non-Google model? Points it at a local capture server and reads the request it emits. |
| `proxy_anthropic.py` | $0 to run | The fix for what that probe found: a localhost proxy that attaches the `Authorization` header the SDK never sends. Not a MITM gateway — no CA, no Google traffic, no protocol translation. |
| `test_proxy_offline.py` | $0, no network | Rehearses the real SDK through the real proxy into a mock Anthropic. Proves everything on our side of the wire without a key. |
| `test_proxy_live.py` | ~$0.50/run, real | The same path against `api.anthropic.com`. Answers what a mock cannot. |
| `probe_managed_agent.py` | $0 (`--smoke` is metered) | A different question and a different API: is Google's **managed agent** route (Interactions API) reachable on our project? Stdlib only — no venv, no SDK, runs on `/usr/bin/python3`. See [MANAGED-AGENTS.md](../MANAGED-AGENTS.md). |

## Setup

The SDK needs **Python ≥ 3.10**; `/usr/bin/python3` on this Mac is 3.9, which
is why `pip index versions google-antigravity` reports "no matching
distribution" — a misleading false negative, not a missing package.

Homebrew's Python needs one workaround here: its `pyexpat` is linked against a
Homebrew `libexpat` that is not installed, so it falls back to the older system
copy and fails to load. Install it and point the loader at it:

```sh
brew install expat
export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib

/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv sdkprobe
# that venv's ensurepip fails for the same reason — install from the host pip:
/opt/homebrew/opt/python@3.12/bin/python3.12 -m pip \
  --python ./sdkprobe/bin/python install google-antigravity

./sdkprobe/bin/python probe_offline.py
./sdkprobe/bin/python probe_vertex.py        # spends money (Vertex, our project)
./sdkprobe/bin/python probe_openai_shape.py
./sdkprobe/bin/python test_proxy_offline.py   # $0, needs any ANTHROPIC_API_KEY value
./sdkprobe/bin/python test_proxy_live.py      # spends money (real Anthropic)
```

`probe_vertex.py` runs on **our paid** `ai-studies-console` project in
`asia-south1` via ADC — no agy seat, no free tier. It is cheap but not free.

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

## What the probe settled

**Works, verified:** headless autonomy under `policies=[policy.allow_all()]`;
`UsageMetadata` with real `thoughts_token_count` and
`cached_content_token_count`; `ThinkingLevel` measurably changing thinking
spend (29 → 102 thought tokens on an identical prompt); Vertex on our own
project; structured `ToolCall` objects instead of protobuf blobs.

**Does not work:** any authenticated path to Claude. The OpenAI-compatible
endpoint emits the correct protocol but has no `api_key` parameter and sends no
`Authorization` header — so the cell Google asked for by name (Antigravity
harness × Claude) is still not reachable from the SDK *unaided*.

**The workaround, and how far it got:** `proxy_anthropic.py` supplies the
missing header. `test_proxy_offline.py` rehearses it against a mock at $0 and
passes all six checks. `test_proxy_live.py` then ran it against
`api.anthropic.com` for real. Result:

- Anthropic **accepts** Antigravity's 58.8 KB body (identity preamble, 18 tool
  definitions, `tool_choice: auto`) — HTTP 200 on every request.
- A **single turn completes end to end**: `text() == 'PONG'`, Antigravity
  harness driving Claude Opus 4.6.
- The **agent loop dies on turn 2**, and the error text points one level below
  the real cause. Anthropic returns HTTP 400 *"This model does not support
  assistant message prefill. The conversation must end with a user message."*
  Dumping the request shows why the conversation ends that way: Antigravity
  runs the tool locally and appends the **result as an `assistant` message**,
  with no `tool_calls` field anywhere. In the OpenAI protocol a tool result is
  `role: "tool"` carrying a `tool_call_id`. So the compat path does text-based
  pseudo-tool-calling, producing two consecutive assistant turns; permissive
  servers accept it, Anthropic does not. 400 on Opus 4.6 and Sonnet 4.6,
  200 on Haiku 4.5 — no use at our Opus pin. Fixing it from the proxy means
  rewriting the conversation the harness built, which changes what the study
  measures — so we don't.
- `resp.usage_metadata` is **`None`** on this path, where the Vertex path
  returns full token counts. The main reason to prefer the SDK does not reach
  the Claude cell.

```sh
export ANTHROPIC_API_KEY=$(grep -m1 '^ANTHROPIC_API_KEY=' ../../../.env | cut -d= -f2-)
./sdkprobe/bin/python proxy_anthropic.py --port 8787 --dump-file /tmp/exch.txt
# then point the SDK's base_url at http://127.0.0.1:8787   (no /v1 suffix)
```

`--dump-file` is the only way to see what the upstream actually returned: the
SDK swallows a reply it cannot parse and reports a generic "model output"
error, so without it you cannot tell "Anthropic refused" from "Anthropic
answered and Antigravity could not read it".


`--inject-thinking <effort>` additionally injects a thinking parameter, since
the proxy is rewriting the request anyway. This is why the earlier claim that
"the proxy route costs thinking parity" was wrong. It is **unverified** against
the live endpoint and gated behind the flag for that reason.

**Cost note:** a one-word reply carried an **11,554-token** prompt — that is
Antigravity's own identity/tool preamble, charged every turn. Budget a
five-figure prompt floor per turn in any estimate.

## Two API shapes that will waste your afternoon

- `Agent` is an **async context manager and nothing else**. There is no
  `.start()`. `Agent(cfg).chat(...)` raises *"Agent session not started"*.
- `chat()` returns a **lazy** `ChatResponse` — no network request happens until
  you `await resp.resolve()`. `.text()` and `.structured_output()` are
  **methods**; `.thoughts` and `.tool_calls` are **async generators**. Reading
  them as properties returns bound-method objects and looks exactly like an
  empty result. The first run of this probe produced a false negative that way.
- On the OpenAI-compatible path the SDK sets **`stream: true` unconditionally**.
  Reply with a plain non-streaming `chat.completion` body and it is discarded
  in silence, surfacing as *"model output must contain either output text or
  tool calls"* — which reads exactly like a broken endpoint. Answer in SSE.
