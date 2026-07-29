"""gemini_worker.py — the Gemini worker for the delegated cc×Gemini cell.

WHAT: invoked by the Claude Code driver (via the `gemini-worker` Skill, one
call per delegated task) to do the actual engineering work — read repo code,
write the reproduction, author the fix — on Gemini through the Antigravity SDK
(`google-antigravity`). It replaces the parked `agy` CLI worker (Teja parked
the CLI 2026-07-21); the driver->worker delegation architecture is unchanged
(the driver still shells out once per task and reads the reply on stdout).

WHY the SDK and not the CLI: the CLI printed prose only and reported no usage
numbers, which is why every agy cell recorded `cost_usd: null` and a null model
pin. The SDK returns real `UsageMetadata` — prompt/candidate/thought/cached
token counts and the resolved model — which this script writes to a sidecar the
harness aggregates. That telemetry is the SDK's whole point for the Gemini side.
The Claude side stays blocked (D6: the SDK returns tool results as `assistant`
messages, 400 on Opus/Sonnet) and is deliberately NOT touched here — this worker
only ever serves Gemini, the SDK's verified-working path.

Autonomy: `policies=[policy.allow_all()]` + `run_command` mirrors the CLI
worker's agency (it edits files in the workspace and runs shell commands).
Verified end to end by sdk-probe/probe_vertex.py variant A3.

The call shape (LocalAgentConfig / ModelTarget / VertexEndpoint /
GeminiModelOptions / Agent async-context / resolve()/text()/usage_metadata) is a
faithful port of sdk-probe/probe_vertex.py, which ran live on Vertex and
returned real token counts — not guessed API.

Contract (all args required unless noted):
  --task-file PATH   file holding the driver-composed task description
  --model NAME       SDK model id, e.g. gemini-3.5-flash
  --workdir PATH     the instance workspace (repo checkout) — the worker's only
                     workspace; it edits repo files here. Contract files are the
                     DRIVER's job (written to --out-dir), so the worker never
                     touches the gate-anchored file set directly.
  --out-dir PATH     harness out dir — used only for the usage sidecar + save
  --usage-file PATH  sidecar this worker WRITES: {model, thinking, usage, text}
  --thinking LEVEL   HIGH|MEDIUM|LOW|NONE (default NONE); resolved via getattr
                     so an unknown level fails loudly instead of at import
  --timeout SECONDS  hard cap on resolve() (default 540)

Cost is NOT computed here: token counts are recorded raw; dollar cost is applied
downstream against verified Vertex rates (pricing-preflight discipline), never a
rate hardcoded in the worker.

Runtime env (see sdk-probe/README.md): the `google-antigravity` venv
(Python >= 3.10) and, on this Mac, DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib.
ADC on the paid ai-studies-console project, region asia-south1.
"""
from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import sys

import google.antigravity as ag
from google.antigravity import types
from google.antigravity.hooks import policy

# SDK IDENTITY, recorded into every sidecar (added 2026-07-26).
#
# Until now the run evidence named the Claude Code driver by version
# (manifest.runtime.version) but never named the Antigravity SDK at all —
# a run's artifacts proved "a Gemini model answered", not "the Antigravity
# SDK is what reached it". That is the one claim the whole delegated cell
# exists to demonstrate for Google, so it should not rest on the reader
# trusting the file header. importlib.metadata reads the version from the
# INSTALLED distribution, so a venv rebuilt on a newer SDK reports the newer
# number without anyone remembering to edit a constant.
#
# Wrapped because the dist name can be absent in an editable/vendored
# install: an unknown version must degrade to a string, never take down a
# worker call that was going to succeed. Evidence is worth less than the run.
try:
    from importlib.metadata import version as _dist_version
    SDK_VERSION = _dist_version("google-antigravity")
except Exception:  # not installed as a distribution — record it as unknown
    SDK_VERSION = "unknown"
SDK_NAME = "google-antigravity"

# Region/project default to the same paid target the probe verified. Env wins so
# the harness can retarget without editing code; the region pin matters (the
# global Gemini endpoint was quota-starved 2026-07-16 → policy pins asia-south1).
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "ai-studies-console")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1")
os.environ["GOOGLE_CLOUD_PROJECT"] = PROJECT
os.environ["GOOGLE_CLOUD_LOCATION"] = LOCATION


