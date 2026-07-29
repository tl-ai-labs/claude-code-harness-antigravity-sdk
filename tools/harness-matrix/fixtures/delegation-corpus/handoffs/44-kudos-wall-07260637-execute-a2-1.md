# Implement Kudos Wall feature in the NestJS + Prisma + SQLite scaffold

## Context
You are working in a NestJS service-web scaffold with Prisma + SQLite. You must implement a "Kudos Wall" feature — a simple CRUD-like system for posting kudos between team members.

## CRITICAL CONSTRAINTS
- You may ONLY create/modify files in these slots:
  - `src/modules/**`
  - `test/modules/**`
  - `prisma/schema.prisma` (append only below the MODEL SLOT marker)
- Do NOT create ANY files outside these slots
- Do NOT create any `.db` files (like `prisma/test.db`) — the previous attempt FAILED because it created `prisma/test.db`
- Do NOT modify chassis files: package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs

## Steps to implement (in order)

### Step 1: Read existing files
First read these files to understand the existing structure:
- `prisma/schema.prisma` — find the MODEL SLOT marker
- `src/modules/index.ts` — see the existing MODULES array structure

### Step 2: Append Kudos model to prisma/schema.prisma
Below the MODEL SLOT marker (look for a comment like `// --- MODEL SLOT ---`), append:

```prisma
model Kudos {
  id        Int      @id @default(autoincrement())
  sender    String
  recipient String
  message   String
  createdAt DateTime @default(now())
}
```

Do NOT modify anything above the marker. Keep the marker line intact.

### Step 3: Create src/modules/kudos/prisma.service.ts
Create an `@Injectable()` class that extends `PrismaClient` and implements `OnModuleInit`. In `onModuleInit`, call `this.$connect()`.

### Step 4: Create src/modules/kudos/kudos.service.ts
Create a service that injects `PrismaService` and exposes:
- `create(data: { sender: string; recipient: string; message: string })` — calls `this.prisma.kudos.create({ data })`
- `findAll()` — calls `this.prisma.kudos.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })`

### Step 5: Create src/modules/kudos/kudos.controller.ts
Create a `@Controller('kudos')` with:
- `@Post() @HttpCode(201) create(@Body() body)` — runs 5-step validation then delegates to service:
  1. Presence: sender, recipient, message must not be undefined/null → 400
  2. Type: each must be typeof string → 400
  3. Trim: trim all three values
  4. Non-empty: each trimmed value must have length > 0 → 400
  5. Max length: sender ≤ 50, recipient ≤ 50, message ≤ 500 → 400
  On any failure, throw `BadRequestException` from `@nestjs/common`.
- `@Get() findAll()` — delegates to service

### Step 6: Create src/modules/kudos/kudos.module.ts
Standard NestJS `@Module` with controllers: [KudosController] and providers: [KudosService, PrismaService].

### Step 7: Update src/modules/index.ts
Import KudosModule and set `export const MODULES: any[] = [KudosModule];`

### Step 8: Run `npx prisma generate`
After all files are created, run `npx prisma generate` to generate the Prisma client with the new Kudos model.

### Step 9: Create test/modules/kudos.spec.ts
Write integration tests using vitest (globals enabled — describe/it/expect available without imports) + `@nestjs/testing`.

The tests must use the EXISTING dev.db database configured in the schema. Do NOT configure a separate test database. Do NOT create any .db files.

Tests to write:
1. POST with valid data returns created record with integer id, trimmed strings, and a createdAt Date
2. POST with missing field throws BadRequestException
3. POST with whitespace-only field throws BadRequestException
4. POST with non-string field (e.g., number) throws BadRequestException
5. POST with sender > 50 chars throws BadRequestException
6. POST with recipient > 50 chars throws BadRequestException
7. POST with message > 500 chars throws BadRequestException
8. GET after two POSTs (with delay) returns later record first (createdAt desc ordering)
9. GET with same createdAt returns higher id first (id desc tie-break)

Test structure:
- Use `Test.createTestingModule` with KudosController, KudosService, PrismaService
- In `beforeEach`, call `prismaService.kudos.deleteMany()` to clean the table
- In `afterAll`, disconnect prisma and close the app
- Test by calling controller methods directly (not HTTP), checking return values and thrown exceptions

## Files to create/modify (complete list)
1. `prisma/schema.prisma` — MODIFY (append only)
2. `src/modules/kudos/prisma.service.ts` — CREATE
3. `src/modules/kudos/kudos.service.ts` — CREATE
4. `src/modules/kudos/kudos.controller.ts` — CREATE
5. `src/modules/kudos/kudos.module.ts` — CREATE
6. `src/modules/index.ts` — MODIFY
7. `test/modules/kudos.spec.ts` — CREATE

NO OTHER FILES should be created or modified.
