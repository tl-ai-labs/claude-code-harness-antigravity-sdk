# Implement Kudos Wall Feature — All 6 Packets

You are implementing a "Kudos Wall" feature in a NestJS + Prisma scaffold. Read the existing files first to understand the current codebase structure, then implement all 6 packets in order.

## CRITICAL SCAFFOLD RULES
- Only create/modify files in: `src/modules/**`, `test/modules/**`, and `prisma/schema.prisma`
- In `prisma/schema.prisma`, ONLY APPEND below the `MODEL SLOT` marker — do NOT touch anything above it (the datasource, generator, and AppMeta model must remain byte-identical)
- Do NOT modify: package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs, or any lockfiles

## Files to read first
- `prisma/schema.prisma` — find the MODEL SLOT marker
- `src/modules/index.ts` — see how MODULES array is currently exported
- `test/` directory structure — understand where test files go
- `src/platform/` — understand the chassis (read-only, do not modify)

## Packet 1: schema-kudos-model
Append a `Kudos` model below the MODEL SLOT marker in `prisma/schema.prisma`. The model needs:
- `id`: Int, primary key, auto-increment
- `sender`: String
- `recipient`: String  
- `message`: String
- `createdAt`: DateTime with default now()

After appending, run `npx prisma generate` to generate the Prisma client.

## Packet 2: prisma-service
Create `src/modules/kudos/prisma.service.ts` — an `@Injectable()` NestJS service that extends `PrismaClient` and implements `OnModuleInit`. In the `onModuleInit()` method, call `this.$connect()`.

## Packet 3: kudos-service
Create `src/modules/kudos/kudos.service.ts` — an `@Injectable()` service that injects `PrismaService`. It needs two methods:
- `create(data: { sender: string; recipient: string; message: string })` — creates a kudos record via Prisma and returns it
- `findAll()` — returns all kudos records ordered by `createdAt` descending, then `id` descending as a tie-breaker

## Packet 4: kudos-controller
Create `src/modules/kudos/kudos.controller.ts` — a `@Controller('kudos')` with two handlers:

**POST handler** (`@Post()`, `@HttpCode(201)`):
Runs 5-step validation on the request body before delegating to KudosService:
1. **Presence** — `sender`, `recipient`, `message` must not be undefined or null → throw `BadRequestException`
2. **Type** — each must be `typeof === 'string'` → throw `BadRequestException`
3. **Trim** — trim all three values
4. **Non-empty** — each trimmed value must have length > 0 → throw `BadRequestException`
5. **Max length** — sender ≤ 50, recipient ≤ 50, message ≤ 500 (after trim) → throw `BadRequestException`

Then call `this.kudosService.create({ sender, recipient, message })` with the trimmed values.

**GET handler** (`@Get()`):
Simply delegates to `this.kudosService.findAll()` and returns the result.

## Packet 5: kudos-module-registration
Create `src/modules/kudos/kudos.module.ts` — a `@Module` that declares:
- `controllers: [KudosController]`
- `providers: [KudosService, PrismaService]`

Then update `src/modules/index.ts` to import `KudosModule` and export it in the `MODULES` array.

## Packet 6: kudos-tests
Create `test/modules/kudos.spec.ts` with integration tests using vitest (globals are enabled — `describe`/`it`/`expect` work without imports) and `@nestjs/testing`.

Use `Test.createTestingModule` importing `KudosModule`, get the app and PrismaService, init the app in `beforeAll`, clean the `kudos` table with `deleteMany` in `beforeEach`, close the app in `afterAll`.

Use `supertest` (`import request from 'supertest'`) for HTTP testing via `app.getHttpServer()`.

Cover these 9 test cases:
1. POST with valid data (include whitespace padding to verify trimming) returns 201 with integer `id`, trimmed strings, and ISO-8601 `createdAt`
2. POST with a missing field (e.g., no `message`) returns 400
3. POST with whitespace-only field returns 400
4. POST with non-string field (e.g., `sender: 123`) returns 400
5. POST with sender > 50 chars returns 400
6. POST with recipient > 50 chars returns 400
7. POST with message > 500 chars returns 400
8. GET after two sequential POSTs (with a small delay between them) returns the later record first
9. GET with records having the same `createdAt` (create them directly via Prisma with an explicit timestamp) returns higher `id` first

## Verification
After implementing all packets, run:
1. `npx prisma generate`
2. `pnpm build`
3. `pnpm test`

If any command fails, read the error output and fix the issues. Iterate until both `pnpm build` and `pnpm test` exit zero.
