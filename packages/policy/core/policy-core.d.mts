/**
 * Type surface for the shared policy engine.
 *
 * WHY A HAND-WRITTEN .d.mts AND NOT A COMPILED .ts. The core has to be readable
 * by the harness, which does not build — it is published to Google as a
 * standalone source tree, and a TypeScript core would drag the console's build
 * into that bundle. So the engine is authored as plain ESM and this file gives
 * the console's TypeScript the same types it had when the logic lived in
 * loader.ts. The two are kept in step by packages/policy's own suites: every
 * console test still runs through src/loader.ts, which is now a thin wrapper,
 * so a signature that drifts from reality fails typecheck or a test.
 *
 * The types here are DELIBERATELY looser than src/types.ts in one respect: the
 * core also serves the harness, whose policies carry `retry` and `limits` that
 * the console's Policy interface has never had. Those appear as optional here
 * and are simply absent from the console's own view of the same object.
 */

export type AdapterName =
  | "builtin-anthropic"
  | "mcp"
  | "antigravity-sdk"
  | "claude-router"
  | "builtin-openai-compat";

export type ModelApi = "anthropic" | "ai-studio" | "vertex" | "openai-compat";

export declare const ADAPTER_APIS: Record<AdapterName, readonly ModelApi[]>;
export declare const ADAPTER_ALIASES: Record<string, AdapterName>;

/** The adapter/API each side of a LEGACY harness binding actually used. */
export declare const LEGACY_IMPLIED_CABLE: {
  driver: { adapter: AdapterName; api: ModelApi };
  worker: { adapter: AdapterName; api: ModelApi; region: string };
};

export declare function normalizeAdapter(raw: string): AdapterName | undefined;

export declare function isComposition(m: unknown): boolean;
export declare function isLegacyHarnessShape(raw: unknown): boolean;

/**
 * Validates and CANONICALISES in place, then returns the same object. Typed as
 * `unknown` in / `any` out because the two surfaces narrow it differently:
 * src/loader.ts casts to the console's `Policy`, the harness keeps it raw.
 */
export declare function validatePolicy(raw: unknown): any;

export interface RoutingContext {
  phase: string;
  task_type?: string;
  module?: string;
  retry_count: number;
}

export interface PickResult {
  modelId: string;
  selection?: { logical: string; chosen: string; overridden: boolean };
  reason?: string;
  ruleIndex?: number;
}

export declare function resolveNamed(
  policy: any,
  named: string,
  overrides?: Record<string, string>
): PickResult;

export declare function pickModelId(
  ctx: RoutingContext,
  policy: any,
  overrides?: Record<string, string>
): PickResult;

export declare function matchesRule(matcher: any, ctx: RoutingContext): boolean;

/** One side of a resolved cable — the route a manifest should stamp. */
export interface CableSide {
  model_name: string;
  adapter: string;
  api: string | null;
  region: string | null;
}

/**
 * The harness's per-stage contract. UNCHANGED from the pre-unification loader
 * except for the additive `cable`: `binding` is a model-name string for a solo
 * run, or `{driver, worker, worker_thinking?}` for a delegated one, and every
 * downstream consumer reads exactly that.
 */
export interface ResolvedStage {
  modelId: string;
  binding: string | { driver: string; worker: string; worker_thinking?: string };
  thinking: string | null;
  cable: { declared: boolean; driver: CableSide | null; worker: CableSide | null };
}

export declare function resolveHarnessStages(
  policy: any,
  opts: {
    runtime: string;
    stages: string[];
    overrides?: Record<string, string>;
    fail?: (msg: string) => never;
  }
): {
  raw: any;
  resolved: Record<string, ResolvedStage>;
  maxAttempts: number;
  limits: { phase_timeout_min: number; cmd_timeout_min: number; phase_budget_usd: number };
};
