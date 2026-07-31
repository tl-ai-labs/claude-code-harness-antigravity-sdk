# The Antigravity SDK: what it does, and what it does not

This harness reaches its worker model through `pip install
google-antigravity`. This page records what that SDK can and cannot do —
at the altitude of *should I build on this*, not *how do I run the
probes*.

Nothing here is asserted. Every claim below is produced by a script in
[../tools/harness-matrix/sdk-probe/](../tools/harness-matrix/sdk-probe/),
most of them at `$0` with no network; that directory's
[README](../tools/harness-matrix/sdk-probe/README.md) is how you re-run
them. Probed against **google-antigravity 0.1.7**, first on 2026-07-21
and re-verified against the same wheel on 2026-07-31.

## The shape of it

The package is a Python surface wrapped around a bundled **Go binary** —
`localharness`, 99.4 MB, which ships inside the wheel. The Python layer
configures and hands off; the agent loop, the tool implementations, and
the permission checks all live in the binary.

Most of what follows is a consequence of that split. The Python surface
is small enough to read in an afternoon and tells you almost nothing
about what the engine is capable of, and the engine is a stripped Go
binary you can only interrogate with `strings`.

## What works

This is the path the harness ships on. The delegated cells run Gemini
through this SDK against Vertex AI, and every worker call writes the
receipt the SDK hands back:

- **Headless autonomy.** `policies=[policy.allow_all()]` runs the agent
  loop with no interactive approval prompt. This is what makes the SDK
  usable as a worker underneath another agent at all — see the floor it
  keeps, below.
- **Real token accounting.** `UsageMetadata` carries
  `thoughts_token_count` and `cached_content_token_count`, not just a
  total. Each delegation writes it straight to a
  `worker-usage-*.json` sidecar, unedited — see
  [understanding-output.md](understanding-output.md).
- **`ThinkingLevel` measurably changes spend.** 29 → 102 thought tokens
  on an identical prompt between two levels. It is a real knob, not a
  label.
- **Vertex against a caller-named project and region**, read from
  `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` through Application
  Default Credentials.
- **Structured `ToolCall` objects**, rather than protobuf blobs you
  parse yourself.

## The permission model has a floor you did not set

`policy.allow_all()` returns a *single* `Policy` — `tool='*'`,
`decision=APPROVE`. But the config does not use it alone. Constructing
any agent config expands the list to **four** policies, three of which
the SDK inserts ahead of yours:

```
Policy(tool='view_file',   decision=DENY,    when=_outside_workspace, name='workspace_only')
Policy(tool='create_file', decision=DENY,    when=_outside_workspace, name='workspace_only')
Policy(tool='edit_file',   decision=DENY,    when=_outside_workspace, name='workspace_only')
Policy(tool='*',           decision=APPROVE, when=None,               name='allow_all')
```

Two things are worth knowing about that floor:

- **File tools stay workspace-confined even under `allow_all()`.** The
  three `workspace_only` rules are prepended whether you ask for them or
  not, and `workspaces` defaults to the process working directory if you
  do not name one.
- **`run_command` is not in that set.** Shell is granted by
  `allow_all()` and is not covered by the workspace predicate. If you
  need a shell confined to a directory, the SDK's policy layer is not
  what confines it. This harness runs the worker with its working
  directory set to the task tree and audits the trajectory afterwards
  rather than relying on the SDK for that boundary — see
  [methodology.md](methodology.md).

## Blocked: any authenticated path to Claude

The SDK cannot drive a Claude model. This is the one cell of the matrix
this repository cannot offer, and it is worth being precise about why,
because the surface evidence points in two opposite directions.

### 1. The engine knows Claude. The Python surface does not.

Of the **55 `.py` files** in the installed package, **zero** contain the
string `anthropic` or `claude` in any case. There is no Anthropic
endpoint class; `types` exports `GeminiAPIEndpoint`, `ModelEndpoint`,
and `VertexEndpoint`.

The Go binary is a different story. `strings` over `localharness` finds
`MODEL_PROVIDER_ANTHROPIC`, `API_PROVIDER_ANTHROPIC_VERTEX`,
`USE_ANTHROPIC_TOKEN_EFFICIENT_TOOLS_BETA`, and **29 distinct
`MODEL_CLAUDE_*` enum names** — a full ladder from
`MODEL_CLAUDE_3_HAIKU_20240307` up through `MODEL_CLAUDE_4_OPUS`,
`MODEL_CLAUDE_4_OPUS_THINKING`, `MODEL_CLAUDE_4_5_SONNET` and
`MODEL_CLAUDE_4_5_HAIKU`, with `_BYOK` and `_OPEN_ROUTER_BYOK` sourcing
variants on many of them and `_DATABRICKS` on the Sonnet 4 entries.

So the engine has first-class Anthropic support — a bring-your-own-key
path, an OpenRouter path, a Databricks path, and, in the separate
`API_PROVIDER_*` enum, an Anthropic-on-Vertex path — and the Python SDK
exposes no way to reach any of it. That is the defect. It is not a
capability gap in the product; it is a capability the wrapper does not
surface.

Two qualifications, so this is not over-read:

- The newest Claude in that enum is the **Claude 4 / 4.5 generation**.
  Nothing 4.6-era appears, which is the generation this harness's anchor
  policy pins. Even a fixed Python surface would not reach the pin
  without an engine update.
- That enum governs the engine's **native** Claude support. It is a
  separate axis from the OpenAI-compatible path below, where `model` is
  a free string forwarded upstream and the enum does not apply.

