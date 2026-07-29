/**
 * policy-core.mjs — THE policy engine. One schema, one validator, one router,
 * shared by both surfaces that route work to models.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (2026-07-29)
 * ---------------------------------------------------------------------------
 * Until now the repo had TWO policy layers that did the same job in different
 * words, and neither knew the other existed:
 *
 *   CONSOLE   templates/policies/*.yaml (19 files), loaded by src/loader.ts.
 *             `models[{id, adapter, api, model_name, pricing, …}]` + `rules[]`.
 *             Says WHICH model AND how it is reached.
 *
 *   HARNESS   tools/harness-matrix/policies/*.yaml (4 files), loaded by
 *             kinds/lib.mjs. `models[{id, bindings{}, thinking{}}]` + `phases{}`.
 *             Says WHICH model. Says NOTHING about how it is reached — the
 *             adapter and the API were hardcoded in runtimes.mjs.
 *
 * The second omission is the whole problem. `worker: gemini-3.5-flash` is
 * reached through the Antigravity SDK against Vertex AI, but no policy file
 * says so, so a frozen policy_snapshot.yaml does not record the cable the run
 * actually used — the exact provenance hole src/types.ts documents for the
 * console side, still open on the side where the Antigravity SDK actually runs.
 *
 * The instruction that closed it (Ravi, 2026-07-28) was to "integrate the SDLC
 * policy & Antigravity SDK into ONE policy and rollout code, applicable to all
 * the policies", with opus-plus-flash.yaml as the reference example that
 * "shouldn't lose its structural strength (in terms of rules and models
 * abstraction), rather should be extended to support model + adapter
 * combinations (each having its own id)".
 *
 * So: the console's v2 shape IS the unified shape. Nothing about it changes.
 * It gains two OPTIONAL things the harness needs and the console ignores:
 *
 *   1. COMPOSITION ENTRIES in `models[]`. A delegated cell — an Anthropic
 *      driver in Claude Code's seat orchestrating a Gemini worker over the
 *      Antigravity SDK — is two models reached two ways. Ravi's sentence
 *      applied literally ("each having its own id") makes it a models[] entry
 *      of its own that NAMES two other entries. A rule then points at one id,
 *      exactly as it always did, and the rules abstraction is untouched.
 *
 *   2. `retry` and `limits` top-level blocks. Execution ceilings for a 45-minute
 *      containerised agent phase. The console's unit of work is one API call, so
 *      it has no analog and simply ignores them.
 *
 * `phases{stage → id}` is gone, because it was always a strict subset of
 * `rules[]`: `phases: {execute: cheap, default: premium}` is exactly
 * `rules: [{when:{phase:execute},use:cheap},{default:premium}]`. Deleting it
 * costs nothing and buys the whole matcher — including `retry_count`, which
 * gemini35-plus-25-flash-high.yaml's header records as the escalation rule it
 * "cannot yet express". It can now.
 *
 * ---------------------------------------------------------------------------
 * BACKWARD COMPATIBILITY IS LOAD-BEARING, IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * Every run ever recorded froze its policy as `policy_snapshot.yaml`, and those
 * files ship inside evidence bundles already handed to Google. There are two
 * legacy shapes, and BOTH must keep parsing and keep resolving to exactly the
 * models they resolved to when they were written — forever:
 *
 *   - console v1 (no `api` key): handled as it always was — an absent `api`
 *     means "resolve the doorway the way this adapter always did".
 *   - harness legacy (`phases` + `bindings`): detected by the presence of a
 *     top-level `phases` key and resolved by a compatibility branch that is a
 *     verbatim port of the pre-unification kinds/lib.mjs logic.
 *
 * A legacy file is never rewritten in memory into the new shape. Translating it
 * would mean inventing the adapter and API it never declared, and a guess
 * written into a resolved binding is indistinguishable downstream from a fact.
 * The compatibility branch resolves it and marks the cable `implied` instead.
 *
 * ---------------------------------------------------------------------------
 * WHY PLAIN .mjs AND NOT TypeScript
 * ---------------------------------------------------------------------------
 * The console builds; the harness does not, and must stay publishable as a
 * standalone tree (it is handed to Google as source). A TypeScript core would
 * drag the console's build into that bundle. Authoring the core in plain ESM
 * and letting src/loader.ts re-export it with types costs the console nothing —
 * it already resolves this package's `yaml` dependency the same way.
 */

