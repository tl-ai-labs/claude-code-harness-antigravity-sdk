"""T-SDK-1 Test A v2 — Vertex/Gemini on our paid project, stepwise.

Fixes from v1: ChatResponse.text/.structured_output are METHODS (call them);
.thoughts/.tool_calls are ASYNC GENERATORS (iterate them). v1 printed the
bound method objects and drew no conclusion.

Runs three escalating variants so a failure localizes to one cause:
  A1 plain text, no thinking, no tools   -> is Vertex auth + model id OK?
  A2 same + ThinkingLevel.HIGH           -> does thinking populate?
  A3 same + run_command under allow_all  -> does headless autonomy work?
Each variant is hard-timeboxed. Prompts are trivial; spend is fractions of a cent.
"""

import asyncio
import inspect
import os
import pathlib
import sys
import tempfile

import google.antigravity as ag
from google.antigravity import types
from google.antigravity.hooks import policy

os.environ["GOOGLE_CLOUD_PROJECT"] = "ai-studies-console"
os.environ["GOOGLE_CLOUD_LOCATION"] = "asia-south1"

PROJECT, LOCATION = "ai-studies-console", "asia-south1"


async def maybe(v):
    return await v if inspect.isawaitable(v) else v


async def drain(gen, cap=3):
    """Collect from an async generator (thoughts / tool_calls)."""
    out = []
    try:
        async for item in gen:
            out.append(item)
            if len(out) >= cap:
                break
    except Exception as e:
        out.append(f"<gen error {type(e).__name__}: {e}>")
    return out


async def variant(tag, *, model, thinking, use_tools, timeout=180):
    print(f"\n{'='*66}\n{tag}\n{'='*66}", flush=True)
    ws = tempfile.mkdtemp(prefix="agyv_")
    pathlib.Path(ws, "canary.txt").write_text("MARKER-7391\n")

    opts = types.GeminiModelOptions(thinking_level=thinking) if thinking else None
    cfg = ag.LocalAgentConfig(
        model=types.ModelTarget(
            name=model, types=[types.ModelType.TEXT],
            endpoint=types.VertexEndpoint(project=PROJECT, location=LOCATION,
                                          options=opts),
        ),
        vertex=True, project=PROJECT, location=LOCATION,
        policies=[policy.allow_all()],
        workspaces=[ws],
        save_dir=os.path.join(ws, "_save"),
    )
    prompt = ("Run the shell command `cat canary.txt` and reply with ONLY the "
              "marker string." if use_tools else
              "Reply with exactly the single word: PONG")
    print(f"  model={model} thinking={thinking} tools={use_tools}")
    print(f"  prompt: {prompt}")

    # Agent is an async context manager — `async with` is the ONLY supported
    # way to start a session. Calling .chat() on a bare Agent() raises
    # "Agent session not started". There is no .start() method.
    try:
        async with ag.Agent(cfg) as agent:
            resp = await maybe(agent.chat(prompt))
            try:
                await asyncio.wait_for(maybe(resp.resolve()), timeout=timeout)
                print("  resolve() -> OK")
            except asyncio.TimeoutError:
                print(f"  resolve() -> TIMEOUT after {timeout}s")
            except Exception as e:
                print(f"  resolve() -> {type(e).__name__}: {str(e)[:300]}")

            try:
                print(f"  text()     : {(await maybe(resp.text()))!r}"[:400])
            except Exception as e:
                print(f"  text()     : {type(e).__name__}: {str(e)[:200]}")
            print(f"  thoughts   : {await drain(resp.thoughts)}"[:400])
            print(f"  tool_calls : {await drain(resp.tool_calls)}"[:500])
            u = await maybe(resp.usage_metadata)
            print(f"  >>> UsageMetadata : {u.model_dump() if hasattr(u,'model_dump') else u!r}")
    except Exception as e:
        print(f"  VARIANT FAILED: {type(e).__name__}: {str(e)[:400]}")


async def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "gemini-3.5-flash"
    await variant("A1 plain text / no thinking / no tools",
                  model=model, thinking=None, use_tools=False)
    await variant("A2 + ThinkingLevel.HIGH",
                  model=model, thinking=types.ThinkingLevel.HIGH, use_tools=False)
    await variant("A3 + run_command under allow_all()",
                  model=model, thinking=types.ThinkingLevel.HIGH, use_tools=True)


asyncio.run(main())
