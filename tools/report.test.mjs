/**
 * Unit tests for tools/report.mjs and the shared sidecar pricing it depends on.
 *
 * These run offline at $0 against synthetic run directories shaped from a real
 * manifest. What they defend is narrow and deliberate: the report exists to put
 * a DOLLAR FIGURE in front of a reader, so the tests are weighted toward the
 * ways a dollar figure can be quietly wrong — cache reads billed as fresh
 * input, thinking tokens dropped, a mixed-tier run blended to one rate, an
 * unknown model silently costed at zero, and the two economies added together
 * into a number that is the cost of nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectRun, renderReport, workRows, costLines, caveats, nextSteps }
  from "./report.mjs";
import { priceSidecar, priceSidecars, sidecarRegion, WORKER_REGION_FALLBACK }
  from "./harness-matrix/price-sidecar.mjs";
import { getVertexRates, costMicroUsd, microToUsd } from "../packages/pricing/dist/index.js";

// ---- fixtures ---------------------------------------------------------------

/** A worker receipt in the exact shape gemini_worker.py writes. */
function sidecar({
  model = "gemini-3.5-flash", prompt = 100_000, cached = 80_000,
  candidates = 2_000, thoughts = 500, tools = 4, region = "asia-south1",
} = {}) {
  return {
    model, thinking: "HIGH", vertex_location: region, tool_call_count: tools,
    usage: {
      prompt_token_count: prompt,
      cached_content_token_count: cached,
      candidates_token_count: candidates,
      thoughts_token_count: thoughts,
      total_token_count: prompt + candidates + thoughts,
    },
  };
}

const DELEGATED_BINDING = { driver: "claude-opus-4-6", worker: "gemini-3.5-flash" };

function makeRun({
  kind = "sdlc", delegated = true, failedAt = null, sidecars = [sidecar()],
  audit = { editCount: 0, flags: [] }, withAudit = true,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "report-test-"));
  mkdirSync(join(dir, "out", "phases"), { recursive: true });

  const binding = delegated ? DELEGATED_BINDING : "claude-opus-4-6";
  const record = (id, executor, extra = {}) => ({
    [kind === "swepro" ? "phase" : "stage"]: id,
    executor,
    binding,
    passed: true,
    attempts: [{
      attempt: 1, wall_seconds: 120, cost_usd: 0.5, num_turns: 12,
      delegation_calls: delegated ? sidecars.length : 0,
      gate: { pass: true },
      worker_usage: delegated
        ? { available: true, calls: sidecars.length, sidecars }
        : null,
    }],
    ...extra,
  });

  const records = kind === "swepro"
    ? [record("repro", "llm-task"), record("patch", "llm-task")]
    : [record("execute", "llm-task"), record("verify", "verify")];

  const manifest = {
    kind,
    ...(kind === "swepro"
      ? { instance_id: "instance_navidrome__navidrome-3bc9", repo: "navidrome/navidrome", repo_language: "go" }
      : { task_id: "kudos-wall" }),
    runtime: { name: "claude-code", version: "2.1.0" },
    policy: { name: "all-gemini-flash-high", retry: { type: "gate", max_attempts: 3 }, limits: {} },
    started_at: "2026-07-31T09:00:00.000Z",
    failed_at: failedAt,
    [kind === "swepro" ? "phases" : "stages"]: records,
    totals: {
      attempts: records.length, wall_seconds: 240, cost_usd: 1.0,
      cost_basis: "DRIVER ONLY, cli-reported (Max seat: modeled, not wallet-real)",
    },
    ...(kind === "swepro"
      ? { patch: { files_kept: ["a.go"], files_stripped: [] } }
      : { delivery: { files_changed: ["a.ts", "b.ts"] } }),
  };

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  if (withAudit) writeFileSync(join(dir, "audit.json"), JSON.stringify(audit));
  sidecars.forEach((sc, i) =>
    writeFileSync(join(dir, "out", `worker-usage-execute-${i}.json`), JSON.stringify(sc)));
  return dir;
}

const cleanup = (d) => rmSync(d, { recursive: true, force: true });

// ---- the billing-class mapping ---------------------------------------------

test("cache reads are not billed as fresh input", () => {
  // The whole point of the mapping: prompt_token_count INCLUDES cached, so a
  // sidecar that is 80% cache must price far below one that is all fresh.
  const heavyCache = priceSidecar(sidecar({ prompt: 100_000, cached: 80_000 }));
  const allFresh = priceSidecar(sidecar({ prompt: 100_000, cached: 0 }));

  assert.equal(heavyCache.tokens.input_fresh, 20_000);
  assert.equal(heavyCache.tokens.cache_read, 80_000);
  assert.equal(allFresh.tokens.input_fresh, 100_000);
  assert.ok(heavyCache.usd < allFresh.usd,
    "a cache-heavy hand-off must cost less than the same tokens fresh");
});