// ---------------------------------------------------------------------------
// The shared vocabulary. One definition, both surfaces — the same discipline
// audit.mjs uses for bashEditsTree and GUARD_DENIAL_MARK: the block and the
// flag agree because there is only one of them.
// ---------------------------------------------------------------------------

/**
 * Which APIs each adapter can legally reach. Enforced at load time so an
 * impossible pairing (the Antigravity SDK against AI Studio, which it cannot
 * do) fails BEFORE a docker build or any model spend, naming the offending
 * model — never mid-run as an opaque vendor 4xx.
 */
export const ADAPTER_APIS = {
  "builtin-anthropic": ["anthropic"],
  // The MCP Gemini server can authenticate either way: a Gemini API key
  // (AI Studio) or ADC against a Vertex region.
  mcp: ["ai-studio", "vertex"],
  // The Antigravity SDK authenticates through a Gemini Enterprise seat and
  // reaches models on Vertex only; there is no AI Studio path through it.
  "antigravity-sdk": ["vertex"],
  // The Claude Router daemon forwards to whichever vendor endpoint it is
  // configured for, so both are genuinely reachable. The policy still has to
  // SAY which, because the daemon's own configuration is not recorded in the
  // run and would otherwise be another undeclared variable.
  "claude-router": ["ai-studio", "vertex"],
  "builtin-openai-compat": ["openai-compat"],
};

/**
 * Every accepted adapter spelling → its canonical name. Two of these
 * ("gemini", "gemini-thinking") were already dead aliases; "mcp:gemini-flash-
 * server" and "gemini-antigravity" are the names shipped policies and frozen
 * snapshots actually use. One place decides what a name means, so every
 * downstream caller only ever sees canonical values.
 */
export const ADAPTER_ALIASES = {
  "builtin-anthropic": "builtin-anthropic",
  mcp: "mcp",
  "mcp:gemini-flash-server": "mcp",
  gemini: "mcp",
  "gemini-thinking": "mcp",
  "antigravity-sdk": "antigravity-sdk",
  "gemini-antigravity": "antigravity-sdk",
  "claude-router": "claude-router",
  "gemini-claude-router": "claude-router",
  "builtin-openai-compat": "builtin-openai-compat",
};

/** Canonical adapter name for any accepted spelling; undefined if unknown. */
export function normalizeAdapter(raw) {
  return ADAPTER_ALIASES[raw];
}

/**
 * The cable a LEGACY harness binding used but never declared.
 *
 * These are not defaults in the "sensible fallback" sense — they are the
 * hardcoded facts of runtimes.mjs as it stood when those runs executed, written
 * down so a legacy snapshot resolves to the truth rather than to a blank. They
 * apply ONLY to the legacy branch; a unified policy must state its own, and
 * fails to load if it does not.
 *
 * Anything resolved through these is stamped `implied: true`, so a reader can
 * always tell a cable the file declared from one this table supplied.
 */
export const LEGACY_IMPLIED_CABLE = {
  // Claude Code's driver seat is welded to Anthropic and is not routed through
  // any adapter of ours — the CLI talks to Anthropic itself.
  driver: { adapter: "builtin-anthropic", api: "anthropic" },
  // Every delegated worker on record ran gemini_worker.py → google-antigravity
  // → Vertex. asia-south1 is the region policy pins (see the 2026-07-16 global
  // endpoint starvation recorded in all-gemini-flash-high.yaml).
  worker: { adapter: "antigravity-sdk", api: "vertex", region: "asia-south1" },
};

// ---------------------------------------------------------------------------
// Shape predicates
// ---------------------------------------------------------------------------

