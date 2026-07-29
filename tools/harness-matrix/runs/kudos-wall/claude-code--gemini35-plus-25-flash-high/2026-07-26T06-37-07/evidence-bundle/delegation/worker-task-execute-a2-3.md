# Fix test/modules/kudos.spec.ts — DI doesn't work under vitest+esbuild

## Problem
The test at `test/modules/kudos.spec.ts` uses `Test.createTestingModule` from `@nestjs/testing` to wire up the controller, service, and PrismaService. However, vitest uses esbuild for TypeScript transformation, and esbuild does NOT support `emitDecoratorMetadata`. This means NestJS's DI cannot resolve constructor parameters — `this.kudosService` is `undefined` inside `KudosController`.

The chassis test (`test/platform/chassis.test.ts`) works around this by NOT using NestJS DI — it instantiates `HealthController` directly with `new HealthController()`.

## Fix
Rewrite the test to manually construct the dependency chain WITHOUT using `Test.createTestingModule` or NestJS DI. Instead:

1. In `beforeAll`:
   - Create `prismaService = new PrismaService()`
   - Await `prismaService.$connect()` 
   - Create `kudosService = new KudosService(prismaService)` — pass prismaService as the constructor argument
   - Create `kudosController = new KudosController(kudosService)` — pass kudosService as the constructor argument
   - There is NO need for `app` or `moduleFixture`

2. In `beforeEach`:
   - `await prismaService.kudos.deleteMany()` — to clean the table between tests

3. In `afterAll`:
   - `await prismaService.$disconnect()`

4. Keep all 9 test cases exactly as they are (the test bodies don't need to change, just remove any references to `app` or `moduleFixture.get()`).

5. Remove the `INestApplication` and `@nestjs/testing` imports since they're no longer needed.

The test file is at `test/modules/kudos.spec.ts`. Read it first, then rewrite it with the manual DI approach.

## IMPORTANT
- Do NOT create any new files
- Do NOT modify any other file
- Do NOT create any .db files