test("thinking tokens are billed at the output rate, not dropped", () => {
  const withThinking = priceSidecar(sidecar({ candidates: 2_000, thoughts: 8_000 }));
  const withoutThinking = priceSidecar(sidecar({ candidates: 2_000, thoughts: 0 }));
  assert.equal(withThinking.tokens.output, 10_000);
  assert.equal(withoutThinking.tokens.output, 2_000);
  assert.ok(withThinking.usd > withoutThinking.usd,
    "dropping thoughts would undercount every HIGH-thinking policy in this repo");
});

test("the priced figure matches the pricing package applied by hand", () => {
  // Guards against the mapping drifting away from the package it is supposed to
  // be a thin adapter over.
  const sc = sidecar({ prompt: 500_000, cached: 400_000, candidates: 9_000, thoughts: 1_000 });
  const expected = microToUsd(costMicroUsd(
    { input_fresh: 100_000, cache_read: 400_000, output: 10_000 },
    getVertexRates("gemini-3.5-flash", "asia-south1"),
  ).total);
  assert.equal(priceSidecar(sc).usd, expected);
});

test("region comes from the sidecar, and the surcharge follows it", () => {
  assert.equal(sidecarRegion(sidecar({ region: "europe-west4" })), "europe-west4");
  // A sidecar written before the field existed falls back to the pinned region.
  assert.equal(sidecarRegion({ model: "gemini-3.5-flash" }), WORKER_REGION_FALLBACK);

  // Vertex scopes the +10% non-global surcharge to Gemini 3 and later, so the
  // same region must NOT surcharge a 2.5 model.
  const g35 = priceSidecar(sidecar({ model: "gemini-3.5-flash", region: "asia-south1" }));
  const g35global = priceSidecar(sidecar({ model: "gemini-3.5-flash", region: "global" }));
  const g25 = priceSidecar(sidecar({ model: "gemini-2.5-flash", region: "asia-south1" }));
  const g25global = priceSidecar(sidecar({ model: "gemini-2.5-flash", region: "global" }));
  assert.ok(g35.usd > g35global.usd, "Gemini 3.5 carries the non-global surcharge");
  assert.equal(g25.usd, g25global.usd, "Gemini 2.5 must not be surcharged");
});

test("Flash-Lite and Flash 3.6 are priced, and both take the Gemini-3 surcharge", () => {
  // Added 2026-07-31 alongside the rate entries themselves. Flash-Lite becomes
  // the repo's ONLY economical worker on this date, so a missing entry would not
  // fail loudly — priceSidecar() catches the throw and reports priced:false,
  // which prints the worker cost as $0 on exactly the runs being handed to
  // Google. This test is the thing that makes that omission impossible.
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.6-flash"]) {
    assert.deepEqual(priceSidecars([sidecar({ model })]).unpriced, [],
      `${model} must have a rate entry in @harness/pricing`);
    const regional = priceSidecar(sidecar({ model, region: "asia-south1" }));
    const glob = priceSidecar(sidecar({ model, region: "global" }));
    assert.ok(regional.usd > glob.usd,
      `${model} is a Gemini 3 family model — the non-global surcharge must apply`);
  }
});

test("Flash-Lite's published non-global rates are what getVertexRates produces", () => {
  // Google prints the SURCHARGED figures for this model outright (0.33 / 2.75 /
  // 0.033) rather than leaving them to be derived, which is a rare opportunity
  // to check the surcharge parser against the vendor instead of against our own
  // arithmetic. vertexSurchargeApplies() has to pull the family digit out of
  // "3.5-flash-lite" — a three-part name no other entry here has — so this
  // asserts it lands on 3, not on some accident of string slicing.
  const r = getVertexRates("gemini-3.5-flash-lite", "asia-south1");
  assert.ok(Math.abs(r.input - 0.33) < 1e-9, `input ${r.input} != published 0.33`);
  assert.ok(Math.abs(r.output - 2.75) < 1e-9, `output ${r.output} != published 2.75`);
  assert.ok(Math.abs(r.cache_read - 0.033) < 1e-9, `cache_read ${r.cache_read} != published 0.033`);
});

