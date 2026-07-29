/**
 * CHASSIS FILE — deterministic seed harness. Same seed data on every run of
 * every study → demos and screenshots are comparable across policies.
 * Models extend seeding via their own module fixtures, not by editing this.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED = [
  { key: "seeded_at_logical", value: "run-start" },
  { key: "scaffold", value: "service-web@0.1.0" },
];

for (const row of SEED) {
  await prisma.appMeta.upsert({ where: { key: row.key }, update: { value: row.value }, create: row });
}
console.log(`seeded ${SEED.length} AppMeta rows (deterministic)`);
await prisma.$disconnect();
