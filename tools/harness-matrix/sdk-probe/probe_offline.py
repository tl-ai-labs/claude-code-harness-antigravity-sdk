"""T-SDK-1 offline probe. Zero network, zero spend.

Answers, against the INSTALLED 0.1.7 wheel (not the hand-extracted copy):
  1. Is there any Anthropic/Claude reach in the Python surface?
  2. Does policy.allow_all() exist (headless autonomy)?
  3. Does LocalOpenAIAgentConfig accept an Anthropic base_url (the escape hatch)?
  4. Is ThinkingLevel settable through a real config object?
  5. Does VertexEndpoint pick up our project/location from env?
  6. What does the bundled localharness binary know about Anthropic?
"""

import glob
import os
import pathlib
import subprocess

import google.antigravity as ag
from google.antigravity import types
from google.antigravity.hooks import policy

SP = pathlib.Path(ag.__file__).parent


def head(n):
    print(f"\n{'='*66}\n{n}\n{'='*66}")


head("1. Anthropic/Claude reach in the Python surface")
hits = []
for p in SP.rglob("*.py"):
    try:
        t = p.read_text(errors="ignore").lower()
    except Exception:
        continue
    if "anthropic" in t or "claude" in t:
        hits.append(p.relative_to(SP))
print(f"  .py files scanned : {len(list(SP.rglob('*.py')))}")
print(f"  files mentioning anthropic/claude : {len(hits)}  {hits}")
endpoints = [n for n in dir(types) if n.endswith("Endpoint")]
print(f"  endpoint classes exported : {endpoints}")

head("2. policy.allow_all() — headless autonomy")
print(f"  policy exports : {[n for n in dir(policy) if not n.startswith('_')]}")
try:
    aa = policy.allow_all()
    print(f"  allow_all() -> OK, {len(aa)} policy object(s)")
except Exception as e:
    print(f"  allow_all() -> FAILED: {e!r}")
try:
    dflt = policy.confirm_run_command()
    print(f"  confirm_run_command() (the DEFAULT) -> {len(dflt)} policy object(s)")
except Exception as e:
    print(f"  confirm_run_command() -> FAILED: {e!r}")

head("3. LocalOpenAIAgentConfig with an Anthropic base_url (escape hatch)")
try:
    cfg = ag.LocalOpenAIAgentConfig(
        model="claude-opus-4-6",
        base_url="https://api.anthropic.com/v1",
        policies=policy.allow_all(),
        workspaces=["/tmp"],
    )
    print("  construction -> OK (config object accepts it)")
    print(f"    model     = {cfg.model!r}")
    print(f"    base_url  = {cfg.base_url!r}")
    print(f"    caps      = command_execution={cfg.capabilities.command_execution}")
    print("  NOTE: construction proving nothing about the wire. Live test needed.")
except Exception as e:
    print(f"  construction -> FAILED: {type(e).__name__}: {e}")

head("4. ThinkingLevel through a real config")
print(f"  levels : {[l.value for l in types.ThinkingLevel]}")
for backend, ep in (
    ("GeminiAPIEndpoint", types.GeminiAPIEndpoint),
    ("VertexEndpoint", types.VertexEndpoint),
):
    try:
        e = ep(options=types.GeminiModelOptions(thinking_level=types.ThinkingLevel.HIGH))
        print(f"  {backend:18s} thinking_level=HIGH -> OK ({e.options.thinking_level})")
    except Exception as ex:
        print(f"  {backend:18s} -> FAILED: {ex}")
# Is there ANY thinking knob on the OpenAI-compat path?
import inspect
sig = inspect.signature(ag.LocalOpenAIAgentConfig.__init__)
print(f"  LocalOpenAIAgentConfig params : {[p for p in sig.parameters if p != 'self']}")
print("  -> thinking knob on the OpenAI-compat path?",
      "YES" if any("think" in p for p in sig.parameters) else "NO")

head("5. VertexEndpoint env pickup")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "ai-studies-console")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "asia-south1")
v = types.VertexEndpoint()
print(f"  VertexEndpoint() -> project={v.project!r} location={v.location!r}")
try:
    v.validate_endpoint()
    print("  validate_endpoint() -> OK (config-level; no auth check yet)")
except Exception as e:
    print(f"  validate_endpoint() -> {e}")

head("6. Bundled localharness binary")
bins = glob.glob(str(SP / "**" / "localharness*"), recursive=True)
for b in bins:
    sz = os.path.getsize(b) / 1e6
    print(f"  {b.replace(str(SP), '<sdk>')}  ({sz:.1f} MB)")
    try:
        out = subprocess.run(["strings", "-n", "8", b], capture_output=True,
                             text=True, timeout=180).stdout
    except Exception as e:
        print(f"    strings failed: {e}")
        continue
    terms = ["MODEL_PROVIDER_ANTHROPIC", "API_PROVIDER_ANTHROPIC",
             "ANTHROPIC_VERTEX", "MODEL_CLAUDE", "anthropic.com"]
    for t in terms:
        found = sorted({l.strip() for l in out.splitlines() if t in l})
        print(f"    {t:26s} : {len(found)} match(es)")
        for f in found[:6]:
            print(f"        {f[:100]}")
print("\nDONE (offline, $0)")