/**
 * A `models[]` entry that COMPOSES other entries rather than describing a model.
 *
 * `composition: delegated` — {driver, worker}: the cc×agSDK cell.
 * `composition: solo`      — {driver}: one model, but pinned to one runtime.
 *
 * Both carry `runtime`, which is what makes a cell gateable: asking for a
 * runtime no composition in the policy declares is a designed preflight
 * failure, exactly as an absent `bindings[runtime]` was before.
 */
export function isComposition(m) {
  return m != null && typeof m === "object" && m.composition !== undefined;
}

/**
 * True for a pre-unification harness policy — `phases` at the top level.
 *
 * Unambiguous in both directions: the console's Policy has never had a
 * top-level `phases` key (its shape is version/name/models/select/rules), and
 * a harness legacy file cannot load without one.
 */
export function isLegacyHarnessShape(raw) {
  return raw != null && typeof raw === "object" && raw.phases !== undefined;
}

// ---------------------------------------------------------------------------
// Validation — the unified (and console-legacy) shape
// ---------------------------------------------------------------------------

/**
 * Validate and CANONICALISE a policy. Returns the same object, with every
 * `adapter` normalised in place so nothing downstream sees an alias.
 *
 * Ported verbatim from src/loader.ts, message for message — packages/policy's
 * tests pin those strings, and an error a user has learned to recognise is part
 * of the contract. What is new is composition support, and it is additive: a
 * policy with no composition entries validates on exactly the path it did
 * before this file existed.
 */
export function validatePolicy(raw) {
  const r = raw;
  if (!r || typeof r !== "object") throw new Error("Policy: root must be an object");
  if (typeof r.version !== "number") throw new Error("Policy: 'version' (number) required");
  if (typeof r.name !== "string") throw new Error("Policy: 'name' (string) required");
  if (!Array.isArray(r.models) || r.models.length === 0)
    throw new Error("Policy: 'models' (non-empty array) required");
  if (!Array.isArray(r.rules) || r.rules.length === 0)
    throw new Error("Policy: 'rules' (non-empty array) required");

  const version = r.version;
  const models = r.models;

  // PASS 1 — compositions, and the set of leaf ids they consume.
  //
  // Order matters: a leaf reached ONLY as a composition member may omit
  // `pricing`, so the member set has to be known before any leaf is validated.
  // The exemption is deliberate and narrow (see validateModel): the harness
  // prices a run from the worker's actual usage receipts, never from the
  // policy, and writing a made-up price into a file to satisfy a validator is
  // the precise failure the pricing-preflight rule exists to prevent.
  const compositionMembers = new Set();
  for (const m of models) {
    if (!isComposition(m)) continue;
    validateCompositionShape(m);
    compositionMembers.add(m.driver);
    if (m.worker !== undefined) compositionMembers.add(m.worker);
  }

  // PASS 2 — leaf models.
  for (const m of models) {
    if (isComposition(m)) continue;
    validateModel(m, version, { pricingOptional: compositionMembers.has(m.id) });
  }

  // Duplicate ids: v2 asks authors to hand-write one entry per model × adapter
  // × API combination, and a copy-pasted entry whose id was not updated would
  // silently shadow the one before it.
  const modelIds = new Set(models.map((m) => m.id));
  if (modelIds.size !== models.length) {
    const seen = new Set();
    const dup = models.find((m) => (seen.has(m.id) ? true : (seen.add(m.id), false)));
    throw new Error(
      `Policy: duplicate model id '${dup?.id}' — every model × adapter × API combination needs its own id`
    );
  }

  // PASS 3 — a composition's members must exist, and must be leaves.
  //
  // Deferred to here so a composition may be declared above the entries it
  // names, which is how the files actually read best (the cell first, its parts
  // under it). Nesting is refused outright: a composition of compositions has
  // no meaning for any consumer, and left unchecked it is an infinite loop in
  // the resolver rather than a load error.
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const m of models) {
    if (!isComposition(m)) continue;
    for (const [role, id] of [["driver", m.driver], ["worker", m.worker]]) {
      if (id === undefined) continue;
      const target = byId.get(id);
      if (!target) {
        throw new Error(
          `Policy model '${m.id}': ${role} '${id}' is not a model id in this policy. ` +
            `Known: ${[...modelIds].join(", ")}`
        );
      }
      if (isComposition(target)) {
        throw new Error(
          `Policy model '${m.id}': ${role} '${id}' is itself a composition — ` +
            "a composition must name plain model entries, not other compositions"
        );
      }
    }
  }

  // ---- select: logical slots -----------------------------------------------
  const selectKeys = new Set();
  if (r.select !== undefined) {
    if (typeof r.select !== "object" || r.select === null || Array.isArray(r.select)) {
      throw new Error("Policy: 'select' must be a map of logical id → { default, options }");
    }
    for (const [key, slot] of Object.entries(r.select)) {
      if (modelIds.has(key)) {
        throw new Error(
          `Policy select '${key}': collides with a model id — a rule naming it would be ambiguous. ` +
            "Rename the slot or the model."
        );
      }
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        throw new Error(`Policy select '${key}': must be an object with 'default' and 'options'`);
      }
      if (!Array.isArray(slot.options) || slot.options.length === 0) {
        throw new Error(`Policy select '${key}': 'options' (non-empty array of model ids) required`);
      }
      for (const opt of slot.options) {
        if (!modelIds.has(opt)) {
          throw new Error(
            `Policy select '${key}': option '${opt}' is not a model id in this policy. ` +
              `Known: ${[...modelIds].join(", ")}`
          );
        }
      }
      if (typeof slot.default !== "string") {
        throw new Error(`Policy select '${key}': 'default' (one of its own options) required`);
      }
      if (!slot.options.includes(slot.default)) {
        throw new Error(
          `Policy select '${key}': default '${slot.default}' is not among its own options ` +
            `(${slot.options.join(", ")})`
        );
      }
      selectKeys.add(key);
    }
  }

  // ---- rules ---------------------------------------------------------------
  r.rules.forEach((rule, i) => {
    const used = rule.use ?? rule.default;
    if (!used) throw new Error(`Policy rule ${i}: needs 'use' or 'default'`);
    if (!modelIds.has(used) && !selectKeys.has(used)) {
      const known = [...modelIds, ...selectKeys].join(", ");
      throw new Error(
        `Policy rule ${i}: references unknown model or select id '${used}'. Known: ${known}`
      );
    }
  });

  // ---- harness-only blocks, validated only when present --------------------
  // A console policy carries neither and is unaffected. The harness resolver
  // REQUIRES both; that demand belongs there, not here, so one malformed limit
  // does not make a console policy unloadable.
  if (r.retry !== undefined) validateRetry(r.retry);
  if (r.limits !== undefined) validateLimits(r.limits);

  return r;
}

