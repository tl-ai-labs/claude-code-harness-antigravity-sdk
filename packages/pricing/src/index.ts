/**
 * @study-console/pricing — THE single source of truth for model prices.
 *
 * Operating rule #4: never inline a price anywhere else in this repo.
 * Operating rule #5: all computed costs are integer micro-USD ($1 = 1_000_000).
 *
 * Every entry carries `source` + `as_of` provenance. The predecessor repos
 * held six divergent price tables (including a known ~5x conflict on
 * gemini-3.5-flash); this package exists so that can never re-form.
 *
 * Rates are stored as USD per 1M tokens (the industry-quoted unit).
 * Convenient identity: tokens * usd_per_mtok == micro-USD exactly
 * (1000 tokens at $15/MTok -> 15_000 microUSD = $0.015).
 */

/** Integer micro-USD. $1 = 1_000_000. Never use float dollars. */
export type MicroUsd = number;

// First bumped 2026-07-20, after the Pathfinder payload matrix (T1-6) exposed a
// stale Opus rate: the table carried $15/$75, which is the Claude 3.x-era Opus
// price. GA for the 4.x family has been $5/$25 since the 4.5 generation, so
// every Opus cost this repo had recorded read ~3x high (Gemini/GLM entries were
// and remain correct). Costs are NEVER rewritten in place — each run keeps the
// version that priced it, and a restatement recomputes from stored tokens, so
// the version string is the only thing that makes old numbers interpretable.
// Bump this on every rate change, and never edit rates under an existing stamp.
//
// Bumped again 2026-07-23 for the Gemini side: the Flash cache_read rate was
// 0.075 (input x 0.25) where Google's page says input x 0.1, and the Haiku block
// was still Haiku 3.5's card. Both branches independently corrected Opus to the
// GA rate and reached the same numbers; this is the later stamp, so it wins.
//
// Bumped 2026-07-26 for a change to EFFECTIVE rates rather than table rates:
// the Vertex non-global +10% was being applied to every Gemini model, but
// Vertex scopes it to "Gemini 3 and later families". gemini-2.5-* therefore
// bills the global rate in asia-south1, and every 2.5 cost computed under
// 2026-07-23.1 reads 10% high. The table numbers for 2.5 Flash are unchanged
// (0.30/0.03/2.50, re-verified against the Vertex page the same day) — what
// changed is the multiplier applied to them, which is exactly why the stamp
// has to move: a restatement recomputes from stored tokens, so without a new
// version an old 2.5 figure and a new one are indistinguishable.
export const PRICING_VERSION = "2026-07-26.1";

/**
 * The date the rates in this table were current as of — the DATE PART of
 * PRICING_VERSION, derived rather than restated so the two can never drift.
 * (`pricing.test.ts` already pins PRICING_VERSION to `YYYY-MM-DD.N`, so the
 * split below is guarded by an existing test rather than by hope.)
 *
 * Added 2026-07-29 for the restatement stamp. A restatement's numbers are a
 * function of the RATES and of nothing else — least of all the day an export
 * happened to run. Exporting an unchanged run today and again in September has
 * to produce byte-identical output, or a re-export diff is all noise and no
 * signal, and that diff is the only practical way to answer the one question
 * worth asking before a board is published: did any cost actually move? When
 * the rates genuinely change, PRICING_VERSION bumps and this stamp moves with
 * it — which is exactly, and only, when it should move.
 */
export const PRICING_AS_OF = PRICING_VERSION.split(".")[0] ?? PRICING_VERSION;

/** chars-per-token heuristic used whenever a provider doesn't report usage. */
export const ESTIMATION_METHOD = "chars/3.8";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

