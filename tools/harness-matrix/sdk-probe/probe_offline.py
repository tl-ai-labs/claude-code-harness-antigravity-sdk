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
import re
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
# NOTE ON SHAPE, because the two helpers do not agree and an earlier version
# of this probe assumed they did: allow_all() returns ONE Policy object, while
# confirm_run_command() returns a LIST of them. Calling len() on the first
# raises TypeError, which read as "allow_all is broken" when nothing was
# broken. Print what each actually is instead of assuming a common shape —
# the config accepts either (it coerces a bare Policy into a list), and
# gemini_worker.py passes the list form.
try:
    aa = policy.allow_all()
    shape = f"{len(aa)} policy object(s)" if hasattr(aa, "__len__") else f"one {type(aa).__name__}"
    print(f"  allow_all() -> OK, {shape}: tool={aa.tool!r} decision={aa.decision}")
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
        # The list form, matching how gemini_worker.py grants the real worker.
        policies=[policy.allow_all()],
        workspaces=["/tmp"],
    )
    print("  construction -> OK (config object accepts it)")
    print(f"    model     = {cfg.model!r}")
    print(f"    base_url  = {cfg.base_url!r}")
    # CapabilitiesConfig fields are read off the model rather than named
    # literally: an earlier version of this probe printed a hardcoded
    # `command_execution`, which 0.1.7 does not have, so the AttributeError
    # was caught by the outer handler and reported as "construction FAILED"
    # directly under the line saying construction succeeded. Ask the object
    # what it has, and this stays truthful across SDK versions.
    caps = cfg.capabilities
    fields = list(getattr(type(caps), "model_fields", {})) or [
        a for a in dir(caps) if not a.startswith("_")]
    print(f"    caps      = {', '.join(f'{f}={getattr(caps, f, None)!r}' for f in fields)}")
    # THE FLOOR YOU DID NOT SET. Passing one allow_all() yields FOUR policies:
    # the SDK prepends three `workspace_only` DENY rules covering view_file,
    # create_file and edit_file. Note what is NOT among them — run_command is
    # granted by allow_all() and is not confined by the workspace predicate.
    print(f"  policies after construction ({len(cfg.policies)}, from the 1 passed in):")
    for p in cfg.policies:
        print(f"    {p.name:15s} tool={p.tool:12s} {p.decision}"
              f"{'  when=' + p.when.__name__ if p.when else ''}")
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
# A placeholder, not a real project: this probe never authenticates or calls
# out, it only checks that VertexEndpoint() reads its config from the
# environment. Naming an actual Google Cloud project here would be a real
# identifier sitting in a file that never talks to it — confusing at best, and
# the sort of thing that gets copied into something that DOES talk to it.
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "example-project-id")
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
             "ANTHROPIC_VERTEX", "USE_ANTHROPIC_TOKEN_EFFICIENT_TOOLS_BETA",
             "anthropic.com"]
    for t in terms:
        found = sorted({l.strip() for l in out.splitlines() if t in l})
        print(f"    {t:40s} : {len(found)} match(es)")
        for f in found[:6]:
            print(f"        {f[:100]}")
    # MODEL_CLAUDE_* is reported as EXTRACTED NAMES, not as matching lines.
    # A Go binary's string table is one concatenated blob with no separators
    # between entries, which defeats both obvious approaches:
    #
    #   by line   — one `strings` line can hold a dozen enum names, while other
    #               lines contain the substring inside unrelated text. The
    #               earlier line-based print reported "24 matches" whose first
    #               three entries were shell-error and DevTools strings.
    #   greedy    — `MODEL_CLAUDE_[A-Z0-9_]+` runs straight past the end of the
    #               name into whatever identifier was laid down next, yielding
    #               MODEL_CLAUDE_4_5_HAIKUMODEL_PLACEHOLDER_M100MODEL_… .
    #
    # So the pattern is bounded to the shape these names actually have —
    # generation, family, optional release date, optional THINKING, optional
    # sourcing suffix — which terminates on its own at the seam.
    #
    # The print carries its own completeness check. Every occurrence of the
    # bare prefix should be consumed by one match; if a future SDK ships a
    # name outside this shape, `matched` drops below `prefix occurrences` and
    # the miss is visible instead of silent. Distinct is lower than matched
    # because eight of these names are laid down twice in the table, once
    # standalone and once inside a concatenated run. This list is the evidence
    # for the ladder docs/antigravity-sdk.md cites.
    claude_re = re.compile(
        r"MODEL_CLAUDE_[0-9](?:_[0-9])?_(?:OPUS|SONNET|HAIKU)"
        r"(?:_[0-9]{8})?(?:_THINKING)?"
        r"(?:_OPEN_ROUTER_BYOK|_BYOK|_DATABRICKS)?")
    matched = claude_re.findall(out)
    names = sorted(set(matched))
    occurrences = out.count("MODEL_CLAUDE_")
    complete = "" if len(matched) == occurrences else "  <-- PATTERN MISSED SOME"
    print(f"    {'MODEL_CLAUDE_* names':40s} : {len(names)} distinct, "
          f"{len(matched)} matched of {occurrences} prefix occurrences{complete}")
    for n in names:
        print(f"        {n}")
print("\nDONE (offline, $0)")
