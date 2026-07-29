/**
 * logfmt.mjs — the harness's terminal voice: one dependency-free formatting
 * module behind every decorated line a run prints, shared by the kinds
 * (kinds/swepro.mjs, kinds/sdlc.mjs), the stage attempt loop (kinds/lib.mjs)
 * and the live trajectory narrator (runtimes.mjs makePhaseNarrator).
 *
 * Why it exists (2026-07-25): the terminal log of a delegated cc×Gemini run
 * IS a demo artifact — it must narrate the machinery (who is driving, what
 * was delegated, what every hand-off cost in time and tokens, what every
 * gate decided) well enough that the log alone is the evidence a reviewer
 * reads. Centralizing the visual language here keeps the SWE-bench Pro and
 * SDLC runs looking identical line-for-line, so a viewer comparing the two
 * demos compares the RUNS, not two ad-hoc logging styles.
 *
 * Contract — presentation-only, parse-never:
 *   - Nothing downstream reads these lines back (file-output rule,
 *     preflight #70): run evidence lives in manifest.json / audit.json /
 *     the trajectory files, and every number printed here is printed FROM
 *     those same in-memory records, never the other way around.
 *   - Color is ANSI and auto-disables when stdout is not a TTY or NO_COLOR
 *     is set, so piped/captured logs stay plain text. Colors always wrap
 *     WHOLE phrases/lines — never the middle of one — so a grep or a test
 *     regex over the text still matches with color on.
 *   - No secrets: nothing in this module (or its callers) prints tokens,
 *     keys or credentials — identities are model ids, file paths and counts.
 */

// One shared inner width for banners and rules — a single visual grid for
// the whole run, sized to survive a QuickTime-recorded 80-column terminal.
const W = 76;

/**
 * Whole-line/whole-phrase ANSI painters. The TTY check runs once at import:
 * a run's output either has color everywhere or nowhere, never mixed.
 */
export const paint = (() => {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const p = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: p("1"), dim: p("2"),
    red: p("31"), green: p("32"), yellow: p("33"),
    magenta: p("35"), cyan: p("36"),
  };
})();

/** 12345 → "12,345" (token counts); null/undefined → "n/a". */
export const fmtInt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));

/** 0.8412 → "$0.8412" (driver-side CLI-reported cost); null → "n/a". */
export const fmtUsd = (x) => (x == null ? "n/a" : `$${x.toFixed(4)}`);

