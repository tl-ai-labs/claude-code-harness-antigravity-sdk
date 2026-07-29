# Implement Kudos Wall Feature — All 5 Packets

You are implementing a "Kudos Wall" feature in a NestJS + Prisma service-web scaffold. Implement all 5 packets described below, in order.

## IMPORTANT: Read these files first
1. `prisma/schema.prisma` — find the `MODEL SLOT` marker; you will append below it
2. `src/modules/index.ts` — see its current content; you will modify it
3. `test/platform/` — read existing test files to understand testing patterns (supertest availability, vitest globals usage, app bootstrap)
4. `package.json` — check if `supertest` is a dependency

## Scaffold rules — MUST follow
- Create/modify files ONLY inside: `src/modules/**`, `test/modules/**`, and `prisma/schema.prisma`
- In `prisma/schema.prisma`, ONLY append below the `MODEL SLOT` marker — everything above must stay byte-identical
- Do NOT touch: package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs, any lockfile
- vitest globals are enabled: `describe`, `it`, `expect` work without imports
- `@nestjs/testing` is installed

## Packet 1: schema-kudos-model
Append the Kudos model below the MODEL SLOT marker in `prisma/schema.prisma`. The model needs:
- `id` — Int, primary key, auto-increment
- `from` — String
- `to` — String  
- `message` — String
- `createdAt` — DateTime, default to now()

## Packet 2: prisma-service-module
Create `src/modules/prisma/prisma.service.ts`:
- A class `PrismaService` that extends `PrismaClient` (from `@prisma/client`) and implements `OnModuleInit` (from `@nestjs/common`)
- The `onModuleInit()` method calls `await this.$connect()`
- Mark it `@Injectable()`

Create `src/modules/prisma/prisma.module.ts`:
- A `@Global()` `@Module()` that provides and exports `PrismaService`

## Packet 3: kudos-service
Create `src/modules/kudos/kudos.service.ts`:
- `@Injectable()` class `KudosService` with `PrismaService` injected via constructor
- `create(data: {from: string, to: string, message: string})` method: trim all three fields, then call `this.prisma.kudos.create({ data: { from: trimmed, to: trimmed, message: trimmed } })` and return the result
- `findAll()` method: return `this.prisma.kudos.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })`

## Packet 4: kudos-controller-module-registration
Create `src/modules/kudos/kudos.controller.ts`:
- `@Controller()` class with `KudosService` injected
- `@Post('/kudos')` handler accepting `@Body() body: any`:
  - Validate that `from`, `to`, `message` are all present and are strings (typeof check)
  - Trim each field
  - Validate trimmed lengths: `from` 1–100, `to` 1–100, `message` 1–500
  - On any violation: throw `BadRequestException` with a descriptive message
  - On success: call `this.kudosService.create({ from: trimmed, to: trimmed, message: trimmed })` and return the result (NestJS uses 201 for @Post automatically)
- `@Get('/kudos')` handler: return `this.kudosService.findAll()`

Create `src/modules/kudos/kudos.module.ts`:
- `@Module` that imports `PrismaModule`, registers `KudosController` in controllers and `KudosService` in providers

Modify `src/modules/index.ts`:
- Import `KudosModule` from `'./kudos/kudos.module'`
- Export `const MODULES = [KudosModule]`

## Packet 5: kudos-integration-tests
Create `test/modules/kudos.spec.ts` with integration tests. First study the existing test files in `test/platform/` to match the project's testing patterns. Use `@nestjs/testing` and vitest globals.

Required test cases:
1. Valid POST `/kudos` returns 201 with `id`, `from`, `to`, `message`, `createdAt` in response
2. POST trims leading/trailing whitespace from all fields — response shows trimmed values
3. POST with a missing field (e.g., no `message`) returns 400
4. POST with a non-string field (e.g., `from: 123`) returns 400
5. POST with empty or whitespace-only field returns 400
6. POST with `from` or `to` exceeding 100 characters returns 400
7. POST with `message` exceeding 500 characters returns 400
8. GET `/kudos` with no entries returns 200 with `[]`
9. GET returns entries sorted by `createdAt` descending
10. GET breaks `createdAt` ties by `id` descending

IMPORTANT for tests:
- Check if `supertest` is available in package.json. If it is, use it. If not, use NestJS's built-in HTTP testing approach (the app's getHttpServer()).
- Each test or test group should get a clean database state. Since this is SQLite, you can clean the kudos table before each test using `prisma.kudos.deleteMany()`.
- For the createdAt sorting test, you'll need to create entries with different timestamps. You can directly use prisma to create records with explicit createdAt values to control ordering.
- For the tie-breaking test, create entries with the same createdAt but different ids.

## Final check
After all files are created/modified, verify the implementation is complete and consistent. Make sure all imports are correct and the module wiring is complete.
