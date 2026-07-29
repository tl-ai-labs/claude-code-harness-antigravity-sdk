"""T-SDK-1 Test B — can the Antigravity SDK drive a non-Google model?

This is the "escape hatch" test for Google ask 3a (Antigravity as the
harness, Claude as the model). The SDK's Python surface has no Anthropic
endpoint, but it does ship `LocalOpenAIAgentConfig`, documented for "any
external OpenAI-compatible completions API (Ollama, LM Studio)". Anthropic
publishes an OpenAI-compatible endpoint, so on paper the hatch is open.

Rather than spend money guessing, this points the SDK at a THROWAWAY LOCAL
HTTP SERVER and captures the exact request it emits. Costs nothing, needs no
API key, and answers both halves of the question:
  - Does it speak the OpenAI protocol Anthropic's compat layer expects?
  - Does it send credentials?

RESULT (2026-07-21, SDK 0.1.7) — see DESIGN.md §2.7a:
  Protocol: YES. Emits POST /v1/chat/completions carrying Antigravity's own
    system prompt ("<identity>You are Antigravity...") and tool definitions.
    The harness is fully intact over a standard protocol.
  Auth:     NO. LocalOpenAIAgentConfig has no api_key parameter, the captured
    request carried no Authorization header, and the bundled localharness
    binary knows only GEMINI_API_KEY / GOOGLE_API_KEY. No authenticated
    third-party provider is reachable.

Two defects this test surfaced, both reported to Google:
  - base_url is not normalised: passing ".../v1" yields "/v1/v1/chat/completions".
    Pass the origin WITHOUT the /v1 suffix.
  - Retries look unbounded: against an endpoint that never satisfies the
    harness, it issued 1,903 requests in ~90 seconds with no visible cap or
    backoff. On a metered endpoint that is a runaway-bill risk. The MAX_HITS
    circuit breaker below exists so this script cannot do that to you.

Run:  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib <venv>/bin/python probe_openai_shape.py
(The DYLD_LIBRARY_PATH is a local Homebrew-Python quirk: pyexpat needs
Homebrew's libexpat, not the older system one. Harmless elsewhere.)
"""

import asyncio
import inspect
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import google.antigravity as ag
from google.antigravity.hooks import policy

# Circuit breaker. The SDK retries without an observable cap, so the catcher
# stops answering after this many hits and the agent starves out instead of
# spinning forever. Raise only if you are watching the run.
MAX_HITS = 12

CAPTURED = []


class Catcher(BaseHTTPRequestHandler):
    """Minimal OpenAI-shaped endpoint that records what it is sent."""

    def _record(self, body=""):
        CAPTURED.append({"path": self.path,
                         "headers": dict(self.headers),
                         "body": body})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        self._record(self.rfile.read(n).decode("utf-8", "replace"))
        if len(CAPTURED) > MAX_HITS:
            self.send_response(503)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "id": "probe", "object": "chat.completion", "model": "probe",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1,
                      "total_tokens": 2},
        }).encode())

    def do_GET(self):
        self._record()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"data":[{"id":"claude-opus-4-6","object":"model"}]}')

    def log_message(self, *a):
        pass


async def main():
    srv = HTTPServer(("127.0.0.1", 0), Catcher)
    port = srv.server_port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ws = tempfile.mkdtemp(prefix="agyoai_")

    # NOTE: no "/v1" on the end — the SDK appends its own. See module docstring.
    cfg = ag.LocalOpenAIAgentConfig(
        model="claude-opus-4-6",
        base_url=f"http://127.0.0.1:{port}",
        policies=[policy.allow_all()],   # allow_all() returns ONE Policy; wrap it
        workspaces=[ws],
        save_dir=os.path.join(ws, "_save"),
    )
    print(f"catcher: http://127.0.0.1:{port}  (breaker at {MAX_HITS} hits)")

    try:
        # Agent is an async context manager and nothing else — there is no
        # .start(); a bare Agent(cfg).chat() raises "session not started".
        async with ag.Agent(cfg) as agent:
            resp = await agent.chat("Say hi.")
            # chat() returns a LAZY ChatResponse: no request is made until
            # resolve() is awaited. Reading .text() first yields nothing.
            try:
                r = resp.resolve()
                await asyncio.wait_for(
                    r if inspect.isawaitable(r) else asyncio.sleep(0), timeout=60)
            except Exception as e:
                print(f"resolve(): {type(e).__name__}")
    except Exception as e:
        print(f"agent: {type(e).__name__}: {str(e)[:200]}")
    finally:
        srv.shutdown()

    print(f"\nrequests emitted: {len(CAPTURED)}")
    for i, c in enumerate(CAPTURED[:2]):
        print(f"[{i}] {c['path']}")
        print(f"    Authorization: {c['headers'].get('Authorization', '(NONE — this is the finding)')}")
        print(f"    body: {c['body'][:300]}")


asyncio.run(main())
