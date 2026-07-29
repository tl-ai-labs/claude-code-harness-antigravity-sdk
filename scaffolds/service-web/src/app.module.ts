/**
 * CHASSIS FILE — platform-owned. Models never modify this.
 * The root module: mounts the platform controllers and every module the
 * slot (src/modules/index.ts) exports. Models register their work THERE,
 * never here.
 */

import { Module } from "@nestjs/common";
import { HealthController } from "./platform/health.controller";
import { MODULES } from "./modules";

@Module({
  imports: [...MODULES],
  controllers: [HealthController],
})
export class AppModule {}
