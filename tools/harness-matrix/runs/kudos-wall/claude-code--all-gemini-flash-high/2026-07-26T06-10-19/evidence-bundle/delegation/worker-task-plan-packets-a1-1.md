You are planning the implementation of a "Kudos Wall" feature for a NestJS service-web scaffold. Your job is READ-ONLY: analyze the repository structure and the design, then propose an ordered list of task packets. Do NOT modify any files.

## What to examine

1. Read `prisma/schema.prisma` to see the MODEL SLOT marker and existing structure.
2. Read `src/modules/index.ts` to see the current MODULES array.
3. Read `src/platform/` to understand the chassis (AppModule, HealthController) so packets don't duplicate existing wiring.
4. Read `test/` to understand the existing test setup and conventions.
5. Read `package.json` to see available dependencies.

## Design summary

The Kudos Wall needs these components, all within scaffold slots (src/modules/**, test/modules/**, prisma/schema.prisma):

1. **Prisma schema**: Append a `Kudos` model (id String @id @default(uuid()), senderName String, recipientName String, message String, createdAt DateTime @default(now())) below the MODEL SLOT marker in prisma/schema.prisma.
2. **PrismaService**: A PrismaClient wrapper with OnModuleInit/OnModuleDestroy lifecycle hooks in src/modules/kudos/prisma.service.ts.
3. **KudosService**: Business logic — trim all string fields, validate presence (non-empty after trim), validate length (senderName ≤100, recipientName ≤100, message ≤500), throw BadRequestException on failure; create via prisma.kudos.create; list via prisma.kudos.findMany with orderBy [createdAt desc, id desc]; serialize createdAt to ISO string.
4. **KudosController**: @Controller('kudos') with @Post() returning 201 and @Get() returning 200.
5. **KudosModule**: @Module wiring controller, service, and prisma service.
6. **Registration**: Export KudosModule in the MODULES array in src/modules/index.ts.
7. **Tests**: Integration tests in test/modules/kudos/kudos.spec.ts covering all acceptance criteria (AC-1 through AC-7): valid creation with trimming, blank field rejection, over-length rejection, empty list, ordering, tie-breaking, and health module count.

## Your task

Decompose this into 4-6 ordered task packets. Each packet must:
- Have a kebab-case `id`, a one-line `title`, a concrete `goal` (what "done" looks like), and `files_hint` (repo-relative paths within slots only).
- Be ordered so each packet only depends on earlier packets.
- Together cover the ENTIRE design — implementing all packets in order yields a working, tested feature.

Output ONLY a JSON array of packet objects, nothing else. Example format:
```json
[
  {
    "id": "example-packet",
    "title": "Example packet title",
    "goal": "What done looks like concretely",
    "files_hint": ["src/modules/example/file.ts"]
  }
]
```