### 2. The OpenAI-compatible path sends no credential

`LocalOpenAIAgentConfig` is the escape hatch: point it at any
OpenAI-shaped endpoint and it emits a correct-looking request. Its full
parameter list is

```
model, base_url, system_instructions, capabilities, tools, policies,
hooks, triggers, mcp_servers, subagents, workspaces, conversation_id,
save_dir, app_data_dir, response_schema, skills_paths, kwargs
```

There is no `api_key`, and `probe_openai_shape.py` — which points the
SDK at a local capture server and reads back the request it actually
emitted — confirms no `Authorization` header is sent either. Against
any endpoint that requires authentication, the SDK is unaided
unreachable.

### 3. Supply the header yourself and you get exactly one turn

`proxy_anthropic.py` is the smallest possible fix: a localhost proxy
that attaches the missing header. No CA, no protocol translation, no
Google traffic. `test_proxy_offline.py` rehearses the real SDK through
the real proxy into a mock Anthropic at `$0` and passes every check;
`test_proxy_live.py` then runs it against `api.anthropic.com`. What
happened:

- Anthropic **accepts** Antigravity's 58.8 KB request body — the
  identity preamble, 18 tool definitions, `tool_choice: auto`. HTTP 200
  on every request.
- **One turn completes end to end.** `text() == 'PONG'`, the Antigravity
  harness driving Claude Opus 4.6.
- **Turn 2 dies**, and the error names a symptom one level below the
  cause. Anthropic returns HTTP 400, *"This model does not support
  assistant message prefill. The conversation must end with a user
  message."* Dumping the request shows why the conversation ends that
  way: Antigravity runs the tool locally and appends **the result as an
  `assistant` message**, with no `tool_calls` field anywhere. In the
  OpenAI protocol a tool result is `role: "tool"` carrying a
  `tool_call_id`. The compat path is doing text-based pseudo-tool-calling
  and producing two consecutive assistant turns. Permissive servers
  accept that; Anthropic does not. **400 on Opus 4.6 and Sonnet 4.6, 200
  on Haiku 4.5** — no use at an Opus pin.

Fixing that from the proxy would mean rewriting the conversation the
harness built, which changes what a study measures. So it is left alone,
and the cell stays unbuilt.

### 4. No usage metadata on that path either

`resp.usage_metadata` is **`None`** over the OpenAI-compatible path,
where the Vertex path returns full counts. The single strongest reason
to prefer this SDK — that it hands you real token accounting — does not
survive the trip to a non-Google model.

### 5. No thinking knob on that path either

`ThinkingLevel` has five levels (`minimal`, `low`, `medium`, `high`,
`extra_high`) and is set through `GeminiModelOptions` on a Gemini or
Vertex endpoint. `LocalOpenAIAgentConfig` has no thinking parameter at
all — see its parameter list above. Thinking parity between a Gemini
cell and a hypothetical Claude cell is therefore not expressible on this
path, which for a comparative study is disqualifying on its own.

## The prompt floor: 11,554 tokens per turn

A one-word reply carried an **11,554-token prompt**. That is
Antigravity's own identity preamble plus its 18 tool definitions, re-sent
every turn and charged every turn. It is not reducible from the caller's
side.

Budget a five-figure prompt floor per turn in any estimate that involves
this SDK. On a short task it dominates; the delegation is worth its
price on work long enough to amortise it, which is exactly the shape
[policies.md](policies.md) argues for.

## Three API shapes that will waste your afternoon

- **`Agent` is an async context manager and nothing else.** There is no
  `.start()`. `Agent(cfg).chat(...)` raises *"Agent session not
  started"*.
- **`chat()` returns a lazy `ChatResponse`.** No network request happens
  until you `await resp.resolve()`. `.text()` and `.structured_output()`
  are **methods**; `.thoughts` and `.tool_calls` are **async
  generators**. Read them as properties and you get bound-method objects,
  which looks exactly like an empty result. The first run of this probe
  produced a false negative that way.
- **The OpenAI-compatible path sets `stream: true` unconditionally.**
  Answer with a plain non-streaming `chat.completion` body and it is
  discarded in silence, surfacing as *"model output must contain either
  output text or tool calls"* — which reads exactly like a broken
  endpoint. Answer in SSE.

## What this leaves for the matrix

Two harnesses, each of which can in principle drive either model family,
is a 2×2. This repository ships one row of it:

| | Claude worker | Gemini worker |
|---|---|---|
| **Claude Code driver** | `all-opus` — shipped, and runs no SDK code at all | the three delegated policies — shipped |
| **Antigravity driver** | **blocked upstream** — §§2–5 above | **not blocked, just unwritten** |

The two empty cells are not the same kind of empty, and collapsing them
misrepresents Google's product. Antigravity driving *Claude* is blocked
by the SDK defects on this page and cannot be built from outside.
Antigravity driving *Gemini* is not blocked by anything — that exact
pair already runs on every delegated cell one rung down, as the worker.
Promoting it to the driver seat means writing an adapter that owns the
stage sequence and writes its contract files outside the workdir, which
`workspaces=[…]` does not do for free. That is unwritten work, not a
wait on Google.

The same distinction is recorded at the code site that would hold such an
adapter, `tools/harness-matrix/runtimes.mjs`, so it is not lost the next
time someone asks why the registry has one entry.

## Reproducing all of this

[../tools/harness-matrix/sdk-probe/README.md](../tools/harness-matrix/sdk-probe/README.md)
— which script answers which question, what each costs, and the setup
each needs. The offline ones need no credentials and no network.