/**
 * Shape checks for a composition entry, run before member ids are known.
 *
 * `runtime` is mandatory even though only one runtime is live today. A cell
 * that does not say which agent runtime it is for cannot be gated, and silent
 * cross-runtime resolution is how a policy ends up describing a run that never
 * happened.
 */
function validateCompositionShape(m) {
  if (typeof m.id !== "string" || m.id.trim() === "") {
    throw new Error("Policy model: composition entry needs a non-empty string 'id'");
  }
  if (m.composition !== "delegated" && m.composition !== "solo") {
    throw new Error(
      `Policy model '${m.id}': composition must be 'delegated' or 'solo', got '${m.composition}'`
    );
  }
  if (typeof m.runtime !== "string" || m.runtime.trim() === "") {
    throw new Error(
      `Policy model '${m.id}': composition needs a non-empty string 'runtime' ` +
        "(which agent runtime this cell is for)"
    );
  }
  if (typeof m.driver !== "string" || m.driver.trim() === "") {
    throw new Error(`Policy model '${m.id}': composition needs a non-empty string 'driver'`);
  }
  if (m.composition === "delegated") {
    if (typeof m.worker !== "string" || m.worker.trim() === "") {
      throw new Error(
        `Policy model '${m.id}': a 'delegated' composition needs a non-empty string 'worker' — ` +
          "use composition 'solo' for a cell with no worker"
      );
    }
  } else if (m.worker !== undefined) {
    throw new Error(
      `Policy model '${m.id}': a 'solo' composition must not name a 'worker' — ` +
        "use composition 'delegated' for a driver→worker cell"
    );
  }
}

