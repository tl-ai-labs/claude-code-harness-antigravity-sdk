/**
 * CHASSIS FILE — platform-owned. Models never modify this.
 * Boots the app: platform pieces + whatever modules are registered in
 * src/modules/index.ts (the slot).
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { PORT } from "./platform/config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ["warn", "error"] });
  await app.listen(PORT);
  // eslint-disable-next-line no-console
  console.log(`service-web scaffold listening on :${PORT}`);
}

void bootstrap();