async def _maybe(v):
    # ChatResponse methods may be sync or awaitable depending on SDK version;
    # probe_vertex.py hit this exact footgun. Await only when awaitable.
    return await v if inspect.isawaitable(v) else v


async def _drain(gen, cap=50):
    # .tool_calls is an ASYNC GENERATOR (not a property) — reading it as an
    # attribute returns a bound method and looks like an empty result (the
    # probe's original false negative). Iterate it.
    out = []
    try:
        async for item in gen:
            out.append(item)
            if len(out) >= cap:
                break
    except Exception:
        pass
    return out


def _thinking_level(name):
    name = (name or "NONE").upper()
    if name in ("", "NONE"):
        return None
    # getattr, not a module-level dict: referencing types.ThinkingLevel.MEDIUM
    # at import time would crash the whole worker if that member does not exist
    # in the installed SDK. Only HIGH is proven (probe); others degrade to a
    # clear error rather than an import failure.
    level = getattr(types.ThinkingLevel, name, None)
    if level is None:
        raise SystemExit(f"gemini_worker: unknown --thinking level {name!r}")
    return level


async def run(args):
    with open(args.task_file, encoding="utf-8") as f:
        task = f.read()

    thinking = _thinking_level(args.thinking)
    opts = types.GeminiModelOptions(thinking_level=thinking) if thinking else None

    cfg = ag.LocalAgentConfig(
        model=types.ModelTarget(
            name=args.model, types=[types.ModelType.TEXT],
            endpoint=types.VertexEndpoint(
                project=PROJECT, location=LOCATION, options=opts),
        ),
        vertex=True, project=PROJECT, location=LOCATION,
        policies=[policy.allow_all()],
        # Single workspace = the repo. The worker edits repo files here; the
        # DRIVER writes the phase contract files into out-dir (the gate anchor
        # is workdir, so a worker writing stray files there would fail gates).
        workspaces=[args.workdir],
        save_dir=os.path.join(args.out_dir, "_gemini_worker_save"),
    )

    text, usage, tool_calls = "", None, []
    async with ag.Agent(cfg) as agent:
        resp = await _maybe(agent.chat(task))
        await asyncio.wait_for(_maybe(resp.resolve()), timeout=args.timeout)
        try:
            text = await _maybe(resp.text())
        except Exception as e:  # never lose the usage numbers over a text error
            text = f"<worker text() error: {type(e).__name__}: {e}>"
        tool_calls = await _drain(resp.tool_calls)
        u = await _maybe(resp.usage_metadata)
        usage = u.model_dump() if hasattr(u, "model_dump") else (dict(u) if u else None)

    # Sidecar the harness reads back (real token counts + resolved model).
    # cost_usd deliberately ABSENT — priced downstream against verified rates,
    # never invented here (pricing-preflight discipline).
    with open(args.usage_file, "w", encoding="utf-8") as f:
        json.dump({
            "model": args.model,
            "thinking": (args.thinking or "NONE").upper(),
            # WHICH CABLE reached that model, and where it executed. Named
            # explicitly so the artifact answers "Antigravity SDK, version X,
            # against Vertex project P in region R" on its own, without the
            # reader inferring it from the script's name. See SDK_VERSION.
            "sdk": SDK_NAME,
            "sdk_version": SDK_VERSION,
            "vertex_project": PROJECT,
            "vertex_location": LOCATION,
            "usage": usage,
            "tool_call_count": len(tool_calls),
            "text": text,
        }, f, indent=2)

    print(text)  # the driver reads the reply on stdout


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--task-file", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--workdir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--usage-file", required=True)
    p.add_argument("--thinking", default="NONE")
    p.add_argument("--timeout", type=int, default=540)
    args = p.parse_args()
    try:
        asyncio.run(run(args))
    except Exception as e:
        # Non-zero exit + reason on stderr so the driver sees the failure and
        # can re-delegate. The honesty meter reads the DRIVER's trajectory (the
        # Bash tool_use that launched us), so a failed worker still counts as a
        # delegation attempt, never as the driver having worked alone.
        print(f"gemini_worker failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
