/**
 * CHASSIS TESTS — platform-owned. These prove the booklet itself isn't
 * broken: if these fail, no model output can be judged fairly.
 * Model-written tests live in test/modules/** — never here.
 */

import { describe, expect, it } from "vitest";
import { HealthController } from "../../src/platform/health.controller";
import { MODULES } from "../../src/modules";
import { PORT, SCAFFOLD_ID, SCAFFOLD_VERSION } from "../../src/platform/config";

describe("chassis", () => {
  it("health contract answers", () => {
    const res = new HealthController().health();
    expect(res.ok).toBe(true);
    expect(res.scaffold).toBe(SCAFFOLD_ID);
    expect(res.version).toBe(SCAFFOLD_VERSION);
    expect(res.modules_registered).toBe(MODULES.length);
  });

  it("module slot is a well-formed registration list", () => {
    expect(Array.isArray(MODULES)).toBe(true);
  });

  it("standard port configuration", () => {
    expect(PORT).toBeGreaterThan(0);
  });
});