function validateModel(m, version, { pricingOptional = false } = {}) {
  const mm = m;
  // Presence AND a value. `key in mm` was the previous check, which a YAML key
  // written with an empty value satisfies — `model_name:` alone parses to null,
  // passed validation, and reached the vendor as an undefined model name.
  const required = pricingOptional
    ? ["id", "adapter", "model_name"]
    : ["id", "adapter", "model_name", "pricing"];
  for (const key of required) {
    if (mm[key] === undefined || mm[key] === null) {
      throw new Error(`Policy model: missing '${key}'`);
    }
  }
  for (const key of ["id", "adapter", "model_name"]) {
    if (typeof mm[key] !== "string" || mm[key].trim() === "") {
      throw new Error(`Policy model '${mm.id}': '${key}' must be a non-empty string`);
    }
  }
  // Present-but-malformed pricing is an error whether or not it was required —
  // the exemption is for OMITTING the block, never for writing a broken one.
  if (mm.pricing !== undefined && mm.pricing !== null) {
    for (const k of ["input", "input_cached", "output"]) {
      if (typeof mm.pricing[k] !== "number") {
        throw new Error(`Policy model '${mm.id}': pricing.${k} must be number`);
      }
    }
  }

  const adapter = normalizeAdapter(mm.adapter);
  if (!adapter) {
    throw new Error(
      `Policy model '${mm.id}': unknown adapter '${mm.adapter}'. ` +
        `Known: ${Object.keys(ADAPTER_ALIASES).join(", ")}`
    );
  }
  mm.adapter = adapter; // canonicalize for every downstream consumer

  // `api` is the whole v2 contract. Absent at v1 means "resolve the doorway the
  // way this adapter always did", which is the only behaviour that leaves the
  // frozen snapshots resolving exactly as they did when written.
  if (mm.api === undefined) {
    if (version >= 2) {
      throw new Error(
        `Policy model '${mm.id}': 'api' is required at version 2 — one of ` +
          `${ADAPTER_APIS[adapter].join(" | ")} for adapter '${adapter}'`
      );
    }
    return;
  }

  const api = mm.api;
  const legal = ADAPTER_APIS[adapter];
  if (!legal.includes(api)) {
    throw new Error(
      `Policy model '${mm.id}': adapter '${adapter}' cannot reach api '${api}'. ` +
        `Legal for this adapter: ${legal.join(" | ")}`
    );
  }

  // Doorway-specific requirements. Each of these today fails at the first API
  // call rather than at load.
  if (api === "vertex" && !mm.region) {
    throw new Error(
      `Policy model '${mm.id}': api 'vertex' requires an explicit 'region'. ` +
        "An unpinned region falls back to the shared global endpoint, which has starved this " +
        "project's quota before (2026-07-16) — pin it so the run is reproducible."
    );
  }
  if (api === "ai-studio" && !mm.auth?.env) {
    throw new Error(
      `Policy model '${mm.id}': api 'ai-studio' requires 'auth.env' naming the API-key variable`
    );
  }
  if (api === "openai-compat" && !mm.endpoint) {
    throw new Error(`Policy model '${mm.id}': api 'openai-compat' requires an 'endpoint'`);
  }
}

function validateRetry(retry) {
  if (retry?.type !== "flat") {
    throw new Error(
      `Policy: retry.type '${retry?.type}' — only 'flat' is implemented in this study; ` +
        "thinking-ladder / model-ladder / cross-model are follow-up policy files (DESIGN §2.3)"
    );
  }
  const n = retry.max_attempts;
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error("Policy: retry.max_attempts must be an integer 1..5");
  }
}

function validateLimits(limits) {
  for (const k of ["phase_timeout_min", "cmd_timeout_min", "phase_budget_usd"]) {
    if (typeof limits?.[k] !== "number" || limits[k] <= 0) {
      throw new Error(`Policy: limits.${k} must be a positive number`);
    }
  }
}