export interface ModelPrice {
  model_id: string;
  family: "opus" | "sonnet" | "haiku" | "gemini" | "glm" | "other";
  /** USD per 1M fresh input tokens. */
  input: number;
  /** USD per 1M cache-read tokens. */
  cache_read?: number;
  /** USD per 1M cache-write tokens (Anthropic bills these at 1.25x input). */
  cache_write?: number;
  /** USD per 1M output tokens (reasoning tokens bill at this rate too). */
  output: number;
  source: string;
  as_of: string;
  notes?: string;
}

/**
 * Current GA prices. At-time prices for a run are snapshotted into the run's
 * policy snapshot at execution; this table answers "what would it cost now".
 */
export const PRICES: Record<string, ModelPrice> = {
  // Corrected 2026-07-20: was 15/1.5/18.75/75 — the Claude 3.x-era Opus rate,
  // carried forward when these entries were first written. GA for Opus 4.x is
  // $5 input / $25 output; cache_read is 0.1x input and cache_write 1.25x input
  // per Anthropic's published multipliers, hence 0.5 / 6.25.
  "claude-opus-4-8": {
    model_id: "claude-opus-4-8",
    family: "opus",
    input: 5,
    cache_read: 0.5,
    cache_write: 6.25,
    output: 25,
    source: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    as_of: "2026-07-16",
    notes: "The old 15/1.50/18.75/75 block predated the Opus 4.5 price drop — 3x overstated.",
  },
  "claude-opus-4-7": {
    model_id: "claude-opus-4-7",
    family: "opus",
    input: 5,
    cache_read: 0.5,
    cache_write: 6.25,
    output: 25,
    source: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    as_of: "2026-07-16",
    notes: "The old 15/1.50/18.75/75 block predated the Opus 4.5 price drop — 3x overstated.",
  },
  "claude-sonnet-4-6": {
    model_id: "claude-sonnet-4-6",
    family: "sonnet",
    input: 3,
    cache_read: 0.3,
    cache_write: 3.75,
    output: 15,
    source: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    as_of: "2026-07-08",
  },
  // Corrected 2026-07-20 alongside the Opus fix: was 0.8/4, GA is $1/$5.
  // No run in this repo has used Haiku, so nothing recorded is affected — the
  // entry is fixed so the table stays trustworthy the first time one does.
  "claude-haiku-4-5": {
    model_id: "claude-haiku-4-5",
    family: "haiku",
    input: 1,
    cache_read: 0.1,
    cache_write: 1.25,
    output: 5,
    source: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    as_of: "2026-07-16",
    notes: "The old 0.80/0.08/4.00 block was Haiku 3.5's rate card.",
  },
  "gemini-2.5-flash": {
    model_id: "gemini-2.5-flash",
    family: "gemini",
    input: 0.3,
    cache_read: 0.03,
    output: 2.5,
    source: "https://cloud.google.com/vertex-ai/generative-ai/pricing",
    as_of: "2026-07-26",
    notes:
      "cache_read corrected 0.075 -> 0.03 per Google's page (input x 0.1, not x 0.25). " +
      "Re-verified 2026-07-26 against the VERTEX pricing page ahead of the tiered " +
      "3.5-vs-2.5 SDLC column: Standard tier = 0.30/0.03/2.50, output covers response " +
      "AND reasoning tokens. NO non-global surcharge applies — Vertex scopes the +10% " +
      "regional premium to 'Gemini 3 and later families', so asia-south1 bills 2.5 Flash " +
      "at the global rate (see vertexSurchargeApplies).",
  },
  // Added 2026-07-20 for the Pathfinder payload-logging runs: policies switched
  // from Gemini 3.x to 2.5 models (Teja's ask), and opus-plus-pro's gemini-2.5-pro
  // leg had no entry here — cost math would silently fall back to policy-inline
  // pricing only. Values are the ≤200k-token prompt tier; cache_read is 25% of input.
  "gemini-2.5-pro": {
    model_id: "gemini-2.5-pro",
    family: "gemini",
    input: 1.25,
    cache_read: 0.3125,
    output: 10,
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    as_of: "2026-07-20",
  },
  "gemini-3.5-flash": {
    model_id: "gemini-3.5-flash",
    family: "gemini",
    // Base numbers are the FLAT global-endpoint / AI-Studio rate. Vertex
    // REGIONAL ("non-global") endpoints bill +10% on every token class
    // (see VERTEX_NONGLOBAL_SURCHARGE). Our Gemini worker pins asia-south1
    // because the global endpoint was quota-starved 2026-07-16, so its real
    // billed rate is 1.65 / 9.90 / 0.165 — obtain it via getVertexRates(),
    // never by hand-inlining a x1.10 downstream.
    input: 1.5,
    cache_read: 0.15,
    output: 9,
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    as_of: "2026-07-23",
    notes:
      "Predecessor repos disagreed (CSM runner said 0.10/0.40 — ~10x off). " +
      "Re-verified 2026-07-23 against AI Studio + Vertex: global Standard = 1.5/9/0.15 (confirmed, thinking tokens bill at output rate). " +
      "Vertex non-global (regional) endpoints add +10% effective 2026-07-01 per the Vertex pricing page; " +
      "our asia-south1 worker therefore bills 1.65/9.90/0.165 — apply via getVertexRates(model, location), do not inline.",
  },
  "gemini-3.1-pro": {
    model_id: "gemini-3.1-pro",
    family: "gemini",
    input: 1.25,
    output: 5,
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    as_of: "2026-07-08",
  },
  "glm-5.2": {
    model_id: "glm-5.2",
    family: "glm",
    input: 1.4,
    cache_read: 0.26,
    output: 4.4,
    source: "https://docs.z.ai/guides/overview/pricing",
    as_of: "2026-07-08",
  },
};

