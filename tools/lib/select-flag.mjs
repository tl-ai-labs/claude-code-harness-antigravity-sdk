/**
 * `--select <slot>=<model-id>` — the run-time switch that picks WHICH model ×
 * adapter × API combination a policy's slot resolves to.
 *
 * WHY THIS FILE EXISTS. Three runners (run-brief, run-swe, run-swe-pro) all
 * launch runs against the same API and all need this flag to mean exactly the
 * same thing. Parsing it three times is how the three copies drift — which is
 * the same failure mode that produced four near-identical opus-plus-flash*
 * policy files, collapsed on 2026-07-28.
 *
 * WHY A FLAG RATHER THAN A POLICY EDIT. Editing a policy file to change which
 * gateway it uses silently re-bases every run already exported from that file
 * (DESIGN §2.4: a run's numbers are only interpretable against the policy that
 * produced them). Every exported run freezes its own policy_snapshot, so a run
 * from last week keeps its snapshot — but a file edited today makes the NAME
 * `opus-plus-flash` mean two different things across the archive. The choice
 * therefore has to live on the run, not in the file.
 *
 * REPEATABLE, one slot per occurrence:
 *   --select gemini-flash=flash-agsdk-vertex
 *   --select gemini-flash=flash-mcp-ai-studio --select judge=opus
 *
 * The values are NOT checked here. Whether a slot exists and whether a model id
 * is one of its options is a question about the policy, and the policy lives on
 * the API side — `validateSelectOverrides` answers it there, before the run
 * spends anything, and reports the legal options in the error. Duplicating that
 * check here would mean parsing policy YAML in three CLIs to produce a second,
 * separately-maintained error message for the same mistake.
 */

/**
 * Collect every `--select k=v` occurrence in an argv slice.
 *
 * @param {string[]} args  argv after the script name (i.e. process.argv.slice(2)).
 * @returns {Record<string, string>} slot → model id. Empty when the flag is absent,
 *   which is what makes every pre-slot invocation keep its exact old behaviour:
 *   an empty object means "every slot takes its declared default".
 * @throws {Error} on a malformed occurrence — a missing value, a missing `=`, or an
 *   empty side. Throwing beats skipping: a run launched with a silently-dropped
 *   `--select` produces real numbers labelled with the wrong gateway, and nothing
 *   downstream can tell that from a correct run.
 */
export function parseSelectFlags(args) {
  const overrides = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--select") continue;
    const pair = args[i + 1];
    if (!pair || pair.startsWith("--")) {
      throw new Error("--select needs a value: --select <slot>=<model-id>");
    }
    // indexOf, not split: a model id may not contain "=", but splitting on all
    // of them would turn a typo like `a=b=c` into a silent `a` → `b`.
    const eq = pair.indexOf("=");
    if (eq <= 0 || eq === pair.length - 1) {
      throw new Error(`--select ${pair}: expected <slot>=<model-id> (e.g. gemini-flash=flash-agsdk-vertex)`);
    }
    const slot = pair.slice(0, eq).trim();
    const chosen = pair.slice(eq + 1).trim();
    if (!slot || !chosen) {
      throw new Error(`--select ${pair}: expected <slot>=<model-id> (e.g. gemini-flash=flash-agsdk-vertex)`);
    }
    if (overrides[slot] !== undefined && overrides[slot] !== chosen) {
      // Last-one-wins would be a coin toss over which gateway the run measured.
      throw new Error(
        `--select ${slot}: given twice with different values ('${overrides[slot]}' and '${chosen}') — a slot takes one model`
      );
    }
    overrides[slot] = chosen;
  }
  return overrides;
}

/** One-line human summary for launch logs; "" when nothing was pinned. */
export function describeSelect(overrides) {
  const pairs = Object.entries(overrides);
  return pairs.length === 0 ? "" : pairs.map(([k, v]) => `${k}=${v}`).join(" ");
}
