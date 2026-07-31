#!/usr/bin/env python3
"""
probe_managed_agent.py — T-MA-1: is Google's Managed Agents / Interactions API
reachable from OUR project, and can it host a harness?

WHY THIS EXISTS
---------------
On 2026-07-20 Sanjit Mehta (Google) told Kiran and Teja that the CLI is a
non-starter for enterprise InfoSec, and floated a third option beyond
"MCP tool / router proxy" and "Antigravity SDK": the *Interactions API* with
*Managed Agents* — Google deploying a containerised agent on your behalf, with
an Antigravity container among the ones they ship. Teja then asked us to read
those docs and say what, if anything, we can use.

Documentation answers "what is it". Only a request answers "can WE call it, on
OUR project, today". That second question is what this script settles, and it
settles it for $0 — every probe below is designed to be rejected by validation
*before* any agent is scheduled, so nothing is metered.

WHY STDLIB ONLY (no venv, no google-genai)
------------------------------------------
The Antigravity SDK probes in this directory need Python >= 3.10 and a venv
with a Homebrew expat workaround (see README). This script deliberately needs
none of that: it is urllib + a gcloud token, so it runs on /usr/bin/python3
(3.9 on this Mac) with zero setup. The point is that anyone — including someone
at Google reading our report — can re-run it in one command without believing
anything we say about our environment first.

WHAT WE LEARNED RUNNING IT (2026-07-21, on our own Google Cloud project)
------------------------------------------------------------------------
  1. First POST ever made:  400 "Resource setup has just started."
     -> the API provisions per-project resources on first touch. This is a
        transient state, not a permission failure. Re-run.
  2. After provisioning:    400 "Agent interactions must set background to true."
     -> on the Vertex / Gemini Enterprise path, agent interactions are
        ASYNC ONLY. There is no synchronous agent call here. This matters for
        harness design far more than it looks: a harness phase becomes
        submit + poll, not a blocking call.
  3. background=true, fake agent id:  404 "Agent `...` not found."
  4. background=true, real agent id, no input:  400 "Missing input."
     -> step 4 is the one that matters. The request got PAST agent lookup for
        `antigravity-preview-05-2026` and failed on a later field. That is
        positive proof the Antigravity managed agent resolves for our project.
  5. background=true, real agent, real input, no `environment`:
        400 "Environment configuration is required for Interaction with this Agent."
     -> a sandbox is MANDATORY for this agent, not defaulted. There is no
        "just answer the question" mode: every interaction provisions a
        container. Good to know before costing anything — the unit of spend is
        an agent session in a container, not a model call.

  Net: no seat, no CLI, no entitlement ticket, no allowlist. Plain ADC on our
  own paid project. That is a materially lower InfoSec footprint than either
  the agy CLI (parked) or the pip SDK, which is precisely the axis Google and
  Kiran said was blocking adoption.

WHAT --smoke RETURNED (2026-07-21, one metered interaction)
-----------------------------------------------------------
Task: "Print the string OK and nothing else."  Answer: "OK".  Submit returned
HTTP 200 with a handle; one GET later the interaction was `completed`.

  usage: total_tokens 6894 = input 6544 + output 4 + thought 346

  1. `usage` IS returned, itemised by modality, and it reconciles exactly. It
     also breaks out `total_thought_tokens` separately. This was the gate that
     mattered: the agy CLI was parked partly for reporting no usage at all, and
     a second unmeasurable surface would have closed this route outright.
  2. The task was ~8 tokens; we were billed 6,544 input. So ~6,536 tokens is
     the agent's own system prompt + tool definitions, charged EVERY
     interaction. (The Antigravity CLI turn measured in DESIGN carried 11,554 —
     lighter here, same disease.) This number is why MANAGED-AGENTS §5 scopes
     the useful application down to one orchestrator phase: it exceeds a whole
     TaskPacket, which is capped at maxInputTokens 4000.
  3. `steps[]` exposes the internal tool calls — here `provision_sandbox`, then
     `user_input`, then `model_output`. An agent that iterated internally would
     therefore show each step, so a delegated loop is NOT opaque. What is lost
     is control, not visibility.
  4. NO cached-token field appears in `usage` — but that is a single-call
     artifact, NOT a verdict on caching. Corrected 2026-07-22 against the
     Interactions API docs: this smoke was a single one-off call with nothing
     to cache, so the field is correctly absent. The real picture: the
     autonomous agent self-loops inside ONE interaction (we send one goal, it
     self-corrects internally — test, patch, re-test — with no chain of
     interactions for us to drive), and Google's IMPLICIT caching covers that
     agent's own internal context re-reads across its internal loop turns
     automatically, at no cost to us. EXPLICIT content-addressed caching is NOT
     yet on the Interactions API beta (it is in the limitations list). The
     earlier "points the unhelpful way" read was wrong; see MANAGED-AGENTS
     §3b/§5c. Residual for Sanjit: does implicit caching also discount the
     ~6,536-token wrapper on the agent's internal turn 2+, or only the task
     history — NOT a multi-turn `previous_interaction_id` chain we would drive.
  5. `environment_id` comes back, so a sandbox can be reused for a next turn.

  NOT settled: `agent_config.max_total_tokens` was never exercised (we do not
  set it), so the doc contradiction about it stands. And the sandbox's COMPUTE
  charge is absent from the response entirely — model tokens alone are ~$0.003
  at our Flash rates, but a Linux container was provisioned and that lands on
  the billing console. Do not cost a per-delegation container off `usage`.

WHAT IT DOES NOT PROVE
----------------------
That it is USABLE as our harness. It is not, today, and the reasons are
structural rather than fixable by us — see MANAGED-AGENTS.md. Briefly:
the agent is Gemini-3.5-Flash-only (so it does not reach the Claude cell), and
`environment` has no local option, so it cannot see the sealed SWE-bench Pro
workdir on this machine. Do not read a green probe as a green harness.

USAGE
-----
    python3 probe_managed_agent.py                 # $0 — the four probes above
    python3 probe_managed_agent.py --smoke         # METERED — runs a real agent

--smoke is gated behind an explicit flag and prints a cost warning, because
unlike everything else in this file it actually schedules an agent in Google's
sandbox and is billed to whatever project GOOGLE_CLOUD_PROJECT names.
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# No default project. This file is read and re-run by people outside the team —
# that is its entire purpose — so a hardcoded project ID would give every one of
# them a 403 naming a project they have no relationship with, and would tell any
# reader who skimmed it that the probe is not really re-runnable.
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
if not PROJECT:
    sys.exit(
        "probe_managed_agent: set GOOGLE_CLOUD_PROJECT to your own Google Cloud project.\n"
        "  export GOOGLE_CLOUD_PROJECT=your-gcp-project-id\n"
        "  gcloud auth application-default login\n"
        "  Managed-agent sessions run in a Google-hosted sandbox billed to that project."
    )

# Only `global` is supported for interactions on the Vertex path — a regional
# location (asia-south1, which is what our Gemini policy pins per the
# vertex-gemini-region-quota rule) returns a routing error, not a quota error.
# This is a different axis from the Gemini region pin; do not "fix" it to match.
LOCATION = "global"
BASE = f"https://aiplatform.googleapis.com/v1beta1/projects/{PROJECT}/locations/{LOCATION}"

# The only base agent Google exposes today. Their own docs are explicit:
# "Only antigravity-preview-05-2026 is supported as base_agent." It runs on
# Gemini 3.5 Flash. There is no model parameter — see MANAGED-AGENTS.md §3.
AGENT = "antigravity-preview-05-2026"


def token() -> str:
    """
    Application Default Credentials, not the gcloud user credential.

    Deliberate: on this Mac `gcloud auth print-access-token` currently fails
    with "Reauthentication failed. cannot prompt during non-interactive
    execution", while ADC is still valid. ADC is also what the SDK path uses,
    so probing with it tests the same credential our code would actually use.
    """
    try:
        out = subprocess.run(
            ["gcloud", "auth", "application-default", "print-access-token"],
            capture_output=True, text=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as err:
        sys.exit(
            "Could not obtain an ADC token. Run:\n"
            "    gcloud auth application-default login\n"
            f"underlying error: {err}"
        )
    return out.stdout.strip()


def post(body: dict, tok: str) -> tuple[int, dict]:
    """POST to the interactions collection and return (status, parsed_body).

    Errors are returned rather than raised: for this script a 400 or 404 IS the
    result we are after, so treating them as exceptions would throw away the
    finding. `x-goog-user-project` is required because ADC bills quota to a
    project chosen by header, not by the URL path.
    """
    req = urllib.request.Request(
        f"{BASE}/interactions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {tok}",
            "x-goog-user-project": PROJECT,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, {"raw": raw.decode(errors="replace")}


def message(payload: dict) -> str:
    """Pull the human-readable error out of either error envelope shape.

    The Interactions API returns two different error shapes depending on how
    far the request got: the standard Google API envelope
    ({"error": {"message", "status"}}) for transport/auth failures, and a
    terser OpenAI-ish one ({"error": {"message", "code"}}) once the request
    reaches the interactions service itself. Handle both or you will print
    "None" for half the interesting cases.
    """
    if isinstance(payload, list):                     # some errors arrive wrapped
        payload = payload[0] if payload else {}
    err = payload.get("error", payload)
    return str(err.get("message", json.dumps(err)[:200]))


def free_probes(tok: str) -> None:
    """The four $0 probes. Each is rejected before an agent is scheduled."""
    probes = [
        (
            "1. sync agent call (no `background`)",
            {"agent": AGENT, "input": [{"type": "user_input", "content": "ping"}]},
            "expect 400 'must set background to true' -> agent calls are async-only here",
        ),
        (
            "2. unknown agent id",
            {"agent": "definitely-not-a-real-agent-000", "background": True,
             "input": [{"type": "user_input", "content": "ping"}]},
            "expect 404 'not found' -> proves agent ids are really resolved, so probe 3 means something",
        ),
        (
            "3. real agent id, missing input",
            {"agent": AGENT, "background": True},
            "expect 400 'Missing input' -> THE RESULT: got past agent lookup, so this agent exists for us",
        ),
        (
            "4. valid agent + background + input, but no `environment`",
            {"agent": AGENT, "background": True,
             "input": [{"type": "user_input", "content": "ping"}]},
            "expect 400 'Environment configuration is required' -> a sandbox is MANDATORY, "
            "not defaulted; there is no 'just answer me' mode for this agent",
        ),
    ]
    for name, body, why in probes:
        status, payload = post(body, tok)
        print(f"\n{name}\n    why: {why}\n    -> HTTP {status}: {message(payload)}")

    print(
        "\nIf probe 3 returned 'Missing input' rather than 404/403, the Antigravity\n"
        "managed agent is reachable on this project with plain ADC: no seat, no CLI,\n"
        "no entitlement request. If it returned 'Resource setup', the project is still\n"
        "provisioning on first touch — wait a moment and re-run."
    )


def smoke(tok: str) -> None:
    """A real, METERED agent run. Gated behind --smoke on purpose.

    Kept minimal (a one-line task, a fresh remote sandbox) because the goal is
    only to confirm the submit/poll shape and to see which usage fields come
    back — not to benchmark anything. Any real measurement belongs in the
    harness, under a policy, with a manifest.
    """
    print("METERED: this schedules a real agent in Google's sandbox, billed to "
          f"{PROJECT}.\n")
    status, payload = post(
        {
            "agent": AGENT,
            "background": True,
            "environment": {"type": "remote"},
            "input": [{"type": "user_input",
                       "content": "Print the string OK and nothing else."}],
        },
        tok,
    )
    print(f"HTTP {status}\n{json.dumps(payload, indent=2)[:2000]}")
    if status < 300:
        print(
            "\nSubmitted. Because this path is background-only, the response is a\n"
            "handle, not an answer: poll GET {BASE}/interactions/<id> until status\n"
            "leaves 'in_progress', then read `usage` for token accounting and\n"
            "`environment_id` if you want to reuse the same sandbox for a next turn."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true",
                        help="run a real, metered agent interaction")
    args = parser.parse_args()

    tok = token()
    print(f"project={PROJECT} location={LOCATION} agent={AGENT}")
    if args.smoke:
        smoke(tok)
    else:
        free_probes(tok)


if __name__ == "__main__":
    main()