export function getPrice(modelId: string): ModelPrice {
  const p = PRICES[modelId];
  if (!p) {
    throw new Error(
      `@study-console/pricing: no price for model '${modelId}'. Known: ${Object.keys(PRICES).join(", ")}`
    );
  }
  return p;
}

export function hasPrice(modelId: string): boolean {
  return modelId in PRICES;
}

/**
 * Vertex AI bills REGIONAL ("non-global") endpoints a flat +10% over the
 * global-endpoint rate, on every token class, effective 2026-07-01. This is a
 * real sourced pricing fact, kept HERE (the single source of truth, rule #4)
 * so no downstream cost path ever re-inlines a magic x1.10.
 * Source: https://cloud.google.com/vertex-ai/generative-ai/pricing (Standard tier).
 */
export const VERTEX_NONGLOBAL_SURCHARGE = 1.1;
export const VERTEX_NONGLOBAL_EFFECTIVE = "2026-07-01";

/** A Vertex location bills the surcharge unless it is the flat "global" endpoint. */
export function isVertexNonGlobal(location: string): boolean {
  return !!location && location.trim().toLowerCase() !== "global";
}

/**
 * THE SURCHARGE IS NOT UNIVERSAL — IT IS GEMINI-3-AND-LATER ONLY (2026-07-26).
 *
 * Verified against the Vertex pricing page, whose note reads: "For non-global
 * endpoints, pricing will go into effect for the Generally available Gemini 3
 * and later families of models on July 1, 2026." The differential is listed
 * only for Gemini 3.5 Flash / 3.5 Flash-Lite / 3.1 Flash-Lite / 3 Flash
 * Preview. Gemini 2.5 is an earlier family and carries NO regional premium:
 * asia-south1 bills it at the same 0.30 / 0.03 / 2.50 as the global endpoint.
 *
 * This mattered the moment a policy pinned both generations at once. The
 * tiered SDLC column runs 3.5-flash on the reasoning stages and 2.5-flash on
 * execute, and a blanket x1.10 inflated the 2.5 half of a cost comparison by
 * 10% — biasing the result against the cheap tier, i.e. against the very
 * finding the column exists to measure. A wrong number that flatters us is
 * caught in review; one that penalises us is believed.
 *
 * Keyed on the family digit rather than a model allow-list so a newly added
 * Gemini 3.x/4.x id is surcharged by default (the safe direction) instead of
 * silently under-pricing until someone remembers to update a list.
 */