/** Seconds → "47s" / "12m03s" — wall-clock durations everywhere. */
export const fmtDur = (s) => {
  if (s == null) return "n/a";
  const n = Math.round(s);
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m${String(n % 60).padStart(2, "0")}s`;
};

/**
 * Heavy double-line box — reserved for the two loudest moments of a run:
 * the identity header at the start and the verdict at the end. Everything
 * in between uses the lighter rule() so the eye finds these two instantly.
 */
export function heavyBox(lines, colorFn = paint.cyan) {
  // Fixed width, wrapped content — NOT a box that grows to fit its longest
  // line. It used to grow, which is invisible on the SDLC header (short task
  // ids) and broke the moment SWE-bench Pro put a 90-character instance id in
  // the verdict box: a 112-column box on an 80-column screenshare wraps its own
  // border and the loudest frame in the log becomes the most broken one.
  // Hard-split any token still wider than the frame. wrapText deliberately
  // never breaks a long token (a split path stops being copy-pasteable) — but
  // inside a BOX that exception loses to the box's own contract, which is that
  // it is rectangular and closed. SWE-bench Pro instance ids are single 90-char
  // tokens, so without this the verdict box's border wraps.
  const body = lines.flatMap((l) => wrapText(l, W)).flatMap((l) =>
    visibleLen(l) <= W ? [l] : (l.match(new RegExp(`.{1,${W}}`, "g")) ?? [l]));
  return [
    "╔" + "═".repeat(W + 2) + "╗",
    ...body.map((l) => "║ " + l + " ".repeat(Math.max(0, W - visibleLen(l))) + " ║"),
    "╚" + "═".repeat(W + 2) + "╝",
  ].map((l) => colorFn(l)).join("\n");
}

/** Labeled section rule: "── PHASE 2/3 · LOCALIZE — … ───────". */
export function rule(label = "") {
  if (!label) return paint.dim("─".repeat(W + 4));
  // Clip rather than overflow: a long stage title would otherwise push the
  // trailing dashes past the grid (same failure mode as the box above).
  // The repeat count is W − len, not W + 1 − len: "── " + label + " " is
  // len + 4, so the old arithmetic made EVERY labeled rule 81 columns — one
  // past the grid, which a terminal answers by dropping a lone "────" onto
  // the next line. Invisible until replay-log.mjs measured the output.
  const text = label.length > W - 2 ? label.slice(0, W - 3) + "…" : label;
  return paint.bold(`── ${text} ` + "─".repeat(Math.max(2, W - text.length)));
}

// ---- 80-column discipline ---------------------------------------------------
// These logs are read on a screenshared terminal, and a terminal wraps at the
// window edge with ZERO indent — so a 130-character value returns to column 0
// and visually merges with the next row's label. The block below wraps values
// ourselves, continuing under the value column, so the label gutter survives.
// (Discovered 2026-07-26 replaying the first delegated SDLC run: the two
// longest rows, `cost regime` and `delegation`, are precisely the two a viewer
// most needs to read cleanly.)

// Two copies on purpose: the /g one is only ever used with .replace (which
// resets lastIndex), the plain one only with .test. A /g regex reused across
// .test calls carries lastIndex between them and returns alternating answers —
// a bug that would show up as randomly-unwrapped rows.
const ANSI_RE_G = /\x1b\[[0-9;]*m/g;
const HAS_ANSI = /\x1b\[[0-9;]*m/;
/** Visible width — what a terminal actually shows, escapes excluded. */
const visibleLen = (s) => String(s).replace(ANSI_RE_G, "").length;

/**
 * Greedy word wrap on VISIBLE width. A single token longer than the width (a
 * path, an image tag, a URL) is never broken — a split identifier is worse than
 * one long line, because it stops being copy-pasteable.
 */
export function wrapText(text, width) {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    if (!line) { line = word; continue; }
    if (visibleLen(line) + 1 + visibleLen(word) <= width) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line || !out.length) out.push(line);
  return out;
}

/**
 * ---- THE 80-COLUMN BACKSTOP -------------------------------------------------
 * Fit ALREADY-COMPOSED terminal output to the shared grid, and do nothing at
 * all to output that already fits.
 *
 * Why this exists (2026-07-26). kvBlock/table/heavyBox each police their own
 * width, so the run header and the closing scoreboard were clean — but the
 * three hundred lines BETWEEN them are hand-composed template literals
 * (narrated tool calls, attempt banners, gate verdicts, worker receipts), and
 * nothing checked those. Replaying a finished run through replay-log.mjs put
 * numbers on it for the first time: 87 of 352 lines ran past 80 columns, the
 * worst at 176. A terminal wraps at the window edge with ZERO indent, so each
 * of those returned to column 0 and visually merged with the next line — on a
 * screenshared demo the delegation evidence turned to pulp exactly where a
 * viewer is looking hardest. Auditing 48 call sites by eye is the kind of fix
 * that decays on the next edit, so the grid is enforced at the exit instead:
 * say()/sayErr() are the only writers, and they route through here.
 *
 * Three invariants make that safe to apply blindly:
 *   1. A line already within the grid is returned BYTE-IDENTICAL — so every
 *      pre-formatted block (boxes, rules, tables, kvBlock) passes through
 *      untouched, and this can never re-break something that was already right.
 *   2. Continuation lines are indented past the line's own lead (leading
 *      whitespace plus a "[C]"/"[C→G]" actor gutter), so a wrapped line still
 *      reads as one line and the gutter column stays uniquely the gutter's.
 *   3. Color survives, on logfmt's standing contract that painters wrap WHOLE
 *      phrases: a line that is one painted phrase (or nested ones, e.g.
 *      paint.bold(paint.magenta(x))) is unwrapped, split, and each fragment
 *      re-painted. A line with INTERIOR color is returned unchanged rather
 *      than corrupted — losing the grid on a rare line beats emitting a
 *      half-closed escape sequence into someone's terminal.
 * A token longer than the width is still never broken (wrapText's rule): an
 * absolute run-dir path stays one over-long, copy-pasteable line on purpose.
 */
export function fitLine(text, width = W + 4) {
  return String(text).split("\n").map((line) => fitOne(line, width)).join("\n");
}

function fitOne(line, width) {
  if (visibleLen(line) <= width) return line;                 // invariant 1
  // Painted whole-phrase, possibly nested: escapes at both ends, none inside.
  const painted = /^((?:\x1b\[[0-9;]*m)+)([^\x1b]*)((?:\x1b\[[0-9;]*m)+)$/.exec(line);
  const plain = painted ? painted[2] : line;
  if (!painted && HAS_ANSI.test(plain)) return line;          // invariant 3
  const repaint = painted ? (s) => painted[1] + s + painted[3] : (s) => s;
  // Lead = indent + optional actor gutter ("[C]   ", "[C→G] "). The elapsed
  // stamp "[+3:14]" is 7 chars inside the brackets and deliberately does not
  // match, so continuations never hide under a timestamp column.
  const lead = /^(\s*(?:\[[^\]\s]{1,5}\]\s*)?)/.exec(plain)[1];
  const cont = " ".repeat(Math.min(lead.length + 2, Math.max(0, width - 24)));
  const out = [];
  let cur = null;
  for (const word of plain.slice(lead.length).split(" ")) {
    if (cur === null) { cur = word; continue; }
    const cap = width - (out.length ? cont.length : lead.length);
    if (cur.length + 1 + word.length <= cap) cur += " " + word;
    else { out.push(cur); cur = word; }
  }
  if (cur !== null) out.push(cur);
  return [repaint(lead + out[0]), ...out.slice(1).map((l) => repaint(cont + l))].join("\n");
}

/**
 * The harness's ONLY stdout/stderr writers. Same call shape as console.log —
 * multiple arguments are space-joined — with fitLine applied on the way out,
 * which is what makes the 80-column grid a property of the program rather than
 * of whoever last edited a template literal. Every `console.log` in the kind
 * runners was swept to these on 2026-07-26; new print sites must use them too.
 */
export const say = (...args) => console.log(fitLine(args.join(" ")));
export const sayErr = (...args) => console.error(fitLine(args.join(" ")));

/**
 * Aligned label/value block under a banner or rule (labels dimmed), wrapped to
 * the shared 80-column grid with continuation lines under the value column.
 *
 * Color survives the wrap because logfmt's contract is that painters wrap WHOLE
 * phrases: a value that is one painted phrase is unwrapped, split, and each
 * fragment re-painted with the same code. A value with interior color (which
 * this module never produces) is left alone rather than corrupted.
 */
export function kvBlock(rows, indent = 2) {
  const labelW = Math.max(...rows.map(([k]) => k.length));
  const pad = " ".repeat(indent);
  const valueCol = indent + labelW + 2;
  const valueW = Math.max(24, W + 4 - valueCol);
  return rows.map(([k, v]) => {
    // A wholly-painted value: "\x1b[2m…\x1b[0m" with no interior escapes.
    const whole = /^\x1b\[([0-9;]*)m([^\x1b]*)\x1b\[0m$/.exec(String(v));
    const plain = whole ? whole[2] : String(v);
    const repaint = whole ? (s) => `\x1b[${whole[1]}m${s}\x1b[0m` : (s) => s;
    // Interior color that isn't a single whole-phrase paint: don't touch it.
    if (!whole && HAS_ANSI.test(plain)) {
      return pad + paint.dim(k.padEnd(labelW)) + "  " + v;
    }
    const [first, ...rest] = wrapText(plain, valueW);
    return [pad + paint.dim(k.padEnd(labelW)) + "  " + repaint(first),
      ...rest.map((l) => " ".repeat(valueCol) + repaint(l))].join("\n");
  }).join("\n");
}

/**
 * Plain-text table for the final per-stage ledger. `aligns[i] === "r"`
 * right-aligns a column (numbers); everything else left-aligns.
 */
export function table(headers, rows, aligns = []) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => "  " + cells.map((cel, i) =>
    aligns[i] === "r" ? String(cel).padStart(widths[i]) : String(cel).padEnd(widths[i])
  ).join("  ");
  return [
    paint.dim(line(headers)),
    paint.dim("  " + widths.map((w) => "─".repeat(w)).join("──")),
    ...rows.map((r) => line(r)),
  ].join("\n");
}

/**
 * Roll a stage's attempt records (the same objects that land in the
 * manifest) up into display totals: wall seconds, driver cost/turns, the
 * delegation count and the worker's real token split from its usage
 * sidecars. Null-honest: usd/turns stay null when no attempt reported them
 * (a killed CLI), rather than showing a fake 0.
 *
 * CACHED INPUT + WORKER TOOL CALLS (added 2026-07-26). gemini_worker.py has
 * always written `cached_content_token_count` and `tool_call_count` into its
 * sidecar, and the display layer has always thrown both away. Both are
 * demo-critical and neither is recoverable after the fact from the printed
 * line, so both are rolled up here:
 *
 *   cached — on the 2026-07-26 uptime-ping delegated run, 1,409,518 of the
 *     1,634,042 input tokens (86.3%) were CACHE READS. Vertex bills a cache
 *     read far below a fresh input token, so pricing the undifferentiated
 *     `prompt` figure overstates the worker's cost several-fold — in the
 *     expensive direction, in a Google-facing tokenomics study, in front of
 *     the team that built the cache. `fresh` (prompt − cached) is the number
 *     a cost model should actually multiply.
 *   toolCalls — one `delegation` is not one model call: it is a full agentic
 *     session inside the Antigravity SDK. That same run showed 6 delegations
 *     containing 88 tool calls (24 in EXECUTE alone). Printing only
 *     "1 delegation(s)" makes the worker look like a single autocomplete
 *     round-trip and understates what the SDK actually did.
 */
export function attemptTotals(attempts = []) {
  const t = {
    attempts: attempts.length, wall: 0, usd: null, turns: null,
    delegations: 0, sidecars: 0, toolCalls: 0,
    // Worker identity as the worker ITSELF recorded it, not as the policy
    // requested it. These two can differ (a region fallback, a resolved model
    // alias), and the run log should report what actually executed — the same
    // reason the driver's model pin is verified against the session's own
    // resolved id rather than trusted from the policy file.
    workerModel: null, region: null,
    tokens: { prompt: 0, cached: 0, fresh: 0, output: 0, thinking: 0, total: 0 },
  };
  for (const a of attempts) {
    t.wall += a.wall_seconds ?? 0;
    if (a.cost_usd != null) t.usd = (t.usd ?? 0) + a.cost_usd;
    if (a.num_turns != null) t.turns = (t.turns ?? 0) + a.num_turns;
    t.delegations += a.delegation_calls ?? 0;
    for (const s of a.worker_usage?.sidecars ?? []) {
      t.sidecars += 1;
      t.toolCalls += s.tool_call_count ?? 0;
      t.workerModel ??= s.model ?? null;
      t.region ??= s.vertex_location ?? null;
      const u = s.usage ?? {};
      t.tokens.prompt += u.prompt_token_count ?? 0;
      // Older sidecars (pre-2026-07-26 runs) have no cached field. Absent
      // reads as 0 cached, which makes `fresh` collapse to `prompt` — the
      // pre-cache-awareness behaviour, i.e. the conservative direction.
      t.tokens.cached += u.cached_content_token_count ?? 0;
      t.tokens.output += u.candidates_token_count ?? 0;
      t.tokens.thinking += u.thoughts_token_count ?? 0;
      t.tokens.total += u.total_token_count ?? 0;
    }
  }
  t.tokens.fresh = Math.max(0, t.tokens.prompt - t.tokens.cached);
  return t;
}

/** Cache-hit share of input tokens as a whole percent; null when no input. */
export const cachePct = (tokens) =>
  tokens?.prompt ? Math.round((tokens.cached / tokens.prompt) * 100) : null;

/**
 * One-line worker token summary for a stage footer, cache-aware:
 *   "561,766 tok · in 550,298 (87% cached) · out 5,614 · think 5,854"
 * Fits an 80-column terminal. The cache share rides along with the input
 * figure rather than sitting in its own column because the two are only
 * meaningful together — see the costing note in attemptTotals.
 */
export function tokenSplit(tokens) {
  if (!tokens || !tokens.total) return "0";
  const pct = cachePct(tokens);
  return `${fmtInt(tokens.total)} tok · in ${fmtInt(tokens.prompt)}` +
    (pct != null && tokens.cached ? ` (${pct}% cached)` : "") +
    ` · out ${fmtInt(tokens.output)}` +
    (tokens.thinking ? ` · think ${fmtInt(tokens.thinking)}` : "");
}

/**
 * Full worker token breakdown as kvBlock rows, for the run's closing frame
 * where there is room to spell it out. Separates the two input figures that
 * a cost model treats differently, and states plainly that only `fresh`
 * should be priced at the input rate — the run log is where a reviewer forms
 * their cost intuition, so the caveat belongs on screen, not in a doc.
 */
export function tokenLedgerRows(tokens, { indentLabel = "" } = {}) {
  if (!tokens || !tokens.total) return [];
  const pct = cachePct(tokens);
  return [
    [`${indentLabel}input total`, `${fmtInt(tokens.prompt)} tokens`],
    [`${indentLabel}  cache reads`, `${fmtInt(tokens.cached)}` +
      (pct != null ? ` (${pct}% of input — billed at the cache rate)` : "")],
    [`${indentLabel}  fresh input`, `${fmtInt(tokens.fresh)} (this is the figure to price at the input rate)`],
    [`${indentLabel}output`, `${fmtInt(tokens.output)} tokens`],
    ...(tokens.thinking ? [[`${indentLabel}thinking`, `${fmtInt(tokens.thinking)} tokens`]] : []),
  ];
}

/**
 * ---- ACTOR ATTRIBUTION -----------------------------------------------------
 * A delegated cell's single most misread fact is "who actually wrote the
 * code". The run header says it, the footer says it, and in between 200
 * lines scroll past with no marking at all — so a viewer joining mid-scroll
 * (i.e. anyone watching a screenshare) cannot tell the harness from the
 * worker. These three tags put the answer in a fixed left gutter on every
 * narrated line: skim the left edge and the division of labour reads without
 * parsing a single word, which is the entire thesis of the experiment.
 *
 * Fixed width by construction so the clock stamps that follow stay in one
 * column. Non-delegated runs pass `delegated: false` and get plain indent —
 * an all-Opus run has only one actor, and a gutter that never varies is
 * noise.
 */
export const ACTOR = {
  driver: "[C]",   // Claude Code — the harness. Orchestrates; never edits code.
  worker: "[G]",   // Gemini via the Antigravity SDK — writes every shipped line.
  handoff: "[C→G]", // the delegation itself: harness handing work to the worker
  script: "[·]",   // harness-owned scripted step (verify/report) — no model call
};

/** Left gutter for a narrated line; "" when the run has only one actor. */
export const gutter = (tag, delegated = true) =>
  delegated ? `${String(tag).padEnd(5)} ` : "  ";

/**
 * ---- ORIENTATION -----------------------------------------------------------
 * The run header states the configuration exhaustively and assumes the reader
 * already knows what a delegated cell IS. For this log's actual audience —
 * a partner team watching a screenshare, who know Gemini and Antigravity but
 * have never seen our harness — that assumption fails in the first ten
 * seconds, and everything after it is read wrongly.
 *
 * Four sentences, printed once, before the configuration dump: who is in
 * charge, who writes the code, how that is enforced, and how to read the
 * scariest-looking lines in the log. The last one matters most — without it
 * a screen full of yellow BLOCKED lines reads as a broken run rather than as
 * the control that makes the whole experiment credible.
 */
export function watchingBlock({ driver, worker, cable } = {}) {
  // Wrapped at render time, not hand-broken: the model ids are interpolated and
  // vary in length (claude-opus-4-6 / gemini-3.5-flash vs gemini-2.5-flash), so
  // fixed line breaks put this paragraph past 80 columns on some runs and not
  // others. Indent 4, so the wrap width is the shared grid minus that.
  const paras = [
    `${driver ?? "Claude Code"} runs the pipeline. It is NOT allowed to write ` +
      "code: its edit tools are removed and the repository stays locked until " +
      `it hands work to ${worker ?? "the worker"}${cable ? ` via ${cable}` : ""}. ` +
      "Every shipped line comes back from the worker.",
    "Lines marked BLOCKED are that lock holding — they are the proof the " +
      "delegation is real, not errors.",
  ];
  const body = paras
    .map((p) => wrapText(p, W - 4).map((l) => `    ${l}`).join("\n"))
    .join("\n\n");
  return paint.bold("  WHAT YOU ARE WATCHING") + "\n" + body;
}

/**
 * ---- COST, SAID PLAINLY ----------------------------------------------------
 * "driver-side (CLI-modeled)" is precise and reliably misunderstood: the
 * first question it draws in a demo is "so is that real money?". These rows
 * answer that before it is asked, and keep the two economies visibly
 * separate — a Max seat that issues no invoice, and metered Vertex tokens
 * that do. Deliberately no worker dollar figure: the rate pin is verified
 * per-run against the published Vertex rate before any number is claimed
 * (the rule that caught the Opus 3× pin), so the log states the tokens and
 * names the pricing basis rather than inventing a total.
 */
export function costRows(totals, { delegated, workerModel, region } = {}) {
  const rows = [
    ["Claude harness", `${totals.usd != null ? fmtUsd(totals.usd) : "n/a"} — modeled by the CLI on a Max ` +
      "seat · no invoice is issued for this"],
  ];
  if (delegated) {
    rows.push(["Gemini worker", `${fmtInt(totals.tokens.fresh)} fresh + ${fmtInt(totals.tokens.cached)} cached ` +
      `input, ${fmtInt(totals.tokens.output)} output — metered on Vertex` +
      (region ? ` (${region})` : "") + (workerModel ? ` · ${workerModel}` : "")]);
    rows.push(["", paint.dim("dollar figure intentionally omitted until the rate pin is verified " +
      "against the published Vertex rate for this model")]);
  }
  return rows;
}
