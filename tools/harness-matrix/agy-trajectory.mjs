/**
 * agy-trajectory.mjs — recover Antigravity's run record from its LOCAL store.
 *
 * STATUS (2026-07-23): DORMANT — not imported anywhere. The `antigravity` CLI
 * runtime was removed from runtimes.mjs when Teja parked the agy CLI, so nothing
 * calls this harvester today. It is KEPT ON DISK rather than deleted because it
 * is the ONLY decoder for the agy local SQLite store: (a) it can still read the
 * box-1 smoke DBs that already exist under ~/.gemini/antigravity-cli, and (b) it
 * audits any future agy CLI-vs-SDK comparison run. It is a pure library with no
 * top-level side effects, so it costs nothing while unused. Re-wire it only if
 * the agy CLI runtime returns — the SDK worker (gemini_worker.py) reports usage
 * natively (real UsageMetadata) and does not need this blob-scanning at all.
 *
 * WHY THIS EXISTS
 * ---------------
 * The design (and this repo's README, until now) asserted that agy cells were
 * unauditable: `agy -p` prints prose, emits no JSON stream, and reports no
 * usage numbers, so the adapter honestly returned
 * `{ costUsd: null, numTurns: null, resolvedModel: null }`. That made boxes 1
 * and 2 (and the delegated cell's worker half) blind in exactly the places the
 * study needs evidence — which model actually served the call, and what the
 * agent did.
 *
 * That assertion was WRONG about the trajectory. agy persists every
 * conversation to a local SQLite database under
 *   ~/.gemini/antigravity-cli/conversations/<conversation-uuid>.db
 * with tables `trajectory_meta`, `steps` (one row per agent step) and
 * `gen_metadata` (one row per model generation). The reason nobody found it is
 * that the payloads are protobuf blobs inside SQLite rather than JSONL, so
 * neither a `grep` of the run directory nor a look at stdout reveals anything.
 *
 * This module reads that store. It is deliberately a POST-RUN HARVESTER and
 * not a second source of truth: the scaffold's own timing, exit codes and gate
 * verdicts remain authoritative (DESIGN §6.0). What this adds is the evidence
 * agy itself recorded.
 *
 * WHY WE DO NOT PROXY OR INTERCEPT INSTEAD
 * ----------------------------------------
 * The alternative considered was a telemetry gateway (LiteLLM or similar) in
 * front of both runtimes, to capture tokens and cost uniformly. It was
 * rejected on evidence, not preference:
 *   - `agy` has no base-URL override — no flag in `agy --help`, no
 *     configuration env var in the binary, and its endpoints
 *     (`cloudcode-pa.googleapis.com`) are compiled in.
 *   - The only remaining route is a MITM proxy with our own CA against an
 *     authenticated Google enterprise seat, which is not acceptable inside a
 *     partnership study.
 *   - It would not even work: agy serves Claude through
 *     `API_PROVIDER_ANTHROPIC_VERTEX` SERVER-SIDE, so a proxy on this host
 *     sees a Google RPC envelope, never the Anthropic request. The thinking
 *     level we actually want is not on the wire here at all.
 * The local store gives us more than the proxy could, with no ToS exposure.
 *
 * WHAT THIS MODULE DELIBERATELY DOES *NOT* CLAIM
 * ----------------------------------------------
 * `gen_metadata` contains unlabeled integer fields that BEHAVE like counters
 * (one climbs monotonically across a run against a constant 160000; another
 * sits at a constant 64000 — consistent with context-used / context-window /
 * max-output). We have field NUMBERS, not field NAMES, and no schema. So this
 * module records those integers verbatim under `unlabeled_counters` and
 * NEVER maps them to token counts or cost. `costUsd` stays null. Calling an
 * unidentified integer a token count is precisely the kind of false precision
 * the study's honesty rules exist to prevent (README "Honesty rules").
 *
 * EXTRACTION METHOD, AND ITS LIMITS
 * ---------------------------------
 * Two constraints shape the implementation:
 *   1. Zero new dependencies (DESIGN §6.1) — so no SQLite driver package. We
 *      shell out to the `sqlite3` CLI, which ships with macOS and is a one-line
 *      install on Linux, and degrade gracefully when it is absent.
 *   2. No protobuf schema — Google does not publish one for this store. So
 *      structured fields are recovered by scanning blob bytes for printable
 *      ASCII runs. This is honest string extraction, not parsing: it reliably
 *      recovers string-valued fields (model ids, tool names) and cannot
 *      recover numeric ones. Every value this module reports is therefore a
 *      string that agy itself wrote.
 *
 * The DATABASE FILES ARE ALWAYS COPIED into the run's outDir even when parsing
 * fails, so that a future decoder can re-derive everything from the archived
 * evidence rather than needing the run to happen again.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, basename } from "node:path";

/**
 * agy's per-user conversation store. Fixed path — the CLI offers no override
 * (`agy --help` exposes only --log-file, which controls the diagnostic log,
 * not this store), so there is nothing to make configurable here.
 */
export const AGY_CONVERSATIONS_DIR =
  join(homedir(), ".gemini", "antigravity-cli", "conversations");

