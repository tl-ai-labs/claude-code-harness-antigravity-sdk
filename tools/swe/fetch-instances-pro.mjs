#!/usr/bin/env node
/**
 * fetch-instances-pro — download SWE-bench Pro (Scale AI) instances and freeze
 * them on disk with the SAME integrity layout as the Verified fetcher:
 *
 *   {out}/{instance_id}/instance.json   AGENT-SAFE: repo, base_commit,
 *                                       problem_statement, requirements,
 *                                       interface, repo_language (+ benign
 *                                       issue_categories/issue_specificity
 *                                       labels for stratified reporting)
 *   {out}/{instance_id}/sealed.json     NEVER shown to any model: gold patch,
 *                                       test_patch, fail_to_pass, pass_to_pass
 *                                       (lowercase in Pro), test selection,
 *                                       repo-reset command, image tag. Exists
 *                                       only for the eval input + analysis.
 *   {out}/selection.json                how this set was chosen (mode, seed,
 *                                       language allocation, hashes).
 *
 * Selection modes:
 *   --ids a,b,c          explicit picks (development instances)
 *   --seed S --count N   seeded draw over the 731 public instances,
 *                        STRATIFIED by repo_language (proportional largest-
 *                        remainder allocation, per-language seeded shuffle) —
 *                        generalizable, immune to "you picked the easy language".
 *
 *   node tools/swe/fetch-instances-pro.mjs --ids instance_NodeBB__NodeBB-…
 *   node tools/swe/fetch-instances-pro.mjs --seed 20260716 --count 12
 *
 * Default out: studies/swe-pro-corpus/ (gitignored evidence area — separate
 * corpus from Verified's swe-corpus; the two tracks never share frozen data).
 * Dataset access via the HuggingFace datasets-server API — no local HF install.
 * Deterministic: same args -> same bytes (hashes recorded).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const ids = opt("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
const seed = opt("seed");
const count = Number(opt("count") ?? 0);
const out = resolve(opt("out") ?? join(ROOT, "studies", "swe-pro-corpus"));

if (!ids && !(seed && count > 0)) {
  console.error("usage: fetch-instances-pro --ids a,b  |  --seed S --count N   [--out dir]");
  process.exit(1);
}

const DATASET = "ScaleAI%2FSWE-bench_Pro";
const SPLIT_SIZE = 731; // public test split (the other Pro subsets are held out)
// Field split verified against the live dataset 2026-07-16 (16 columns).
const AGENT_SAFE = [
  "repo",
  "instance_id",
  "base_commit",
  "problem_statement",
  "requirements",
  "interface",
  "repo_language",
  "issue_categories",
  "issue_specificity",
];
const SEALED = [
  "patch",
  "test_patch",
  "fail_to_pass",
  "pass_to_pass",
  "selected_test_files_to_run",
  "before_repo_set_cmd",
  "dockerhub_tag",
];

async function fetchAllRows() {
  const rows = [];
  for (let offset = 0; offset < SPLIT_SIZE; offset += 100) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=default&split=test&offset=${offset}&length=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HF datasets-server ${res.status} at offset ${offset}`);
    rows.push(...(await res.json()).rows.map((x) => x.row));
  }
  return rows;
}

/** Deterministic PRNG (mulberry32 over a string-hashed seed) for the draw. */
function seededShuffle(items, seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (const c of seedStr) {
    h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Stratified draw: N split across repo_language groups proportionally to
 * their share of the 731 (largest-remainder rounding, every language with at
 * least one instance gets floor≥0 — tiny groups can round to 0 honestly),
 * then a per-language seeded shuffle picks the members.
 */
function stratifiedDraw(all, seedStr, n) {
  const byLang = new Map();
  for (const r of all) {
    const lang = (r.repo_language ?? "unknown").toLowerCase();
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(r.instance_id);
  }
  const langs = [...byLang.keys()].sort();
  const quotas = langs.map((lang) => {
    const exact = (byLang.get(lang).length / all.length) * n;
    return { lang, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let remaining = n - quotas.reduce((s, q) => s + q.floor, 0);
  for (const q of [...quotas].sort((a, b) => b.frac - a.frac)) {
    if (remaining <= 0) break;
    q.floor += 1;
    remaining -= 1;
  }
  const picked = [];
  const allocation = {};
  for (const q of quotas) {
    const pool = seededShuffle(byLang.get(q.lang).sort(), `${seedStr}:${q.lang}`);
    picked.push(...pool.slice(0, q.floor));
    allocation[q.lang] = { population: byLang.get(q.lang).length, drawn: q.floor };
  }
  return { ids: picked.sort(), allocation };
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const pick = (row, keys) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

console.log(`fetching SWE-bench Pro public split (${SPLIT_SIZE} rows, ${Math.ceil(SPLIT_SIZE / 100)} requests)…`);
const all = await fetchAllRows();
const byId = new Map(all.map((r) => [r.instance_id, r]));

let chosen;
let allocation = null;
if (ids) {
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length) {
    console.error(`unknown instance ids: ${missing.join(", ")}`);
    process.exit(1);
  }
  chosen = ids.map((i) => byId.get(i));
} else {
  const draw = stratifiedDraw(all, seed, count);
  allocation = draw.allocation;
  chosen = draw.ids.map((i) => byId.get(i));
}

mkdirSync(out, { recursive: true });
const manifest = [];
for (const row of chosen) {
  const dir = join(out, row.instance_id);
  mkdirSync(dir, { recursive: true });
  const agentSafe = JSON.stringify(pick(row, AGENT_SAFE), null, 2) + "\n";
  const sealed = JSON.stringify(
    { _WARNING: "SEALED — must never reach a model prompt (gold answers + eval tests). Integrity rule 1.", ...pick(row, SEALED) },
    null, 2
  ) + "\n";
  writeFileSync(join(dir, "instance.json"), agentSafe);
  writeFileSync(join(dir, "sealed.json"), sealed);
  manifest.push({
    instance_id: row.instance_id,
    repo: row.repo,
    repo_language: row.repo_language,
    instance_sha256: sha(agentSafe),
    sealed_sha256: sha(sealed),
  });
  console.log(`  froze ${row.instance_id}  (${row.repo}, ${row.repo_language})`);
}

writeFileSync(
  join(out, "selection.json"),
  JSON.stringify(
    {
      dataset: "ScaleAI/SWE-bench_Pro", split: "test", split_size: all.length,
      mode: ids ? "explicit (development picks — excluded from evaluation claims)" : "seeded-random stratified by repo_language",
      seed: seed ?? null, count: chosen.length, language_allocation: allocation, instances: manifest,
    },
    null, 2
  ) + "\n"
);
console.log(`\n${chosen.length} instance(s) frozen → ${out}  (selection.json records the rule + hashes)`);