// ---------------------------------------------------------------------------
// Routing — pure matching, shared by the console's router and the harness
// ---------------------------------------------------------------------------

/**
 * Turn whatever a rule named into a concrete model id.
 *
 * A concrete model id passes through untouched and carries no selection trace,
 * which is what keeps every pre-slot policy — and every frozen snapshot —
 * resolving byte-for-byte as it always did.
 */
export function resolveNamed(policy, named, overrides = {}) {
  const slot = policy.select?.[named];
  if (!slot) return { modelId: named };

  const override = overrides[named];
  if (override !== undefined && !slot.options.includes(override)) {
    // Reachable only when the caller skipped validateSelectOverrides. Refuse
    // rather than fall back to the default: a run that silently ignored the
    // gateway it was asked for would produce numbers labelled as the wrong one.
    throw new Error(
      `--select ${named}=${override}: not one of that slot's options (${slot.options.join(", ")})`
    );
  }

  return {
    modelId: override ?? slot.default,
    selection: { logical: named, chosen: override ?? slot.default, overridden: override !== undefined },
  };
}

export function pickModelId(ctx, policy, overrides = {}) {
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    if ("default" in rule) continue; // defaults handled last
    if (matchesRule(rule.when, ctx)) {
      return {
        ...resolveNamed(policy, rule.use, overrides),
        reason: rule.reason ?? `matched rule ${i} (${describeMatcher(rule.when)})`,
        ruleIndex: i,
      };
    }
  }
  for (const rule of policy.rules) {
    if ("default" in rule) {
      return {
        ...resolveNamed(policy, rule.default, overrides),
        reason: rule.reason ?? "fell through to policy default",
        ruleIndex: -1,
      };
    }
  }
  throw new Error(
    `Policy '${policy.name}' has no rule matching ${JSON.stringify(ctx)} and no default rule.`
  );
}

export function matchesRule(matcher, ctx) {
  if (matcher.phase !== undefined && !inSet(matcher.phase, ctx.phase)) return false;
  if (matcher.task_type !== undefined && !inSet(matcher.task_type, ctx.task_type)) return false;
  if (matcher.module !== undefined && !inSet(matcher.module, ctx.module)) return false;
  if (matcher.retry_count !== undefined) {
    const r = ctx.retry_count;
    const m = matcher.retry_count;
    if (m.lt !== undefined && !(r < m.lt)) return false;
    if (m.lte !== undefined && !(r <= m.lte)) return false;
    if (m.gt !== undefined && !(r > m.gt)) return false;
    if (m.gte !== undefined && !(r >= m.gte)) return false;
    if (m.eq !== undefined && !(r === m.eq)) return false;
  }
  return true;
}

function inSet(set, value) {
  return Array.isArray(set) ? set.includes(value) : set === value;
}

function describeMatcher(m) {
  const parts = [];
  for (const k of ["phase", "task_type", "module"]) {
    if (m[k] !== undefined) parts.push(`${k}=${JSON.stringify(m[k])}`);
  }
  if (m.retry_count) parts.push(`retry_count=${JSON.stringify(m.retry_count)}`);
  return parts.join(", ") || "wildcard";
}

// ---------------------------------------------------------------------------
// Harness resolution — one stage list in, one binding per stage out
// ---------------------------------------------------------------------------

/**
 * Resolve every agent stage to the binding the harness executes.
 *
 * THE RETURN SHAPE IS DELIBERATELY UNCHANGED from the pre-unification loader:
 *
 *     { modelId, binding, thinking }
 *
 * where `binding` is a model-name STRING (solo) or `{driver, worker,
 * worker_thinking}` (delegated). Every consumer already reads exactly that —
 * runtimes.mjs, kinds/sdlc.mjs, kinds/swepro.mjs, replay-log.mjs, audit.mjs,
 * logrender.mjs — so keeping it is what confines this whole change to the
 * loader instead of spreading it across the harness. `binding.driver` and
 * `binding.worker` are vendor MODEL NAMES, not policy ids, because that is what
 * gets passed to `claude --model` and to gemini_worker.py --model.
 *
 * One field is ADDED: `cable`, the adapter/API/region for each side. It is
 * additive — nothing that ignores it changes behaviour — and it is what lets a
 * manifest finally record the route a run actually took. For a legacy policy it
 * is marked `implied: true`, because the file never said.
 *
 * `fail` is injected so the caller owns the message prefix (the harness prefixes
 * every policy error with the file path, which is most of its diagnostic value).
 */