test("Flash-Lite is not aliased to gemini-2.5-flash despite an identical rate card", () => {
  // The two carry the same 0.30 / 0.03 / 2.50 global card, which makes dropping
  // the new entry and reusing the 2.5 one look like harmless de-duplication. It
  // is not: 2.5 Flash is a Gemini 2 model and takes NO regional surcharge, so
  // pricing a Flash-Lite call through it understates every asia-south1 run — the
  // only region our worker uses — by 10%.
  const lite = priceSidecar(sidecar({ model: "gemini-3.5-flash-lite", region: "asia-south1" }));
  const f25 = priceSidecar(sidecar({ model: "gemini-2.5-flash", region: "asia-south1" }));
  assert.ok(lite.usd > f25.usd,
    "asia-south1 must price Flash-Lite above 2.5 Flash — the surcharge is the whole difference");
  // ...and they agree on the global endpoint, which is what proves the gap above
  // is the surcharge rather than the two rate cards having quietly diverged.
  assert.equal(
    priceSidecar(sidecar({ model: "gemini-3.5-flash-lite", region: "global" })).usd,
    priceSidecar(sidecar({ model: "gemini-2.5-flash", region: "global" })).usd,
  );
});

test("a mixed-tier run is priced per model, never blended", () => {
  const rolled = priceSidecars([
    sidecar({ model: "gemini-3.5-flash" }),
    sidecar({ model: "gemini-2.5-flash" }),
    sidecar({ model: "gemini-2.5-flash" }),
  ]);
  assert.equal(rolled.byModel.length, 2);
  const g25 = rolled.byModel.find((m) => m.model === "gemini-2.5-flash");
  assert.equal(g25.calls, 2);
  // The rolled total is the sum of the parts, not a single rate over all tokens.
  const sum = rolled.byModel.reduce((n, m) => n + m.usd, 0);
  assert.ok(Math.abs(rolled.usd - sum) < 1e-9);
});

test("an unknown model is reported as unpriced, never costed at zero silently", () => {
  const rolled = priceSidecars([sidecar({ model: "gemini-9.9-imaginary" })]);
  assert.deepEqual(rolled.unpriced, ["gemini-9.9-imaginary"]);
  assert.equal(rolled.usd, 0);
});

// ---- collect ----------------------------------------------------------------

test("collectRun reads an SDLC run, and reports the worker's real spend", () => {
  const dir = makeRun();
  try {
    const f = collectRun(dir);
    assert.equal(f.kind, "sdlc");
    assert.equal(f.subject, "kudos-wall");
    assert.equal(f.delegated, true);
    assert.equal(f.driverUsd, 1.0);
    assert.ok(f.worker.usd > 0, "a delegated run has real metered worker spend");
    // Two stages × one sidecar each: the collector must gather both, not just
    // the first stage's.
    assert.equal(f.worker.byModel[0].calls, 2);
  } finally { cleanup(dir); }
});

test("collectRun detects a SWE-bench Pro run and reads its phases", () => {
  const dir = makeRun({ kind: "swepro" });
  try {
    const f = collectRun(dir);
    assert.equal(f.kind, "swepro");
    assert.equal(f.isPro, true);
    assert.equal(f.stageKey, "phase");
    assert.equal(f.subject, "instance_navidrome__navidrome-3bc9");
    assert.deepEqual(workRows(f).map((r) => r[0]), ["repro", "patch"]);
  } finally { cleanup(dir); }
});

test("a directory with no manifest is refused, not half-reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-empty-"));
  try {
    assert.throws(() => collectRun(dir), /not a harness-matrix run directory/);
  } finally { cleanup(dir); }
});

test("a missing audit.json reads as absent, not as a clean zero", () => {
  const dir = makeRun({ withAudit: false });
  try {
    const f = collectRun(dir);
    assert.equal(f.audit.missing, true);
    assert.ok(caveats(f).some((c) => /No audit\.json/.test(c)));
    assert.ok(/no audit\.json in this run directory/.test(renderReport(f)));
  } finally { cleanup(dir); }
});

// ---- the cost reading -------------------------------------------------------

test("the two economies are reported separately and never summed", () => {
  const dir = makeRun();
  try {
    const f = collectRun(dir);
    const rows = costLines(f);
    const driver = rows.find(([k]) => k === "Claude driver")[1];
    const real = rows.find(([k]) => k === "real spend")[1];

    assert.match(driver, /NO INVOICE IS ISSUED/);
    // The headline real-spend figure is the WORKER's alone. If this ever equals
    // driver+worker, the report is quoting the cost of nothing.
    assert.ok(real.startsWith(`$${f.worker.usd.toFixed(4)}`));
    assert.ok(!real.includes((f.driverUsd + f.worker.usd).toFixed(4)));
  } finally { cleanup(dir); }
});

test("an undelegated run states zero real spend rather than omitting the line", () => {
  const dir = makeRun({ delegated: false, sidecars: [] });
  try {
    const f = collectRun(dir);
    assert.equal(f.delegated, false);
    const real = costLines(f).find(([k]) => k === "real spend")[1];
    assert.match(real, /\$0\.0000/);
    assert.match(renderReport(f), /SOLO/);
  } finally { cleanup(dir); }
});

