/**
 * PRICING ONE WORKER HAND-OFF — the single implementation.
 *
 * Two tools have to turn a `worker-usage-*.json` sidecar into dollars: the
 * dashboard exporter (export-dashboard.mjs) and the end-of-run report
 * (tools/report.mjs). Both used to be candidates for their own copy of the
 * mapping below, which is exactly the shape of bug that is invisible until the
 * two disagree in front of a reader — one surface quoting a cost the other
 * contradicts, with no way to tell which is right. So the mapping lives here
 * once and both import it.
 *
 * The RATES were never duplicated and still are not: they come from
 * @harness/pricing, which is the only place a per-1M figure is allowed to
 * exist. What this module owns is the step before that — deciding which
 * billing class each raw Vertex counter belongs to.
 *
 * THE TWO CONVENTIONS, DELIBERATELY NOT MIXED UP. Vertex's `UsageMetadata` and
 * the pricing package's `TokenCounts` do not mean the same thing by the same
 * words, and reading one as the other silently overcharges:
 *
 *   prompt_token_count INCLUDES the cached reads, so fresh = prompt − cached.
 *     Passing `prompt` as `input_fresh` bills every cache read at the full
 *     input rate. On a cache-heavy run (86% on the 2026-07-26 uptime-ping
 *     pass) that overstates the worker several-fold, in the expensive
 *     direction, in a study handed to the team that built the cache.
 *   thoughts are billed at the OUTPUT rate, so output = candidates + thoughts.
 *     Dropping thoughts undercounts a HIGH-thinking worker, which is every
 *     policy in this repo.
 *
 * Verified against a real sidecar: prompt + candidates + thoughts === total.
 */
import { getVertexRates, costMicroUsd, microToUsd } from "../../packages/pricing/dist/index.js";

/**
 * The Gemini worker DEFAULTS to asia-south1 (the global endpoint was
 * quota-starved 2026-07-16), and GOOGLE_CLOUD_LOCATION overrides it. Named
 * because the +10% regional surcharge is applied by getVertexRates() from this
 * value rather than assumed by a caller.
 */
export const WORKER_REGION_FALLBACK = "asia-south1";

/**
 * Where the worker actually ran, per sidecar. Reads the run's own evidence and
 * falls back to the pinned region only for sidecars written before
 * gemini_worker.py started recording it. Used for BOTH pricing (the surcharge
 * is regional) and display, so a run executed in, say, europe-west4 is never
 * priced or described as asia-south1.
 */
export const sidecarRegion = (sc) => sc?.vertex_location || WORKER_REGION_FALLBACK;

/** Which Google Cloud project paid for the worker side, per sidecar. */
export const sidecarProject = (sc) => sc?.vertex_project || null;

/**
 * Price one worker usage sidecar.
 *
 * Returns `{ tokens, reasoning, usd, priced, model, region }`. An unknown model
 * id leaves `usd` at 0 and `priced` false rather than guessing a rate — the
 * callers surface that as an explicit gap, because a silently-invented price is
 * worse than a stated hole.
 */
export function priceSidecar(sc) {
  const u = sc?.usage ?? {};
  const prompt = u.prompt_token_count ?? 0;
  const cached = u.cached_content_token_count ?? 0;
  const candidates = u.candidates_token_count ?? 0;
  const thoughts = u.thoughts_token_count ?? 0;
  const tokens = {
    input_fresh: Math.max(0, prompt - cached),
    cache_read: cached,
    output: candidates + thoughts,
  };
  const region = sidecarRegion(sc);
  let usd = 0;
  let priced = false;
  try {
    // Priced in the region the sidecar says it ran in: the surcharge is a
    // property of the endpoint that served the call, not of our policy pin.
    usd = microToUsd(costMicroUsd(tokens, getVertexRates(sc.model, region)).total);
    priced = true;
  } catch {
    usd = 0;
  }
  return { tokens, reasoning: thoughts, usd, priced, model: sc?.model, region };
}

/**
 * Roll a list of sidecars up PER MODEL, then total.
 *
 * Per-model is not a nicety: the `gemini35-plus-25-flash-high` policy runs two
 * Gemini tiers in one run, their rates differ by 5x, and only one of them
 * carries the non-global surcharge (Vertex scopes it to Gemini 3+). A single
 * blended number for such a run is wrong no matter which rate produced it.
 */
export function priceSidecars(sidecars = []) {
  const byModel = new Map();
  let usd = 0;
  const unpriced = new Set();
  for (const sc of sidecars) {
    const p = priceSidecar(sc);
    if (!p.priced) unpriced.add(sc?.model ?? "unknown");
    usd += p.usd;
    const key = `${p.model ?? "unknown"} · ${p.region}`;
    const acc = byModel.get(key) ?? {
      model: p.model ?? "unknown", region: p.region, calls: 0, usd: 0, priced: p.priced,
      tokens: { input_fresh: 0, cache_read: 0, output: 0 },
    };
    acc.calls += 1;
    acc.usd += p.usd;
    acc.priced = acc.priced && p.priced;
    acc.tokens.input_fresh += p.tokens.input_fresh;
    acc.tokens.cache_read += p.tokens.cache_read;
    acc.tokens.output += p.tokens.output;
    byModel.set(key, acc);
  }
  return { usd, byModel: [...byModel.values()], unpriced: [...unpriced] };
}
