# Task: Decompose Kudos Wall design into ordered implementation packets

You are in the PLAN-PACKETS stage of an SDLC pipeline. Your job is to analyze the finalized design and decompose it into 2–8 ordered task packets for the EXECUTE stage. This is a READ-ONLY stage — do NOT modify any files in the repository.

## Context

This is a "Kudos Wall" feature built on the service-web scaffold (NestJS + Prisma + SQLite + Vitest). The scaffold has strict slot rules — only these paths may be created/modified:
- `src/modules/**`
- `test/modules/**`
- `prisma/schema.prisma` (append below MODEL SLOT marker only)

## Design to decompose

**Data model**: A single Prisma model `Kudo` appended below the MODEL SLOT marker in `prisma/schema.prisma` with fields: id (Int, @id, @default(autoincrement())), sender (String), receiver (String), message (String), createdAt (DateTime, @default(now())).

**Module files to create**:
- `src/modules/kudos/prisma.service.ts` — PrismaClient wrapper extending PrismaClient, implements OnModuleInit, calls this.$connect() in onModuleInit().
- `src/modules/kudos/kudos.service.ts` — Injects PrismaService. create(data) calls prisma.kudo.create({data}). findAll() calls prisma.kudo.findMany({orderBy: [{createdAt:'desc'},{id:'desc'}]}).
- `src/modules/kudos/kudos.controller.ts` — @Controller('kudos'). POST handler: receives @Body(), manual validation (presence, typeof==='string', trim, length bounds for sender 1-100, receiver 1-100, message 1-500), throws BadRequestException on failure, calls service.create with trimmed values, returns 201. GET handler: calls service.findAll(), returns 200.
- `src/modules/kudos/kudos.module.ts` — @Module({ controllers: [KudosController], providers: [KudosService, PrismaService] }). Exported as KudosModule.

**File to modify**:
- `src/modules/index.ts` — import KudosModule, add to MODULES array.

**Tests**:
- `test/modules/kudos.spec.ts` — Uses @nestjs/testing Test.createTestingModule with real KudosModule against real SQLite. Tests cover: valid create (201 + trimmed fields), all validation failure cases (missing/empty/whitespace/over-length/non-string → 400), GET empty (200 + []), GET sorted (createdAt desc, id desc), health check (modules_registered: 1).

## Your deliverable

Read the repository to understand the scaffold structure (look at prisma/schema.prisma for the MODEL SLOT marker, src/modules/index.ts for the MODULES array, existing test patterns if any, package.json for available dependencies). Then produce an ordered list of 2–8 task packets.

Each packet must:
- Be a coherent unit of work with a verifiable goal
- Only depend on packets that come before it
- Only touch files inside the scaffold slots

Together, all packets must cover the ENTIRE design — implementing them in order must yield a fully working, tested service.

Output ONLY a JSON array with this exact shape (no markdown fences, no extra text before or after):

[
  {
    "id": "<kebab-case unique id>",
    "title": "<one-line title>",
    "goal": "<what done looks like for this packet, concretely>",
    "files_hint": ["<repository-relative slot path>", ...]
  }
]

IMPORTANT: Do NOT modify any files. Only READ the repository and output the JSON array.