test("an unpriced model turns the total into a stated floor", () => {
  const dir = makeRun({ sidecars: [sidecar(), sidecar({ model: "gemini-9.9-imaginary" })] });
  try {
    const f = collectRun(dir);
    const notPriced = costLines(f).find(([k]) => k === "not priced");
    assert.ok(notPriced, "an unpriced receipt must produce its own line");
    assert.match(notPriced[1], /FLOOR, not a total/);
  } finally { cleanup(dir); }
});

test("a cache-heavy run warns against multiplying the input total", () => {
  const dir = makeRun({ sidecars: [sidecar({ prompt: 100_000, cached: 90_000 })] });
  try {
    const f = collectRun(dir);
    assert.ok(caveats(f).some((c) => /cache reads/.test(c) && /overstate/.test(c)));
  } finally { cleanup(dir); }
});

// ---- the reading ------------------------------------------------------------

test("every report says n=1 out loud", () => {
  for (const kind of ["sdlc", "swepro"]) {
    const dir = makeRun({ kind });
    try {
      assert.ok(caveats(collectRun(dir)).some((c) => /n = 1/.test(c)));
    } finally { cleanup(dir); }
  }
});

test("next steps are derived from the run, not a fixed list", () => {
  const delegated = makeRun();
  const solo = makeRun({ delegated: false, sidecars: [] });
  const failed = makeRun({ failedAt: "execute" });
  try {
    // A delegated run is pointed at the undelegated baseline, and vice versa.
    assert.ok(nextSteps(collectRun(delegated)).some((s) => /all-opus\.yaml/.test(s.what)));
    assert.ok(nextSteps(collectRun(solo)).some((s) => /all-gemini-flash-high\.yaml/.test(s.what)));
    // A failed run is told to reproduce the failure before changing anything.
    const f = collectRun(failed);
    assert.ok(nextSteps(f).some((s) => /fails at execute again/.test(s.what)));
    assert.ok(caveats(f).some((c) => /FAILED at execute/.test(c)));
  } finally { [delegated, solo, failed].forEach(cleanup); }
});

test("every suggested next run carries its pitfall", () => {
  const dir = makeRun();
  try {
    for (const s of nextSteps(collectRun(dir))) {
      assert.ok(s.what && s.why && s.pitfall, "what/why/pitfall are all required");
    }
  } finally { cleanup(dir); }
});

// ---- render -----------------------------------------------------------------

test("both output modes render the same figures", () => {
  const dir = makeRun();
  try {
    const f = collectRun(dir);
    const usd = f.worker.usd.toFixed(4);
    const text = renderReport(f);
    const md = renderReport(f, { markdown: true });
    for (const out of [text, md]) {
      assert.ok(out.includes(usd), "the worker's real spend appears in both modes");
      assert.ok(out.includes("kudos-wall"));
      assert.ok(/n = 1/.test(out));
    }
    // Markdown mode must actually be markdown — a pasted report with no table
    // pipes is the failure this catches.
    assert.match(md, /^# Run report/m);
    assert.match(md, /\n\| .* \|\n\|/);
  } finally { cleanup(dir); }
});

test("a failed run is headlined as failed in both modes", () => {
  const dir = makeRun({ failedAt: "verify" });
  try {
    const f = collectRun(dir);
    assert.match(renderReport(f), /FAILED at VERIFY/);
    assert.match(renderReport(f, { markdown: true }), /RUN FAILED at VERIFY/);
  } finally { cleanup(dir); }
});

test("the text report stays inside the 80-column grid", () => {
  const dir = makeRun();
  try {
    // eslint-disable-next-line no-control-regex
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    for (const line of renderReport(collectRun(dir)).split("\n")) {
      assert.ok(strip(line).length <= 80, `line ran past 80 columns: ${strip(line)}`);
    }
  } finally { cleanup(dir); }
});

test("the report points at the artifacts that exist, and only those", () => {
  const dir = makeRun();
  try {
    const out = renderReport(collectRun(dir));
    assert.match(out, /manifest\.json/);
    // The artifact count is what is ON DISK, deliberately: the manifest can
    // reference a sidecar the directory no longer holds (a hand-copied run, a
    // partial bundle), and the artifacts section is a pointer to files a reader
    // can actually open — so it counts files, not manifest references.
    assert.match(out, /worker-usage-\*\.json — 1 receipt\(s\)/);
    // model.diff was never written by this fixture, so it must not be promised.
    assert.ok(!/model\.diff/.test(out), "an absent artifact must not be listed");
  } finally { cleanup(dir); }
});