export function resolveHarnessStages(policy, { runtime, stages, overrides = {}, fail }) {
  const die = fail ?? ((m) => { throw new Error(m); });

  if (isLegacyHarnessShape(policy)) return resolveLegacyHarnessStages(policy, { runtime, stages, die });

  if (policy.retry === undefined) {
    die("retry block missing — the harness needs retry.type and retry.max_attempts");
  }
  if (policy.limits === undefined) {
    die("limits block missing — the harness needs phase_timeout_min, cmd_timeout_min, phase_budget_usd");
  }

  const byId = new Map(policy.models.map((m) => [m.id, m]));
  const resolved = {};

  for (const stage of stages) {
    // `task_type` mirrors the stage so a rule written against either key
    // matches. The console distinguishes them (a phase runs several task
    // types); the harness has one unit per stage, so they coincide.
    const decision = pickModelId(
      { phase: stage, task_type: stage, module: "", retry_count: 0 },
      policy,
      overrides
    );
    const entry = byId.get(decision.modelId);
    if (!entry) die(`rules resolved stage '${stage}' to unknown model id '${decision.modelId}'`);

    if (isComposition(entry)) {
      if (entry.runtime !== runtime) {
        die(
          `model '${entry.id}' is declared for runtime '${entry.runtime}', not '${runtime}' — ` +
            "this runtime×policy cell is gated (see the comment in the policy file)"
        );
      }
      if (entry.composition === "delegated" && runtime !== "claude-code") {
        die(
          `model '${entry.id}': delegated {driver, worker} cells are claude-code-only — ` +
            "the driver seat is welded to Anthropic and reaches Gemini only by delegating"
        );
      }
      const driver = byId.get(entry.driver);
      const worker = entry.worker ? byId.get(entry.worker) : null;
      resolved[stage] = {
        modelId: entry.id,
        binding: worker
          ? {
              driver: driver.model_name,
              worker: worker.model_name,
              // Omitted, not nulled, when the worker declares no tier: audit.mjs
              // reads an absent worker_thinking as NONE, and Vertex rejects
              // thinking_level outright on 2.5 Flash, so "no key" is a real and
              // load-bearing state rather than a missing value.
              ...(worker.reasoning?.tier ? { worker_thinking: String(worker.reasoning.tier).toUpperCase() } : {}),
            }
          : driver.model_name,
        thinking: driver.reasoning?.effort ?? null,
        cable: cableOf(driver, worker),
      };
    } else {
      // A plain leaf named directly by a rule: runtime-agnostic solo, which is
      // how the console has always used models[] and how an all-one-model
      // harness policy reads most simply.
      resolved[stage] = {
        modelId: entry.id,
        binding: entry.model_name,
        thinking: entry.reasoning?.effort ?? null,
        cable: cableOf(entry, null),
      };
    }
  }

  return { raw: policy, resolved, maxAttempts: policy.retry.max_attempts, limits: policy.limits };
}

/** The declared route for each side of a binding — what a manifest should stamp. */
function cableOf(driver, worker) {
  const side = (m) =>
    m && {
      model_name: m.model_name,
      adapter: m.adapter,
      api: m.api ?? null,
      region: m.region ?? null,
    };
  return { declared: true, driver: side(driver), worker: side(worker) };
}

/**
 * The pre-unification resolver, preserved exactly.
 *
 * This is a verbatim port of kinds/lib.mjs as it stood before 2026-07-29,
 * including its error messages. It exists for one reason: every recorded run
 * froze a policy_snapshot.yaml in this shape, those snapshots ship inside
 * evidence bundles already sent to Google, and replaying one must produce the
 * same bindings it produced on the day it ran. Do not "modernise" it — a change
 * here silently re-bases published numbers.
 *
 * The cable it reports comes from LEGACY_IMPLIED_CABLE and is marked
 * `declared: false`, because the file genuinely did not say.
 */