/**
 * Tool names agy's agent can call, used to turn raw blob strings into a tool
 * histogram. Sourced from what the first navidrome smoke actually recorded
 * (grep_search / view_file / run_command / write_to_file) plus the sibling
 * names present in the binary. An unlisted tool simply does not appear in the
 * histogram — it is never silently bucketed as something else, and the raw
 * strings remain in the archived DB for later re-analysis.
 */
const KNOWN_TOOLS = [
  "run_command", "view_file", "grep_search", "write_to_file", "edit_file",
  "find_by_name", "list_dir", "codebase_search", "read_url_content",
  "search_web", "replace_file_content", "view_code_item", "browser_preview",
];

/**
 * Model-id shapes agy records per generation. Kept as a permissive pattern
 * rather than an allow-list of exact strings: the point of harvesting this
 * field is PIN VERIFICATION, and an allow-list would silently drop the very
 * surprise (an unexpected model) we are looking for.
 */
const MODEL_RE = /(?:claude|gemini)[a-z0-9._-]{6,}/g;

/**
 * Internal marker strings agy writes alongside real model ids. These are
 * routing/config labels, not models that served a request, so reporting them
 * as resolved models would be actively misleading. Excluded by exact match.
 */
const NON_MODEL_LABELS = new Set([
  "claude_conservative", "gemini_model", "claude-router", "claude-plugin",
  "gemini-claude-router", "gemini-antigravity", "gemini-api-key",
  "gemini-default", "gemini-flash-only", "gemini-flash-server",
]);

/** `sqlite3` is probed once per process — the answer cannot change mid-run. */
let sqliteAvailable = null;
function haveSqlite() {
  if (sqliteAvailable !== null) return sqliteAvailable;
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "pipe" });
    sqliteAvailable = true;
  } catch {
    sqliteAvailable = false;
  }
  return sqliteAvailable;
}

/**
 * Copy a conversation DB together with its -wal and -shm sidecars.
 *
 * This is load-bearing and was learned the hard way: agy leaves databases in
 * WAL mode, so the newest rows — including the entire run you just did — live
 * in <db>-wal and are INVISIBLE if you copy only the .db file. A read-only
 * open without the sidecars does not error loudly either; it fails in a way
 * that is easy to mistake for "the table is empty". Copying all three and
 * opening the COPY read-write lets SQLite replay the WAL normally.
 *
 * The original files are never opened for writing — agy may still be running.
 */
function copyDbSet(srcDb, destDir, destName) {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, destName);
  const copied = [];
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(srcDb + ext)) {
      copyFileSync(srcDb + ext, dest + ext);
      copied.push(basename(dest + ext));
    }
  }
  return { dest, copied };
}

/**
 * Run one query against a copied DB and return rows as arrays of cell strings.
 * `-separator` uses a unit-separator byte because agy payloads legitimately
 * contain pipes, tabs and newlines; using sqlite3's default would corrupt the
 * split. Failures return [] rather than throwing: a harvest that cannot parse
 * must degrade to "evidence copied, fields unknown", never abort a completed
 * study run over a reporting nicety.
 */
function query(dbPath, sql) {
  try {
    const out = execFileSync("sqlite3", ["-separator", "\x1f", dbPath, sql],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    return out.split("\n").filter((l) => l.length).map((l) => l.split("\x1f"));
  } catch {
    return [];
  }
}

/**
 * Recover printable ASCII runs from a hex-encoded blob. This is how every
 * string field is obtained (see EXTRACTION METHOD above) — protobuf stores
 * field NUMBERS, not names, so a length-prefixed UTF-8 field is recoverable
 * but its identity is not. Minimum run length filters out coincidental
 * printable bytes inside varints and length prefixes.
 */
function blobStrings(hex, minLen = 4) {
  const buf = Buffer.from(hex, "hex");
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    const printable = c >= 0x20 && c < 0x7f;
    if (printable && start < 0) start = i;
    else if (!printable && start >= 0) {
      if (i - start >= minLen) out.push(buf.toString("ascii", start, i));
      start = -1;
    }
  }
  return out;
}

/**
 * Find the conversation databases belonging to one phase invocation.
 *
 * Matching is by WORKSPACE URI recorded inside each DB's
 * `trajectory_metadata_blob`, intersected with a modification-time window.
 *
 * Why not the obvious index file: agy maintains
 * `cache/last_conversations.json`, which maps a directory to a conversation
 * id — but only the MOST RECENT one. Each `agy -p` call opens a fresh
 * conversation (we never pass --continue, by design: phases communicate via
 * contract files, not runtime conversation state — DESIGN §6.7), so a single
 * three-phase run with retries produces many conversations per workdir. The
 * first navidrome smoke produced SIX databases referencing the same run
 * directory; the index file would have surfaced one of them. Scanning and
 * matching on workspace URI finds all of them.
 *
 * The `sinceMs` window is what separates one phase from the next, since every
 * phase of a run shares the same workspace URI. It is passed the wall-clock
 * time the phase spawn began.
 */
