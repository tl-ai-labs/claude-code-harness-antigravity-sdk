"""LIVE: Antigravity SDK -> header-injecting proxy -> api.anthropic.com.

This is the one variable test_proxy_offline.py could not rehearse. The offline
run proved everything on our side of the wire (header injection, request
survival, SSE return hop). What it could not answer is whether Anthropic's
OpenAI-compatible endpoint accepts Antigravity's request body verbatim -- 18
tool definitions, tool_choice:auto, and a ~11.5k-token identity preamble
written by Google for a different provider.

THIS SPENDS REAL MONEY, on whatever ANTHROPIC_API_KEY is in your environment --
a METERED API key, not a Max seat (the OAuth token cannot reach this endpoint).
The prompt floor is ~11.5k tokens per turn, so budget roughly $0.06/turn on
Opus 4.6 input pricing. The breaker below is deliberately tight (SDK defect
#5: 1,903 unbounded retries observed) -- raise it only while watching.

Run:
  cd tools/harness-matrix/sdk-probe
  export ANTHROPIC_API_KEY=sk-ant-...
  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib <venv>/bin/python test_proxy_live.py
"""

import asyncio
import os
import subprocess
import sys
import tempfile
import time

import google.antigravity as ag
from google.antigravity.hooks import policy

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_REQUESTS = 6
PROXY_PORT = 8801


async def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY not set")

    proc = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "proxy_anthropic.py"),
         "--port", str(PROXY_PORT), "--max-requests", str(MAX_REQUESTS),
         "--dump-file", "/tmp/exch.txt", "-v"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=os.environ)
    time.sleep(1.5)
    if proc.poll() is not None:
        sys.exit("proxy died:\n" + proc.stdout.read())
    print(f"proxy -> api.anthropic.com  (breaker {MAX_REQUESTS})")

    ws = tempfile.mkdtemp(prefix="proxylive_")
    with open(os.path.join(ws, "canary.txt"), "w") as f:
        f.write("MARKER-7391\n")

    cfg = ag.LocalOpenAIAgentConfig(
        model="claude-opus-4-6",
        base_url=f"http://127.0.0.1:{PROXY_PORT}",
        policies=[policy.allow_all()],
        workspaces=[ws],
        save_dir=os.path.join(ws, "_save"),
    )

    # Same shape as the Vertex probe's variant 3: a task that can only be
    # completed by actually using a tool. If this returns MARKER-7391, then
    # Antigravity's agent loop ran on Claude end to end -- not just a single
    # completion round-tripping, but tool definition -> model tool call ->
    # local execution -> result fed back -> final answer.
    prompt = ("Read the file canary.txt in the workspace using your tools and "
              "reply with only its exact contents.")
    try:
        async with ag.Agent(cfg) as agent:
            resp = await agent.chat(prompt)
            try:
                await asyncio.wait_for(resp.resolve(), timeout=180)
                print(f"\ntext()   : {(await resp.text())!r}")
                calls = [c async for c in resp.tool_calls]
                print(f"tools    : {[getattr(c, 'name', c) for c in calls]}")
                print(f"usage    : {await resp.usage_metadata}")
            except Exception as e:
                print(f"\nresolve(): {type(e).__name__}: {str(e)[:400]}")
    except Exception as e:
        print(f"\nagent    : {type(e).__name__}: {str(e)[:400]}")
    finally:
        proc.terminate()
        try:
            out = proc.stdout.read()
            print("\n--- proxy log ---")
            print("\n".join(out.strip().splitlines()[-8:]))
        except Exception:
            pass


asyncio.run(main())
