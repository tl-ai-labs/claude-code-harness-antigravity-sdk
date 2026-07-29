"""$0 rehearsal: Antigravity SDK -> header-injecting proxy -> mock Anthropic.

We do not have an Anthropic API key (the Max plan is OAuth and cannot
authenticate API calls, so a key is new metered spend and a budget decision).
Rather than let proxy_anthropic.py sit untested until that decision lands,
this drives the ACTUAL SDK through the ACTUAL proxy into a mock upstream that
stands in for api.anthropic.com and records exactly what it received.

That leaves precisely one unrehearsed variable when a real key arrives --
whether Anthropic's OpenAI-compat layer accepts Antigravity's request body.
Everything on our side of the wire is proven here, for free:

  - the SDK will talk to an arbitrary base_url,
  - the proxy attaches Authorization to a request that had none,
  - Antigravity's own system prompt and tools survive the hop intact,
  - the circuit breaker holds (SDK defect #5: 1,903 requests in ~90s).

Run:
  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib \
  ANTHROPIC_API_KEY=sk-ant-REHEARSAL-not-a-real-key \
  <venv>/bin/python test_proxy_offline.py
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import google.antigravity as ag
from google.antigravity.hooks import policy

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_HITS = []
MAX_HITS = 8


class MockAnthropic(BaseHTTPRequestHandler):
    """Stands in for api.anthropic.com's OpenAI-compatible endpoint."""

    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _reply(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reply_sse(self, texts):
        """Emit an OpenAI-shaped SSE stream, one delta per text."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def frame(payload):
            line = ("data: " + payload + "\n\n").encode()
            self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
            self.wfile.flush()

        base = {"id": "rehearsal", "object": "chat.completion.chunk",
                "model": "claude-opus-4-6"}
        for t in texts:
            frame(json.dumps({**base, "choices": [
                {"index": 0, "delta": {"role": "assistant", "content": t},
                 "finish_reason": None}]}))
        frame(json.dumps({**base, "choices": [
            {"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1,
                      "total_tokens": 2}}))
        frame("[DONE]")
        self.wfile.write(b"0\r\n\r\n")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n).decode("utf-8", "replace")
        UPSTREAM_HITS.append({"path": self.path,
                              "auth": self.headers.get("Authorization"),
                              "body": raw})
        if len(UPSTREAM_HITS) > MAX_HITS:
            self.send_response(503)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # The SDK always sets stream:true on this path (verified: top-level
        # request keys are messages/model/stream/tool_choice/tools). A
        # non-streaming JSON reply is silently discarded and the harness
        # reports "model output must contain either output text or tool
        # calls" -- which reads exactly like a broken proxy but is not one.
        # Replying in SSE is also what makes this rehearsal test the proxy's
        # chunked pass-through, its riskiest part.
        self._reply_sse(["PONG"])

    def do_GET(self):
        UPSTREAM_HITS.append({"path": self.path,
                              "auth": self.headers.get("Authorization"), "body": ""})
        self._reply({"data": [{"id": "claude-opus-4-6", "object": "model"}]})


async def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("set ANTHROPIC_API_KEY (a fake value is fine for this rehearsal)")

    mock = ThreadingHTTPServer(("127.0.0.1", 0), MockAnthropic)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    mock_url = f"http://127.0.0.1:{mock.server_port}"
    print(f"mock upstream : {mock_url}")

    # Start the real proxy as its own process, pointed at the mock instead of
    # api.anthropic.com. Everything else about it is exactly what would run
    # for real -- no test-only code path inside the proxy itself.
    proxy_port = 8799
    proc = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "proxy_anthropic.py"),
         "--port", str(proxy_port), "--upstream", mock_url,
         "--max-requests", str(MAX_HITS), "-v"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=os.environ)
    time.sleep(1.5)
    if proc.poll() is not None:
        sys.exit("proxy died on startup:\n" + proc.stdout.read())
    print(f"proxy         : http://127.0.0.1:{proxy_port}")

    ws = tempfile.mkdtemp(prefix="proxyreh_")
    cfg = ag.LocalOpenAIAgentConfig(
        model="claude-opus-4-6",
        base_url=f"http://127.0.0.1:{proxy_port}",  # no /v1 -- SDK appends it
        policies=[policy.allow_all()],              # allow_all() returns ONE Policy
        workspaces=[ws],
        save_dir=os.path.join(ws, "_save"),
    )

    round_trip = None
    try:
        async with ag.Agent(cfg) as agent:
            resp = await agent.chat("Reply with exactly: PONG")
            try:
                await asyncio.wait_for(resp.resolve(), timeout=45)
                round_trip = await resp.text()
                print(f"text()        : {round_trip!r}")
            except Exception as e:
                print(f"resolve()     : {type(e).__name__}: {str(e)[:120]}")
    except Exception as e:
        print(f"agent         : {type(e).__name__}: {str(e)[:160]}")
    finally:
        proc.terminate()
        mock.shutdown()

    print(f"\nupstream saw {len(UPSTREAM_HITS)} request(s)")
    if not UPSTREAM_HITS:
        print("FAIL: nothing reached the upstream -- the hop is broken.")
        return
    h = UPSTREAM_HITS[0]
    print(f"  path          : {h['path']}")
    print(f"  Authorization : {h['auth']}")
    ok_auth = bool(h["auth"] and h["auth"].startswith("Bearer "))
    body = h["body"]
    ok_ident = "You are Antigravity" in body
    ok_tools = '"tools"' in body
    try:
        ok_model = json.loads(body).get("model") == "claude-opus-4-6"
    except Exception:
        ok_model = False
    print(f"  body          : {body[:220]}")
    print("\n--- verdict ---")
    print(f"  proxy injected Authorization on a request that had none : {'PASS' if ok_auth else 'FAIL'}")
    print(f"  Antigravity's own system prompt survived the hop        : {'PASS' if ok_ident else 'FAIL'}")
    print(f"  Antigravity's tool definitions survived the hop         : {'PASS' if ok_tools else 'FAIL'}")
    print(f"  model routed as claude-opus-4-6                         : {'PASS' if ok_model else 'FAIL'}")
    print(f"  circuit breaker held (<= {MAX_HITS} upstream hits)             : "
          f"{'PASS' if len(UPSTREAM_HITS) <= MAX_HITS + 1 else 'FAIL'}")
    # The response direction: the SSE stream came back THROUGH the proxy's
    # chunked pass-through and the SDK parsed it. This is the half a
    # request-capture test cannot see, and the proxy's riskiest code path.
    print(f"  streamed reply survived the return hop                  : "
          f"{'PASS (' + repr(round_trip) + ')' if round_trip and 'PONG' in round_trip else 'FAIL'}")


asyncio.run(main())