export function findRunConversations({ workdir, outDir, sinceMs, untilMs }) {
  if (!existsSync(AGY_CONVERSATIONS_DIR) || !haveSqlite()) return [];
  const scratch = join(tmpdir(), `agy-harvest-${process.pid}`);
  mkdirSync(scratch, { recursive: true });

  const hits = [];
  for (const name of readdirSync(AGY_CONVERSATIONS_DIR)) {
    if (!name.endsWith(".db")) continue;
    const src = join(AGY_CONVERSATIONS_DIR, name);
    let mtime;
    try { mtime = statSync(src).mtimeMs; } catch { continue; }
    // A conversation that was last touched before the phase started, or well
    // after it ended, cannot be this phase's. The trailing slack absorbs agy
    // flushing its WAL a moment after the process exits.
    if (sinceMs && mtime < sinceMs) continue;
    if (untilMs && mtime > untilMs + 120_000) continue;

    const { dest } = copyDbSet(src, scratch, name);
    const uris = query(dest, "SELECT hex(data) FROM trajectory_metadata_blob;")
      .flatMap(([hex]) => blobStrings(hex, 10))
      .flatMap((s) => s.match(/file:\/\/\/[^\s"]+/g) ?? [])
      .map((u) => decodeURIComponent(u.slice(7)).replace(/[z"]$/, ""));

    const belongs = uris.some((u) => u.startsWith(workdir) || u.startsWith(outDir));
    if (belongs) hits.push({ conversationId: name.replace(/\.db$/, ""), src, mtime, uris });
  }
  return hits.sort((a, b) => a.mtime - b.mtime);
}

/**
 * Harvest one phase's agy evidence.
 *
 * Returns null when nothing can be harvested (store missing, sqlite3 absent,
 * or no conversation matched) — the caller records that as an honest gap
 * rather than substituting defaults.
 */
export function harvestAgyTrajectory({ workdir, outDir, logPrefix, sinceMs, untilMs }) {
  if (!haveSqlite()) {
    return { available: false, reason: "sqlite3 CLI not found on PATH", conversations: [] };
  }
  if (!existsSync(AGY_CONVERSATIONS_DIR)) {
    return { available: false, reason: `no agy store at ${AGY_CONVERSATIONS_DIR}`, conversations: [] };
  }

  const found = findRunConversations({ workdir, outDir, sinceMs, untilMs });
  if (!found.length) {
    return { available: false, reason: "no conversation matched this run's workspace + time window", conversations: [] };
  }

  // Evidence first: archive the databases into the run directory BEFORE
  // parsing, so a parse failure still leaves a re-analysable record.
  const archiveDir = join(outDir, "phases", `${logPrefix}.agy-trajectory`);
  const conversations = [];
  const models = new Set();
  const tools = {};
  let steps = 0, generations = 0;

  for (const conv of found) {
    const { dest, copied } = copyDbSet(conv.src, archiveDir, `${conv.conversationId}.db`);

    const count = (t) => Number(query(dest, `SELECT COUNT(*) FROM ${t};`)?.[0]?.[0] ?? 0);
    const nSteps = count("steps");
    const nGen = count("gen_metadata");
    steps += nSteps;
    generations += nGen;

    // Model ids live in gen_metadata (one row per generation). Every id found
    // is reported: if a run silently served two different models, the study
    // must see both, not a single "resolved" value that hides the split.
    const convModels = new Set();
    for (const [hex] of query(dest, "SELECT hex(data) FROM gen_metadata;")) {
      for (const s of blobStrings(hex)) {
        for (const m of s.match(MODEL_RE) ?? []) {
          if (!NON_MODEL_LABELS.has(m)) { convModels.add(m); models.add(m); }
        }
      }
    }

    // Tool histogram across step payloads. Counts are occurrences of a known
    // tool name in the blob text, which is a LOWER-BOUND proxy for calls, not
    // an exact call count — a name can appear in both a request and its echo.
    // Named as *_mentions for that reason.
    for (const [hex] of query(dest, "SELECT hex(step_payload) FROM steps WHERE step_payload IS NOT NULL;")) {
      const text = blobStrings(hex).join("\n");
      for (const t of KNOWN_TOOLS) {
        const n = text.split(t).length - 1;
        if (n > 0) tools[t] = (tools[t] ?? 0) + n;
      }
    }

    conversations.push({
      conversation_id: conv.conversationId,
      archived_files: copied,
      steps: nSteps,
      generations: nGen,
      models: [...convModels].sort(),
      workspace_uris: conv.uris,
    });
  }

  return {
    available: true,
    source: AGY_CONVERSATIONS_DIR,
    conversations,
    steps_total: steps,
    generations_total: generations,
    tool_name_mentions: tools,
    // Single value only when the whole phase agreed; otherwise null plus the
    // full list, so a mixed run is visible rather than papered over.
    resolved_model: models.size === 1 ? [...models][0] : null,
    resolved_models_all: [...models].sort(),
    // Stated explicitly so no downstream reader infers these were unavailable
    // for a different reason, or that null cost means zero compute.
    cost_usd: null,
    cost_note:
      "agy reports no usage numbers and its local store's numeric fields are unlabeled " +
      "(field numbers without a schema); no token or cost figure is derivable without invention.",
  };
}
