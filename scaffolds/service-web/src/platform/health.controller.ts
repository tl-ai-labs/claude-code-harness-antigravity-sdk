/**
 * CHASSIS FILE — platform-owned. Models never modify this.
 * GET /health — the "it boots" contract every run answers identically.
 */

import { Controller, Get } from "@nestjs/common";
import { SCAFFOLD_ID, SCAFFOLD_VERSION } from "./config";
import { MODULES } from "../modules";

@Controller("health")
export class HealthController {
  @Get()
  health(): { ok: boolean; scaffold: string; version: string; modules_registered: number } {
    return {
      ok: true,
      scaffold: SCAFFOLD_ID,
      version: SCAFFOLD_VERSION,
      modules_registered: MODULES.length,
    };
  }
}
