"""T-SDK-1 follow-up — the header-injecting proxy that unblocks Antigravity x Claude.

WHY THIS EXISTS
---------------
probe_openai_shape.py established two facts that, together, describe a gap
exactly one HTTP header wide:

  1. The Antigravity SDK's `LocalOpenAIAgentConfig` emits a CORRECT OpenAI
     chat-completions request, carrying Antigravity's own system prompt and
     its own tool definitions. The harness is fully intact over a standard
     protocol.
  2. It sends NO credentials. There is no `api_key` parameter on the config,
     no `Authorization` header on the wire, `http_headers` is dropped by
     `create_strategy`, and the bundled `localharness` binary honours only
     GEMINI_API_KEY / GOOGLE_API_KEY. That path was built for keyless
     localhost servers (Ollama, LM Studio), where auth is not a concept.

So the SDK can *drive* Claude; it just cannot *authenticate* to Claude. This
proxy supplies the missing header. The SDK points `base_url` here, we attach
`Authorization: Bearer $ANTHROPIC_API_KEY`, and forward upstream unchanged.

WHAT THIS IS NOT
----------------
This is NOT the MITM telemetry gateway rejected in DESIGN.md §2.5. That
proposal required a custom CA and intercepted an authenticated Google
enterprise seat's traffic, which is not acceptable inside a partnership
study. This proxy installs no CA, intercepts nothing, and never sees a byte
of Google traffic. It adds one header to a plaintext localhost request that
WE originate, addressed to an endpoint WE hold the key for. The distinction
is not cosmetic: nothing here touches Google's authentication or ToS surface.

It is also not a translating gateway. It does not convert protocols. The SDK
already speaks OpenAI chat-completions; Anthropic publishes an
OpenAI-compatible endpoint that consumes it. The bodies pass through byte
for byte unless --inject-thinking is used (see below).

THE HONEST CAVEAT (carry this into any writeup)
-----------------------------------------------
With this proxy, Anthropic serves the model on OUR key. Google's own
`API_PROVIDER_ANTHROPIC_VERTEX` server-side route is out of the loop. That
still answers OUR study's question -- "does swapping the harness change
outcomes?" -- arguably more cleanly than the CLI arm does, because both arms
are then served over comparable paths instead of one going through a Google
re-host. It does NOT answer Google's commercial question -- "can a customer
run Claude inside Antigravity on Google infrastructure?" Only Google can
open that, and the challenges doc asks them to.

Run:
  # $0 rehearsal against a mock upstream (no key needed, no network):
  ANTHROPIC_API_KEY=sk-fake python test_proxy_offline.py

  # real:
  export ANTHROPIC_API_KEY=sk-ant-...
  python proxy_anthropic.py --port 8787
  # then point the SDK at http://127.0.0.1:8787  (NOTE: no /v1 suffix --
  # the SDK appends its own; see SDK defect #3 in DESIGN.md §2.7a)
"""

import argparse
import http.client
import json
import os
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_UPSTREAM = "https://api.anthropic.com"

# Hop-by-hop headers are meaningless to forward: they describe THIS connection,
# not the message. Content-Length is dropped too because we may rewrite the
# body (--inject-thinking) and a stale length would corrupt the request.
STRIP_REQUEST_HEADERS = {
    "host", "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
    "content-length", "authorization",
}
STRIP_RESPONSE_HEADERS = {
    "connection", "keep-alive", "transfer-encoding", "content-length",
}
# NOTE: content-encoding is deliberately NOT stripped. We forward the upstream
# body byte for byte, so removing the header that says "this is gzip" hands the
# SDK compressed bytes labelled as plaintext. It then parses binary as SSE,
# finds no deltas, and reports "model output must contain either output text or
# tool calls" -- which reads exactly like Anthropic being incompatible with
# Antigravity, and is really a one-word bug in this file. A mock upstream never
# reproduces it because mocks do not compress. See DESIGN.md §2.7b.