export function vertexSurchargeApplies(modelId: string): boolean {
  const m = modelId.trim().toLowerCase();
  if (!m.startsWith("gemini-")) return false;
  const major = Number(m.slice("gemini-".length).match(/^(\d+)/)?.[1]);
  return Number.isFinite(major) && major >= 3;
}

/**
 * Rates for `modelId` as ACTUALLY billed on a given Vertex `location`.
 * Non-global regions (e.g. our asia-south1 Gemini worker) carry the +10%
 * surcharge on every line **for Gemini 3+ models only** (see
 * `vertexSurchargeApplies`); "global" (or empty) returns the base rates
 * unchanged. Use this — not getPrice() — whenever the tokens were produced on
 * Vertex, so regional cost stays honest without a hand-inlined multiplier.
 */
export function getVertexRates(modelId: string, location: string): Rates {
  const base = getPrice(modelId);
  const scale = isVertexNonGlobal(location) && vertexSurchargeApplies(modelId)
    ? VERTEX_NONGLOBAL_SURCHARGE : 1;
  return {
    input: base.input * scale,
    cache_read: base.cache_read === undefined ? undefined : base.cache_read * scale,
    cache_write: base.cache_write === undefined ? undefined : base.cache_write * scale,
    output: base.output * scale,
  };
}

/** Token counts by billing class. All fields are DISJOINT counts — never overlapping. */
export interface TokenCounts {
  /** Fresh (uncached, non-cache-write) input tokens. */
  input_fresh: number;
  cache_read?: number;
  cache_write?: number;
  /**
   * Billed output tokens INCLUDING reasoning tokens (providers bill reasoning
   * at the output rate). Track reasoning separately in telemetry for analysis.
   */
  output: number;
}

/** Per-1M-token rates, e.g. a ModelPrice or an at-time policy snapshot. */
export interface Rates {
  input: number;
  cache_read?: number;
  cache_write?: number;
  output: number;
}

export interface CostBreakdown {
  input_fresh: MicroUsd;
  cache_read: MicroUsd;
  cache_write: MicroUsd;
  output: MicroUsd;
  total: MicroUsd;
}

/**
 * Integer micro-USD cost. tokens * usd_per_mtok is micro-USD exactly;
 * Math.round only smooths sub-micro fractions from decimal rates.
 * Missing cache rates fall back conservatively: reads price at the
 * cache_read rate or 0.1x input; writes at cache_write or 1.25x input.
 */
export function costMicroUsd(tokens: TokenCounts, rates: Rates): CostBreakdown {
  const cacheReadRate = rates.cache_read ?? rates.input * 0.1;
  const cacheWriteRate = rates.cache_write ?? rates.input * 1.25;
  const input_fresh = Math.round(tokens.input_fresh * rates.input);
  const cache_read = Math.round((tokens.cache_read ?? 0) * cacheReadRate);
  const cache_write = Math.round((tokens.cache_write ?? 0) * cacheWriteRate);
  const output = Math.round(tokens.output * rates.output);
  return {
    input_fresh,
    cache_read,
    cache_write,
    output,
    total: input_fresh + cache_read + cache_write + output,
  };
}

export function microToUsd(micro: MicroUsd): number {
  return micro / 1_000_000;
}

export function formatUsd(micro: MicroUsd): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

/** Stable fingerprint of the price table, recorded in every run_context. */
export function pricingHash(): string {
  const canon = JSON.stringify(
    Object.keys(PRICES)
      .sort()
      .map((k) => PRICES[k])
  );
  let h = 2166136261;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${PRICING_VERSION}:${(h >>> 0).toString(16)}`;
}
