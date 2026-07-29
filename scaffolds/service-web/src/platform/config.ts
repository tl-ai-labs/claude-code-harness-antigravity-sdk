/**
 * CHASSIS FILE — platform-owned. Models never modify this.
 * Standard configuration: every run of every study boots the same way,
 * which is what makes demos and screenshot capture comparable.
 */

export const PORT = Number(process.env.PORT ?? 4000);
export const SCAFFOLD_ID = "service-web";
export const SCAFFOLD_VERSION = "0.1.0";