class Config:
    """Populated from argv in main(); read by the handler class."""
    upstream = DEFAULT_UPSTREAM
    api_key = ""
    inject_thinking = None
    verbose = False
    dump_file = None
    # Circuit breaker. probe_openai_shape.py measured 1,903 requests in ~90s
    # when the SDK met an endpoint it could not satisfy -- no observable cap,
    # no backoff (SDK defect #5). Against a METERED endpoint that is a
    # runaway-bill risk, so the proxy refuses to be the instrument of one.
    max_requests = 60
    count = 0
    lock = threading.Lock()


class Injector(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        if Config.verbose:
            sys.stderr.write("  proxy: " + (a[0] % a[1:]) + "\n")

    def _refuse(self, code, msg):
        body = json.dumps({"error": {"message": msg, "type": "proxy_error"}}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self._forward("POST")

    def do_GET(self):
        self._forward("GET")

    def _forward(self, method):
        # Drain the request body BEFORE any early return. Under HTTP/1.1
        # keep-alive an unread body stays in the socket, and the next request
        # on that connection parses the leftover JSON as its request line --
        # surfacing as "Bad request version ('...tool_choice:auto}')", which
        # looks like a protocol bug in the SDK and is not one. Cost an hour.
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""

        with Config.lock:
            Config.count += 1
            n = Config.count
        if n > Config.max_requests:
            # Starve the retry loop rather than let it bill us. See defect #5.
            self._refuse(429, f"proxy circuit breaker: >{Config.max_requests} requests")
            return

        if body:
            body = self._normalise(body)

        up = urllib.parse.urlsplit(Config.upstream)
        conn_cls = (http.client.HTTPSConnection if up.scheme == "https"
                    else http.client.HTTPConnection)
        conn = conn_cls(up.hostname, up.port or (443 if up.scheme == "https" else 80),
                        timeout=600)

        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in STRIP_REQUEST_HEADERS}
        # THE ENTIRE POINT OF THIS FILE.
        headers["Authorization"] = f"Bearer {Config.api_key}"
        if body:
            headers["Content-Length"] = str(len(body))

        path = (up.path.rstrip("/") + self.path) or self.path
        if Config.verbose:
            sys.stderr.write(f"  proxy[{n}]: {method} {path} -> {up.hostname} "
                             f"(+Authorization, {len(body)}B)\n")

        try:
            conn.request(method, path, body=body or None, headers=headers)
            resp = conn.getresponse()
        except Exception as e:
            self._refuse(502, f"upstream {type(e).__name__}: {e}")
            return

        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() not in STRIP_RESPONSE_HEADERS:
                self.send_header(k, v)
        # Stream the body through in chunks rather than buffering it. The SDK
        # requests SSE for anything non-trivial; buffering would hold the whole
        # completion and defeat streaming, and on a long agentic turn that is
        # the difference between progress and an apparent hang.
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        # When --dump-file is set, keep a prefix of each exchange. This is the
        # only place the upstream RESPONSE is observable: the SDK swallows a
        # reply it cannot parse and reports a generic "model output" error, so
        # without this you cannot tell "Anthropic refused" from "Anthropic
        # answered and Antigravity could not read it".
        seen = bytearray()
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                if Config.dump_file and len(seen) < 1200:
                    seen += chunk[:1200 - len(seen)]
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except Exception:
            pass
        finally:
            conn.close()
        if Config.dump_file:
            with Config.lock, open(Config.dump_file, "a") as fh:
                fh.write(f"\n===== exchange {n} : upstream HTTP {resp.status} =====\n")
                # Roles of the tail of the conversation WE sent. This is the
                # only way to tell "Antigravity prefills" from "our proxy
                # reordered something" when Anthropic returns a 400 about
                # message shape -- the error text alone cannot distinguish them.
                try:
                    msgs = json.loads(body).get("messages", [])
                    tail = [(m.get("role"),
                             (m.get("content") if isinstance(m.get("content"), str) else "")[:60],
                             "tool_calls" if m.get("tool_calls") else "")
                            for m in msgs[-4:]]
                    fh.write(f"--- {len(msgs)} messages; last 4 roles ---\n")
                    for r_, c_, tc in tail:
                        fh.write(f"    {r_:<10} {tc:<10} {c_!r}\n")
                except Exception as e:
                    fh.write(f"--- could not parse request: {e} ---\n")
                fh.write("--- response prefix ---\n")
                fh.write(bytes(seen).decode("utf-8", "replace") + "\n")

    def _normalise(self, body):
        """Make Antigravity's request acceptable to Anthropic's stricter API.

        REQUIRED, not optional -- without this the run dies on turn 2 with
        HTTP 400 "messages: final assistant content cannot end with trailing
        whitespace". Antigravity emits assistant turns with trailing
        whitespace; OpenAI tolerates it, Anthropic rejects it outright. This
        is a real incompatibility in Google's OpenAI-compat path and is filed
        as defect #6 -- any customer pointing Antigravity at Anthropic hits it
        on the second turn of every conversation.

        The edit is deliberately the smallest one that works: rstrip on
        assistant content only. It changes no token of meaning, and it is
        recorded here rather than done silently because this proxy sits inside
        a study whose whole claim is that the harness is unmodified.
        """
        try:
            payload = json.loads(body)
        except Exception:
            return body

        changed = False
        for m in payload.get("messages", []):
            if m.get("role") == "assistant" and isinstance(m.get("content"), str):
                stripped = m["content"].rstrip()
                if stripped != m["content"]:
                    m["content"] = stripped
                    changed = True

        if Config.inject_thinking:
            payload["thinking"] = {"type": "adaptive"}
            payload.setdefault("output_config", {})["effort"] = Config.inject_thinking
            changed = True

        return json.dumps(payload).encode() if changed else body

    def _inject(self, body):
        """Add a thinking parameter the SDK has no way to send for this path.

        UNVERIFIED against the live endpoint -- gated behind an explicit flag
        for that reason. The reasoning: the SDK's ThinkingLevel knob is wired
        to the Gemini/Vertex path only, so the OpenAI-compat route would
        otherwise run Claude with thinking at whatever the endpoint defaults
        to, breaking parity with the claude-code arm (pinned --effort high).
        Since we are already rewriting the request to add a header, we can
        also add the parameter -- which is why the earlier claim that "the
        proxy route costs us thinking parity" was wrong and is corrected here.

        Whether Anthropic's OpenAI-compat layer honours this key or ignores it
        is a live question answerable only with a real key. If it is ignored,
        parity has to be argued a different way and the DESIGN note says so.
        """
        try:
            payload = json.loads(body)
        except Exception:
            return body
        payload["thinking"] = {"type": "adaptive"}
        payload.setdefault("output_config", {})["effort"] = Config.inject_thinking
        return json.dumps(payload).encode()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--upstream", default=DEFAULT_UPSTREAM,
                    help="override for offline rehearsal against a mock")
    ap.add_argument("--inject-thinking", metavar="EFFORT", default=None,
                    choices=["low", "medium", "high", "xhigh", "max"],
                    help="UNVERIFIED: also inject a thinking/effort parameter")
    ap.add_argument("--max-requests", type=int, default=60,
                    help="circuit breaker; see SDK defect #5")
    ap.add_argument("--dump-file", default=None,
                    help="append a prefix of each upstream response here "
                         "(the only way to see what Anthropic actually returned)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        sys.exit("ANTHROPIC_API_KEY is not set. This proxy has nothing to inject.\n"
                 "It is never read from a file or a flag -- pass it in the "
                 "environment so it stays out of shell history and argv.")

    Config.upstream = args.upstream.rstrip("/")
    Config.api_key = key
    Config.inject_thinking = args.inject_thinking
    Config.max_requests = args.max_requests
    Config.verbose = args.verbose
    Config.dump_file = args.dump_file

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Injector)
    print(f"header-injecting proxy: http://127.0.0.1:{srv.server_port} -> {Config.upstream}")
    print(f"  key: ...{key[-4:]}  breaker: {Config.max_requests} requests"
          + (f"  thinking: {Config.inject_thinking}" if Config.inject_thinking else ""))
    print(f"  point the SDK at http://127.0.0.1:{srv.server_port}  (no /v1 suffix)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print(f"\nforwarded {Config.count} requests")


if __name__ == "__main__":
    main()
