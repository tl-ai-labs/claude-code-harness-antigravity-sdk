// CHASSIS FILE — platform-owned. Globals on so model-written specs can use
// describe/it/expect without imports (the standard vitest idiom).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.{test,spec}.ts"],
  },
});
