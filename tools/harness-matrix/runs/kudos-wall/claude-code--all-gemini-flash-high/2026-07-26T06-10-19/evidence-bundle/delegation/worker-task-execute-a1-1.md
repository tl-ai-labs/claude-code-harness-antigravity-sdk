# Implement Kudos Wall — All 5 Packets

You are implementing a "Kudos Wall" feature in a NestJS + Prisma + SQLite service-web scaffold. You must implement all 5 packets described below, creating/modifying files ONLY inside the allowed slots.

## Allowed file slots
- `src/modules/**` — your module code
- `test/modules/**` — your tests
- `prisma/schema.prisma` — APPEND ONLY below the `// ═══ MODEL SLOT` marker

Do NOT touch any other files (package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs, etc.).

## Scaffold conventions
- NestJS modules go in `src/modules/<name>/`
- Tests go in `test/modules/<name>/`
- Register modules in `src/modules/index.ts` via the `MODULES` array
- vitest with globals enabled (`describe`/`it`/`expect` available without imports)
- `@nestjs/testing` is installed for integration tests
- `supertest` is available
- package.json is chassis-locked — do NOT modify it
- No `class-validator` or `class-transformer` — validation is manual
- No global route prefix in the app
- Commands: `pnpm build`, `pnpm test`

## Packet 1 — Append Kudos model to prisma/schema.prisma

Read `prisma/schema.prisma`. Find the `MODEL SLOT` marker comment. Append the following Prisma model BELOW that marker. Do NOT alter anything above the marker (the datasource, generator, and AppMeta model must remain byte-identical).

The model to add:
```prisma
model Kudos {
  id            String   @id @default(uuid())
  senderName    String
  recipientName String
  message       String
  createdAt     DateTime @default(now())
}
```

After appending, run `npx prisma generate` and `npx prisma db push --accept-data-loss` to regenerate the Prisma client and sync the DB schema.

## Packet 2 — Create PrismaService

Create `src/modules/kudos/prisma.service.ts`:
- It should extend `PrismaClient` from `@prisma/client`
- Implement `OnModuleInit` (call `this.$connect()`) and `OnModuleDestroy` (call `this.$disconnect()`) from `@nestjs/common`
- Mark it as `@Injectable()`

## Packet 3 — Implement KudosService

Create `src/modules/kudos/kudos.service.ts`:
- `@Injectable()` decorator
- Constructor injection of `PrismaService`
- `create(dto)` method that:
  1. Validates all three fields (`senderName`, `recipientName`, `message`) are present, non-null, and strings — throws `BadRequestException` if not
  2. Trims all three fields
  3. Checks each trimmed value has length ≥ 1 — throws `BadRequestException` if any is empty after trim
  4. Checks `senderName` and `recipientName` ≤ 100 chars, `message` ≤ 500 chars after trim — throws `BadRequestException` if exceeded
  5. Creates via `this.prisma.kudos.create({ data: { senderName, recipientName, message } })`
  6. Returns the record with `createdAt` serialized as ISO string (`.toISOString()`)
- `findAll()` method that:
  1. Queries `this.prisma.kudos.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })`
  2. Maps each record to serialize `createdAt` to ISO string
  3. Returns the array

## Packet 4 — Create Controller, Module, and register

Create `src/modules/kudos/kudos.controller.ts`:
- `@Controller('kudos')`
- `@Post()` handler with `@HttpCode(201)`, receives `@Body() body`, delegates to `service.create(body)`, returns the result
- `@Get()` handler that delegates to `service.findAll()`, returns the array

Create `src/modules/kudos/kudos.module.ts`:
- `@Module({ controllers: [KudosController], providers: [KudosService, PrismaService] })`
- `export class KudosModule {}`

Modify `src/modules/index.ts`:
- Import `KudosModule` from `'./kudos/kudos.module'`
- Set the `MODULES` array to `[KudosModule]`

## Packet 5 — Integration tests

Create `test/modules/kudos/kudos.spec.ts` with integration tests using `@nestjs/testing` and `supertest`.

Structure:
- Import `Test` from `@nestjs/testing`, `INestApplication` from `@nestjs/common`, and supertest
- Import `KudosModule` from the module
- Import `PrismaService` from the prisma service
- `beforeAll`: create a NestJS testing module with `KudosModule`, create and init the app
- `afterAll`: close the app
- `beforeEach`: clean the kudos table (`DELETE FROM Kudos` or `prisma.kudos.deleteMany()`)

Test cases to cover:
1. **AC-1**: POST /kudos with valid data including whitespace padding → 201, fields are trimmed, id matches UUID format, createdAt is ISO date string
2. **AC-2**: POST /kudos with all-whitespace senderName → 400
3. **AC-3**: POST /kudos with senderName of 101 chars → 400; POST /kudos with message of 501 chars → 400
4. **FR-3**: POST /kudos with missing field (e.g., no message) → 400
5. **AC-4**: GET /kudos when empty → 200, empty array `[]`
6. **AC-5**: GET /kudos after two creates → most recent first (array[0] is the newer record)
7. **AC-7**: GET /health → 200, body includes `modules_registered: 1`

For the supertest import, try `import request from 'supertest'`. If that doesn't work with the module setup, use `import * as request from 'supertest'`.

After implementing everything, run `pnpm build` and `pnpm test` to verify everything passes.