function resolveLegacyHarnessStages(raw, { runtime, stages, die }) {
  if (raw?.version !== 1) die("version must be 1");
  if (!raw.name || typeof raw.name !== "string") die("name missing");
  if (!Array.isArray(raw.models) || raw.models.length === 0) die("models must be a non-empty list");

  const models = new Map();
  for (const m of raw.models) {
    if (!m?.id || typeof m.id !== "string") die("every model needs a string id");
    if (models.has(m.id)) die(`duplicate model id '${m.id}'`);
    if (typeof m.bindings !== "object" || m.bindings === null) die(`model '${m.id}': bindings missing`);
    if (typeof m.thinking !== "object" || m.thinking === null) die(`model '${m.id}': thinking missing`);
    models.set(m.id, m);
  }

  if (typeof raw.phases !== "object" || raw.phases === null) die("phases missing");
  for (const phase of stages) {
    const id = raw.phases[phase] ?? raw.phases.default;
    if (!id) die(`phases.${phase} missing (and no phases.default fallback)`);
    if (!models.has(id)) die(`phases.${phase} references unknown model id '${id}'`);
  }

  if (raw.retry?.type !== "flat") {
    die(`retry.type '${raw.retry?.type}' — only 'flat' is implemented in this study; ` +
      "thinking-ladder / model-ladder / cross-model are follow-up policy files (DESIGN §2.3)");
  }
  const maxAttempts = raw.retry.max_attempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    die("retry.max_attempts must be an integer 1..5");
  }

  for (const k of ["phase_timeout_min", "cmd_timeout_min", "phase_budget_usd"]) {
    if (typeof raw.limits?.[k] !== "number" || raw.limits[k] <= 0) die(`limits.${k} must be a positive number`);
  }

  const resolved = {};
  for (const phase of stages) {
    const m = models.get(raw.phases[phase] ?? raw.phases.default);
    const binding = m.bindings[runtime];
    if (!binding) {
      die(`model '${m.id}' has no ${runtime} binding — this runtime×policy cell is gated ` +
        "(see the comment in the policy file)");
    }
    const delegated = typeof binding === "object" && binding !== null;
    if (delegated) {
      if (runtime !== "claude-code") {
        die(`model '${m.id}': delegated {driver, worker} bindings are claude-code-only — ` +
          "the driver seat is welded to Anthropic and reaches Gemini only by delegating");
      }
      if (typeof binding.driver !== "string" || !binding.driver.trim()) {
        die(`model '${m.id}': delegated binding needs a non-empty string 'driver' (Anthropic model)`);
      }
      if (typeof binding.worker !== "string" || !binding.worker.trim()) {
        die(`model '${m.id}': delegated binding needs a non-empty string 'worker' (Gemini SDK model id)`);
      }
      if (binding.worker_thinking != null &&
          (typeof binding.worker_thinking !== "string" || !binding.worker_thinking.trim())) {
        die(`model '${m.id}': delegated binding 'worker_thinking' must be a non-empty string ` +
          "(HIGH|MEDIUM|LOW) when present");
      }
    } else if (typeof binding !== "string") {
      die(`model '${m.id}': ${runtime} binding must be a model string or {driver, worker}`);
    }
    resolved[phase] = {
      modelId: m.id,
      binding,
      thinking: m.thinking[runtime] ?? null,
      cable: delegated
        ? {
            declared: false,
            driver: { model_name: binding.driver, ...LEGACY_IMPLIED_CABLE.driver, region: null },
            worker: { model_name: binding.worker, ...LEGACY_IMPLIED_CABLE.worker },
          }
        : {
            declared: false,
            driver: { model_name: binding, ...LEGACY_IMPLIED_CABLE.driver, region: null },
            worker: null,
          },
    };
  }

  return { raw, resolved, maxAttempts, limits: raw.limits };
}
