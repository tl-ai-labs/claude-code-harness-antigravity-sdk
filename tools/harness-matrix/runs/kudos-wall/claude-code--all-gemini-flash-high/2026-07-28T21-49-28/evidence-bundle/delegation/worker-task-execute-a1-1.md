# Implement Kudos Wall — NestJS + Prisma + SQLite

You are implementing a "Kudos Wall" feature for a service-web scaffold (NestJS + Prisma + SQLite). The scaffold uses vitest with globals enabled and @nestjs/testing.

## Critical constraints

- You may ONLY create/modify files inside: `src/modules/**`, `test/modules/**`, and `prisma/schema.prisma`
- In `prisma/schema.prisma`, ONLY append below the `MODEL SLOT` marker — everything above the marker must remain byte-identical
- Do NOT touch package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs, or lockfiles
- Do NOT run git commit

## Step-by-step implementation

### 1. Prisma schema

Read `prisma/schema.prisma` to find the `MODEL SLOT` marker. Append a `Kudo` model below it with these fields:
- `id` — Int, @id, @default(autoincrement())
- `sender` — String
- `receiver` — String
- `message` — String
- `createdAt` — DateTime, @default(now())

Then run prisma generate:
```
/harness/runs/kudos-wall/claude-code--all-gemini-flash-high/2026-07-28T21-49-28/out/run-in-env.sh "pnpm exec prisma generate"
```

### 2. Services (src/modules/kudos/)

Create `src/modules/kudos/prisma.service.ts`:
- An @Injectable() class extending PrismaClient that implements OnModuleInit (from @nestjs/common)
- In onModuleInit(), call this.$connect()

Create `src/modules/kudos/kudos.service.ts`:
- An @Injectable() class that injects PrismaService via constructor
- `create(data: { sender: string; receiver: string; message: string })` — uses prisma.kudo.create({ data }) and returns the result
- `findAll()` — uses prisma.kudo.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) and returns the result

### 3. Controller and module registration

Create `src/modules/kudos/kudos.controller.ts`:
- Decorated with @Controller('kudos')
- POST handler (NestJS @Post() automatically returns 201):
  - Receives @Body() body: any
  - Manual validation (no class-validator) for fields sender, receiver, message:
    - Field must be present in body — if missing, throw BadRequestException("<field> is required")
    - Field must be typeof string — if not, throw BadRequestException("<field> must be a string")
    - Trim the field value. After trimming:
      - If empty, throw BadRequestException("<field> must not be empty")
      - sender/receiver: max 100 chars — if exceeded, throw BadRequestException("<field> must not exceed 100 characters")
      - message: max 500 chars — if exceeded, throw BadRequestException("<field> must not exceed 500 characters")
  - On success: call kudosService.create() with trimmed values, return result
- GET handler: call kudosService.findAll(), return result (NestJS defaults to 200)

Create `src/modules/kudos/kudos.module.ts`:
- @Module with controllers: [KudosController], providers: [KudosService, PrismaService]
- Export the class as KudosModule

Modify `src/modules/index.ts`:
- Read it first to see its current shape
- Import KudosModule from './kudos/kudos.module'
- Add KudosModule to the MODULES array

### 4. Integration tests

Create `test/modules/kudos.spec.ts` — integration tests against real SQLite:
- Use `@nestjs/testing` Test.createTestingModule importing KudosModule
- Use supertest (import from 'supertest') with app.getHttpServer()
- Setup: beforeAll creates/compiles/inits the NestJS app; afterAll closes it; beforeEach clears the kudo table via prisma.kudo.deleteMany()
- Test cases to implement:
  1. POST valid payload → 201, response has id (number), trimmed sender/receiver/message, createdAt (ISO string)
  2. POST trims whitespace from sender, receiver, message
  3. POST missing field → 400
  4. POST empty string field → 400
  5. POST whitespace-only field → 400
  6. POST sender exceeding 100 chars → 400
  7. POST receiver exceeding 100 chars → 400
  8. POST message exceeding 500 chars → 400
  9. POST non-string field (e.g. number) → 400
  10. GET when DB empty → 200 with []
  11. GET returns all kudos sorted by createdAt desc, id desc
  12. GET /health reports modules_registered: 1

### 5. Verify

After all files are created, run:
```
/harness/runs/kudos-wall/claude-code--all-gemini-flash-high/2026-07-28T21-49-28/out/run-in-env.sh "pnpm build"
```
Then:
```
/harness/runs/kudos-wall/claude-code--all-gemini-flash-high/2026-07-28T21-49-28/out/run-in-env.sh "pnpm test"
```

Fix any errors and re-run until BOTH exit zero.
