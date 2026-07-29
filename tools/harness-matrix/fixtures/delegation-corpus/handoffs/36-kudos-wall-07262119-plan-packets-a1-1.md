You are planning the implementation of a "Kudos Wall" feature for a NestJS + Prisma service-web scaffold. This is a READ-ONLY planning task — do NOT modify any files in the repository.

## Your job

Analyze the repository structure (especially prisma/schema.prisma, src/modules/index.ts, and the existing scaffold conventions) and then produce an ordered list of 2–8 task packets that decompose the following design into implementable units.

## Design to decompose

1. Prisma model `Kudos` (id Int autoincrement PK, from String, to String, message String, createdAt DateTime @default(now())) — appended below the `MODEL SLOT` marker in prisma/schema.prisma
2. PrismaService (extends PrismaClient, implements OnModuleInit, calls $connect()) at src/modules/prisma/prisma.service.ts
3. PrismaModule (@Module that provides and exports PrismaService) at src/modules/prisma/prisma.module.ts
4. KudosService (create method: trims fields + persists via prisma.kudos.create(); findAll method: returns all via prisma.kudos.findMany with orderBy [createdAt desc, id desc]) at src/modules/kudos/kudos.service.ts
5. KudosController (POST /kudos: validates body inline — all 3 fields must be present strings, trimmed length from/to 1-100, message 1-500, returns 400 on violation or 201 with saved record; GET /kudos: returns 200 with JSON array from findAll) at src/modules/kudos/kudos.controller.ts
6. KudosModule (@Module importing PrismaModule, registering KudosController and KudosService) at src/modules/kudos/kudos.module.ts
7. Register KudosModule in the MODULES array in src/modules/index.ts
8. Integration tests at test/modules/kudos.spec.ts using @nestjs/testing and vitest globals, covering: valid POST 201, whitespace trimming, missing field 400, non-string field 400, empty/whitespace-only field 400, from/to >100 chars 400, message >500 chars 400, GET empty 200 [], GET sorted by createdAt desc, GET tie-breaking by id desc

## Dependency order

schema → prisma module → kudos service → kudos controller + kudos module + index.ts registration → tests

## Output format

Return ONLY a valid JSON array (no markdown fences, no commentary). Each element must have:
- "id": kebab-case unique identifier (e.g. "schema-kudos-model")
- "title": one-line description
- "goal": what "done" looks like for this packet, concretely
- "files_hint": array of repo-relative paths this packet will touch (must be inside allowed slots: src/modules/**, test/modules/**, or prisma/schema.prisma)

Look at the repo to understand the scaffold structure before producing your answer. Key files to examine:
- prisma/schema.prisma (find the MODEL SLOT marker)
- src/modules/index.ts (see how modules are registered)
- The scaffold directory structure
