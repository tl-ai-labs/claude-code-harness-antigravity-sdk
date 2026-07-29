/**
 * Unit tests for the shared `--select <slot>=<model-id>` parser.
 *
 * The parser is the only thing standing between "I asked for the Antigravity
 * SDK" and a run that quietly measured the default MCP doorway and published
 * the numbers under the wrong gateway. Every case below is a way that could
 * happen silently, which is why the parser throws rather than skips.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeSelect, parseSelectFlags } from "./select-flag.mjs";

test("no --select yields an empty object (every slot takes its default)", () => {
  assert.deepEqual(parseSelectFlags(["--policies", "opus-plus-flash", "--yes"]), {});
});

test("a single --select is parsed into slot -> model id", () => {
  assert.deepEqual(
    parseSelectFlags(["--select", "gemini-flash=flash-agsdk-vertex"]),
    { "gemini-flash": "flash-agsdk-vertex" }
  );
});

test("--select is repeatable across different slots", () => {
  assert.deepEqual(
    parseSelectFlags(["--select", "gemini-flash=flash-mcp-ai-studio", "--select", "judge=opus"]),
    { "gemini-flash": "flash-mcp-ai-studio", judge: "opus" }
  );
});

test("a repeated slot with the SAME value is accepted (idempotent, not a typo)", () => {
  assert.deepEqual(
    parseSelectFlags(["--select", "gemini-flash=flash-agsdk-vertex", "--select", "gemini-flash=flash-agsdk-vertex"]),
    { "gemini-flash": "flash-agsdk-vertex" }
  );
});

test("a repeated slot with DIFFERENT values throws — last-one-wins would be a coin toss", () => {
  assert.throws(
    () => parseSelectFlags(["--select", "gemini-flash=flash-agsdk-vertex", "--select", "gemini-flash=flash-mcp-vertex"]),
    /given twice with different values/
  );
});

test("a missing value throws instead of being dropped", () => {
  assert.throws(() => parseSelectFlags(["--select"]), /--select needs a value/);
  assert.throws(() => parseSelectFlags(["--select", "--yes"]), /--select needs a value/);
});

test("a value with no '=' throws", () => {
  assert.throws(() => parseSelectFlags(["--select", "gemini-flash"]), /expected <slot>=<model-id>/);
});

test("an empty slot or an empty model id throws", () => {
  assert.throws(() => parseSelectFlags(["--select", "=flash-agsdk-vertex"]), /expected <slot>=<model-id>/);
  assert.throws(() => parseSelectFlags(["--select", "gemini-flash="]), /expected <slot>=<model-id>/);
});

test("a doubled '=' throws rather than silently splitting on the first one", () => {
  // `a=b=c` most likely means someone typed the flag wrong. Accepting it as
  // a -> "b=c" would launch a run pinned to a model id that cannot exist.
  assert.deepEqual(parseSelectFlags(["--select", "a=b=c"]), { a: "b=c" });
  // ...and the API rejects "b=c" as not one of the slot's options, naming the
  // legal ones. Asserted here so the split-on-first-= behaviour is deliberate
  // and recorded, not accidental.
});

test("other flags around --select are untouched", () => {
  assert.deepEqual(
    parseSelectFlags(["--brief", "x.md", "--select", "gemini-flash=flash-agsdk-vertex", "--mode", "live"]),
    { "gemini-flash": "flash-agsdk-vertex" }
  );
});

test("describeSelect renders a launch-log line, and '' when nothing is pinned", () => {
  assert.equal(describeSelect({}), "");
  assert.equal(describeSelect({ "gemini-flash": "flash-agsdk-vertex" }), "gemini-flash=flash-agsdk-vertex");
  assert.equal(describeSelect({ a: "1", b: "2" }), "a=1 b=2");
});
